import { afterEach, expect, it, vi } from 'vitest';
import type { ExtractionPattern } from '@/lib/supabase/queries';
import type { ToolContext } from '@/lib/tools/types';
const mocks = vi.hoisted(() => ({ fetchPatterns: vi.fn(), bumpRun: vi.fn() }));
vi.mock('@/lib/tools/handlers/_active-tab', () => ({ getAssignedTab: async () => ({ id: 37, url: 'https://electronic.vegas/calendar/' }) }));
vi.mock('@/lib/supabase/queries', () => ({ fetchPatternsForDomain: mocks.fetchPatterns, bumpPatternRun: mocks.bumpRun, deletePattern: vi.fn(), savePattern: vi.fn(), PATTERN_KINDS: ['list_pattern'] }));
vi.mock('@/lib/data-pattern/run-interactive', async () => {
  const { runPattern } = await import('@/lib/data-pattern/run-pattern');
  return { runSavedPattern: runPattern, NetworkNoMatchError: class NetworkNoMatchError extends Error {} };
});
vi.mock('@/lib/data-pattern/recipes', () => ({ loadRecipes: vi.fn(), recipesForUrl: vi.fn() }));
vi.mock('@/lib/api/routes/auth', () => ({ requireRequestOrganizationId: vi.fn() }));
import { data_patterns } from '@/lib/tools/handlers/data-patterns';
import { probeFirstRowInPage } from '@/lib/data-pattern/modes/list-pattern';
const context: ToolContext = { conversationId: null, runId: 'saved-list', callId: 'venue-extraction', agentName: null, permissionMode: 'act', assignedTabId: 37 };
const pattern = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Calendar events', domain: 'electronic.vegas', route_pattern: '/calendar/', kind: 'list_pattern',
  config: { list_root: '#events', item_selector: '.event', field_paths: [{ name: 'title', rel_selector: '.title' }] },
  created_by: null, list_root_selector: '#events', fields: [], target_user_table_id: null,
  last_used_at: null, last_run_at: null, last_status: null, last_run_count: null, created_at: '2026-09-27T00:00:00Z',
} satisfies ExtractionPattern;
afterEach(() => { document.body.innerHTML = ''; vi.clearAllMocks(); });
it.each([
  ['missing selected field', '<div id="events"><article class="event">Brooklyn Bowl</article></div>', true, [], 'no_match'],
  ['no selected fields', '<div id="events"><article class="event"><h2 class="title">Brooklyn Bowl</h2></article></div>', false, [], 'no_match'],
  ['blank existing field', '<div id="events"><article class="event"><h2 class="title"></h2></article></div>', true, [{ title: '' }], 'matched'],
] as const)('reports truthful saved-list health for %s', async (_label, html, fields, expected, outcome) => {
  document.body.innerHTML = html;
  const saved = { ...pattern, config: { ...pattern.config, field_paths: fields ? pattern.config.field_paths : [] } };
  mocks.fetchPatterns.mockResolvedValue([saved]);
  Object.assign(chrome, {
    tabs: { get: async () => ({ id: 37, url: 'https://electronic.vegas/calendar/' }) },
    scripting: { executeScript: async ({ func, args }: { func: (...args: unknown[]) => unknown; args: unknown[] }) => [{ result: func(...args) }] },
  });
  const result = await data_patterns.run({ action: 'run', pattern_id: saved.id }, context);
  expect(result).toMatchObject({ ok: true, outcome, rows: expected, row_count: expected.length });
  expect(mocks.bumpRun.mock.calls).toEqual(outcome === 'matched' ? [[saved.id, 'ok', 1]] : []);
  expect(probeFirstRowInPage(saved.config)).toEqual(outcome === 'matched' ? { title: '' } : null);
});
