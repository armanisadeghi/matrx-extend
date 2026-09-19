import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/supabase/schemas', () => ({
  platformDb: () => ({ rpc: mocks.rpc }),
}));

import { resolveGeneratedCredentialLimits } from './generation-limits';

const actor = { userId: 'user-1', organizationId: 'org-1' };
const admission = {
  current: () => true,
  run: async <T>(work: () => Promise<T>) => work(),
};

describe('generated credential limits', () => {
  beforeEach(() => mocks.rpc.mockReset());

  it('resolves both organization-scoped generator ceilings through knob_resolve', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: 1024, error: null })
      .mockResolvedValueOnce({ data: 64, error: null });

    await expect(resolveGeneratedCredentialLimits(actor, admission)).resolves.toEqual({
      ok: true,
      limits: { maxPasswordLength: 1024, maxPassphraseWords: 64 },
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'knob_resolve', {
      p_feature: 'vault.generator',
      p_key: 'max_password_length',
      p_organization_id: 'org-1',
      p_user_id: 'user-1',
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'knob_resolve', {
      p_feature: 'vault.generator',
      p_key: 'max_passphrase_words',
      p_organization_id: 'org-1',
      p_user_id: 'user-1',
    });
  });

  it('refuses missing, malformed, and technical-ceiling-bypassing settings without defaults', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: 65_537, error: null })
      .mockResolvedValueOnce({ data: 64, error: null });
    await expect(resolveGeneratedCredentialLimits(actor, admission)).resolves.toEqual({
      ok: false,
      reason: 'configuration_unavailable',
    });

    mocks.rpc.mockReset();
    mocks.rpc
      .mockResolvedValueOnce({ data: 1024, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: 'P0001' } });
    await expect(resolveGeneratedCredentialLimits(actor, admission)).resolves.toEqual({
      ok: false,
      reason: 'configuration_unavailable',
    });
  });

  it('does not query when the panel actor/admission is already invalid', async () => {
    await expect(resolveGeneratedCredentialLimits(null, admission)).resolves.toEqual({
      ok: false,
      reason: 'admission_lost',
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
