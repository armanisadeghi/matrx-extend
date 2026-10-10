import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDataPatternDeleteUrl,
  buildDataPatternLookupUrl,
  cleanupOwnedDataPattern,
  matchesSelectedMemberOrganization,
  parseDataPatternWriteBody,
  parseDataPatternWriteRequestBody,
  requireExpectedMemberOrganizationId,
  resolveDataPatternCleanupLookup,
  verifyDataPatternDeleteResult,
  verifyDataPatternLookupResult,
} from './data-member-pattern-cleanup.mjs';

const patternId = '123e4567-e89b-42d3-a456-426614174000';
const organizationId = '123e4567-e89b-42d3-a456-426614174001';
const otherOrganizationId = '123e4567-e89b-42d3-a456-426614174002';

test('member Data write must match independently verified organization UUID', () => {
  assert.equal(
    requireExpectedMemberOrganizationId({ organization_id: organizationId }),
    organizationId,
  );
  assert.equal(matchesSelectedMemberOrganization(organizationId, organizationId), true);
  assert.equal(matchesSelectedMemberOrganization(otherOrganizationId, organizationId), false);
  assert.throws(
    () => requireExpectedMemberOrganizationId({ organization_id: 'invalid' }),
    /data_member_expected_organization_missing/,
  );
});

test('cleanup URL scopes deletion and representation to the observed row and organization', () => {
  const url = new URL(
    buildDataPatternDeleteUrl('https://db.matrxserver.com', patternId, organizationId),
  );
  assert.equal(url.pathname, '/rest/v1/wbx_pattern');
  assert.equal(url.searchParams.get('id'), `eq.${patternId}`);
  assert.equal(url.searchParams.get('organization_id'), `eq.${organizationId}`);
  assert.equal(url.searchParams.get('select'), 'id,organization_id');
});

test('cleanup rejects a missing observed organization before issuing a request', () => {
  assert.throws(
    () => buildDataPatternDeleteUrl('https://db.matrxserver.com', patternId, ''),
    /data_member_cleanup_organization_missing/,
  );
});

test('cleanup accepts only one returned row matching both observed identifiers', () => {
  assert.deepEqual(
    verifyDataPatternDeleteResult({
      status: 200,
      rowCount: 1,
      rowIdMatches: true,
      organizationMatches: true,
    }),
    { verified: true, deleted_rows: 1 },
  );
  for (const result of [
    { status: 204, rowCount: 0, rowIdMatches: false, organizationMatches: false },
    { status: 200, rowCount: 0, rowIdMatches: false, organizationMatches: false },
    { status: 200, rowCount: 2, rowIdMatches: true, organizationMatches: true },
    { status: 200, rowCount: 1, rowIdMatches: false, organizationMatches: true },
    { status: 200, rowCount: 1, rowIdMatches: true, organizationMatches: false },
  ]) {
    assert.throws(() => verifyDataPatternDeleteResult(result));
  }
});

test('successful write body accepts a single object or one-row representation', () => {
  assert.deepEqual(parseDataPatternWriteBody(JSON.stringify({ id: patternId })), {
    patternId,
    capture: 'body_id_valid',
  });
  assert.deepEqual(parseDataPatternWriteBody(JSON.stringify([{ id: patternId }])), {
    patternId,
    capture: 'body_id_valid',
  });
  assert.deepEqual(parseDataPatternWriteBody('not-json'), {
    patternId: null,
    capture: 'body_non_json',
  });
  assert.deepEqual(parseDataPatternWriteBody('[]'), {
    patternId: null,
    capture: 'body_shape_invalid',
  });
});

test('member save request body carries the exact selected organization and owned name', () => {
  const name = 'Northline Furnishings catalog member 38009889306-1';
  assert.deepEqual(
    parseDataPatternWriteRequestBody(JSON.stringify({ organization_id: organizationId, name })),
    { organizationId, name, capture: 'request_body_valid' },
  );
  const wrong = parseDataPatternWriteRequestBody(
    JSON.stringify({ organization_id: otherOrganizationId, name }),
  );
  assert.equal(matchesSelectedMemberOrganization(wrong.organizationId, organizationId), false);
  assert.deepEqual(parseDataPatternWriteRequestBody('not-json'), {
    organizationId: null,
    name: null,
    capture: 'request_body_non_json',
  });
  assert.deepEqual(parseDataPatternWriteRequestBody('{}'), {
    organizationId: null,
    name: null,
    capture: 'request_body_shape_invalid',
  });
});

