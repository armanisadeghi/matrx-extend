/**
 * Offscreen-side WebSocket runtime (Phase 2 C2.a, C2.c).
 *
 * Runs INSIDE the offscreen document — that's where MV3 lets us hold
 * long-lived sockets. The SW proxy in `ws-client.ts` sends control envelopes
 * (WS_START / WS_STOP / WS_SEND) here and listens for the broadcasts we emit
 * (WS_STATE / WS_MESSAGE). The on-the-wire JSON format with matrx-local is
 * CONTRACTUAL — see the spec block below.
 *
 * Wire format (matrx-local ↔ extension):
 *
 *   engine → browser:
 *     { type: "extension.invoke", callId, toolName, args }
 *     { type: "pong", timestamp, engine_version, tool_catalog_hash }
 *
 *   browser → engine:
 *     { type: "extension.result", callId, ok: true,  result }
 *     { type: "extension.result", callId, ok: false, error, errorType? }
 *     { type: "ping", timestamp }
 *
 * Lifecycle:
 *   - Lazy connect on first WS_START or WS_SEND.
 *   - Heartbeat ping every 20s once open.
 *   - Reconnect with exponential backoff (1s, 2s, 4s, 8s, 16s, 30s), each
 *     attempt re-resolving the URL through the SW (the port and pair token
 *     move when the engine restarts). After the last delay, retries PAUSE —
 *     the SW's 30s desktop probe owns recovery from there.
 *   - Idle disconnect after 5 min with no inbound or outbound traffic.
 *   - On `tool_catalog_hash` change between consecutive pongs, broadcast
 *     `ws:catalog-stale` so the SW can refetch capabilities.
 */

import { log } from '@/lib/debug/log';
import { broadcast, on, send } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
// THE package formatters (`@ai-matrx/kit/format`, duplication census H1
// 2026-09-07): the fleet had ~35 duration, ~18 relative-time and ~20 byte-size
// twins with no correct owner until kit became one.
import { formatDurationMs } from '@ai-matrx/kit/format';
import { createBackoff, RECONNECT_ALARM_ATTEMPTS } from '@ai-matrx/realtime';

// ─── Constants ──────────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 20_000;
const IDLE_DISCONNECT_MS = 5 * 60_000;
const OPEN_TIMEOUT_MS = 5_000;
/**
 * Retries stop after the realtime package's sustained-outage threshold
 * (~1 minute of backoff).
 *
 * An unbounded loop is not resilience: with matrx-local simply not running —
 * the normal state for most people — it retried a dead address every 30s for
 * the life of the browser, logging a failure each time. The SW's desktop
 * probe alarm runs every 30s and reopens the socket the moment the engine is
 * reachable again, so giving up here costs no recovery time.
 */
const reconnectBackoff = createBackoff({ jitter: 0 });

// ─── Module state ───────────────────────────────────────────────────────────

interface RuntimeState {
  ws: WebSocket | null;
  /**
   * URL handed in via the most recent WS_START. Cached so reconnect
   * attempts after a close don't need a fresh round-trip to the SW —
   * the offscreen has no chrome.storage access of its own to re-resolve.
   */
  wsUrl: string | null;
  /**
   * Build identity handed in via WS_START, for the `extension.identify` frame.
   *
   * An offscreen document does NOT get the full `chrome.runtime` surface —
   * messaging works, `getManifest()` does not — so reading the manifest here
   * threw and killed the hello handler before it could reply. The SW has the
   * full API, so it supplies this the same way it supplies `wsUrl`.
   */
  identity: { extensionId: string; version: string; name: string } | null;
  /** When did we last see ANY traffic (in or out)? */
  lastActivityAt: number;
  /** Heartbeat interval id. */
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  /** Idle-watchdog interval id. */
  idleTimer: ReturnType<typeof setInterval> | null;
  /** In-flight reconnect timeout id. */
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  /** Most recent tool_catalog_hash seen on a pong. */
  lastCatalogHash: string | null;
  /** True once the runtime has been initialized (handlers wired). */
  initialized: boolean;
  /**
   * True when the user (or the SW) has explicitly asked us to STOP. While
   * this is true, we do not auto-reconnect on close.
   */
  stopped: boolean;
  /** Service-worker instance that most recently controlled this socket. */
  backgroundBootId: string | null;
  /** Epoch acknowledged by that service worker; local-browser frames gate on it. */
  acknowledgedEpoch: string | null;
}

