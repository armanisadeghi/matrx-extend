/**
 * Supabase Broadcast subscriber for the FRONTEND_RPC bridge (Phase 2 C1.c).
 *
 * The matrx-frontend admin app at aimatrx.com publishes FRONTEND_RPC
 * envelopes onto a per-user Realtime channel:
 *
 *   matrx-extension-bridge:<userId>
 *
 * with a payload of the form:
 *
 *   {
 *     direction: "frontend->extension" | "extension->frontend",
 *     action,
 *     requestId,
 *     payload,
 *     timestamp
 *   }
 *
 * The extension listens on the same channel, filters for
 * `direction: "frontend->extension"` envelopes, routes them through
 * `handleFrontendRpc`, and re-publishes the result with
 * `direction: "extension->frontend"` and the same `requestId` so the
 * frontend can correlate.
 *
 * Extension-initiated outbound calls (`publishToFrontend`) work the
 * inverse: publish `extension->frontend`, await the matching
 * `frontend->extension` reply.
 */

import { getCurrentUser } from '@/lib/auth/flow';
import { recordBridgeTraffic } from '@/lib/debug/bridge-traffic';
import { log } from '@/lib/debug/log';
import {
  FRONTEND_RPC_CHANNEL,
  type FrontendRpcEnvelope,
  FrontendRpcEnvelopeSchema,
  type FrontendRpcResponse,
  handleFrontendRpc,
} from '@/lib/frontend-bridge/handler';
import { getSupabase } from '@/lib/supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { z } from 'zod';

// ─── Wire format (CONTRACTUAL — must match frontend) ────────────────────────

const BroadcastPayloadSchema = z.object({
  direction: z.union([z.literal('frontend->extension'), z.literal('extension->frontend')]),
  action: z.string().min(1),
  requestId: z.string().min(1),
  payload: z.unknown().optional(),
  timestamp: z.number(),
});
type BroadcastPayload = z.infer<typeof BroadcastPayloadSchema>;

// Supabase Broadcast filters delivery by the `event` field, so this MUST
// byte-match the frontend's `BRIDGE_BROADCAST_EVENT`
// (matrx-frontend: lib/types/bridge-envelope.ts). It previously read 'rpc',
// which silently dropped every cross-machine envelope — both sides shared
// the channel but listened on different events. Keep these in lockstep.
const BROADCAST_EVENT_NAME = 'FRONTEND_RPC';
const OUTBOUND_TIMEOUT_MS = 30_000;

// ─── Module state ───────────────────────────────────────────────────────────

interface ConnectionState {
  userId: string;
  channel: RealtimeChannel;
  /** Outstanding outbound calls keyed by requestId. */
  pending: Map<string, PendingOutbound>;
}

interface PendingOutbound {
  resolve: (r: FrontendRpcResponse) => void;
  timer: ReturnType<typeof setTimeout>;
}

let state: ConnectionState | null = null;
let connecting: Promise<void> | null = null;

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Open the per-user Broadcast channel and start routing inbound envelopes.
 *
 * Idempotent: if already connected, no-op. Failures are logged as warnings,
 * not thrown — Broadcast is a best-effort substrate.
 */
export async function connectBroadcast(): Promise<void> {
  if (state) return;
  if (connecting) return connecting;

  connecting = (async () => {
    try {
      const user = await getCurrentUser();
      if (!user?.id) {
        log.info('frontend-bridge', 'broadcast: no auth — skipping subscribe');
        return;
      }
      const channelName = `matrx-extension-bridge:${user.id}`;
      const supabase = getSupabase();
      const channel = supabase.channel(channelName, {
        config: {
          broadcast: { self: false, ack: false },
          presence: { key: '' },
        },
      });

      const next: ConnectionState = {
        userId: user.id,
        channel,
        pending: new Map(),
      };

      channel.on('broadcast', { event: BROADCAST_EVENT_NAME }, (msg) => {
        // Realtime delivers the published payload under `payload` for the
        // 'broadcast' event type (see Supabase Realtime docs).
        const raw = (msg as { payload?: unknown }).payload;
        const parsed = BroadcastPayloadSchema.safeParse(raw);
        if (!parsed.success) {
          log.warn('frontend-bridge', 'broadcast: malformed payload', parsed.error.format());
          return;
        }
        void routeBroadcastMessage(parsed.data, next);
      });

      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const settle = (err: Error | null) => {
          if (settled) return;
          settled = true;
          if (err) reject(err);
          else resolve();
        };
        const timer = setTimeout(() => settle(new Error('subscribe timeout')), 10_000);
        channel.subscribe((status, error) => {
          if (status === 'SUBSCRIBED') {
            clearTimeout(timer);
            settle(null);
          } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            clearTimeout(timer);
            settle(error ?? new Error(`subscribe failed: ${status}`));
          }
        });
      });

      state = next;
      log.success('frontend-bridge', `broadcast subscribed: ${channelName}`);
    } catch (err) {
      log.warn('frontend-bridge', 'broadcast: connect failed', (err as Error).message);
    } finally {
      connecting = null;
    }
  })();

  return connecting;
}

/**
 * Close the channel and clear pending outbound calls.
 */
