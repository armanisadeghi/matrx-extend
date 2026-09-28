import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLayoutEffect } from 'react';
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
vi.mock('@ai-matrx/kit/format', () => ({
  formatRelativeTime: (value: string) =>
    value === '2026-09-28T15:00:00Z' ? 'just now' : '9 minutes ago',
}));
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
  mocks.bumpRun.mockReset();
  mocks.page.id = 37;
  mocks.page.url = 'https://electronic.vegas/search/';
});

describe('Showcase saved pattern replay provenance', () => {
  it('refreshes last run only after saved health commits, then shows the new timestamp', async () => {
    mocks.page.url = 'https://electronic.vegas/vegas-edm-event-calendar/';
    let savedRunAt = '2026-09-28T14:51:00Z';
    let resolveBump!: (error: string | null) => void;
    mocks.fetchPatterns.mockImplementation(async () => [{ ...pattern, last_run_at: savedRunAt }]);
    mocks.runSaved.mockResolvedValue([{ title: 'Friday night concert' }]);
    mocks.bumpRun.mockImplementation(() => new Promise<string | null>((resolve) => {
      resolveBump = resolve;
    }));
    render(<PatternsTab />);
    await screen.findByText(/last run 9 minutes ago/i);

    await userEvent.click(screen.getByTitle('Run pattern'));
    expect(await screen.findByText(/Friday night concert/)).toBeTruthy();
    await waitFor(() => expect(mocks.bumpRun).toHaveBeenCalledWith(pattern.id, 'ok', 1));
    expect(mocks.fetchPatterns).toHaveBeenCalledTimes(1);

    savedRunAt = '2026-09-28T15:00:00Z';
    await act(async () => resolveBump(null));
    expect(await screen.findByText(/last run just now/i)).toBeTruthy();
    expect(mocks.fetchPatterns).toHaveBeenCalledTimes(2);
  });

  it('keeps extracted rows visible and says when saved run history failed', async () => {
    mocks.page.url = 'https://electronic.vegas/vegas-edm-event-calendar/';
    mocks.fetchPatterns.mockResolvedValue([{ ...pattern, last_run_at: '2026-09-28T14:51:00Z' }]);
    mocks.runSaved.mockResolvedValue([{ title: 'Friday night concert' }]);
    mocks.bumpRun.mockResolvedValue('Database unavailable');
    render(<PatternsTab />);
    await screen.findByText(/last run 9 minutes ago/i);

    await userEvent.click(screen.getByTitle('Run pattern'));
    expect(await screen.findByText(/Friday night concert/)).toBeTruthy();
    expect(await screen.findByText(/saved run history could not be updated: Database unavailable/i)).toBeTruthy();
    expect(screen.getByText(/last run 9 minutes ago/i)).toBeTruthy();
  });

  it('keeps the extraction failure visible when recording that failure also fails', async () => {
    mocks.page.url = 'https://electronic.vegas/vegas-edm-event-calendar/';
    mocks.fetchPatterns.mockResolvedValue([pattern]);
    mocks.runSaved.mockRejectedValue(new Error('Selector could not execute'));
    mocks.bumpRun.mockResolvedValue('Database unavailable');
    render(<PatternsTab />);
    await screen.findByText('Calendar events');

    await userEvent.click(screen.getByTitle('Run pattern'));
    expect(await screen.findByText(/Selector could not execute.*saved run history could not be updated: Database unavailable/i)).toBeTruthy();
  });

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
    mocks.page.url = 'https://electronic.vegas/vegas-edm-event-calendar/';
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
    await act(async () => {
      resolveRun([{ title: 'Old page event' }]);
      await mocks.runSaved.mock.results[0]!.value;
    });
    expect(screen.queryByText(/Old page event/)).toBeNull();
    expect(mocks.bumpRun).not.toHaveBeenCalledWith(pattern.id, 'ok', 1);
  });

  it('shows successful same-route rows but never renders old rows or list in a new-page commit', async () => {
    const beforeEffects: string[] = [];
    function LayoutProbe({ page }: { page: string }) {
      useLayoutEffect(() => {
        beforeEffects.push(document.body.textContent ?? '');
      }, [page]);
      return null;
    }

    mocks.page.url = 'https://electronic.vegas/vegas-edm-event-calendar/';
    mocks.fetchPatterns.mockResolvedValue([pattern]);
    mocks.runSaved.mockResolvedValue([{ title: 'Intended calendar event' }]);
    const view = render(
      <>
        <PatternsTab />
        <LayoutProbe page={mocks.page.url} />
      </>,
    );
    await screen.findByText('Calendar events');
    await userEvent.click(screen.getByTitle('Run pattern'));
    expect(await screen.findByText(/Intended calendar event/)).toBeTruthy();
    expect(mocks.bumpRun).toHaveBeenCalledWith(pattern.id, 'ok', 1);

    mocks.page.url = 'https://electronic.vegas/search/';
    view.rerender(
      <>
        <PatternsTab />
        <LayoutProbe page={mocks.page.url} />
      </>,
    );
    const newPageFirstCommit = beforeEffects[beforeEffects.length - 1] ?? '';
    expect(newPageFirstCommit).not.toContain('Intended calendar event');
    expect(newPageFirstCommit).not.toContain('Calendar events');
  });
});
