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
  | 'supabase'
  | 'sw'
  | 'msg'
  | 'ui'
  | 'sys';

export interface DebugEvent {
  id: string;
  ts: number;
  /** Monotonic sequence within this context — protects against ms-collision drops. */
  seq: number;
  level: LogLevel;
  source: LogSource;
  message: string;
  detail?: unknown;
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

  // Cross-context relay: every non-sidepanel context forwards immediately,
  // BUT only when the signed-in user is an admin. Non-admins don't ship
  // telemetry around the extension and don't see the Debug tab.
  if (ctxAtLoad !== 'sidepanel' && isAdminCached === true) {
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
  info: (source: LogSource, message: string, detail?: unknown) =>
    emit('info', { source, message, detail }),
  success: (source: LogSource, message: string, detail?: unknown) =>
    emit('success', { source, message, detail }),
  warn: (source: LogSource, message: string, detail?: unknown) =>
    emit('warn', { source, message, detail }),
  error: (source: LogSource, message: string, detail?: unknown) =>
    emit('error', { source, message, detail }),
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
 * Sidepanel calls this once at mount. It listens for relayed events from
 * other contexts and merges them into the sidepanel's store.
 *
 * Other contexts call this too, but it's a no-op there — they push their
 * events at log time, not via subscription.
 */
export function startDebugRelay(): void {
  if (ctxAtLoad !== 'sidepanel') return;
  chrome.runtime.onMessage.addListener((msg) => {
    if (
      msg &&
      typeof msg === 'object' &&
      (msg as Record<string, unknown>).__matrx === true &&
      (msg as Record<string, unknown>).kind === DEBUG_RELAY_KIND
    ) {
      const remote = (msg as { payload: DebugEvent }).payload;
      // Avoid double-counting our own events that come back via broadcast.
      if (remote.ctx === 'sidepanel') return false;
      useDebugStore.getState().push(remote);
    }
    return false;
  });
  log.info('sys', `debug relay started (ctx=${ctxAtLoad})`);
}