export async function disconnectBroadcast(): Promise<void> {
  const s = state;
  state = null;
  if (!s) return;
  for (const [, p] of s.pending) {
    clearTimeout(p.timer);
    p.resolve({
      ok: false,
      error: 'broadcast disconnected',
      requestId: '',
    });
  }
  s.pending.clear();
  try {
    await s.channel.unsubscribe();
  } catch (err) {
    log.warn('frontend-bridge', 'broadcast: unsubscribe failed', (err as Error).message);
  }
  try {
    await getSupabase().removeChannel(s.channel);
  } catch {
    /* already removed */
  }
  log.info('frontend-bridge', 'broadcast disconnected');
}

/**
 * Publish an outbound envelope (extension → frontend) and resolve when the
 * matching response arrives. Times out after 30s.
 *
 * Returns BOTH the requestId and the promise so callers can correlate logs
 * with the in-flight call.
 */
export async function publishToFrontend(
  action: string,
  payload: unknown,
): Promise<{ requestId: string; promise: Promise<FrontendRpcResponse> }> {
  if (!state) {
    // Try connecting opportunistically — the SW may have just rehydrated
    // auth and not yet ticked the connectBroadcast hook.
    await connectBroadcast();
  }
  const s = state;
  const requestId = generateRequestId();
  if (!s) {
    return {
      requestId,
      promise: Promise.resolve<FrontendRpcResponse>({
        ok: false,
        error: 'broadcast not connected',
        requestId,
      }),
    };
  }

  const promise = new Promise<FrontendRpcResponse>((resolve) => {
    const timer = setTimeout(() => {
      s.pending.delete(requestId);
      resolve({
        ok: false,
        error: `broadcast: outbound ${action} timed out after ${OUTBOUND_TIMEOUT_MS}ms`,
        requestId,
      });
    }, OUTBOUND_TIMEOUT_MS);
    s.pending.set(requestId, { resolve, timer });
  });

  const outbound: BroadcastPayload = {
    direction: 'extension->frontend',
    action,
    requestId,
    payload,
    timestamp: Date.now(),
  };
  try {
    await s.channel.send({
      type: 'broadcast',
      event: BROADCAST_EVENT_NAME,
      payload: outbound,
    });
  } catch (err) {
    const pending = s.pending.get(requestId);
    if (pending) {
      clearTimeout(pending.timer);
      s.pending.delete(requestId);
      pending.resolve({
        ok: false,
        error: `broadcast: send failed — ${(err as Error).message}`,
        requestId,
      });
    }
  }
  return { requestId, promise };
}

// ─── Internal routing ───────────────────────────────────────────────────────

async function routeBroadcastMessage(msg: BroadcastPayload, s: ConnectionState): Promise<void> {
  if (msg.direction === 'extension->frontend') {
    // This is our own outbound — Supabase shouldn't echo it (self:false),
    // but if it does, ignore it.
    return;
  }
  if (msg.direction === 'frontend->extension') {
    // Two cases:
    //   1. The frontend is initiating an RPC — treat as a request, route
    //      through handleFrontendRpc, publish the response.
    //   2. The frontend is REPLYING to one of our outbound publishToFrontend
    //      calls — match by requestId in s.pending.
    const pending = s.pending.get(msg.requestId);
    if (pending) {
      clearTimeout(pending.timer);
      s.pending.delete(msg.requestId);
      // Frontend's reply-shape is the standard FrontendRpcResponse — but
      // the payload field carries the response body. We re-wrap.
      const replyPayload = (msg.payload ?? {}) as Record<string, unknown>;
      if (replyPayload.ok === true) {
        pending.resolve({
          ok: true,
          result: replyPayload.result,
          requestId: msg.requestId,
        });
      } else {
        pending.resolve({
          ok: false,
          error: typeof replyPayload.error === 'string' ? replyPayload.error : 'no error',
          requestId: msg.requestId,
        });
      }
      return;
    }

    // Inbound RPC request from the frontend.
    const envelope: FrontendRpcEnvelope = {
      channel: FRONTEND_RPC_CHANNEL,
      action: msg.action,
      payload: msg.payload,
      requestId: msg.requestId,
    };
    const validated = FrontendRpcEnvelopeSchema.safeParse(envelope);
    if (!validated.success) {
      log.warn('frontend-bridge', 'broadcast: invalid envelope', validated.error.format());
      return;
    }
    // Per-user channel name implies authenticated origin (Supabase RLS
    // gates the publish), so we don't pass a sender URL here.
    const response = await handleFrontendRpc(validated.data, {});

    // Optional Debug-tab buffer (no-op when disabled).
    recordBridgeTraffic({
      stream: 'broadcast',
      direction: 'in',
      action: msg.action,
      requestId: msg.requestId,
      sender: `broadcast:${s.userId}`,
      payload: msg.payload,
      response,
      ok: response.ok,
      ...(!response.ok && { error: response.error }),
    });

    const reply: BroadcastPayload = {
      direction: 'extension->frontend',
      action: msg.action,
      requestId: msg.requestId,
      payload: response,
      timestamp: Date.now(),
    };
    try {
      await s.channel.send({
        type: 'broadcast',
        event: BROADCAST_EVENT_NAME,
        payload: reply,
      });
    } catch (err) {
      log.warn(
        'frontend-bridge',
        `broadcast: reply send failed (req=${msg.requestId})`,
        (err as Error).message,
      );
    }
  }
}

function generateRequestId(): string {
  // crypto.randomUUID is available in MV3 service workers and offscreen.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback (vanishingly unlikely path).
  return `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
