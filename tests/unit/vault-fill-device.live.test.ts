/**
 * LIVE (opt-in) T-30 proof: the extension's REAL vault route module and REAL
 * device-key module fill against a running aidream, over the extension's own
 * OAuth session. Skipped unless T30_LIVE_API and T30_LIVE_TOKEN_FILE are set:
 *
 *   T30_LIVE_API=http://localhost:8017 T30_LIVE_TOKEN_FILE=/path/ext-token.json \
 *   T30_LIVE_ORG=<org id> T30_LIVE_ITEM=<website_login id> T30_LIVE_PAGE=<its login url> \
 *   pnpm vitest run tests/unit/vault-fill-device.live.test.ts
 *
 * Only the transport (chrome.storage-backed API client, auth store) is replaced
 * by plain fetch; signing, registration, retry and the wire are the shipped code.
 * Never prints a credential value.
 */
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const API = process.env.T30_LIVE_API;
const TOKEN_FILE = process.env.T30_LIVE_TOKEN_FILE;
const live = !!API && !!TOKEN_FILE;
const token: string = live
  ? JSON.parse(readFileSync(TOKEN_FILE as string, 'utf8')).access_token
  : '';
const sub: string = live
  ? JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()).sub
  : '';

vi.mock('@/lib/auth/flow', () => ({
  getAccessToken: async () => token,
  getCurrentUser: async () => ({ id: sub }),
}));
vi.mock('@/lib/org/active-org', () => ({
  getActiveOrganizationId: async () => process.env.T30_LIVE_ORG,
}));
vi.mock('@/lib/supabase/schemas', () => ({ platformDb: () => ({}) }));
vi.mock('@/lib/debug/log', () => ({ log: { info() {}, warn() {}, error() {}, success() {} } }));
vi.mock('@/lib/api/client', () => {
  const call = async (
    method: string,
    path: string,
    body: unknown,
    opts?: { headers?: Record<string, string> },
  ) => {
    const r = await fetch(`${API}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-organization-id': process.env.T30_LIVE_ORG as string,
        origin: 'chrome-extension://cihdmkcdjjckfhjpgoedmgfpoljebaml',
        ...(opts?.headers ?? {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await r.text();
    let data: unknown = null;
    try {
      data = JSON.parse(text);
    } catch {}
    return r.ok
      ? { ok: true, data }
      : {
          ok: false,
          status: r.status,
          error:
            (data as { detail?: { user_message?: string } })?.detail?.user_message ??
            text.slice(0, 200),
        };
  };
  return {
    STATUS_INVALID_BODY: -1,
    apiPost: (
      path: string,
      body: unknown,
      _s?: unknown,
      opts?: { headers?: Record<string, string> },
    ) => call('POST', path, body, opts),
    apiGet: (path: string) => call('GET', path, undefined),
    apiPatch: (path: string, body: unknown) => call('PATCH', path, body),
    apiPut: (path: string, body: unknown) => call('PUT', path, body),
    apiDelete: (path: string) => call('DELETE', path, undefined),
  };
});

describe.skipIf(!live)('LIVE: extension fill through its device key (T-30)', () => {
  it('registers this install and materializes over the extension session', async () => {
    const { materializeBrowserLogin } = await import('@/lib/api/routes/vault');
    const r = await materializeBrowserLogin(process.env.T30_LIVE_ITEM as string, {
      pageUrl: process.env.T30_LIVE_PAGE as string,
      toolInvocationId: 't30-live',
      clientBuild: 't30-live',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const names = r.data.fields ? Object.keys(r.data.fields) : ['username', 'password'];
      console.log(
        JSON.stringify({ t30_live_fill: 'ok', origin: r.data.origin, field_names: names }),
      );
    }
  }, 120_000);
});
