/**
 * Which organization this install acts in.
 *
 * The rules exist to stop ONE failure: a guessed organization writes a user's
 * work into the wrong tenant, silently. So every test here is either "we
 * refuse rather than guess" or the positive control that proves the refusal
 * isn't just a broken resolver refusing everything.
 *
 * This file used to assert the opposite contract — that the client asks
 * `GET /auth/whoami` which organization the request "carried". That was
 * backwards (the client is the side that knows what the user chose) and it
 * died the moment the server stopped guessing.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  rpc: vi.fn(),
  orgSelect: vi.fn(),
  prefsSelect: vi.fn(),
  getOne: vi.fn(),
  setOne: vi.fn(),
}));

vi.mock('@/lib/auth/flow', () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock('@/lib/supabase/client', () => ({ getSupabase: () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/supabase/schemas', () => ({
  iamDb: () => ({ from: () => ({ select: () => ({ in: mocks.orgSelect }) }) }),
  usersDb: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.prefsSelect }) }) }),
  }),
}));
vi.mock('@/lib/storage/chrome-local', () => ({
  getOne: mocks.getOne,
  setOne: mocks.setOne,
}));
vi.mock('@/lib/debug/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORG_A = '22222222-2222-4222-8222-222222222222';
const ORG_B = '33333333-3333-4333-8333-333333333333';

function membershipsFor(...ids: string[]) {
  mocks.rpc.mockResolvedValue({
    data: ids.map((id) => ({ container_id: id })),
    error: null,
  });
  mocks.orgSelect.mockResolvedValue({
    data: ids.map((id) => ({ id, name: `Org ${id.slice(0, 4)}`, is_personal: false })),
    error: null,
  });
}

function defaultOrganization(id: string | null) {
  mocks.prefsSelect.mockResolvedValue({
    data: { preferences: { organization: { defaultOrganizationId: id } } },
    error: null,
  });
}

describe('the organization this install acts in', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: USER_ID, email: 'a@b.c' });
    mocks.getOne.mockResolvedValue(null);
    defaultOrganization(null);
  });

  it('refuses to choose when the user belongs to several and has stated no default', async () => {
    membershipsFor(ORG_A, ORG_B);
    const { requireActiveOrganizationId, isOrganizationNotSelectedError } = await import(
      '@/lib/org/active-org'
    );

    const err = await requireActiveOrganizationId().catch((e: unknown) => e);
    expect(isOrganizationNotSelectedError(err)).toBe(true);
    // The failure carries the fix, not just the complaint.
    expect((err as { remedy: string }).remedy).toMatch(/Settings/);
  });

  it('uses the sole membership — there is nothing to choose', async () => {
    // Positive control: a resolver that refused everything would fail here.
    membershipsFor(ORG_A);
    const { requireActiveOrganizationId } = await import('@/lib/org/active-org');
    await expect(requireActiveOrganizationId()).resolves.toBe(ORG_A);
  });

  it("honours the user's durable default over the ambiguity", async () => {
    membershipsFor(ORG_A, ORG_B);
    defaultOrganization(ORG_B);
    const { requireActiveOrganizationId } = await import('@/lib/org/active-org');
    await expect(requireActiveOrganizationId()).resolves.toBe(ORG_B);
  });

  it('ignores a default the user is no longer a member of', async () => {
    membershipsFor(ORG_A, ORG_B);
    defaultOrganization('44444444-4444-4444-8444-444444444444');
    const { requireActiveOrganizationId, isOrganizationNotSelectedError } = await import(
      '@/lib/org/active-org'
    );
    const err = await requireActiveOrganizationId().catch((e: unknown) => e);
    expect(isOrganizationNotSelectedError(err)).toBe(true);
  });

  it('drops a stored selection the user has been removed from rather than sending it', async () => {
    mocks.getOne.mockResolvedValue({ id: ORG_B, name: 'Stale' });
    membershipsFor(ORG_A);
    const { resolveActiveOrganization } = await import('@/lib/org/active-org');

    // Falls through to the sole remaining membership, and forgets the stale one.
    await expect(resolveActiveOrganization()).resolves.toMatchObject({ id: ORG_A });
    expect(mocks.setOne).toHaveBeenCalledWith(expect.any(String), null);
  });

  it('never claims an organization for a signed-out install', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const { getActiveOrganizationId } = await import('@/lib/org/active-org');
    await expect(getActiveOrganizationId()).resolves.toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('refuses to store an organization the user is not a member of', async () => {
    membershipsFor(ORG_A);
    const { setActiveOrganization } = await import('@/lib/org/active-org');
    await expect(setActiveOrganization(ORG_B)).rejects.toThrow('not a member');
    expect(mocks.setOne).not.toHaveBeenCalled();
  });
});
