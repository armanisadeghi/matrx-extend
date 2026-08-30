/**
 * OAuth 2.1 PKCE flow for the Chrome extension.
 *
 * Mirrors matrx-local — talks directly to Supabase /auth/v1/oauth/{authorize,token}.
 * Supabase renders the aimatrx.com-branded consent page itself.
 *
 * The browser-side hop is handled by chrome.identity.launchWebAuthFlow, which
 * opens a Chrome-managed auth window and resolves with the redirect URL once
 * Supabase bounces the user back to https://<extension-id>.chromiumapp.org/.
 */

import { ALARMS, ENV, STORAGE_KEYS } from '@/config/env';
import { decryptString, encryptString } from '@/lib/auth/crypto';
import { generateCodeChallenge, generateCodeVerifier, generateNonce } from '@/lib/auth/pkce';
import { type OAuthTokens, OAuthTokensSchema, type UserProfile } from '@/lib/auth/types';
import { log } from '@/lib/debug/log';
import { Mutex, truncate } from '@/lib/utils';

const refreshMutex = new Mutex();

const authorizeUrl = (): string => `${ENV.SUPABASE_URL}/auth/v1/oauth/authorize`;
const tokenUrl = (): string => `${ENV.SUPABASE_URL}/auth/v1/oauth/token`;

export function getRedirectUri(): string {
  // Recompute lazily — chrome.identity is not available in offscreen / content
  // contexts but this module is only imported from SW + UI surfaces.
  return chrome.identity.getRedirectURL();
}

/**
 * Build the authorize URL and launch the browser-side hop.
 * Caller waits on the returned promise; resolves once tokens are stored.
 */
export async function signIn(): Promise<{ user: UserProfile; tokens: OAuthTokens }> {
  if (!ENV.EXTENSION_OAUTH_CLIENT_ID) {
    throw new Error(
      'WXT_EXTENSION_OAUTH_CLIENT_ID is not set. Register the extension as a public PKCE client in the Matrx Supabase dashboard, then add the client ID to .env.* files.',
    );
  }

  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const nonce = generateNonce();
  // The verifier is PERSISTED locally and only the random nonce travels as
  // `state` (audit P3-7). The previous `<verifier>.<nonce>` state format put
  // the verifier into the authorize URL itself — round-tripping through
  // Supabase, the consent page, and the callback — which hands `code` +
  // `verifier` to anyone who can observe either URL and structurally defeats
  // PKCE's interception protection. chrome.storage.session matches the
  // flow's lifetime (cleared with the browser session, survives SW restarts).
  const state = nonce;
  await chrome.storage.session.set({ [STORAGE_KEYS.PKCE_VERIFIER]: verifier });
  const redirectUri = getRedirectUri();

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: ENV.EXTENSION_OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    // Never include 'openid' — see plan §3, fact #2.
    scope: 'email profile',
  });

  const url = `${authorizeUrl()}?${params.toString()}`;

  // Log origins/paths only — the full authorize/callback URLs carry `state`
  // and (on callback) the single-use auth `code`; a shared debug-log dump
  // must not contain replayable material (audit P3-9).
  log.info('auth', 'OAuth sign-in starting', {
    redirectUri,
    clientId: ENV.EXTENSION_OAUTH_CLIENT_ID,
    authorizeOrigin: new URL(url).origin + new URL(url).pathname,
  });

  const callbackUrl = await launchWebAuthFlow(url);
  log.info('auth', 'callback received', {
    callbackOrigin: new URL(callbackUrl).origin + new URL(callbackUrl).pathname,
  });
  const { code, returnedState } = parseCallbackUrl(callbackUrl);
  if (returnedState !== state) {
    throw new Error('OAuth state mismatch — possible CSRF, ignoring response');
  }
  const verifierRow = await chrome.storage.session.get([STORAGE_KEYS.PKCE_VERIFIER]);
  const recoveredVerifier = verifierRow[STORAGE_KEYS.PKCE_VERIFIER] as string | undefined;
  // Single-use: clear immediately so a replayed callback can't re-exchange.
  await chrome.storage.session.remove([STORAGE_KEYS.PKCE_VERIFIER]);
  if (!recoveredVerifier || recoveredVerifier !== verifier) {
    throw new Error('Could not recover code_verifier for this sign-in attempt');
  }

  log.info('auth', 'exchanging code for tokens');
  const tokens = await exchangeCode(code, recoveredVerifier, redirectUri);
  await persistTokens(tokens);
  scheduleRefresh(tokens);

  log.info('auth', 'fetching user profile');
  const user = await fetchSupabaseUser(tokens.access_token);
  await chrome.storage.local.set({ [STORAGE_KEYS.USER_PROFILE]: user });
  log.success('auth', `signed in as ${user.email ?? user.id}`);
  return { user, tokens };
}

