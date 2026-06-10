/**
 * Service-worker side of demo recording.
 *
 * Lifecycle:
 *   start(tabId)           → activate tab, inject capture fn, register
 *                             webNavigation listener on this tab so we
 *                             re-inject after every navigation.
 *   onCapturedEvent(payload, sender) → translate to a DemoStep, append.
 *   stop()                 → unregister navigation listener; return frozen
 *                             RecordingState so caller can save / discard.
 *   discard()              → toss the in-flight recording.
 *
 * 📝 Notes:
 *    .research/demo-system-design-notes.md
 */
import { log } from '@/lib/debug/log';
import { type CapturedEvent, mountRecorderInPage } from '@/lib/demos/event-capture';
import type { DemoStep, RecordingState } from '@/lib/demos/types';

let active: RecordingState | null = null;
let navListener: Parameters<typeof chrome.webNavigation.onCommitted.addListener>[0] | null = null;

export function getActiveRecording(): RecordingState | null {
  return active;
}

export async function startRecording(
  tabId: number,
): Promise<{ ok: boolean; reason?: string; recording_id?: string }> {
  if (active)
    return { ok: false, reason: 'A demo recording is already in progress on this device.' };

  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (err) {
    return { ok: false, reason: `Tab ${tabId} not found: ${(err as Error).message}` };
  }
  if (!tab.url) return { ok: false, reason: `Tab ${tabId} has no URL.` };

  const recordingId = makeId();
  active = {
    recordingId,
    tabId,
    startedAt: Date.now(),
    startUrl: tab.url,
    steps: [],
    pageLoaded: true,
    lastUrl: tab.url,
    scrollTimer: null,
    unregister: async () => {
      if (navListener) {
        chrome.webNavigation.onCommitted.removeListener(navListener);
        navListener = null;
      }
    },
  };

  // Re-inject the capture function on every navigation in the recorded tab.
  navListener = (details) => {
    if (!active) return;
    if (details.tabId !== active.tabId) return;
    if (details.frameId !== 0) return; // top frame only
    void injectCaptureFn(active.tabId);
  };
  chrome.webNavigation.onCommitted.addListener(navListener);

  // First injection — for the page that's already loaded.
  await injectCaptureFn(tabId);

  log.info('sw', `demo recording started (id=${recordingId}, tab=${tabId})`);
  return { ok: true, recording_id: recordingId };
}

async function injectCaptureFn(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: mountRecorderInPage,
    });
  } catch (err) {
    // Some pages reject injection (chrome://, the web store, etc.). Log
    // and continue — the recording will simply have a gap at this URL.
    log.warn('sw', `demo capture injection failed on tab ${tabId}`, err);
  }
}

/** Called by the SW message handler when the content script posts an event. */
export function onCapturedEvent(payload: CapturedEvent, senderTabId: number | undefined): void {
  if (!active) return;
  if (senderTabId !== active.tabId) return;
  const step = eventToStep(payload, active);
  if (!step) return;
  // Dedupe: drop near-identical click/type events that came in a tight burst
  // (browsers sometimes fire change + blur close together for one user action).
  if (step.kind === 'type' || step.kind === 'check' || step.kind === 'select') {
    const last = active.steps[active.steps.length - 1];
    if (
      last &&
      last.kind === step.kind &&
      JSON.stringify(last.selector_chain) === JSON.stringify(step.selector_chain)
    ) {
      // Replace the last step with the more recent value; coalesces typing.
      active.steps[active.steps.length - 1] = step;
      return;
    }
  }
  // Suppress consecutive navigate steps with the same URL (initial-load
  // re-injection re-fires the navigate event).
  if (
    step.kind === 'navigate' &&
    step.navigation_url === active.lastUrl &&
    active.steps.length > 0
  ) {
    return;
  }
  if (step.kind === 'navigate' && step.navigation_url) {
    active.lastUrl = step.navigation_url;
  }
  active.steps.push(step);
}

