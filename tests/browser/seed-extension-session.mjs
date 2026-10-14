/**
 * The one walk sign-in seed: writes the session the extension itself would have
 * stored after an OAuth sign-in. Format owned by @ai-matrx/auth matrx-oauth
 * (key `matrx.oauth.session`, JSON {v:1, clientId, personId, email, accessToken,
 * refreshToken (sealed `ct.iv`, src/lib/auth/crypto.ts), expiresAtMs}).
 * The retired `matrx.auth.accessToken/refreshTokenEnc/...` keys are ignored by the
 * panel, which then reads "Could not restore your saved sign-in".
 *
 * Call with a page that is open on a chrome-extension:// URL; reload afterwards.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

/** The OAuth client id the built extension was configured with (same env files WXT reads). */
export function extensionOAuthClientId(repo) {
  const env = {
    ...readEnvFile(join(repo, '.env')),
    ...readEnvFile(join(repo, '.env.development')),
  };
  const id = env.WXT_EXTENSION_OAUTH_CLIENT_ID;
  if (!id) throw new Error('REFUSED: WXT_EXTENSION_OAUTH_CLIENT_ID is not set');
  return id;
}

/** `session` is a Supabase password-grant response (access_token, refresh_token, expires_in, user). */
export async function seedExtensionSession(page, { session, clientId, organization }) {
  await page.evaluate(
    async ([accessToken, refreshToken, expiresIn, user, org, oauthClientId]) => {
      const enc = new TextEncoder();
      const base = await crypto.subtle.importKey(
        'raw',
        enc.encode('matrx-extend.refresh-token.v1'),
        { name: 'PBKDF2' },
        false,
        ['deriveKey'],
      );
      const key = await crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: enc.encode(chrome.runtime.id),
          iterations: 100_000,
          hash: 'SHA-256',
        },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt'],
      );
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(
        await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(refreshToken)),
      );
      const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
      await chrome.storage.local.set({
        'matrx.oauth.session': JSON.stringify({
          v: 1,
          clientId: oauthClientId,
          personId: user.id,
          email: user.email ?? null,
          accessToken,
          refreshToken: `${b64(ct)}.${b64(iv)}`,
          expiresAtMs: Date.now() + expiresIn * 1000,
        }),
        'matrx.user.profile': user,
        'matrx.org.active': org,
      });
    },
    [
      session.access_token,
      session.refresh_token,
      session.expires_in ?? 3600,
      session.user,
      organization,
      clientId,
    ],
  );
}
