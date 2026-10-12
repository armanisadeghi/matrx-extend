import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createNotesFindLedger,
  planNotesFindHome,
  recordNotesFindCreated,
  recordNotesFindDeleted,
  recordNotesFindHomeArchived,
  recordNotesFindHomeAssigned,
  recordNotesFindHomeCreated,
  recordNotesFindInsertBeforeValidation,
  requireNotesFindHomeWrite,
  validateNotesFindLedger,
  writeNotesFindLedger,
} from './notes-find-fixture.mjs';

const ids = [
  '59f39144-1a73-46ac-8c06-aa1311c707f9',
  'a27fbfa6-683a-4d9d-b36e-f79e8e8b1557',
  'c2cd8a01-ae9a-4df5-a06e-8ba430850e89',
];
const homes = [
  'b47fc412-46fb-43e5-a496-8ff73d85cc80',
  '52c40999-6f82-4c96-bfa7-f7b462316d77',
  'd2cb6957-11e9-4abc-9bb5-a8cc66d6edb7',
];
const fourthHome = '764b59d8-0296-46be-bb68-32448d00ae70';

function ledger() {
  let value = createNotesFindLedger({
    runId: 'notes-t02-20261011',
    organizationId: '4b190b81-7ea2-40e1-8d6d-87fa4b520dfc',
    role: 'member',
    sourceSha: 'a'.repeat(40),
    treeSha256: 'b'.repeat(64),
  });
  for (let i = 0; i < 3; i++) {
    value = recordNotesFindCreated(value, {
      noteId: ids[i],
      title: `T02 ${i + 1} notes-t02-20261011`,
      homeScopeId: homes[i],
    });
  }
  return value;
}

test('T02 recovery ledger records exactly three synthetic, scoped note fixtures without bodies', () => {
  const value = ledger();
  assert.equal(validateNotesFindLedger(value), value);
  assert.equal(value.fixtures.length, 3);
  assert.ok(value.fixtures.every((item) => !('content' in item)));
});

test('T02 ledger refuses foreign or duplicate IDs and only closes after all three real deletes', () => {
  const value = ledger();
  assert.throws(
    () => recordNotesFindDeleted(value, 'e25a8c80-2f47-4a5f-b696-5bf39112110f'),
    /notes_find_cleanup_foreign_id/,
  );
  recordNotesFindDeleted(value, ids[0]);
  assert.equal(value.status, 'creating');
  assert.throws(() => recordNotesFindDeleted(value, ids[0]), /notes_find_cleanup_duplicate/);
  recordNotesFindDeleted(value, ids[1]);
  assert.equal(value.status, 'creating');
  recordNotesFindDeleted(value, ids[2]);
  assert.equal(validateNotesFindLedger(value).status, 'deleted_confirmed');
  const incomplete = {
    ...value,
    status: 'deleted_confirmed',
    fixtures: value.fixtures.slice(0, 2),
  };
  assert.throws(() => validateNotesFindLedger(incomplete), /notes_find_cleanup_count_invalid/);
});

test('T02 ledger rejects duplicate note IDs, titles, and home IDs with malformed receipts', () => {
  const duplicateHome = ledger();
  duplicateHome.fixtures[1].home_scope_id = duplicateHome.fixtures[0].home_scope_id;
  assert.throws(() => validateNotesFindLedger(duplicateHome), /notes_find_home_scope_id_duplicate/);

  const duplicateId = ledger();
  duplicateId.fixtures[1].note_id = duplicateId.fixtures[0].note_id;
  assert.throws(() => validateNotesFindLedger(duplicateId), /notes_find_note_id_duplicate/);

  const duplicateTitle = ledger();
  duplicateTitle.fixtures[1].title = duplicateTitle.fixtures[0].title;
  assert.throws(() => validateNotesFindLedger(duplicateTitle), /notes_find_title_duplicate/);

  const invalid = ledger();
  invalid.fixtures[2].home_scope_id = 'General';
  assert.throws(() => validateNotesFindLedger(invalid), /notes_find_home_scope_id_invalid/);
});

