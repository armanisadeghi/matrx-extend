import assert from 'node:assert/strict';

export function requireExpectedMemberOrganizationId(secret) {
  const id = secret?.organization_id;
  assert.match(id ?? '', UUID, 'data_member_expected_organization_missing');
  return id;
}

export function matchesSelectedMemberOrganization(observedId, expectedId) {
  assert.match(expectedId ?? '', UUID, 'data_member_expected_organization_missing');
  return UUID.test(observedId ?? '') && observedId === expectedId;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function buildDataPatternDeleteUrl(origin, patternId, organizationId) {
  assert.match(patternId ?? '', UUID, 'data_member_cleanup_pattern_id_missing');
  assert.match(organizationId ?? '', UUID, 'data_member_cleanup_organization_missing');
  const url = new URL('/rest/v1/wbx_pattern', origin);
  url.searchParams.set('id', `eq.${patternId}`);
  url.searchParams.set('organization_id', `eq.${organizationId}`);
  url.searchParams.set('select', 'id,organization_id');
  return url.toString();
}

export function verifyDataPatternDeleteResult(result) {
  assert.equal(result?.status, 200, 'data_member_cleanup_http_failed');
  assert.equal(result?.rowCount, 1, 'data_member_cleanup_row_count_mismatch');
  assert.equal(result?.rowIdMatches, true, 'data_member_cleanup_row_id_mismatch');
  assert.equal(result?.organizationMatches, true, 'data_member_cleanup_organization_mismatch');
  return { verified: true, deleted_rows: 1 };
}
