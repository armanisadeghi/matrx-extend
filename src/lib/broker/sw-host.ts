/**
 * SW-side message handlers for the token broker — makes the service worker
 * the canonical credential cache for every other context.
 *
 * Registered once from `bootstrapBackground()`. Mirrors the MIC_REQUEST
 * pattern: surfaces call `send(CHANNELS.BROKER_*)`, handlers reply.
 */

import { on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import {
  clearCredentialCache,
  getCredentialCached,
  invalidateCredential,
  snapshotCredentialCache,
} from './cache';
import { callProxiedJsonInSw } from './index';
import type {
  BrokerInvalidateMessage,
  BrokerMintMessage,
  BrokerProxiedJsonMessage,
  BrokerProxiedJsonResult,
} from './index';
import type { BrokerCacheEntrySnapshot, BrokerResult, BrokeredCredential } from './types';

export function registerBrokerHandlers(): void {
  on<BrokerMintMessage, BrokerResult<BrokeredCredential>>(CHANNELS.BROKER_MINT, (payload) =>
    getCredentialCached(payload.audience, payload.tierPolicy, payload.opts ?? {}),
  );

  on<BrokerInvalidateMessage, { ok: boolean }>(CHANNELS.BROKER_INVALIDATE, async (payload) => {
    invalidateCredential(payload.audience, payload.tierPolicy, payload.model);
    return { ok: true };
  });

  on<Record<string, never>, BrokerCacheEntrySnapshot[]>(CHANNELS.BROKER_SNAPSHOT, async () =>
    snapshotCredentialCache(),
  );

  on<BrokerProxiedJsonMessage, BrokerProxiedJsonResult>(CHANNELS.BROKER_PROXIED_JSON, (payload) =>
    callProxiedJsonInSw(payload),
  );
}

/** Sign-out: the cached grants belong to the previous user. */
export function clearBrokerCacheOnSignOut(): void {
  clearCredentialCache();
}
