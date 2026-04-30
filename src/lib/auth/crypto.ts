/**
 * AES-GCM encryption for the refresh token at rest.
 *
 * Key derivation: PBKDF2(salt = chrome.runtime.id) → AES-GCM 256.
 * Bound to the install (the runtime ID is stable for a given Chrome profile +
 * extension key). No user passphrase. Belt-and-suspenders over the OS-level
 * encryption Chrome already applies to chrome.storage.local.
 */

const ITERATIONS = 100_000;
const PURPOSE = 'matrx-extend.refresh-token.v1';

let cachedKey: CryptoKey | null = null;

async function getKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const enc = new TextEncoder();
  const saltBytes = enc.encode(chrome.runtime.id);
  const purposeBytes = enc.encode(PURPOSE);
  const salt = saltBytes.buffer.slice(
    saltBytes.byteOffset,
    saltBytes.byteOffset + saltBytes.byteLength,
  ) as ArrayBuffer;
  const baseMaterial = purposeBytes.buffer.slice(
    purposeBytes.byteOffset,
    purposeBytes.byteOffset + purposeBytes.byteLength,
  ) as ArrayBuffer;
  const baseKey = await crypto.subtle.importKey('raw', baseMaterial, { name: 'PBKDF2' }, false, [
    'deriveKey',
  ]);
  cachedKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  return cachedKey;
}

function bytesToBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.byteLength; i++) s += String.fromCharCode(bytes[i] as number);
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function uint8ToArrayBuffer(u: Uint8Array): ArrayBuffer {
  // Slice creates a fresh ArrayBuffer — sidesteps Uint8Array<ArrayBufferLike>
  // being not assignable to BufferSource on TS 5.7+ when SharedArrayBuffer is in scope.
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

export async function encryptString(plaintext: string): Promise<{ ct: string; iv: string }> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(plaintext);
  const ctBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: uint8ToArrayBuffer(iv) },
    key,
    uint8ToArrayBuffer(data),
  );
  return { ct: bytesToBase64(ctBuf), iv: bytesToBase64(iv) };
}

export async function decryptString(payload: { ct: string; iv: string }): Promise<string> {
  const key = await getKey();
  const iv = base64ToBytes(payload.iv);
  const ct = base64ToBytes(payload.ct);
  const ptBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: uint8ToArrayBuffer(iv) },
    key,
    uint8ToArrayBuffer(ct),
  );
  return new TextDecoder().decode(ptBuf);
}
