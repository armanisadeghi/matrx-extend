import assert from 'node:assert/strict';
import { createVersionedProfileWriteJournal } from './profile-versioned-write-journal.mjs';

export const PROFILE_TESTED_COLUMNS = [
  'legal_first_name',
  'legal_middle_name',
  'legal_last_name',
  'preferred_name',
  'name_suffix',
  'pronouns',
  'date_of_birth',
  'company_name',
  'job_title',
];

export function existingProfilePatchUrl(baseUrl, original, current) {
  assert.equal(current.user_id, original.user_id, 'profile_restore_owner_changed');
  assert.equal(
    current.organization_id,
    original.organization_id,
    'profile_restore_organization_changed',
  );
  assert.equal(current.created_at, original.created_at, 'profile_restore_row_replaced');
  assert.ok(
    Number.isSafeInteger(current.version) && current.version >= 1,
    'profile_restore_version_invalid',
  );
  const url = new URL('/rest/v1/user_form_profile', baseUrl);
  url.searchParams.set('select', 'user_id,version');
  for (const key of ['user_id', 'organization_id', 'created_at', 'version'])
    url.searchParams.set(key, `eq.${current[key]}`);
  for (const key of PROFILE_TESTED_COLUMNS)
    url.searchParams.set(key, current[key] === null ? 'is.null' : `eq.${current[key]}`);
  return url.href;
}

export async function createExistingProfileWriteJournal({
  original,
  baseUrl,
  read,
  persist,
  patch,
}) {
  assert.ok(original && typeof original === 'object', 'profile_existing_row_missing');
  assert.ok(
    Number.isSafeInteger(original.version) && original.version >= 1,
    'profile_existing_version_invalid',
  );
  assert.ok(
    original.user_id && original.organization_id && original.created_at,
    'profile_existing_identity_missing',
  );
  const baseline = Object.fromEntries(
    PROFILE_TESTED_COLUMNS.map((key) => {
      assert.ok(Object.hasOwn(original, key), `profile_existing_${key}_missing`);
      return [key, original[key]];
    }),
  );
  const identity = {
    user_id: original.user_id,
    organization_id: original.organization_id,
    created_at: original.created_at,
  };
  const record = ({ version, fields, pending }) => ({
    original_row_absent: false,
    ...identity,
    original_fields: baseline,
    expected_version: version,
    current_fields: fields,
    pending_write: pending,
    state: pending ? 'existing_write_intent' : 'existing_write_verified',
  });
  // Persist the sensitive baseline before any UI write can begin.
  await persist(record({ version: original.version, fields: baseline, pending: null }));
  const journal = createVersionedProfileWriteJournal({
    initialVersion: original.version,
    initialFields: baseline,
    read,
    persist,
    record,
    validate(row, fields, version) {
      assert.ok(row, 'profile_existing_row_missing');
      for (const key of Object.keys(identity))
        assert.equal(row[key], identity[key], `profile_existing_${key}_changed`);
      assert.equal(row.version, version, 'profile_existing_concurrent_change');
      for (const key of PROFILE_TESTED_COLUMNS)
        assert.equal(row[key], fields[key], `profile_existing_${key}_unexpected_successor`);
    },
    result({ version, fields, row }) {
      return { version, fields, row };
    },
  });
  await journal.reconcile();
  return {
    reconcile: journal.reconcile,
    // Text inputs represent an empty field as ''; ProfileView persists it as null.
    save: (value, action, fields = {}) => journal.save(value === '' ? null : value, action, fields),
    async restore() {
      const before = await journal.reconcile();
      if (PROFILE_TESTED_COLUMNS.every((key) => before.fields[key] === baseline[key])) return;
      await journal.save(
        baseline.preferred_name,
        async () => {
          const url = existingProfilePatchUrl(baseUrl, original, before.row);
          const rows = await patch(url, baseline);
          assert.equal(rows.length, 1, 'profile_restore_conditional_patch_missed');
          assert.equal(rows[0].user_id, identity.user_id, 'profile_restore_wrong_owner');
        },
        baseline,
      );
      const after = await journal.reconcile();
      for (const key of PROFILE_TESTED_COLUMNS)
        assert.equal(after.fields[key], baseline[key], `profile_restore_${key}_mismatch`);
    },
  };
}