test('T02 insert ID is durable in the private recovery ledger before later detail validation fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'notes-find-ledger-'));
  const path = join(directory, 'fixture-ledger.json');
  const value = createNotesFindLedger({
    runId: 'notes-t02-failure-recovery',
    organizationId: '4b190b81-7ea2-40e1-8d6d-87fa4b520dfc',
    role: 'member',
    sourceSha: 'a'.repeat(40),
    treeSha256: 'b'.repeat(64),
  });
  try {
    let validationError = null;
    try {
      await recordNotesFindInsertBeforeValidation({
        ledger: value,
        noteId: ids[0],
        title: 'Harbor Dental intake insurance eligibility notes-t02-failure-recovery',
        ledgerPath: path,
        validate: async (fixture) => {
          const raw = await readFile(path, 'utf8').catch(() => null);
          assert.ok(raw, 'notes_find_insert_not_persisted_before_validation');
          const persisted = JSON.parse(raw);
          assert.equal(persisted.fixtures[0].note_id, ids[0]);
          assert.equal(persisted.fixtures[0].home_scope_id, null);
          assert.equal(fixture.note_id, ids[0]);
          throw new Error('notes_find_detail_id_mismatch');
        },
      });
    } catch (error) {
      validationError = error;
    }
    assert.equal(validationError?.message, 'notes_find_detail_id_mismatch');
    const persisted = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(persisted.status, 'creating');
    assert.equal(persisted.fixtures[0].status, 'created');
    assert.equal(persisted.fixtures[0].note_id, ids[0]);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('T02 home assignment only updates a live fixture owned by the ledger', () => {
  const value = ledger();
  recordNotesFindHomeAssigned(value, ids[0], fourthHome);
  assert.equal(value.fixtures[0].home_scope_id, fourthHome);
  assert.throws(
    () => recordNotesFindHomeAssigned(value, 'e25a8c80-2f47-4a5f-b696-5bf39112110f', homes[0]),
    /notes_find_home_foreign_id/,
  );
  assert.throws(
    () => recordNotesFindHomeAssigned(value, ids[0], 'General'),
    /notes_find_home_scope_id_invalid/,
  );
  assert.throws(
    () => recordNotesFindHomeAssigned(value, ids[2], homes[1]),
    /notes_find_home_scope_id_duplicate/,
  );
});

test('T02 run-owned homes remain recoverable from names before IDs and archive only by recorded IDs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'notes-find-homes-'));
  const path = join(directory, 'fixture-ledger.json');
  const value = createNotesFindLedger({
    runId: 'notes-t02-owned-homes',
    organizationId: '4b190b81-7ea2-40e1-8d6d-87fa4b520dfc',
    role: 'member',
    sourceSha: 'a'.repeat(40),
    treeSha256: 'b'.repeat(64),
  });
  try {
    planNotesFindHome(value, 'Harbor Dental Intake a1b2c3d4');
    await writeNotesFindLedger(path, value);
    const planned = JSON.parse(await readFile(path, 'utf8'));
    assert.deepEqual(planned.owned_homes, [
      {
        name: 'Harbor Dental Intake a1b2c3d4',
        scope_id: null,
        status: 'planned',
      },
    ]);
    recordNotesFindHomeCreated(value, planned.owned_homes[0].name, homes[0]);
    planNotesFindHome(value, 'Harbor Dental Follow-up a1b2c3d4');
    recordNotesFindHomeCreated(value, value.owned_homes[1].name, homes[1]);
    assert.throws(
      () => recordNotesFindHomeArchived(value, fourthHome),
      /notes_find_home_archive_foreign_id/,
    );
    assert.throws(
      () => recordNotesFindHomeCreated(value, value.owned_homes[0].name, fourthHome),
      /notes_find_home_not_planned/,
    );
    recordNotesFindHomeArchived(value, homes[0]);
    recordNotesFindHomeArchived(value, homes[1]);
    assert.ok(value.owned_homes.every((home) => home.status === 'archived_confirmed'));
    assert.equal(validateNotesFindLedger(value), value);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('T02 accepts real scope-write envelopes and rejects bare or foreign rows', () => {
  const organizationId = '4b190b81-7ea2-40e1-8d6d-87fa4b520dfc';
  const cases = [
    { id: homes[0], name: 'Harbor Dental Intake a1b2c3d4' },
    { id: homes[1], name: 'Harbor Dental Follow-up a1b2c3d4' },
  ];
  for (const row of cases) {
    const answer = { ok: true, row: { ...row, organization_id: organizationId }, store: {} };
    assert.equal(requireNotesFindHomeWrite(answer, organizationId, row.name), row.id);
    assert.throws(
      () => requireNotesFindHomeWrite(answer.row, organizationId, row.name),
      /notes_find_created_home_response_invalid/,
    );
    assert.throws(
      () => requireNotesFindHomeWrite(answer, 'e25a8c80-2f47-4a5f-b696-5bf39112110f', row.name),
      /notes_find_created_home_response_invalid/,
    );
  }
  assert.throws(
    () =>
      requireNotesFindHomeWrite(
        { ok: false, row: { ...cases[0], organization_id: organizationId } },
        organizationId,
        cases[0].name,
      ),
    /notes_find_created_home_response_invalid/,
  );
});
