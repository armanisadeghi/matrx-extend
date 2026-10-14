import { listHomeChoices, resolveHomeScopeId } from '@/lib/homes/queries';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({
  getSupabase: () => ({ schema: () => ({ rpc: db.rpc }) }),
}));

const org = '44444444-4444-4444-8444-444444444444';

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

it('preserves the original database message when loading homes fails', async () => {
  db.rpc.mockResolvedValue({ data: null, error: { message: 'Membership changed', code: '42501' } });
  await expect(listHomeChoices()).rejects.toThrow('Could not load homes: Membership changed');
});

it('preserves the original database message when choosing General fails', async () => {
  db.rpc.mockResolvedValue({ data: null, error: { message: 'Membership changed', code: '42501' } });
  await expect(resolveHomeScopeId(`general:${org}`)).rejects.toThrow(
    'Could not choose home: Membership changed',
  );
});
