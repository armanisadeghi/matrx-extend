import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertFirstSaveOwnedRow, ownedDeleteUrl } from './profile-empty-row-restoration.mjs';

const userId = 'db4a31ad-6b18-4d33-a296-593f1e7288c9';
const organizationId = 'edb9a817-d8c1-4d2c-8205-af047333fd60';
const marker = 'Profile first save 7d9bac55-ab5c-4bc2-a68a-b7032623e940';
const createdAt = '2026-10-03T22:52:00.123456+00:00';
const firstRow = {
  user_id: userId,
  organization_id: organizationId,
  preferred_name: marker,
  created_at: createdAt,
  version: 1,
};

describe('Profile absent-row cleanup guard', () => {
  it('accepts only a verified first insert and binds DELETE to owner, organization, marker, creation, and exact version', () => {
    const owned = assertFirstSaveOwnedRow(firstRow, { userId, organizationId, marker });
    const url = new URL(
      ownedDeleteUrl('https://db.example.test', owned, { ...firstRow, version: 5 }, 5),
    );
    assert.equal(url.pathname, '/rest/v1/user_form_profile');
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      select: 'user_id',
      user_id: `eq.${userId}`,
      organization_id: `eq.${organizationId}`,
      preferred_name: `eq.${marker}`,
      created_at: `eq.${createdAt}`,
      version: 'eq.5',
    });
  });

  it('refuses a pre-existing or concurrently changed row', () => {
    assert.throws(
      () =>
        assertFirstSaveOwnedRow({ ...firstRow, version: 2 }, { userId, organizationId, marker }),
      /first_save_was_not_an_insert/,
    );
    const owned = assertFirstSaveOwnedRow(firstRow, { userId, organizationId, marker });
    assert.throws(
      () =>
        ownedDeleteUrl(
          'https://db.example.test',
          owned,
          { ...firstRow, user_id: '45ca31d1-20c0-427a-965d-c891ae334c94', version: 5 },
          5,
        ),
      /owned_delete_owner_changed/,
    );
    assert.throws(
      () =>
        ownedDeleteUrl(
          'https://db.example.test',
          owned,
          { ...firstRow, organization_id: 'f69aa237-3fc3-4808-90d4-a83f37a5777f', version: 5 },
          5,
        ),
      /owned_delete_organization_changed/,
    );
    assert.throws(
      () => ownedDeleteUrl('https://db.example.test', owned, { ...firstRow, version: 6 }, 5),
      /owned_delete_concurrent_change/,
    );
    assert.throws(
      () =>
        ownedDeleteUrl(
          'https://db.example.test',
          owned,
          { ...firstRow, preferred_name: 'Another writer', version: 5 },
          5,
        ),
      /owned_delete_marker_changed/,
    );
    assert.throws(
      () =>
        ownedDeleteUrl(
          'https://db.example.test',
          owned,
          { ...firstRow, created_at: '2026-10-03T22:53:00Z', version: 5 },
          5,
        ),
      /owned_delete_row_replaced/,
    );
  });
});
