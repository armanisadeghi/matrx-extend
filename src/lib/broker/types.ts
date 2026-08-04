/**
 * Token broker wire shapes — mirrors aidream's
 * `aidream/services/token_broker/models.py` exactly. One envelope
 * (`BrokeredCredential`) for every audience, forever; a new provider is a
 * new `audience` string, never a new shape.
 *
 * Cross-repo contract: /Users/armanisadeghi/code/common-docs/token-broker/FEATURE.md
 */

import { z } from 'zod';

/**
 * REQUIRED on every mint with NO default, by design: every mint must state
 * explicitly whether model-tier fallback applies ("guest" | "mid") or
 * explicitly does not ("none"). Never bake a default into any layer.
 */
export const TierPolicySchema = z.enum(['none', 'guest', 'mid']);
export type TierPolicy = z.infer<typeof TierPolicySchema>;

export const CredentialModeSchema = z.enum(['native_ephemeral', 'proxied']);
export type CredentialMode = z.infer<typeof CredentialModeSchema>;

export interface MintTokenRequest {
  audience: string;
  tier_policy: TierPolicy;
  ttl_seconds?: number;
  model?: string;
  scopes?: string[];
}

export const BrokeredGrantSchema = z.object({
  user_id: z.string(),
  audience: z.string(),
  tier_policy: TierPolicySchema,
  scopes: z.array(z.string()),
  expires_at: z.number(), // unix seconds
});
export type BrokeredGrant = z.infer<typeof BrokeredGrantSchema>;

export const BrokeredCredentialSchema = z.object({
  credential_mode: CredentialModeSchema,
  audience: z.string(),
  token: z.string(),
  expires_at: z.number(), // unix seconds
  /** Where to send this credential. DATA — never hardcode a URL client-side. */
  endpoint: z.string(),
  /** Wire-protocol hint: "openai_realtime", "anthropic_messages", … */
  protocol: z.string(),
  /** Effective model after tier resolution when baked in (native); null for proxied. */
  model: z.string().nullable(),
  grant: BrokeredGrantSchema,
});
export type BrokeredCredential = z.infer<typeof BrokeredCredentialSchema>;

/** Options beyond the two required identifiers of a mint. */
export interface MintOptions {
  ttlSeconds?: number;
  model?: string;
  scopes?: string[];
  /** Bypass the cache and force a fresh mint (used by the 401 re-mint path). */
  forceFresh?: boolean;
}

/**
 * Token-free view of a cached credential, safe to ship to UI surfaces.
 * The demo/debug UI renders these; the token itself never leaves the
 * background service worker except to an in-memory consumer that needs it
 * (e.g. a WebRTC session in the offscreen document).
 */
export interface BrokerCacheEntrySnapshot {
  cacheKey: string;
  audience: string;
  credentialMode: CredentialMode;
  protocol: string;
  endpoint: string;
  model: string | null;
  tierPolicy: TierPolicy;
  scopes: string[];
  expiresAt: number; // unix seconds
  mintedAt: number; // unix ms
  /** Last 6 chars of the token — enough to correlate, useless to steal. */
  tokenTail: string;
}

/** Structured failure from the primitive — mirrors ApiResult's spirit. */
export interface BrokerFailure {
  ok: false;
  status: number;
  error: string;
}
export type BrokerResult<T> = { ok: true; data: T } | BrokerFailure;
