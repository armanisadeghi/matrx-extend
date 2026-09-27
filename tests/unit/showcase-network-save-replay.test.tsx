import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const events = [
    {
      ts_ms: 1_726_000_000_000,
      source: 'fetch' as const,
      method: 'GET',
      url: 'https://electronic.vegas/api/events',
      status: 200,
      status_text: 'OK',
      request_headers: {},
      response_headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: [{ title: 'Harbor Night', venue: 'Pier Hall' }] }),
      body_truncated: false,
      body_size: 58,
      content_type: 'application/json',
      tab_id: 37,
    },
    {
      ts_ms: 1_726_000_000_001,
      source: 'fetch' as const,
      method: 'GET',
      url: 'https://electronic.vegas/api/venues',
      status: 200,
      status_text: 'OK',
      request_headers: {},
      response_headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ venues: [{ name: 'Pier Hall' }] }),
      body_truncated: false,
      body_size: 35,
      content_type: 'application/json',
      tab_id: 37,
    },
  ];
  return {
    events,
    savePattern: vi.fn(async (_input: unknown) => ({
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    })),
  };
});

vi.mock('@/hooks/use-network-capture', () => ({
  useNetworkCapture: () => ({
    capturing: false,
    events: mocks.events,
    error: null,
    installed: true,
    start: vi.fn(),
    stop: vi.fn(),
    reload: vi.fn(),
    clear: vi.fn(),
    source: {
      url: 'https://electronic.vegas/vegas-edm-event-calendar/',
      host: 'electronic.vegas',
      pathname: '/vegas-edm-event-calendar/',
    },
    dropped: 0,
  }),
}));
vi.mock('@/hooks/use-active-tab', () => ({
  useActiveTab: () => ({ id: 37, url: 'https://electronic.vegas/vegas-edm-event-calendar/' }),
}));
vi.mock('@/hooks/use-active-organization', () => ({
  useActiveOrganization: () => ({
    active: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Events organization' },
  }),
}));
vi.mock('@/hooks/use-user-tables', () => ({
  useUserTables: () => ({ tables: [], createTable: vi.fn(), appendRows: vi.fn() }),
}));
vi.mock('@/lib/supabase/queries', () => ({ savePattern: mocks.savePattern }));
vi.mock('@/lib/supabase/user-tables', () => ({
  buildFieldNameMap: vi.fn(),
  inferSchemaFromRows: () => [],
  tableColumnKeys: vi.fn(),
  tableOrganization: vi.fn(),
  unionRowKeys: vi.fn(),
}));
vi.mock('@/lib/supabase/db-failure', () => ({ isDbFailureError: () => false }));
vi.mock('@/components/ui/json-tree', () => ({
  JsonTree: ({ onSelectPath }: { onSelectPath: (path: string) => void }) => (
    <button type="button" onClick={() => onSelectPath('events')}>
      Select events path
    </button>
  ),
}));
vi.mock('@/features/showcase/components/ResultPreview', () => ({
  ResultPreview: ({ rows }: { rows: Record<string, unknown>[] }) => (
    <div>{JSON.stringify(rows)}</div>
  ),
}));
vi.mock('@ai-matrx/design-system', () => ({
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  BasicInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('lucide-react', () => ({
  CheckCircle2: () => null,
  Circle: () => null,
  Loader2: () => null,
  RefreshCw: () => null,
  Save: () => null,
  Square: () => null,
  Trash2: () => null,
  TriangleAlert: () => null,
}));

import { NetworkTab } from '@/features/showcase/tabs/NetworkTab';
import { matchesUrlFilter } from '@/lib/data-pattern/run-interactive';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Network saved request replay', () => {
  it('saves a matcher for the selected JSON response even when the display filter is content type', async () => {
    const user = userEvent.setup();
    render(<NetworkTab />);

    await user.type(screen.getByPlaceholderText(/Filter by URL or content-type/), 'json');
    await user.click(screen.getByRole('button', { name: /api\/events/ }));
    await user.click(screen.getByRole('button', { name: 'Select events path' }));
    await screen.findByText(/Harbor Night/);
    await user.click(screen.getByRole('button', { name: /^Save$/ }));

    await waitFor(() => expect(mocks.savePattern).toHaveBeenCalledTimes(1));
    const saved = mocks.savePattern.mock.calls[0]?.[0] as {
      kind: string;
      config: { url_filter: string; method: string; key_path: string };
    };
    expect(saved.kind).toBe('network_capture');
    expect(saved.config.method).toBe('GET');
    expect(saved.config.key_path).toBe('events');
    expect(matchesUrlFilter('https://electronic.vegas/api/events', saved.config.url_filter)).toBe(
      true,
    );
    expect(matchesUrlFilter('https://electronic.vegas/api/venues', saved.config.url_filter)).toBe(
      false,
    );
  });

  it('keeps the selected response when the list search changes before Save', async () => {
    const user = userEvent.setup();
    render(<NetworkTab />);

    const search = screen.getByPlaceholderText(/Filter by URL or content-type/);
    await user.type(search, 'json');
    await user.click(screen.getByRole('button', { name: /api\/events/ }));
    await user.click(screen.getByRole('button', { name: 'Select events path' }));
    await user.clear(search);
    await user.type(search, 'venues');
    await user.click(screen.getByRole('button', { name: /^Save$/ }));

    await waitFor(() => expect(mocks.savePattern).toHaveBeenCalledTimes(1));
    const saved = mocks.savePattern.mock.calls[0]?.[0] as {
      name: string;
      config: { url_filter: string; key_path: string };
    };
    expect(saved.name).toContain('/api/events');
    expect(saved.config.key_path).toBe('events');
    expect(matchesUrlFilter('https://electronic.vegas/api/events', saved.config.url_filter)).toBe(
      true,
    );
    expect(matchesUrlFilter('https://electronic.vegas/api/venues', saved.config.url_filter)).toBe(
      false,
    );
  });
});
