/**
 * Device-bound Ed25519 keypair for cryptographic run receipts (CLAUDE.md
 * roadmap item #8).
 *
 * Posture and trade-offs (read before changing):
 *   - We use `extractable: true` because the Service Worker restarts every
 *     ~30s and Chrome's WebCrypto does NOT persist non-extractable
 *     CryptoKeys across SW lifetimes. Re-importing the JWK from
 *     `chrome.storage.local` on boot is the only way to keep signatures
 *     reproducible across sessions.
 *   - Storage: `chrome.storage.local` is OS-encrypted on disk and scoped
 *     to the installed extension ID. The "device-bound" guarantee is
 *     therefore "this Chrome profile + this extension install" — strong
 *     enough for compliance / chain-of-custody, weaker than a hardware key.
 *   - Re-keying: the user can rotate at any time from
 *     Settings → Advanced agent capabilities → Audit key. Rotating
 *     appends the previous public key to a history list so prior
 *     receipts continue to verify.
 *
 * Storage shape (chrome.storage.local):
 *   matrx.audit.deviceKey       → { privateKeyJwk, publicKeyJwk, publicKeyId, createdAt }
 *   matrx.audit.publicKeyHistory → Array<{ publicKeyJwk, publicKeyId, createdAt, retiredAt }>
 *
 * The private CryptoKey is re-imported lazily via `getOrCreateDeviceKey`
 * and cached in module scope for the SW lifetime. There is no in-memory-
 * only mode by design — it would render the audit log unverifiable after
 * every SW restart.
 */

import { getOne, setOne } from '@/lib/storage/chrome-local';

const DEVICE_KEY_STORAGE = 'matrx.audit.deviceKey';
const PUBLIC_KEY_HISTORY_STORAGE = 'matrx.audit.publicKeyHistory';

interface StoredDeviceKey {
  privateKeyJwk: JsonWebKey;
  publicKeyJwk: JsonWebKey;
  publicKeyId: string;
  createdAt: number;
}

export interface PublicKeyHistoryEntry {
  publicKeyJwk: JsonWebKey;
  publicKeyId: string;
  createdAt: number;
  /** Unix ms when this key was rotated out. Null for the active key. */
  retiredAt: number | null;
}

/** A prepared public entry becomes visible only after its key is active. */
interface StoredHistoryEntry extends PublicKeyHistoryEntry {
  pending?: boolean;
}

export interface DeviceKey {
  publicKeyJwk: JsonWebKey;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicKeyId: string;
  createdAt: number;
}

/** The storage response cannot establish whether a new active key persisted. */
export class DeviceKeyOutcomeUnknownError extends Error {
  constructor() {
    super('Could not confirm the active audit key');
    this.name = 'DeviceKeyOutcomeUnknownError';
  }
}

let cached: DeviceKey | null = null;

// Web Locks coordinate the service worker and every extension page by origin.
// All storage snapshots and read/modify/write sequences use this same lock;
// helpers called inside it must never request it recursively.
async function withDeviceKeyLock<T>(operation: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks?.request) {
    throw new Error('Audit key storage locking is unavailable in this browser context');
  }
  return locks.request('matrx:audit:device-key', { mode: 'exclusive' }, operation);
}

// When the persisted keypair changes (e.g. the user re-keyed in another
// context such as the Settings panel), drop our cached CryptoKey so the
// next call re-imports. The locked persisted-id check below also covers
// calls that arrive before this asynchronous notification.
if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (DEVICE_KEY_STORAGE in changes) {
      cached = null;
    }
  });
}

/**
 * SHA-256 over the canonical-JSON of the public-key JWK. Truncated to 16
 * hex chars so it's short enough to render in the UI but unambiguous in
 * practice (~64 bits of entropy).
 */
async function computePublicKeyId(publicKeyJwk: JsonWebKey): Promise<string> {
  const canonical = canonicalJson(publicKeyJwk as Record<string, unknown>);
  const buf = new TextEncoder().encode(canonical);
  const hashBuf = await crypto.subtle.digest('SHA-256', buf);
  const bytes = new Uint8Array(hashBuf);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, '0');
  }
  return hex.slice(0, 16);
}

/**
 * Canonical-JSON used here AND by receipt.ts: keys sorted alphabetically,
 * no whitespace, recursive. Exported so downstream signing / verification
 * uses the exact same routine — any drift would make the public-key ID
 * unstable.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map((v) => canonicalJson(v)).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const k of keys) {
    parts.push(JSON.stringify(k) + ':' + canonicalJson(obj[k]));
  }
  return '{' + parts.join(',') + '}';
}

async function generateNewKeyPair(): Promise<StoredDeviceKey> {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const privateKeyJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const publicKeyJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  // Strip private bits from the public JWK — exportKey on the public key
  // already does this, but be defensive.
  delete (publicKeyJwk as { d?: string }).d;
  const publicKeyId = await computePublicKeyId(publicKeyJwk);
  return {
    privateKeyJwk,
    publicKeyJwk,
    publicKeyId,
    createdAt: Date.now(),
  };
}

async function importStored(stored: StoredDeviceKey): Promise<DeviceKey> {
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    stored.privateKeyJwk,
    { name: 'Ed25519' },
    false,
    ['sign'],
  );
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    stored.publicKeyJwk,
    { name: 'Ed25519' },
    true,
    ['verify'],
  );
  return {
    publicKeyJwk: stored.publicKeyJwk,
    privateKey,
    publicKey,
    publicKeyId: stored.publicKeyId,
    createdAt: stored.createdAt,
  };
}

/**
 * Idempotent. First call generates the keypair and persists it. Every
 * subsequent call (across SW restarts) re-imports from storage. The
 * cached `DeviceKey` survives within a single SW lifetime.
 */
