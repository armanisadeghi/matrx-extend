import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const mocks = vi.hoisted(() => {
  let releaseCreate: ((value: { id: string }) => void) | undefined;
  return {
    activeOrganizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    createTable: vi.fn(
      () =>
        new Promise<{ id: string }>((resolve) => {
          releaseCreate = resolve;
        }),
    ),
    appendRows: vi.fn(async () => ({ inserted: 1 })),
    savePattern: vi.fn(async () => ({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' })),
    getUserTable: vi.fn(),
    tables: [] as { id: string; table_name: string }[],
    releaseCreate: (value: { id: string }) => releaseCreate?.(value),
    clearRelease: () => {
      releaseCreate = undefined;
    },
  };
});

vi.mock('@/hooks/use-active-organization', () => ({
  useActiveOrganization: () => ({
    active: { id: mocks.activeOrganizationId, name: 'Test organization', isPersonal: false },
  }),
}));
vi.mock('@/hooks/use-active-tab', () => ({
  useActiveTab: () => ({ url: 'https://example.com/products' }),
}));
vi.mock('@/hooks/use-user-tables', () => ({
  useUserTables: () => ({
    tables: mocks.tables,
    createTable: mocks.createTable,
    appendRows: mocks.appendRows,
  }),
}));
vi.mock('@/lib/supabase/queries', () => ({ savePattern: mocks.savePattern }));
vi.mock('@/lib/supabase/user-tables', () => ({
  buildFieldNameMap: () => new Map([['title', 'title']]),
  getUserTable: mocks.getUserTable,
  getUserTableSchema: vi.fn(),
  inferSchemaFromRows: () => [],
  unionRowKeys: () => ['title'],
}));
vi.mock('@/lib/supabase/db-failure', () => ({ isDbFailureError: () => false }));
vi.mock('@ai-matrx/design-system', () => ({
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  BasicInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('lucide-react', () => ({
  CheckCircle2: () => null,
  Loader2: () => null,
  Save: () => null,
  TriangleAlert: () => null,
}));

import { SaveAsPattern } from '@/features/showcase/components/SaveAsPattern';

afterEach(() => {
  cleanup();
  mocks.activeOrganizationId = ORG_A;
  mocks.clearRelease();
  mocks.tables = [];
  vi.clearAllMocks();
});

describe('SaveAsPattern organization operation boundary', () => {
  it('keeps every linked write in the click-time organization when selection changes during create', async () => {
    const user = userEvent.setup();
    const view = render(
      <SaveAsPattern
        kind="manual_css"
        config={{}}
        rows={[{ title: 'One' }]}
        defaultName="Products"
      />,
    );

    await user.selectOptions(screen.getByRole('combobox'), '__new__');
    await user.click(screen.getByRole('button', { name: /^Save$/ }));

    await waitFor(() =>
      expect(mocks.createTable).toHaveBeenCalledWith(
        expect.objectContaining({ organization_id: ORG_A }),
      ),
    );
    mocks.activeOrganizationId = ORG_B;
    view.rerender(
      <SaveAsPattern
        kind="manual_css"
        config={{}}
        rows={[{ title: 'One' }]}
        defaultName="Products"
      />,
    );
    await act(async () => mocks.releaseCreate({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }));

    await waitFor(() => expect(mocks.savePattern).toHaveBeenCalledTimes(1));
    expect(mocks.savePattern).toHaveBeenCalledWith(
      expect.objectContaining({ organization_id: ORG_A }),
    );
    expect(mocks.appendRows).toHaveBeenCalledWith('dddddddd-dddd-4ddd-8ddd-dddddddddddd', ORG_A, [
      { title: 'One' },
    ]);
  });

  it('refuses an existing dataset from another organization before any linked write', async () => {
    mocks.tables = [{ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', table_name: 'Other org table' }];
    mocks.getUserTable.mockResolvedValue({ organization_id: ORG_B });
    const user = userEvent.setup();
    render(<SaveAsPattern kind="manual_css" config={{}} rows={[{ title: 'One' }]} />);

    await user.selectOptions(screen.getByRole('combobox'), 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
    await user.click(screen.getByRole('button', { name: /^Save$/ }));

    expect(await screen.findByText(/belongs to a different organization/i)).toBeTruthy();
    expect(mocks.savePattern).not.toHaveBeenCalled();
    expect(mocks.appendRows).not.toHaveBeenCalled();
  });
});
