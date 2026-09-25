import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  token: 'token-a' as string | null,
  organizationId: 'organization-a' as string | null,
}));

vi.mock('@/lib/auth/flow', () => ({
  getAccessToken: async () => state.token,
}));
vi.mock('@/lib/org/active-org', () => ({
  getActiveOrganizationId: async () => state.organizationId,
}));

import { parallelActorStillCurrent } from './parallel-actor';

describe('parallelActorStillCurrent', () => {
  beforeEach(() => {
    state.token = 'token-a';
    state.organizationId = 'organization-a';
  });

  it('allows only the actor captured for this child dispatch', async () => {
    await expect(
      parallelActorStillCurrent({ authHeader: 'Bearer token-a', organizationId: 'organization-a' }),
    ).resolves.toBe(true);
  });

  it('refuses a child dispatch after the organization changes', async () => {
    state.organizationId = 'organization-b';
    await expect(
      parallelActorStillCurrent({ authHeader: 'Bearer token-a', organizationId: 'organization-a' }),
    ).resolves.toBe(false);
  });
});
