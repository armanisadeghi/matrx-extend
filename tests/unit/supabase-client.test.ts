import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createClient, realtimeSetAuth } = vi.hoisted(() => ({
  createClient: vi.fn(),
  realtimeSetAuth: vi.fn(),
}));

const session = vi.hoisted(() => ({ token: 'stored-access-token' as string | null }));
vi.mock('@supabase/supabase-js', () => ({ createClient }));
vi.mock('@/config/env', () => ({
  ENV: {
    SUPABASE_URL: 'https://db.example.test',
    SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key',
  },
  STORAGE_KEYS: {},
}));
// The stored-session reader is the OAuth wiring's (tests/unit/auth-flow.test.ts covers it).
vi.mock('@/lib/auth/flow', () => ({
  getStoredAccessToken: async () => session.token,
}));

describe('Supabase client authentication', () => {
  beforeEach(async () => {
    vi.resetModules();
    createClient.mockReset();
    realtimeSetAuth.mockReset();
    createClient.mockReturnValue({ realtime: { setAuth: realtimeSetAuth } });
    await chrome.storage.local.clear();
    session.token = 'stored-access-token';
  });

  it('supplies the extension-owned access token to every Supabase request', async () => {
    const { getSupabase } = await import('@/lib/supabase/client');

    getSupabase();

    const options = createClient.mock.calls[0]?.[2] as {
      accessToken: () => Promise<string | null>;
    };
    await expect(options.accessToken()).resolves.toBe('stored-access-token');

    session.token = null;
    await expect(options.accessToken()).resolves.toBeNull();
  });

  it('updates and clears Realtime auth without creating a second auth session', async () => {
    const { clearSupabaseSession, setSupabaseSession } = await import('@/lib/supabase/client');

    await setSupabaseSession('fresh-access-token', 'unused-refresh-token');
    expect(realtimeSetAuth).toHaveBeenCalledWith('fresh-access-token');

    await clearSupabaseSession();
    expect(realtimeSetAuth).toHaveBeenLastCalledWith();
  });
});
