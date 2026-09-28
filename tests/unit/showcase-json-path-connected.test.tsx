import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A publisher's feed has a literal dotted key and a different nested feed.
// Keep both values different: a dotted-string collision must return the wrong title.
const body = JSON.stringify({
  'feeds.news': [{ title: 'Harbor desk bulletin' }],
  feeds: { news: [{ title: 'Regional wire digest' }] },
  '["edition"]': [{ title: 'Evening edition' }],
  groups: [{ 'a.b': [{ title: 'Weekend collection' }] }],
  '': [{ title: 'Untitled feed' }],
});

const mocks = vi.hoisted(() => ({
  events: [] as Array<Record<string, unknown>>,
  listeners: new Map<string, (event: unknown) => unknown>(),
  savePattern: vi.fn(async (_input: unknown) => ({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' })),
  persisted: null as null | { kind: string; config: { key_path: string | string[] } },
}));

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
      url: 'https://harborjournal.test/news',
      host: 'harborjournal.test',
      pathname: '/news',
    },
    dropped: 0,
  }),
}));
vi.mock('@/hooks/use-active-tab', () => ({
  useActiveTab: () => ({ id: 37, url: 'https://harborjournal.test/news' }),
}));
vi.mock('@/hooks/use-active-organization', () => ({
  useActiveOrganization: () => ({
    active: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Harbor Journal' },
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
        document_key: 'fresh-document',
      }),
    );
    options.onArmed?.();
    return Promise.resolve({
      close: async () => {
        mocks.listeners.delete('net-capture:event');
      },
    });
  },
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
  ChevronRight: () => null,
  Circle: () => null,
  Loader2: () => null,
  PlayCircle: () => null,
  RefreshCw: () => null,
  Save: () => null,
  Square: () => null,
  Trash2: () => null,
  TriangleAlert: () => null,
}));

import { FrameworkTab } from '@/features/showcase/tabs/FrameworkTab';
import { NetworkTab } from '@/features/showcase/tabs/NetworkTab';
import { sanitizeNetworkPatternFields } from '@/lib/credentials/network-urls';
import { runNetworkCapturePattern } from '@/lib/data-pattern/run-interactive';
import { runPattern } from '@/lib/data-pattern/run-pattern';
import { CHANNELS } from '@/lib/messaging/schemas';

const event = {
  ts_ms: 1_726_000_000_000,
  source: 'fetch' as const,
  method: 'GET',
  request_body_key: 'none',
  request_sequence: 1,
  url: 'https://harborjournal.test/api/feeds',
  status: 200,
  status_text: 'OK',
  request_headers: {},
  response_headers: { 'content-type': 'application/json' },
  body,
  body_truncated: false,
  body_size: body.length,
  content_type: 'application/json',
  tab_id: 37,
};

function literalDottedKeyButton(): HTMLButtonElement {
  const text = screen.queryByText('["feeds.news"]') ?? screen.getAllByText('feeds.news')[0];
  const button = text?.closest('button');
  if (!button) throw new Error('The literal dotted JSON key is not selectable');
  return button;
}

beforeEach(() => {
  mocks.savePattern.mockImplementation(async (input: unknown) => {
    const save = input as { kind: string; name: string; config: { key_path: string | string[] } };
    const sanitized =
      save.kind === 'network_capture'
        ? sanitizeNetworkPatternFields(save.name, save.config)
        : { name: save.name, config: save.config };
    // This guard covers tab wiring; query-roundtrip.test covers real save/fetch mapping.
    mocks.persisted = JSON.parse(JSON.stringify({ ...save, ...sanitized }));
    return { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' };
  });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  mocks.events.splice(0);
  mocks.listeners.clear();
  mocks.savePattern.mockClear();
  mocks.persisted = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Showcase exact JSON key path persistence', () => {
  it('keeps exact segment arrays at the Network credential-safe save boundary', () => {
    const saved = sanitizeNetworkPatternFields('Harbor Journal feed', {
      url_filter: event.url,
      method: 'GET',
      key_path: ['feeds.news'],
    });
    expect(saved.config.key_path).toEqual(['feeds.news']);
    expect(
      sanitizeNetworkPatternFields('Harbor Journal feed', {
        url_filter: event.url,
        method: 'GET',
        key_path: '["edition"]',
      }).config.key_path,
    ).toBe('["edition"]');
  });

  it('saves the selected literal key from the real Network tree and replays its value', async () => {
    mocks.events.push(event);
    const user = userEvent.setup();
    render(<NetworkTab />);
    await user.click(screen.getByRole('button', { name: /api\/feeds/ }));
    await user.click(literalDottedKeyButton());
    await screen.findByText(/Harbor desk bulletin/);
    await user.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(mocks.savePattern).toHaveBeenCalledOnce());
    const saved = mocks.savePattern.mock.calls[0]?.[0] as {
      kind: string;
      config: { key_path: string | string[] };
    };
    expect(saved.kind).toBe('network_capture');
    expect(saved.config.key_path).toEqual(['feeds.news']);
    expect(mocks.persisted?.config.key_path).toEqual(['feeds.news']);
    const reopened = mocks.persisted?.config;
    if (!reopened) throw new Error('Network pattern was not persisted');

    Object.assign(chrome, {
      scripting: { executeScript: vi.fn(async () => []) },
      tabs: {
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
        reload: vi.fn(async () => {}),
      },
    });
    vi.useFakeTimers();
    const replay = runNetworkCapturePattern(reopened, 37, { initiation: 'user', timeoutMs: 5_000 });
    await vi.advanceTimersByTimeAsync(0);
    const emit = mocks.listeners.get(CHANNELS.NET_CAPTURE_EVENT);
    if (!emit) throw new Error('Network replay listener was not installed');
    emit(event);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(replay).resolves.toEqual([{ title: 'Harbor desk bulletin' }]);
  });

  it('saves the selected literal key from the real Framework tree and replays its value', async () => {
    const script = document.createElement('script');
    script.id = '__NEXT_DATA__';
    script.type = 'application/json';
    script.textContent = body;
    document.body.append(script);
    Object.assign(chrome, {
      scripting: {
        executeScript: vi.fn(
          async ({ func, args }: { func: (config?: unknown) => unknown; args?: unknown[] }) => [
            { frameId: 0, result: func(args?.[0]) },
          ],
        ),
      },
    });

    const user = userEvent.setup();
    render(<FrameworkTab />);
    await waitFor(() =>
      expect(
        screen.queryByText('["feeds.news"]') ?? screen.queryAllByText('feeds.news')[0],
      ).toBeTruthy(),
    );
    await user.click(literalDottedKeyButton());
    await user.click(screen.getByRole('button', { name: 'Extract from key path' }));
    await screen.findByText(/Harbor desk bulletin/);
    await user.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(mocks.savePattern).toHaveBeenCalledOnce());
    const saved = mocks.savePattern.mock.calls[0]?.[0] as {
      kind: string;
      config: { source: string; key_path: string | string[] };
    };
    expect(saved.kind).toBe('next_data');
    expect(saved.config.key_path).toEqual(['feeds.news']);
    expect(mocks.persisted?.config.key_path).toEqual(['feeds.news']);
    const reopened = mocks.persisted?.config;
    if (!reopened) throw new Error('Framework pattern was not persisted');
    await expect(
      runPattern({ kind: 'next_data', config: reopened } as Parameters<typeof runPattern>[0], 37),
    ).resolves.toEqual([{ title: 'Harbor desk bulletin' }]);
  });
});
