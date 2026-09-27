import type { ToolContext } from '@/lib/tools/types';
import type { ExtractionPattern } from '@/lib/supabase/queries';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tab: { id: 37, url: 'https://electronic.vegas/calendar/' },
  fetchPatterns: vi.fn(),
  runSaved: vi.fn(),
  bumpRun: vi.fn(),
}));

vi.mock('@/lib/tools/handlers/_active-tab', () => ({ getAssignedTab: async () => ({ ...mocks.tab }) }));
vi.mock('@/lib/supabase/queries', () => ({
  fetchPatternsForDomain: mocks.fetchPatterns,
  bumpPatternRun: mocks.bumpRun,
  deletePattern: vi.fn(),
  savePattern: vi.fn(),
  PATTERN_KINDS: ['list_pattern'],
}));
vi.mock('@/lib/data-pattern/run-interactive', () => ({
  runSavedPattern: mocks.runSaved,
  NetworkNoMatchError: class NetworkNoMatchError extends Error {},
}));
vi.mock('@/lib/data-pattern/recipes', () => ({
  loadRecipes: vi.fn(),
  recipesForUrl: vi.fn(),
}));
vi.mock('@/lib/api/routes/auth', () => ({ requireRequestOrganizationId: vi.fn() }));

import { data_patterns } from '@/lib/tools/handlers/data-patterns';

const context: ToolContext = { conversationId: null, runId: 'saved-replay', callId: 'calendar-extract', agentName: null, permissionMode: 'act', assignedTabId: 37 };

const pattern = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  name: 'Calendar events',
  domain: 'electronic.vegas',
  route_pattern: '/calendar/',
  kind: 'list_pattern',
  config: { list_root: '#events', item_selector: '.event', field_paths: [] },
  created_by: null, list_root_selector: '#events', fields: [], target_user_table_id: null,
  last_used_at: null, last_run_at: null, last_status: null, last_run_count: null, created_at: '2026-09-27T00:00:00Z',
} satisfies ExtractionPattern;

beforeEach(() => { Object.assign(chrome, { tabs: { get: vi.fn(async () => ({ ...mocks.tab })) } }); });

afterEach(() => {
  vi.clearAllMocks();
  mocks.tab.url = 'https://electronic.vegas/calendar/';
});

it('reports a saved-run no-match without writing a healthy badge', async () => {
  mocks.fetchPatterns.mockResolvedValue([pattern]);
  mocks.runSaved.mockResolvedValue([]);
  const result = await data_patterns.run(
    { action: 'run', pattern_id: pattern.id },
    context,
  ) as { ok: boolean; outcome: string; message: string; row_count: number };

  expect(result).toMatchObject({ ok: true, outcome: 'no_match', row_count: 0 });
  expect(result.message).toMatch(/no matching data/i);
  expect(mocks.bumpRun).not.toHaveBeenCalled();
});

it('keeps off-route rows visible for review without promoting saved health', async () => {
  mocks.tab.url = 'https://electronic.vegas/search/';
  mocks.fetchPatterns.mockResolvedValue([pattern]);
  mocks.runSaved.mockResolvedValue([{ title: 'Unrelated event' }]);
  const result = await data_patterns.run(
    { action: 'run', pattern_id: pattern.id },
    context,
  ) as { ok: boolean; outcome: string; row_count: number };

  expect(result).toMatchObject({ ok: true, outcome: 'off_route', row_count: 1 });
  expect(mocks.bumpRun).not.toHaveBeenCalled();
});

it('still promotes an on-route nonempty saved run to healthy', async () => {
  mocks.fetchPatterns.mockResolvedValue([pattern]);
  mocks.runSaved.mockResolvedValue([{ title: 'Real event' }]);
  const result = await data_patterns.run(
    { action: 'run', pattern_id: pattern.id },
    context,
  ) as { outcome: string; row_count: number };

  expect(result).toMatchObject({ outcome: 'matched', row_count: 1 });
  expect(mocks.bumpRun).toHaveBeenCalledWith(pattern.id, 'ok', 1);
});

it('does not return stale tool rows or overwrite health after assigned-page navigation', async () => {
  mocks.fetchPatterns.mockResolvedValue([pattern]);
  mocks.runSaved.mockImplementation(async () => {
    mocks.tab.url = 'https://electronic.vegas/search/';
    return [{ title: 'Old calendar event' }];
  });
  const result = await data_patterns.run({ action: 'run', pattern_id: pattern.id }, context);
  expect(result).toMatchObject({ ok: false, retryable: true, reason: expect.stringMatching(/page changed|closed/i) });
  expect(result).not.toHaveProperty('rows');
  expect(mocks.bumpRun).not.toHaveBeenCalled();
});