interface LocalBrowserForward {
  __matrxLocalBrowserLifecycle: true;
  socketEpoch: string;
  payload: unknown;
}

const state: RuntimeState = {
  ws: null,
  wsUrl: null,
  identity: null,
  lastActivityAt: 0,
  heartbeatTimer: null,
  idleTimer: null,
  reconnectTimer: null,
  lastCatalogHash: null,
  initialized: false,
  stopped: false,
  backgroundBootId: null,
  acknowledgedEpoch: null,
};

// ─── Public bootstrap (called from offscreen entrypoints) ───────────────────

/**
 * Wire up SW-side message handlers. Idempotent.
 */
export function startWsOffscreenRuntime(): void {
  if (state.initialized) return;
  state.initialized = true;

  on<
    { wsUrl?: string; identity?: RuntimeState['identity']; backgroundBootId?: string },
    { ok: boolean; error?: string }
  >(CHANNELS.WS_START, async (payload) => {
    state.stopped = false;
    // A fresh START is a fresh retry budget — otherwise a bridge that came
    // back after a give-up would burn its first failure on a spent counter.
    reconnectBackoff.reset();
    if (payload?.wsUrl) state.wsUrl = payload.wsUrl;
    if (payload?.identity) state.identity = payload.identity;
    const backgroundChanged =
      typeof payload?.backgroundBootId === 'string' &&
      state.backgroundBootId !== null &&
      payload.backgroundBootId !== state.backgroundBootId;
    if (typeof payload?.backgroundBootId === 'string')
      state.backgroundBootId = payload.backgroundBootId;
    if (backgroundChanged) {
      // MV3 may retain this document while replacing the service worker.
      // The old epoch and any lifecycle binding belong to that old worker.
      closeWebSocket('background restarted');
      abandonConnectingAttempt();
    }
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      return { ok: true };
    }
    try {
      await openWebSocket();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  on<unknown, { ok: boolean }>(CHANNELS.WS_STOP, () => {
    state.stopped = true;
    closeWebSocket('stopped by request');
    return { ok: true };
  });

  on<unknown, { ok: boolean; error?: string }>(CHANNELS.WS_SEND, async (payload) => {
    state.stopped = false;
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
      try {
        await openWebSocket();
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    }
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
      return { ok: false, error: 'ws not open after connect attempt' };
    }
    const lifecycle = payload as Partial<LocalBrowserForward> | null;
    if (lifecycle?.__matrxLocalBrowserLifecycle === true) {
      if (
        typeof lifecycle.socketEpoch !== 'string' ||
        lifecycle.socketEpoch !== state.acknowledgedEpoch
      ) {
        return { ok: false, error: 'stale local-browser socket epoch' };
      }
    }
    const wirePayload =
      lifecycle?.__matrxLocalBrowserLifecycle === true ? lifecycle.payload : payload;
    try {
      state.ws.send(JSON.stringify(wirePayload));
      bumpActivity();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  log.info('desktop-ws-offscreen', 'runtime initialized');
}

// ─── WS lifecycle ───────────────────────────────────────────────────────────

let connectingPromise: Promise<void> | null = null;
let activeConnectingAttemptId: number | null = null;
let nextConnectingAttemptId = 0;
let connectingSocket: WebSocket | null = null;
let connectingBackgroundBootId: string | null = null;

function abandonConnectingAttempt(): void {
  // A new background boot owns a new connection attempt. The old promise may
  // settle later, but must never prevent or clear the new attempt.
  connectingPromise = null;
  activeConnectingAttemptId = null;
  connectingBackgroundBootId = null;
  const ws = connectingSocket;
  connectingSocket = null;
  if (ws) {
    try {
      ws.close(1000, 'connection attempt retired');
    } catch {
      /* ignore */
    }
  }
}

function redactToken(url: string): string {
  return url.replace(/([?&])token=[^&]+/, '$1token=***');
}

async function openWebSocket(): Promise<void> {
  if (connectingPromise) return connectingPromise;
  const attemptId = ++nextConnectingAttemptId;
  const attemptBackgroundBootId = state.backgroundBootId;
  const attempt = (async () => {
    try {
      const wsUrl = state.wsUrl;
      if (!wsUrl) {
        throw new Error('no wsUrl cached — caller must send WS_START with a resolved URL first');
      }
      const safeUrl = redactToken(wsUrl);
      log.info('desktop-ws-offscreen', `connecting → ${safeUrl}`);

      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const settle = (err: Error | null) => {
          if (settled) return;
          settled = true;
          if (err) reject(err);
          else resolve();
        };
        let ws: WebSocket;
        try {
          ws = new WebSocket(wsUrl);
        } catch (err) {
          settle(err as Error);
          return;
        }
        activeConnectingAttemptId = attemptId;
        connectingSocket = ws;
        connectingBackgroundBootId = attemptBackgroundBootId;

        const openTimeout = setTimeout(() => {
          // Nothing closed this socket, so it is still CONNECTING: the TCP
          // connect itself is hanging. That is exactly what a restarting
          // engine looks like — the desktop shell holds the port bound while
          // the sidecar is not yet accepting. Close it, or every backoff
          // round leaves another half-open socket behind.
          try {
            ws.close(1000, 'open timeout');
          } catch {
            /* ignore */
          }
          settle(
            new Error(
              `ws open timeout (${formatDurationMs(OPEN_TIMEOUT_MS, { style: 'compact' })}) — ${safeUrl} did not respond (engine restarting or not accepting)`,
            ),
          );
        }, OPEN_TIMEOUT_MS);

        ws.addEventListener('open', () => {
          clearTimeout(openTimeout);
          if (
            activeConnectingAttemptId !== attemptId ||
            connectingSocket !== ws ||
            connectingBackgroundBootId !== attemptBackgroundBootId ||
            state.backgroundBootId !== attemptBackgroundBootId
          ) {
            try {
              ws.close(1000, 'connection attempt retired');
            } catch {
              /* ignore */
            }
            settle(new Error('connection attempt retired'));
            return;
          }
          state.ws = ws;
          state.acknowledgedEpoch = null;
          // Keep the package's stability window. A socket that flaps after
          // opening must continue up the backoff ladder instead of repeatedly
          // retrying at the one-second floor.
          reconnectBackoff.markConnected();
          bumpActivity();
          const socketEpoch = crypto.randomUUID();
          void acknowledgeEpoch(
            ws,
            socketEpoch,
            attemptId,
            attemptBackgroundBootId,
            settle,
            openTimeout,
          );
        });

        ws.addEventListener('message', (ev) => {
          if (state.ws === ws) handleInboundFrame(ev.data, ws);
        });

        ws.addEventListener('close', (ev) => {
          clearTimeout(openTimeout);
          // A socket that dies BEFORE it opens never became `state.ws`, so
          // handleClose below does not run and nothing would announce the
          // failure. Say it anyway — the SW distinguishes an intentional
          // close from a failed one, and an unannounced failure left it
          // believing the last close was deliberate and refusing to reopen.
          if (state.ws !== ws) {
            broadcast<{ state: 'closed' }>(CHANNELS.WS_STATE, { state: 'closed' });
          }
          // Browsers redact WS handshake failure detail for security, so the
          // 'error' event arrives empty. The close event right after carries
          // the only signal we get: a numeric code (1006 = abnormal,
          // typically connection-refused or no listening server) and an
          // optional reason string when the server *does* speak the protocol
          // and rejects with text.
          const codeMeaning = wsCloseCodeHint(ev.code);
          if (state.ws === ws) handleClose(ev.code, ev.reason);
          settle(
            new Error(
              `ws closed before open: ${safeUrl} — code=${ev.code}${codeMeaning ? ` (${codeMeaning})` : ''}${ev.reason ? ` reason="${ev.reason}"` : ''}`,
            ),
          );
        });

        ws.addEventListener('error', () => {
          // The 'error' event itself is opaque (Event with no useful fields).
          // The 'close' event that always follows carries the diagnostic info.
          // Log a single hint here so it's clear the error fired.
          log.warn('desktop-ws-offscreen', `ws error during connect to ${safeUrl}`);
        });
      });
    } finally {
      if (activeConnectingAttemptId === attemptId) {
        connectingPromise = null;
        activeConnectingAttemptId = null;
        connectingSocket = null;
        connectingBackgroundBootId = null;
      }
    }
  })();
  connectingPromise = attempt;
  activeConnectingAttemptId = attemptId;
  return attempt;
}

function wsCloseCodeHint(code: number): string | null {
  // RFC 6455 + Chrome-specific behavior. 1006 is the one we'll see most
  // here — Chrome uses it whenever the TCP/TLS connection couldn't be
  // established or the WS handshake failed (404, wrong upgrade response,
  // server didn't speak websocket, etc.).
  switch (code) {
    case 1000:
      return 'normal closure';
    case 1001:
      return 'going away';
    case 1002:
      return 'protocol error';
    case 1003:
      return 'unsupported data';
    case 1006:
      return 'abnormal — engine likely refused, route missing, or not running';
    case 1008:
      return 'policy violation';
    case 1011:
      return 'server error';
    case 1015:
      return 'tls handshake failure';
    default:
      return null;
  }
}

function closeWebSocket(reason: string): void {
  stopHeartbeat();
  stopIdleWatchdog();
  cancelReconnect();
  // The SW must be able to tell an INTENTIONAL close from a failure: it
  // reopens a dead socket on its 30s alarm, and without this it reopened
  // the one the idle watchdog had just retired — a permanent close/open
  // cycle every five and a half minutes for anyone running matrx-local.
  const intentional = reason === 'idle' || reason === 'stopped by request';
  if (state.ws) {
    const ws = state.ws;
    const socketEpoch = state.acknowledgedEpoch;
    // Clear ownership before closing so a synchronous or late close event
    // from the retired socket cannot schedule a reconnect for its epoch.
    state.ws = null;
    try {
      ws.close(1000, reason);
    } catch {
      /* ignore */
    }
    state.acknowledgedEpoch = null;
    broadcast<{ state: 'closed'; socketEpoch?: string; intentional?: boolean }>(CHANNELS.WS_STATE, {
      state: 'closed',
      ...(socketEpoch !== null && { socketEpoch }),
      ...(intentional && { intentional: true }),
    });
    abandonConnectingAttempt();
    return;
  }
  state.acknowledgedEpoch = null;
  abandonConnectingAttempt();
  broadcast<{ state: 'closed'; intentional?: boolean }>(CHANNELS.WS_STATE, {
    state: 'closed',
    ...(intentional && { intentional: true }),
  });
}

function handleClose(code: number, reason: string): void {
  log.info('desktop-ws-offscreen', `ws close ${code} ${reason}`);
  stopHeartbeat();
  const socketEpoch = state.acknowledgedEpoch;
  state.ws = null;
  state.acknowledgedEpoch = null;
  broadcast<{ state: 'closed'; socketEpoch?: string }>(CHANNELS.WS_STATE, {
    state: 'closed',
    ...(socketEpoch !== null && { socketEpoch }),
  });
  if (state.stopped) return;

  queueReconnect();
}

/**
 * Back off, re-resolve, retry — then give up and let the SW take over.
 *
 * The give-up is deliberate. The offscreen cannot fix an engine that is not
 * running; the service worker's 30s desktop probe re-opens the socket as
 * soon as `/health` answers again (bootstrap.ts, DESKTOP_PROBE).
 */
function queueReconnect(): void {
  if (state.stopped) return;
  if (reconnectBackoff.attempts() >= RECONNECT_ALARM_ATTEMPTS) {
    // Nothing fails silently: say what stopped, and what resumes it.
    log.info(
      'desktop-ws-offscreen',
      `desktop bridge unreachable after ${reconnectBackoff.attempts()} attempts — pausing retries; the service worker reopens it within 30s of the engine answering /health`,
    );
    reconnectBackoff.reset();
    state.stopped = true;
    return;
  }
  const delay = reconnectBackoff.nextDelayMs();
  log.info(
    'desktop-ws-offscreen',
    `reconnect attempt #${reconnectBackoff.attempts()} in ${delay}ms`,
  );
  cancelReconnect();
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    if (state.stopped) return;
    void reconnectOnce();
  }, delay);
}

