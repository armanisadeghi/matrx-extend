/**
 * Sign in with AI Matrx for the Chrome/Safari extension.
 *
 * The OAuth 2.1 PKCE machinery (verifier/challenge/state, code exchange, single-flight refresh,
 * revoke, cross-context refresh-race guard) lives in `@ai-matrx/auth/matrx-oauth`. This file only
 * supplies the host ports and the extension's own side effects:
 *   - storage         chrome.storage.local (session) / chrome.storage.session (in-flight attempt)
 *   - lock            navigator.locks (chrome.storage is shared by every extension context)
 *   - seal            AES-GCM refresh-token sealing (crypto.ts)
 *   - openAuthorization  chrome.identity.launchWebAuthFlow (identity-transport.ts)
 *   - beforeCommit    GET /auth/v1/user ONCE at sign-in (see fetchSupabaseUserAtSignIn)
 * and, on the package's session events: the refresh alarm, the cached profile, the Supabase
 * realtime session and the AUTH_STATE_CHANGED broadcast.
 *
 * The exported function names are the extension's long-standing auth surface.
 */

import { ALARMS, ENV, STORAGE_KEYS } from '@/config/env';
import { decryptString, encryptString } from '@/lib/auth/crypto';
import { getRedirectUri, launchWebAuthFlow } from '@/lib/auth/identity-transport';
import type { UserProfile } from '@/lib/auth/types';
import { verifyBearerClaims } from '@/lib/auth/verify-claims';
import { BROWSER } from '@/lib/browser/detect';
import { log } from '@/lib/debug/log';
import { broadcast, send } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { extensionStorage } from '@ai-matrx/auth';
import {
  type MatrxOAuthClient,
  type MatrxOAuthEvent,
  type MatrxOAuthSession,
  TransientAuthError,
  createMatrxOAuth,
} from '@ai-matrx/auth/matrx-oauth';

const AUTH_MUTATION_LOCK = 'matrx-extend-auth-mutation';

/** The caller supplies how the authorize URL is shown and the redirect captured. */
export type AuthorizationOpener = (
  authorizeUrl: string,
  context: { state: string; redirectUri: string },
) => Promise<string>;

export type SignInResult = { user: UserProfile } | { pending: true };

function oauthClientId(): string {
  return BROWSER === 'safari' ? ENV.SAFARI_OAUTH_CLIENT_ID : ENV.EXTENSION_OAUTH_CLIENT_ID;
}

/**
 * chrome.storage is shared by all extension contexts, so mutations need an
 * origin-wide lock. The package never performs network I/O inside it.
 */
async function withAuthMutationLock<T>(callback: () => Promise<T>): Promise<T> {
  const locks = navigator.locks;
  if (!locks) {
    throw new Error('Secure authentication storage locking is unavailable in this browser context');
  }
  return locks.request(AUTH_MUTATION_LOCK, { mode: 'exclusive' }, callback);
}

/** Profiles fetched by beforeCommit, keyed by the bearer they belong to. */
const profilesByBearer = new Map<string, UserProfile>();

let client: MatrxOAuthClient | null = null;
let openAuthorization: AuthorizationOpener = (url) => launchWebAuthFlow(url);

/** The client, or null when this build has no OAuth client id configured. */
function getClient(): MatrxOAuthClient | null {
  if (client) return client;
  const clientId = oauthClientId();
  if (!clientId) return null;
  client = createMatrxOAuth(
    {
      authUrl: ENV.SUPABASE_URL,
      clientId,
      // Read when a sign-in starts or completes, never cached (the package refuses a blank one);
      // read-only paths need no redirect.
      redirectUri: () => getRedirectUri(),
      // Never include 'openid' — the server then fails minting an ID token.
      scope: 'email profile',
      publishableKey: ENV.SUPABASE_PUBLISHABLE_KEY,
      // The package keeps its session at `${prefix}.session` === STORAGE_KEYS.AUTH_SESSION.
      storageKeyPrefix: 'matrx.oauth',
    },
    {
      storage: extensionStorage(chrome.storage.local),
      pendingStorage: extensionStorage(chrome.storage.session),
      lock: withAuthMutationLock,
      seal: {
        encrypt: async (plain) => {
          const { ct, iv } = await encryptString(plain);
          return `${ct}.${iv}`;
        },
        decrypt: async (sealed) => {
          const [ct, iv] = sealed.split('.');
          if (!ct || !iv) throw new Error('sealed refresh token is malformed');
          return decryptString({ ct, iv });
        },
      },
      openAuthorization: (url, context) => openAuthorization(url, context),
      beforeCommit: async (accessToken) => {
        profilesByBearer.set(accessToken, await fetchSupabaseUserAtSignIn(accessToken));
      },
    },
  );
  client.onChange(onSessionEvent);
  return client;
}

