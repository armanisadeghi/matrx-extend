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
import { getEngineBaseUrl, invalidateEnginePortCache } from '@/lib/desktop/discovery';
import { ensurePairToken } from '@/lib/desktop/http';
import { broadcast, on, send } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { ensureOffscreen } from '@/lib/stream/offscreen-proxy';

// ─── Types ──────────────────────────────────────────────────────────────────

export type WsState = 'open' | 'closed' | 'unknown';

interface WsStateMessage {
  state: WsState;
  socketEpoch?: string;
  /** The offscreen closed on purpose (idle, or an explicit stop). */
  intentional?: boolean;
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
/**
 * The last close was the offscreen's own decision (the 5-minute idle
 * watchdog, or an explicit stop) rather than a failure. The desktop probe
 * alarm must not undo it, or the idle policy becomes a churn loop.
 */
let lastCloseWasIntentional = false;
const messageHandlers = new Set<(payload: unknown) => void>();
const localBrowserLifecycleHandlers = new Set<(payload: unknown, socketEpoch: string) => void>();
const localBrowserEpochInvalidators = new Set<(nextSocketEpoch: string | null) => void>();
let listenerInstalled = false;
let activeLocalBrowserSocketEpoch: string | null = null;
// A retained offscreen document must not keep a socket alive across a service
// worker restart. Supplying this boot id on WS_START makes it reconnect and
// perform a fresh epoch handshake.
const backgroundBootId = crypto.randomUUID();

function invalidateLocalBrowserEpoch(nextSocketEpoch: string | null): boolean {
  let completed = true;
  for (const invalidate of localBrowserEpochInvalidators) {
    try {
      invalidate(nextSocketEpoch);
    } catch {
      completed = false;
      log.error('desktop', 'local-browser epoch invalidator threw');
    }
  }
  return completed;
}

function retireLocalBrowserEpoch(expectedSocketEpoch: string | null): void {
  if (
    activeLocalBrowserSocketEpoch === null ||
    activeLocalBrowserSocketEpoch !== expectedSocketEpoch
  ) {
    return;
  }
  activeLocalBrowserSocketEpoch = null;
  invalidateLocalBrowserEpoch(null);
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface WsControlResult {
  ok: boolean;
  error?: string;
  /** Where the failure occurred, when it did. */
  stage?: 'discover' | 'auth' | 'ensure-offscreen' | 'send' | 'open';
}

interface ResolvedWsUrl {
  wsUrl?: string;
  error?: string;
  stage?: WsControlResult['stage'];
}

/**
 * Resolve the full ws:// URL (discovered port + pair token).
 *
 * This lives in the SW because the offscreen document has no
 * chrome.storage: neither the discovery cache nor the pair token is
 * readable there. `forceRediscover` drops the cached port first — the same
 * self-heal `rpcHttp` performs on a 5xx — so an engine that restarted onto
 * a different port in the 22140-22159 scan range is found again instead of
 * being retried forever at its old address.
 */
async function resolveWsUrl(forceRediscover: boolean): Promise<ResolvedWsUrl> {
  try {
    if (forceRediscover) await invalidateEnginePortCache();
    const baseUrl = await getEngineBaseUrl();
    if (!baseUrl) {
      return { error: 'engine base URL unresolved (matrx-local offline?)', stage: 'discover' };
    }
    // Browsers don't allow custom headers on WebSocket — engine reads the
    // bearer from a `?token=` query param instead of an Authorization header.
    const token = await ensurePairToken(baseUrl);
    if (!token) {
      return {
        error:
          'desktop not paired — auto-pairing failed (engine offline or pre-pairing version); or paste the pair code in Settings → Desktop Bridge',
        stage: 'auth',
      };
    }
    return {
      wsUrl: `${baseUrl.replace(/^http/, 'ws')}/extension/ws?token=${encodeURIComponent(token)}`,
    };
  } catch (err) {
    return { error: (err as Error).message, stage: 'discover' };
  }
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
  // We are ATTEMPTING a connection, so whatever the last close meant is
  // spent. Without this the bridge could go silently dead forever: an idle
  // close sets `intentional`, and a reopen whose socket dies BEFORE it
  // opens broadcasts no state at all (the offscreen only owns `state.ws`
  // from the open listener onward), so the flag stayed true and the probe
  // alarm refused to reopen a healthy engine's failed socket.
  lastCloseWasIntentional = false;
  const resolved = await resolveWsUrl(false);
  if (!resolved.wsUrl) {
    const result: WsControlResult = {
      ok: false,
      error: resolved.error ?? 'engine base URL unresolved',
      ...(resolved.stage !== undefined && { stage: resolved.stage }),
    };
    if (resolved.stage === 'discover') log.info('desktop', 'ws connectWs: ' + result.error);
    return result;
  }
  const wsUrl = resolved.wsUrl;
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
    retireLocalBrowserEpoch(activeLocalBrowserSocketEpoch);
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
  installRouterIfNeeded();
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

/**
 * Should a background poll reopen the socket?
 *
 * No when it is already open, and no when the offscreen closed it on
 * purpose — an idle socket is a decision, not a fault, and reopening it
 * 30 seconds later turns the idle policy into a permanent churn cycle. An
 * outbound send still reopens it on demand.
 */
export function shouldBackgroundReopenWs(): boolean {
  if (lastKnownState === 'open') return false;
  return !lastCloseWasIntentional;
}

// ─── Internal — SW message router ───────────────────────────────────────────

/**
 * Register the SW-side WS router SYNCHRONOUSLY at background boot.
 *
 * MV3 dispatches a message to a freshly-woken service worker only against
 * listeners registered during the synchronous top-level run of its script.
 * Every other install site here is reached through an `await` chain, so a
 * retained offscreen document that woke the worker with WS_EPOCH_HANDSHAKE
 * or WS_RESOLVE_URL could find no listener and get `undefined` back —
 * reading, to the offscreen, as a rejected handshake.
 */
export function installWsRouter(): void {
  installRouterIfNeeded();
}

/**
 * True only in the service worker: no DOM, no window.
 *
 * The request/response handlers below answer the OFFSCREEN document, and
 * only the worker may answer them. Chrome delivers a message to every
 * context that registered the kind and keeps the FIRST sendResponse, so a
 * side panel that also registered them raced the worker — and lost the
 * offscreen its socket when it won: the side panel holds its own
 * module-scope `backgroundBootId`, so its epoch handshake answers
 * `{ ok: false }` and the offscreen tears the connection down as rejected.
 * A side panel answering WS_RESOLVE_URL would additionally run a second,
 * ungated port sweep from a context that does not own the rate limit.
 */
function isServiceWorkerContext(): boolean {
  return typeof window === 'undefined' && typeof document === 'undefined';
}

function installRouterIfNeeded(): void {
  if (listenerInstalled) return;
  listenerInstalled = true;

  if (isServiceWorkerContext()) installWorkerOnlyHandlers();

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
        lastCloseWasIntentional =
          next === 'closed' && (m.payload as WsStateMessage)?.intentional === true;
        if (next === 'closed' && typeof (m.payload as WsStateMessage)?.socketEpoch === 'string') {
          retireLocalBrowserEpoch((m.payload as WsStateMessage).socketEpoch ?? null);
        }
      }
      return false;
    }
    if (m.kind === CHANNELS.WS_MESSAGE) {
      const local = m.payload as Partial<LocalBrowserForward> | null;
      if (local?.__matrxLocalBrowserLifecycle === true) {
        if (
          typeof local.socketEpoch !== 'string' ||
          local.socketEpoch !== activeLocalBrowserSocketEpoch
        ) {
          return false;
        }
        for (const h of localBrowserLifecycleHandlers) {
          try {
            h(local.payload, local.socketEpoch);
          } catch {
            // Lifecycle frames can carry private grant material. Do not let a
            // consumer's error text turn that material into a debug payload.
            log.error('desktop', 'local-browser lifecycle handler threw');
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


/**
 * Handlers the OFFSCREEN document calls and only the service worker may
 * answer. See isServiceWorkerContext() for why this is not registered
 * everywhere.
 */
function installWorkerOnlyHandlers(): void {
  // A PERSON pressed a socket button in Debug → Bridges. It has to run
  // here: WS_START carries this worker's `backgroundBootId`, and a side
  // panel sending its own would make the offscreen treat the next
  // worker-driven START as a background restart and tear the socket down.
  on<{ action?: 'connect' | 'disconnect' | 'reconnect' }, WsControlResult>(
    CHANNELS.WS_RECONNECT,
    async (payload) => {
      const action = payload?.action ?? 'reconnect';
      if (action === 'disconnect') return disconnectWs();
      if (action === 'reconnect') {
        await disconnectWs();
        await new Promise((r) => setTimeout(r, 100));
      }
      return connectWs();
    },
  );

  // offscreen → SW: the offscreen is about to retry and needs a FRESH URL.
  // Without this the offscreen could only replay the URL it was handed at
  // WS_START; when the engine restarted onto another port in the scan range
  // that URL was dead forever and the retry loop could never recover — it
  // just logged a failure every 30s until the browser was restarted.
  on<{ failedUrl?: string }, { ok: boolean; wsUrl?: string; error?: string }>(
    CHANNELS.WS_RESOLVE_URL,
    async (payload) => {
      const resolved = await resolveWsUrl(true);
      if (!resolved.wsUrl) {
        return { ok: false, ...(resolved.error !== undefined && { error: resolved.error }) };
      }
      if (payload?.failedUrl && payload.failedUrl !== resolved.wsUrl) {
        log.info(
          'desktop',
          `ws endpoint moved → ${redactToken(resolved.wsUrl)} (was ${redactToken(payload.failedUrl)})`,
        );
      }
      return { ok: true, wsUrl: resolved.wsUrl };
    },
  );

  on<WsEpochHandshake, { ok: boolean; socketEpoch?: string }>(
    CHANNELS.WS_EPOCH_HANDSHAKE,
    (handshake) => {
      if (
        !handshake ||
        typeof handshake.socketEpoch !== 'string' ||
        !handshake.socketEpoch ||
        handshake.backgroundBootId !== backgroundBootId
      ) {
        return { ok: false };
      }
      if (handshake.socketEpoch !== activeLocalBrowserSocketEpoch) {
        // This is intentionally synchronous: offscreen does not receive the
        // acknowledgement until all lifecycle owners have dropped old state.
        activeLocalBrowserSocketEpoch = null;
        if (!invalidateLocalBrowserEpoch(handshake.socketEpoch)) return { ok: false };
        activeLocalBrowserSocketEpoch = handshake.socketEpoch;
      }
      return { ok: true, socketEpoch: handshake.socketEpoch };
    },
  );
}

// ─── Helper — fire-and-forget broadcast (used by some callers) ──────────────

/**
 * Internal helper exported for tests / debug. Most callers should use
 * `sendWs`, which awaits a structured response.
 */
export function broadcastWsControl(kind: string, payload: unknown): void {
  broadcast(kind, payload);
}
