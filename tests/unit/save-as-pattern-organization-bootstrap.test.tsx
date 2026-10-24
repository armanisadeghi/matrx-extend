import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TABLE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const state = vi.hoisted(() => {
  let releaseCreate: ((value: { id: string }) => void) | undefined;
  let releaseList: ((value: { id: string; name: string }[]) => void) | undefined;
  return {
    activeId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    noMemberships: false,
    resolverNull: false,
    user: { id: 'user-1' },
    listMode: 'normal' as 'normal' | 'deferred' | 'error',
    listeners: [] as Array<() => void>,
    createTable: vi.fn(
      () =>
        new Promise<{ id: string }>((resolve) => {
          releaseCreate = resolve;
        }),
    ),
    appendRows: vi.fn(async () => ({ inserted: 1 })),
    savePattern: vi.fn(async () => ({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' })),
    tableOrganization: vi.fn(async () => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
    tables: [] as { id: string; table_name: string; organization_id?: string | null }[],
    releaseCreate: (value: { id: string }) => releaseCreate?.(value),
    releaseList: (value: { id: string; name: string }[]) => releaseList?.(value),
    listCalls: 0,
  };
});

vi.mock('@/config/env', () => ({ STORAGE_KEYS: { ACTIVE_ORGANIZATION: 'active-org' } }));
vi.mock('@/lib/org/active-org', () => ({
  resolveActiveOrganization: vi.fn(async () =>
    state.noMemberships || state.resolverNull
      ? null
      : { id: state.activeId, name: `Org ${state.activeId}` },
  ),
  listMemberOrganizations: vi.fn(() => {
    state.listCalls += 1;
    if (state.listMode === 'error') return Promise.reject(new Error('membership read unavailable'));
    if (state.listMode === 'deferred')
      return new Promise((resolve) => {
        state.releaseList = resolve;
      });
    return Promise.resolve(
      state.noMemberships ? [] : [{ id: state.activeId, name: `Org ${state.activeId}` }],
    );
  }),
  setActiveOrganization: vi.fn(async (id: string) => {
    state.activeId = id;
    for (const listener of [...state.listeners]) listener();
    return { id, name: `Org ${id}` };
  }),
}));
vi.mock('@/lib/storage/chrome-local', () => ({
  onChange: (_key: string, listener: () => void) => {
    state.listeners.push(listener);
    return () => {
      state.listeners = state.listeners.filter((item) => item !== listener);
    };
  },
}));
vi.mock('@/state/auth', () => ({
  useAuthStore: (selector: (value: { user: { id: string } }) => unknown) =>
    selector({ user: state.user }),
}));
vi.mock('@ai-matrx/design-system', () => ({
  DEFAULT_ARCHIVE_FILTER: 'active',
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  BasicInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/hooks/use-active-tab', () => ({
  useActiveTab: () => ({
    id: 37,
    url: 'https://harbor-recovery.test/pickups',
    title: 'Pickups',
    pageKey: 'pickups-page',
    identityError: null,
  }),
  isCurrentPageIdentity: () => true,
  refreshActiveTabIdentity: vi.fn(),
}));
vi.mock('@/hooks/use-user-tables', () => ({
  useUserTables: () => ({
    tables: state.tables,
    createTable: state.createTable,
    appendRows: state.appendRows,
  }),
}));
vi.mock('@/lib/supabase/queries', () => ({ savePattern: state.savePattern }));
vi.mock('@/lib/supabase/user-tables', () => ({
  buildFieldNameMap: () => new Map([['title', 'title']]),
  tableOrganization: state.tableOrganization,
  tableColumnKeys: vi.fn(async () => []),
  inferSchemaFromRows: () => [],
  unionRowKeys: () => ['title'],
}));
vi.mock('@/lib/supabase/db-failure', () => ({ isDbFailureError: () => false }));
vi.mock('@ai-matrx/api', () => ({
  OrganizationContextError: class OrganizationContextError extends Error {
    constructor(_code: string, message: string) {
      super(message);
    }
  },
  requireOrganizationContext: (id?: string | null) => {
    if (!id) throw new Error('Select an organization before sending this request.');
    return id;
  },
}));
vi.mock('lucide-react', () => ({
  CheckCircle2: () => null,
  Loader2: () => null,
  Save: () => null,
  TriangleAlert: () => null,
}));
vi.mock('@/features/showcase/components/ResultPreview', () => ({ ResultPreview: () => null }));

import { SaveAsPattern } from '@/features/showcase/components/SaveAsPattern';
import { useActiveOrganization } from '@/hooks/use-active-organization';

function SwitchOrganization() {
  const { choose } = useActiveOrganization();
  return (
    <button type="button" onClick={() => void choose(ORG_B)}>
      Change organization
    </button>
  );
}

function HookStateProbe() {
  const { loading, error } = useActiveOrganization();
  return (
    <output data-testid="active-org-hook-state">
      {loading ? 'loading' : error ? 'error' : 'ready'}
    </output>
  );
}

function renderPattern(withHookProbe = false) {
  return render(
    <>
      <SwitchOrganization />
      {withHookProbe && <HookStateProbe />}
      <SaveAsPattern
        kind="manual_css"
        config={{}}
        rows={[{ title: 'One' }]}
        defaultName="Products"
      />
    </>,
  );
}

beforeEach(() => {
  state.activeId = ORG_A;
  state.noMemberships = false;
  state.resolverNull = false;
  state.listMode = 'normal';
  state.listeners = [];
  state.listCalls = 0;
  state.tables = [];
  state.createTable.mockClear();
  state.appendRows.mockClear();
  state.savePattern.mockClear();
  state.tableOrganization.mockClear();
});
afterEach(() => cleanup());

describe('SaveAsPattern with the installed active-organization view', () => {
  it('keeps Save disabled while the real hook waits for the membership list despite an early resolver result', async () => {
    state.listMode = 'deferred';
    const user = userEvent.setup();
    renderPattern();
    await screen.findByRole('status');
    const save = screen.getByRole('button', { name: /^Save$/ }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await user.click(save);
    expect(state.savePattern).not.toHaveBeenCalled();
    await act(async () => state.releaseList?.([{ id: ORG_A, name: 'Org A' }]));
    await waitFor(() => expect(save.disabled).toBe(false));
    await user.click(save);
    await waitFor(() =>
      expect(state.savePattern).toHaveBeenCalledWith(
        expect.objectContaining({ organization_id: ORG_A }),
      ),
    );
  });

  it('keeps new-table Save disabled until the active organization validates', async () => {
    state.listMode = 'deferred';
    const user = userEvent.setup();
    renderPattern();
    await screen.findByRole('status');
    await user.selectOptions(screen.getByRole('combobox'), '__new__');
    const save = screen.getByRole('button', { name: /^Save$/ }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await user.click(save);
    expect(state.createTable).not.toHaveBeenCalled();
    await act(async () => state.releaseList?.([{ id: ORG_A, name: 'Org A' }]));
    await waitFor(() => expect(save.disabled).toBe(false));
    expect(state.createTable).not.toHaveBeenCalled();
  });

  it('shows membership read failures and retries through the hook reload', async () => {
    state.listMode = 'error';
    const user = userEvent.setup();
    renderPattern(true);
    await screen.findByText('error');
    expect((await screen.findByRole('alert')).textContent).toContain('membership read unavailable');
    expect((screen.getByRole('button', { name: /^Save$/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    state.listMode = 'normal';
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect((screen.getByRole('button', { name: /^Save$/ }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    await user.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() =>
      expect(state.savePattern).toHaveBeenCalledWith(
        expect.objectContaining({ organization_id: ORG_A }),
      ),
    );
  });

  it('shows no memberships separately from loading and keeps Save disabled', async () => {
    state.noMemberships = true;
    renderPattern(true);
    await screen.findByText('ready');
    expect(screen.getByRole('alert').textContent).toContain('do not belong to an organization');
    expect((screen.getByRole('button', { name: /^Save$/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('retries a null resolver selection when memberships exist instead of misreporting no memberships', async () => {
    state.resolverNull = true;
    const user = userEvent.setup();
    renderPattern(true);
    await screen.findByText('ready');
    expect(screen.getByRole('alert').textContent).toContain(
      'No active organization has been validated yet.',
    );
    expect(screen.getByRole('alert').textContent).not.toContain('do not belong to an organization');
    const save = screen.getByRole('button', { name: /^Save$/ }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    state.resolverNull = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(save.disabled).toBe(false));
    await user.click(save);
    await waitFor(() =>
      expect(state.savePattern).toHaveBeenCalledWith(
        expect.objectContaining({ organization_id: ORG_A }),
      ),
    );
  });

  it.each(['deferred', 'error'] as const)(
    'allows a listed existing table in its own organization while active-org view is %s',
    async (mode) => {
      state.listMode = mode;
      state.tables = [{ id: TABLE_ID, table_name: 'Other org table', organization_id: ORG_B }];
      renderPattern(true);
      if (mode === 'error') await screen.findByText('error');
      else await screen.findByText('loading');
      const user = userEvent.setup();
      await user.selectOptions(screen.getByRole('combobox'), TABLE_ID);
      const save = screen.getByRole('button', { name: /^Save$/ }) as HTMLButtonElement;
      expect(save.disabled).toBe(false);
      await user.click(save);
      await waitFor(() =>
        expect(state.savePattern).toHaveBeenCalledWith(
          expect.objectContaining({ organization_id: ORG_B }),
        ),
      );
      expect(state.tableOrganization).toHaveBeenCalledWith(TABLE_ID, ORG_B);
    },
  );

  it('refuses a selected table with no verified own organization instead of using active organization', async () => {
    state.tables = [{ id: TABLE_ID, table_name: 'Unverified table', organization_id: null }];
    const user = userEvent.setup();
    renderPattern();
    await screen.findByRole('button', { name: /^Save$/ });
    await user.selectOptions(screen.getByRole('combobox'), TABLE_ID);
    expect((screen.getByRole('button', { name: /^Save$/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByRole('alert').textContent).toContain('no verified organization');
    expect(state.savePattern).not.toHaveBeenCalled();
    expect(state.tableOrganization).not.toHaveBeenCalled();
  });

  it('keeps the click-time active organization through a create await and later real-hook selection change', async () => {
    const user = userEvent.setup();
    renderPattern();
    const select = screen.getByRole('combobox');
    await waitFor(() =>
      expect((screen.getByRole('button', { name: /^Save$/ }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    await user.selectOptions(select, '__new__');
    await user.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() =>
      expect(state.createTable).toHaveBeenCalledWith(
        expect.objectContaining({ organization_id: ORG_A }),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Change organization' }));
    await waitFor(() => expect(state.activeId).toBe(ORG_B));
    await act(async () => state.releaseCreate?.({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }));
    await waitFor(() =>
      expect(state.savePattern).toHaveBeenCalledWith(
        expect.objectContaining({ organization_id: ORG_A }),
      ),
    );
    expect(state.appendRows).toHaveBeenCalledWith('dddddddd-dddd-4ddd-8ddd-dddddddddddd', ORG_A, [
      { title: 'One' },
    ]);
  });
});
