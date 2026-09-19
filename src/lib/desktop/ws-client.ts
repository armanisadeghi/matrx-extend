/**
 * SW-side proxy for the persistent WebSocket reverse channel (Phase 2 C2.a).
 *
 * MV3 service workers idle out at ~30 s of inactivity. WebSocket connections
 * cannot survive that, so the actual `new WebSocket(...)` lives inside the
 * extension's offscreen document, which Chrome keeps alive while we hold a
 * `WEBSOCKETS` reason.
 *
 * Architecture:
 *   SW           offscreen           matrx-local
 *    |              |                     |
 *    |  WS_START    |                     |
 *    | -----------> |                     |
 *    |              | new WebSocket()     |
 *    |              | -----------------> |
 *    |  WS_STATE    |                     |
 *    | <----------- |                     |
 *    |              |                     |
 *    |  WS_SEND     |                     |
 *    | -----------> | ws.send()           |
 *    |              | -----------------> |
 *    |              |                     |
 *    |              | onmessage           |
 *    |              | <----------------- |
 *    |  WS_MESSAGE  |                     |
 *    | <----------- |                     |
 *
 * The offscreen document is reused across Phase 1 streaming + Phase 2 WS
 * because Chrome MV3 only permits ONE offscreen document at a time. This
 * module ensures the document exists (via the existing `ensureOffscreen`
 * primitive in offscreen-proxy.ts), then sends WS_START to initialize the
 * WS within it.
 */

import { log } from '@/lib/debug/log';
import { getEngineBaseUrl } from '@/lib/desktop/discovery';
import { ensurePairToken } from '@/lib/desktop/http';
import { broadcast, on, send } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { ensureOffscreen } from '@/lib/stream/offscreen-proxy';

// ─── Types ──────────────────────────────────────────────────────────────────

export type WsState = 'open' | 'closed' | 'unknown';

interface WsStateMessage {
  state: WsState;
}

interface LocalBrowserForward {
  __matrxLocalBrowserLifecycle: true;
  socketEpoch: string;
  payload: unknown;
}

