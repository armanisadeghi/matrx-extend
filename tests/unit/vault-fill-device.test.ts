/**
 * The extension-bound fill credential (access ladder T-30), with REAL WebCrypto
 * and a real (in-memory) IndexedDB. Proves: the private key can never be read
 * out; only the public JWK is registered; the signature is exactly the wire
 * contract aidream verifies (fill_devices.canonical_fill_message) and covers the
 * body; a revoked device drops its key.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const posts: Array<{ path: string; body: unknown }> = [];
let registerImpl: () => unknown = () => ({ ok: true, data: { id: 'dev-1', revoked_at: null } });

vi.mock('@/lib/auth/flow', () => ({
  getCurrentUser: async () => ({ id: '11111111-1111-4111-8111-111111111111' }),
}));
vi.mock('@/lib/debug/log', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, success: () => {} },
}));
vi.mock('@/lib/api/client', () => ({
  apiPost: async (path: string, body: unknown) => {
    posts.push({ path, body });
    return registerImpl();
  },
}));

const USER = '11111111-1111-4111-8111-111111111111';

async function fresh() {
  vi.resetModules();
  await new Promise<void>((resolve) => {
    const r = indexedDB.deleteDatabase('matrx-vault-fill-device');
    r.onsuccess = () => resolve();
    r.onerror = () => resolve();
  });
  return import('@/lib/vault/fill-device');
}

function b64urlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const b64 =
    value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

describe('vault fill device (T-30)', () => {
  beforeEach(() => {
    posts.length = 0;
    registerImpl = () => ({ ok: true, data: { id: 'dev-1', revoked_at: null } });
  });

  it('registers only the public half and signs the exact server wire message', async () => {
    const { signFillRequest } = await fresh();
    const body = {
      page_url: 'https://example.com/login',
      tool_invocation_id: 't1',
      client_build: 'x',
    };
    const signed = await signFillRequest({
      surface: 'browser_login_materialize',
      itemId: 'item-1',
      body,
    });
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;

    expect(posts).toHaveLength(1);
    const reg = posts[0]?.body as { public_key_jwk: Record<string, string> };
    expect(posts[0]?.path).toBe('/api/vault/fill-devices');
    expect(Object.keys(reg.public_key_jwk).sort()).toEqual(['crv', 'kty', 'x', 'y']);
    expect(reg.public_key_jwk).not.toHaveProperty('d');

    const h = signed.headers;
    expect(h['X-Matrx-Fill-Device']).toBe('dev-1');
    const message = [
      'matrx-vault-fill/v1',
      'browser_login_materialize',
      'item-1',
      h['X-Matrx-Fill-Timestamp'],
      'dev-1',
      USER,
      await sha256Hex(JSON.stringify(body)),
    ].join('\n');
    const pub = await crypto.subtle.importKey(
      'jwk',
      { ...reg.public_key_jwk, ext: true },
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['verify'],
    );
    const sig = b64urlToBytes(h['X-Matrx-Fill-Signature'] as string);
    expect(sig.byteLength).toBe(64);
    const verify = (m: string) =>
      crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        pub,
        sig,
        new TextEncoder().encode(m),
      );
    expect(await verify(message)).toBe(true);
    // the body is covered: a different page URL does not verify
    expect(await verify(message.replace(/[0-9a-f]{64}$/, await sha256Hex('{}')))).toBe(false);
  });

  it('keeps a non-extractable private key and registers once', async () => {
    const { signFillRequest } = await fresh();
    await signFillRequest({ surface: 'browser_login_materialize', itemId: 'a', body: {} });
    await signFillRequest({ surface: 'browser_login_materialize', itemId: 'b', body: {} });
    expect(posts).toHaveLength(1);
    const stored = await new Promise<{ privateKey: CryptoKey }>((resolve, reject) => {
      const open = indexedDB.open('matrx-vault-fill-device', 1);
      open.onsuccess = () => {
        const get = open.result.transaction('keys').objectStore('keys').get(USER);
        get.onsuccess = () => {
          open.result.close();
          resolve(get.result);
        };
        get.onerror = () => reject(get.error);
      };
    });
    expect(stored.privateKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('pkcs8', stored.privateKey)).rejects.toThrow();
  });

  it('forceRegister re-registers the same key (a new sign-in session)', async () => {
    const { signFillRequest } = await fresh();
    await signFillRequest({ surface: 'browser_login_materialize', itemId: 'a', body: {} });
    await signFillRequest({
      surface: 'browser_login_materialize',
      itemId: 'a',
      body: {},
      forceRegister: true,
    });
    expect(posts).toHaveLength(2);
    expect((posts[0]?.body as { public_key_jwk: unknown }).public_key_jwk).toEqual(
      (posts[1]?.body as { public_key_jwk: unknown }).public_key_jwk,
    );
  });

  it('a revoked device is refused in plain words and its key is dropped', async () => {
    const { signFillRequest } = await fresh();
    registerImpl = () => ({
      ok: false,
      status: 403,
      error: 'Filling from this browser was turned off.',
    });
    const first = await signFillRequest({
      surface: 'browser_login_materialize',
      itemId: 'a',
      body: {},
    });
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.failure).toEqual({
      kind: 'device_revoked',
      message: 'Filling from this browser was turned off.',
    });
    registerImpl = () => ({ ok: true, data: { id: 'dev-2', revoked_at: null } });
    await signFillRequest({ surface: 'browser_login_materialize', itemId: 'a', body: {} });
    const keys = posts.map((p) =>
      JSON.stringify((p.body as { public_key_jwk: unknown }).public_key_jwk),
    );
    expect(keys[0]).not.toEqual(keys[1]);
  });
});
