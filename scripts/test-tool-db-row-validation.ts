import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDbToolRow } from './_tool-db-row-validation';

const recordsRow = {
  id: 'records-id',
  name: 'records',
  description: 'Records',
  parameters: {
    $envelope: 'args',
    $variants: { guide: { topic: { type: 'string' } } },
    action: { type: 'string', required: true },
    args: { type: 'object' },
  },
  tier: 'read',
  admin_only: false,
  is_active: true,
  category: 'records',
  source_kind: 'native',
};

test('accepts canonical registry metadata alongside validated tool parameters', () => {
  assert.equal(isDbToolRow(recordsRow), true);
});

test('rejects malformed ordinary parameters even when metadata is valid', () => {
  assert.equal(
    isDbToolRow({ ...recordsRow, parameters: { ...recordsRow.parameters, action: 'string' } }),
    false,
  );
});

test('rejects malformed envelope and unknown metadata', () => {
  assert.equal(
    isDbToolRow({ ...recordsRow, parameters: { ...recordsRow.parameters, $envelope: 42 } }),
    false,
  );
  assert.equal(
    isDbToolRow({ ...recordsRow, parameters: { ...recordsRow.parameters, $unexpected: true } }),
    false,
  );
});
