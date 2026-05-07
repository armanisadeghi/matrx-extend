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
import { broadcast, send } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { ensureOffscreen } from '@/lib/stream/offscreen-proxy';

// ─── Types ──────────────────────────────────────────────────────────────────

export type WsState = 'open' | 'closed' | 'unknown';

interface WsStateMessage {
  state: WsState;
}

// ─── Module state ───────────────────────────────────────────────────────────

let lastKnownState: WsState = 'unknown';
const messageHandlers = new Set<(payload: unknown) => void>();
let listenerInstalled = false;

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Lazily ensure the offscreen document exists, then ask it to open the WS.
 * Idempotent — the offscreen-side handler tracks "is the WS already open?"
 * and no-ops if so.
 */
export async function connectWs(): Promise<void> {
  installRouterIfNeeded();
  await ensureOffscreen();
  try {
    await send<unknown, { ok: boolean }>(CHANNELS.WS_START, {});
    log.info('desktop', 'ws connectWs requested');
  } catch (err) {
    log.warn('desktop', 'ws connectWs failed', (err as Error).message);
  }
}

/**
 * Ask the offscreen-side WS to close. Does NOT tear down the offscreen
 * document — that's owned by the streaming subsystem.
 */
export async function disconnectWs(): Promise<void> {
  try {
    await send<unknown, { ok: boolean }>(CHANNELS.WS_STOP, {});
    log.info('desktop', 'ws disconnectWs requested');
  } catch (err) {
    log.warn('desktop', 'ws disconnectWs failed', (err as Error).message);
  }
  lastKnownState = 'closed';
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

// ─── Internal — SW message router ───────────────────────────────────────────

function installRouterIfNeeded(): void {
  if (listenerInstalled) return;
  listenerInstalled = true;

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
        }
        lastKnownState = next;
      }
      return false;
    }
    if (m.kind === CHANNELS.WS_MESSAGE) {
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
