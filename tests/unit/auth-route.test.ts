/**
 * Which organization this install acts in — THE LOAD LADDER (Arman, 2026-10-07).
 *
 * Set once at load, never none for a person with a membership: this device's
 * own last choice -> the account's last active organization -> the account's
 * start-up organization -> the first (oldest) organization, each kept only if
 * a current membership. A ladder answer is never written back as the device
 * choice; a deliberate switch writes the device choice AND calls
 * `users.set_last_active_organization`. There is no hold and no picker.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORG_A = '22222222-2222-4222-8222-222222222222';
const ORG_B = '33333333-3333-4333-8333-333333333333';
const ORG_C = '55555555-5555-4555-8555-555555555555';
const ORG_GONE = '44444444-4444-4444-8444-444444444444';

/**
 * A REAL chrome.storage.local seam: values persist and `onChange` fires. The
 * hold resolves by hearing a write, so a stubbed storage that forgets or
 * stays silent would prove nothing about it.
 */
const mocks = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const watchers = new Set<(key: string, value: unknown) => void>();
  return {
    store,
    watchers,
    getCurrentUser: vi.fn(),
    rpc: vi.fn(),
    orgSelect: vi.fn(),
    prefsSelect: vi.fn(),
    schemaRpc: vi.fn(),
    pushNotice: vi.fn(),
    getOne: vi.fn(async (key: string) => store.get(key) ?? null),
    setOne: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      for (const watcher of [...watchers]) watcher(key, value);
    }),
    onChange: vi.fn((key: string, cb: (next: unknown) => void) => {
      const watcher = (changed: string, value: unknown) => {
        if (changed === key) cb(value ?? null);
      };
      watchers.add(watcher);
      return () => watchers.delete(watcher);
    }),
  };
});

