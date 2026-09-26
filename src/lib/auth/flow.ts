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
import { verifyBearerClaims } from '@/lib/auth/verify-claims';
import { log } from '@/lib/debug/log';
import { broadcast } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { Mutex, truncate } from '@/lib/utils';

const refreshMutex = new Mutex();
const AUTH_MUTATION_LOCK = 'matrx-extend-auth-mutation';
const ACTIVE_AUTH_ATTEMPT_KEY = `${STORAGE_KEYS.PKCE_VERIFIER}.active-attempt`;

const authorizeUrl = (): string => `${ENV.SUPABASE_URL}/auth/v1/oauth/authorize`;
const tokenUrl = (): string => `${ENV.SUPABASE_URL}/auth/v1/oauth/token`;

/**
 * Each OAuth attempt owns its verifier. A single global session key lets a
 * second sidepanel/context attempt overwrite the first before either callback
 * arrives, then the first callback deletes the second attempt's verifier.
 */
function pkceVerifierStorageKey(state: string): string {
  return `${STORAGE_KEYS.PKCE_VERIFIER}.${state}`;
}

class SupersededAuthAttemptError extends Error {
  constructor() {
    super('This sign-in attempt was superseded by a newer authentication change');
  }
}

/**
 * chrome.storage is shared by all extension contexts, so mutations need an
 * origin-wide lock. Never perform OAuth, refresh, or revocation I/O inside
 * this callback; only publish/validate/clear local credentials here.
 */
async function withAuthMutationLock<T>(callback: () => Promise<T>): Promise<T> {
  const locks = navigator.locks;
  if (!locks) {
    throw new Error('Secure authentication storage locking is unavailable in this browser context');
  }
  return locks.request(AUTH_MUTATION_LOCK, { mode: 'exclusive' }, callback);
}

type BrowserIdentityApi = {
  getRedirectURL?: () => string;
  launchWebAuthFlow?: (details: { url: string; interactive: boolean }) => Promise<string | undefined>;
};

function getBrowserIdentity(): BrowserIdentityApi | undefined {
  // Safari exposes the standards-shaped promise API as `browser.identity`.
  // Keep this lookup lazy: content/offscreen contexts do not expose identity.
  return (globalThis as unknown as { browser?: { identity?: BrowserIdentityApi } }).browser?.identity;
}

export function getRedirectUri(): string {
  const browserIdentity = getBrowserIdentity();
  if (browserIdentity?.getRedirectURL) return browserIdentity.getRedirectURL();

  // Chrome retains its callback-oriented `chrome.identity` implementation.
  if (chrome.identity?.getRedirectURL) return chrome.identity.getRedirectURL();
  throw new Error('OAuth sign-in is unavailable because this browser does not provide an identity API');
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
  const attemptId = `oauth:${state}`;
  const verifierStorageKey = pkceVerifierStorageKey(state);
  await withAuthMutationLock(async () => {
    await chrome.storage.session.set({
      [verifierStorageKey]: verifier,
      [ACTIVE_AUTH_ATTEMPT_KEY]: attemptId,
    });
  });
  try {
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
    const verifierRow = await chrome.storage.session.get([verifierStorageKey]);
    const recoveredVerifier = verifierRow[verifierStorageKey] as string | undefined;
    if (!recoveredVerifier || recoveredVerifier !== verifier) {
      throw new Error('Could not recover code_verifier for this sign-in attempt');
    }

    log.info('auth', 'exchanging code for tokens');
    const tokens = await exchangeCode(code, recoveredVerifier, redirectUri);
    log.info('auth', 'fetching user profile');
    const user = await fetchSupabaseUserAtSignIn(tokens.access_token);
    // Validate the exchanged bearer before it displaces a working local
    // session. A failed /user response is an unsuccessful sign-in attempt.
    await commitSignInAttempt(attemptId, tokens, user);
    log.success('auth', `signed in as ${user.email ?? user.id}`);
    return { user, tokens };
  } finally {
    // Cancellation, state rejection, and exchange failure must each clean up
    // only this attempt. Never erase another context's in-flight verifier.
    try {
      await chrome.storage.session.remove([verifierStorageKey]);
    } catch (err) {
      // Cleanup cannot turn a successful sign-in into a failure or mask the
      // original OAuth error. The session store is cleared on browser exit.
      log.warn('auth', 'could not clear PKCE verifier after sign-in attempt', err);
    }
  }
}

