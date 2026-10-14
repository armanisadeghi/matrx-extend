import { HomePicker } from '@/features/notes/HomePicker';
import { NotesList } from '@/features/notes/NotesList';
import { listMyHomes, moveNoteHome } from '@/lib/notes/queries';
import { useNotesUiStore } from '@/state/notes';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const ports = vi.hoisted(() => ({ rpc: vi.fn(), tree: vi.fn() }));
vi.mock('@/lib/supabase/schemas', () => ({ platformDb: () => ({ rpc: ports.rpc }) }));
vi.mock('@/lib/supabase/client', () => ({
  getSupabase: () => ({ schema: () => ({ rpc: ports.rpc }) }),
}));
vi.mock('@/lib/api/routes/auth', () => ({
  requireRequestOrganizationId: async () => 'active-org',
}));
vi.mock('@/lib/org/active-org', () => ({ listMemberOrganizations: async () => [] }));
vi.mock('@/lib/records/store', () => ({
  openSpanningClient: async () => ({
    client: { scopes: { tree: ports.tree } },
    organizationIds: [],
  }),
}));
const org = '44444444-4444-4444-8444-444444444444';
const scope = '11111111-1111-4111-8111-111111111111';
// A legal practice files intake notes into its organization's renameable General.
// The platform returns this row before that organization's General is initialized.
const lazyHome = {
  scope_id: null,
  organization_id: org,
  organization_name: 'Law Firm',
  name: 'Intake',
  is_general: true,
  scope_type: 'General',
};
beforeEach(() => {
  vi.clearAllMocks();
  ports.tree.mockResolvedValue({ ok: true, data: [] });
  ports.rpc.mockImplementation(async (name: string) => {
    if (name === 'my_homes') return { data: [lazyHome], error: null };
    if (name === 'ensure_general_scope') return { data: scope, error: null };
    if (name === 'set_home') return { data: {}, error: null };
    throw new Error(`Unexpected RPC ${name}`);
  });
});
afterEach(cleanup);

it('renders a renamed lazy General from the real query without initializing on read or pick', async () => {
  const homes = await listMyHomes();
  const choose = vi.fn();
  render(<HomePicker homes={homes} value={null} placeholder="Choose home" onChange={choose} />);
  fireEvent.click(screen.getByRole('button', { name: 'Choose home' }));
  fireEvent.click(screen.getByRole('button', { name: 'Intake · Law Firm' }));
  expect(choose).toHaveBeenCalledWith(`general:${org}`);
  expect(ports.rpc.mock.calls.map(([name]) => name)).toEqual(['my_homes']);
});

it('initializes a selected lazy General only when moving a note, then uses the returned scope', async () => {
  const homes = await listMyHomes();
  expect(homes).toHaveLength(1);
  const home = homes[0];
  if (!home) throw new Error('Missing lazy General');
  await expect(moveNoteHome('note-1', home)).resolves.toBe(true);
  expect(ports.rpc.mock.calls).toEqual([
    ['my_homes', {}],
    ['ensure_general_scope', { p_org: org }],
    ['set_home', { p_entity_type: 'note', p_entity_id: 'note-1', p_scope_id: scope }],
  ]);
});

it('keeps an ordinary scope distinct from a General with the same display name', async () => {
  ports.rpc.mockResolvedValue({
    data: [{ ...lazyHome, scope_id: scope, is_general: false }],
    error: null,
  });
  const homes = await listMyHomes();
  expect(homes.map(({ id, label }) => ({ id, label }))).toEqual([{ id: scope, label: 'Intake' }]);
});

it('refuses the move when General initialization fails instead of passing a synthetic ID to set_home', async () => {
  ports.rpc.mockResolvedValue({ data: null, error: { message: 'Membership changed' } });
  await expect(moveNoteHome('note-1', `general:${org}`)).resolves.toBe(false);
  expect(ports.rpc.mock.calls).toEqual([['ensure_general_scope', { p_org: org }]]);
});

it('rejects a malformed non-General home instead of silently omitting it', async () => {
  ports.rpc.mockResolvedValue({ data: [{ ...lazyHome, is_general: false }], error: null });
  await expect(listMyHomes()).rejects.toThrow('a non-General home has no scope');
});

it('keeps General identity after materialization and moves without initializing again', async () => {
  ports.rpc.mockImplementation(async (name: string) => ({
    data: name === 'my_homes' ? [{ ...lazyHome, scope_id: scope }] : {},
    error: null,
  }));
  const homes = await listMyHomes();
  const home = homes[0];
  if (!home) throw new Error('Missing General');
  expect(home.id).toBe(`general:${org}`);
  render(<HomePicker homes={homes} value={scope} placeholder="Choose home" onChange={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Intake · Law Firm' })).toBeDefined();
  await expect(moveNoteHome('note-1', home)).resolves.toBe(true);
  expect(ports.rpc.mock.calls).toEqual([
    ['my_homes', {}],
    ['set_home', { p_entity_type: 'note', p_entity_id: 'note-1', p_scope_id: scope }],
  ]);
});

it('keeps a selected General filter and note label after a refetch materializes its scope', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['notes', 'homes'], await listMyHomes());
  useNotesUiStore.setState({ selectedHome: null, searchQuery: '' });
  const view = render(
    <QueryClientProvider client={client}>
      <NotesList notes={[]} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'All homes' }));
  fireEvent.click(screen.getByRole('button', { name: 'Intake · Law Firm' }));
  expect(ports.rpc.mock.calls.map(([name]) => name)).toEqual(['my_homes']);
  ports.rpc.mockResolvedValue({ data: [{ ...lazyHome, scope_id: scope }], error: null });
  await act(async () => {
    client.setQueryData(['notes', 'homes'], await listMyHomes());
  });
  view.rerender(
    <QueryClientProvider client={client}>
      <NotesList
        notes={[
          {
            id: '22222222-2222-4222-8222-222222222222',
            created_by: null,
            label: 'Intake checklist',
            home_scope_id: scope,
            tags: null,
            updated_at: '2026-10-11T12:00:00Z',
            position: null,
          },
        ]}
      />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: /Intake checklist Intake · Law Firm/ }),
    ).toBeDefined(),
  );
  expect(useNotesUiStore.getState().selectedHome).toBe(`general:${org}`);
  expect(ports.rpc.mock.calls.map(([name]) => name)).toEqual(['my_homes', 'my_homes']);
  client.clear();
});
