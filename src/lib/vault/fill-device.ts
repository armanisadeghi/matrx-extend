/**
 * This browser's own credential for the vault fill path (access ladder T-30).
 *
 * The server answers the fill routes (`/browser-login/{id}/materialize`,
 * `/authenticator-materialize`) only for a request SIGNED by a key this browser
 * holds, sent with a token of the extension's own (still-live) OAuth session,
 * carrying a one-time nonce. The person's web sign-in — even one a script turned
 * into an extension sign-in — is refused.
 *
 * The key: ECDSA P-256 generated here with `extractable: false`. The private half
 * can sign but can never be read out or copied off this browser profile; IndexedDB
 * stores the CryptoKey object itself. One key per signed-in person on this profile.
 *
 * Turning filling on here needs the person's AI Matrx password (owner ruling
 * 2026-09-28, the 1Password/Bitwarden "unlock each new browser" bar): the side
 * panel's Vault tab asks for it once and sends it with the public key to
 * `POST /api/vault/fill-devices`; nothing here stores it. Turning a browser off in
 * the web Vault ("Browsers") ends this extension's sign-in; after signing in again
 * the person confirms their password again.
 *
 * Wire contract (must match aidream `fill_devices.canonical_fill_message`, v2):
 *   "matrx-vault-fill/v2\n{surface}\n{itemId}\n{timestampMs}\n{nonce}\n{deviceId}\n{userId}\n{sha256hex(body)}"
 * signed with ECDSA/SHA-256, raw r||s base64url in X-Matrx-Fill-Signature.
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
const MESSAGE_PREFIX = 'matrx-vault-fill/v2';

export const FILL_SETUP_REQUIRED_MESSAGE =
  'Filling saved passwords is not turned on in this browser yet. Open the Vault tab in the AI Matrx side panel and confirm your password to turn it on.';

interface StoredDeviceKey {
  userId: string;
  privateKey: CryptoKey;
  publicJwk: { kty: 'EC'; crv: 'P-256'; x: string; y: string };
  /** Set once the server accepted the key for this person's current sign-in. */
  deviceId: string | null;
}

interface FillDeviceOut {
  id: string;
  revoked_at: string | null;
}

export type FillDeviceFailure =
  | { kind: 'sign_in_required' }
  | { kind: 'setup_required'; message: string }
  | { kind: 'refused'; message: string }
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

function newNonce(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(24)));
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

/** The server's refusal code and sentence from a failed call, when it sent them. */
export function refusalOf(result: ApiResult<unknown>): {
  code: string | null;
  message: string | null;
} {
  if (result.ok) return { code: null, message: null };
  try {
    const body = JSON.parse(result.error) as Record<string, unknown>;
    const detail = (body.detail && typeof body.detail === 'object' ? body.detail : body) as Record<
      string,
      unknown
    >;
    const code = typeof detail.error === 'string' ? detail.error : null;
    const message =
      typeof detail.user_message === 'string'
        ? detail.user_message
        : typeof detail.message === 'string'
          ? detail.message
          : null;
    return { code, message };
  } catch {
    return { code: null, message: null };
  }
}

/** Whether filling is turned on in this browser for the signed-in person. */
export async function fillDeviceStatus(): Promise<'on' | 'off' | 'signed_out'> {
  const user = await getCurrentUser();
  if (!user?.id) return 'signed_out';
  try {
    return (await readKey(user.id))?.deviceId ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

/** The server no longer accepts this browser's registration (e.g. a new sign-in). */
export async function markFillDeviceUnregistered(): Promise<void> {
  const user = await getCurrentUser();
  if (!user?.id) return;
  try {
    const record = await readKey(user.id);
    if (record?.deviceId) await writeKey({ ...record, deviceId: null });
  } catch {
    // The store is gone: nothing is registered here either way.
  }
}

/**
 * Turn filling on in this browser: register (or re-bind) this browser's key with
 * the person's password as the step-up. The password is sent once and never kept.
 */
export async function turnOnFillingHere(
  password: string,
): Promise<{ ok: true } | { ok: false; failure: FillDeviceFailure }> {
  const user = await getCurrentUser();
  if (!user?.id) return { ok: false, failure: { kind: 'sign_in_required' } };
  for (let attempt = 0; attempt < 2; attempt++) {
    let record = await readKey(user.id).catch(() => undefined);
    if (!record) record = await createKey(user.id);
    const r = await apiPost<FillDeviceOut>(
      REGISTER_PATH,
      {
        public_key_jwk: record.publicJwk,
        label: browserLabel(),
        extension_origin: typeof location !== 'undefined' ? location.origin : null,
        password,
      },
      undefined,
      { silent: true },
    );
    if (r.ok && r.data && typeof r.data.id === 'string') {
      await writeKey({ ...record, deviceId: r.data.id });
      log.info('api', '← vault fill device ready');
      return { ok: true };
    }
    if (!r.ok && r.status === 401) return { ok: false, failure: { kind: 'sign_in_required' } };
    const refusal = refusalOf(r);
    const message = refusal.message ?? 'This browser could not be set up to fill.';
    if (!r.ok && r.status === 403 && refusal.code === 'key_revoked' && attempt === 0) {
      // This browser's old key was turned off: start over with a new key.
      await deleteKey(user.id);
      continue;
    }
    if (!r.ok && r.status === 403) return { ok: false, failure: { kind: 'refused', message } };
    return { ok: false, failure: { kind: 'unavailable', message } };
  }
  return {
    ok: false,
    failure: { kind: 'unavailable', message: 'This browser could not be set up to fill.' },
  };
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
}): Promise<FillHeadersResult> {
  const user = await getCurrentUser();
  if (!user?.id) return { ok: false, failure: { kind: 'sign_in_required' } };
  let record: StoredDeviceKey | undefined;
  try {
    record = await readKey(user.id);
  } catch (err) {
    log.warn('api', 'vault fill device unavailable', { reason: (err as Error).name });
  }
  if (!record?.deviceId) {
    return { ok: false, failure: { kind: 'setup_required', message: FILL_SETUP_REQUIRED_MESSAGE } };
  }
  const deviceId = record.deviceId;
  const timestamp = String(Date.now());
  const nonce = newNonce();
  const message = [
    MESSAGE_PREFIX,
    params.surface,
    params.itemId,
    timestamp,
    nonce,
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
      'X-Matrx-Fill-Nonce': nonce,
      'X-Matrx-Fill-Signature': b64url(signature),
    },
  };
}