vi.mock('@/lib/auth/flow', () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock('@/lib/supabase/client', () => ({
  getSupabase: () => ({
    rpc: mocks.rpc,
    schema: (name: string) => ({
      rpc: (fn: string, args: unknown) => mocks.schemaRpc(name, fn, args),
    }),
  }),
}));
vi.mock('@/lib/supabase/schemas', () => ({
  iamDb: () => ({
    from: () => ({
      select: () => ({
        in: (...ids: unknown[]) => ({
          is: (column: string, value: null) => mocks.orgSelect(...ids, column, value),
        }),
      }),
    }),
  }),
  usersDb: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.prefsSelect }) }) }),
  }),
}));
vi.mock('@/lib/storage/chrome-local', () => ({
  getOne: mocks.getOne,
  setOne: mocks.setOne,
  onChange: mocks.onChange,
}));
vi.mock('@/state/notices', () => ({ pushNotice: mocks.pushNotice }));
vi.mock('@/lib/debug/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

/** Memberships in the order given are oldest first (created_at ascending). */
function membershipsFor(...ids: string[]) {
  mocks.rpc.mockResolvedValue({
    data: ids.map((id, i) => ({
      container_id: id,
      status: 'active',
      created_at: `2026-01-0${i + 1}T00:00:00Z`,
    })),
    error: null,
  });
  // The database returns rows in no particular order.
  mocks.orgSelect.mockResolvedValue({
    data: [...ids].reverse().map((id) => ({ id, name: `Org ${id.slice(0, 4)}` })),
    error: null,
  });
}

/** The account's two saved organization columns. */
function accountChoice(lastActive: string | null, startup: string | null) {
  mocks.prefsSelect.mockResolvedValue({
    data: { last_active_organization_id: lastActive, startup_organization_id: startup },
    error: null,
  });
}

const ACTIVE = 'matrx.org.active';

describe('the load ladder — the organization this install acts in', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.store.clear();
    mocks.watchers.clear();
    mocks.getCurrentUser.mockResolvedValue({ id: USER_ID, email: 'a@b.c' });
    mocks.schemaRpc.mockResolvedValue({ error: null });
    accountChoice(null, null);
  });

  it("rung 1: this device's own last choice beats the account", async () => {
    membershipsFor(ORG_A, ORG_B);
    mocks.store.set(ACTIVE, { id: ORG_A, name: 'Org A' });
    accountChoice(ORG_B, ORG_B);
    const { getActiveOrganizationId } = await import('@/lib/org/active-org');
    await expect(getActiveOrganizationId()).resolves.toBe(ORG_A);
  });

  it("rung 2: with no device choice, the account's last active organization wins", async () => {
    membershipsFor(ORG_A, ORG_B, ORG_C);
    accountChoice(ORG_B, ORG_C);
    const { getActiveOrganizationId } = await import('@/lib/org/active-org');
    await expect(getActiveOrganizationId()).resolves.toBe(ORG_B);
  });

  it('rung 3: a last active organization that is no longer a membership falls to the start-up organization', async () => {
    membershipsFor(ORG_A, ORG_C);
    accountChoice(ORG_GONE, ORG_C);
    const { getActiveOrganizationId } = await import('@/lib/org/active-org');
    await expect(getActiveOrganizationId()).resolves.toBe(ORG_C);
  });

  it('rung 4: with neither saved, the FIRST (oldest) organization, never none', async () => {
    membershipsFor(ORG_A, ORG_B);
    const { getActiveOrganizationId, requireActiveOrganizationId } = await import(
      '@/lib/org/active-org'
    );
    await expect(getActiveOrganizationId()).resolves.toBe(ORG_A);
    await expect(requireActiveOrganizationId()).resolves.toBe(ORG_A);
  });

  it('a person with no preferences row at all still gets their first organization', async () => {
    membershipsFor(ORG_A, ORG_B);
    mocks.prefsSelect.mockResolvedValue({ data: null, error: null });
    const { getActiveOrganizationId } = await import('@/lib/org/active-org');
    await expect(getActiveOrganizationId()).resolves.toBe(ORG_A);
  });

  it('a ladder answer is NOT stored as the device choice, and is reused for warm requests', async () => {
    membershipsFor(ORG_A, ORG_B);
    accountChoice(ORG_B, null);
    const { getActiveOrganizationId } = await import('@/lib/org/active-org');
    await expect(
      Promise.all([getActiveOrganizationId(), getActiveOrganizationId()]),
    ).resolves.toEqual([ORG_B, ORG_B]);
    await expect(getActiveOrganizationId()).resolves.toBe(ORG_B);
    expect(mocks.store.get(ACTIVE)).toBeUndefined();
    expect(mocks.schemaRpc).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.prefsSelect).toHaveBeenCalledTimes(1);
  });

  it('drops a device choice the person has been removed from and re-runs the ladder', async () => {
    mocks.store.set(ACTIVE, { id: ORG_GONE, name: 'Stale' });
    membershipsFor(ORG_A, ORG_B);
    accountChoice(ORG_B, null);
    const { resolveActiveOrganization } = await import('@/lib/org/active-org');
    await expect(resolveActiveOrganization()).resolves.toMatchObject({ id: ORG_B });
    expect(mocks.store.get(ACTIVE)).toBeNull();
  });

  it('zero memberships is the one honest none: refuses with its remedy, no picker, no hold', async () => {
    membershipsFor();
    const { requireActiveOrganizationId, isOrganizationNoMembershipsError } = await import(
      '@/lib/org/active-org'
    );
    const err = await requireActiveOrganizationId().catch((e: unknown) => e);
    expect(isOrganizationNoMembershipsError(err)).toBe(true);
    expect(mocks.prefsSelect).not.toHaveBeenCalled();
  });

  it('a failed account read is an honest error, never a guessed first organization', async () => {
    membershipsFor(ORG_A, ORG_B);
    mocks.prefsSelect.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const { getActiveOrganizationId } = await import('@/lib/org/active-org');
    await expect(getActiveOrganizationId()).rejects.toThrow('Could not read your saved');
  });

  it('a switch writes the device choice AND the account (users.set_last_active_organization)', async () => {
    membershipsFor(ORG_A, ORG_B);
    const { setActiveOrganization, getActiveOrganizationId } = await import('@/lib/org/active-org');
    await setActiveOrganization(ORG_B);
    expect(mocks.store.get(ACTIVE)).toEqual({ id: ORG_B, name: expect.any(String) });
    expect(mocks.schemaRpc).toHaveBeenCalledWith('users', 'set_last_active_organization', {
      p_organization_id: ORG_B,
    });
    await expect(getActiveOrganizationId()).resolves.toBe(ORG_B);
  });

  it('a failed account save raises a visible notice while the device switch stands', async () => {
    membershipsFor(ORG_A, ORG_B);
    mocks.schemaRpc.mockResolvedValue({ error: { message: 'rpc down' } });
    const { setActiveOrganization, getActiveOrganizationId } = await import('@/lib/org/active-org');
    await setActiveOrganization(ORG_B);
    expect(mocks.store.get(ACTIVE)).toEqual({ id: ORG_B, name: expect.any(String) });
    await expect(getActiveOrganizationId()).resolves.toBe(ORG_B);
    expect(mocks.pushNotice).toHaveBeenCalledTimes(1);
    expect(mocks.pushNotice).toHaveBeenCalledWith(
      expect.objectContaining({ tone: 'warning', title: expect.stringMatching(/not saved/i) }),
    );
  });

  it('a successful account save raises no notice', async () => {
    membershipsFor(ORG_A, ORG_B);
    const { setActiveOrganization } = await import('@/lib/org/active-org');
    await setActiveOrganization(ORG_B);
    expect(mocks.pushNotice).not.toHaveBeenCalled();
  });

  it('excludes archived organizations and clears a stored choice after its organization closes', async () => {
    const archived = ORG_GONE;
    membershipsFor(ORG_A, archived);
    mocks.orgSelect.mockResolvedValueOnce({
      data: [{ id: ORG_A, name: 'Active A' }],
      error: null,
    });
    mocks.store.set(ACTIVE, { id: archived, name: 'Archived organization' });
    const { resolveActiveOrganization } = await import('@/lib/org/active-org');

    await expect(resolveActiveOrganization()).resolves.toMatchObject({ id: ORG_A });
    expect(mocks.orgSelect).toHaveBeenCalledWith(
      'id',
      expect.arrayContaining([archived]),
      'archived_at',
      null,
    );
    expect(mocks.store.get(ACTIVE)).toBeNull();
  });

  it('refuses a stored archived choice on the request path, even with no open organizations', async () => {
    membershipsFor(ORG_GONE);
    mocks.orgSelect.mockResolvedValueOnce({ data: [], error: null });
    mocks.store.set(ACTIVE, { id: ORG_GONE, name: 'Archived organization' });
    const { getActiveOrganizationId } = await import('@/lib/org/active-org');

    await expect(getActiveOrganizationId()).resolves.toBeNull();
    expect(mocks.store.get(ACTIVE)).toBeNull();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('shares the first validation and reuses it for warm requests of the same identity', async () => {
    membershipsFor(ORG_A);
    mocks.store.set(ACTIVE, { id: ORG_A, name: 'Active A' });
    const { getActiveOrganizationId } = await import('@/lib/org/active-org');

    await expect(
      Promise.all([getActiveOrganizationId(), getActiveOrganizationId()]),
    ).resolves.toEqual([ORG_A, ORG_A]);
    await expect(getActiveOrganizationId()).resolves.toBe(ORG_A);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.orgSelect).toHaveBeenCalledTimes(1);
  });

  it('does not certify or clear a choice changed while validation was in flight', async () => {
    membershipsFor(ORG_A, ORG_B);
    let finishRead: ((value: unknown) => void) | undefined;
    mocks.orgSelect.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        }),
    );
    mocks.store.set(ACTIVE, { id: ORG_A, name: 'Active A' });
    const { getActiveOrganizationId } = await import('@/lib/org/active-org');

    const first = getActiveOrganizationId();
    for (let attempt = 0; !finishRead && attempt < 10; attempt += 1)
      await new Promise((resolve) => setTimeout(resolve, 0));
    expect(finishRead).toBeDefined();
    await mocks.setOne(ACTIVE, { id: ORG_B, name: 'Active B' });
    finishRead?.({ data: [{ id: ORG_A, name: 'Active A' }], error: null });

    await expect(first).resolves.toBeNull();
    expect(mocks.store.get(ACTIVE)).toEqual({ id: ORG_B, name: 'Active B' });
    await expect(getActiveOrganizationId()).resolves.toBe(ORG_B);
  });

  it('never claims an organization for a signed-out install', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const { getActiveOrganizationId } = await import('@/lib/org/active-org');
    await expect(getActiveOrganizationId()).resolves.toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('refuses to store an organization the person is not a member of', async () => {
    membershipsFor(ORG_A);
    const { setActiveOrganization } = await import('@/lib/org/active-org');
    await expect(setActiveOrganization(ORG_B)).rejects.toThrow('not a member');
    expect(mocks.store.get(ACTIVE)).toBeUndefined();
    expect(mocks.schemaRpc).not.toHaveBeenCalled();
  });
});