async function reconnectOnce(): Promise<void> {
  // Re-resolve BEFORE retrying. The cached URL carries a discovered port and
  // a pair token; an engine that restarted may be on a different port in the
  // 22140-22159 scan range, and replaying the old address can only ever fail.
  // This is the same self-heal the HTTP transport performs (http.ts: drop the
  // port cache, re-pair on 401) — the socket path had no equivalent, which is
  // why a restarted engine left the bridge down until the browser restarted.
  const refreshed = await refreshWsUrl();
  if (!refreshed) {
    // Engine genuinely unreachable (discovery found nothing). Count it as an
    // attempt and back off rather than hammering a dead address.
    queueReconnect();
    return;
  }
  try {
    await openWebSocket();
  } catch (err) {
    // Expected while the desktop app is closed or restarting — info, not a
    // warning with a stack. The give-up line above is the one that matters.
    log.info('desktop-ws-offscreen', `reconnect failed: ${(err as Error).message}`);
    if (!state.ws) queueReconnect();
  }
}

/**
 * Ask the SW for a fresh ws URL. The offscreen document has no
 * chrome.storage, so discovery and the pair token are only readable there.
 * Returns false when the engine cannot be resolved at all.
 */
async function refreshWsUrl(): Promise<boolean> {
  try {
    const res = await send<{ failedUrl: string | null }, { ok: boolean; wsUrl?: string }>(
      CHANNELS.WS_RESOLVE_URL,
      { failedUrl: state.wsUrl },
    );
    if (res?.ok === true && typeof res.wsUrl === 'string' && res.wsUrl.length > 0) {
      state.wsUrl = res.wsUrl;
      return true;
    }
    return false;
  } catch {
    // The service worker is asleep or mid-restart. Fall back to the cached
    // URL — it is usually still right, and a stale one just fails a retry.
    return state.wsUrl !== null;
  }
}

