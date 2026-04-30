/**
 * OAuth 2.1 PKCE helpers.
 *
 * Mirrors matrx-local/desktop/src/lib/oauth.ts. Key difference: we don't
 * persist the verifier in storage — we encode it into the `state` parameter
 * (`<verifier>.<nonce>`) so it survives the cross-origin trip through
 * Supabase + aimatrx.com consent UI back to chromiumapp.org. Same trick.
 *
 * Why not openid? The Matrx Supabase project signs JWTs HS256. Requesting the
 * openid scope makes Supabase try to mint an ID token, which needs asymmetric
 * keys → 500 "Error generating ID token". Use scope=email profile.
 */

function base64URLEncode(buffer: Uint8Array | ArrayBuffer): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let s = '';
  for (let i = 0; i < bytes.byteLength; i++) s += String.fromCharCode(bytes[i] as number);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64URLEncode(array);
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return base64URLEncode(new Uint8Array(hash));
}

export function generateNonce(): string {
  return base64URLEncode(crypto.getRandomValues(new Uint8Array(16)));
}

/**
 * State format: `<verifier>.<nonce>`.
 * Split on the first dot only; base64url chars don't include dots.
 */
export function encodeState(verifier: string, nonce: string): string {
  return `${verifier}.${nonce}`;
}

export function extractVerifierFromState(state: string): string | null {
  const dotIdx = state.indexOf('.');
  if (dotIdx === -1) return null;
  return state.slice(0, dotIdx) || null;
}
