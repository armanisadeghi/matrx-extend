import { describe, expect, it, vi } from 'vitest';

describe('app config bootstrap', () => {
  it('reads distinct bundled config keys before database credentials exist', async () => {
    vi.stubEnv('WXT_SUPABASE_URL', '');
    vi.stubEnv('WXT_SUPABASE_PUBLISHABLE_KEY', '');
    try {
      const { ENV } = await import('@/config/env');
      expect(ENV.FRONTEND_URL).toBe('https://aimatrx.com');
      expect(ENV.DESKTOP_NATIVE_HOST).toBe('com.matrx.local');
      expect(() => ENV.SUPABASE_URL).toThrow('Missing required env var: WXT_SUPABASE_URL');
      expect(() => ENV.SUPABASE_PUBLISHABLE_KEY).toThrow(
        'Missing required env var: WXT_SUPABASE_PUBLISHABLE_KEY',
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
