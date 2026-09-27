import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
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
    detectModeInPage: vi.fn(async () => ({ available: true, summary: '2 tables', count: 2 })),
    runMode: vi.fn(async (_mode: string, _tabId: number, config: { table_index: number }) => [
      { pickup_day: config.table_index === 0 ? 'Friday' : 'Tuesday' },
    ]),
    tableOrganization: vi.fn(),
    tables: [] as { id: string; table_name: string }[],
    releaseCreate: (value: { id: string }) => releaseCreate?.(value),
    clearRelease: () => {
      releaseCreate = undefined;
    },
  };
});

vi.mock('@/hooks/use-active-organization', () => ({
  useActiveOrganization: () => ({
    active: { id: mocks.activeOrganizationId, name: 'Test organization' },
  }),
}));
vi.mock('@/hooks/use-active-tab', () => ({
  useActiveTab: () => ({ id: 37, url: 'https://harbor-recovery.test/pickups' }),
}));
vi.mock('@/lib/data-pattern/run-pattern', () => ({
  detectModeInPage: mocks.detectModeInPage,
  runMode: mocks.runMode,
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
  tableOrganization: mocks.tableOrganization,
  tableColumnKeys: vi.fn(async () => []),
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
  PlayCircle: () => null,
  Save: () => null,
  TriangleAlert: () => null,
}));
vi.mock('@/features/showcase/components/ResultPreview', () => ({
  ResultPreview: ({ rows }: { rows: Record<string, unknown>[] }) => (
    <div>{JSON.stringify(rows)}</div>
  ),
}));

import { SaveAsPattern } from '@/features/showcase/components/SaveAsPattern';
import { TablesTab } from '@/features/showcase/tabs/TablesTab';
import { useExtraction } from '@/hooks/use-extraction';

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
    mocks.tableOrganization.mockResolvedValue(ORG_B);
    const user = userEvent.setup();
    render(<SaveAsPattern kind="manual_css" config={{}} rows={[{ title: 'One' }]} />);

    await user.selectOptions(screen.getByRole('combobox'), 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
    await user.click(screen.getByRole('button', { name: /^Save$/ }));

    expect(await screen.findByText(/belongs to a different organization/i)).toBeTruthy();
    expect(mocks.savePattern).not.toHaveBeenCalled();
    expect(mocks.appendRows).not.toHaveBeenCalled();
  });
});

describe('Showcase preview provenance', () => {
  it('finishes an extraction when tab activation starts a detection during the run', async () => {
    let releaseRun: ((rows: { pickup_day: string }[]) => void) | undefined;
    mocks.runMode.mockImplementationOnce(
      () =>
        new Promise<{ pickup_day: string }[]>((resolve) => {
          releaseRun = resolve;
        }),
    );
    const hook = renderHook(({ active }) => useExtraction('auto_table', { autoDetect: active }), {
      initialProps: { active: false },
    });

    let runPromise: Promise<Record<string, unknown>[]> | undefined;
    act(() => {
      runPromise = hook.result.current.run({ table_index: 0 });
    });
    hook.rerender({ active: true });
    await waitFor(() => expect(mocks.detectModeInPage).toHaveBeenCalledTimes(1));
    await act(async () => {
      releaseRun?.([{ pickup_day: 'Friday' }]);
      await runPromise;
    });

    expect(hook.result.current.running).toBe(false);
    expect(hook.result.current.rows).toEqual([{ pickup_day: 'Friday' }]);
    expect(hook.result.current.previewConfig).toEqual({ table_index: 0 });
  });

  // Regression: saving the live table selector after an earlier preview wrote
  // a different table_index while appending the old preview's rows.
  it.each([
    { previewIndex: 0, editedIndex: 1, expectedDay: 'Friday' },
    { previewIndex: 1, editedIndex: 0, expectedDay: 'Tuesday' },
  ])(
    'saves table $previewIndex with its preview rows after selecting table $editedIndex',
    async ({ previewIndex, editedIndex, expectedDay }) => {
      const user = userEvent.setup();
      mocks.tables = [
        { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', table_name: 'Harbor Recovery pickups' },
      ];
      mocks.tableOrganization.mockResolvedValue(ORG_A);
      render(<TablesTab />);

      await screen.findByRole('button', { name: 'Table 1' });
      await user.click(screen.getByRole('button', { name: `Table ${previewIndex}` }));
      await user.click(screen.getByRole('button', { name: `Extract table ${previewIndex}` }));
      await screen.findByText(new RegExp(`"pickup_day":"${expectedDay}"`));
      await user.click(screen.getByRole('button', { name: `Table ${editedIndex}` }));
      await user.selectOptions(
        screen.getByRole('combobox'),
        'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      );
      await user.click(screen.getByRole('button', { name: /^Save$/ }));

      await waitFor(() => expect(mocks.savePattern).toHaveBeenCalledTimes(1));
      expect(mocks.savePattern).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'auto_table',
          config: { table_index: previewIndex },
        }),
      );
      expect(mocks.appendRows).toHaveBeenCalledWith('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', ORG_A, [
        { pickup_day: expectedDay },
      ]);
    },
  );
});
