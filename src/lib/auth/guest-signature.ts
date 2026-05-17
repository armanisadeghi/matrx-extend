/**
 * Guest signature — stable per-install identifier sent as X-Fingerprint-ID
 * when there's no signed-in Supabase session.
 *
 * The server's matrx_connect AuthMiddleware reads this header, looks up (or
 * mints) an anonymous auth.users row via guest_registry, and sets
 * ctx.auth_type='fingerprint'. From the server's perspective the guest is a
 * real (anonymous) user — same user_id forever, until they sign up and
 * convert via link_guest_to_user().
 *
 * Composition: sha256(chrome.runtime.id | nonce | createdAt). The nonce is a
 * 32-byte random generated once on first read and persisted in
 * chrome.storage.local. Clearing extension storage is a free reset — that's
 * fine for now. Honest-people-honest scope.
 *
 * Called from the SW, the sidepanel, and the offscreen. chrome.storage is
 * shared across all three contexts, so the value is consistent.
 */

import { STORAGE_KEYS } from '@/config/env';

let memoCache: string | null = null;
let memoPromise: Promise<string> | null = null;

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(digest));
}

async function mintNonce(): Promise<{ nonce: string; createdAt: number }> {
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  const nonce = bytesToHex(raw);
  const createdAt = Date.now();
  await chrome.storage.local.set({
    [STORAGE_KEYS.GUEST_NONCE]: nonce,
    [STORAGE_KEYS.GUEST_CREATED_AT]: createdAt,
  });
  return { nonce, createdAt };
}

async function compute(): Promise<string> {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.GUEST_SIGNATURE,
    STORAGE_KEYS.GUEST_NONCE,
    STORAGE_KEYS.GUEST_CREATED_AT,
  ]);
  const cachedSig = stored[STORAGE_KEYS.GUEST_SIGNATURE] as string | undefined;
  if (cachedSig && typeof cachedSig === 'string' && cachedSig.length === 64) {
    return cachedSig;
  }
  let nonce = stored[STORAGE_KEYS.GUEST_NONCE] as string | undefined;
  let createdAt = stored[STORAGE_KEYS.GUEST_CREATED_AT] as number | undefined;
  if (!nonce || !createdAt) {
    const minted = await mintNonce();
    nonce = minted.nonce;
    createdAt = minted.createdAt;
  }
  const installId = chrome.runtime.id;
  const signature = await sha256Hex(`${installId}|${nonce}|${createdAt}`);
  await chrome.storage.local.set({ [STORAGE_KEYS.GUEST_SIGNATURE]: signature });
  return signature;
}

/**
 * Returns the stable guest signature, minting one on first call.
 * Safe to call repeatedly; concurrent callers share the same in-flight
 * promise so we never mint two nonces in a race.
 */
export async function getOrCreateGuestSignature(): Promise<string> {
  if (memoCache) return memoCache;
  if (memoPromise) return memoPromise;
  memoPromise = compute()
    .then((sig) => {
      memoCache = sig;
      return sig;
    })
    .finally(() => {
      memoPromise = null;
    });
  return memoPromise;
}

/**
 * Drop the in-memory cache. Call after sign-up conversion so the next
 * caller re-reads from storage (which the converted guest may have cleared
 * server-side, though we currently keep the signature so guest history
 * survives the upgrade).
 */
export function clearGuestSignatureMemo(): void {
  memoCache = null;
  memoPromise = null;
}
