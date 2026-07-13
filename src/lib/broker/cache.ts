/**
 * In-memory brokered-credential cache with refresh-ahead.
 *
 * Cache key: (audience, tier_policy, model). Entries are re-minted when
 * less than REFRESH_AHEAD_FRACTION of their TTL remains, and can be
 * explicitly invalidated when a credential's endpoint rejects it (401).
 *
 * SECURITY INVARIANT: memory only. A brokered token is NEVER persisted —
 * no chrome.storage, no localStorage, no DB, no logs. It is designed to
 * die with the context; the canonical cache lives in the background
 * service worker (see index.ts), so an SW restart simply re-mints.
 */

import { mintCredential } from './mint';
import type {
  BrokerCacheEntrySnapshot,
  BrokerResult,
  BrokeredCredential,
  MintOptions,
  TierPolicy,
} from './types';

/** Re-mint when less than this fraction of the credential's TTL remains. */
const REFRESH_AHEAD_FRACTION = 0.2;

interface CacheEntry {
  credential: BrokeredCredential;
  mintedAtMs: number;
  /** TTL in ms as observed at mint time (expires_at − minted-at). */
  ttlMs: number;
}

const entries = new Map<string, CacheEntry>();
/** Single-flight: concurrent callers for the same key share one mint. */
const inflight = new Map<string, Promise<BrokerResult<BrokeredCredential>>>();

export function cacheKey(audience: string, tierPolicy: TierPolicy, model?: string): string {
  return `${audience}|${tierPolicy}|${model ?? ''}`;
}

function isFresh(entry: CacheEntry, nowMs: number): boolean {
  const expiresAtMs = entry.credential.expires_at * 1000;
  const remaining = expiresAtMs - nowMs;
  return remaining > entry.ttlMs * REFRESH_AHEAD_FRACTION;
}

/**
 * Get a valid credential for (audience, tierPolicy, model) — cached when
 * fresh, minted otherwise. `tierPolicy` is REQUIRED and explicit at every
 * layer of this system; never add a defaulted wrapper.
 */
export async function getCredentialCached(
  audience: string,
  tierPolicy: TierPolicy,
  opts: MintOptions = {},
): Promise<BrokerResult<BrokeredCredential>> {
  const key = cacheKey(audience, tierPolicy, opts.model);
  const now = Date.now();

  if (!opts.forceFresh) {
    const cached = entries.get(key);
    if (cached && isFresh(cached, now)) {
      return { ok: true, data: cached.credential };
    }
    const pending = inflight.get(key);
    if (pending) return pending;
  }

  const mintPromise = (async (): Promise<BrokerResult<BrokeredCredential>> => {
    const result = await mintCredential(audience, tierPolicy, opts);
    if (result.ok) {
      const mintedAtMs = Date.now();
      entries.set(key, {
        credential: result.data,
        mintedAtMs,
        ttlMs: Math.max(0, result.data.expires_at * 1000 - mintedAtMs),
      });
    }
    return result;
  })();

  inflight.set(key, mintPromise);
  try {
    return await mintPromise;
  } finally {
    inflight.delete(key);
  }
}

/**
 * Drop a cached credential — call when its endpoint rejects it (401).
 * The next `getCredentialCached` re-mints. One re-mint then fail loudly;
 * never retry-loop.
 */
export function invalidateCredential(
  audience: string,
  tierPolicy: TierPolicy,
  model?: string,
): void {
  entries.delete(cacheKey(audience, tierPolicy, model));
}

/** Drop everything — used on sign-out (grants belong to the old user). */
export function clearCredentialCache(): void {
  entries.clear();
}

/** Token-free view of the cache for debug/demo UI. */
export function snapshotCredentialCache(): BrokerCacheEntrySnapshot[] {
  const out: BrokerCacheEntrySnapshot[] = [];
  for (const [key, entry] of entries) {
    const c = entry.credential;
    out.push({
      cacheKey: key,
      audience: c.audience,
      credentialMode: c.credential_mode,
      protocol: c.protocol,
      endpoint: c.endpoint,
      model: c.model,
      tierPolicy: c.grant.tier_policy,
      scopes: c.grant.scopes,
      expiresAt: c.expires_at,
      mintedAt: entry.mintedAtMs,
      tokenTail: c.token.slice(-6),
    });
  }
  // Expired-and-stale entries are cosmetic here; show them anyway so the
  // demo surface can visualize refresh-ahead behavior.
  return out.sort((a, b) => b.mintedAt - a.mintedAt || (a.cacheKey < b.cacheKey ? -1 : 1));
}
