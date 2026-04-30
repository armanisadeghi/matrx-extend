import { STORAGE_KEYS } from '@/config/env';
import type { UserProfile } from '@/lib/auth/types';
import { CHANNELS } from '@/lib/messaging/schemas';
import { useAuthStore } from '@/state/auth';
import { useCallback, useEffect } from 'react';
import { onMessage, sendMessage } from 'webext-bridge/window';

export function useAuth() {
  const { user, status, error, setUser, setStatus, setError } = useAuthStore();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await chrome.storage.local.get([STORAGE_KEYS.USER_PROFILE]);
      if (cancelled) return;
      const profile = result[STORAGE_KEYS.USER_PROFILE] as UserProfile | undefined;
      setUser(profile ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [setUser]);

  useEffect(() => {
    onMessage(CHANNELS.AUTH_STATE_CHANGED as never, (msg: { data: unknown }) => {
      const payload = msg.data as { user: UserProfile | null };
      setUser(payload.user);
      return { ack: true } as never;
    });
  }, [setUser]);

  const signIn = useCallback(async () => {
    setStatus('signing-in');
    setError(null);
    try {
      const r = (await sendMessage(
        CHANNELS.AUTH_SIGN_IN as never,
        {} as never,
        'background' as never,
      )) as { user: UserProfile };
      setUser(r.user);
    } catch (err) {
      setError((err as Error).message);
      setStatus('signed-out');
    }
  }, [setError, setStatus, setUser]);

  const signOut = useCallback(async () => {
    await sendMessage(CHANNELS.AUTH_SIGN_OUT as never, {} as never, 'background' as never);
    setUser(null);
  }, [setUser]);

  return { user, status, error, signIn, signOut };
}
