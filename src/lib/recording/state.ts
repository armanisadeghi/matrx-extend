import * as cdp from '@/lib/cdp/client';
/**
 * Per-tab GIF recording state, backed by Chrome DevTools Protocol's
 * `Page.startScreencast`.
 *
 * Why CDP screencast: `chrome.tabs.captureVisibleTab` is throttled to ~2/s,
 * not enough for animation. Screencast streams JPEG frames at request rate
 * with no throttle, and we already have CDP plumbing (admin + `debugger`
 * optional permission, `chrome.debugger.onEvent` listener registry).
 *
 * Memory: frames are kept as JPEG bytes (~30 KB each at q=80) instead of
 * raw RGBA (~3 MB each). We decode lazily at export time. A 30s recording
 * at 12 fps stays under 15 MB.
 *
 * Action overlays: we subscribe to the dispatcher's tool events via
 * `recordToolEvent` (called inline from src/lib/tools/dispatch.ts). When a
 * recording is active for the tab, we tag each tool call's coordinate /
 * label / timestamp into a small event log. At export time we composite
 * pulses, drag arrows, and floating labels onto frames whose timestamps
 * fall within the event window.
 *
 * 📝 Design notes & known limitations:
 *    .research/record-gif-design-notes.md
 *    Covers: ref-only clicks rendering as labels (not pulses), multi-tab
 *    event-routing caveat, SW lifecycle, frame-rate throttling rationale.
 */
import { log } from '@/lib/debug/log';

export interface RawFrame {
  /** Base64 JPEG payload from `Page.screencastFrame`. */
  jpeg_b64: string;
  width: number;
  height: number;
  ts: number;
}

export type RecordedEventKind =
  | 'click'
  | 'right_click'
  | 'double_click'
  | 'triple_click'
  | 'drag'
  | 'type'
  | 'key'
  | 'scroll'
  | 'navigate'
  | 'other';

export interface RecordedEvent {
  ts: number;
  kind: RecordedEventKind;
  label: string;
  /** [x, y] viewport coordinate, when knowable. */
  coordinate?: [number, number];
  /** [start, end] coordinate pair, for drags. */
  drag_path?: [[number, number], [number, number]];
}

export interface RecordingState {
  tabId: number;
  startedAt: number;
  width: number;
  height: number;
  frames: RawFrame[];
  events: RecordedEvent[];
  /** Throttle cap so recordings stay near a target fps. */
  minFrameIntervalMs: number;
  lastFrameTs: number;
  cdpListener: ((source: chrome.debugger.Debuggee, method: string, params?: object) => void) | null;
}

const STATES = new Map<number, RecordingState>();

const DEFAULT_FORMAT = 'jpeg' as const;
const DEFAULT_QUALITY = 80;
const DEFAULT_MAX_DIM = 720;
const TARGET_FPS = 12;
const MIN_FRAME_INTERVAL_MS = Math.round(1000 / TARGET_FPS);

export function isRecording(tabId: number): boolean {
  return STATES.has(tabId);
}

export function getRecording(tabId: number): RecordingState | undefined {
  return STATES.get(tabId);
}

export async function startRecording(
  tabId: number,
): Promise<{ ok: boolean; reason?: string; width?: number; height?: number }> {
  if (STATES.has(tabId)) {
    return {
      ok: false,
      reason: 'A recording is already active on this tab. Stop or clear it first.',
    };
  }
  const attached = await cdp.attach(tabId);
  if (!attached.ok) return { ok: false, reason: `cdp attach failed: ${attached.reason}` };

  try {
    await cdp.send(tabId, 'Page.enable');
  } catch (err) {
    return { ok: false, reason: `Page.enable failed: ${(err as Error).message}` };
  }

  const state: RecordingState = {
    tabId,
    startedAt: Date.now(),
    width: 0,
    height: 0,
    frames: [],
    events: [],
    minFrameIntervalMs: MIN_FRAME_INTERVAL_MS,
    lastFrameTs: 0,
    cdpListener: null,
  };

  const listener = (source: chrome.debugger.Debuggee, method: string, params?: object) => {
    if (source.tabId !== tabId) return;
    if (method !== 'Page.screencastFrame') return;
    const p = params as
      | {
          data?: string;
          metadata?: { deviceWidth?: number; deviceHeight?: number; timestamp?: number };
          sessionId?: number;
        }
      | undefined;
    if (!p?.data) return;
    chrome.debugger
      .sendCommand({ tabId }, 'Page.screencastFrameAck', { sessionId: p.sessionId })
      .catch(() => {});
    const now = Date.now();
    if (state.lastFrameTs && now - state.lastFrameTs < state.minFrameIntervalMs) return;
    state.lastFrameTs = now;
    const w = p.metadata?.deviceWidth ?? state.width;
    const h = p.metadata?.deviceHeight ?? state.height;
    if (w && h) {
      state.width = w;
      state.height = h;
    }
    state.frames.push({ jpeg_b64: p.data, width: w, height: h, ts: now });
  };
  chrome.debugger.onEvent.addListener(listener);
  state.cdpListener = listener;

  try {
    await cdp.send(tabId, 'Page.startScreencast', {
      format: DEFAULT_FORMAT,
      quality: DEFAULT_QUALITY,
      maxWidth: DEFAULT_MAX_DIM,
      maxHeight: DEFAULT_MAX_DIM,
      everyNthFrame: 1,
    });
  } catch (err) {
    chrome.debugger.onEvent.removeListener(listener);
    return { ok: false, reason: `startScreencast failed: ${(err as Error).message}` };
  }

  STATES.set(tabId, state);
  log.info('sw', `recording started on tab ${tabId}`);
  return { ok: true };
}

