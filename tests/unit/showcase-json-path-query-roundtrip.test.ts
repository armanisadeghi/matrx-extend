import type { ExtractionPattern } from '@/lib/supabase/queries';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// External Supabase I/O only. Production save/query mapping and both replay
// runners stay real, so dropping key_path at the insert or fetch boundary fails.
const db = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  domain: '',
  lastId: '',
  listeners: new Map<string, (event: unknown) => unknown>(),
}));

vi.mock('@/lib/supabase/client', () => {
  const client = {
    schema: () => client,
    from: () => client,
    insert: (payload: Record<string, unknown>) => {
      db.lastId = `cccccccc-cccc-4ccc-8ccc-${String(db.rows.length + 1).padStart(12, '0')}`;
      db.rows.push(
        JSON.parse(
          JSON.stringify({
            ...payload,
            id: db.lastId,
            created_by: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            created_at: '2026-09-27T12:00:00.000Z',
            last_used_at: null,
            last_run_at: null,
            last_status: null,
            last_run_count: null,
          }),
        ),
      );
      return client;
    },
    select: () => client,
    single: async () => ({ data: { id: db.lastId }, error: null }),
    eq: (_column: string, domain: string) => {
      db.domain = domain;
      return client;
    },
    order: async () => ({
      data: db.rows.filter((row) => row.domain === db.domain),
      error: null,
    }),
  };
  return {
    supabaseForActor: () => client,
    getSupabase: () => client,
    getMachineryAuthoredSupabase: () => client,
    hasSupabaseAccessToken: () => true,
  };
});
vi.mock('@/lib/messaging/native', () => ({
  on: (channel: string, callback: (event: unknown) => unknown) => {
    db.listeners.set(channel, callback);
    return () => db.listeners.delete(channel);
  },
  send: vi.fn(),
}));
vi.mock('@/lib/data-pattern/document-network-transport', () => ({
  openDocumentNetworkCapture: (options: {
    captureId: string;
    onArmed?: () => void;
    onEvent: (event: unknown) => void;
  }) => {
    db.listeners.set('net-capture:event', (event) =>
      options.onEvent({
        ...(event as object),
        capture_id: options.captureId,
        document_key: 'fresh-document',
      }),
    );
    options.onArmed?.();
    return Promise.resolve({
      close: async () => {
        db.listeners.delete('net-capture:event');
      },
    });
  },
}));

import { runSavedPattern } from '@/lib/data-pattern/run-interactive';
import { CHANNELS } from '@/lib/messaging/schemas';
import { fetchPatternsForDomain, savePattern } from '@/lib/supabase/queries';

const body = JSON.stringify({
  'feeds.news': [{ title: 'Harbor desk bulletin' }],
  feeds: { news: [{ title: 'Regional wire digest' }] },
});
const variants = [
  { label: 'literal key', path: ['feeds.news'], title: 'Harbor desk bulletin' },
  { label: 'nested keys', path: ['feeds', 'news'], title: 'Regional wire digest' },
] as const;
const baseSave = {
  authored_by: 'person' as const,
  organization_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  domain: 'harborjournal.test',
  route_pattern: '/news',
  list_root_selector: null,
  fields: [],
};

async function reopenSavedPattern(id: string): Promise<ExtractionPattern> {
  const fetched = await fetchPatternsForDomain('harborjournal.test');
  const pattern = fetched.find((row) => row.id === id);
  if (!pattern) throw new Error('The saved pattern was absent after fetch');
  return pattern;
}

beforeEach(() => {
  db.rows.splice(0);
  db.domain = '';
  db.lastId = '';
  db.listeners.clear();
});

afterEach(() => {
  document.body.innerHTML = '';
  db.listeners.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Showcase JSON key paths through real query mapping', () => {
  it.each(variants)(
    'retains $label after Network insert, fetch, and replay',
    async ({ path, title }) => {
      const saved = await savePattern({
        ...baseSave,
        name: `Harbor Journal ${title}`,
        kind: 'network_capture',
        config: {
          url_filter: 'https://harborjournal.test/api/feeds',
          method: 'GET',
          body_match: 'ignore',
          key_path: [...path],
        },
      });
      if (!saved) throw new Error('Network save failed');
      const reopened = await reopenSavedPattern(saved.id);
      expect(reopened.config).toMatchObject({ key_path: [...path] });

      Object.assign(chrome, {
        scripting: { executeScript: vi.fn(async () => []) },
        tabs: {
          onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
          reload: vi.fn(async () => {}),
        },
      });
      vi.useFakeTimers();
      const replay = runSavedPattern(reopened, 37, {
        initiation: 'user',
        captureApproved: true,
        timeoutMs: 5_000,
      });
      await vi.advanceTimersByTimeAsync(0);
      const emit = db.listeners.get(CHANNELS.NET_CAPTURE_EVENT);
      if (!emit) throw new Error('Network replay listener was not installed');
      emit({
        ts_ms: 1_726_000_000_000,
        source: 'fetch',
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
      });
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(replay).resolves.toEqual([{ title }]);
    },
  );

  it.each(variants)(
    'retains $label after Framework insert, fetch, and replay',
    async ({ path, title }) => {
      const saved = await savePattern({
        ...baseSave,
        name: `Harbor Journal ${title}`,
        kind: 'next_data',
        config: { source: '__NEXT_DATA__', key_path: [...path] },
      });
      if (!saved) throw new Error('Framework save failed');
      const reopened = await reopenSavedPattern(saved.id);
      expect(reopened.config).toMatchObject({ key_path: [...path] });

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
      await expect(runSavedPattern(reopened, 37, { initiation: 'user' })).resolves.toEqual([
        { title },
      ]);
    },
  );
});
