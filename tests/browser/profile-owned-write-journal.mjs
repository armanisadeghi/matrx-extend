import assert from 'node:assert/strict';
import { ownedDeleteUrl } from './profile-empty-row-restoration.mjs';
import { createVersionedProfileWriteJournal } from './profile-versioned-write-journal.mjs';

// A new row's marker and insert version alone establish conditional delete authority.
export function createOwnedWriteJournal({ owned, persist, read, baseUrl }) {
  return createVersionedProfileWriteJournal({
    initialVersion: 1,
    initialFields: { preferred_name: owned.marker },
    read,
    persist,
    validate(row, fields, version) {
      ownedDeleteUrl(baseUrl, { ...owned, marker: fields.preferred_name }, row, version);
      for (const [field, expected] of Object.entries(fields))
        assert.equal(row[field], expected, `owned_write_${field}_unexpected_successor`);
    },
    record({ version, fields, pending }) {
      return {
        user_id: owned.userId,
        organization_id: owned.organizationId,
        marker: owned.marker,
        created_at: owned.createdAt,
        expected_version: version,
        current_preferred_name: fields.preferred_name,
        pending_write: pending
          ? {
              version: pending.version,
              preferred_name: pending.fields.preferred_name,
              ...(Object.keys(pending.fields).length > 1 && {
                fields: Object.fromEntries(
                  Object.entries(pending.fields).filter(([key]) => key !== 'preferred_name'),
                ),
              }),
            }
          : null,
        state: pending ? 'owned_write_intent' : 'owned_write_verified',
      };
    },
    result({ version, fields }) {
      return { owned: { ...owned, marker: fields.preferred_name }, version };
    },
  });
}
