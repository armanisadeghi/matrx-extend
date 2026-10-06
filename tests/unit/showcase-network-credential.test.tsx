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
    tab: { id: 37, documentId: 'calendar-document', pageKey: 'calendar-page' },
    capturing: false,
    discovering: false,
    discoveryProgress: null,
    events: mocks.events,
    error: null,
    installed: true,
    start: vi.fn(),
    capturePageLoad: vi.fn(),
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
  useActiveTab: () => ({
    id: 37,
    url: 'https://electronic.vegas/vegas-edm-event-calendar/',
    documentId: 'calendar-document',
    identityStatus: 'ready',
    identityError: null,
    pageKey: 'calendar-page',
    title: 'Calendar',
  }),
  isCurrentPageIdentity: () => true,
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
        return 'chrome-replay-document';
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
});

describe('D48 credential-safe Network request identity', () => {
  it.each([
    ['access_token', 'SYNTHETIC_TOKEN_DO_NOT_USE'],
    ['api_key', 'SYNTHETIC_KEY_DO_NOT_USE'],
    ['signature', 'SYNTHETIC_SIGNATURE_DO_NOT_USE'],
  ])(
    'does not persist the selected %s URL value in matcher or default name',
    async (key, secret) => {
      const base = mocks.baseEvents[0];
      if (!base) throw new Error('Network capture fixture is incomplete');
      const selectedUrl = `https://electronic.vegas/api/events?date=2026-09-27&${key}=${secret}&page=2`;
      mocks.events.splice(0, mocks.events.length, { ...base, url: selectedUrl });
      const user = userEvent.setup();
      render(<NetworkTab />);
      await user.click(screen.getByRole('button', { name: /api\/events/ }));
      expect(document.body.textContent).not.toContain(secret);
      expect(
        (screen.getByLabelText('Request URL to match on rerun') as HTMLInputElement).value,
      ).not.toContain(secret);
      await user.click(screen.getByRole('button', { name: 'Select events path' }));
      await user.click(screen.getByRole('button', { name: /^Save$/ }));
      await waitFor(() => expect(mocks.savePattern).toHaveBeenCalledTimes(1));
      const saved = mocks.savePattern.mock.calls[0]?.[0] as {
        name: string;
        config: { url_filter: string; url_match: 'exact' | 'filter' };
      };
      expect(JSON.stringify(saved)).not.toContain(secret);
      expect(saved.config.url_filter).toContain('date=2026-09-27');
      expect(saved.config.url_filter).toContain('page=2');
      expect(
        matchesUrlFilter(
          `https://electronic.vegas/api/events?date=2026-09-27&${key}=ROTATED_SYNTHETIC&page=2`,
          saved.config.url_filter,
          saved.config.url_match,
        ),
      ).toBe(true);
      expect(
        matchesUrlFilter(
          `https://electronic.vegas/api/events?date=2026-09-28&${key}=ROTATED_SYNTHETIC&page=2`,
          saved.config.url_filter,
          saved.config.url_match,
        ),
      ).toBe(false);
    },
  );

  it('lets a person mark an unrecognized query key as a credential before saving', async () => {
    const base = mocks.baseEvents[0];
    if (!base) throw new Error('Network capture fixture is incomplete');
    const secret = 'SYNTHETIC_UNKNOWN_PROOF';
    mocks.events.splice(0, mocks.events.length, {
      ...base,
      url: `https://electronic.vegas/api/events?date=2026-09-27&proof=${secret}&page=2`,
    });
    const user = userEvent.setup();
    render(<NetworkTab />);
    await user.click(screen.getByRole('button', { name: /api\/events/ }));
    expect(screen.getByText(/unknown keys may still contain a credential/i)).toBeTruthy();
    await user.click(screen.getByRole('checkbox', { name: 'Treat proof as credential' }));
    expect(document.body.textContent).not.toContain(secret);
    expect(
      (screen.getByLabelText('Request URL to match on rerun') as HTMLInputElement).value,
    ).not.toContain(secret);
    await user.click(screen.getByRole('button', { name: 'Select events path' }));
    await user.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(mocks.savePattern).toHaveBeenCalledTimes(1));
    const saved = mocks.savePattern.mock.calls[0]?.[0] as {
      config: { url_filter: string; credential_query_keys: string[] };
    };
    expect(JSON.stringify(saved)).not.toContain(secret);
    expect(saved.config.credential_query_keys).toEqual(['proof']);
    expect(saved.config.url_filter).toContain('date=2026-09-27');
    expect(saved.config.url_filter).toContain('page=2');
  });

  it('offers the same credential choice for a key typed into the editable matcher', async () => {
    const base = mocks.baseEvents[0];
    if (!base) throw new Error('Network capture fixture is incomplete');
    mocks.events.splice(0, mocks.events.length, base);
    const user = userEvent.setup();
    render(<NetworkTab />);
    await user.click(screen.getByRole('button', { name: /api\/events/ }));
    const input = screen.getByLabelText('Request URL to match on rerun') as HTMLInputElement;
    await user.clear(input);
    await user.type(
      input,
      'https://electronic.vegas/api/events?date=2026-09-27&proof=SYNTHETIC_TYPED_SECRET&page=2',
    );
    await user.click(screen.getByRole('checkbox', { name: 'Treat proof as credential' }));
    expect(input.value).not.toContain('SYNTHETIC_TYPED_SECRET');
    await user.click(screen.getByRole('button', { name: 'Select events path' }));
    await user.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(mocks.savePattern).toHaveBeenCalledTimes(1));
    const saved = mocks.savePattern.mock.calls[0]?.[0] as { config: { url_filter: string } };
    expect(JSON.stringify(saved)).not.toContain('SYNTHETIC_TYPED_SECRET');
    expect(saved.config.url_filter).toContain('date=2026-09-27');
    expect(saved.config.url_filter).toContain('proof=[credential]');
  });

  it('marks malformed request body identity unavailable before save', async () => {
    const base = mocks.baseEvents[0];
    if (!base) throw new Error('Network capture fixture is incomplete');
    mocks.events.splice(0, mocks.events.length, {
      ...base,
      request_body_key: 'Bearer SYNTHETIC_BODY_SECRET',
    });
    const user = userEvent.setup();
    render(<NetworkTab />);
    await user.click(screen.getByRole('button', { name: /api\/events/ }));
    expect(screen.getByText(/no stable body identity/i)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Select events path' }));
    await user.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(mocks.savePattern).toHaveBeenCalledTimes(1));
    const saved = mocks.savePattern.mock.calls[0]?.[0] as { config: { request_body_key: string } };
    expect(saved.config.request_body_key).toBe('unavailable');
    expect(JSON.stringify(saved)).not.toContain('SYNTHETIC_BODY_SECRET');
  });

  it('replays the selected operation after its query credential rotates without accepting another date', async () => {
    const base = mocks.baseEvents[0];
    if (!base) throw new Error('Network capture fixture is incomplete');
    mocks.events.splice(0, mocks.events.length, {
      ...base,
      url: 'https://electronic.vegas/api/events?date=2026-09-27&access_token=SYNTHETIC_FIRST',
    });
    const user = userEvent.setup();
    render(<NetworkTab />);
    await user.click(screen.getByRole('button', { name: /api\/events/ }));
    await user.click(screen.getByRole('button', { name: 'Select events path' }));
    await user.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(mocks.savePattern).toHaveBeenCalledTimes(1));
    const saved = mocks.savePattern.mock.calls[0]?.[0] as {
      config: { url_filter: string; url_match: 'exact' | 'filter'; key_path: string[] };
    };
    const addListener = vi.fn();
    Object.assign(chrome, {
      scripting: { executeScript: vi.fn(async () => []) },
      tabs: { onUpdated: { addListener, removeListener: vi.fn() }, reload: vi.fn(async () => {}) },
    });
    vi.useFakeTimers();
    const replay = runNetworkCapturePattern(saved.config, 37, {
      initiation: 'user',
      timeoutMs: 5_000,
    });
    void replay.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    const emit = mocks.listeners.get(CHANNELS.NET_CAPTURE_EVENT);
    if (!emit) throw new Error('Network replay listener was not installed');
    emit({
      ...base,
      url: 'https://electronic.vegas/api/events?date=2026-09-27&access_token=SYNTHETIC_ROTATED',
      body: JSON.stringify({ events: [{ title: 'Harbor Night at Pier Hall' }] }),
      request_sequence: 2,
    });
    emit({
      ...base,
      url: 'https://electronic.vegas/api/events?date=2026-09-28&access_token=SYNTHETIC_ROTATED',
      body: JSON.stringify({ events: [{ title: 'Different Day at Harbor Hall' }] }),
      request_sequence: 3,
    });
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(replay).resolves.toEqual([{ title: 'Harbor Night at Pier Hall' }]);
  });

  it('reports two different credential-bearing identities in one window as ambiguous', async () => {
    const base = mocks.baseEvents[0];
    if (!base) throw new Error('Network capture fixture is incomplete');
    const addListener = vi.fn();
    Object.assign(chrome, {
      scripting: { executeScript: vi.fn(async () => []) },
      tabs: { onUpdated: { addListener, removeListener: vi.fn() }, reload: vi.fn(async () => {}) },
    });
    vi.useFakeTimers();
    const replay = runNetworkCapturePattern(
      {
        url_filter: 'https://electronic.vegas/api/events?date=2026-09-27&access_token=[credential]',
        url_match: 'exact',
        method: 'GET',
        body_match: 'ignore',
        key_path: 'events',
      },
      37,
      { initiation: 'user', timeoutMs: 5_000 },
    );
    void replay.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    const emit = mocks.listeners.get(CHANNELS.NET_CAPTURE_EVENT);
    if (!emit) throw new Error('Network replay listener was not installed');
    emit({
      ...base,
      url: 'https://electronic.vegas/api/events?date=2026-09-27&access_token=SYNTHETIC_ONE',
      request_sequence: 1,
    });
    emit({
      ...base,
      url: 'https://electronic.vegas/api/events?date=2026-09-27&access_token=SYNTHETIC_TWO',
      request_sequence: 2,
    });
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(replay).rejects.toThrow(/ambiguous/i);
  });
});
