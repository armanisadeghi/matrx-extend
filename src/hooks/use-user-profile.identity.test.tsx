import type { fetchUserFormProfile, upsertUserFormProfile } from '@/lib/supabase/user-profile';
import { profileFixture } from '@/lib/supabase/user-profile.fixture';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

type ReadResult = Awaited<ReturnType<typeof fetchUserFormProfile>>;
type WriteResult = Awaited<ReturnType<typeof upsertUserFormProfile>>;
const state = vi.hoisted(() => ({
  userId: 'owner-a',
  reads: [] as Array<{ userId: string; resolve: (value: ReadResult) => void }>,
  writes: [] as Array<{ userId: string; resolve: (value: WriteResult) => void }>,
}));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: state.userId } }) }));
vi.mock('@/lib/supabase/user-profile', async (original) => ({
  ...(await original<typeof import('@/lib/supabase/user-profile')>()),
  fetchUserFormProfile: (userId: string) =>
    new Promise((resolve) => state.reads.push({ userId, resolve })),
  upsertUserFormProfile: (userId: string) =>
    new Promise((resolve) => state.writes.push({ userId, resolve })),
}));
import { useUserProfile } from './use-user-profile';

afterEach(cleanup);
beforeEach(() => {
  state.userId = 'owner-a';
  state.reads = [];
  state.writes = [];
});
const first = { ok: true, profile: profileFixture } satisfies ReadResult;
const second = {
  ok: true,
  profile: { ...profileFixture, preferred_name: 'Samir' },
} satisfies ReadResult;
async function read(index: number, value: ReadResult) {
  await act(async () => {
    state.reads[index]?.resolve(value);
  });
}

it('masks prior-owner fields on the first identity render before effects', async () => {
  const frames: Array<{ owner: string; name: string | null | undefined; dirty: boolean }> = [];
  const { result, rerender } = renderHook(() => {
    const profile = useUserProfile();
    frames.push({ owner: state.userId, name: profile.draft.preferred_name, dirty: profile.dirty });
    return profile;
  });
  await read(0, first);
  act(() => result.current.setField('preferred_name', 'Maya edited'));
  state.userId = 'owner-b';
  rerender();
  expect(frames.find((frame) => frame.owner === 'owner-b')).toMatchObject({
    name: undefined,
    dirty: false,
  });
});

it.each([second, { ok: false, error: 'permission denied' } satisfies ReadResult])(
  'isolates old-owner save continuation when the next owner read is %j',
  async (nextRead) => {
    const { result, rerender } = renderHook(() => useUserProfile());
    await read(0, first);
    act(() => result.current.setField('preferred_name', 'Maya edited'));
    let pending!: Promise<{ ok: boolean }>;
    act(() => {
      pending = result.current.save();
    });
    expect(state.writes[0]?.userId).toBe('owner-a');
    state.userId = 'owner-b';
    rerender();
    await read(1, nextRead);
    await act(async () => {
      state.writes[0]?.resolve({ ok: true });
    });
    expect(state.reads.map((entry) => entry.userId)).toEqual(['owner-a', 'owner-b']);
    await pending;
    expect(result.current.draft.preferred_name).toBe(nextRead.ok ? 'Samir' : undefined);
    expect(result.current.loadError).toBe(
      nextRead.ok ? null : 'Could not load your profile: permission denied',
    );
    expect(result.current.saving).toBe(false);
  },
);

it('isolates a stale refresh from the next owner read', async () => {
  const { result, rerender } = renderHook(() => useUserProfile());
  await read(0, first);
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.refresh();
  });
  state.userId = 'owner-b';
  rerender();
  await read(2, second);
  await read(1, first);
  await pending;
  expect(result.current.draft.preferred_name).toBe('Samir');
});

it('refuses another write after a saved draft cannot be reloaded and recovers on Retry', async () => {
  const { result } = renderHook(() => useUserProfile());
  await read(0, first);
  act(() => result.current.setField('preferred_name', 'Maya edited'));
  let pending!: Promise<{ ok: boolean }>;
  act(() => {
    pending = result.current.save();
  });
  await act(async () => {
    state.writes[0]?.resolve({ ok: true });
  });
  await read(1, { ok: false, error: 'permission denied' });
  await pending;
  expect(result.current.loadError).toContain('permission denied');
  act(() => {
    void result.current.save();
  });
  expect(state.writes).toHaveLength(1);
  let retry!: Promise<void>;
  act(() => {
    retry = result.current.refresh();
  });
  await read(2, second);
  await retry;
  act(() => result.current.setField('preferred_name', 'Samir edited'));
  expect(result.current.dirty).toBe(true);
  act(() => {
    void result.current.save();
  });
  expect(state.writes).toHaveLength(2);
});

it('refuses Save synchronously when refresh invalidates the loaded baseline', async () => {
  const { result } = renderHook(() => useUserProfile());
  await read(0, first);
  act(() => result.current.setField('preferred_name', 'Maya edited'));
  act(() => {
    void result.current.refresh();
    void result.current.save();
  });
  expect(state.writes).toHaveLength(0);
  await read(1, second);
  act(() => result.current.setField('preferred_name', 'Samir edited'));
  act(() => {
    void result.current.save();
  });
  expect(state.writes).toHaveLength(1);
});
