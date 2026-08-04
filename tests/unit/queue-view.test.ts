/**
 * Unit tests for the scrape-queue view model (src/features/tasks/queue-view.ts):
 * flatten, facets, filter/search, sort, and grouping by level vs project.
 */

import {
  EMPTY_FILTERS,
  buildGroups,
  computeFacets,
  domainOf,
  filterAndSort,
  flattenQueue,
  hasActiveFilters,
  itemKey,
  matchesFilters,
  sortFlat,
} from '@/features/tasks/queue-view';
import type { ExtensionScrapeItem, ExtensionScrapeQueue } from '@/lib/api/routes/research';
import { describe, expect, it } from 'vitest';

/** Index helper that narrows away `undefined` (noUncheckedIndexedAccess) without `!`. */
function at<T>(arr: T[], i: number): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`no element at index ${i}`);
  return v;
}

function item(overrides: Partial<ExtensionScrapeItem> = {}): ExtensionScrapeItem {
  return {
    source_id: overrides.source_id ?? Math.random().toString(36).slice(2),
    topic_id: 'topic-a',
    topic_name: 'Alpha project',
    url: 'https://example.com/page',
    title: null,
    scrape_status: 'thin',
    is_included: true,
    next_level: 1,
    attempted_levels: [],
    last_attempt_at: null,
    last_char_count: null,
    last_failure_reason: null,
    server_attempts: 1,
    last_server_attempt_at: null,
    last_server_failure_reason: null,
    server_gave_up: true,
    policy_category: null,
    policy_reason: null,
    task_kind: 'scrape',
    enrich: null,
    ...overrides,
  };
}

function emptyQueue(): ExtensionScrapeQueue {
  return {
    level_1_quick: [],
    level_2_scroll: [],
    level_3_user_gated: [],
    level_4_paste: [],
    gated_login: [],
    low_value: [],
    totals: {},
  };
}

describe('domainOf', () => {
  it('strips www and lowercases; empty on bad url', () => {
    expect(domainOf('https://www.NYTimes.com/x')).toBe('nytimes.com');
    expect(domainOf('https://reddit.com/r/x')).toBe('reddit.com');
    expect(domainOf('not a url')).toBe('');
  });
});

describe('flattenQueue + facets', () => {
  const queue = emptyQueue();
  queue.level_1_quick = [
    item({ source_id: 's1', topic_id: 'topic-a', topic_name: 'Alpha', url: 'https://a.com/1' }),
    item({ source_id: 's2', topic_id: 'topic-b', topic_name: 'Beta', url: 'https://b.com/1' }),
  ];
  queue.gated_login = [
    item({
      source_id: 's3',
      topic_id: 'topic-a',
      topic_name: 'Alpha',
      url: 'https://a.com/2',
      scrape_status: 'gated',
      policy_category: 'gated_login',
    }),
  ];

  it('flattens all buckets and tags bucket + domain + key', () => {
    const flat = flattenQueue(queue);
    expect(flat).toHaveLength(3);
    const s3 = flat.find((f) => f.item.source_id === 's3');
    if (!s3) throw new Error('s3 missing');
    expect(s3.bucket).toBe('gated_login');
    expect(s3.domain).toBe('a.com');
    expect(s3.key).toBe(itemKey(s3.item));
  });

  it('computes topic / domain / status / category facets with counts', () => {
    const facets = computeFacets(flattenQueue(queue));
    expect(facets.total).toBe(3);
    expect(facets.topics.find((t) => t.id === 'topic-a')?.count).toBe(2);
    expect(facets.topics.find((t) => t.id === 'topic-b')?.count).toBe(1);
    expect(facets.domains.find((d) => d.domain === 'a.com')?.count).toBe(2);
    expect(facets.categories.find((c) => c.category === 'gated_login')?.count).toBe(1);
    // items with no policy_category fold into 'open'
    expect(facets.categories.find((c) => c.category === 'open')?.count).toBe(2);
  });

  it('handles undefined queue', () => {
    expect(flattenQueue(undefined)).toEqual([]);
  });
});