export async function stopRecording(
  tabId: number,
): Promise<{ ok: boolean; reason?: string; frame_count?: number; duration_ms?: number }> {
  const state = STATES.get(tabId);
  if (!state) return { ok: false, reason: 'No active recording on this tab.' };
  try {
    await cdp.send(tabId, 'Page.stopScreencast');
  } catch {
    // tab may have closed; non-fatal
  }
  if (state.cdpListener) {
    chrome.debugger.onEvent.removeListener(state.cdpListener);
    state.cdpListener = null;
  }
  log.info('sw', `recording stopped on tab ${tabId} (${state.frames.length} frames)`);
  return {
    ok: true,
    frame_count: state.frames.length,
    duration_ms:
      state.frames.length > 0 ? state.frames[state.frames.length - 1]!.ts - state.startedAt : 0,
  };
}

export function clearRecording(tabId: number): { ok: boolean; cleared_frames: number } {
  const state = STATES.get(tabId);
  if (!state) return { ok: true, cleared_frames: 0 };
  if (state.cdpListener) {
    chrome.debugger.onEvent.removeListener(state.cdpListener);
    cdp.send(tabId, 'Page.stopScreencast').catch(() => {});
  }
  STATES.delete(tabId);
  return { ok: true, cleared_frames: state.frames.length };
}

/**
 * Hook called from the tool dispatcher on every tool call. No-op when
 * nothing is recording — cheap.
 */
export function recordToolEvent(
  toolName: string,
  phase: 'started' | 'completed' | 'error',
  args: unknown,
): void {
  if (phase !== 'started') return;
  if (STATES.size === 0) return;
  const ev = classifyToolEvent(toolName, args);
  if (!ev) return;
  // We can't always know which tab the call targeted — most browser-action
  // tools operate on the active tab. Stamp the event into every active
  // recording; at export time we composite onto frames within a small time
  // window, so noise rarely surfaces.
  for (const state of STATES.values()) state.events.push(ev);
}

function classifyToolEvent(toolName: string, args: unknown): RecordedEvent | null {
  const a = (args ?? {}) as Record<string, unknown>;
  const ts = Date.now();
  const coord = (a.coordinate as [number, number] | undefined) ?? undefined;
  switch (toolName) {
    case 'click_element':
    case 'computer.left_click':
      return {
        ts,
        kind: 'click',
        label: 'click',
        ...(coord !== undefined && { coordinate: coord }),
      };
    case 'right_click_element':
      return {
        ts,
        kind: 'right_click',
        label: 'right click',
        ...(coord !== undefined && { coordinate: coord }),
      };
    case 'type_into_element': {
      const text = typeof a.text === 'string' ? truncateLabel(a.text) : '';
      return {
        ts,
        kind: 'type',
        label: text ? `type: ${text}` : 'type',
        ...(coord !== undefined && { coordinate: coord }),
      };
    }
    case 'press_keys': {
      const keys = typeof a.keys === 'string' ? a.keys : '';
      return { ts, kind: 'key', label: keys ? `key: ${keys}` : 'key' };
    }
    case 'scroll_page':
      return { ts, kind: 'scroll', label: 'scroll' };
    case 'navigate_active_tab': {
      const url = typeof a.url === 'string' ? a.url : '';
      return { ts, kind: 'navigate', label: url ? `→ ${shortenUrl(url)}` : 'navigate' };
    }
    case 'computer': {
      const action = typeof a.action === 'string' ? a.action : '';
      if (action === 'left_click') {
        return {
          ts,
          kind: 'click',
          label: 'click',
          ...(coord !== undefined && { coordinate: coord }),
        };
      }
      if (action === 'right_click') {
        return {
          ts,
          kind: 'right_click',
          label: 'right click',
          ...(coord !== undefined && { coordinate: coord }),
        };
      }
      if (action === 'double_click') {
        return {
          ts,
          kind: 'double_click',
          label: 'double click',
          ...(coord !== undefined && { coordinate: coord }),
        };
      }
      if (action === 'triple_click') {
        return {
          ts,
          kind: 'triple_click',
          label: 'triple click',
          ...(coord !== undefined && { coordinate: coord }),
        };
      }
      if (action === 'left_click_drag') {
        const start = a.start_coordinate as [number, number] | undefined;
        const end = coord;
        if (start && end) {
          return { ts, kind: 'drag', label: 'drag', drag_path: [start, end] };
        }
        return null;
      }
      if (action === 'type') {
        const text = typeof a.text === 'string' ? truncateLabel(a.text) : '';
        return { ts, kind: 'type', label: text ? `type: ${text}` : 'type' };
      }
      if (action === 'key') {
        const text = typeof a.text === 'string' ? a.text : '';
        return { ts, kind: 'key', label: text ? `key: ${text}` : 'key' };
      }
      if (action === 'scroll') return { ts, kind: 'scroll', label: 'scroll' };
      return null;
    }
    case 'navigate':
      return { ts, kind: 'navigate', label: 'navigate' };
    default:
      return null;
  }
}

function truncateLabel(s: string): string {
  return s.length > 32 ? `${s.slice(0, 29)}…` : s;
}

function shortenUrl(u: string): string {
  try {
    const parsed = new URL(u);
    return `${parsed.host}${parsed.pathname}`.slice(0, 40);
  } catch {
    return u.slice(0, 40);
  }
}
