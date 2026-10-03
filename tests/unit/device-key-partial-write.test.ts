import {
  DeviceKeyOutcomeUnknownError,
  _resetDeviceKeyCacheForTest,
  getOrCreateDeviceKey,
  getPublicKeyById,
  getPublicKeyHistory,
  rotateDeviceKey,
} from '@/lib/audit/device-key';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  failKey: null as string | null,
  failAfterWrite: false,
  triggerReadFailure: false,
  failActiveReadAfterWrite: false,
}));

vi.mock('@/lib/storage/chrome-local', () => ({
  getOne: async (key: string) => {
    if (key === 'matrx.audit.deviceKey' && storage.failActiveReadAfterWrite) {
      throw new Error('isolated read refusal');
    }
    return structuredClone(storage.values.get(key) ?? null);
  },
  setOne: async (key: string, value: unknown) => {
    if (storage.failKey === key && !storage.failAfterWrite)
      throw new Error('isolated write refusal');
    storage.values.set(key, structuredClone(value));
    if (storage.failKey === key && storage.failAfterWrite) {
      storage.failActiveReadAfterWrite = storage.triggerReadFailure;
      throw new Error('isolated post-write refusal');
    }
  },
}));

const ACTIVE = 'matrx.audit.deviceKey';
const HISTORY = 'matrx.audit.publicKeyHistory';

beforeEach(() => {
  storage.values.clear();
  storage.failKey = null;
  storage.failAfterWrite = false;
  storage.triggerReadFailure = false;
  storage.failActiveReadAfterWrite = false;
  _resetDeviceKeyCacheForTest();
});

describe('audit device key partial storage writes', () => {
  it('treats an active-key write that persisted then rejected as successful rotation', async () => {
    const old = await getOrCreateDeviceKey();
    storage.failKey = ACTIVE;
    storage.failAfterWrite = true;
    const rotatedId = await rotateDeviceKey();
    expect(rotatedId).not.toBe(old.publicKeyId);
    expect((storage.values.get(ACTIVE) as { publicKeyId: string }).publicKeyId).toBe(rotatedId);
    expect(await getPublicKeyById(old.publicKeyId)).toEqual(old.publicKeyJwk);
    const signed = new TextEncoder().encode('isolated retained receipt');
    const signature = await crypto.subtle.sign('Ed25519', old.privateKey, signed);
    const retainedJwk = await getPublicKeyById(old.publicKeyId);
    if (!retainedJwk) throw new Error('Retired public key is missing');
    const retained = await crypto.subtle.importKey('jwk', retainedJwk, 'Ed25519', false, [
      'verify',
    ]);
    expect(await crypto.subtle.verify('Ed25519', retained, signature, signed)).toBe(true);
    expect(
      (await getPublicKeyHistory()).find((entry) => entry.publicKeyId === old.publicKeyId)
        ?.retiredAt,
    ).not.toBeNull();
  });

  it('does not rotate if the history write fails before the active key changes', async () => {
    const old = await getOrCreateDeviceKey();
    storage.failKey = HISTORY;
    await expect(rotateDeviceKey()).rejects.toThrow('isolated write refusal');
    expect((await getOrCreateDeviceKey()).publicKeyId).toBe(old.publicKeyId);
  });

  it('keeps public history unchanged when the active-key write fails before persistence', async () => {
    const old = await getOrCreateDeviceKey();
    const before = await getPublicKeyHistory();
    storage.failKey = ACTIVE;
    storage.failAfterWrite = false;
    await expect(rotateDeviceKey()).rejects.toThrow('isolated write refusal');
    expect((storage.values.get(ACTIVE) as { publicKeyId: string }).publicKeyId).toBe(
      old.publicKeyId,
    );
    expect(await getPublicKeyHistory()).toEqual(before);
    const raw = storage.values.get(HISTORY) as Array<{ publicKeyId: string }>;
    const unactivated = raw.at(-1);
    if (!unactivated) throw new Error('Prepared public key is missing');
    const unactivatedId = unactivated.publicKeyId;
    expect(unactivatedId).not.toBe(old.publicKeyId);
    expect(await getPublicKeyById(unactivatedId)).toBeNull();
  });

  it('recovers first creation when the active-key write persisted then rejected', async () => {
    storage.failKey = ACTIVE;
    storage.failAfterWrite = true;
    const created = await getOrCreateDeviceKey();
    expect(created.publicKeyId).toBe(
      (storage.values.get(ACTIVE) as { publicKeyId: string }).publicKeyId,
    );
    expect(await getPublicKeyById(created.publicKeyId)).toEqual(created.publicKeyJwk);
  });

  it('reports an unknown outcome when post-write readback also fails', async () => {
    const old = await getOrCreateDeviceKey();
    storage.failKey = ACTIVE;
    storage.failAfterWrite = true;
    storage.triggerReadFailure = true;
    await expect(rotateDeviceKey()).rejects.toBeInstanceOf(DeviceKeyOutcomeUnknownError);
    const persistedId = (storage.values.get(ACTIVE) as { publicKeyId: string }).publicKeyId;
    expect(persistedId).not.toBe(old.publicKeyId);
    storage.failActiveReadAfterWrite = false;
    expect((await getOrCreateDeviceKey()).publicKeyId).toBe(persistedId);
  });

  it('retains every committed key across repeated rotations', async () => {
    const first = await getOrCreateDeviceKey();
    const secondId = await rotateDeviceKey();
    const second = await getOrCreateDeviceKey();
    expect(second.publicKeyId).toBe(secondId);
    const thirdId = await rotateDeviceKey();
    const third = await getOrCreateDeviceKey();
    expect(third.publicKeyId).toBe(thirdId);
    const history = await getPublicKeyHistory();
    expect(history.map((entry) => entry.publicKeyId)).toEqual([
      thirdId,
      secondId,
      first.publicKeyId,
    ]);
    for (const retired of [first, second]) {
      const payload = new TextEncoder().encode(`receipt signed by ${retired.publicKeyId}`);
      const signature = await crypto.subtle.sign('Ed25519', retired.privateKey, payload);
      const jwk = await getPublicKeyById(retired.publicKeyId);
      if (!jwk) throw new Error('Committed retired public key is missing');
      const publicKey = await crypto.subtle.importKey('jwk', jwk, 'Ed25519', false, ['verify']);
      expect(await crypto.subtle.verify('Ed25519', publicKey, signature, payload)).toBe(true);
    }
  });
});
