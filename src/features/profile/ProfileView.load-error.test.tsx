import type { fetchUserFormProfile } from '@/lib/supabase/user-profile';
import { profileFixture } from '@/lib/supabase/user-profile.fixture';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

type ReadResult = Awaited<ReturnType<typeof fetchUserFormProfile>>;
const state = vi.hoisted(() => ({
  reads: [] as Array<(value: ReadResult) => void>,
  write: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'owner-a', email: 'admin@admin.com', full_name: 'Admin' } }),
}));
vi.mock('@/state/sidepanel-tab', () => ({
  useSidepanelTabStore: (select: (state: { setTab: () => void }) => unknown) =>
    select({ setTab: vi.fn() }),
}));
vi.mock('@/lib/supabase/user-profile', async (original) => ({
  ...(await original<typeof import('@/lib/supabase/user-profile')>()),
  fetchUserFormProfile: () => new Promise((resolve) => state.reads.push(resolve)),
  upsertUserFormProfile: state.write,
}));
import { ProfileView } from './ProfileView';
afterEach(() => {
  cleanup();
  state.reads = [];
  state.write.mockClear();
});
async function read(index: number, value: ReadResult) {
  await act(async () => {
    state.reads[index]?.(value);
  });
}
function assertBlocked() {
  expect(screen.getByRole('alert').textContent).toContain('Could not load your profile');
  expect(screen.queryByText('Preferred')).toBeNull();
  const saves = screen.getAllByRole('button', { name: /save/i });
  expect(saves.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
  expect(screen.queryByText('Unsaved changes')).toBeNull();
}
it('recovers an editable saved profile after a denied owner read and Retry', async () => {
  render(<ProfileView />);
  await read(0, { ok: false, error: 'permission denied' });
  assertBlocked();
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading profile' }));
  await read(1, { ok: true, profile: profileFixture });
  expect(screen.queryByRole('alert')).toBeNull();
  const field = screen.getByDisplayValue('Maya');
  fireEvent.change(field, { target: { value: 'Maya edited' } });
  expect((screen.getByRole('button', { name: 'Save profile' }) as HTMLButtonElement).disabled).toBe(
    false,
  );
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
  });
  expect(state.write).toHaveBeenCalledWith('owner-a', { preferred_name: 'Maya edited' });
});
it('removes every actionable Save when the dirty save refetch fails', async () => {
  render(<ProfileView />);
  await read(0, { ok: true, profile: profileFixture });
  fireEvent.change(screen.getByDisplayValue('Maya'), { target: { value: 'Maya edited' } });
  expect(screen.getByText('Unsaved changes')).toBeTruthy();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
  });
  await read(1, { ok: false, error: 'permission denied' });
  assertBlocked();
  fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
  expect(state.write).toHaveBeenCalledTimes(1);
});
