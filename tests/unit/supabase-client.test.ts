import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createClient, realtimeSetAuth } = vi.hoisted(() => ({
  createClient: vi.fn(),
  realtimeSetAuth: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({ createClient }));
vi.mock('@/config/env', () => ({
  ENV: {
    SUPABASE_URL: 'https://db.example.test',
    SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key',
  },
  STORAGE_KEYS: { ACCESS_TOKEN: 'matrx.auth.accessToken' },
}));

describe('Supabase client authentication', () => {
  beforeEach(async () => {
    vi.resetModules();
    createClient.mockReset();
    realtimeSetAuth.mockReset();
    createClient.mockReturnValue({ realtime: { setAuth: realtimeSetAuth } });
    await chrome.storage.local.clear();
  });

  it('supplies the extension-owned access token to every Supabase request', async () => {
    await chrome.storage.local.set({ 'matrx.auth.accessToken': 'stored-access-token' });
    const { getSupabase } = await import('@/lib/supabase/client');

    getSupabase();

    const options = createClient.mock.calls[0]?.[2] as {
      accessToken: () => Promise<string | null>;
    };
    await expect(options.accessToken()).resolves.toBe('stored-access-token');

    await chrome.storage.local.remove('matrx.auth.accessToken');
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