function cancelReconnect(): void {
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
}

// ─── Inbound frame handling ─────────────────────────────────────────────────

async function acknowledgeEpoch(
  ws: WebSocket,
  socketEpoch: string,
  attemptId: number,
  attemptBackgroundBootId: string | null,
  settle: (err: Error | null) => void,
  openTimeout: ReturnType<typeof setTimeout>,
): Promise<void> {
  try {
    const ack = await send<
      { socketEpoch: string; backgroundBootId: string | null },
      { ok: boolean; socketEpoch?: string }
    >(CHANNELS.WS_EPOCH_HANDSHAKE, { socketEpoch, backgroundBootId: attemptBackgroundBootId });
    if (
      state.ws !== ws ||
      activeConnectingAttemptId !== attemptId ||
      connectingSocket !== ws ||
      connectingBackgroundBootId !== attemptBackgroundBootId ||
      state.backgroundBootId !== attemptBackgroundBootId ||
      ack?.ok !== true ||
      ack.socketEpoch !== socketEpoch
    ) {
      throw new Error('socket epoch acknowledgement rejected');
    }
    state.acknowledgedEpoch = socketEpoch;
    ws.send(JSON.stringify({ type: 'local_browser.ready', version: 1 }));
    bumpActivity();
    startHeartbeat();
    startIdleWatchdog();
    broadcast<{ state: 'open' }>(CHANNELS.WS_STATE, { state: 'open' });
    log.success('desktop-ws-offscreen', 'ws open');
    settle(null);
  } catch (err) {
    clearTimeout(openTimeout);
    if (state.ws === ws) {
      state.acknowledgedEpoch = null;
      try {
        ws.close(1000, 'epoch acknowledgement failed');
      } catch {
        /* ignore */
      }
    }
    settle(err as Error);
  }
}

