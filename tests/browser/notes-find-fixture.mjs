import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA1 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;

function requireUuid(value, code) {
  assert.ok(typeof value === 'string' && UUID.test(value), code);
  return value;
}

/**
 * Private recovery ledger for the three Notes created by T02. It contains only
 * owned row ids, synthetic titles, home ids, and build/role context; never note
 * bodies, auth material, or unrelated account data.
 */
export function createNotesFindLedger({ runId, organizationId, role, sourceSha, treeSha256 }) {
  assert.ok(
    typeof runId === 'string' && /^[a-z0-9][a-z0-9-]{7,79}$/i.test(runId),
    'notes_find_run_id_invalid',
  );
  requireUuid(organizationId, 'notes_find_organization_id_missing');
  assert.ok(['member', 'admin'].includes(role), 'notes_find_role_invalid');
  assert.ok(SHA1.test(sourceSha ?? ''), 'notes_find_source_sha_invalid');
  assert.ok(SHA256.test(treeSha256 ?? ''), 'notes_find_tree_sha_invalid');
  return {
    schema_version: 1,
    case_id: 'EXT-F-2006-T02',
    run_id: runId,
    organization_id: organizationId,
    role,
    source_sha: sourceSha,
    tree_sha256: treeSha256,
    status: 'creating',
    fixtures: [],
  };
}

export function recordNotesFindCreated(ledger, { noteId, title, homeScopeId = null }) {
  requireUuid(noteId, 'notes_find_note_id_invalid');
  if (homeScopeId !== null) requireUuid(homeScopeId, 'notes_find_home_scope_id_invalid');
  assert.ok(
    typeof title === 'string' && title.length > 0 && title.length <= 160,
    'notes_find_title_invalid',
  );
  assert.equal(ledger.status, 'creating', 'notes_find_ledger_not_creating');
  assert.ok(
    !ledger.fixtures.some((item) => item.note_id === noteId),
    'notes_find_note_id_duplicate',
  );
  assert.ok(!ledger.fixtures.some((item) => item.title === title), 'notes_find_title_duplicate');
  assert.ok(
    homeScopeId === null || !ledger.fixtures.some((item) => item.home_scope_id === homeScopeId),
    'notes_find_home_scope_id_duplicate',
  );
  ledger.fixtures.push({ note_id: noteId, title, home_scope_id: homeScopeId, status: 'created' });
  return ledger;
}

export async function recordNotesFindInsertBeforeValidation({
  ledger,
  noteId,
  title,
  ledgerPath,
  validate,
}) {
  recordNotesFindCreated(ledger, { noteId, title });
  await writeNotesFindLedger(ledgerPath, ledger);
  return validate(ledger.fixtures.find((item) => item.note_id === noteId));
}

export function writeNotesFindLedger(path, ledger) {
  validateNotesFindLedger(ledger);
  return writeFile(path, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
}

export function recordNotesFindHomeAssigned(ledger, noteId, homeScopeId) {
  requireUuid(noteId, 'notes_find_note_id_invalid');
  requireUuid(homeScopeId, 'notes_find_home_scope_id_invalid');
  const fixture = ledger.fixtures.find((item) => item.note_id === noteId);
  assert.ok(fixture, 'notes_find_home_foreign_id');
  assert.equal(fixture.status, 'created', 'notes_find_home_after_delete');
  assert.ok(
    !ledger.fixtures.some((item) => item.note_id !== noteId && item.home_scope_id === homeScopeId),
    'notes_find_home_scope_id_duplicate',
  );
  fixture.home_scope_id = homeScopeId;
  return ledger;
}

export function recordNotesFindDeleted(ledger, noteId) {
  requireUuid(noteId, 'notes_find_note_id_invalid');
  const fixture = ledger.fixtures.find((item) => item.note_id === noteId);
  assert.ok(fixture, 'notes_find_cleanup_foreign_id');
  assert.equal(fixture.status, 'created', 'notes_find_cleanup_duplicate');
  fixture.status = 'deleted_confirmed';
  if (
    ledger.fixtures.length === 3 &&
    ledger.fixtures.every((item) => item.status === 'deleted_confirmed')
  ) {
    ledger.status = 'deleted_confirmed';
  }
  return ledger;
}

export function validateNotesFindLedger(ledger) {
  assert.equal(ledger?.schema_version, 1, 'notes_find_ledger_schema_invalid');
  assert.equal(ledger.case_id, 'EXT-F-2006-T02', 'notes_find_ledger_case_invalid');
  requireUuid(ledger.organization_id, 'notes_find_organization_id_missing');
  assert.ok(
    Array.isArray(ledger.fixtures) && ledger.fixtures.length <= 3,
    'notes_find_fixture_count_invalid',
  );
  assert.ok(
    ['creating', 'created', 'deleted_confirmed'].includes(ledger.status),
    'notes_find_ledger_status_invalid',
  );
  const ids = new Set();
  const titles = new Set();
  const homeIds = new Set();
  for (const fixture of ledger.fixtures) {
    requireUuid(fixture.note_id, 'notes_find_note_id_invalid');
    if (fixture.home_scope_id !== null)
      requireUuid(fixture.home_scope_id, 'notes_find_home_scope_id_invalid');
    assert.ok(
      typeof fixture.title === 'string' && fixture.title.length > 0,
      'notes_find_title_invalid',
    );
    assert.ok(
      ['created', 'deleted_confirmed'].includes(fixture.status),
      'notes_find_fixture_status_invalid',
    );
    assert.ok(!ids.has(fixture.note_id), 'notes_find_note_id_duplicate');
    assert.ok(!titles.has(fixture.title), 'notes_find_title_duplicate');
    assert.ok(
      fixture.home_scope_id === null || !homeIds.has(fixture.home_scope_id),
      'notes_find_home_scope_id_duplicate',
    );
    ids.add(fixture.note_id);
    titles.add(fixture.title);
    if (fixture.home_scope_id !== null) homeIds.add(fixture.home_scope_id);
  }
  if (ledger.status === 'deleted_confirmed') {
    assert.equal(ledger.fixtures.length, 3, 'notes_find_cleanup_count_invalid');
    assert.ok(
      ledger.fixtures.every((item) => item.status === 'deleted_confirmed'),
      'notes_find_cleanup_incomplete',
    );
  }
  return ledger;
}
