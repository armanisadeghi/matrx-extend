/**
 * The one mint call — `POST /broker/tokens` on the aidream backend.
 *
 * This is the ONLY place in the repo that talks to the broker's mint
 * endpoint. Everything else goes through `getBrokeredCredential` (cache.ts /
 * index.ts), which layers caching + refresh-ahead on top.
 */

import { apiPost, withSchema } from '@/lib/api/client';
import { log } from '@/lib/debug/log';
import type { BrokerResult, BrokeredCredential, MintOptions, TierPolicy } from './types';
import { BrokeredCredentialSchema } from './types';

const MINT_PATH = '/broker/tokens';

/**
 * Mint a brokered credential. `tierPolicy` is a REQUIRED explicit argument —
 * do not add a wrapper that defaults it.
 *
 * Error semantics (surface these loudly, never silently fall back):
 * - 503 → broker not configured on this server (missing signing key /
 *   public_url). A deploy/config problem, not a retry candidate.
 * - 422 → unknown audience or invalid request. A programming error.
 * - 401 → not signed in (guests cannot mint in v1).
 */
export async function mintCredential(
  audience: string,
  tierPolicy: TierPolicy,
  opts: MintOptions = {},
): Promise<BrokerResult<BrokeredCredential>> {
  const body: Record<string, unknown> = {
    audience,
    tier_policy: tierPolicy,
    ...(opts.ttlSeconds !== undefined && { ttl_seconds: opts.ttlSeconds }),
    ...(opts.model !== undefined && { model: opts.model }),
    ...(opts.scopes !== undefined && { scopes: opts.scopes }),
  };
  const raw = await apiPost<unknown>(MINT_PATH, body);
  const result = withSchema(raw, BrokeredCredentialSchema);
  if (!result.ok) {
    // Never log the token; on failure there is none. Log everything else.
    log.error('broker', `mint failed: ${audience} (${result.status})`, {
      audience,
      tierPolicy,
      status: result.status,
      error: result.error,
    });
    return result;
  }
  const cred = result.data;
  log.info('broker', `minted ${cred.credential_mode} credential for ${audience}`, {
    audience,
    tierPolicy,
    protocol: cred.protocol,
    model: cred.model,
    expiresAt: cred.expires_at,
  });
  return result;
}
