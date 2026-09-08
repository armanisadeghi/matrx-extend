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
 *
 * THE CHANNEL IS `@ai-matrx/realtime`'s, NOT OURS (adopted 2026-09-07)
 * -------------------------------------------------------------------
 * This module used to hand-roll `supabase.channel(...)`: its own subscribe
 * promise, its own 10s join timeout, no reconnect at all (a dropped channel
 * stayed dropped until the next bootstrap tick), no dedup. All of that is the
 * package's job now — jittered reconnect with a stability reset, an ordered
 * handler queue, dedup, enforced teardown, diagnostics — and BOTH ends of this
 * bridge ride the same one, so a fix lands once.
 *
 * 🚨 The wire is UNCHANGED and must stay unchanged. The package normally wraps
 * every broadcast in the Matrx envelope (`{v, cid, eid, ts, data}`); this
 * channel declares `wire: {mode:"raw"}`, which sends the `BridgeEnvelope`
 * verbatim and never envelope-unwraps on the way in. That is what lets a NEW
 * extension build talk to an OLD frontend and vice versa — the two halves of
 * this bridge ship on independent release trains, and the wire is the only
 * thing holding them together. Contract:
 * common-docs/systems/clients/extension/CHANNELS.md §4.
 *
 * THE MANAGER IS THE REALM'S, NOT THIS MODULE'S. This file used to build its
 * own `createRealtimeManager`, which was a second manager (and therefore a
 * second write ledger) the moment anything else in the service worker wanted
 * realtime — the scheduler host does. `lib/realtime/host.ts` owns the one
 * manager for the worker realm and publishes it through the package's ambient
 * door; this module just asks for it. Its inert environment bridge lives there
 * too, with the reason: an MV3 worker has no visibility state to report and the
 * package must not guess one. Reconnect and backfill still work; they key on
 * the socket, not on visibility.
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
import { ensureRealtimeHost } from '@/lib/realtime/host';
import { defineChannelNamespace, type ChannelHandle } from '@ai-matrx/realtime';
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
const SUBSCRIBE_TIMEOUT_MS = 10_000;

/**
 * The channel's namespace. `foreignTopic` keeps the topic string exactly as the
 * frontend and every deployed build already use it — an `mx:` rename would put
 * this build in a room of one, with no error and no traffic on either side.
 */
const BRIDGE_CHANNEL = defineChannelNamespace({
  namespace: 'extension-bridge',
  parts: ['userId'],
  description:
    'matrx-extend ↔ matrx-frontend RPC bridge (foreign wire: this shape predates the Matrx envelope).',
  foreignTopic: 'matrx-extension-bridge',
});

// ─── Module state ───────────────────────────────────────────────────────────

interface ConnectionState {
  userId: string;
  channel: ChannelHandle;
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
      const topic = BRIDGE_CHANNEL.topic({ userId: user.id });

      let next: ConnectionState | null = null;

      // The join deferred is built BEFORE `open()`, because the package tells a
      // holder that joins a room another holder already joined synchronously,
      // out of `open()` — a status callback wired up afterwards would miss it.
      let settled = false;
      let resolveJoin: () => void = () => {};
      let rejectJoin: (err: Error) => void = () => {};
      const joined = new Promise<void>((resolve, reject) => {
        resolveJoin = resolve;
        rejectJoin = reject;
      });
      const joinTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        rejectJoin(new Error('subscribe timeout'));
      }, SUBSCRIBE_TIMEOUT_MS);
      const markJoined = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(joinTimer);
        resolveJoin();
      };

      const channel = ensureRealtimeHost(user.id).open({
        topic,
        // See the file header: the frontend and every deployed build read this
        // shape off the wire directly.
        wire: { mode: 'raw', acceptEchoFromSelf: true },
        broadcast: [
          {
            event: BROADCAST_EVENT_NAME,
            onMessage: ({ data }) => {
              const parsed = BroadcastPayloadSchema.safeParse(data);
              if (!parsed.success) {
                log.warn(
                  'frontend-bridge',
                  'broadcast: malformed payload',
                  parsed.error.format(),
                );
                return;
              }
              if (next) void routeBroadcastMessage(parsed.data, next);
            },
          },
        ],
        // Raw wire has no envelope `eid`, so this is what dedup keys on — one
        // request/reply is one message even if the socket redelivers it.
        eventKey: (_source, payload) => {
          const parsed = BroadcastPayloadSchema.safeParse(payload);
          return parsed.success
            ? `${parsed.data.direction}:${parsed.data.requestId}`
            : undefined;
        },
        // Nothing to re-read: this bridge is request/reply over an ephemeral
        // substrate, and a caller whose reply was lost in the gap already
        // learns about it through its own 30s timeout. Declared explicitly
        // rather than omitted, so the reason is on the record.
        onBackfill: () => {
          log.info('frontend-bridge', 'broadcast: rejoined — in-flight calls ride their own timeouts');
        },
        onStatusChange: (status) => {
          if (status === 'connected') markJoined();
        },
      });

      next = { userId: user.id, channel, pending: new Map() };
      if (channel.status() === 'connected') markJoined();

      try {
        await joined;
      } catch (err) {
        // `state` never got set, so nothing else can reach this handle — and a
        // handle nobody holds is a subscription nobody can close. Release it
        // here; the next `connectBroadcast()` opens a fresh one.
        channel.close();
        throw err;
      }

      state = next;
      log.success('frontend-bridge', `broadcast subscribed: ${topic}`);
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
  for (const [requestId, p] of s.pending) {
    clearTimeout(p.timer);
    p.resolve({
      ok: false,
      error: 'broadcast disconnected',
      requestId,
    });
  }
  s.pending.clear();
  // Enforced teardown lives in the package: `close()` releases this holder's
  // claim on the shared room and removes the underlying channel when it was
  // the last one. There is nothing left here to forget.
  s.channel.close();
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
  // Raw wire: this object is what lands on the socket, byte for byte.
  s.channel.send(BROADCAST_EVENT_NAME, outbound);
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
    s.channel.send(BROADCAST_EVENT_NAME, reply);
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
