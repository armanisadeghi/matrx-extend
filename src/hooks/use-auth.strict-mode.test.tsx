import { STORAGE_KEYS } from '@/config/env';
import type { UserProfile } from '@/lib/auth/types';
import { useAuthStore } from '@/state/auth';
import { renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// EXT-D-0007: Strict Mode replays the mount effect while the persisted-profile
// read is pending. The hook must still hydrate the person who owns this install.
const dependencies = vi.hoisted(() => ({
  restore: vi.fn(async () => true),
  checkIsAdmin: vi.fn(async () => false),
}));

vi.mock('@/lib/auth/flow', () => ({
  restoreSupabaseSession: dependencies.restore,
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
  dependencies.restore.mockClear();
  dependencies.checkIsAdmin.mockClear();
  await chrome.storage.local.remove([STORAGE_KEYS.USER_PROFILE, STORAGE_KEYS.IS_ADMIN]);
});

afterEach(async () => {
  await chrome.storage.local.remove([STORAGE_KEYS.USER_PROFILE, STORAGE_KEYS.IS_ADMIN]);
  resetAuthBootGuard();
});

describe('useAuth persisted-session boot', () => {
  it('hydrates the persisted admin profile without effect replay', async () => {
    const profile = profiles[0]!;
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
    await chrome.storage.local.set({
      [STORAGE_KEYS.USER_PROFILE]: profile,
      [STORAGE_KEYS.IS_ADMIN]: false,
    });

    const { result } = renderHook(() => useAuth(), { wrapper: StrictMode });

    await waitFor(() => expect(result.current.user?.id).toBe(profile.id));
    expect(result.current.user?.email).toBe(profile.email);
    expect(result.current.status).toBe('signed-in');
  });
});
