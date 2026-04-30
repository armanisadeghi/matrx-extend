import { findFirstMatch, urlMatchesPattern } from '@/lib/data-pattern/matcher';
import type { ExtractionPattern } from '@/lib/supabase/queries';
import { describe, expect, it } from 'vitest';

const mkPattern = (overrides: Partial<ExtractionPattern>): ExtractionPattern => ({
  id: '00000000-0000-0000-0000-000000000000',
  user_id: '00000000-0000-0000-0000-000000000000',
  name: 'test',
  domain: 'example.com',
  route_pattern: null,
  list_root_selector: null,
  fields: [],
  kind: 'manual_css',
  config: {},
  target_user_table_id: null,
  last_used_at: null,
  last_run_at: null,
  last_status: null,
  last_run_count: null,
  created_at: '2026-01-01',
  ...overrides,
});

describe('urlMatchesPattern', () => {
  it('matches exact host with no route', () => {
    expect(urlMatchesPattern('https://example.com/foo', mkPattern({}))).toBe(true);
  });

  it('rejects different host', () => {
    expect(urlMatchesPattern('https://other.com/foo', mkPattern({}))).toBe(false);
  });

  it('matches glob route pattern', () => {
    const p = mkPattern({ route_pattern: '/blog/*' });
    expect(urlMatchesPattern('https://example.com/blog/abc', p)).toBe(true);
    expect(urlMatchesPattern('https://example.com/about', p)).toBe(false);
  });

  it('matches double-star (cross-segment)', () => {
    const p = mkPattern({ route_pattern: '/articles/**' });
    expect(urlMatchesPattern('https://example.com/articles/2026/jan/post', p)).toBe(true);
  });

  it('rejects malformed URLs', () => {
    expect(urlMatchesPattern('not a url', mkPattern({}))).toBe(false);
  });
});

describe('findFirstMatch', () => {
  it('returns null when no pattern matches', () => {
    expect(findFirstMatch('https://other.com', [mkPattern({})])).toBeNull();
  });
  it('returns the first matching pattern', () => {
    const a = mkPattern({ name: 'a', route_pattern: '/blog/**' });
    const b = mkPattern({ name: 'b', route_pattern: '/about' });
    const matched = findFirstMatch('https://example.com/about', [a, b]);
    expect(matched?.name).toBe('b');
  });
});
