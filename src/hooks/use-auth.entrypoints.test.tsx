import { AuthGate } from '@/components/AuthGate';
import { STORAGE_KEYS } from '@/config/env';
import type { UserProfile } from '@/lib/auth/types';
import { CHANNELS } from '@/lib/messaging/schemas';
import { useAuthStore } from '@/state/auth';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => ({
  restore: vi.fn(async () => true),
  verifiedUser: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  checkIsAdmin: vi.fn(async () => false),
  broadcast: vi.fn(),
  listeners: new Map<string, Set<(payload: unknown) => unknown>>(),
}));

vi.mock('@/lib/auth/flow', () => ({
  restoreSupabaseSession: dependencies.restore,
  getVerifiedCurrentUser: dependencies.verifiedUser,
  signIn: dependencies.signIn,
  signOut: dependencies.signOut,
}));
vi.mock('@/lib/api/routes/health', () => ({ pingHealth: vi.fn() }));
vi.mock('@/lib/supabase/queries', () => ({ checkIsAdmin: dependencies.checkIsAdmin }));
vi.mock('@/lib/messaging/native', () => ({
  broadcast: dependencies.broadcast,
  on: (channel: string, listener: (payload: unknown) => unknown) => {
    const listeners = dependencies.listeners.get(channel) ?? new Set();
    listeners.add(listener);
    dependencies.listeners.set(channel, listeners);
    return () => listeners.delete(listener);
  },
}));

import { resetAuthBootGuard, useAuth } from './use-auth';

const admin = {
  id: '7d945376-2ac6-442c-bfb5-2ca3512377af',
  email: 'admin@admin.com',
  email_verified: true,
  full_name: 'Admin',
  avatar_url: null,
} satisfies UserProfile;

async function broadcastAuth(payload: { user: UserProfile | null; isAdmin?: boolean }) {
  await act(async () => {
    const listeners = dependencies.listeners.get(CHANNELS.AUTH_STATE_CHANGED) ?? new Set();
    for (const listener of listeners) await listener(payload);
  });
}

beforeEach(async () => {
  resetAuthBootGuard();
  useAuthStore.setState({ user: null, isAdmin: false, status: 'unknown', error: null });
  dependencies.restore.mockReset().mockResolvedValue(true);
  dependencies.verifiedUser.mockReset().mockResolvedValue(null);
  dependencies.signIn.mockReset();
  dependencies.signOut.mockReset().mockResolvedValue(undefined);
  dependencies.checkIsAdmin.mockReset().mockResolvedValue(false);
  dependencies.broadcast.mockReset();
  dependencies.listeners.clear();
  await chrome.storage.local.remove([STORAGE_KEYS.USER_PROFILE, STORAGE_KEYS.IS_ADMIN]);
});

describe('useAuth canonical session entry points', () => {
  it('keeps interactive sign-in recoverable when session installation fails', async () => {
    dependencies.restore.mockResolvedValue(false);
    dependencies.signIn.mockImplementation(async () => {
      await chrome.storage.local.set({ [STORAGE_KEYS.USER_PROFILE]: admin });
      return { user: admin, tokens: { access_token: 'opaque', refresh_token: 'opaque' } };
    });
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe('signed-out'));

    await act(async () => result.current.signIn());

    expect(result.current.user).toBeNull();
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.status).toBe('signed-out');
    expect(result.current.error).toMatch(/could not restore your saved sign-in/i);
    expect((await chrome.storage.local.get(STORAGE_KEYS.USER_PROFILE))[STORAGE_KEYS.USER_PROFILE]).toEqual(admin);
    expect(dependencies.broadcast).not.toHaveBeenCalledWith(
      CHANNELS.AUTH_STATE_CHANGED,
      expect.objectContaining({ user: admin }),
    );
  });

  it('rejects a sign-in broadcast when the receiving session cannot be restored', async () => {
    dependencies.restore.mockResolvedValue(false);
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe('signed-out'));
    await chrome.storage.local.set({ [STORAGE_KEYS.USER_PROFILE]: admin });

    await broadcastAuth({ user: admin, isAdmin: true });

    await waitFor(() => expect(result.current.user).toBeNull());
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.status).toBe('signed-out');
    expect(result.current.error).toMatch(/could not restore your saved sign-in/i);
  });

  it('rejects a delayed prior sign-in broadcast after canonical sign-out', async () => {
    dependencies.restore.mockResolvedValue(false);
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe('signed-out'));

    await broadcastAuth({ user: null, isAdmin: false });
    await broadcastAuth({ user: admin, isAdmin: true });

    await waitFor(() => expect(result.current.user).toBeNull());
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.status).toBe('signed-out');
  });

  it('warns and retries the admin read without starting OAuth', async () => {
    dependencies.verifiedUser.mockResolvedValue(admin);
    dependencies.checkIsAdmin.mockResolvedValueOnce(null).mockResolvedValueOnce(true);
    await chrome.storage.local.set({ [STORAGE_KEYS.USER_PROFILE]: admin });
    render(
      <AuthGate>
        <div>Settings</div>
      </AuthGate>,
    );

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/could not check admin access/i));
    expect(screen.getByRole('alert').textContent).not.toContain('Sign-in failed');
    expect(useAuthStore.getState().user?.id).toBe(admin.id);
    expect(useAuthStore.getState().isAdmin).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(useAuthStore.getState().isAdmin).toBe(true));
    expect(dependencies.checkIsAdmin).toHaveBeenCalledTimes(2);
    expect(dependencies.signIn).not.toHaveBeenCalled();
  });
});
