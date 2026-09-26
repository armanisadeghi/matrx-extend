import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from './check-migrations';
import { selectRowsViaManagementApi } from './_supabase-management';

vi.mock('./_supabase-rest', () => ({
  loadSupabaseEnv: () => null,
  fetchPublicJson: vi.fn(),
}));
vi.mock('./_supabase-management', () => ({
  selectRowsViaManagementApi: vi.fn(),
}));

const originalArgv = [...process.argv];
afterEach(() => {
  process.argv = [...originalArgv];
  vi.mocked(selectRowsViaManagementApi).mockReset();
});

describe('strict migration ledger verification', () => {
  it('fails when both public configuration and operator read are unavailable', async () => {
    process.argv = [...originalArgv, '--strict'];
    vi.mocked(selectRowsViaManagementApi).mockRejectedValue(new Error('operator unavailable'));

    await expect(main()).resolves.toBe(2);
    expect(selectRowsViaManagementApi).toHaveBeenCalledOnce();
  });

  it('attempts the operator ledger read when public configuration is absent', async () => {
    process.argv = [...originalArgv, '--strict'];
    vi.mocked(selectRowsViaManagementApi).mockResolvedValue([]);

    await expect(main()).resolves.toBe(1);
    expect(selectRowsViaManagementApi).toHaveBeenCalledOnce();
  });
});
