import { STORAGE_KEYS } from '@/config/env';
import { pingHealth } from '@/lib/api/routes/health';
import {
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

/**
 * Auth runs in the sidepanel context — chrome.identity is available there
 * and we sidestep the SW message-handler race entirely. After a successful
 * sign-in we broadcast AUTH_STATE_CHANGED so the popup, options page, and
 * SW (which holds its own Supabase realtime client) all sync.
 */
export function useAuth() {
  const { user, isAdmin, status, error, setUser, setIsAdmin, setStatus, setError } = useAuthStore();

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
    void (async () => {
      await restoreSupabaseSession();
      const result = await chrome.storage.local.get([
        STORAGE_KEYS.USER_PROFILE,
        STORAGE_KEYS.IS_ADMIN,
      ]);
      const session = await chrome.storage.session.get([STORAGE_KEYS.SAFARI_AUTH_FAILURE]);
      if (!isCurrent()) return;
      const profile = result[STORAGE_KEYS.USER_PROFILE] as UserProfile | undefined;
      const cachedAdmin = result[STORAGE_KEYS.IS_ADMIN] as boolean | undefined;
      setUser(profile ?? null);
      setIsAdmin(!!cachedAdmin);
      const safariFailure = session[STORAGE_KEYS.SAFARI_AUTH_FAILURE];
      if (typeof safariFailure === 'string') setError(safariFailure);

      // Refresh admin flag in the background — guards against role changes.
      if (profile?.id) {
        void checkIsAdmin(profile.id).then(async (admin) => {
          if (!isCurrent()) return;
          setIsAdmin(admin);
          await chrome.storage.local.set({ [STORAGE_KEYS.IS_ADMIN]: admin });
        });
      }

      void pingHealth('app start');
    })();
    return () => {
      mountedAuthConsumers -= 1;
      if (mountedAuthConsumers === 0) {
        bootRan = false;
        bootGeneration += 1;
      }
    };
  }, [setUser, setIsAdmin, setError]);

  useEffect(() => {
    return on<{ user: UserProfile | null; isAdmin?: boolean }, { ack: true }>(
      CHANNELS.AUTH_STATE_CHANGED,
      (payload) => {
        // A sign-in/sign-out from a different extension context supersedes
        // any local OAuth attempt still awaiting admin lookup.
        signInGeneration += 1;
        // Realtime must follow canonical encrypted storage, never a token
        // carried by a stale broadcast payload.
        void restoreSupabaseSession();
        setUser(payload.user);
        if (payload.user) {
          setError(null);
          setStatus('signed-in');
        } else {
          setStatus('signed-out');
        }
        if (typeof payload.isAdmin === 'boolean') setIsAdmin(payload.isAdmin);
        return { ack: true };
      },
    );
  }, [setUser, setIsAdmin, setError, setStatus]);

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
      // signIn committed storage under the auth lock. Re-read that canonical
      // session rather than installing this attempt's supplied token.
      await restoreSupabaseSession();
      if (attempt !== signInGeneration) return;
      setUser(profile);

      // Determine admin status now that we have a JWT.
      const admin = await checkIsAdmin(profile.id);
      if (attempt !== signInGeneration) return;
      setIsAdmin(admin);
      await chrome.storage.local.set({ [STORAGE_KEYS.IS_ADMIN]: admin });
      if (attempt !== signInGeneration) return;

      broadcast(CHANNELS.AUTH_STATE_CHANGED, { user: profile, isAdmin: admin });
      void pingHealth('after sign-in');
    } catch (err) {
      if (attempt !== signInGeneration) return;
      setError((err as Error).message);
      setStatus('signed-out');
    }
  }, [setError, setIsAdmin, setStatus, setUser]);

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

  return { user, isAdmin, status, error, signIn, signOut };
}
