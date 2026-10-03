import { createRequire } from 'node:module';
import { beforeEach, expect, it, vi } from 'vitest';
import { createWebLocks } from '../helpers/web-locks';

// Node 24+ exposes native Web Locks; Node 22 CI uses the browser dependency double.
const runtime = createRequire(import.meta.url)('node:worker_threads') as {
  locks?: ReturnType<typeof createWebLocks>;
};
const locks = runtime.locks ?? createWebLocks();
const storage = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  beforeWrite: async (_key: string) => {},
  afterWrite: async (_key: string, _value: unknown) => {},
}));
vi.mock('@/lib/storage/chrome-local', () => ({
  getOne: async (key: string) => structuredClone(storage.values.get(key) ?? null),
  setOne: async (key: string, value: unknown) => {
    await storage.beforeWrite(key);
    storage.values.set(key, structuredClone(value));
    await storage.afterWrite(key, value);
  },
}));
const ACTIVE = 'matrx.audit.deviceKey';
function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function context() {
  vi.resetModules();
  return import('@/lib/audit/device-key');
}
beforeEach(() => {
  storage.values.clear();
  storage.beforeWrite = async () => {};
  storage.afterWrite = async () => {};
  vi.stubGlobal('navigator', { locks });
});

it('preserves signatures from both overlapping rotation contexts after restart', async () => {
  const a = await context();
  const initial = await a.getOrCreateDeviceKey();
  const b = await context();
  const payload = new TextEncoder().encode('receipt signed while candidate is active');
  const signatures = new Map<string, ArrayBuffer>();
  storage.afterWrite = async (key, value) => {
    if (key !== ACTIVE) return;
    const active = value as { publicKeyId: string; privateKeyJwk: JsonWebKey };
    const signingKey = await crypto.subtle.importKey(
      'jwk',
      active.privateKeyJwk,
      'Ed25519',
      false,
      ['sign'],
    );
    signatures.set(active.publicKeyId, await crypto.subtle.sign('Ed25519', signingKey, payload));
  };
  const waiting = signal();
  const release = signal();
  let writes = 0;
  storage.beforeWrite = async (key) => {
    if (key !== ACTIVE) return;
    writes++;
    if (writes === 1) {
      waiting.resolve();
      await release.promise;
    } else {
      // Unlocked implementation lets B replace history before A activates.
      release.resolve();
    }
  };
  const firstRotation = a.rotateDeviceKey();
  await waiting.promise;
  vi.stubGlobal('navigator', {
    locks: {
      request: (name: string, options: LockOptions, callback: () => Promise<unknown>) => {
        const result = locks.request(name, options, callback);
        release.resolve();
        return result;
      },
    },
  });
  const secondRotation = b.rotateDeviceKey();
  const ids = await Promise.all([firstRotation, secondRotation]);
  const restarted = await context();
  const history = await restarted.getPublicKeyHistory();
  expect(new Set(history.map((entry) => entry.publicKeyId))).toEqual(
    new Set([initial.publicKeyId, ...ids]),
  );
  for (const id of ids) {
    const jwk = await restarted.getPublicKeyById(id);
    const signature = signatures.get(id);
    if (!jwk || !signature) throw new Error('Activated receipt key lost');
    const key = await crypto.subtle.importKey('jwk', jwk, 'Ed25519', false, ['verify']);
    expect(await crypto.subtle.verify('Ed25519', key, signature, payload)).toBe(true);
    expect(
      await crypto.subtle.verify(
        'Ed25519',
        key,
        signature,
        new TextEncoder().encode('altered receipt'),
      ),
    ).toBe(false);
  }
});

it('creates one durable key for simultaneous first use in separate contexts', async () => {
  const a = await context();
  const b = await context();
  const keys = await Promise.all([a.getOrCreateDeviceKey(), b.getOrCreateDeviceKey()]);
  expect(keys[0].publicKeyId).toBe(keys[1].publicKeyId);
  const restarted = await context();
  expect((await restarted.getOrCreateDeviceKey()).publicKeyId).toBe(keys[0].publicKeyId);
});

it('observes another context rotation even before storage change events arrive', async () => {
  const a = await context();
  const initial = await a.getOrCreateDeviceKey();
  const b = await context();
  const rotated = await b.rotateDeviceKey();
  expect(rotated).not.toBe(initial.publicKeyId);
  expect((await a.getOrCreateDeviceKey()).publicKeyId).toBe(rotated);
});

it('refuses unsupported cross-context locking without changing persistent keys', async () => {
  const a = await context();
  const initial = await a.getOrCreateDeviceKey();
  vi.stubGlobal('navigator', {});
  await expect(a.rotateDeviceKey()).rejects.toThrow(/locking is unavailable/);
  expect((storage.values.get(ACTIVE) as { publicKeyId: string }).publicKeyId).toBe(
    initial.publicKeyId,
  );
});

it('distinguishes an absent key from an activated verification key', async () => {
  const audit = await context();
  const active = await audit.getOrCreateDeviceKey();
  expect(await audit.getPublicKeyById('receipt-key-not-on-this-install')).toBeNull();
  expect(await audit.getPublicKeyById(active.publicKeyId)).toEqual(active.publicKeyJwk);
});
