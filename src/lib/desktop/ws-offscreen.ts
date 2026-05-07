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
 *   - Reconnect with exponential backoff (1s, 2s, 4s, 8s, 16s, 30s cap).
 *   - Idle disconnect after 5 min with no inbound or outbound traffic.
 *   - On `tool_catalog_hash` change between consecutive pongs, broadcast
 *     `ws:catalog-stale` so the SW can refetch capabilities.
 */

import { log } from '@/lib/debug/log';
import { broadcast, on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';

// ─── Constants ──────────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 20_000;
const IDLE_DISCONNECT_MS = 5 * 60_000;
const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const;

// ─── Module state ───────────────────────────────────────────────────────────

interface RuntimeState {
  ws: WebSocket | null;
  /**
   * URL handed in via the most recent WS_START. Cached so reconnect
   * attempts after a close don't need a fresh round-trip to the SW —
   * the offscreen has no chrome.storage access of its own to re-resolve.
   */
  wsUrl: string | null;
  /** When did we last see ANY traffic (in or out)? */
  lastActivityAt: number;
  /** Heartbeat interval id. */
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  /** Idle-watchdog interval id. */
  idleTimer: ReturnType<typeof setInterval> | null;
  /** Reconnect attempt index into RECONNECT_DELAYS_MS. */
  reconnectAttempt: number;
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
}

const state: RuntimeState = {
  ws: null,
  wsUrl: null,
  lastActivityAt: 0,
  heartbeatTimer: null,
  idleTimer: null,
  reconnectAttempt: 0,
  reconnectTimer: null,
  lastCatalogHash: null,
  initialized: false,
  stopped: false,
};

// ─── Public bootstrap (called from offscreen entrypoints) ───────────────────

/**
 * Wire up SW-side message handlers. Idempotent.
 */
export function startWsOffscreenRuntime(): void {
  if (state.initialized) return;
  state.initialized = true;

  on<{ wsUrl?: string }, { ok: boolean; error?: string }>(
    CHANNELS.WS_START,
    async (payload) => {
      state.stopped = false;
      if (payload?.wsUrl) state.wsUrl = payload.wsUrl;
      if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        return { ok: true };
      }
      try {
        await openWebSocket();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

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
    try {
      state.ws.send(JSON.stringify(payload));
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

function redactToken(url: string): string {
  return url.replace(/([?&])token=[^&]+/, '$1token=***');
}

async function openWebSocket(): Promise<void> {
  if (connectingPromise) return connectingPromise;
  connectingPromise = (async () => {
    try {
      const wsUrl = state.wsUrl;
      if (!wsUrl) {
        throw new Error(
          'no wsUrl cached — caller must send WS_START with a resolved URL first',
        );
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

        const openTimeout = setTimeout(
          () => settle(new Error(`ws open timeout (5s) — ${safeUrl} did not respond`)),
          5_000,
        );

        ws.addEventListener('open', () => {
          clearTimeout(openTimeout);
          state.ws = ws;
          state.reconnectAttempt = 0;
          bumpActivity();
          startHeartbeat();
          startIdleWatchdog();
          broadcast<{ state: 'open' }>(CHANNELS.WS_STATE, { state: 'open' });
          log.success('desktop-ws-offscreen', 'ws open');
          settle(null);
        });

        ws.addEventListener('message', (ev) => {
          handleInboundFrame(ev.data);
        });

        ws.addEventListener('close', (ev) => {
          clearTimeout(openTimeout);
          // Browsers redact WS handshake failure detail for security, so the
          // 'error' event arrives empty. The close event right after carries
          // the only signal we get: a numeric code (1006 = abnormal,
          // typically connection-refused or no listening server) and an
          // optional reason string when the server *does* speak the protocol
          // and rejects with text.
          const codeMeaning = wsCloseCodeHint(ev.code);
          handleClose(ev.code, ev.reason);
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
      connectingPromise = null;
    }
  })();
  return connectingPromise;
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
  if (state.ws) {
    try {
      state.ws.close(1000, reason);
    } catch {
      /* ignore */
    }
    state.ws = null;
  }
  broadcast<{ state: 'closed' }>(CHANNELS.WS_STATE, { state: 'closed' });
}

function handleClose(code: number, reason: string): void {
  log.info('desktop-ws-offscreen', `ws close ${code} ${reason}`);
  stopHeartbeat();
  state.ws = null;
  broadcast<{ state: 'closed' }>(CHANNELS.WS_STATE, { state: 'closed' });
  if (state.stopped) return;

  // Schedule reconnect with exponential backoff.
  const delayIdx = Math.min(state.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1);
  const delay = RECONNECT_DELAYS_MS[delayIdx] ?? RECONNECT_DELAYS_MS[RECONNECT_DELAYS_MS.length - 1] ?? 30_000;
  state.reconnectAttempt += 1;
  log.info(
    'desktop-ws-offscreen',
    `reconnect attempt #${state.reconnectAttempt} in ${delay}ms`,
  );
  cancelReconnect();
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    if (state.stopped) return;
    void openWebSocket().catch((err) => {
      log.warn('desktop-ws-offscreen', 'reconnect openWebSocket failed', err);
    });
  }, delay);
}

function cancelReconnect(): void {
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
}

// ─── Inbound frame handling ─────────────────────────────────────────────────

function handleInboundFrame(raw: unknown): void {
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
  if (
    payload &&
    typeof payload === 'object' &&
    (payload as { type?: unknown }).type === 'pong'
  ) {
    const pong = payload as { tool_catalog_hash?: unknown };
    const hash =
      typeof pong.tool_catalog_hash === 'string' ? pong.tool_catalog_hash : null;
    if (hash !== null && state.lastCatalogHash !== null && hash !== state.lastCatalogHash) {
      log.info('desktop-ws-offscreen', 'tool_catalog_hash changed → SW refetch');
      broadcast(CHANNELS.WS_MESSAGE, { type: 'ws.catalog-stale' });
    }
    if (hash !== null) state.lastCatalogHash = hash;
    // fall through — also forward the raw pong
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
        `idle for ${Math.round(idleFor / 1000)}s — disconnecting`,
      );
      // Mark as stopped so we don't auto-reconnect; the SW will reopen
      // on next outbound send.
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