describe('matchesFilters', () => {
  const flat = flattenQueue(
    (() => {
      const q = emptyQueue();
      q.level_1_quick = [
        item({ source_id: 's1', topic_id: 'topic-a', url: 'https://a.com/x', title: 'Hello' }),
        item({
          source_id: 's2',
          topic_id: 'topic-b',
          url: 'https://b.com/y',
          scrape_status: 'failed',
        }),
      ];
      return q;
    })(),
  );
  const a = at(flat, 0);
  const b = at(flat, 1);

  it('passes everything with EMPTY_FILTERS', () => {
    expect(matchesFilters(a, EMPTY_FILTERS)).toBe(true);
    expect(matchesFilters(b, EMPTY_FILTERS)).toBe(true);
  });

  it('filters by topic', () => {
    const f = { ...EMPTY_FILTERS, topicId: 'topic-a' };
    expect(matchesFilters(a, f)).toBe(true);
    expect(matchesFilters(b, f)).toBe(false);
  });

  it('filters by domain, status, search', () => {
    expect(matchesFilters(a, { ...EMPTY_FILTERS, domain: 'a.com' })).toBe(true);
    expect(matchesFilters(b, { ...EMPTY_FILTERS, domain: 'a.com' })).toBe(false);
    expect(matchesFilters(b, { ...EMPTY_FILTERS, statuses: ['failed'] })).toBe(true);
    expect(matchesFilters(a, { ...EMPTY_FILTERS, statuses: ['failed'] })).toBe(false);
    expect(matchesFilters(a, { ...EMPTY_FILTERS, search: 'hello' })).toBe(true);
    expect(matchesFilters(a, { ...EMPTY_FILTERS, search: 'zzz' })).toBe(false);
  });

  it('hasActiveFilters reflects state', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, topicId: 'topic-a' })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, search: ' x ' })).toBe(true);
  });
});

describe('sortFlat', () => {
  const flat = flattenQueue(
    (() => {
      const q = emptyQueue();
      q.level_1_quick = [
        item({ source_id: 's1', topic_name: 'Zeta', last_char_count: 500, server_attempts: 1 }),
        item({ source_id: 's2', topic_name: 'Alpha', last_char_count: 100, server_attempts: 5 }),
      ];
      return q;
    })(),
  );

  it('sorts by topic asc/desc', () => {
    expect(at(sortFlat(flat, { key: 'topic', dir: 'asc' }), 0).item.topic_name).toBe('Alpha');
    expect(at(sortFlat(flat, { key: 'topic', dir: 'desc' }), 0).item.topic_name).toBe('Zeta');
  });

  it('sorts by chars and attempts', () => {
    expect(at(sortFlat(flat, { key: 'chars', dir: 'desc' }), 0).item.last_char_count).toBe(500);
    expect(at(sortFlat(flat, { key: 'attempts', dir: 'desc' }), 0).item.server_attempts).toBe(5);
  });

  it('does not mutate the input array', () => {
    const before = flat.map((f) => f.item.source_id);
    sortFlat(flat, { key: 'topic', dir: 'desc' });
    expect(flat.map((f) => f.item.source_id)).toEqual(before);
  });
});

describe('buildGroups', () => {
  const queue = emptyQueue();
  queue.level_1_quick = [item({ source_id: 's1', topic_id: 'topic-a', topic_name: 'Alpha' })];
  queue.level_2_scroll = [item({ source_id: 's2', topic_id: 'topic-b', topic_name: 'Beta' })];
  queue.level_3_user_gated = [item({ source_id: 's3', topic_id: 'topic-a', topic_name: 'Alpha' })];
  const flat = filterAndSort(flattenQueue(queue), EMPTY_FILTERS, { key: 'topic', dir: 'asc' });

  it('level mode collapses L1+L2 into Automated and keeps L3 separate', () => {
    const groups = buildGroups(flat, 'level');
    const automated = groups.find((g) => g.id === 'automated');
    expect(automated?.items).toHaveLength(2);
    expect(groups.find((g) => g.id === 'level_3_user_gated')?.items).toHaveLength(1);
    // empty sections are dropped
    expect(groups.find((g) => g.id === 'level_4_paste')).toBeUndefined();
  });

  it('project mode groups by topic across buckets', () => {
    const groups = buildGroups(flat, 'project');
    const alpha = groups.find((g) => g.id === 'topic-a');
    expect(alpha?.label).toBe('Alpha');
    expect(alpha?.items).toHaveLength(2); // s1 (L1) + s3 (L3)
    expect(groups.find((g) => g.id === 'topic-b')?.items).toHaveLength(1);
  });
});
