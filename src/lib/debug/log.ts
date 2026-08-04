/**
 * Debug event log. Every cross-context hop, every fetch, every Supabase call,
 * every error, every state transition writes to this store. The Debug tab
 * tails it live.
 *
 * Persisted: NO — in-memory, capped at MAX_EVENTS. Cleared on extension reload.
 *
 * Cross-context relay: each non-sidepanel context (SW, offscreen, content)
 * forwards every log event to the sidepanel via chrome.runtime.sendMessage
 * so the sidepanel sees a unified view.
 *
 * Usage from any context:
 *   import { log } from '@/lib/debug/log';
 *   log.info('auth', 'sign-in starting', { redirectUri });
 */

import { newId } from '@/lib/id';
import { create } from 'zustand';

export type LogLevel = 'info' | 'success' | 'warn' | 'error';
export type LogSource =
  | 'auth'
  | 'api'
  | 'stream'
  | 'scrape'
  | 'desktop'
  | 'desktop-ws-offscreen'
  | 'supabase'
  | 'sw'
  | 'msg'
  | 'ui'
  | 'sys'
  | 'frontend-bridge'
  | 'pilot'
  | 'pilot-stream'
  | 'audio'
  | 'broker';

export interface DebugEvent {
  id: string;
  ts: number;
  /** Monotonic sequence within this context — protects against ms-collision drops. */
  seq: number;
  level: LogLevel;
  source: LogSource;
  message: string;
  detail?: unknown;
  /**
   * Optional sub-type within a source — primarily the stream event type
   * (`phase`, `data`, `record_reserved`, `tool_event`, `warning`, …) so the
   * Debug tab can filter the stream firehose by individual event type, not
   * just the whole `stream` source. Undefined for most logs.
   */
  tag?: string | undefined;
  ctx: 'sidepanel' | 'sw' | 'offscreen' | 'content' | 'popup' | 'options' | 'unknown';
}

const MAX_EVENTS = 1500;
const DEBUG_RELAY_KIND = '__matrx_debug_relay__';
const IS_ADMIN_KEY = 'matrx.user.isAdmin';

/**
 * Cached admin flag. The cross-context relay and the Debug tab visibility
 * are gated on this. We hydrate it from chrome.storage.local on module load
 * and listen for changes so admin grants/revokes propagate live.
 */
let isAdminCached: boolean | null = null;

if (typeof chrome !== 'undefined' && chrome.storage?.local) {
  chrome.storage.local
    .get([IS_ADMIN_KEY])
    .then((r) => {
      isAdminCached = !!r[IS_ADMIN_KEY];
    })
    .catch(() => {
      isAdminCached = false;
    });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const change = changes[IS_ADMIN_KEY];
    if (change) isAdminCached = !!change.newValue;
  });
}

interface DebugState {
  events: DebugEvent[];
  push: (e: DebugEvent) => void;
  clear: () => void;
}

function detectContext(): DebugEvent['ctx'] {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return 'sw';
  }
  const href = location.href;
  if (href.startsWith('chrome-extension://')) {
    if (href.includes('/sidepanel.html')) return 'sidepanel';
    if (href.includes('/popup.html')) return 'popup';
    if (href.includes('/options.html')) return 'options';
    if (href.includes('/offscreen.html')) return 'offscreen';
    return 'unknown';
  }
  return 'content';
}

const ctxAtLoad = detectContext();
let seq = 0;

export const useDebugStore = create<DebugState>((set) => ({
  events: [],
  push: (event) =>
    set((s) => {
      const next = [event, ...s.events];
      if (next.length > MAX_EVENTS) next.length = MAX_EVENTS;
      return { events: next };
    }),
  clear: () => set({ events: [] }),
}));

interface PushArgs {
  source: LogSource;
  message: string;
  detail?: unknown;
  tag?: string | undefined;
}