test('fallback lookup is scoped to exact owned name and observed organization', () => {
  const name = 'Northline Furnishings catalog member 38009054255-1';
  const url = new URL(
    buildDataPatternLookupUrl('https://db.matrxserver.com', name, organizationId),
  );
  assert.equal(url.pathname, '/rest/v1/wbx_pattern');
  assert.equal(url.searchParams.get('name'), `eq.${name}`);
  assert.equal(url.searchParams.get('organization_id'), `eq.${organizationId}`);
  assert.equal(url.searchParams.get('select'), 'id,organization_id,name');
  assert.equal(url.searchParams.get('limit'), '2');
  assert.deepEqual(
    verifyDataPatternLookupResult(
      { status: 200, rows: [{ id: patternId, organization_id: organizationId, name }] },
      name,
      organizationId,
    ),
    { patternId, organizationId },
  );
  for (const rows of [
    [],
    [{ id: patternId, organization_id: otherOrganizationId, name }],
    [{ id: patternId, organization_id: organizationId, name: 'wrong' }],
    [
      { id: patternId, organization_id: organizationId, name },
      { id: patternId, organization_id: organizationId, name },
    ],
  ]) {
    assert.throws(() => verifyDataPatternLookupResult({ status: 200, rows }, name, organizationId));
  }
});

test('cleanup fallback treats zero rows as a no-op and deletes only one exact owned match', () => {
  const name = 'Northline Furnishings catalog member 38013032792-2';
  assert.deepEqual(
    resolveDataPatternCleanupLookup({ status: 200, rows: [] }, name, organizationId),
    { kind: 'none' },
  );
  assert.throws(
    () =>
      resolveDataPatternCleanupLookup({ status: 200, rows: [] }, name, organizationId, {
        successfulWriteObserved: true,
      }),
    /data_member_cleanup_row_missing_after_successful_write/,
  );
  assert.deepEqual(
    resolveDataPatternCleanupLookup(
      { status: 200, rows: [{ id: patternId, organization_id: organizationId, name }] },
      name,
      organizationId,
      { successfulWriteObserved: true },
    ),
    { kind: 'delete', target: { patternId, organizationId } },
  );
  for (const result of [
    { status: 500, rows: [] },
    { status: 200, rows: null },
    {
      status: 200,
      rows: [
        { id: patternId, organization_id: organizationId, name },
        { id: '123e4567-e89b-42d3-a456-426614174003', organization_id: organizationId, name },
      ],
    },
    { status: 200, rows: [{ id: patternId, organization_id: otherOrganizationId, name }] },
    { status: 200, rows: [{ id: patternId, organization_id: organizationId, name: 'wrong' }] },
  ]) {
    assert.throws(() => resolveDataPatternCleanupLookup(result, name, organizationId));
  }
});

test('native cleanup orchestration scopes lookup and fails closed on a missing saved row', async () => {
  const name = 'Northline Furnishings catalog member 38013032792-3';
  const lookup = test.mock.fn(async () => ({ status: 200, rows: [] }));
  const remove = test.mock.fn(async () => ({ verified: true, deleted_rows: 1 }));

  assert.deepEqual(await cleanupOwnedDataPattern({ lookup, remove, name, organizationId }), {
    verified: true,
    deleted_rows: 0,
    exact_owned_name_organization_lookup: true,
  });
  assert.deepEqual(lookup.mock.calls[0].arguments, [name, organizationId]);
  assert.equal(remove.mock.callCount(), 0);
  await assert.rejects(
    cleanupOwnedDataPattern({
      lookup,
      remove,
      name,
      organizationId,
      successfulWriteObserved: true,
    }),
    /data_member_cleanup_row_missing_after_successful_write/,
  );
  assert.equal(remove.mock.callCount(), 0);

  const uniqueLookup = async () => ({
    status: 200,
    rows: [{ id: patternId, organization_id: organizationId, name }],
  });
  assert.deepEqual(
    await cleanupOwnedDataPattern({ lookup: uniqueLookup, remove, name, organizationId }),
    { verified: true, deleted_rows: 1, exact_owned_name_organization_lookup: true },
  );
  assert.deepEqual(remove.mock.calls[0].arguments, [{ patternId, organizationId }]);
  await assert.rejects(
    cleanupOwnedDataPattern({
      lookup: uniqueLookup,
      remove,
      name,
      organizationId,
      expectedPatternId: '123e4567-e89b-42d3-a456-426614174003',
    }),
    /data_member_cleanup_lookup_write_id_mismatch/,
  );
  assert.equal(remove.mock.callCount(), 1);

  const duplicateLookup = async () => ({
    status: 200,
    rows: [
      { id: patternId, organization_id: organizationId, name },
      { id: '123e4567-e89b-42d3-a456-426614174003', organization_id: organizationId, name },
    ],
  });
  await assert.rejects(
    cleanupOwnedDataPattern({ lookup: duplicateLookup, remove, name, organizationId }),
    /data_member_lookup_row_count_mismatch/,
  );
  assert.equal(remove.mock.callCount(), 1);
});