export interface StopRecordingResult {
  ok: boolean;
  reason?: string;
  state?: RecordingState;
}

export async function stopRecording(): Promise<StopRecordingResult> {
  if (!active) return { ok: false, reason: 'No active demo recording.' };
  await active.unregister();
  const state = active;
  active = null;
  log.info('sw', `demo recording stopped (id=${state.recordingId}, ${state.steps.length} steps)`);
  return { ok: true, state };
}

export async function discardRecording(): Promise<{ ok: boolean }> {
  if (!active) return { ok: true };
  await active.unregister();
  active = null;
  return { ok: true };
}

// ─── helpers ──────────────────────────────────────────────────────────────
function eventToStep(ev: CapturedEvent, state: RecordingState): DemoStep | null {
  const baseOffset = ev.ts - state.startedAt;
  const idx = state.steps.length;
  const id = makeId();

  switch (ev.kind) {
    case 'navigate':
      return {
        id,
        index: idx,
        kind: 'navigate',
        url: ev.url,
        source_tab_id: state.tabId,
        ts_ms_offset: baseOffset,
        selector_chain: [],
        navigation_url: ev.url,
      };
    case 'click':
      return {
        id,
        index: idx,
        kind: 'click',
        url: ev.url,
        source_tab_id: state.tabId,
        ts_ms_offset: baseOffset,
        selector_chain: ev.selector_chain,
        element_snapshot: ev.element_snapshot,
      };
    case 'type':
      return {
        id,
        index: idx,
        kind: 'type',
        url: ev.url,
        source_tab_id: state.tabId,
        ts_ms_offset: baseOffset,
        selector_chain: ev.selector_chain,
        element_snapshot: ev.element_snapshot,
        input_text: ev.is_sensitive ? '' : ev.text,
        is_sensitive: ev.is_sensitive,
        // Sensitive fields auto-parameterize: they cannot be saved with the
        // recorded value. The user / agent must supply a placeholder.
        param_placeholder: ev.is_sensitive ? deriveParamName(ev.element_snapshot, idx) : undefined,
      };
    case 'check':
      return {
        id,
        index: idx,
        kind: 'check',
        url: ev.url,
        source_tab_id: state.tabId,
        ts_ms_offset: baseOffset,
        selector_chain: ev.selector_chain,
        element_snapshot: ev.element_snapshot,
        checked: ev.checked,
      };
    case 'select':
      return {
        id,
        index: idx,
        kind: 'select',
        url: ev.url,
        source_tab_id: state.tabId,
        ts_ms_offset: baseOffset,
        selector_chain: ev.selector_chain,
        element_snapshot: ev.element_snapshot,
        input_text: ev.value,
      };
    case 'submit':
      return {
        id,
        index: idx,
        kind: 'submit',
        url: ev.url,
        source_tab_id: state.tabId,
        ts_ms_offset: baseOffset,
        selector_chain: ev.selector_chain,
        element_snapshot: ev.element_snapshot,
      };
    case 'press_key':
      return {
        id,
        index: idx,
        kind: 'press_key',
        url: ev.url,
        source_tab_id: state.tabId,
        ts_ms_offset: baseOffset,
        selector_chain: ev.selector_chain ?? [],
        element_snapshot: ev.element_snapshot,
        input_text: ev.key_combo,
      };
    case 'scroll':
      return {
        id,
        index: idx,
        kind: 'scroll',
        url: ev.url,
        source_tab_id: state.tabId,
        ts_ms_offset: baseOffset,
        selector_chain: [],
        scroll_target: { x: ev.x, y: ev.y },
      };
    default:
      return null;
  }
}

function deriveParamName(
  snapshot: { accessible_name?: string; attrs?: Record<string, string> } | undefined,
  idx: number,
): string {
  const candidate =
    snapshot?.accessible_name ??
    snapshot?.attrs?.name ??
    snapshot?.attrs?.placeholder ??
    `field_${idx}`;
  return (
    candidate
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 32) || `field_${idx}`
  );
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID();
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