function emit(level: LogLevel, args: PushArgs): void {
  seq += 1;
  const event: DebugEvent = {
    id: newId('log'),
    ts: Date.now(),
    seq,
    level,
    source: args.source,
    message: args.message,
    detail: args.detail,
    tag: args.tag,
    ctx: ctxAtLoad,
  };
  useDebugStore.getState().push(event);

  // Mirror to console — useful for inspecting context-local logs in DevTools.
  const consoleFn =
    level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  // For error-level events with non-Error details, expand the detail so we
  // capture name/message/stack/own-properties — `{}` is useless.
  if (level === 'error' && event.detail !== undefined) {
    event.detail = captureError(event.detail);
  }
  if (event.detail !== undefined) {
    consoleFn(`[matrx-extend][${event.ctx}/${event.source}] ${event.message}`, event.detail);
  } else {
    consoleFn(`[matrx-extend][${event.ctx}/${event.source}] ${event.message}`);
  }

  // Cross-context relay: every non-sidepanel context forwards immediately.
  // Suppress only when we know the user is non-admin (privacy for their
  // own logs). When the cached flag is still resolving (`null`), relay
  // anyway — otherwise the very first logs after a context boot get
  // dropped and observability for cold-start bugs is gone. The relay is
  // a local in-process message; no network egress.
  if (ctxAtLoad !== 'sidepanel' && isAdminCached !== false) {
    try {
      chrome.runtime
        .sendMessage({ __matrx: true, kind: DEBUG_RELAY_KIND, payload: event })
        .catch(() => undefined);
    } catch {
      /* sendMessage can throw if context is shutting down — ignore */
    }
  }
}

export const log = {
  info: (source: LogSource, message: string, detail?: unknown, tag?: string) =>
    emit('info', { source, message, detail, tag }),
  success: (source: LogSource, message: string, detail?: unknown, tag?: string) =>
    emit('success', { source, message, detail, tag }),
  warn: (source: LogSource, message: string, detail?: unknown, tag?: string) =>
    emit('warn', { source, message, detail, tag }),
  error: (source: LogSource, message: string, detail?: unknown, tag?: string) =>
    emit('error', { source, message, detail, tag }),
};

/**
 * Capture every available shred of info from a thrown value so we never end
 * up with `{}` in the log. Handles Error instances, plain objects (including
 * DOMException/TypeError without enumerable props), strings, undefined, etc.
 */
export function captureError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const out: Record<string, unknown> = {
      __kind: err.constructor?.name ?? 'Error',
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
    // Capture extra fields some browsers attach (e.g. cause, code).
    for (const key of Object.getOwnPropertyNames(err)) {
      if (!(key in out)) out[key] = (err as unknown as Record<string, unknown>)[key];
    }
    return out;
  }
  if (err === null || err === undefined) {
    return { __kind: 'nullish', __raw: String(err) };
  }
  if (typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    const out: Record<string, unknown> = {
      __kind: Object.prototype.toString.call(err),
      __string: String(err),
    };
    for (const key of Object.getOwnPropertyNames(obj)) {
      out[key] = obj[key];
    }
    return out;
  }
  return { __kind: typeof err, __raw: String(err) };
}

/**
 * Sidepanel + SW both call this once at boot. Each listens for relayed
 * events from other contexts.
 *
 * - Sidepanel: merges remote events into `useDebugStore` so the Debug tab
 *   shows a unified feed.
 * - SW: mirrors remote events to the SW console with the original
 *   `[matrx-extend][<ctx>/<source>]` prefix, so the SW devtools window
 *   becomes a single pane of glass for everything happening across
 *   contexts (offscreen + sidepanel + content). Without this mirror,
 *   debugging a cross-context flow (e.g. mic: sidepanel → SW → offscreen)
 *   requires opening three separate devtools windows.
 *
 * Offscreen / content / popup / options call this too — it's a no-op
 * there. They push their own events at log time and forward via
 * `chrome.runtime.sendMessage`.
 */
export function startDebugRelay(): void {
  if (ctxAtLoad !== 'sidepanel' && ctxAtLoad !== 'sw') return;
  chrome.runtime.onMessage.addListener((msg) => {
    if (
      !msg ||
      typeof msg !== 'object' ||
      (msg as Record<string, unknown>).__matrx !== true ||
      (msg as Record<string, unknown>).kind !== DEBUG_RELAY_KIND
    ) {
      return false;
    }
    const remote = (msg as { payload: DebugEvent }).payload;
    // Avoid double-counting our own events that come back via broadcast.
    if (remote.ctx === ctxAtLoad) return false;

    if (ctxAtLoad === 'sidepanel') {
      useDebugStore.getState().push(remote);
      return false;
    }

    // SW mirror: print the relayed event to the SW console with the
    // original context/source prefix preserved. This is what makes the
    // SW devtools window a single pane of glass.
    const consoleFn =
      remote.level === 'error'
        ? console.error
        : remote.level === 'warn'
          ? console.warn
          : console.log;
    const prefix = `[matrx-extend][${remote.ctx}/${remote.source}]`;
    if (remote.detail !== undefined) {
      consoleFn(`${prefix} ${remote.message}`, remote.detail);
    } else {
      consoleFn(`${prefix} ${remote.message}`);
    }
    return false;
  });
  log.info('sys', `debug relay started (ctx=${ctxAtLoad})`);
}
