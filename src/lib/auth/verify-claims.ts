/**
 * LOCAL bearer verification — the per-request identity answer.
 *
 * WHY THIS EXISTS. Every expected-actor / private request used to resolve
 * "who is this bearer?" with a network call to the Supabase Auth server
 * (`GET /auth/v1/user`). That endpoint reads the database, so when the
 * platform database locked up on 2026-09-21 every single request in this
 * extension stalled for ~10 s behind it.
 *
 * The platform project signs access tokens with an ASYMMETRIC key (ES256), so
 * the signature can be checked here, in the extension, with WebCrypto against
 * the project's JWKS (`/auth/v1/.well-known/jwks.json`). That endpoint never
 * touches the database and supabase-js caches the key set process-wide, so
 * after the first call verification is pure local crypto (~0.2 ms). A verified
 * signature is exactly as trustworthy as `/auth/v1/user` for identity — it is
 * the same authority, checked instead of asked.
 *
 * THE HARD RULE ENFORCED HERE. `auth.getClaims()` silently falls back to
 * `getUser()` (i.e. `/auth/v1/user`) when it cannot find a signing key. That
 * fallback would quietly reintroduce the exact stall this module removes, so
 * the dedicated client below is built with a fetch that REFUSES `/auth/v1/user`
 * outright and says so loudly. A refusal surfaces as `unverifiable`, never as
 * "signed out".
 */

import { ENV } from '@/config/env';
import type { UserProfile } from '@/lib/auth/types';
import { log } from '@/lib/debug/log';
import { type SupabaseClient, createClient } from '@supabase/supabase-js';

/** Upper bound on the ONE JWKS fetch. Local verification must never hang. */
const JWKS_FETCH_TIMEOUT_MS = 2_500;

const AUTH_USER_PATH = '/auth/v1/user';
const JWKS_PATH = '/auth/v1/.well-known/jwks.json';

export class PerRequestAuthUserCallError extends Error {
  override name = 'PerRequestAuthUserCallError';
  constructor(url: string) {
    super(
      `Refused a call to ${url}: bearer identity is verified locally against the project JWKS. ` +
        'If a token cannot be verified locally, the request fails closed — it never falls back ' +
        'to the Auth server, because that call reads the database and stalls every request when ' +
        'the database is slow.',
    );
  }
}

/**
 * The fetch the verification client uses.
 *
 * - `/auth/v1/user` → refused loudly (see above).
 * - the JWKS endpoint → bounded by {@link JWKS_FETCH_TIMEOUT_MS}.
 * - anything else → passed through untouched.
 *
 * Resolves `globalThis.fetch` at CALL time so the ambient fetch (and any test
 * double for it) is always the one that runs.
 */
const verificationFetch: typeof fetch = (input, init) => {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url;
  }

  if (pathname.endsWith(AUTH_USER_PATH)) {
    const refusal = new PerRequestAuthUserCallError(url);
    log.error('auth', 'local bearer verification refused an Auth-server round trip', refusal);
    return Promise.reject(refusal);
  }

  if (pathname.endsWith(JWKS_PATH)) {
    const timeout = AbortSignal.timeout(JWKS_FETCH_TIMEOUT_MS);
    const signal =
      init?.signal && typeof AbortSignal.any === 'function'
        ? AbortSignal.any([init.signal, timeout])
        : (init?.signal ?? timeout);
    return globalThis.fetch(input as RequestInfo, { ...init, signal });
  }

  return globalThis.fetch(input as RequestInfo, init);
};

let verifier: SupabaseClient | null = null;

/**
 * A client whose ONLY job is local claim verification: no persisted session,
 * no auto-refresh, no URL detection. The extension's own token machinery
 * (src/lib/auth/flow.ts) remains the single owner of the session.
 */
function getVerificationClient(): SupabaseClient {
  if (verifier) return verifier;
  verifier = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: verificationFetch,
      headers: { 'X-Client-Info': 'matrx-extend' },
    },
  });
  return verifier;
}

