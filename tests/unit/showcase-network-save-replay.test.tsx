import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const events = [
    {
      ts_ms: 1_726_000_000_000,
      source: 'fetch' as const,
      method: 'GET',
      request_body_key: 'none',
      request_sequence: 1,
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
      request_body_key: 'none',
      request_sequence: 1,
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
    baseEvents: events,
    events: [...events],
    listeners: new Map<string, (event: unknown) => unknown>(),
    captureArmed: vi.fn(),
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
vi.mock('@/lib/messaging/native', () => ({
  on: (channel: string, callback: (event: unknown) => unknown) => {
    mocks.listeners.set(channel, callback);
    return () => mocks.listeners.delete(channel);
  },
  send: vi.fn(),
}));
vi.mock('@/lib/data-pattern/document-network-transport', () => ({
  openDocumentNetworkCapture: (options: {
    captureId: string;
    onArmed?: () => void;
    onEvent: (event: unknown) => void;
  }) => {
    mocks.listeners.set('net-capture:event', (event) =>
      options.onEvent({
        ...(event as object),
        capture_id: options.captureId,
        document_key: 'reloaded-document',
      }),
    );
    mocks.captureArmed();
    options.onArmed?.();
    return Promise.resolve({
      close: async () => {
        mocks.listeners.delete('net-capture:event');
      },
    });
  },
}));
vi.mock('@/components/ui/json-tree', () => ({
  JsonTree: ({ onSelectPath }: { onSelectPath: (path: string[]) => void }) => (
    <button type="button" onClick={() => onSelectPath(['events'])}>
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
import { matchesUrlFilter, runNetworkCapturePattern } from '@/lib/data-pattern/run-interactive';
import { CHANNELS } from '@/lib/messaging/schemas';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  mocks.events.splice(0, mocks.events.length, ...mocks.baseEvents);
  mocks.listeners.clear();
  mocks.captureArmed.mockClear();
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
      config: { url_filter: string; method: string; key_path: string[] };
    };
    expect(saved.kind).toBe('network_capture');
    expect(saved.config.method).toBe('GET');
    expect(saved.config.key_path).toEqual(['events']);
    expect(matchesUrlFilter('https://electronic.vegas/api/events', saved.config.url_filter)).toBe(
      true,
    );
    expect(matchesUrlFilter('https://electronic.vegas/api/venues', saved.config.url_filter)).toBe(
      false,
    );
  });

  it('saves explicit broader URL and body choices without blocking an excluded selected response', async () => {
    const user = userEvent.setup();
    render(<NetworkTab />);
    await user.click(screen.getByRole('button', { name: /api\/events/ }));
    await user.click(screen.getByRole('button', { name: 'Select events path' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'URL matching' }), 'filter');
    await user.click(screen.getByRole('checkbox', { name: 'Match the selected request body' }));
    const matcher = screen.getByLabelText('Request URL to match on rerun');
    await user.clear(matcher);
    await user.type(matcher, '/other-calendar/*');
    expect(screen.getByText(/does not include the selected response/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(mocks.savePattern).toHaveBeenCalledTimes(1));
    expect(mocks.savePattern.mock.calls[0]?.[0]).toMatchObject({
      config: {
        url_filter: '/other-calendar/*',
        url_match: 'filter',
        body_match: 'ignore',
        key_path: ['events'],
      },
    });
    expect(
      (mocks.savePattern.mock.calls[0]?.[0] as { config: Record<string, unknown> }).config,
    ).not.toHaveProperty('request_body_key');
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
      config: { url_filter: string; key_path: string[] };
    };
    expect(saved.name).toContain('/api/events');
    expect(saved.config.key_path).toEqual(['events']);
    expect(matchesUrlFilter('https://electronic.vegas/api/events', saved.config.url_filter)).toBe(
      true,
    );
    expect(matchesUrlFilter('https://electronic.vegas/api/venues', saved.config.url_filter)).toBe(
      false,
    );
  });

  it.each([
    {
      selectedUrl: 'https://electronic.vegas/api/events?date=2026-09-27',
      otherUrl: 'https://electronic.vegas/api/events?date=2026-09-28',
      selectedTitle: 'Tonight at Pier Hall',
      otherTitle: 'Tomorrow at Harbor Hall',
    },
    {
      selectedUrl: 'https://electronic.vegas/api/resources/123',
      otherUrl: 'https://electronic.vegas/api/resources/456',
      selectedTitle: 'Resource 123',
      otherTitle: 'Resource 456',
    },
  ])(
    'replays the selected request identity when sibling URLs share a path or numeric shape: $selectedTitle',
    async (variant) => {
      const [first, second] = mocks.baseEvents;
      if (!first || !second) throw new Error('Network capture fixtures are incomplete');
      const selected = {
        ...first,
        url: variant.selectedUrl,
        body: JSON.stringify({ events: [{ title: variant.selectedTitle }] }),
        body_size: 48,
      };
      const other = {
        ...second,
        url: variant.otherUrl,
        body: JSON.stringify({ events: [{ title: variant.otherTitle }, { title: 'Extra row' }] }),
        body_size: 120,
      };
      mocks.events.splice(0, mocks.events.length, selected, other);

      const user = userEvent.setup();
      render(<NetworkTab />);
      await user.type(screen.getByPlaceholderText(/Filter by URL or content-type/), 'json');
      await user.click(screen.getByRole('button', { name: /2026-09-27|resources\/123/ }));
      await user.click(screen.getByRole('button', { name: 'Select events path' }));
      await screen.findByText(new RegExp(variant.selectedTitle));
      await user.click(screen.getByRole('button', { name: /^Save$/ }));
      await waitFor(() => expect(mocks.savePattern).toHaveBeenCalledTimes(1));
      const saved = mocks.savePattern.mock.calls[0]?.[0] as {
        config: { url_filter: string; method: string; key_path: string[] };
      };
      expect(saved.config.url_filter).toBe(variant.selectedUrl);

      const addListener = vi.fn();
      const removeListener = vi.fn();
      Object.assign(chrome, {
        scripting: { executeScript: vi.fn(async () => []) },
        tabs: {
          onUpdated: { addListener, removeListener },
          reload: vi.fn(async () => {}),
        },
      });
      vi.useFakeTimers();
      const replay = runNetworkCapturePattern(saved.config, 37, {
        initiation: 'user',
        timeoutMs: 5_000,
      });
      const emit = mocks.listeners.get(CHANNELS.NET_CAPTURE_EVENT);
      if (!emit) throw new Error('Network replay listener was not installed');
      await vi.advanceTimersByTimeAsync(0);
      emit(selected);
      emit(other);
      await vi.advanceTimersByTimeAsync(5_000);

      await expect(replay).resolves.toEqual([{ title: variant.selectedTitle }]);
      expect(mocks.captureArmed).toHaveBeenCalledOnce();
      expect(mocks.listeners.has(CHANNELS.NET_CAPTURE_EVENT)).toBe(false);
    },
  );
});
