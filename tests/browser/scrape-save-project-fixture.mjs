import assert from 'node:assert/strict';

export function projectFixtureRequest(fixture, method = 'GET') {
  const { id, organizationId, ownerId, name } = fixture;
  assert.match(id, /^[0-9a-f-]{36}$/i);
  assert.match(organizationId, /^[0-9a-f-]{36}$/i);
  assert.match(ownerId, /^[0-9a-f-]{36}$/i);
  const filters = {
    id: `eq.${id}`,
    ...(method === 'PATCH'
      ? {
          organization_id: `eq.${organizationId}`,
          created_by: `eq.${ownerId}`,
          name: `eq.${name}`,
        }
      : {}),
    deleted_at: 'is.null',
    select: 'id,organization_id,created_by,name,deleted_at',
  };
  return {
    filters,
    organizationId,
    method,
    ...(method === 'POST'
      ? { body: { id, organization_id: organizationId, name, visibility: 'internal' } }
      : {}),
    ...(method === 'PATCH' ? { body: { deleted_at: new Date().toISOString() } } : {}),
  };
}

export async function cleanupProjectFixture(fixture, request) {
  const before = await request(projectFixtureRequest(fixture));
  assert.equal(before.status, 200, 'scrape_save_project_cleanup_lookup_failed');
  assert.ok(Array.isArray(before.rows), 'scrape_save_project_cleanup_body_invalid');
  assert.ok(before.rows.length <= 1, 'scrape_save_project_cleanup_ambiguous');
  if (before.rows.length) {
    const row = before.rows[0];
    assert.equal(row.id, fixture.id, 'scrape_save_project_cleanup_id_mismatch');
    assert.equal(
      row.organization_id,
      fixture.organizationId,
      'scrape_save_project_cleanup_org_mismatch',
    );
    assert.equal(row.created_by, fixture.ownerId, 'scrape_save_project_cleanup_owner_mismatch');
    assert.equal(row.name, fixture.name, 'scrape_save_project_cleanup_name_mismatch');
    const deleted = await request(projectFixtureRequest(fixture, 'PATCH'));
    assert.ok([204, 205].includes(deleted.status), 'scrape_save_project_cleanup_delete_failed');
  }
  const after = await request(projectFixtureRequest(fixture));
  assert.equal(after.status, 200, 'scrape_save_project_cleanup_verify_failed');
  assert.deepEqual(after.rows, [], 'scrape_save_project_cleanup_residue');
  return { verified: true, owned_project_absent: true };
}
