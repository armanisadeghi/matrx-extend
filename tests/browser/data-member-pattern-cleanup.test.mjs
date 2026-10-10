import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDataPatternDeleteUrl,
  matchesSelectedMemberOrganization,
  requireExpectedMemberOrganizationId,
  verifyDataPatternDeleteResult,
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
