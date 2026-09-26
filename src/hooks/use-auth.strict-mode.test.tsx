import { STORAGE_KEYS } from '@/config/env';
import type { UserProfile } from '@/lib/auth/types';
import { useAuthStore } from '@/state/auth';
import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// EXT-D-0007: Strict Mode replays the mount effect while the persisted-profile
// read is pending. The hook must still hydrate the person who owns this install.
const dependencies = vi.hoisted(() => ({
  restore: vi.fn(async () => true),
  verifiedUser: vi.fn(),
  checkIsAdmin: vi.fn(async () => false),
}));

vi.mock('@/lib/auth/flow', () => ({
  restoreSupabaseSession: dependencies.restore,
  getVerifiedCurrentUser: dependencies.verifiedUser,
  signIn: vi.fn(() => {
    throw new Error('This persisted-session test must not start OAuth');
  }),
  signOut: vi.fn(),
}));
vi.mock('@/lib/api/routes/health', () => ({ pingHealth: vi.fn() }));
vi.mock('@/lib/supabase/queries', () => ({ checkIsAdmin: dependencies.checkIsAdmin }));
vi.mock('@/lib/messaging/native', () => ({
  on: () => () => undefined,
  broadcast: vi.fn(),
}));

import { resetAuthBootGuard, useAuth } from './use-auth';

const profiles = [
  {
    id: '7d945376-2ac6-442c-bfb5-2ca3512377af',
    email: 'admin@admin.com',
    email_verified: true,
    full_name: 'Admin',
    avatar_url: null,
  },
  {
    id: '570d5d83-2185-4dd4-80c4-3895c9e4a85f',
    email: 'test@test.com',
    email_verified: true,
    full_name: 'Test User',
    avatar_url: null,
  },
] satisfies UserProfile[];

beforeEach(async () => {
  resetAuthBootGuard();
  useAuthStore.setState({ user: null, isAdmin: false, status: 'unknown', error: null });
  dependencies.restore.mockReset().mockResolvedValue(true);
  dependencies.verifiedUser.mockReset().mockResolvedValue(null);
  dependencies.checkIsAdmin.mockReset().mockResolvedValue(false);
  await chrome.storage.local.remove([STORAGE_KEYS.USER_PROFILE, STORAGE_KEYS.IS_ADMIN]);
});

afterEach(async () => {
  await chrome.storage.local.remove([STORAGE_KEYS.USER_PROFILE, STORAGE_KEYS.IS_ADMIN]);
  resetAuthBootGuard();
});

