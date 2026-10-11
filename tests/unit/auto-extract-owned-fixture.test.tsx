import type { ExtractionPattern } from '@/lib/supabase/queries';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  page: {
    id: 37,
    url: 'https://owned.example/products?auto=success',
    documentId: 'document-success',
    pageKey: 'page-success',
  },
  fetchPatterns: vi.fn(),
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

import { useAutoExtract } from '@/hooks/use-auto-extract';
import { useAuthStore } from '@/state/auth';
import { useAutoExtractStore } from '@/state/auto-extract';

const pattern: ExtractionPattern = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  name: 'Owned catalog',
  domain: 'owned.example',
  route_pattern: '/products',
  kind: 'manual_css',
  config: {},
  fields: [
    { name: 'field_1', selector: '.product-name', is_list: false },
    { name: 'field_2', selector: '.product-price', is_list: false },
  ],
  list_root_selector: null,
  target_user_table_id: null,
  created_by: null,
  last_used_at: null,
  last_run_at: null,
  last_status: null,
  last_run_count: null,
  created_at: '2026-10-10T00:00:00Z',
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  mocks.page = {
    id: 37,
    url: 'https://owned.example/products?auto=success',
    documentId: 'document-success',
    pageKey: 'page-success',
  };
  useAuthStore.setState({ user: null, status: 'unknown', error: null, isAdmin: false });
  useAutoExtractStore.setState({ records: new Map() });
  document.body.innerHTML = '';
});

it('runs the real manual_css path from an owned page through running, rows, no-match, and selector failure', async () => {
  vi.useFakeTimers();
  let releaseFirst: (() => void) | undefined;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const executions: { documentIds: string[] }[] = [];
  vi.stubGlobal('chrome', {
    scripting: {
      executeScript: vi.fn(async ({ target, func, args }) => {
        executions.push({ documentIds: target.documentIds });
        if (executions.length === 1) await firstGate;
        return [{ result: func(args[0]) }];
      }),
    },
  });
  mocks.fetchPatterns.mockImplementation(async () => [pattern]);
  mocks.bumpRun.mockResolvedValue(null);
  useAuthStore.setState({
    user: { id: 'member-1', email: null },
    status: 'signed-in',
    error: null,
    isAdmin: false,
  });
  document.body.innerHTML =
    '<article><h2 class="product-name">Cedar chair</h2><p class="product-price">$429</p></article>';
  const view = renderHook(() => useAutoExtract());

  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
  expect(useAutoExtractStore.getState().records.get(`page-success|${pattern.id}`)?.status).toBe(
    'running',
  );
  await act(async () => {
    releaseFirst?.();
    await Promise.resolve();
  });
  expect(useAutoExtractStore.getState().records.get(`page-success|${pattern.id}`)).toMatchObject({
    status: 'ok',
    rows: [{ field_1: 'Cedar chair', field_2: '$429' }],
  });

  document.body.innerHTML = '<aside>Unrelated page data</aside>';
  mocks.page = {
    id: 37,
    url: 'https://owned.example/products?auto=empty',
    documentId: 'document-empty',
    pageKey: 'page-empty',
  };
  view.rerender();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
  expect(useAutoExtractStore.getState().records.get(`page-empty|${pattern.id}`)).toMatchObject({
    status: 'no_match',
    rows: [],
    note: expect.stringMatching(/no matching data/i),
  });

  mocks.fetchPatterns.mockImplementation(async () => [{ ...pattern, list_root_selector: '[' }]);
  mocks.page = {
    id: 37,
    url: 'https://owned.example/products?auto=error',
    documentId: 'document-error',
    pageKey: 'page-error',
  };
  view.rerender();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
  expect(useAutoExtractStore.getState().records.get(`page-error|${pattern.id}`)).toMatchObject({
    status: 'error',
    rows: [],
    error: expect.stringMatching(/selector/i),
  });
  expect(executions.map(({ documentIds }) => documentIds)).toEqual([
    ['document-success'],
    ['document-empty'],
    ['document-error'],
  ]);
  expect(mocks.bumpRun).toHaveBeenCalledWith(pattern.id, 'ok', 1);
  expect(mocks.bumpRun).toHaveBeenCalledWith(pattern.id, 'broken', 0);
});
