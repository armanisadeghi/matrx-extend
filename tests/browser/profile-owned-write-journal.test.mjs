import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createOwnedWriteJournal } from './profile-owned-write-journal.mjs';

const owned = {
  userId: 'db4a31ad-6b18-4d33-a296-593f1e7288c9',
  organizationId: 'edb9a817-d8c1-4d2c-8205-af047333fd60',
  marker: 'Profile first save 7d9bac55-ab5c-4bc2-a68a-b7032623e940',
  createdAt: '2026-10-03T22:52:00.123456+00:00',
};
function setup() {
  let row = {
    user_id: owned.userId,
    organization_id: owned.organizationId,
    preferred_name: owned.marker,
    created_at: owned.createdAt,
    version: 1,
  };
  const receipts = [];
  let unreadable = false;
  let persistFailure = false;
  const journal = createOwnedWriteJournal({
    owned,
    baseUrl: 'https://db.example.test',
    persist: async (record) => {
      if (persistFailure) throw new Error('disk_failure');
      receipts.push(structuredClone(record));
    },
    read: async () => {
      if (unreadable) throw new Error('transport_failure');
      return row;
    },
  });
  return {
    journal,
    receipts,
    write(value, changes = {}) {
      row = { ...row, preferred_name: value, version: row.version + 1, ...changes };
    },
    unreadable(value) {
      unreadable = value;
    },
    persistFailure(value) {
      persistFailure = value;
    },
  };
}
it('tracks each successful save even when the UI throws after writing, including restoration', async () => {
  const s = setup();
  for (const [value, version] of [
    ['Profile save 52c761f9', 2],
    [owned.marker, 3],
  ]) {
    await assert.rejects(
      s.journal.save(value, async () => {
        assert.deepEqual(s.receipts.at(-1).pending_write, { version, preferred_name: value });
        s.write(value);
        throw new Error('reopen_failed');
      }),
      /reopen_failed/,
    );
    assert.equal(s.receipts.at(-1).expected_version, version);
    assert.deepEqual(await s.journal.reconcile(), { owned: { ...owned, marker: value }, version });
    assert.equal(s.receipts.at(-1).expected_version, version);
    assert.equal(s.receipts.at(-1).pending_write, null);
  }
});
it('recovers only the exact intended successor after a lost transport', async () => {
  const s = setup();
  await assert.rejects(
    s.journal.save('Profile save 8462c5ab', async () => {
      s.write('Profile save 8462c5ab');
      s.unreadable(true);
      throw new Error('original_execution_failure');
    }),
    /original_execution_failure/,
  );
  assert.equal(s.receipts.at(-1).expected_version, 1);
  s.unreadable(false);
  assert.equal((await s.journal.reconcile()).version, 2);
});
it('does not save when the intent cannot be persisted', async () => {
  const s = setup();
  s.persistFailure(true);
  let writes = 0;
  await assert.rejects(
    s.journal.save('Profile save 2a575fbd', async () => {
      writes++;
    }),
    /disk_failure/,
  );
  assert.equal(writes, 0);
});
it('refuses an unresolved in-flight write instead of deleting its predecessor', async () => {
  const s = setup();
  await assert.rejects(
    s.journal.save('Profile save e2592fd8', async () => {
      throw new Error('click_transport_failed');
    }),
    /click_transport_failed/,
  );
  await assert.rejects(s.journal.reconcile(), /owned_delete_marker_changed/);
});
for (const [name, changes, message] of [
  ['version', { version: 3 }, 'concurrent_change'],
  ['value', { preferred_name: 'Concurrent preferred name' }, 'marker_changed'],
  ['creation', { created_at: '2026-10-03T22:53:00Z' }, 'row_replaced'],
  ['owner', { user_id: 'another-owner' }, 'owner_changed'],
  ['organization', { organization_id: 'another-org' }, 'organization_changed'],
]) {
  it(`refuses a concurrent ${name} change after a successful own write`, async () => {
    const s = setup();
    await assert.rejects(
      s.journal.save('Profile save c025395e', async () => {
        s.write('Profile save c025395e', changes);
      }),
      new RegExp(message),
    );
    await assert.rejects(s.journal.reconcile(), new RegExp(message));
    assert.equal(s.receipts.at(-1).expected_version, 1);
  });
}
it('retains the exact durable intent when verification persistence fails after a write', async () => {
  const s = setup();
  await assert.rejects(
    s.journal.save('Profile save 029c28a9', async () => {
      s.write('Profile save 029c28a9');
      s.persistFailure(true);
    }),
    /disk_failure/,
  );
  assert.equal(s.receipts.at(-1).expected_version, 1);
  assert.equal(s.receipts.at(-1).pending_write.version, 2);
  s.persistFailure(false);
  assert.equal((await s.journal.reconcile()).version, 2);
  assert.equal(s.receipts.at(-1).expected_version, 2);
  assert.equal(s.receipts.at(-1).pending_write, null);
});
it('accepts only the intended non-Preferred fields after a lost UI response', async () => {
  const s = setup();
  const fields = { company_name: 'Harbor Studio', job_title: 'Design Lead' };
  await assert.rejects(
    s.journal.save(
      owned.marker,
      async () => {
        assert.deepEqual(s.receipts.at(-1).pending_write.fields, fields);
        s.write(owned.marker, fields);
        throw new Error('ui_reopen_failed');
      },
      fields,
    ),
    /ui_reopen_failed/,
  );
  assert.equal((await s.journal.reconcile()).version, 2);
});
it('refuses deletion when another write takes the expected version without the intended fields', async () => {
  const s = setup();
  const fields = { company_name: 'Harbor Studio', job_title: 'Design Lead' };
  await assert.rejects(
    s.journal.save(
      owned.marker,
      async () => {
        s.write(owned.marker, { company_name: 'Unrelated company', job_title: 'Design Lead' });
      },
      fields,
    ),
    /owned_write_company_name_unexpected_successor/,
  );
  await assert.rejects(s.journal.reconcile(), /owned_write_company_name_unexpected_successor/);
  assert.equal(s.receipts.at(-1).expected_version, 1);
  assert.deepEqual(s.receipts.at(-1).pending_write.fields, fields);
});
