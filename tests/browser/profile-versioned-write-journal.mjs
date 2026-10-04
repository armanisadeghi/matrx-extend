import assert from 'node:assert/strict';

// Shared intent/verification protocol. The caller supplies row authority;
// this primitive grants neither deletion nor restoration authority.
export function createVersionedProfileWriteJournal({
  initialVersion,
  initialFields,
  read,
  persist,
  validate,
  record,
  result,
}) {
  let version = initialVersion;
  let fields = { ...initialFields };
  let pending = null;
  const receipt = () => record({ version, fields, pending });
  async function reconcile() {
    const row = await read();
    if (pending) {
      const next = { ...fields, ...pending.fields };
      validate(row, next, pending.version);
      await persist(record({ version: pending.version, fields: next, pending: null }));
      version = pending.version;
      fields = next;
      pending = null;
    } else {
      validate(row, fields, version);
    }
    return result({ version, fields, row });
  }
  return {
    reconcile,
    async save(value, action, changedFields = {}) {
      await reconcile();
      pending = { version: version + 1, fields: { ...changedFields, preferred_name: value } };
      try {
        await persist(receipt());
      } catch (error) {
        pending = null;
        throw error;
      }
      let actionError;
      try {
        await action();
      } catch (error) {
        actionError = error;
      }
      try {
        await reconcile();
      } catch (error) {
        if (!actionError) throw error;
      }
      if (actionError) throw actionError;
      assert.equal(pending, null, 'profile_write_unverified');
    },
  };
}
