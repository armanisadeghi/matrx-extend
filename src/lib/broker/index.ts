/**
 * Token broker client — THE primitive for scoped short-lived credentials.
 *
 * Every consumer in this repo (voice sessions, direct provider calls, any
 * future audience) goes through `getBrokeredCredential` / `callProxiedJson`.
 * Never hand-roll a mint call, a cache, or a gateway URL.
 *
 * Topology: the CANONICAL cache lives in the background service worker.
 * - In the SW, these functions hit the cache directly.
 * - In any other context (sidepanel, offscreen, popup), they transparently
 *   route through the SW via the messaging bus, so all contexts share one
 *   cache and tokens live primarily in SW memory. A consumer that genuinely
 *   needs the raw token in its own context (e.g. a WebRTC session in the
 *   offscreen document) receives it in memory only — NEVER persist it.
 *
 * Cross-repo contract: /Users/armanisadeghi/code/common-docs/token-broker/FEATURE.md
 * Repo skill: .claude/skills/token-broker-client/SKILL.md
 */

import { send } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import {
  clearCredentialCache,
  getCredentialCached,
  invalidateCredential,
  snapshotCredentialCache,
} from './cache';
import { brokeredFetch } from './transport';
import type {
  BrokerCacheEntrySnapshot,
  BrokerResult,
  BrokeredCredential,
  MintOptions,
  TierPolicy,
} from './types';

export type {
  BrokerCacheEntrySnapshot,
  BrokerResult,
  BrokeredCredential,
  BrokeredGrant,
  CredentialMode,
  MintOptions,
  TierPolicy,
} from './types';
export { nativeConnectionInfo, brokeredFetch } from './transport';
export type { NativeConnectionInfo } from './transport';

/** Wire payloads for the SW broker channels (see schemas.ts). */
export interface BrokerMintMessage {
  audience: string;
  tierPolicy: TierPolicy;
  opts?: MintOptions;
}
export interface BrokerInvalidateMessage {
  audience: string;
  tierPolicy: TierPolicy;
  model?: string;
}
export interface BrokerProxiedJsonMessage {
  audience: string;
  tierPolicy: TierPolicy;
  body: unknown;
  headers?: Record<string, string>;
  model?: string;
}
export interface BrokerProxiedJsonResult {
  ok: boolean;
  status: number;
  /** Parsed JSON body on success; error text otherwise. */
  data?: unknown;
  error?: string;
  /** The model the request was sent with, for tier-swap visibility. */
  requestedModel?: string;
}

/** True in the MV3 background service worker (no `window` there). */
function isServiceWorkerContext(): boolean {
  return typeof window === 'undefined';
}

/**
 * Get a valid brokered credential (cached / refreshed-ahead / minted).
 * `tierPolicy` is REQUIRED and explicit — the broker contract forbids a
 * default at every layer.
 */
export async function getBrokeredCredential(
  audience: string,
  tierPolicy: TierPolicy,
  opts: MintOptions = {},
): Promise<BrokerResult<BrokeredCredential>> {
  if (isServiceWorkerContext()) {
    return getCredentialCached(audience, tierPolicy, opts);
  }
  return send<BrokerMintMessage, BrokerResult<BrokeredCredential>>(CHANNELS.BROKER_MINT, {
    audience,
    tierPolicy,
    opts,
  });
}

/** Drop a cached credential (endpoint rejected it / consumer saw a 401). */
export async function invalidateBrokeredCredential(
  audience: string,
  tierPolicy: TierPolicy,
  model?: string,
): Promise<void> {
  if (isServiceWorkerContext()) {
    invalidateCredential(audience, tierPolicy, model);
    return;
  }
  await send<BrokerInvalidateMessage, { ok: boolean }>(CHANNELS.BROKER_INVALIDATE, {
    audience,
    tierPolicy,
    ...(model !== undefined ? { model } : {}),
  });
}

/** Token-free view of the SW cache for the demo/debug UI. */
export async function getBrokerCacheSnapshot(): Promise<BrokerCacheEntrySnapshot[]> {
  if (isServiceWorkerContext()) {
    return snapshotCredentialCache();
  }
  return send<Record<string, never>, BrokerCacheEntrySnapshot[]>(CHANNELS.BROKER_SNAPSHOT, {});
}

/** Sign-out hook — grants belong to the previous user. SW-context only. */
export function clearBrokerCache(): void {
  clearCredentialCache();
}

/**
 * One-shot JSON call through a PROXIED credential, with the standard
 * failure policy baked in: on 401 from the gateway, invalidate + re-mint
 * ONCE, then fail loudly. Runs in the SW (routed automatically), so the
 * token never leaves the service worker for this path.
 *
 * For streaming (SSE) consumers, use `getBrokeredCredential` +
 * `brokeredFetch` directly in the context that owns the stream.
 */
export async function callProxiedJson(
  msg: BrokerProxiedJsonMessage,
): Promise<BrokerProxiedJsonResult> {
  if (!isServiceWorkerContext()) {
    return send<BrokerProxiedJsonMessage, BrokerProxiedJsonResult>(
      CHANNELS.BROKER_PROXIED_JSON,
      msg,
    );
  }
  return callProxiedJsonInSw(msg);
}

/** SW-side implementation of the proxied JSON call (also the message handler). */
export async function callProxiedJsonInSw(
  msg: BrokerProxiedJsonMessage,
): Promise<BrokerProxiedJsonResult> {
  const mintOpts: MintOptions = msg.model !== undefined ? { model: msg.model } : {};
  const first = await getCredentialCached(msg.audience, msg.tierPolicy, mintOpts);
  if (!first.ok) return { ok: false, status: first.status, error: first.error };

  const attempt = async (cred: BrokeredCredential): Promise<BrokerProxiedJsonResult> => {
    let res: Response;
    try {
      res = await brokeredFetch(cred, {
        body: msg.body,
        ...(msg.headers !== undefined ? { headers: msg.headers } : {}),
      });
    } catch (err) {
      return { ok: false, status: 0, error: (err as Error).message };
    }
    const text = await res.text().catch(() => '');
    if (!res.ok) return { ok: false, status: res.status, error: text || res.statusText };
    try {
      return { ok: true, status: res.status, data: JSON.parse(text) };
    } catch {
      return { ok: true, status: res.status, data: text };
    }
  };

  let result = await attempt(first.data);
  if (!result.ok && result.status === 401) {
    // Grant rejected — one re-mint, then fail loudly. Never loop.
    invalidateCredential(msg.audience, msg.tierPolicy, msg.model);
    const fresh = await getCredentialCached(msg.audience, msg.tierPolicy, {
      ...mintOpts,
      forceFresh: true,
    });
    if (!fresh.ok) return { ok: false, status: fresh.status, error: fresh.error };
    result = await attempt(fresh.data);
  }
  return result;
}
