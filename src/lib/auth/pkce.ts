/**
 * OAuth 2.1 PKCE helpers.
 *
 * Mirrors matrx-local/desktop/src/lib/oauth.ts. The verifier is persisted in
 * `chrome.storage.session` for the duration of the flow and only the random
 * nonce travels as the `state` parameter. (An earlier design encoded the
 * verifier INTO `state` — that round-trips it through every authorize /
 * consent / callback URL, handing `code` + `verifier` to anyone who can
 * observe either and structurally defeating PKCE's interception protection.
 * Retired 2026-06-10, audit P3-7.)
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
