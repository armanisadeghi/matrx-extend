import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  page: { id: 37, url: 'https://electronic.vegas/search/' },
  fetchPatterns: vi.fn(),
  runSaved: vi.fn(),
  bumpRun: vi.fn(),
}));

vi.mock('@/hooks/use-active-tab', () => ({ useActiveTab: () => ({ ...mocks.page }) }));
vi.mock('@/lib/supabase/queries', () => ({
  fetchPatternsForDomain: mocks.fetchPatterns,
  bumpPatternRun: mocks.bumpRun,
  deletePattern: vi.fn(),
  renamePattern: vi.fn(),
}));
vi.mock('@/lib/data-pattern/run-interactive', () => ({
  runSavedPattern: mocks.runSaved,
  NetworkNoMatchError: class NetworkNoMatchError extends Error {},
}));
vi.mock('@/lib/destructive/confirm', () => ({ confirmDestructive: vi.fn() }));
vi.mock('@/features/showcase/components/ResultPreview', () => ({
  ResultPreview: ({ rows }: { rows: Record<string, unknown>[] }) => (
    <div>Preview {JSON.stringify(rows)}</div>
  ),
}));
vi.mock('@ai-matrx/kit/format', () => ({ formatRelativeTime: () => 'just now' }));
vi.mock('@ai-matrx/design-system', () => ({
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  BasicInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));
vi.mock('lucide-react', () => ({
  Check: () => null,
  CheckCircle2: () => null,
  Loader2: () => null,
  Pencil: () => null,
  PlayCircle: () => null,
  RefreshCw: () => null,
  Trash2: () => null,
  X: () => null,
  XCircle: () => null,
}));

import { PatternsTab } from '@/features/showcase/tabs/PatternsTab';

const pattern = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  created_by: null,
  name: 'Calendar events',
  domain: 'electronic.vegas',
  route_pattern: '/vegas-edm-event-calendar/',
  list_root_selector: '#calendar-events',
  fields: [],
  kind: 'list_pattern',
  config: { list_root: '#calendar-events', item_selector: '.event-card', field_paths: [] },
  target_user_table_id: null,
  last_used_at: null,
  last_run_at: null,
  last_status: null,
  last_run_count: null,
  created_at: '2026-09-27T00:00:00Z',
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.page.id = 37;
  mocks.page.url = 'https://electronic.vegas/search/';
});

describe('Showcase saved pattern replay provenance', () => {
  it('guides on route mismatch without blocking Run and calls zero rows no match', async () => {
    mocks.fetchPatterns.mockResolvedValue([pattern]);
    mocks.runSaved.mockResolvedValue([]);
    render(<PatternsTab />);
    await screen.findByText('Calendar events');

    expect(screen.getByText(/saved for \/vegas-edm-event-calendar\//i)).toBeTruthy();
    await userEvent.click(screen.getByTitle('Run pattern'));
    await waitFor(() => expect(mocks.runSaved).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/no matching data/i)).toBeTruthy();
    expect(mocks.bumpRun).not.toHaveBeenCalledWith(pattern.id, 'ok', 0);
  });

  it('does not present a completed old-page run after navigating on the same host', async () => {
    let resolveRun: (rows: Record<string, unknown>[]) => void = () => {};
    mocks.fetchPatterns.mockResolvedValue([pattern]);
    mocks.runSaved.mockImplementation(
      () =>
        new Promise<Record<string, unknown>[]>((resolve) => {
          resolveRun = resolve;
        }),
    );
    const view = render(<PatternsTab />);
    await screen.findByText('Calendar events');
    await userEvent.click(screen.getByTitle('Run pattern'));

    mocks.page.url = 'https://electronic.vegas/other/';
    view.rerender(<PatternsTab />);
    resolveRun([{ title: 'Old page event' }]);
    await waitFor(() => expect(mocks.runSaved).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/Old page event/)).toBeNull();
    expect(mocks.bumpRun).not.toHaveBeenCalledWith(pattern.id, 'ok', 1);
  });
});
