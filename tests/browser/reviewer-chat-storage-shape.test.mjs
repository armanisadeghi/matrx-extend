import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { storageShapeExpression, storedSessionSummary } from './reviewer-chat-storage-shape.mjs';

const selected = {
  'matrx.auth.accessToken': 'opaque-token-handle',
  'matrx.user.profile': { id: 'member-handle' },
  'matrx.org.active': { id: 'organization-handle', name: 'Matrx Review' },
};

function selectionContract(summarize) {
  assert.equal(summarize(selected).activeOrganizationPresent, true, 'persisted object selection');
  for (const invalid of [
    undefined,
    null,
    '',
    'organization-handle',
    {},
    { id: '' },
    { id: ' ' },
    { id: 7 },
  ]) {
    assert.equal(
      summarize({ ...selected, 'matrx.org.active': invalid }).activeOrganizationPresent,
      false,
      'missing or malformed selection',
    );
  }
}

test('member storage summary recognizes only a persisted selected organization object', () => {
  selectionContract(storedSessionSummary);
});

test('browser storage expression reads the selected object and exposes only summary fields', async () => {
  const result = await runInNewContext(storageShapeExpression(), {
    chrome: { storage: { local: { get: async () => selected } } },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    accessTokenPresent: true,
    profilePresent: true,
    activeOrganizationPresent: true,
  });
});

test('storage guard kills constant and string-only diagnostic mutations', () => {
  for (const body of [
    '() => ({ activeOrganizationPresent: true })',
    '() => ({ activeOrganizationPresent: false })',
    storedSessionSummary
      .toString()
      .replace(
        "typeof stored['matrx.org.active']?.id === 'string' &&\n      stored['matrx.org.active'].id.trim().length > 0",
        "typeof stored['matrx.org.active'] === 'string'",
      ),
  ]) {
    const mutant = runInNewContext(`(${body})`);
    assert.throws(() => selectionContract(mutant), { code: 'ERR_ASSERTION' });
  }
});