interface WsEpochHandshake {
  socketEpoch: string;
  backgroundBootId: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function redactToken(url: string): string {
  return url.replace(/([?&])token=[^&]+/, '$1token=***');
}

// ─── Module state ───────────────────────────────────────────────────────────

let lastKnownState: WsState = 'unknown';
let lastStateChangeAt: number | null = null;
const messageHandlers = new Set<(payload: unknown) => void>();
const localBrowserLifecycleHandlers = new Set<(payload: unknown, socketEpoch: string) => void>();
const localBrowserEpochInvalidators = new Set<(nextSocketEpoch: string | null) => void>();
let listenerInstalled = false;
let activeLocalBrowserSocketEpoch: string | null = null;
// A retained offscreen document must not keep a socket alive across a service
// worker restart. Supplying this boot id on WS_START makes it reconnect and
// perform a fresh epoch handshake.
const backgroundBootId = crypto.randomUUID();

// ─── Public API ─────────────────────────────────────────────────────────────

export interface WsControlResult {
  ok: boolean;
  error?: string;
  /** Where the failure occurred, when it did. */
  stage?: 'discover' | 'auth' | 'ensure-offscreen' | 'send' | 'open';
}

/**
 * Lazily ensure the offscreen document exists, then ask it to open the WS.
 * Idempotent — the offscreen-side handler tracks "is the WS already open?"
 * and no-ops if so.
 *
 * The wsUrl is resolved HERE (caller-side) and passed to the offscreen
 * because offscreen documents don't have chrome.storage access — the
 * discovery cache lives in storage, so the offscreen can't run
 * getEngineBaseUrl itself. Same pattern as streaming.
 *
 * Returns a structured result so callers (notably the Bridges debug panel)
 * can surface failures. Errors at every stage are caught and reported;
 * this never throws.
 */
export async function connectWs(): Promise<WsControlResult> {
  installRouterIfNeeded();
  let wsUrl: string;
  try {
    const baseUrl = await getEngineBaseUrl();
    if (!baseUrl) {
      return {
        ok: false,
        error: 'engine base URL unresolved (matrx-local offline?)',
        stage: 'discover',
      };
    }
    // Browsers don't allow custom headers on WebSocket — engine reads the
    // bearer from a `?token=` query param instead of an Authorization header.
    const token = await ensurePairToken(baseUrl);
    if (!token) {
      return {
        ok: false,
        error:
          'desktop not paired — auto-pairing failed (engine offline or pre-pairing version); or paste the pair code in Settings → Desktop Bridge',
        stage: 'auth',
      };
    }
    wsUrl = `${baseUrl.replace(/^http/, 'ws')}/extension/ws?token=${encodeURIComponent(token)}`;
  } catch (err) {
    const error = (err as Error).message;
    log.warn('desktop', 'ws connectWs discovery failed', error);
    return { ok: false, error, stage: 'discover' };
  }
  try {
    await ensureOffscreen();
  } catch (err) {
    const error = (err as Error).message;
    log.warn('desktop', 'ws connectWs ensureOffscreen failed', error);
    return { ok: false, error, stage: 'ensure-offscreen' };
  }
  try {
    // Build identity is resolved HERE, in the SW, because an offscreen
    // document has messaging but not the rest of `chrome.runtime` —
    // `getManifest()` is undefined there. Same reason `wsUrl` is passed in
    // rather than re-resolved offscreen.
    const manifest = chrome.runtime.getManifest();
    const r = await send<
      {
        wsUrl: string;
        identity: { extensionId: string; version: string; name: string };
        backgroundBootId: string;
      },
      { ok: boolean; error?: string }
    >(CHANNELS.WS_START, {
      wsUrl,
      identity: {
        extensionId: chrome.runtime.id,
        version: manifest.version,
        name: manifest.name,
      },
      backgroundBootId,
    });
    if (r && r.ok === false) {
      const error = r.error ?? 'unknown error';
      log.warn('desktop', 'ws connectWs offscreen returned error', error);
      return { ok: false, error, stage: 'open' };
    }
    log.info('desktop', `ws connectWs requested → ${redactToken(wsUrl)}`);
    return { ok: true };
  } catch (err) {
    const error = (err as Error).message;
    log.warn('desktop', 'ws connectWs send failed', error);
    return { ok: false, error, stage: 'send' };
  }
}

/**
 * Ask the offscreen-side WS to close. Does NOT tear down the offscreen
 * document — that's owned by the streaming subsystem.
 */
export async function disconnectWs(): Promise<WsControlResult> {
  try {
    await send<unknown, { ok: boolean }>(CHANNELS.WS_STOP, {});
    log.info('desktop', 'ws disconnectWs requested');
    lastKnownState = 'closed';
    return { ok: true };
  } catch (err) {
    const error = (err as Error).message;
    log.warn('desktop', 'ws disconnectWs failed', error);
    lastKnownState = 'closed';
    return { ok: false, error, stage: 'send' };
  }
}

/**
 * Forward a payload over the WS. If the offscreen document or WS isn't up
 * yet, opens the document and the WS first. The offscreen-side handler
 * buffers no messages — if the WS isn't currently open, this resolves
 * with a structured error.
 */
export async function sendWs(payload: unknown): Promise<void> {
  installRouterIfNeeded();
  if (lastKnownState !== 'open') {
    await connectWs();
  }
  await send<unknown, { ok: boolean; error?: string }>(CHANNELS.WS_SEND, payload);
}

/** Current private lifecycle epoch, if the offscreen socket acknowledged it. */
export function getLocalBrowserSocketEpoch(): string | null {
  return activeLocalBrowserSocketEpoch;
}

/**
 * Send a local-browser lifecycle frame only over the exact acknowledged
 * socket. A stale caller is refused locally; frames are never queued.
 */
export async function sendLocalBrowserLifecycle(
  socketEpoch: string,
  payload: unknown,
): Promise<boolean> {
  installRouterIfNeeded();
  if (socketEpoch !== activeLocalBrowserSocketEpoch) return false;
  const result = await send<LocalBrowserForward, { ok: boolean }>(CHANNELS.WS_SEND, {
    __matrxLocalBrowserLifecycle: true,
    socketEpoch,
    payload,
  });
  return result?.ok === true && socketEpoch === activeLocalBrowserSocketEpoch;
}

/** Subscribe to private local-browser lifecycle frames for the current epoch. */
export function onLocalBrowserLifecycle(
  handler: (payload: unknown, socketEpoch: string) => void,
): () => void {
  installRouterIfNeeded();
  localBrowserLifecycleHandlers.add(handler);
  return () => localBrowserLifecycleHandlers.delete(handler);
}

/**
 * Runs synchronously before an epoch is acknowledged. Consumers use this to
 * clear private maps and waiters before any frame for the new epoch can flow.
 */
export function onLocalBrowserEpochInvalidated(
  handler: (nextSocketEpoch: string | null) => void,
): () => void {
  localBrowserEpochInvalidators.add(handler);
  return () => localBrowserEpochInvalidators.delete(handler);
}

/**
 * Subscribe to inbound WS frames. Returns an unsubscribe fn.
 *
 * Multiple handlers are supported; each receives every inbound payload.
 */
export function onWsMessage(handler: (payload: unknown) => void): () => void {
  installRouterIfNeeded();
  messageHandlers.add(handler);
  return () => messageHandlers.delete(handler);
}

/**
 * Observable WS state. Starts as 'unknown' until the first WS_STATE
 * broadcast arrives from the offscreen document.
 */
export function getWsState(): WsState {
  return lastKnownState;
}

/** Wall-clock ms of the last state transition observed by this context. */
export function getWsStateChangedAt(): number | null {
  return lastStateChangeAt;
}

// ─── Internal — SW message router ───────────────────────────────────────────

function installRouterIfNeeded(): void {
  if (listenerInstalled) return;
  listenerInstalled = true;

  on<WsEpochHandshake, { ok: boolean; socketEpoch?: string }>(
    CHANNELS.WS_EPOCH_HANDSHAKE,
    (handshake) => {
      if (!handshake || typeof handshake.socketEpoch !== 'string' || !handshake.socketEpoch) {
        return { ok: false };
      }
      if (handshake.socketEpoch !== activeLocalBrowserSocketEpoch) {
        // This is intentionally synchronous: offscreen does not receive the
        // acknowledgement until all lifecycle owners have dropped old state.
        for (const invalidate of localBrowserEpochInvalidators) invalidate(handshake.socketEpoch);
        activeLocalBrowserSocketEpoch = handshake.socketEpoch;
      }
      return { ok: true, socketEpoch: handshake.socketEpoch };
    },
  );

  // chrome.runtime.onMessage delivers the broadcasts from the offscreen
  // document. We use the underlying chrome.runtime.* API rather than the
  // higher-level on() helper because we want to OBSERVE these events
  // without sendResponse-ing them (broadcast pattern), and on() insists on
  // a return value.
  chrome.runtime.onMessage.addListener((msg, _sender, _sendResponse) => {
    if (!msg || typeof msg !== 'object') return false;
    const m = msg as { __matrx?: boolean; kind?: string; payload?: unknown };
    if (m.__matrx !== true) return false;

    if (m.kind === CHANNELS.WS_STATE) {
      const next = (m.payload as WsStateMessage)?.state;
      if (next === 'open' || next === 'closed') {
        if (next !== lastKnownState) {
          log.info('desktop', `ws state: ${lastKnownState} → ${next}`);
          lastStateChangeAt = Date.now();
        }
        lastKnownState = next;
      }
      return false;
    }
    if (m.kind === CHANNELS.WS_MESSAGE) {
      const local = m.payload as Partial<LocalBrowserForward> | null;
      if (
        local?.__matrxLocalBrowserLifecycle === true &&
        typeof local.socketEpoch === 'string' &&
        local.socketEpoch === activeLocalBrowserSocketEpoch
      ) {
        for (const h of localBrowserLifecycleHandlers) {
          try {
            h(local.payload, local.socketEpoch);
          } catch (err) {
            log.error('desktop', 'local-browser lifecycle handler threw', err);
          }
        }
        return false;
      }
      for (const h of messageHandlers) {
        try {
          h(m.payload);
        } catch (err) {
          log.error('desktop', 'ws onMessage handler threw', err);
        }
      }
      return false;
    }
    return false;
  });
}

// ─── Helper — fire-and-forget broadcast (used by some callers) ──────────────

/**
 * Internal helper exported for tests / debug. Most callers should use
 * `sendWs`, which awaits a structured response.
 */
export function broadcastWsControl(kind: string, payload: unknown): void {
  broadcast(kind, payload);
}