function isLocalBrowserFrame(payload: unknown): boolean {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as { type?: unknown }).type === 'string' &&
    (payload as { type: string }).type.startsWith('local_browser.')
  );
}

function handleInboundFrame(raw: unknown, socket: WebSocket): void {
  bumpActivity();
  let payload: unknown;
  if (typeof raw === 'string') {
    try {
      payload = JSON.parse(raw);
    } catch {
      log.warn('desktop-ws-offscreen', 'ws frame: non-JSON, ignoring', raw);
      return;
    }
  } else {
    log.warn('desktop-ws-offscreen', 'ws frame: non-string, ignoring');
    return;
  }

  // Intercept pong to track engine_version + tool_catalog_hash. We still
  // forward to the SW so it can observe heartbeat liveness.
  if (payload && typeof payload === 'object' && (payload as { type?: unknown }).type === 'pong') {
    const pong = payload as { tool_catalog_hash?: unknown };
    const hash = typeof pong.tool_catalog_hash === 'string' ? pong.tool_catalog_hash : null;
    if (hash !== null && state.lastCatalogHash !== null && hash !== state.lastCatalogHash) {
      log.info('desktop-ws-offscreen', 'tool_catalog_hash changed → SW refetch');
      broadcast(CHANNELS.WS_MESSAGE, { type: 'ws.catalog-stale' });
    }
    if (hash !== null) state.lastCatalogHash = hash;
    // fall through — also forward the raw pong
  }

  if (payload && typeof payload === 'object' && (payload as { type?: unknown }).type === 'hello') {
    // Chrome does not expose a profile identifier to extensions. Runtime ID
    // and manifest version still let Matrx Local distinguish live builds and
    // avoid presenting a server-generated session UUID as an identity.
    //
    // The identity comes from the SW via WS_START — NOT from
    // chrome.runtime.getManifest(), which does not exist in an offscreen
    // document and threw here, aborting the handler before it could reply.
    const identity = state.identity;
    if (!identity) {
      // Loud: Matrx Local silently attributing frames to an unknown build is
      // exactly what this handshake exists to prevent.
      log.warn(
        'desktop-ws-offscreen',
        'hello received before WS_START supplied build identity — skipping extension.identify',
      );
    } else {
      try {
        state.ws?.send(
          JSON.stringify({
            type: 'extension.identify',
            extension_id: identity.extensionId,
            extension_version: identity.version,
            extension_name: identity.name,
          }),
        );
        bumpActivity();
      } catch (err) {
        log.warn('desktop-ws-offscreen', 'failed to send extension identity', err);
      }
    }
  }

  if (isLocalBrowserFrame(payload)) {
    const socketEpoch = state.acknowledgedEpoch;
    if (!socketEpoch || state.ws !== socket) return;
    broadcast(CHANNELS.WS_MESSAGE, {
      __matrxLocalBrowserLifecycle: true,
      socketEpoch,
      payload,
    });
    return;
  }

  broadcast(CHANNELS.WS_MESSAGE, payload);
}

