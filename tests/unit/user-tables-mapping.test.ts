/**
 * Audit P0-3 regression tests: schema inference and append-time key mapping
 * must produce IDENTICAL field names for the same input, including collision
 * suffixes — otherwise rows silently lose columns or overwrite each other.
 */

import {
  buildFieldNameMap,
  inferDataType,
  inferSchemaFromRows,
  toSnakeCaseFieldName,
  unionRowKeys,
} from '@/lib/supabase/user-tables';
import { describe, expect, it } from 'vitest';

describe('unionRowKeys', () => {
  it('collects keys across all rows in first-seen order', () => {
    const rows = [{ a: 1, b: 2 }, { b: 3, c: 4 }, { d: 5 }];
    expect(unionRowKeys(rows)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('returns [] for no rows', () => {
    expect(unionRowKeys([])).toEqual([]);
  });
});

describe('buildFieldNameMap', () => {
  it('assigns collision suffixes deterministically by first-seen order', () => {
    const map = buildFieldNameMap(['Name', 'name', 'NAME']);
    expect(map.get('Name')).toBe('name');
    expect(map.get('name')).toBe('name_2');
    expect(map.get('NAME')).toBe('name_3');
  });

  it('does not collide with an explicit _2 key', () => {
    const map = buildFieldNameMap(['name', 'name_2', 'Name']);
    expect(map.get('name')).toBe('name');
    expect(map.get('name_2')).toBe('name_2');
    expect(map.get('Name')).not.toBe('name');
    expect(map.get('Name')).not.toBe('name_2');
  });

  it('is idempotent for duplicate raw keys', () => {
    const map = buildFieldNameMap(['a', 'a', 'b']);
    expect(map.size).toBe(2);
  });
});

describe('create/append mapping consistency (the P0-3 bug)', () => {
  it('append mapping matches the schema created from the same rows', () => {
    const rows = [
      { Name: 'Alice', name: 'lowercase', price: 10 },
      { Name: 'Bob', 'Price (USD)': 12, extra: true },
    ];
    const schema = inferSchemaFromRows(rows);
    const schemaNames = new Set(schema.map((f) => f.field_name));
    // Every mapped append key must land on a column the schema declared.
    const appendMap = buildFieldNameMap(unionRowKeys(rows));
    for (const field of appendMap.values()) {
      expect(schemaNames.has(field)).toBe(true);
    }
    // And the union means later-row-only keys ARE columns.
    expect(schemaNames.has('extra')).toBe(true);
    expect(schemaNames.has('price_usd')).toBe(true);
  });

  it('colliding keys keep distinct columns instead of overwriting', () => {
    const rows = [{ Name: 'a', name: 'b' }];
    const map = buildFieldNameMap(unionRowKeys(rows));
    const mapped = new Set(map.values());
    expect(mapped.size).toBe(2);
  });
});

describe('inferSchemaFromRows', () => {
  it('types each column from the first non-null value across rows', () => {
    const rows = [
      { count: null, when: '2026-01-02' },
      { count: 7, when: '2026-01-03' },
    ];
    const schema = inferSchemaFromRows(rows);
    expect(schema.find((f) => f.field_name === 'count')?.data_type).toBe('integer');
    expect(schema.find((f) => f.field_name === 'when')?.data_type).toBe('date');
  });

  it('preserves display_name as the raw key', () => {
    const schema = inferSchemaFromRows([{ 'Price (USD)': 5 }]);
    expect(schema[0]).toMatchObject({
      field_name: 'price_usd',
      display_name: 'Price (USD)',
      data_type: 'integer',
    });
  });
});

describe('toSnakeCaseFieldName edge cases', () => {
  it.each([
    ['@type', 'type'],
    ['First Name', 'first_name'],
    ['123 Items', 'f_123_items'],
    ['', 'field'],
    ['émoji 🎉 key', expect.stringMatching(/^[a-z][a-z0-9_]*$/) as unknown as string],
  ])('%s → %s', (raw, expected) => {
    if (typeof expected === 'string') {
      expect(toSnakeCaseFieldName(raw)).toBe(expected);
    } else {
      expect(toSnakeCaseFieldName(raw)).toEqual(expected);
    }
  });
});

describe('inferDataType', () => {
  it.each([
    ['2026-01-02', 'date'],
    ['2026-01-02T10:30:00Z', 'datetime'],
    ['hello world', 'string'],
    [42, 'integer'],
    [4.2, 'number'],
    [true, 'boolean'],
    [[1, 2], 'array'],
    [{ a: 1 }, 'json'],
    [null, 'string'],
  ])('%s → %s', (value, expected) => {
    expect(inferDataType(value)).toBe(expected);
  });
});
