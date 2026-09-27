import { listPatternMode, probeFirstRowInPage } from '@/lib/data-pattern/modes/list-pattern';
import { runMode, runPattern } from '@/lib/data-pattern/run-pattern';
import type { ExtractionPattern } from '@/lib/supabase/queries';
import { afterEach, describe, expect, it, vi } from 'vitest';

const savedList = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  created_by: null,
  name: 'Calendar events',
  domain: 'electronic.vegas',
  route_pattern: '/vegas-edm-event-calendar/',
  list_root_selector: '#calendar-events',
  fields: [],
  kind: 'list_pattern',
  config: {
    list_root: '#calendar-events',
    item_selector: '.event-card',
    field_paths: [{ name: 'title', rel_selector: '.title' }],
  },
  target_user_table_id: null,
  last_used_at: null,
  last_run_at: null,
  last_status: null,
  last_run_count: null,
  created_at: '2026-09-27T00:00:00Z',
} satisfies ExtractionPattern;

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('saved DOM replay scope', () => {
  it('does not read an unrelated event card when a configured list root disappears', () => {
    document.body.innerHTML = `<main><aside class="event-card"><h2 class="title">Ad for another venue</h2></aside></main>`;
    const config = savedList.config;

    expect(listPatternMode.runInPage(config)).toEqual([]);
    expect(probeFirstRowInPage(config)).toBeNull();
  });

  it('distinguishes an execution result missing at the Chrome boundary from a real zero-row result', async () => {
    const executeScript = vi.fn(async () => []);
    Object.assign(chrome, { scripting: { executeScript } });

    await expect(runPattern(savedList, 37)).rejects.toThrow(/no extraction result|did not return/i);
    await expect(runMode('list_pattern', 37, savedList.config)).rejects.toThrow(
      /no extraction result|did not return/i,
    );
    executeScript.mockResolvedValueOnce([{ result: [] }] as never);
    await expect(runPattern(savedList, 37)).resolves.toEqual([]);
  });
});