export async function signOut(): Promise<void> {
  await clearLocalSession();
}

/**
 * Clear only the local owner. Returns false when another context replaced the
 * expected refresh-token ciphertext before we acquired the mutation lock.
 */
async function clearLocalSession(expectedRefreshCt?: string): Promise<boolean> {
  let clearSupabaseSession: (() => void) | undefined;
  try {
    ({ clearSupabaseSession } = await import('@/lib/supabase/client'));
  } catch {
    /* best-effort */
  }
  const result = await withAuthMutationLock(async () => {
    const stored = await chrome.storage.local.get([
      STORAGE_KEYS.ACCESS_TOKEN,
      STORAGE_KEYS.REFRESH_TOKEN_ENC,
    ]);
    if (expectedRefreshCt && stored[STORAGE_KEYS.REFRESH_TOKEN_ENC] !== expectedRefreshCt) {
      return { cleared: false, access: null };
    }
    await Promise.all([
      chrome.storage.session.remove([ACTIVE_AUTH_ATTEMPT_KEY]),
      chrome.storage.local.remove([
        STORAGE_KEYS.USER_PROFILE,
        STORAGE_KEYS.ACCESS_TOKEN,
        STORAGE_KEYS.REFRESH_TOKEN_ENC,
        STORAGE_KEYS.REFRESH_TOKEN_IV,
        STORAGE_KEYS.TOKEN_EXPIRES_AT,
        STORAGE_KEYS.ACTIVE_ORGANIZATION,
        STORAGE_KEYS.IS_ADMIN,
      ]),
      chrome.alarms.clear(ALARMS.TOKEN_REFRESH).catch(() => undefined),
    ]);
    clearSupabaseSession?.();
    const token = stored[STORAGE_KEYS.ACCESS_TOKEN];
    return { cleared: true, access: typeof token === 'string' ? token : null };
  });
  if (!result.cleared) return false;
  if (!result.access) return true;
  // This is a captured pre-clear bearer. `scope=local` avoids revoking a
  // later login that may have completed while this best-effort call is in I/O.
  void fetch(`${ENV.SUPABASE_URL}/auth/v1/logout?scope=local`, {
    method: 'POST',
    headers: {
      apikey: ENV.SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${result.access}`,
    },
  }).catch(() => {
    // Revocation is best-effort; canonical local sign-out already completed.
  });
  return true;
}

/** Reads the persisted bearer without refreshing or mutating session state. */
export async function getStoredAccessToken(): Promise<string | null> {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.ACCESS_TOKEN]);
  const token = stored[STORAGE_KEYS.ACCESS_TOKEN];
  return typeof token === 'string' && token.length > 0 ? token : null;
}

/**
 * Why a signed-in install has no readable bearer, as plain facts for a log line
 * (never the token itself). Used by the request path when it refuses to send a
 * signed-in request as a guest, so the NEXT occurrence explains itself: the
 * 2026-09-19 guest-downgrade 401s could only be explained after the fact.
 */
export async function describeStoredSession(): Promise<{
  hasAccessToken: boolean;
  expiresInMs: number | null;
  hasRefreshMaterial: boolean;
  hasOauthClientId: boolean;
}> {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.ACCESS_TOKEN,
    STORAGE_KEYS.TOKEN_EXPIRES_AT,
    STORAGE_KEYS.REFRESH_TOKEN_ENC,
    STORAGE_KEYS.REFRESH_TOKEN_IV,
  ]);
  const expiresAt = stored[STORAGE_KEYS.TOKEN_EXPIRES_AT];
  return {
    hasAccessToken: typeof stored[STORAGE_KEYS.ACCESS_TOKEN] === 'string',
    expiresInMs: typeof expiresAt === 'number' ? expiresAt - Date.now() : null,
    hasRefreshMaterial:
      !!stored[STORAGE_KEYS.REFRESH_TOKEN_ENC] && !!stored[STORAGE_KEYS.REFRESH_TOKEN_IV],
    hasOauthClientId: !!ENV.EXTENSION_OAUTH_CLIENT_ID,
  };
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
export async function refreshAccessToken(
  rejectedAccessToken?: string,
): Promise<{ access_token: string } | null> {
  return refreshMutex.run(async () => {
    // A background alarm has no rejected bearer, so it may adopt any fresh
    // token. A 401 retry may adopt only a token another context wrote after
    // dispatch; otherwise it must actually refresh the bearer the server
    // rejected, even if its expiry timestamp still looks healthy.
    const fresh = await readFreshAccessToken();
    if (fresh && (!rejectedAccessToken || fresh !== rejectedAccessToken)) {
      return { access_token: fresh };
    }
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
    await clearLocalSession(ct);
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
      const fresh = await withAuthMutationLock(async () => {
        const recheck = await chrome.storage.local.get([STORAGE_KEYS.REFRESH_TOKEN_ENC]);
        const ctNow = recheck[STORAGE_KEYS.REFRESH_TOKEN_ENC] as string | undefined;
        if (!ctNow || ctNow === ct) return null;
        return readFreshAccessToken();
      });
      if (fresh) {
        console.info('[matrx-extend] refresh race: another context rotated the token — adopting');
        return { access_token: fresh } as OAuthTokens;
      }
      const cleared = await clearLocalSession(ct);
      // This is a terminal response for the exact credential we read. Notify
      // every UI realm only after the compare-and-clear succeeded; a newer
      // sign-in/refresh must never be turned into a spurious signed-out view.
      if (cleared) {
        broadcast(CHANNELS.AUTH_STATE_CHANGED, {
          user: null,
          isAdmin: false,
          reason: 'refresh_token_rejected',
        });
      }
    }
    return null;
  }
  const json = await res.json();
  const tokens = OAuthTokensSchema.parse(json);
  const committed = await withAuthMutationLock(async () => {
    const recheck = await chrome.storage.local.get([STORAGE_KEYS.REFRESH_TOKEN_ENC]);
    if (recheck[STORAGE_KEYS.REFRESH_TOKEN_ENC] !== ct) return readFreshAccessToken();
    await persistTokens(tokens);
    scheduleRefresh(tokens);
    return tokens.access_token;
  });
  if (!committed) return null;
  if (committed !== tokens.access_token) return { access_token: committed } as OAuthTokens;
  return tokens;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function launchWebAuthFlow(url: string): Promise<string> {
  const browserIdentity = getBrowserIdentity();
  if (browserIdentity?.launchWebAuthFlow) {
    return browserIdentity.launchWebAuthFlow({ url, interactive: true }).then((callbackUrl) => {
      if (!callbackUrl) throw new Error('OAuth flow cancelled or returned no URL');
      return callbackUrl;
    });
  }

  if (!chrome.identity?.launchWebAuthFlow) {
    return Promise.reject(
      new Error('OAuth sign-in is unavailable because this browser does not provide an identity API'),
    );
  }
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

async function commitSignInAttempt(
  attemptId: string,
  tokens: OAuthTokens,
  user: UserProfile,
): Promise<void> {
  await withAuthMutationLock(async () => {
    const active = await chrome.storage.session.get([ACTIVE_AUTH_ATTEMPT_KEY]);
    if (active[ACTIVE_AUTH_ATTEMPT_KEY] !== attemptId) {
      throw new SupersededAuthAttemptError();
    }
    const expiresAt = Date.now() + tokens.expires_in * 1000;
    const enc = await encryptString(tokens.refresh_token);
    await chrome.storage.local.set({
      [STORAGE_KEYS.ACCESS_TOKEN]: tokens.access_token,
      [STORAGE_KEYS.REFRESH_TOKEN_ENC]: enc.ct,
      [STORAGE_KEYS.REFRESH_TOKEN_IV]: enc.iv,
      [STORAGE_KEYS.TOKEN_EXPIRES_AT]: expiresAt,
      [STORAGE_KEYS.USER_PROFILE]: user,
    });
    scheduleRefresh(tokens);
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

/**
 * ONE-TIME, SIGN-IN ONLY. Reads the user record from the Auth server.
 *
 * 🚨 NEVER call this per request, and never export it. `/auth/v1/user` reads
 * the platform database: on 2026-09-21 a database lock storm turned it into a
 * ~10 s stall on EVERY request this extension made. Per-request identity is
 * answered locally by `verifyBearerClaims()` (src/lib/auth/verify-claims.ts),
 * which checks the token's ES256 signature against the project JWKS with
 * WebCrypto and never touches the database.
 *
 * This one call survives because the OAuth exchange needs `email_confirmed_at`,
 * which is NOT a JWT claim, and because it doubles as validation that the
 * freshly exchanged bearer is real before it displaces a working session.
 */
async function fetchSupabaseUserAtSignIn(accessToken: string): Promise<UserProfile> {
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

/**
 * Resolve the subject of the bearer token that will be sent on a sensitive
 * request. The cached profile is useful for rendering, but it is not proof
 * that a refreshed or replaced token belongs to the same person.
 *
 * CHANGED 2026-09-21: this used to ask the Auth server (`/auth/v1/user`) on
 * EVERY expected-actor / private request, which stalled ~10 s per request
 * during a database lock storm. It now verifies the token's ES256 signature
 * LOCALLY against the project JWKS (see src/lib/auth/verify-claims.ts) — the
 * same authority, checked instead of asked, and no database read.
 *
 * Contract unchanged: `UserProfile | null`, and `null` fails the caller closed.
 * What the profile carries changed slightly — `full_name` / `avatar_url` come
 * from the token's `user_metadata` claims, and `email_verified` (not a JWT
 * claim) falls back to the profile recorded at sign-in.
 *
 * A token we could NOT verify (JWKS unreachable) is not a signed-out person:
 * it returns null so the request fails closed, and it says so in the log —
 * it never clears the session.
 */
export async function getVerifiedCurrentUser(
  accessToken?: string | null,
): Promise<UserProfile | null> {
  const token = accessToken ?? (await getAccessToken());
  if (!token) return null;
  const result = await verifyBearerClaims(token);
  if (result.status === 'unverifiable') {
    log.warn(
      'auth',
      'could not verify the bearer locally; failing this request closed WITHOUT signing out',
      result.reason,
    );
    return null;
  }
  if (result.status === 'invalid') return null;
  if (result.user.email_verified !== undefined) return result.user;
  // `email_verified` is not a JWT claim on every project; keep the value the
  // sign-in record established rather than reporting an unverified email.
  const cached = await getCurrentUser();
  return cached?.id === result.user.id && cached.email_verified !== undefined
    ? { ...result.user, email_verified: cached.email_verified }
    : result.user;
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
  return withAuthMutationLock(async () => {
    const stored = await chrome.storage.local.get([
      STORAGE_KEYS.ACCESS_TOKEN,
      STORAGE_KEYS.REFRESH_TOKEN_ENC,
      STORAGE_KEYS.REFRESH_TOKEN_IV,
    ]);
    const access = stored[STORAGE_KEYS.ACCESS_TOKEN] as string | undefined;
    const ct = stored[STORAGE_KEYS.REFRESH_TOKEN_ENC] as string | undefined;
    const iv = stored[STORAGE_KEYS.REFRESH_TOKEN_IV] as string | undefined;
    try {
      const { clearSupabaseSession, setSupabaseSession } = await import('@/lib/supabase/client');
      if (!access || !ct || !iv) {
        clearSupabaseSession();
        log.info('auth', 'restoreSupabaseSession: no stored tokens');
        return false;
      }
      const refresh = await decryptString({ ct, iv });
      await setSupabaseSession(access, refresh);
      log.success('auth', 'supabase session restored from storage');
      return true;
    } catch (err) {
      log.error('auth', 'restoreSupabaseSession failed', err);
      return false;
    }
  });
}
