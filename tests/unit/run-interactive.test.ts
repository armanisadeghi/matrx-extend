/**
 * Pure-helper tests for the interactive saved-pattern runners (audit X1/X2).
 */

import { describe, expect, it } from 'vitest';
import {
  matchesUrlFilter,
  parseAgentResponse,
  rowsFromBody,
} from '@/lib/data-pattern/run-interactive';

describe('matchesUrlFilter', () => {
  it('substring-matches plain filters', () => {
    expect(matchesUrlFilter('https://api.site.com/v1/items?page=2', 'api.site.com/v1')).toBe(true);
    expect(matchesUrlFilter('https://api.site.com/v1/items', 'other.com')).toBe(false);
  });

  it('glob-matches filters containing *', () => {
    expect(matchesUrlFilter('https://api.site.com/v1/items/42', 'api.site.com/v1/items/*')).toBe(
      true,
    );
    expect(matchesUrlFilter('https://api.site.com/v1/users/42', 'api.site.com/v1/items/*')).toBe(
      false,
    );
  });

  it('escapes regex metacharacters in the non-glob parts', () => {
    expect(matchesUrlFilter('https://a.com/x?y=1', 'a.com/x?y=*')).toBe(true);
  });

  it('empty filter matches everything', () => {
    expect(matchesUrlFilter('https://anything', '  ')).toBe(true);
  });
});

describe('rowsFromBody', () => {
  it('walks dotted key paths including numeric array indices', () => {
    const body = JSON.stringify({ data: { pages: [{ items: [{ id: 1 }, { id: 2 }] }] } });
    expect(rowsFromBody(body, 'data.pages.0.items')).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('wraps a single object into one row', () => {
    expect(rowsFromBody(JSON.stringify({ a: 1 }), '')).toEqual([{ a: 1 }]);
  });

  it('wraps primitive array entries as {value}', () => {
    expect(rowsFromBody(JSON.stringify({ tags: ['x', 'y'] }), 'tags')).toEqual([
      { value: 'x' },
      { value: 'y' },
    ]);
  });

  it('throws a friendly error for non-JSON bodies', () => {
    expect(() => rowsFromBody('<html>', '')).toThrow(/not JSON/);
  });

  it('throws a friendly error when the key path dead-ends', () => {
    expect(() => rowsFromBody(JSON.stringify({ a: 1 }), 'missing.path')).toThrow(
      /Nothing found at key path/,
    );
  });
});

describe('parseAgentResponse', () => {
  it('parses a bare JSON array', () => {
    expect(parseAgentResponse('[{"a":1}]').rows).toEqual([{ a: 1 }]);
  });

  it('parses an envelope with rows/notes/confidence', () => {
    const out = parseAgentResponse(
      JSON.stringify({ rows: [{ a: 1 }], notes: 'hi', confidence: 'high' }),
    );
    expect(out.rows).toEqual([{ a: 1 }]);
    expect(out.notes).toBe('hi');
    expect(out.confidence).toBe('high');
  });

  it('strips code fences and wrapping prose', () => {
    const raw = 'Here you go:\n```json\n{"rows":[{"a":1}]}\n```';
    expect(parseAgentResponse(raw).rows).toEqual([{ a: 1 }]);
  });

  it('throws on empty and non-JSON responses', () => {
    expect(() => parseAgentResponse('   ')).toThrow(/empty/);
    expect(() => parseAgentResponse('no json here')).toThrow();
  });
});
