import { STORAGE_KEYS } from '@/config/env';
import { pingHealth } from '@/lib/api/routes/health';
import { restoreSupabaseSession, signIn as runSignIn, signOut as runSignOut } from '@/lib/auth/flow';
import type { UserProfile } from '@/lib/auth/types';
import { broadcast, on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { setSupabaseSession } from '@/lib/supabase/client';
import { checkIsAdmin } from '@/lib/supabase/queries';
import { useAuthStore } from '@/state/auth';
import { useCallback, useEffect } from 'react';

/**
 * Auth runs in the sidepanel context — chrome.identity is available there
 * and we sidestep the SW message-handler race entirely. After a successful
 * sign-in we broadcast AUTH_STATE_CHANGED so the popup, options page, and
 * SW (which holds its own Supabase realtime client) all sync.
 */
export function useAuth() {
  const { user, isAdmin, status, error, setUser, setIsAdmin, setStatus, setError } = useAuthStore();

  // On mount: hydrate user state, restore Supabase session, re-check admin,
  // then ping health.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await restoreSupabaseSession();
      const result = await chrome.storage.local.get([
        STORAGE_KEYS.USER_PROFILE,
        STORAGE_KEYS.IS_ADMIN,
      ]);
      if (cancelled) return;
      const profile = result[STORAGE_KEYS.USER_PROFILE] as UserProfile | undefined;
      const cachedAdmin = result[STORAGE_KEYS.IS_ADMIN] as boolean | undefined;
      setUser(profile ?? null);
      setIsAdmin(!!cachedAdmin);

      // Refresh admin flag in the background — guards against role changes.
      if (profile?.id) {
        void checkIsAdmin(profile.id).then(async (admin) => {
          if (cancelled) return;
          setIsAdmin(admin);
          await chrome.storage.local.set({ [STORAGE_KEYS.IS_ADMIN]: admin });
        });
      }

      void pingHealth('app start');
    })();
    return () => {
      cancelled = true;
    };
  }, [setUser, setIsAdmin]);

  useEffect(() => {
    return on<{ user: UserProfile | null; isAdmin?: boolean }, { ack: true }>(
      CHANNELS.AUTH_STATE_CHANGED,
      (payload) => {
        setUser(payload.user);
        if (typeof payload.isAdmin === 'boolean') setIsAdmin(payload.isAdmin);
        return { ack: true };
      },
    );
  }, [setUser, setIsAdmin]);

  const signIn = useCallback(async () => {
    setStatus('signing-in');
    setError(null);
    try {
      const { user: profile, tokens } = await runSignIn();
      await setSupabaseSession(tokens.access_token, tokens.refresh_token);
      setUser(profile);

      // Determine admin status now that we have a JWT.
      const admin = await checkIsAdmin(profile.id);
      setIsAdmin(admin);
      await chrome.storage.local.set({ [STORAGE_KEYS.IS_ADMIN]: admin });

      broadcast(CHANNELS.AUTH_STATE_CHANGED, { user: profile, isAdmin: admin });
      void pingHealth('after sign-in');
    } catch (err) {
      setError((err as Error).message);
      setStatus('signed-out');
    }
  }, [setError, setIsAdmin, setStatus, setUser]);

  const signOut = useCallback(async () => {
    await runSignOut();
    await chrome.storage.local.remove([STORAGE_KEYS.IS_ADMIN]);
    setUser(null);
    setIsAdmin(false);
    broadcast(CHANNELS.AUTH_STATE_CHANGED, { user: null, isAdmin: false });
  }, [setUser, setIsAdmin]);

  return { user, isAdmin, status, error, signIn, signOut };
}
