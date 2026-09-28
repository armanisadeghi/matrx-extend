import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

const copied = vi.hoisted(() => ({
  text: '',
  page: { id: 37, url: 'https://electronic.vegas/calendar', title: 'Concert calendar' },
  fetchPatterns: vi.fn(),
  runSaved: vi.fn(),
  bumpRun: vi.fn(),
  networkEvents: [
    {
      ts_ms: 1_726_000_000_000,
      source: 'fetch',
      method: 'GET',
      request_body_key: 'none',
      request_sequence: 1,
      url: 'https://api.electronic.vegas/events?day=2026-09-28&proof=PRIVATE-RESPONSE',
      status: 200,
      status_text: 'OK',
      request_headers: {},
      response_headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: [{ title: 'Monday event' }] }),
      body_truncated: false,
      body_size: 38,
      content_type: 'application/json',
      tab_id: 37,
    },
  ],
}));

vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ isAdmin: true }) }));
vi.mock('@/hooks/use-active-tab', () => ({
  useActiveTab: () => ({
    ...copied.page,
    documentId: copied.page.url,
    identityStatus: 'ready',
    identityError: null,
    pageKey: copied.page.url,
  }),
  isCurrentPageIdentity: (key: string) => key === copied.page.url,
}));
vi.mock('@/lib/supabase/queries', () => ({
  fetchPatternsForDomain: copied.fetchPatterns,
  bumpPatternRun: copied.bumpRun,
  deletePattern: vi.fn(),
  renamePattern: vi.fn(),
}));
vi.mock('@/lib/data-pattern/run-interactive', () => ({
  runSavedPattern: copied.runSaved,
  NetworkNoMatchError: class NetworkNoMatchError extends Error {},
  matchesUrlFilter: (url: string, filter: string) => url === filter,
  rowsFromBody: (body: string) => JSON.parse(body).events,
}));
vi.mock('@/lib/destructive/confirm', () => ({ confirmDestructive: vi.fn() }));
vi.mock('@ai-matrx/kit/format', () => ({
  formatRelativeTime: () => 'recently',
  formatFileSize: () => '38 B',
}));
vi.mock('@/hooks/use-network-capture', () => ({
  useNetworkCapture: () => ({
    tab: { id: 37, documentId: 'calendar-document', pageKey: 'calendar-page' },
    capturing: false,
    discovering: false,
    discoveryProgress: null,
    events: copied.networkEvents,
    error: null,
    installed: true,
    source: {
      url: 'https://electronic.vegas/calendar',
      host: 'electronic.vegas',
      pathname: '/calendar',
    },
    dropped: 0,
    start: vi.fn(),
    capturePageLoad: vi.fn(),
    stop: vi.fn(),
    reload: vi.fn(),
    clear: vi.fn(),
  }),
}));
vi.mock('@/components/ui/json-tree', () => ({ JsonTree: () => null }));
vi.mock('@/features/showcase/components/SaveAsPattern', () => ({ SaveAsPattern: () => null }));
vi.mock('@/state/chat', () => ({
  useChatStore: (selector: (state: { draft: string; setDraft: () => void }) => unknown) =>
    selector({ draft: '', setDraft: vi.fn() }),
}));
vi.mock('@/state/sidepanel-tab', () => ({
  useSidepanelTabStore: (selector: (state: { setTab: () => void }) => unknown) =>
    selector({ setTab: vi.fn() }),
}));
vi.mock('@ai-matrx/design-system', () => ({
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  BasicInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { ResultPreview } from '@/features/showcase/components/ResultPreview';
import { NetworkTab } from '@/features/showcase/tabs/NetworkTab';
import { PatternsTab } from '@/features/showcase/tabs/PatternsTab';

Object.defineProperty(navigator, 'clipboard', {
  configurable: true,
  value: {
    writeText: vi.fn(async (text: string) => {
      copied.text = text;
    }),
  },
});

afterEach(() => {
  cleanup();
  copied.text = '';
  copied.page.url = 'https://electronic.vegas/calendar';
  copied.page.title = 'Concert calendar';
  vi.clearAllMocks();
});

it('copies each extraction source with ordinary query identity while masking credential values', async () => {
  const rows = [{ title: 'Friday night concert' }];
  const first = render(
    <ResultPreview
      rows={rows}
      source={{ url: 'https://electronic.vegas/calendar?date=2026-09-28&token=PRIVATE-ONE' }}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: /^Copy for AI/ }));
  expect(copied.text).toContain(
    'Source URL: https://electronic.vegas/calendar?date=2026-09-28&token=[credential]',
  );
  expect(copied.text).not.toContain('PRIVATE-ONE');
  expect(copied.text).toContain('Friday night concert');

  first.rerender(
    <ResultPreview
      rows={[{ title: 'Saturday night concert' }]}
      source={{ url: 'https://electronic.vegas/calendar?date=2026-09-29&token=PRIVATE-TWO' }}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: /^Copy for AI/ }));
  expect(copied.text).toContain(
    'Source URL: https://electronic.vegas/calendar?date=2026-09-29&token=[credential]',
  );
  expect(copied.text).not.toContain('PRIVATE-TWO');
  expect(copied.text).toContain('Saturday night concert');
  expect(copied.text).not.toContain('Friday night concert');
});

