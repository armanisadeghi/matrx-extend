import assert from 'node:assert/strict';
import { ownedDeleteUrl } from './profile-empty-row-restoration.mjs';

// The receipt is persisted BEFORE a UI save. Only its exact single successor may
// advance ownership; a transport failure never licenses adopting the current row.
export function createOwnedWriteJournal({ owned, persist, read, baseUrl }) {
  let version = 1;
  let preferred = owned.marker;
  let pending = null;
  const record = () => ({
    user_id: owned.userId,
    organization_id: owned.organizationId,
    marker: owned.marker,
    created_at: owned.createdAt,
    expected_version: version,
    current_preferred_name: preferred,
    pending_write: pending,
    state: pending ? 'owned_write_intent' : 'owned_write_verified',
  });
  const validate = (row, value, expectedVersion) =>
    ownedDeleteUrl(baseUrl, { ...owned, marker: value }, row, expectedVersion);
  async function reconcile() {
    const row = await read();
    if (pending) {
      // A previous version could still have an in-flight UI write. Never delete
      // it or issue a second Save until this exact intent has been observed.
      validate(row, pending.preferred_name, pending.version);
      await persist({
        ...record(),
        expected_version: pending.version,
        current_preferred_name: pending.preferred_name,
        pending_write: null,
        state: 'owned_write_verified',
      });
      version = pending.version;
      preferred = pending.preferred_name;
      pending = null;
    } else {
      validate(row, preferred, version);
    }
    return { owned: { ...owned, marker: preferred }, version };
  }
  return {
    reconcile,
    async save(value, action) {
      await reconcile();
      pending = { version: version + 1, preferred_name: value };
      await persist(record());
      let actionError;
      try {
        await action();
      } catch (error) {
        actionError = error;
      }
      try {
        await reconcile();
      } catch (error) {
        // The durable pending intent remains useful if the transport recovers.
        if (!actionError) throw error;
      }
      if (actionError) throw actionError;
      assert.equal(pending, null, 'owned_write_unverified');
    },
  };
}