describe('useAuth persisted-session boot', () => {
  it('hydrates the persisted admin profile without effect replay', async () => {
    const profile = profiles[0]!;
    dependencies.verifiedUser.mockResolvedValue(profile);
    await chrome.storage.local.set({
      [STORAGE_KEYS.USER_PROFILE]: profile,
      [STORAGE_KEYS.IS_ADMIN]: false,
    });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.user?.id).toBe(profile.id));
    expect(result.current.user?.email).toBe(profile.email);
    expect(result.current.status).toBe('signed-in');
  });

  it.each(profiles)('hydrates $email after Strict Mode replays the mount effect', async (profile) => {
    dependencies.verifiedUser.mockResolvedValue(profile);
    await chrome.storage.local.set({
      [STORAGE_KEYS.USER_PROFILE]: profile,
      [STORAGE_KEYS.IS_ADMIN]: false,
    });

    const { result } = renderHook(() => useAuth(), { wrapper: StrictMode });

    await waitFor(() => expect(result.current.user?.id).toBe(profile.id));
    expect(result.current.user?.email).toBe(profile.email);
    expect(result.current.status).toBe('signed-in');
  });

  it('hydrates a remaining consumer after the first consumer unmounts', async () => {
    const profile = profiles[0]!;
    dependencies.verifiedUser.mockResolvedValue(profile);
    await chrome.storage.local.set({
      [STORAGE_KEYS.USER_PROFILE]: profile,
      [STORAGE_KEYS.IS_ADMIN]: false,
    });
    let releaseRestore!: () => void;
    dependencies.restore.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          releaseRestore = () => resolve(true);
        }),
    );

    const first = renderHook(() => useAuth());
    const remaining = renderHook(() => useAuth());
    first.unmount();
    releaseRestore();

    await waitFor(() => expect(remaining.result.current.user?.id).toBe(profile.id));
    expect(remaining.result.current.status).toBe('signed-in');
  });

  it('does not restore an old admin flag after another consumer signs out', async () => {
    const profile = profiles[0]!;
    dependencies.verifiedUser.mockResolvedValue(profile);
    await chrome.storage.local.set({
      [STORAGE_KEYS.USER_PROFILE]: profile,
      [STORAGE_KEYS.IS_ADMIN]: false,
    });
    let resolveAdmin!: (value: boolean) => void;
    dependencies.checkIsAdmin.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveAdmin = resolve;
        }),
    );

    const first = renderHook(() => useAuth());
    const second = renderHook(() => useAuth());
    await waitFor(() => expect(first.result.current.user?.id).toBe(profile.id));

    await act(async () => second.result.current.signOut());
    await act(async () => resolveAdmin(true));

    expect(first.result.current.user).toBeNull();
    expect(first.result.current.isAdmin).toBe(false);
    expect((await chrome.storage.local.get(STORAGE_KEYS.IS_ADMIN))[STORAGE_KEYS.IS_ADMIN]).toBeUndefined();
  });

  it('keeps a saved profile recoverable but shows guest when session restore fails', async () => {
    const profile = profiles[0]!;
    dependencies.restore.mockResolvedValue(false);
    dependencies.verifiedUser.mockResolvedValue(profile);
    await chrome.storage.local.set({
      [STORAGE_KEYS.USER_PROFILE]: profile,
      [STORAGE_KEYS.IS_ADMIN]: true,
    });

    const { result } = renderHook(() => useAuth(), { wrapper: StrictMode });

    await waitFor(() => expect(result.current.status).toBe('signed-out'));
    expect(result.current.user).toBeNull();
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.error).toMatch(/could not restore your saved sign-in/i);
    expect((await chrome.storage.local.get(STORAGE_KEYS.USER_PROFILE))[STORAGE_KEYS.USER_PROFILE]).toEqual(profile);
    expect(dependencies.verifiedUser).not.toHaveBeenCalled();
  });

  it('ignores a stale admin cache when there is no saved profile or session', async () => {
    dependencies.restore.mockResolvedValue(false);
    await chrome.storage.local.set({ [STORAGE_KEYS.IS_ADMIN]: true });

    const { result } = renderHook(() => useAuth(), { wrapper: StrictMode });

    await waitFor(() => expect(result.current.status).toBe('signed-out'));
    expect(result.current.user).toBeNull();
    expect(result.current.isAdmin).toBe(false);
    expect(dependencies.checkIsAdmin).not.toHaveBeenCalled();
  });

  it('refuses a saved profile that belongs to a different verified bearer', async () => {
    const savedProfile = profiles[0]!;
    dependencies.verifiedUser.mockResolvedValue(profiles[1]);
    await chrome.storage.local.set({
      [STORAGE_KEYS.USER_PROFILE]: savedProfile,
      [STORAGE_KEYS.IS_ADMIN]: true,
    });

    const { result } = renderHook(() => useAuth(), { wrapper: StrictMode });

    await waitFor(() => expect(result.current.status).toBe('signed-out'));
    expect(result.current.user).toBeNull();
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.error).toMatch(/does not match your saved account/i);
    expect(dependencies.checkIsAdmin).not.toHaveBeenCalled();
  });

  it('shows a recoverable guest state when restored credentials cannot be verified', async () => {
    const profile = profiles[0]!;
    await chrome.storage.local.set({
      [STORAGE_KEYS.USER_PROFILE]: profile,
      [STORAGE_KEYS.IS_ADMIN]: true,
    });

    const { result } = renderHook(() => useAuth(), { wrapper: StrictMode });

    await waitFor(() => expect(result.current.status).toBe('signed-out'));
    expect(result.current.user).toBeNull();
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.error).toMatch(/could not verify your saved sign-in/i);
    expect((await chrome.storage.local.get(STORAGE_KEYS.USER_PROFILE))[STORAGE_KEYS.USER_PROFILE]).toEqual(profile);
  });

  it('shows admin only after the authenticated account passes the admin check', async () => {
    const profile = profiles[0]!;
    dependencies.verifiedUser.mockResolvedValue(profile);
    dependencies.checkIsAdmin.mockResolvedValue(true);
    await chrome.storage.local.set({
      [STORAGE_KEYS.USER_PROFILE]: profile,
      [STORAGE_KEYS.IS_ADMIN]: false,
    });

    const { result } = renderHook(() => useAuth(), { wrapper: StrictMode });

    await waitFor(() => expect(result.current.isAdmin).toBe(true));
    expect(result.current.user?.id).toBe(profile.id);
    expect(result.current.status).toBe('signed-in');
  });
});