it('keeps hash-routed page identity and masks credentials inside the fragment', async () => {
  const view = render(
    <ResultPreview
      rows={[{ title: 'Monday event' }]}
      source={{ url: 'https://electronic.vegas/app#/calendar?date=2026-09-28&token=PRIVATE-HASH' }}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: /^Copy for AI/ }));
  expect(copied.text).toContain(
    'Source URL: https://electronic.vegas/app#/calendar?date=2026-09-28&token=[credential]',
  );
  expect(copied.text).not.toContain('PRIVATE-HASH');

  view.rerender(
    <ResultPreview
      rows={[{ title: 'Tuesday event' }]}
      source={{
        url: 'https://electronic.vegas/app#/calendar?date=2026-09-29&token=PRIVATE-HASH-NEXT',
      }}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: /^Copy for AI/ }));
  expect(copied.text).toContain(
    'Source URL: https://electronic.vegas/app#/calendar?date=2026-09-29&token=[credential]',
  );
  expect(copied.text).toContain('Tuesday event');
  expect(copied.text).not.toContain('PRIVATE-HASH-NEXT');
});

it('states when an extraction has no source URL', async () => {
  render(<ResultPreview rows={[{ title: 'Friday night concert' }]} />);
  expect(screen.getByText(/source URL unavailable/i)).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: /^Copy for AI/ }));
  expect(copied.text).not.toContain('Source URL:');
});

it('copies the actual saved replay page and its rows through the real preview and copy control', async () => {
  const pattern = {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    name: 'Concert calendar',
    domain: 'electronic.vegas',
    route_pattern: '/calendar',
    kind: 'network_capture',
    fields: [],
    config: { url_filter: 'https://electronic.vegas/api/events?date=2026-09-28' },
    last_run_at: null,
    last_status: null,
    last_run_count: null,
  };
  copied.fetchPatterns.mockResolvedValue([pattern]);
  copied.runSaved
    .mockResolvedValueOnce([{ title: 'Monday event' }])
    .mockResolvedValueOnce([{ title: 'Tuesday event' }]);
  copied.bumpRun.mockResolvedValue(null);
  copied.page.url = 'https://electronic.vegas/calendar?date=2026-09-28&token=PRIVATE-PAGE';
  const view = render(<PatternsTab />);
  await screen.findByText('Concert calendar');

  await userEvent.click(screen.getByTitle('Run pattern'));
  await screen.findByText('Monday event');
  await userEvent.click(screen.getByRole('button', { name: /^Copy for AI/ }));
  await waitFor(() => expect(copied.text).toContain('Monday event'));
  expect(copied.text).toContain(
    'Source URL: https://electronic.vegas/calendar?date=2026-09-28&token=[credential]',
  );
  expect(copied.text).toContain('Source kind: web page');
  expect(copied.text).not.toContain('https://electronic.vegas/api/events');

  copied.page.url = 'https://electronic.vegas/calendar?date=2026-09-29&token=PRIVATE-NEXT';
  view.rerender(<PatternsTab />);
  await screen.findByText('Concert calendar');
  await userEvent.click(screen.getByTitle('Run pattern'));
  await screen.findByText('Tuesday event');
  await userEvent.click(screen.getByRole('button', { name: /^Copy for AI/ }));
  await waitFor(() => expect(copied.text).toContain('Tuesday event'));
  expect(copied.text).toContain(
    'Source URL: https://electronic.vegas/calendar?date=2026-09-29&token=[credential]',
  );
  expect(copied.text).not.toContain('Monday event');
});

it('copies the selected network response URL rather than the edited replay filter or page URL', async () => {
  render(<NetworkTab />);
  await userEvent.click(screen.getByRole('button', { name: /api\.electronic\.vegas/i }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Treat proof as credential' }));
  fireEvent.change(screen.getByLabelText('Request URL to match on rerun'), {
    target: { value: 'https://api.electronic.vegas/other?day=2026-10-01' },
  });

  await userEvent.click(screen.getByRole('button', { name: /^Copy for AI/ }));
  await waitFor(() => expect(copied.text).toContain('Monday event'));
  expect(copied.text).toContain(
    'Source URL: https://api.electronic.vegas/events?day=2026-09-28&proof=[credential]',
  );
  expect(copied.text).toContain('Source kind: network response');
  expect(copied.text).not.toContain('PRIVATE-RESPONSE');
  expect(copied.text).not.toContain('https://api.electronic.vegas/other');
  expect(copied.text).not.toContain('Source URL: https://electronic.vegas/calendar');
});