// ─── Heartbeat ──────────────────────────────────────────────────────────────

function startHeartbeat(): void {
  stopHeartbeat();
  state.heartbeatTimer = setInterval(() => {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    try {
      state.ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
    } catch (err) {
      log.warn('desktop-ws-offscreen', 'heartbeat send failed', err);
    }
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat(): void {
  if (state.heartbeatTimer) {
    clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = null;
  }
}

// ─── Idle watchdog ──────────────────────────────────────────────────────────

function startIdleWatchdog(): void {
  stopIdleWatchdog();
  state.idleTimer = setInterval(() => {
    const idleFor = Date.now() - state.lastActivityAt;
    if (idleFor >= IDLE_DISCONNECT_MS) {
      log.info(
        'desktop-ws-offscreen',
        `idle for ${formatDurationMs(idleFor, { style: 'long' })} — disconnecting`,
      );
      // Mark as stopped so we don't auto-reconnect. The next outbound send
      // reopens it (WS_SEND clears `stopped`); the SW's probe alarm does
      // NOT, because closeWebSocket reports this close as intentional.
      state.stopped = true;
      closeWebSocket('idle');
    }
  }, 30_000);
}

function stopIdleWatchdog(): void {
  if (state.idleTimer) {
    clearInterval(state.idleTimer);
    state.idleTimer = null;
  }
}

function bumpActivity(): void {
  state.lastActivityAt = Date.now();
}
