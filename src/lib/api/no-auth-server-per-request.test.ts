/**
 * REGRESSION GUARD — the per-request path never calls the Supabase Auth server.
 *
 * On 2026-09-21 a platform database lock storm turned `GET /auth/v1/user` into
 * a ~10 s stall, and this extension called it on EVERY expected-actor request
 * to answer "who is this bearer?". Identity is now settled LOCALLY: the token's
 * ES256 signature is checked with WebCrypto against the project's JWKS, which
 * is database-free and cached process-wide.
 *
 * This test drives the real per-request path — `apiPost(..., { expectedActor })`
 * → `buildExpectedActorHeaders` → `getVerifiedCurrentUser` → the local verifier
 * — against a fake fetch, and fails if `/auth/v1/user` is requested even once.
 * `/auth/v1/.well-known/jwks.json` is allowed.
 *
 * Mirrors matrx-local's guard for the same class of defect
 * (tests/unit/test_remote_auth_jwks.py, 2026-09-20).
 *
 * Proven failing-then-passing: reverting `getVerifiedCurrentUser` to
 * `fetchSupabaseUser` makes "never calls /auth/v1/user on the per-request path"
 * fail with `[ 'https://auth.test.invalid/auth/v1/user' ]` recorded.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const SUPABASE_URL = 'https://auth.test.invalid';
const USER_ID = '00000000-0000-4000-8000-0000000000aa';
const ORG_ID = '00000000-0000-4000-8000-0000000000bb';

vi.mock('@/config/backend', () => ({ getBackendUrl: async () => 'https://backend.test.invalid' }));
vi.mock('@/lib/org/active-org', () => ({
  getActiveOrganizationId: async () => ORG_ID,
  holdForActiveOrganizationId: async () => ORG_ID,
  isOrganizationNotSelectedError: () => false,
  isOrganizationNoMembershipsError: () => false,
  OrganizationNotSelectedError: class extends Error {},
}));
vi.mock('@/lib/auth/guest-signature', () => ({ getOrCreateGuestSignature: async () => 'guest' }));
vi.mock('@/lib/messaging/native', () => ({ broadcast: vi.fn() }));
vi.mock('@/lib/debug/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

import { STORAGE_KEYS } from '@/config/env';
import { resetBearerVerifierForTests } from '@/lib/auth/verify-claims';
import { apiPost } from './client';

const b64url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const b64urlText = (text: string): string => b64url(new TextEncoder().encode(text));

/** A real ES256-signed access token plus the JWKS that verifies it. */
async function mintSignedBearer(): Promise<{ token: string; jwks: unknown }> {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const publicJwk = (await crypto.subtle.exportKey('jwk', keys.publicKey)) as Record<
    string,
    unknown
  >;
  const kid = 'test-signing-key';
  const header = { alg: 'ES256', typ: 'JWT', kid };
  const payload = {
    sub: USER_ID,
    email: 'admin@admin.com',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    session_id: '00000000-0000-4000-8000-0000000000cc',
    user_metadata: { full_name: 'Admin Admin', email_verified: true },
  };
  const signingInput = `${b64urlText(JSON.stringify(header))}.${b64urlText(JSON.stringify(payload))}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      keys.privateKey,
      new TextEncoder().encode(signingInput),
    ),
  );
  return {
    token: `${signingInput}.${b64url(signature)}`,
    jwks: { keys: [{ ...publicJwk, kid, alg: 'ES256', use: 'sig' }] },
  };
}

describe('per-request identity never touches the Supabase Auth server', () => {
  beforeEach(() => {
    resetBearerVerifierForTests();
    // Every real extension context (service worker, side panel, offscreen) has
    // WebSocket; happy-dom does not, and supabase-js refuses to construct
    // without one. The verifier never opens a socket.
    vi.stubGlobal('WebSocket', class {});
    vi.stubEnv('WXT_SUPABASE_URL', SUPABASE_URL);
    vi.stubEnv('WXT_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
  });

  it('never calls /auth/v1/user on the per-request path', async () => {
    const { token, jwks } = await mintSignedBearer();
    await chrome.storage.local.set({
      [STORAGE_KEYS.ACCESS_TOKEN]: token,
      [STORAGE_KEYS.TOKEN_EXPIRES_AT]: Date.now() + 3_600_000,
      [STORAGE_KEYS.ACTIVE_ORGANIZATION]: ORG_ID,
      [STORAGE_KEYS.USER_PROFILE]: { id: USER_ID, email: 'admin@admin.com' },
    });

    const requested: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      requested.push(url);
      if (url.includes('/.well-known/jwks.json'))
        return new Response(JSON.stringify(jwks), {
          headers: { 'content-type': 'application/json' },
        });
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await apiPost('/api/vault/items', {}, undefined, {
      expectedActor: { userId: USER_ID, organizationId: ORG_ID },
    });

    expect(requested.filter((url) => url.includes('/auth/v1/user'))).toEqual([]);
    expect(requested.some((url) => url.includes('/auth/v1/.well-known/jwks.json'))).toBe(true);
    expect(result.ok).toBe(true);

    const authorization = (
      (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>).find(([url]) =>
        url.includes('backend.test.invalid'),
      )?.[1].headers as Record<string, string>
    ).Authorization;
    expect(authorization).toBe(`Bearer ${token}`);
  });

  it('caches the key set: a second request makes no auth-host call at all', async () => {
    const { token, jwks } = await mintSignedBearer();
    await chrome.storage.local.set({
      [STORAGE_KEYS.ACCESS_TOKEN]: token,
      [STORAGE_KEYS.TOKEN_EXPIRES_AT]: Date.now() + 3_600_000,
      [STORAGE_KEYS.ACTIVE_ORGANIZATION]: ORG_ID,
      [STORAGE_KEYS.USER_PROFILE]: { id: USER_ID, email: 'admin@admin.com' },
    });
    const requested: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        requested.push(url);
        if (url.includes('/.well-known/jwks.json'))
          return new Response(JSON.stringify(jwks), {
            headers: { 'content-type': 'application/json' },
          });
        return new Response('{}', { headers: { 'content-type': 'application/json' } });
      }),
    );
    const actor = { userId: USER_ID, organizationId: ORG_ID };
    await apiPost('/api/vault/items', {}, undefined, { expectedActor: actor });
    requested.length = 0;
    await apiPost('/api/vault/items', {}, undefined, { expectedActor: actor });
    expect(requested.filter((url) => url.startsWith(SUPABASE_URL))).toEqual([]);
  });
});
