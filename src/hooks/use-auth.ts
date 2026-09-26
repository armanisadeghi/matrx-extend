import { STORAGE_KEYS } from '@/config/env';
import { pingHealth } from '@/lib/api/routes/health';
import {
  getVerifiedCurrentUser,
  restoreSupabaseSession,
  signIn as runSignIn,
  signOut as runSignOut,
} from '@/lib/auth/flow';
import type { UserProfile } from '@/lib/auth/types';
import { broadcast, on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { checkIsAdmin } from '@/lib/supabase/queries';
import { useAuthStore } from '@/state/auth';
import { useCallback, useEffect } from 'react';

/**
 * Module-level guard: useAuth is called from ~7 components (header,
 * AuthGate, UserMenu, ChatView, SettingsView, App, popup). Without this
 * guard, every consumer's mount fired its own boot — meaning every
 * sidepanel open triggered N× pingHealth, N× checkIsAdmin, N× session
 * restore. Now exactly one boot runs per service-worker / sidepanel
 * lifetime; subsequent useAuth() calls only subscribe to the store.
 *
 * Reset on signOut so that the next sign-in triggers a fresh admin
 * recheck and health ping.
 */
let bootRan = false;
let mountedAuthConsumers = 0;
let bootGeneration = 0;
// `useAuth` is mounted by several independently-rendered surfaces. This must
// be realm-wide rather than a hook ref: a sign-out or newer sign-in from one
// surface cancels every older in-flight attempt in this extension context.
let signInGeneration = 0;
export function resetAuthBootGuard(): void {
  bootRan = false;
  mountedAuthConsumers = 0;
  bootGeneration += 1;
  signInGeneration = 0;
}

type CanonicalSession =
  | { kind: 'authenticated'; user: UserProfile; error: string | null }
  | { kind: 'guest'; error: string | null };

/** Every path into signed-in UI reads the same stored session and bearer. */
async function readCanonicalSession(expectedUserId?: string): Promise<CanonicalSession> {
  let restored = false;
  try {
    restored = await restoreSupabaseSession();
  } catch {
    // A transient restore failure must not delete the saved account.
  }
  let profile: UserProfile | undefined;
  let safariFailure: string | null = null;
  try {
    const stored = await chrome.storage.local.get([STORAGE_KEYS.USER_PROFILE]);
    profile = stored[STORAGE_KEYS.USER_PROFILE] as UserProfile | undefined;
    const session = chrome.storage.session
      ? await chrome.storage.session.get([STORAGE_KEYS.SAFARI_AUTH_FAILURE])
      : {};
    const failure = session[STORAGE_KEYS.SAFARI_AUTH_FAILURE];
    safariFailure = typeof failure === 'string' ? failure : null;
  } catch {
    return { kind: 'guest', error: 'Could not read your saved sign-in. Reload to retry.' };
  }
  if (!restored) {
    return {
      kind: 'guest',
      error: profile
        ? 'Could not restore your saved sign-in. Reload to retry, or sign in again.'
        : safariFailure,
    };
  }
  let verified: UserProfile | null = null;
  try {
    // This checks the current or refreshed bearer locally against JWKS; a
    // Realtime session installation alone does not prove the user's identity.
    verified = await getVerifiedCurrentUser();
  } catch {
    // The bearer may be temporarily unverifiable. Keep the saved credentials.
  }
  if (!verified) {
    return {
      kind: 'guest',
      error: 'Could not verify your saved sign-in. Reload to retry, or sign in again.',
    };
  }
  if (
    (profile && profile.id !== verified.id) ||
    (expectedUserId && expectedUserId !== verified.id)
  ) {
    return {
      kind: 'guest',
      error: 'This sign-in does not match your saved account. Sign in again to choose an account.',
    };
  }
  return { kind: 'authenticated', user: verified, error: safariFailure };
}

type AppliedSession =
  | { kind: 'stale' | 'guest' }
  | { kind: 'authenticated'; user: UserProfile; isAdmin: boolean };

/**
 * Auth runs in the sidepanel context — chrome.identity is available there
 * and we sidestep the SW message-handler race entirely. After a successful
 * sign-in we broadcast AUTH_STATE_CHANGED so the popup, options page, and
 * SW (which holds its own Supabase realtime client) all sync.
 */
export function useAuth() {
  const { user, isAdmin, status, error, setUser, setIsAdmin, setStatus, setError } = useAuthStore();

  const applyCanonicalSession = useCallback(
    async (isCurrent: () => boolean, expectedUserId?: string): Promise<AppliedSession> => {
      const session = await readCanonicalSession(expectedUserId);
      if (!isCurrent()) return { kind: 'stale' };
      if (session.kind === 'guest') {
        setUser(null);
        setIsAdmin(false);
        setError(session.error);
        return { kind: 'guest' };
      }

      setUser(session.user);
      setIsAdmin(false);
      setError(session.error);
      let admin: boolean | null = null;
      try {
        admin = await checkIsAdmin(session.user.id);
      } catch {
        // Treat a thrown role read exactly like a returned unavailable result.
      }
      if (!isCurrent()) return { kind: 'stale' };
      if (admin === null) {
        setError('Could not check admin access. Try again to retry this account check.');
        return { kind: 'authenticated', user: session.user, isAdmin: false };
      }
      setIsAdmin(admin);
      try {
        await chrome.storage.local.set({ [STORAGE_KEYS.IS_ADMIN]: admin });
      } catch {
        if (isCurrent()) setError('Could not save the account role check. Try again to retry.');
      }
      return { kind: 'authenticated', user: session.user, isAdmin: admin };
    },
    [setUser, setIsAdmin, setError],
  );

  // On mount: hydrate user state, restore Supabase session, re-check admin,
  // then ping health. Guarded so it runs once per sidepanel lifetime even
  // when N components subscribe to useAuth().
  useEffect(() => {
    mountedAuthConsumers += 1;
    if (bootRan) {
      return () => {
        mountedAuthConsumers -= 1;
        if (mountedAuthConsumers === 0) {
          bootRan = false;
          bootGeneration += 1;
        }
      };
    }
    bootRan = true;
    const currentBoot = ++bootGeneration;
    const currentAuth = signInGeneration;
    const isCurrent = () =>
      mountedAuthConsumers > 0 &&
      bootGeneration === currentBoot &&
      signInGeneration === currentAuth;
    void applyCanonicalSession(isCurrent).then(() => {
      if (isCurrent()) void pingHealth('app start');
    });
    return () => {
      mountedAuthConsumers -= 1;
      if (mountedAuthConsumers === 0) {
        bootRan = false;
        bootGeneration += 1;
      }
    };
  }, [applyCanonicalSession]);

  useEffect(() => {
    return on<{ user: UserProfile | null; isAdmin?: boolean }, { ack: true }>(
      CHANNELS.AUTH_STATE_CHANGED,
      () => {
        // A sign-in/sign-out from a different extension context supersedes
        // any local OAuth attempt still awaiting admin lookup.
        const event = ++signInGeneration;
        // Either payload can arrive after a newer auth transition. Treat the
        // broadcast only as a notice to reread the current verified session.
        void applyCanonicalSession(() => event === signInGeneration);
        return { ack: true };
      },
    );
  }, [applyCanonicalSession]);

  useEffect(() => {
    return on<{ message: string }, { ack: true }>(CHANNELS.AUTH_SAFARI_FAILED, ({ message }) => {
      signInGeneration += 1;
      setError(message);
      setStatus('signed-out');
      return { ack: true };
    });
  }, [setError, setStatus]);

  const signIn = useCallback(async () => {
    const attempt = ++signInGeneration;
    setStatus('signing-in');
    setError(null);
    try {
      const result = await runSignIn();
      if ('pending' in result) return;
      const { user: profile } = result;
      if (attempt !== signInGeneration) return;
      const applied = await applyCanonicalSession(
        () => attempt === signInGeneration,
        profile.id,
      );
      if (applied.kind !== 'authenticated' || attempt !== signInGeneration) return;
      broadcast(CHANNELS.AUTH_STATE_CHANGED, {
        user: applied.user,
        isAdmin: applied.isAdmin,
      });
      void pingHealth('after sign-in');
    } catch (err) {
      if (attempt !== signInGeneration) return;
      setError((err as Error).message);
      setStatus('signed-out');
    }
  }, [applyCanonicalSession, setError, setStatus]);

  const retry = useCallback(async () => {
    const stored = await chrome.storage.local.get([STORAGE_KEYS.USER_PROFILE]);
    if (!user && !stored[STORAGE_KEYS.USER_PROFILE]) {
      await signIn();
      return;
    }
    const attempt = ++signInGeneration;
    setError(null);
    await applyCanonicalSession(() => attempt === signInGeneration);
  }, [user, signIn, applyCanonicalSession, setError]);

  const signOut = useCallback(async () => {
    const attempt = ++signInGeneration;
    await runSignOut();
    if (attempt !== signInGeneration) return;
    await chrome.storage.local.remove([STORAGE_KEYS.IS_ADMIN]);
    if (attempt !== signInGeneration) return;
    setUser(null);
    setIsAdmin(false);
    broadcast(CHANNELS.AUTH_STATE_CHANGED, { user: null, isAdmin: false });
    // Allow the next sign-in to re-run the one-time boot work.
    bootRan = false;
  }, [setUser, setIsAdmin]);

  return { user, isAdmin, status, error, signIn, signOut, retry };
}
