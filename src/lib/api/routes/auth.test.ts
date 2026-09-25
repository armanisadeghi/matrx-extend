import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  token: null as string | null,
  requireOrganization: vi.fn<() => Promise<string>>(),
}));

vi.mock('@/lib/auth/flow', () => ({
  getAccessToken: async () => harness.token,
}));
vi.mock('@/lib/org/active-org', () => ({
  requireActiveOrganizationId: harness.requireOrganization,
}));

import { organizationIdForAgentStart } from './auth';

beforeEach(() => {
  harness.token = null;
  harness.requireOrganization.mockReset();
  harness.requireOrganization.mockResolvedValue('22222222-2222-4222-8222-222222222222');
});

describe('organizationIdForAgentStart', () => {
  it('omits organization_id for a fingerprint guest without reading memberships', async () => {
    await expect(organizationIdForAgentStart()).resolves.toBeUndefined();
    expect(harness.requireOrganization).not.toHaveBeenCalled();
  });

  it('keeps the explicit active-organization requirement for a bearer start', async () => {
    harness.token = 'bearer';
    await expect(organizationIdForAgentStart()).resolves.toBe(
      '22222222-2222-4222-8222-222222222222',
    );
    expect(harness.requireOrganization).toHaveBeenCalledTimes(1);
  });
});
