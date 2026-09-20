/**
 * Which organization this install acts in.
 *
 * The rules exist to stop ONE failure: a guessed organization writes a user's
 * work into the wrong tenant, silently. So every test here is either "we ask
 * rather than guess" or the positive control that proves the asking isn't
 * just a broken resolver refusing everything.
 *
 * THE RUNG THAT MUST STAY DEAD (Arman, 2026-09-19). A user-level saved
 * `defaultOrganizationId` preference is a display preference and must never
 * build a request. `mocks.prefsSelect` below still answers with a real
 * preference row naming ORG_B, so the moment anybody re-adds that read the
 * first test goes red: the resolver would return ORG_B instead of asking.
 *
 * This file used to assert two contracts that are now both gone — that the
 * client asks `GET /auth/whoami` which organization the request "carried",
 * and that the saved preference wins over the ambiguity.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORG_A = '22222222-2222-4222-8222-222222222222';
const ORG_B = '33333333-3333-4333-8333-333333333333';
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
    broadcast: vi.fn(),
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
  onChange: mocks.onChange,
}));
vi.mock('@/lib/messaging/native', () => ({ broadcast: mocks.broadcast, on: () => () => {} }));
vi.mock('@/lib/debug/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

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

/** The user-level saved preference — present, readable, and irrelevant. */
function savedPreference(id: string | null) {
  mocks.prefsSelect.mockResolvedValue({
    // The tests below PLANT this preference to prove the resolver never reads it.
    // org-default-exempt: a fixture that has to name the banned rung to refuse it
    data: { preferences: { organization: { defaultOrganizationId: id } } },
    error: null,
  });
}

const PICKER_PENDING = 'matrx.org.picker-pending';
const ACTIVE = 'matrx.org.active';

describe('the organization this install acts in', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.store.clear();
    mocks.watchers.clear();
    mocks.getCurrentUser.mockResolvedValue({ id: USER_ID, email: 'a@b.c' });
    savedPreference(null);
  });

  it('IGNORES the account-level saved preference and asks instead', async () => {
    // The device has chosen nothing; the account says ORG_B; the person is in
    // both. Returning ORG_B here is the defect this test exists to catch.
    membershipsFor(ORG_A, ORG_B);
    savedPreference(ORG_B);
    const {
      resolveActiveOrganization,
      holdForActiveOrganizationId,
      isOrganizationNotSelectedError,
    } = await import('@/lib/org/active-org');

    await expect(resolveActiveOrganization()).resolves.toBeNull();

    const err = await holdForActiveOrganizationId({ timeoutMs: 10 }).catch((e: unknown) => e);
    expect(isOrganizationNotSelectedError(err)).toBe(true);
    expect(mocks.store.get(ACTIVE)).toBeUndefined();
  });

  it('holds a scoped operation, raises the picker, and resumes with what the person set', async () => {
    membershipsFor(ORG_A, ORG_B);
    const { holdForActiveOrganizationId, setActiveOrganization } = await import(
      '@/lib/org/active-org'
    );

    const held = holdForActiveOrganizationId();
    // Give the hold a turn to resolve, request the picker, and subscribe.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Both halves of the ask: the durable flag (a closed panel asks later) and
    // the broadcast (an open panel asks now).
    expect(mocks.store.get(PICKER_PENDING)).toBe(true);
    expect(mocks.broadcast).toHaveBeenCalledWith('org:picker-requested', {});

    await setActiveOrganization(ORG_B);

    await expect(held).resolves.toBe(ORG_B);
    // The question has been answered — nothing asks again.
    expect(mocks.store.get(PICKER_PENDING)).toBeNull();
  });

  it('uses the sole membership with no picker — there is nothing to choose', async () => {
    // Positive control: a resolver that asked for everything would fail here.
    membershipsFor(ORG_A);
    const { holdForActiveOrganizationId } = await import('@/lib/org/active-org');
    await expect(holdForActiveOrganizationId({ timeoutMs: 10 })).resolves.toBe(ORG_A);
    expect(mocks.broadcast).not.toHaveBeenCalled();
    expect(mocks.store.get(PICKER_PENDING)).toBeUndefined();
  });

  it('drops a stored selection the person has been removed from and asks again', async () => {
    mocks.store.set(ACTIVE, { id: ORG_GONE, name: 'Stale' });
    membershipsFor(ORG_A, ORG_B);
    const {
      resolveActiveOrganization,
      holdForActiveOrganizationId,
      isOrganizationNotSelectedError,
    } = await import('@/lib/org/active-org');

    await expect(resolveActiveOrganization()).resolves.toBeNull();
    expect(mocks.store.get(ACTIVE)).toBeNull();

    const err = await holdForActiveOrganizationId({ timeoutMs: 10 }).catch((e: unknown) => e);
    expect(isOrganizationNotSelectedError(err)).toBe(true);
    // Never silently promoted to one of the memberships it DOES have.
    expect(mocks.store.get(ACTIVE)).toBeNull();
  });

  it('gives up with a remedy when nobody answers, and never guesses on the way out', async () => {
    membershipsFor(ORG_A, ORG_B);
    const { holdForActiveOrganizationId, isOrganizationNotSelectedError } = await import(
      '@/lib/org/active-org'
    );
    const err = await holdForActiveOrganizationId({ timeoutMs: 20 }).catch((e: unknown) => e);
    expect(isOrganizationNotSelectedError(err)).toBe(true);
    expect((err as { remedy: string }).remedy).toMatch(/choose your organization/i);
    expect(mocks.store.get(ACTIVE)).toBeUndefined();
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
  });
});
