import type { ExtractionPattern } from '@/lib/supabase/queries';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLayoutEffect } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  copied: '',
  page: { id: 37, url: 'https://electronic.vegas/calendar/', title: 'Vegas events' },
  fetchPatterns: vi.fn(),
  runSaved: vi.fn(),
  bumpRun: vi.fn(),
}));

vi.mock('@/hooks/use-active-tab', () => ({
  useActiveTab: () => ({ ...mocks.page }),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, status: 'signed-in', signIn: vi.fn() }),
}));
vi.mock('@/lib/supabase/queries', () => ({
  fetchPatternsForDomain: mocks.fetchPatterns,
  bumpPatternRun: mocks.bumpRun,
  savePattern: vi.fn(),
}));
vi.mock('@/lib/data-pattern/run-interactive', () => ({
  runSavedPattern: mocks.runSaved,
  NetworkNoMatchError: class NetworkNoMatchError extends Error {},
}));
vi.mock('@/lib/messaging/native', () => ({ on: () => () => {}, send: vi.fn() }));
vi.mock('@/lib/api/routes/auth', () => ({ requireRequestOrganizationId: vi.fn() }));
vi.mock('@/components/CopyMenu', () => ({
  CopyMenu: ({
    title,
    options,
  }: { title?: string; options: { label: string; getContent: () => string }[] }) => (
    <button
      aria-label={title}
      onClick={() => {
        mocks.copied = options.find((o) => o.label === 'For AI agent')!.getContent();
      }}
    >
      Copy agent
    </button>
  ),
}));
vi.mock('@ai-matrx/design-system', () => ({
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  BasicInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));
vi.mock('lucide-react', () => ({
  Crosshair: () => null,
  Loader2: () => null,
  LogIn: () => null,
  Play: () => null,
  Save: () => null,
  XCircle: () => null,
  Zap: () => null,
}));

import { DataView } from '@/features/data/DataView';
import { useAutoExtractStore } from '@/state/auto-extract';

const pattern = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  created_by: null,
  name: 'Calendar events',
  domain: 'electronic.vegas',
  route_pattern: '/calendar/',
  list_root_selector: '#events',
  fields: [],
  kind: 'list_pattern',
  config: { list_root: '#events', item_selector: '.event', field_paths: [] },
  target_user_table_id: null,
  last_used_at: null,
  last_run_at: null,
  last_status: null,
  last_run_count: null,
  created_at: '2026-09-27T00:00:00Z',
} satisfies ExtractionPattern;

afterEach(() => {
  cleanup();
  mocks.page = { id: 37, url: 'https://electronic.vegas/calendar/', title: 'Vegas events' };
  mocks.copied = '';
  vi.clearAllMocks();
  useAutoExtractStore.setState({ records: new Map() });
});

it('shows DataView no-match guidance without writing ok health for zero rows', async () => {
  mocks.fetchPatterns.mockResolvedValue([pattern]);
  mocks.runSaved.mockResolvedValue([]);
  render(<DataView />);
  await screen.findAllByText('Calendar events');
  await userEvent.click(screen.getByRole('button', { name: 'Extract' }));

  expect(await screen.findByText(/no matching data/i)).toBeTruthy();
  expect(mocks.bumpRun).not.toHaveBeenCalled();
  expect(screen.queryByText(/Extracted rows \(0\)/)).toBeNull();
});

it('still marks DataView healthy after a matching nonempty run', async () => {
  mocks.fetchPatterns.mockResolvedValue([pattern]);
  mocks.runSaved.mockResolvedValue([{ title: 'Real calendar event' }]);
  render(<DataView />);
  await screen.findAllByText('Calendar events');
  await userEvent.click(screen.getByRole('button', { name: 'Extract' }));

  await waitFor(() => expect(mocks.bumpRun).toHaveBeenCalledWith(pattern.id, 'ok', 1));
  expect(await screen.findByText(/Real calendar event/)).toBeTruthy();
});

it('keeps extracted rows and reports saved history failure in DataView', async () => {
  mocks.fetchPatterns.mockResolvedValue([pattern]);
  mocks.runSaved.mockResolvedValue([{ title: 'Friday night concert' }]);
  mocks.bumpRun.mockResolvedValue('Database unavailable');
  render(<DataView />);
  await screen.findAllByText('Calendar events');
  await userEvent.click(screen.getByRole('button', { name: 'Extract' }));

  expect(await screen.findByText(/Friday night concert/)).toBeTruthy();
  expect(await screen.findByText(/saved run history could not be updated: Database unavailable/i)).toBeTruthy();
});

// The host contract is persistence and current-page presentation; extraction is the external runner.
it.each(['resolve', 'reject'] as const)(
  'ignores stale DataView %s after a page switch',
  async (outcome) => {
    let resolve!: (rows: Record<string, unknown>[]) => void;
    let reject!: (error: Error) => void;
    const pending = new Promise<Record<string, unknown>[]>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    mocks.fetchPatterns.mockResolvedValue([pattern]);
    mocks.runSaved.mockReturnValue(pending);
    const view = render(<DataView />);
    await screen.findAllByText('Calendar events');
    await userEvent.click(screen.getByRole('button', { name: 'Extract' }));
    mocks.page.url = 'https://electronic.vegas/search/';
    view.rerender(<DataView />);
    await act(async () => {
      if (outcome === 'resolve') resolve([{ title: 'Old calendar result' }]);
      else reject(new Error('Old calendar failure'));
      await pending.catch(() => {});
    });
    expect(document.body.textContent).not.toContain('Old calendar');
    expect(mocks.bumpRun).not.toHaveBeenCalled();
  },
);

it('hides completed DataView rows on the first commit for another tab at the same URL', async () => {
  const commits: string[] = [];
  function Probe({ id }: { id: number }) {
    useLayoutEffect(() => {
      commits.push(document.body.textContent ?? '');
    }, [id]);
    return null;
  }
  mocks.fetchPatterns.mockResolvedValue([pattern]);
  mocks.runSaved.mockResolvedValue([{ title: 'First tab event' }]);
  const view = render(
    <>
      <DataView />
      <Probe id={mocks.page.id} />
    </>,
  );
  await screen.findAllByText('Calendar events');
  await userEvent.click(screen.getByRole('button', { name: 'Extract' }));
  await screen.findByText(/First tab event/);
  await userEvent.click(screen.getByRole('button', { name: 'Copy rows' }));
  expect(mocks.copied).toContain('https://electronic.vegas/calendar/');
  expect(mocks.copied).toContain('Calendar events');
  mocks.page.id = 38;
  view.rerender(
    <>
      <DataView />
      <Probe id={mocks.page.id} />
    </>,
  );
  expect(commits.at(-1)).not.toContain('First tab event');
});

it.each([
  ['/calendar/', true],
  ['/search/', false],
] as const)('preserves health for failure outside saved route %s', async (route, broken) => {
  mocks.page.url = `https://electronic.vegas${route}`;
  mocks.fetchPatterns.mockResolvedValue([pattern]);
  mocks.runSaved.mockRejectedValue(new Error('Selector could not execute'));
  render(<DataView />);
  await screen.findAllByText('Calendar events');
  await userEvent.click(
    route === '/calendar/'
      ? screen.getByRole('button', { name: 'Extract' })
      : screen.getByTitle('Run pattern'),
  );
  await screen.findByText(/Selector could not execute/);
  expect(mocks.bumpRun.mock.calls).toEqual(broken ? [[pattern.id, 'broken', 0]] : []);
});