export type VerifiedBearer = {
  /** The signature checked out. `user` carries everything the JWT states. */
  status: 'verified';
  user: UserProfile;
  claims: Record<string, unknown>;
};

export type BearerVerificationResult =
  | VerifiedBearer
  /** The token is malformed, expired, or not signed by this project. Sign-out territory. */
  | { status: 'invalid'; reason: string }
  /**
   * We could not reach a verdict — the JWKS endpoint was unreachable or timed
   * out, or the key set does not carry this token's key. NEVER treat this as
   * signed out: the person may be perfectly signed in.
   */
  | { status: 'unverifiable'; reason: string };

function claimString(claims: Record<string, unknown>, key: string): string | null {
  const value = claims[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function metadata(claims: Record<string, unknown>): Record<string, unknown> {
  const meta = claims.user_metadata;
  return meta && typeof meta === 'object' && !Array.isArray(meta)
    ? (meta as Record<string, unknown>)
    : {};
}

function profileFromClaims(claims: Record<string, unknown>): UserProfile | null {
  const id = claimString(claims, 'sub');
  if (!id) return null;
  const meta = metadata(claims);
  const emailVerified = meta.email_verified;
  return {
    id,
    email: claimString(claims, 'email') ?? null,
    full_name:
      (typeof meta.full_name === 'string' ? meta.full_name : null) ??
      (typeof meta.name === 'string' ? meta.name : null),
    avatar_url: typeof meta.avatar_url === 'string' ? meta.avatar_url : null,
    // The JWT only sometimes carries this; callers that need it fall back to
    // the profile recorded at sign-in.
    ...(typeof emailVerified === 'boolean' && { email_verified: emailVerified }),
  };
}

/** Three segments, and a header and payload that actually decode as JSON. */
function looksLikeJwt(token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    for (const part of parts.slice(0, 2)) {
      const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
      const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Verify a bearer token LOCALLY and report who it belongs to.
 *
 * Never performs a per-request round trip to the Auth server. The only network
 * call it can make is the one-time, process-cached JWKS fetch.
 */
export async function verifyBearerClaims(
  token: string | null | undefined,
): Promise<BearerVerificationResult> {
  if (!token) return { status: 'invalid', reason: 'no bearer token' };
  // Structural check first. A malformed token is INVALID, not "no verdict" —
  // and supabase-js throws a raw decode error for it, which would otherwise be
  // caught below and misreported as unverifiable.
  if (!looksLikeJwt(token)) return { status: 'invalid', reason: 'not a JWT' };
  try {
    const { data, error } = await getVerificationClient().auth.getClaims(token);
    if (error) {
      const unreachable =
        error.name === 'AuthRetryableFetchError' ||
        error.name === 'PerRequestAuthUserCallError' ||
        error.name === 'TimeoutError' ||
        error.name === 'AbortError';
      return unreachable
        ? { status: 'unverifiable', reason: error.message }
        : { status: 'invalid', reason: error.message };
    }
    const claims = (data?.claims ?? null) as Record<string, unknown> | null;
    if (!claims) return { status: 'unverifiable', reason: 'no claims returned' };
    const user = profileFromClaims(claims);
    if (!user) return { status: 'invalid', reason: 'verified token carries no subject' };
    return { status: 'verified', user, claims };
  } catch (cause) {
    // Anything thrown rather than returned is an environment problem (no
    // WebCrypto, network refused, our own /auth/v1/user guard): no verdict.
    const reason = cause instanceof Error ? cause.message : String(cause);
    log.warn('auth', 'local bearer verification could not reach a verdict', reason);
    return { status: 'unverifiable', reason };
  }
}

/** Test seam: drop the cached verification client (and its cached JWKS). */
export function resetBearerVerifierForTests(): void {
  verifier = null;
}
