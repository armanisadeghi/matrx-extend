/**
 * The extension's own credential for the vault fill path (access ladder T-30).
 *
 * A saved value a person may only USE leaves the server only to be typed into a
 * sign-in page. The server now answers the fill routes (`/browser-login/{id}/
 * materialize`, `/authenticator-materialize`) only when the request is SIGNED by
 * a key this browser holds and was sent with a token from the extension's own
 * OAuth session. The person's web sign-in token plus a forged extension Origin —
 * the scripted door T-28 left open — is refused.
 *
 * The key: ECDSA P-256 generated here with `extractable: false`. The private
 * half can sign but can never be read out, exported, or copied off this
 * browser profile; IndexedDB stores the CryptoKey object itself (structured
 * clone keeps it non-extractable). Only the public JWK is sent to the server,
 * once, at registration (`POST /api/vault/fill-devices`). One key per signed-in
 * person on this profile.
 *
 * Revocation: the person can turn a browser off in the vault settings. The
 * server then refuses this key and any new key from the same session; signing
 * in to the extension again starts a new session and a new registration.
 *
 * Wire contract (must match aidream `fill_devices.canonical_fill_message`):
 *   "matrx-vault-fill/v1\n{surface}\n{itemId}\n{timestampMs}\n{deviceId}\n{userId}\n{sha256hex(body)}"
 * signed with ECDSA/SHA-256, sent as raw r||s base64url in X-Matrx-Fill-Signature.
 *
 * Nothing here ever holds a vault value.
 */

import { type ApiResult, apiPost } from '@/lib/api/client';
import { getCurrentUser } from '@/lib/auth/flow';
import { log } from '@/lib/debug/log';

export type FillSurface = 'browser_login_materialize' | 'browser_authenticator_materialize';

const DB_NAME = 'matrx-vault-fill-device';
const DB_VERSION = 1;
const STORE = 'keys';
const REGISTER_PATH = '/api/vault/fill-devices';
const MESSAGE_PREFIX = 'matrx-vault-fill/v1';

interface StoredDeviceKey {
  userId: string;
  privateKey: CryptoKey;
  publicJwk: { kty: 'EC'; crv: 'P-256'; x: string; y: string };
  /** Set once the server accepted the key for this user's current session. */
  deviceId: string | null;
}

interface FillDeviceOut {
  id: string;
  revoked_at: string | null;
}

export type FillDeviceFailure =
  | { kind: 'sign_in_required' }
  | { kind: 'device_revoked'; message: string }
  | { kind: 'unavailable'; message: string };

export type FillHeadersResult =
  | { ok: true; headers: Record<string, string>; deviceId: string }
  | { ok: false; failure: FillDeviceFailure };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'userId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('fill-device store unavailable'));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = work(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('fill-device store failed'));
    });
  } finally {
    db.close();
  }
}

async function readKey(userId: string): Promise<StoredDeviceKey | undefined> {
  return withStore<StoredDeviceKey | undefined>(
    'readonly',
    (s) => s.get(userId) as IDBRequest<StoredDeviceKey | undefined>,
  );
}

async function writeKey(record: StoredDeviceKey): Promise<void> {
  await withStore('readwrite', (s) => s.put(record));
}

async function deleteKey(userId: string): Promise<void> {
  await withStore('readwrite', (s) => s.delete(userId));
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const b of view) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function createKey(userId: string): Promise<StoredDeviceKey> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  if (!jwk.x || !jwk.y) throw new Error('public key export incomplete');
  const record: StoredDeviceKey = {
    userId,
    privateKey: pair.privateKey,
    publicJwk: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y },
    deviceId: null,
  };
  await writeKey(record);
  return record;
}

function browserLabel(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Safari\//.test(ua) && !/Chrome\//.test(ua)
        ? 'Safari'
        : 'Chrome';
  const os = /Mac OS X/.test(ua)
    ? 'Mac'
    : /Windows/.test(ua)
      ? 'Windows'
      : /Linux/.test(ua)
        ? 'Linux'
        : 'computer';
  return `${browser} on ${os}`;
}

function refusalMessage(result: ApiResult<unknown>): string {
  return !result.ok && result.error ? result.error : 'This browser could not be set up to fill.';
}

async function register(record: StoredDeviceKey): Promise<FillDeviceOut | FillDeviceFailure> {
  const r = await apiPost<FillDeviceOut>(REGISTER_PATH, {
    public_key_jwk: record.publicJwk,
    label: browserLabel(),
    extension_origin: typeof location !== 'undefined' ? location.origin : null,
  });
  if (r.ok) {
    if (r.data && typeof r.data.id === 'string') return r.data;
    return { kind: 'unavailable', message: 'The server answered without a device id.' };
  }
  if (r.status === 401) return { kind: 'sign_in_required' };
  if (r.status === 403) return { kind: 'device_revoked', message: refusalMessage(r) };
  return { kind: 'unavailable', message: refusalMessage(r) };
}

function isFailure(value: FillDeviceOut | FillDeviceFailure): value is FillDeviceFailure {
  return 'kind' in value;
}

/**
 * Make sure this browser has a registered device key for the signed-in person.
 * `forceRegister` re-registers the stored key (the server re-binds it to the
 * current extension session, e.g. after the person signed in again).
 */
async function ensureDevice(
  userId: string,
  forceRegister: boolean,
): Promise<StoredDeviceKey | FillDeviceFailure> {
  let record = await readKey(userId);
  if (!record) record = await createKey(userId);
  if (record.deviceId && !forceRegister) return record;
  const registered = await register(record);
  if (isFailure(registered)) {
    if (registered.kind === 'device_revoked') {
      // The server turned this key off. Drop it so the next sign-in starts fresh
      // with a new key; until then filling stays off and says so.
      await deleteKey(userId);
    }
    return registered;
  }
  record = { ...record, deviceId: registered.id };
  await writeKey(record);
  log.info('api', '← vault fill device ready');
  return record;
}

/**
 * Signed headers for ONE fill request. `body` must be the exact object the
 * request sends: it is serialized with JSON.stringify here exactly as the API
 * client serializes it, and the signature covers its SHA-256.
 */
export async function signFillRequest(params: {
  surface: FillSurface;
  itemId: string;
  body: unknown;
  forceRegister?: boolean;
}): Promise<FillHeadersResult> {
  const user = await getCurrentUser();
  if (!user?.id) return { ok: false, failure: { kind: 'sign_in_required' } };
  let record: StoredDeviceKey | FillDeviceFailure;
  try {
    record = await ensureDevice(user.id, params.forceRegister === true);
  } catch (err) {
    log.warn('api', 'vault fill device unavailable', { reason: (err as Error).name });
    return {
      ok: false,
      failure: {
        kind: 'unavailable',
        message: 'This browser could not keep its fill key. Reload the extension and try again.',
      },
    };
  }
  if ('kind' in record) return { ok: false, failure: record };
  const deviceId = record.deviceId as string;
  const timestamp = String(Date.now());
  const message = [
    MESSAGE_PREFIX,
    params.surface,
    params.itemId,
    timestamp,
    deviceId,
    user.id,
    await sha256Hex(JSON.stringify(params.body)),
  ].join('\n');
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    record.privateKey,
    new TextEncoder().encode(message),
  );
  return {
    ok: true,
    deviceId,
    headers: {
      'X-Matrx-Fill-Device': deviceId,
      'X-Matrx-Fill-Timestamp': timestamp,
      'X-Matrx-Fill-Signature': b64url(signature),
    },
  };
}
