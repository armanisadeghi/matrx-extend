import { runPattern } from '@/lib/data-pattern/run-pattern';
import { classifySavedRun } from '@/lib/data-pattern/saved-run-outcome';
import type { ExtractionPattern } from '@/lib/supabase/queries';
import { afterEach, expect, it, vi } from 'vitest';

// A venue researcher saves the title and optional ticket link from event pages.
const pattern = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  created_by: null,
  name: 'Venue event',
  domain: 'electronic.vegas',
  route_pattern: '/calendar/',
  list_root_selector: null,
  kind: 'manual_css',
  config: {},
  fields: [
    { name: 'title', selector: '.event-title', is_list: false },
    { name: 'ticket', selector: '.ticket', is_list: false },
  ],
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
it.each([
  ['<aside>Site navigation</aside>', [], 'no_match'],
  ['<h1 class="event-title"></h1>', [{ title: '', ticket: null }], 'matched'],
  [
    '<h1 class="event-title">Brooklyn Bowl</h1>',
    [{ title: 'Brooklyn Bowl', ticket: null }],
    'matched',
  ],
] as const)(
  'uses selector matches rather than value truthiness for %s',
  async (html, expected, outcome) => {
    document.body.innerHTML = html;
    Object.assign(chrome, {
      scripting: {
        executeScript: vi.fn(
          async ({ func, args }: { func: (...args: unknown[]) => unknown; args: unknown[] }) => [
            { result: func(...args) },
          ],
        ),
      },
    });
    const rows = await runPattern(pattern, 37);
    expect(rows).toEqual(expected);
    expect(classifySavedRun(pattern, 'https://electronic.vegas/calendar/', rows).kind).toBe(
      outcome,
    );
  },
);