/** The OAuth client (the package's), for the organization store's session; null with no client id configured. */
export function getOAuthClient(): MatrxOAuthClient | null {
  return getClient();
}

function onSessionEvent(event: MatrxOAuthEvent): void {
  if (event.type === 'signed_out') {
    void clearLocalSideEffects().then(() => {
      // Terminal refusal of the exact credential we held: tell every UI realm. A newer
      // sign-in/refresh is never turned into a spurious signed-out view (the package only
      // emits this after its compare-and-clear succeeded).
      if (event.reason === 'session_ended') {
        broadcast(CHANNELS.AUTH_STATE_CHANGED, {
          user: null,
          isAdmin: false,
          reason: 'refresh_token_rejected',
        });
      }
    });
    return;
  }
  scheduleRefresh(event.session);
}

/** Everything the app keeps beside the tokens, gone with them. */
async function clearLocalSideEffects(): Promise<void> {
  let clearSupabaseSession: (() => Promise<void>) | undefined;
  try {
    ({ clearSupabaseSession } = await import('@/lib/supabase/client'));
  } catch {
    /* best-effort */
  }
  try {
    await withAuthMutationLock(() =>
      chrome.storage.local.remove([
        STORAGE_KEYS.USER_PROFILE,
        STORAGE_KEYS.ACTIVE_ORGANIZATION,
        STORAGE_KEYS.IS_ADMIN,
      ]),
    );
    await chrome.alarms.clear(ALARMS.TOKEN_REFRESH).catch(() => undefined);
  } catch (err) {
    log.warn('auth', 'could not clear local sign-in side effects', err);
  }
  try {
    await clearSupabaseSession?.();
  } catch {
    /* best-effort */
  }
}

function scheduleRefresh(session: MatrxOAuthSession): void {
  // Refresh ~5 min before expiry, but never sooner than 5 minutes or later than 50.
  const minutesUntilExpiry = (session.expiresAtMs - Date.now()) / 60_000;
  const delayInMinutes = Math.max(5, Math.min(50, minutesUntilExpiry - 5));
  try {
    chrome.alarms.create(ALARMS.TOKEN_REFRESH, { delayInMinutes });
  } catch (err) {
    log.warn('auth', 'failed to schedule refresh alarm', err);
  }
}

/**
 * Run the interactive sign-in with the given way of showing the authorize URL. Resolves once the
 * session and profile are stored. The Chrome path uses launchWebAuthFlow; Safari supplies a tab.
 */
export async function signInWithOpener(
  opener: AuthorizationOpener,
): Promise<{ user: UserProfile }> {
  if (!oauthClientId()) {
    throw new Error(
      'WXT_EXTENSION_OAUTH_CLIENT_ID is not set. Register the extension as a public PKCE client in the Matrx Supabase dashboard, then add the client ID to .env.* files.',
    );
  }
  getRedirectUri(); // throws the plain 'no identity API' error before any state is created
  const oauth = getClient();
  if (!oauth) throw new Error('OAuth sign-in is unavailable: no OAuth client is configured');
  const previous = openAuthorization;
  openAuthorization = opener;
  try {
    return await storeSignedInProfile(await oauth.signIn());
  } finally {
    openAuthorization = previous;
  }
}

async function storeSignedInProfile(session: MatrxOAuthSession): Promise<{ user: UserProfile }> {
  const user = profilesByBearer.get(session.accessToken);
  profilesByBearer.delete(session.accessToken);
  if (!user) throw new Error('Sign-in finished without a verified profile');
  await withAuthMutationLock(() => chrome.storage.local.set({ [STORAGE_KEYS.USER_PROFILE]: user }));
  log.success('auth', `signed in as ${user.email ?? user.id}`);
  return { user };
}

/**
 * Finish a sign-in whose redirect was already captured but whose `signInWithOpener` call is gone
 * (Safari: the background page was torn down between showing the tab and catching the callback).
 * The PKCE verifier for the attempt is still in chrome.storage.session, keyed by `state`.
 */
export async function completeSignInFromCallback(
  callbackUrl: string,
): Promise<{ user: UserProfile }> {
  const oauth = getClient();
  if (!oauth) throw new Error('OAuth sign-in is unavailable: no OAuth client is configured');
  return storeSignedInProfile(await oauth.completeSignIn({ callbackUrl }));
}

