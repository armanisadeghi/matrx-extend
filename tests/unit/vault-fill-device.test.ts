/**
 * The extension-bound fill credential (access ladder T-30), with REAL WebCrypto
 * and a real (in-memory) IndexedDB. Proves: nothing signs until the person turns
 * filling on with their password; only the public JWK (plus that password, once)
 * is sent; the private key can never be read out; every signature is the exact
 * v2 wire contract aidream verifies, with a fresh nonce, and covers the body; a
 * revoked key is replaced.
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
let methodsImpl: () => unknown = () => ({ ok: true, data: { password: true, passkey: false } });
vi.mock('@/lib/api/client', () => ({
  apiPost: async (path: string, body: unknown) => {
    posts.push({ path, body });
    return registerImpl();
  },
  apiGet: async () => methodsImpl(),
}));
vi.mock('@/config/env', () => ({ ENV: { FRONTEND_URL: 'https://aimatrx.com/' } }));

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

  it('refuses to sign until filling is turned on with the password', async () => {
    const { signFillRequest, fillDeviceStatus } = await fresh();
    expect(await fillDeviceStatus()).toBe('off');
    const r = await signFillRequest({
      surface: 'browser_login_materialize',
      itemId: 'a',
      body: {},
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.kind).toBe('setup_required');
    expect(posts).toHaveLength(0); // never auto-registers
  });

  it('registers the public half with the password once, then signs the exact v2 wire', async () => {
    const { signFillRequest, turnOnFillingHere, fillDeviceStatus } = await fresh();
    expect(await turnOnFillingHere('pw-typed-by-the-person')).toEqual({ ok: true });
    expect(await fillDeviceStatus()).toBe('on');
    const reg = posts[0]?.body as { public_key_jwk: Record<string, string>; password: string };
    expect(posts[0]?.path).toBe('/api/vault/fill-devices');
    expect(reg.password).toBe('pw-typed-by-the-person');
    expect(Object.keys(reg.public_key_jwk).sort()).toEqual(['crv', 'kty', 'x', 'y']);

    const body = {
      page_url: 'https://example.com/login',
      tool_invocation_id: 't1',
      client_build: 'x',
    };
    const one = await signFillRequest({
      surface: 'browser_login_materialize',
      itemId: 'item-1',
      body,
    });
    const two = await signFillRequest({
      surface: 'browser_login_materialize',
      itemId: 'item-1',
      body,
    });
    expect(one.ok && two.ok).toBe(true);
    if (!one.ok || !two.ok) return;
    const h = one.headers;
    expect(h['X-Matrx-Fill-Nonce']).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(h['X-Matrx-Fill-Nonce']).not.toBe(two.headers['X-Matrx-Fill-Nonce']);
    const message = [
      'matrx-vault-fill/v2',
      'browser_login_materialize',
      'item-1',
      h['X-Matrx-Fill-Timestamp'],
      h['X-Matrx-Fill-Nonce'],
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
    const verify = (m: string) =>
      crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        pub,
        sig,
        new TextEncoder().encode(m),
      );
    expect(await verify(message)).toBe(true);
    expect(await verify(message.replace(/[0-9a-f]{64}$/, await sha256Hex('{}')))).toBe(false);
  });

  it('keeps a non-extractable private key', async () => {
    const { turnOnFillingHere } = await fresh();
    await turnOnFillingHere('pw');
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

  it('a wrong password is refused in the server’s words and nothing is registered', async () => {
    const { turnOnFillingHere, fillDeviceStatus } = await fresh();
    registerImpl = () => ({
      ok: false,
      status: 403,
      error: JSON.stringify({
        error: 'step_up_failed',
        user_message: 'That password did not match.',
      }),
    });
    const r = await turnOnFillingHere('wrong');
    expect(r).toEqual({
      ok: false,
      failure: { kind: 'refused', message: 'That password did not match.' },
    });
    expect(await fillDeviceStatus()).toBe('off');
  });

  it('a revoked key is replaced by a new key on the next turn-on', async () => {
    const { turnOnFillingHere } = await fresh();
    let calls = 0;
    registerImpl = () =>
      ++calls === 1
        ? {
            ok: false,
            status: 403,
            error: JSON.stringify({ error: 'key_revoked', user_message: 'off' }),
          }
        : { ok: true, data: { id: 'dev-2', revoked_at: null } };
    expect(await turnOnFillingHere('pw')).toEqual({ ok: true });
    const keys = posts.map((p) =>
      JSON.stringify((p.body as { public_key_jwk: unknown }).public_key_jwk),
    );
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toEqual(keys[1]);
  });

  // ── passkey approval (T-30c) ──────────────────────────────────────────

  it('the key thumbprint is byte-for-byte the server’s RFC 7638 thumbprint', async () => {
    const { publicKeyThumbprint, shortFingerprint } = await fresh();
    // Vector from aidream fill_devices.jwk_thumbprint on the same JWK.
    const t = await publicKeyThumbprint({
      kty: 'EC',
      crv: 'P-256',
      x: 'Ju_OvQ7p40pmkYfhizqRIrL3M5RbZJzJ-fkh6fna2BI',
      y: 'kCOL3pzHuzMNFQxncE3SWucFUgV0S28xv0BwdFhy0OY',
    });
    expect(t).toBe('989777bd268731e0a425d6e28e7ed9be4a00d3798e7c21d49799ace5ccf9c29b');
    expect(shortFingerprint(t)).toBe('9897 77BD 2687 31E0');
  });

  it('the approval link carries only this browser’s public thumbprint, and registration without a password claims it', async () => {
    const { passkeyApprovalLink, turnOnFillingHere, fillDeviceStatus, publicKeyThumbprint } =
      await fresh();
    const link = await passkeyApprovalLink();
    expect(link.url).toMatch(
      /^https:\/\/aimatrx\.com\/vault\/approve-browser\?key=[0-9a-f]{64}&label=/,
    );
    expect(posts).toHaveLength(0); // opening the link registers nothing
    expect(await turnOnFillingHere()).toEqual({ ok: true });
    const reg = posts[0]?.body as {
      public_key_jwk: { kty: 'EC'; crv: 'P-256'; x: string; y: string };
    };
    expect('password' in (reg as object)).toBe(false);
    const key = new URL(link.url as string).searchParams.get('key');
    expect(key).toBe(await publicKeyThumbprint(reg.public_key_jwk));
    expect(await fillDeviceStatus()).toBe('on');
  });

  it('without an approval the server’s step-up refusal comes back as step_up_required', async () => {
    const { turnOnFillingHere, fillDeviceStatus } = await fresh();
    registerImpl = () => ({
      ok: false,
      status: 403,
      error: JSON.stringify({
        detail: {
          error: 'no_step_up_method',
          user_message: 'Your account has no password or passkey yet.',
        },
      }),
    });
    const r = await turnOnFillingHere();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure).toEqual({
        kind: 'step_up_required',
        message: 'Your account has no password or passkey yet.',
        noMethod: true,
      });
    }
    expect(await fillDeviceStatus()).toBe('off');
  });

  it('reads how the person can confirm (password, passkey, or neither)', async () => {
    const { fillStepUpMethods } = await fresh();
    methodsImpl = () => ({ ok: true, data: { password: false, passkey: false } });
    expect(await fillStepUpMethods()).toEqual({ password: false, passkey: false });
    methodsImpl = () => ({ ok: false, status: 404, error: 'x' });
    expect(await fillStepUpMethods()).toBeNull();
  });
});
