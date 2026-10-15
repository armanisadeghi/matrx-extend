import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/client', () => ({ getSupabase: () => ({}) }));
vi.mock('@/lib/auth/flow', () => ({ getCurrentUser: async () => null }));
vi.mock('@/lib/org/active-org', () => ({ getActiveOrganizationId: async () => null }));
vi.mock('@/lib/supabase/schemas', () => ({ platformDb: () => ({ rpc: vi.fn() }) }));

describe('config alarm listener (MV3 cold-wake rule)', () => {
  it('registers the onAlarm listener synchronously, before any await', async () => {
    const addListener = vi.fn();
    (globalThis as unknown as { chrome: unknown }).chrome = {
      alarms: { onAlarm: { addListener } },
    };
    const { registerConfigAlarmListener } = await import('./reporting');
    registerConfigAlarmListener();
    expect(addListener).toHaveBeenCalledTimes(1);
  });

  it('bootstrap registers it before the async app-config init starts', () => {
    const src = readFileSync(join(__dirname, '..', 'background', 'bootstrap.ts'), 'utf8');
    const reg = src.indexOf('registerConfigAlarmListener();');
    const init = src.indexOf('void initAppConfig()');
    expect(reg).toBeGreaterThan(-1);
    expect(init).toBeGreaterThan(reg);
  });
});
