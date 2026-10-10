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
const OWNED_NAME = /^Northline Furnishings catalog member [1-9][0-9]*-[1-9][0-9]*$/;

export function parseDataPatternWriteRequestBody(body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { organizationId: null, name: null, capture: 'request_body_non_json' };
  }
  const row = Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : parsed;
  if (!row || !UUID.test(row.organization_id ?? '') || !OWNED_NAME.test(row.name ?? ''))
    return { organizationId: null, name: null, capture: 'request_body_shape_invalid' };
  return { organizationId: row.organization_id, name: row.name, capture: 'request_body_valid' };
}

export function parseDataPatternWriteBody(body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { patternId: null, capture: 'body_non_json' };
  }
  const row = Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : parsed;
  if (!row || !UUID.test(row.id ?? '')) return { patternId: null, capture: 'body_shape_invalid' };
  return { patternId: row.id, capture: 'body_id_valid' };
}

export function buildDataPatternLookupUrl(origin, name, organizationId) {
  assert.match(name ?? '', OWNED_NAME, 'data_member_lookup_name_unowned');
  assert.match(organizationId ?? '', UUID, 'data_member_lookup_organization_missing');
  const url = new URL('/rest/v1/wbx_pattern', origin);
  url.searchParams.set('name', `eq.${name}`);
  url.searchParams.set('organization_id', `eq.${organizationId}`);
  url.searchParams.set('select', 'id,organization_id,name');
  url.searchParams.set('limit', '2');
  return url.toString();
}

export function verifyDataPatternLookupResult(result, name, organizationId) {
  assert.equal(result?.status, 200, 'data_member_lookup_http_failed');
  assert.equal(result?.rows?.length, 1, 'data_member_lookup_row_count_mismatch');
  const row = result.rows[0];
  assert.match(row?.id ?? '', UUID, 'data_member_lookup_row_id_missing');
  assert.equal(row.organization_id, organizationId, 'data_member_lookup_organization_mismatch');
  assert.equal(row.name, name, 'data_member_lookup_name_mismatch');
  return { patternId: row.id, organizationId };
}

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