export async function signIn(): Promise<SignInResult> {
  if (BROWSER === 'safari') {
    await send<undefined, { pending: true }>(CHANNELS.AUTH_SAFARI_START, undefined);
    return { pending: true };
  }
  return signInWithOpener((url) => launchWebAuthFlow(url));
}

export async function signOut(): Promise<void> {
  if (BROWSER === 'safari') {
    await send<undefined, { ok: true }>(CHANNELS.AUTH_SAFARI_CANCEL, undefined, {
      absenceIsAnAnswer: true,
    }).catch(() => undefined);
  }
  const oauth = getClient();
  if (oauth) {
    // Local state first, then a best-effort scope=local revoke of the pre-clear bearer.
    await oauth.signOut();
  }
  await clearLocalSideEffects();
}

/** Reads the persisted bearer without refreshing or mutating session state. */
export async function getStoredAccessToken(): Promise<string | null> {
  const session = await getClient()?.getSession();
  return session?.accessToken ? session.accessToken : null;
}

/**
 * Why a signed-in install has no readable bearer, as plain facts for a log line
 * (never the token itself).
 */
export async function describeStoredSession(): Promise<{
  hasAccessToken: boolean;
  expiresInMs: number | null;
  hasRefreshMaterial: boolean;
  hasOauthClientId: boolean;
}> {
  const session = await getClient()?.getSession();
  return {
    hasAccessToken: !!session,
    expiresInMs: session ? session.expiresAtMs - Date.now() : null,
    hasRefreshMaterial: !!session,
    hasOauthClientId: !!oauthClientId(),
  };
}

/** A transient refresh failure keeps the session; callers see "no bearer right now". */
async function nullOnTransient(read: () => Promise<string | null>): Promise<string | null> {
  try {
    return await read();
  } catch (err) {
    if (err instanceof TransientAuthError) {
      log.warn('auth', 'token refresh failed transiently; session kept', err.message);
      return null;
    }
    throw err;
  }
}

/** Returns a fresh access token, refreshing if necessary (single-flight, in the package). */
export async function getAccessToken(): Promise<string | null> {
  const oauth = getClient();
  return oauth ? nullOnTransient(() => oauth.getAccessToken()) : null;
}

/**
 * Force-refresh; called from chrome.alarms and from the 401-retry path. Pass the bearer the
 * server rejected so it is refreshed rather than adopted.
 */
export async function refreshAccessToken(
  rejectedAccessToken?: string,
): Promise<{ access_token: string } | null> {
  const oauth = getClient();
  if (!oauth) return null;
  const token = await nullOnTransient(() => oauth.refresh(rejectedAccessToken));
  return token ? { access_token: token } : null;
}

/**
 * ONE-TIME, SIGN-IN ONLY. Reads the user record from the Auth server.
 *
 * 🚨 NEVER call this per request, and never export it. `/auth/v1/user` reads
 * the platform database: on 2026-09-21 a database lock storm turned it into a
 * ~10 s stall on EVERY request this extension made. Per-request identity is
 * answered locally by `verifyBearerClaims()` (src/lib/auth/verify-claims.ts).
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
 * Verifies the token's ES256 signature LOCALLY against the project JWKS (see
 * src/lib/auth/verify-claims.ts) — no database read. `null` fails the caller
 * closed. A token we could NOT verify (JWKS unreachable) is not a signed-out
 * person: it returns null and says so in the log — it never clears the session.
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
 * Restore the realtime client's bearer from stored session.
 *
 * MUST be called on every context boot (sidepanel mount, SW wake, offscreen
 * load) — otherwise the local Supabase client has no JWT and RLS treats every
 * read as anonymous. Symptom: only `is_public=true` rows come back.
 *
 * Returns true if a session was restored, false otherwise.
 */
export async function restoreSupabaseSession(): Promise<boolean> {
  try {
    const { clearSupabaseSession, setSupabaseSession } = await import('@/lib/supabase/client');
    const session = await getClient()?.getSession();
    if (!session) {
      await clearSupabaseSession();
      log.info('auth', 'restoreSupabaseSession: no stored tokens');
      return false;
    }
    // The extension drives refresh itself; the realtime client only needs the bearer.
    await setSupabaseSession(session.accessToken, '');
    log.success('auth', 'supabase session restored from storage');
    return true;
  } catch (err) {
    log.error('auth', 'restoreSupabaseSession failed', err);
    return false;
  }
}
