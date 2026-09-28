import type { ExtractionPattern } from '@/lib/supabase/queries';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  page: {
    id: 37,
    url: 'https://electronic.vegas/calendar/',
    documentId: 'document-a',
    pageKey: 'page-a',
  },
  fetchPatterns: vi.fn(),
  runPattern: vi.fn(),
  bumpRun: vi.fn(),
}));

vi.mock('@/hooks/use-active-tab', () => ({
  useActiveTab: () => ({ ...mocks.page }),
  isCurrentPageIdentity: (key: string) => key === mocks.page.pageKey,
}));
vi.mock('@/lib/supabase/queries', () => ({
  fetchPatternsForDomain: mocks.fetchPatterns,
  bumpPatternRun: mocks.bumpRun,
}));
vi.mock('@/lib/data-pattern/run-pattern', () => ({
  isInteractiveOnlyKind: () => false,
  runPattern: mocks.runPattern,
}));

import { useAutoExtract } from '@/hooks/use-auto-extract';
import { useAuthStore } from '@/state/auth';
import { useAutoExtractStore } from '@/state/auto-extract';

const pattern = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  name: 'Calendar events',
  domain: 'electronic.vegas',
  route_pattern: '/calendar/',
  kind: 'list_pattern',
  config: { list_root: '#events', item_selector: '.event', field_paths: [] },
  created_by: null,
  list_root_selector: '#events',
  fields: [],
  target_user_table_id: null,
  last_used_at: null,
  last_run_at: null,
  last_status: null,
  last_run_count: null,
  created_at: '2026-09-27T00:00:00Z',
} satisfies ExtractionPattern;

afterEach(() => {
  cleanup();
  mocks.page.id = 37;
  mocks.page.documentId = 'document-a';
  mocks.page.pageKey = 'page-a';
  vi.useRealTimers();
  vi.clearAllMocks();
  mocks.bumpRun.mockReset();
  useAuthStore.setState({ user: null, status: 'unknown', error: null, isAdmin: false });
  useAutoExtractStore.setState({ records: new Map() });
});

it('records an auto-extract no-match locally without promoting saved health to ok', async () => {
  vi.useFakeTimers();
  mocks.fetchPatterns.mockResolvedValue([pattern]);
  mocks.runPattern.mockResolvedValue([]);
  useAuthStore.setState({
    user: { id: 'user-1', email: null },
    status: 'signed-in',
    error: null,
    isAdmin: false,
  });
  renderHook(() => useAutoExtract());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });

  const record = useAutoExtractStore.getState().records.get(`page-a|${pattern.id}`);
  expect(record?.status).toBe('no_match');
  expect(record?.note).toMatch(/no matching data/i);
  expect(mocks.bumpRun).not.toHaveBeenCalled();
});

it('still promotes a matched nonempty auto-extraction to ok', async () => {
  vi.useFakeTimers();
  mocks.fetchPatterns.mockResolvedValue([pattern]);
  mocks.runPattern.mockResolvedValue([{ title: 'Real calendar event' }]);
  useAuthStore.setState({
    user: { id: 'user-1', email: null },
    status: 'signed-in',
    error: null,
    isAdmin: false,
  });
  renderHook(() => useAutoExtract());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });

  expect(mocks.bumpRun).toHaveBeenCalledWith(pattern.id, 'ok', 1);
});

it('keeps auto-extracted rows and records a visible history warning when the metadata write fails', async () => {
  vi.useFakeTimers();
  mocks.fetchPatterns.mockResolvedValue([pattern]);
  mocks.runPattern.mockResolvedValue([{ title: 'Friday night concert' }]);
  mocks.bumpRun.mockResolvedValue('Database unavailable');
  useAuthStore.setState({ user: { id: 'user-1', email: null }, status: 'signed-in' });
  renderHook(() => useAutoExtract());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });

  const record = useAutoExtractStore.getState().records.get(`page-a|${pattern.id}`);
  expect(record).toMatchObject({
    status: 'ok',
    rows: [{ title: 'Friday night concert' }],
    note: expect.stringMatching(/saved run history could not be updated: Database unavailable/i),
  });
});

it('extracts independently when two tabs share the same URL', async () => {
  vi.useFakeTimers();
  mocks.fetchPatterns.mockResolvedValue([pattern]);
  mocks.runPattern.mockImplementation(async (_pattern, tabId) => [
    { venue: tabId === 37 ? 'Brooklyn Bowl' : 'Area15' },
  ]);
  useAuthStore.setState({ user: { id: 'user-1', email: null }, status: 'signed-in' });
  const view = renderHook(() => useAutoExtract());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
  mocks.page.id = 38;
  mocks.page.documentId = 'document-b';
  mocks.page.pageKey = 'page-b';
  view.rerender();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
  const records = Array.from(useAutoExtractStore.getState().records.values());
  expect(records.map((r) => ({ tabId: r.tabId, rows: r.rows }))).toEqual([
    { tabId: 38, rows: [{ venue: 'Area15' }] },
  ]);
  expect(mocks.runPattern.mock.calls.map((call) => call[1])).toEqual([37, 38]);
});