export async function getOrCreateDeviceKey(): Promise<DeviceKey> {
  return withDeviceKeyLock(async () => {
    const stored = await getOne<StoredDeviceKey>(DEVICE_KEY_STORAGE);
    if (stored && stored.privateKeyJwk && stored.publicKeyJwk && stored.publicKeyId) {
      if (cached?.publicKeyId === stored.publicKeyId) return cached;
      cached = await importStored(stored);
      return cached;
    }
    const fresh = await generateNewKeyPair();
    const imported = await importStored(fresh);
    await prepareHistory(fresh, null);
    await persistActiveKey(fresh, imported, null);
    return imported;
  });
}

/**
 * Convenience accessor for surfaces that only need the public material —
 * e.g. the Settings card showing the publicKeyId.
 */
export async function exportPublicKeyJwk(): Promise<{
  publicKeyJwk: JsonWebKey;
  publicKeyId: string;
  createdAt: number;
}> {
  const k = await getOrCreateDeviceKey();
  return {
    publicKeyJwk: k.publicKeyJwk,
    publicKeyId: k.publicKeyId,
    createdAt: k.createdAt,
  };
}

/**
 * Rotate the device key. The previous public key is appended to the
 * history list (with `retiredAt` set) so prior receipts continue to
 * verify. The new key becomes active immediately. Returns the new
 * publicKeyId.
 */
export async function rotateDeviceKey(): Promise<string> {
  return withDeviceKeyLock(async () => {
    const previous = await getOne<StoredDeviceKey>(DEVICE_KEY_STORAGE);
    const fresh = await generateNewKeyPair();
    const imported = await importStored(fresh);
    // Public lineage is written before the active key can sign. A failure
    // here leaves the old active key in place, so another rotation is safe.
    await prepareHistory(fresh, previous);
    await persistActiveKey(fresh, imported, previous?.publicKeyId ?? null);
    return fresh.publicKeyId;
  });
}

async function prepareHistory(
  fresh: StoredDeviceKey,
  previous: StoredDeviceKey | null,
): Promise<void> {
  const list = (await getOne<StoredHistoryEntry[]>(PUBLIC_KEY_HISTORY_STORAGE)) ?? [];
  const next = list.map((entry) =>
    entry.publicKeyId === previous?.publicKeyId
      ? { ...entry, retiredAt: fresh.createdAt, pending: false }
      : entry,
  );
  if (previous && !next.some((entry) => entry.publicKeyId === previous.publicKeyId)) {
    next.push({
      publicKeyJwk: previous.publicKeyJwk,
      publicKeyId: previous.publicKeyId,
      createdAt: previous.createdAt,
      retiredAt: fresh.createdAt,
    });
  }
  next.push({
    publicKeyJwk: fresh.publicKeyJwk,
    publicKeyId: fresh.publicKeyId,
    createdAt: fresh.createdAt,
    retiredAt: null,
    pending: true,
  });
  await setOne(PUBLIC_KEY_HISTORY_STORAGE, next);
}

async function persistActiveKey(
  fresh: StoredDeviceKey,
  imported: DeviceKey,
  previousId: string | null,
): Promise<void> {
  try {
    await setOne(DEVICE_KEY_STORAGE, fresh);
  } catch (writeError) {
    let observed: StoredDeviceKey | null;
    try {
      observed = await getOne<StoredDeviceKey>(DEVICE_KEY_STORAGE);
    } catch {
      cached = null;
      throw new DeviceKeyOutcomeUnknownError();
    }
    if (observed?.publicKeyId !== fresh.publicKeyId) {
      if ((observed?.publicKeyId ?? null) !== previousId) {
        cached = null;
        throw new DeviceKeyOutcomeUnknownError();
      }
      throw writeError;
    }
  }
  cached = imported;
}

/**
 * Walk the persisted history. Used by `verifyReceipt` to find the right
 * public key for a given receipt's `publicKeyId`. Newest first.
 */
export async function getPublicKeyHistory(): Promise<PublicKeyHistoryEntry[]> {
  return withDeviceKeyLock(async () => {
    const list = (await getOne<StoredHistoryEntry[]>(PUBLIC_KEY_HISTORY_STORAGE)) ?? [];
    const active = await getOne<StoredDeviceKey>(DEVICE_KEY_STORAGE);
    return list
      .filter((entry) => !entry.pending || entry.publicKeyId === active?.publicKeyId)
      .map(({ pending: _pending, ...entry }) =>
        entry.publicKeyId === active?.publicKeyId ? { ...entry, retiredAt: null } : entry,
      )
      .reverse();
  });
}

/**
 * Look up a historical public key by id. Returns null when the receipt
 * was signed by a key that's not on file (e.g. the user cleared local
 * storage between signing and verification).
 */
export async function getPublicKeyById(publicKeyId: string): Promise<JsonWebKey | null> {
  return withDeviceKeyLock(async () => {
    const list = (await getOne<StoredHistoryEntry[]>(PUBLIC_KEY_HISTORY_STORAGE)) ?? [];
    const match = list.find((entry) => entry.publicKeyId === publicKeyId);
    if (match?.pending) {
      const active = await getOne<StoredDeviceKey>(DEVICE_KEY_STORAGE);
      if (active?.publicKeyId !== publicKeyId) return null;
    }
    return match?.publicKeyJwk ?? null;
  });
}

/**
 * Test-only / re-key helper for clearing the in-process cache. Production
 * callers should never need this.
 */
export function _resetDeviceKeyCacheForTest(): void {
  cached = null;
}
