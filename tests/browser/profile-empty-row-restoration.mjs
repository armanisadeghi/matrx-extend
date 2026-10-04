import assert from 'node:assert/strict';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertFirstSaveIdentity({
  mode,
  identity,
  stored,
  selectedOrg,
  memberAuthentication,
}) {
  assert.ok(mode === 'admin' || mode === 'member', 'first_save_mode_unverified');
  assert.match(identity?.userId ?? '', UUID, 'first_save_first_party_identity_unverified');
  assert.equal(stored?.profileId, identity.userId, 'first_save_identity_mismatch');
  assert.equal(stored?.accessTokenPresent, true, 'first_save_token_missing');
  assert.equal(stored?.isAdmin, mode === 'admin', 'first_save_role_mismatch');
  assert.match(stored?.organizationId ?? '', UUID, 'first_save_device_organization_unverified');
  if (mode === 'admin') {
    assert.equal(identity.email, 'admin@admin.com', 'first_save_designated_admin_unverified');
    assert.ok(
      typeof selectedOrg === 'string' && selectedOrg && selectedOrg === stored.organizationName,
      'first_save_organization_mismatch',
    );
  } else {
    assert.equal(
      memberAuthentication?.first_party_identity_verified,
      true,
      'first_save_member_unverified',
    );
    assert.equal(
      memberAuthentication?.canonical_nonadmin_check?.returned_rows,
      0,
      'first_save_member_role_unverified',
    );
    assert.equal(selectedOrg, true, 'first_save_organization_mismatch');
  }
}

export function assertFirstSaveOwnedRow(row, { userId, organizationId, marker }) {
  assert.ok(row && typeof row === 'object', 'first_save_row_missing');
  assert.match(userId, UUID, 'first_save_owner_invalid');
  assert.match(organizationId, UUID, 'first_save_organization_invalid');
  assert.ok(/^Profile first save [0-9a-f-]{36}$/.test(marker), 'first_save_marker_invalid');
  assert.equal(row.user_id, userId, 'first_save_owner_mismatch');
  assert.equal(row.organization_id, organizationId, 'first_save_organization_mismatch');
  assert.equal(row.preferred_name, marker, 'first_save_marker_mismatch');
  assert.equal(row.version, 1, 'first_save_was_not_an_insert');
  assert.ok(
    typeof row.created_at === 'string' && !Number.isNaN(Date.parse(row.created_at)),
    'first_save_created_at_missing',
  );
  return { userId, organizationId, marker, createdAt: row.created_at };
}

export function ownedDeleteUrl(baseUrl, owned, row, expectedVersion) {
  assert.ok(owned && row && typeof row === 'object', 'owned_delete_row_missing');
  assert.ok(
    Number.isSafeInteger(expectedVersion) && expectedVersion >= 1,
    'owned_delete_version_invalid',
  );
  assert.equal(row.user_id, owned.userId, 'owned_delete_owner_changed');
  assert.equal(row.organization_id, owned.organizationId, 'owned_delete_organization_changed');
  assert.equal(row.preferred_name, owned.marker, 'owned_delete_marker_changed');
  assert.equal(row.created_at, owned.createdAt, 'owned_delete_row_replaced');
  assert.equal(row.version, expectedVersion, 'owned_delete_concurrent_change');

  const url = new URL('/rest/v1/user_form_profile', baseUrl);
  url.searchParams.set('select', 'user_id');
  url.searchParams.set('user_id', `eq.${owned.userId}`);
  url.searchParams.set('organization_id', `eq.${owned.organizationId}`);
  url.searchParams.set('preferred_name', `eq.${owned.marker}`);
  url.searchParams.set('created_at', `eq.${owned.createdAt}`);
  url.searchParams.set('version', `eq.${expectedVersion}`);
  return url.href;
}