export async function signOut(): Promise<void> {
  // Best-effort SERVER-SIDE revocation first (audit P3-6) — without it the
  // refresh token stayed valid until natural expiry after a local sign-out.
  try {
    const stored = await chrome.storage.local.get([STORAGE_KEYS.ACCESS_TOKEN]);
    const access = stored[STORAGE_KEYS.ACCESS_TOKEN] as string | undefined;
    if (access) {
      await fetch(`${ENV.SUPABASE_URL}/auth/v1/logout`, {
        method: 'POST',
        headers: {
          apikey: ENV.SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${access}`,
        },
      });
    }
  } catch {
    /* revocation is best-effort — local cleanup proceeds regardless */
  }
  await chrome.storage.local.remove([
    STORAGE_KEYS.USER_PROFILE,
    STORAGE_KEYS.ACCESS_TOKEN,
    STORAGE_KEYS.REFRESH_TOKEN_ENC,
    STORAGE_KEYS.REFRESH_TOKEN_IV,
    STORAGE_KEYS.TOKEN_EXPIRES_AT,
    // The organization is part of the signed-in identity: a different user
    // signing in on this install must never inherit the last user's
    // organization.
    STORAGE_KEYS.ACTIVE_ORGANIZATION,
  ]);
  // Drop the in-memory Supabase JS session in THIS context too (audit P3-5
  // — `clearSupabaseSession` previously had zero callers, so the
  // authenticated client survived sign-out until the context died). Other
  // contexts clear via their own sign-out broadcast handling / next boot.
  try {
    const { clearSupabaseSession } = await import('@/lib/supabase/client');
    clearSupabaseSession();
  } catch {
    /* best-effort */
  }
  try {
    await chrome.alarms.clear(ALARMS.TOKEN_REFRESH);
  } catch {
    /* alarm may not exist; ignore */
  }
}

/** Stored-token read with the 60s freshness margin applied. */
async function readFreshAccessToken(): Promise<string | null> {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.ACCESS_TOKEN,
    STORAGE_KEYS.TOKEN_EXPIRES_AT,
    // The organization is part of the signed-in identity: a different user
    // signing in on this install must never inherit the last user's
    // organization.
    STORAGE_KEYS.ACTIVE_ORGANIZATION,
  ]);
  const accessToken = stored[STORAGE_KEYS.ACCESS_TOKEN] as string | undefined;
  const expiresAt = stored[STORAGE_KEYS.TOKEN_EXPIRES_AT] as number | undefined;
  if (accessToken && expiresAt && Date.now() < expiresAt - 60_000) {
    return accessToken;
  }
  return null;
}

/**
 * Returns a fresh access token, refreshing if necessary. Single-flight via mutex.
 */
export async function getAccessToken(): Promise<string | null> {
  return refreshMutex.run(async () => {
    const fresh = await readFreshAccessToken();
    if (fresh) return fresh;
    const tokens = await doRefresh();
    return tokens?.access_token ?? null;
  });
}

/**
 * Force-refresh; called from chrome.alarms and from the 401-retry path.
 *
 * Single-flight (audit P1-1): this used to run UNguarded — N in-flight
 * requests hitting 401 simultaneously each POSTed the same rotating refresh
 * token, and the loser's 400 triggered a `signOut()` that wiped the winner's
 * freshly-persisted valid tokens (spurious sign-out under request bursts).
 * Now it takes the same mutex as `getAccessToken` (the inner `doRefresh` is
 * the unguarded body, so there's no re-entrancy deadlock) and re-checks
 * freshness after acquiring — the losers of an intra-context race simply
 * return the winner's token.
 */
export async function refreshAccessToken(): Promise<{ access_token: string } | null> {
  return refreshMutex.run(async () => {
    // Someone else may have refreshed while we waited on the mutex.
    const fresh = await readFreshAccessToken();
    if (fresh) return { access_token: fresh };
    return doRefresh();
  });
}

async function doRefresh(): Promise<OAuthTokens | null> {
  if (!ENV.EXTENSION_OAUTH_CLIENT_ID) return null;
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.REFRESH_TOKEN_ENC,
    STORAGE_KEYS.REFRESH_TOKEN_IV,
  ]);
  const ct = stored[STORAGE_KEYS.REFRESH_TOKEN_ENC] as string | undefined;
  const iv = stored[STORAGE_KEYS.REFRESH_TOKEN_IV] as string | undefined;
  if (!ct || !iv) return null;
  let refreshToken: string;
  try {
    refreshToken = await decryptString({ ct, iv });
  } catch (err) {
    console.warn('[matrx-extend] refresh-token decrypt failed', err);
    await signOut();
    return null;
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: ENV.EXTENSION_OAUTH_CLIENT_ID,
    refresh_token: refreshToken,
  });

  const res = await fetch(tokenUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.warn('[matrx-extend] refresh failed', res.status, truncate(text));
    if (res.status === 400 || res.status === 401) {
      // CROSS-context race guard (audit P1-1): the mutex is per-JS-context
      // (SW, sidepanel, offscreen each have their own module instance), so
      // another context may have rotated this refresh token between our
      // read and this POST — Supabase then 400s our now-stale token even
      // though the SESSION is perfectly healthy. Signing out here wiped the
      // winner's fresh tokens. Only sign out when the stored token is still
      // the one that just failed; if it changed, adopt the winner's result.
      const recheck = await chrome.storage.local.get([STORAGE_KEYS.REFRESH_TOKEN_ENC]);
      const ctNow = recheck[STORAGE_KEYS.REFRESH_TOKEN_ENC] as string | undefined;
      if (ctNow && ctNow !== ct) {
        console.info('[matrx-extend] refresh race: another context rotated the token — adopting');
        const fresh = await readFreshAccessToken();
        if (fresh) {
          // Shape-compatible minimal result; callers only use access_token
          // / truthiness.
          return { access_token: fresh } as OAuthTokens;
        }
        return null;
      }
      await signOut();
    }
    return null;
  }
  const json = await res.json();
  const tokens = OAuthTokensSchema.parse(json);
  await persistTokens(tokens);
  scheduleRefresh(tokens);
  return tokens;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function launchWebAuthFlow(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive: true }, (callbackUrl) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!callbackUrl) {
        reject(new Error('OAuth flow cancelled or returned no URL'));
        return;
      }
      resolve(callbackUrl);
    });
  });
}

function parseCallbackUrl(callbackUrl: string): { code: string; returnedState: string } {
  // Supabase delivers `code` and `state` in the query string for the auth-code flow.
  const u = new URL(callbackUrl);
  const code = u.searchParams.get('code');
  const returnedState = u.searchParams.get('state');
  const error = u.searchParams.get('error') || u.searchParams.get('error_description');
  if (error) {
    throw new Error(`OAuth error: ${error}`);
  }
  if (!code || !returnedState) {
    throw new Error('OAuth callback missing code/state');
  }
  return { code, returnedState };
}

async function exchangeCode(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: ENV.EXTENSION_OAUTH_CLIENT_ID,
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri,
  });
  const res = await fetch(tokenUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const detail = extractSupabaseErrorMessage(text);
    throw new Error(`Token exchange failed (${res.status}): ${detail || truncate(text)}`);
  }
  const json = await res.json();
  return OAuthTokensSchema.parse(json);
}

/**
 * Supabase 4xx error bodies use varying shapes. Try them in order.
 * See matrx-oauth/SKILL.md hard-won fact #3.
 */
function extractSupabaseErrorMessage(rawBody: string): string | null {
  try {
    const j = JSON.parse(rawBody) as Record<string, unknown>;
    for (const key of ['error_description', 'error_message', 'msg', 'error', 'code']) {
      const v = j[key];
      if (typeof v === 'string' && v.length > 0) return v;
    }
  } catch {
    /* fall through */
  }
  return null;
}

async function persistTokens(tokens: OAuthTokens): Promise<void> {
  const expiresAt = Date.now() + tokens.expires_in * 1000;
  const enc = await encryptString(tokens.refresh_token);
  await chrome.storage.local.set({
    [STORAGE_KEYS.ACCESS_TOKEN]: tokens.access_token,
    [STORAGE_KEYS.REFRESH_TOKEN_ENC]: enc.ct,
    [STORAGE_KEYS.REFRESH_TOKEN_IV]: enc.iv,
    [STORAGE_KEYS.TOKEN_EXPIRES_AT]: expiresAt,
  });
}

function scheduleRefresh(tokens: OAuthTokens): void {
  // Refresh ~5 min before expiry, but at least 50 minutes from now.
  const minutesUntilExpiry = tokens.expires_in / 60;
  const delayInMinutes = Math.max(5, Math.min(50, minutesUntilExpiry - 5));
  try {
    chrome.alarms.create(ALARMS.TOKEN_REFRESH, { delayInMinutes });
  } catch (err) {
    console.warn('[matrx-extend] failed to schedule refresh alarm', err);
  }
}

async function fetchSupabaseUser(accessToken: string): Promise<UserProfile> {
  const res = await fetch(`${ENV.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: ENV.SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch Supabase user: ${res.status}`);
  }
  const u = await res.json();
  return {
    id: u.id,
    email: u.email ?? null,
    email_verified: u.email_confirmed_at !== null,
    full_name: u.user_metadata?.full_name ?? u.user_metadata?.name ?? null,
    avatar_url: u.user_metadata?.avatar_url ?? null,
  };
}

export async function getCurrentUser(): Promise<UserProfile | null> {
  const result = await chrome.storage.local.get([STORAGE_KEYS.USER_PROFILE]);
  const profile = result[STORAGE_KEYS.USER_PROFILE];
  return profile ? (profile as UserProfile) : null;
}

export async function isAuthenticated(): Promise<boolean> {
  const token = await getAccessToken();
  return !!token;
}

/**
 * Restore the Supabase JS client's session from chrome.storage.local.
 *
 * MUST be called on every context boot (sidepanel mount, SW wake, offscreen
 * load) — otherwise the local Supabase client has no JWT and RLS treats every
 * read as anonymous. Symptom: only `is_public=true` rows come back.
 *
 * Returns true if a session was restored, false otherwise.
 */
export async function restoreSupabaseSession(): Promise<boolean> {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.ACCESS_TOKEN,
    STORAGE_KEYS.REFRESH_TOKEN_ENC,
    STORAGE_KEYS.REFRESH_TOKEN_IV,
  ]);
  const access = stored[STORAGE_KEYS.ACCESS_TOKEN] as string | undefined;
  const ct = stored[STORAGE_KEYS.REFRESH_TOKEN_ENC] as string | undefined;
  const iv = stored[STORAGE_KEYS.REFRESH_TOKEN_IV] as string | undefined;
  if (!access || !ct || !iv) {
    log.info('auth', 'restoreSupabaseSession: no stored tokens');
    return false;
  }
  try {
    const refresh = await decryptString({ ct, iv });
    const { setSupabaseSession } = await import('@/lib/supabase/client');
    await setSupabaseSession(access, refresh);
    log.success('auth', 'supabase session restored from storage');
    return true;
  } catch (err) {
    log.error('auth', 'restoreSupabaseSession failed', err);
    return false;
  }
}
