import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { open, readFile, rename } from 'node:fs/promises';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PHASES = new Set([
  'planned',
  'create_sent',
  'table_owned',
  'row_owned',
  'archive_sent',
  'archived_verified',
  'no_fixture_created',
  'ownership_unverified',
]);

// The token and raw REST response remain in the extension context. Only a
// case-owned synthetic identity and fixed-shape observations cross to Node.
export async function recordsFixtureRequest(
  panel,
  evaluate,
  { method, path, body, orgId, bearerHash, name },
) {
  return evaluate(
    panel,
    `(async () => {
    const token = (await chrome.storage.local.get('matrx.auth.accessToken'))['matrx.auth.accessToken'];
    if (typeof token !== 'string' || !token) return { token_matches: false };
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    const hash = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
    if (hash !== ${JSON.stringify(bearerHash)}) return { token_matches: false };
    try {
      const response = await fetch(${JSON.stringify(`https://server.app.matrxserver.com/api/v1/tables${path}`)}, {
        method: ${JSON.stringify(method)},
        headers: { Authorization: 'Bearer ' + token, 'X-Organization-Id': ${JSON.stringify(orgId)},
          ...(${JSON.stringify(body !== undefined)} ? { 'Content-Type': 'application/json' } : {}) },
        ...(${JSON.stringify(body !== undefined)} ? { body: JSON.stringify(${JSON.stringify(body ?? null)}) } : {}),
      });
      const data = await response.json().catch(() => null);
      const tables = Array.isArray(data?.tables) ? data.tables.filter(t => t.name === ${JSON.stringify(name)} && t.organization_id === ${JSON.stringify(orgId)} && t.kind === 'custom') : [];
      return {
        token_matches: true, status: response.status,
        done: data?.done === true, created: data?.created === true,
        archived: data?.archived === true,
        org_matches: data?.organization_id === ${JSON.stringify(orgId)},
        id: typeof data?.id === 'string' ? data.id : null,
        row_id: typeof data?.row?.id === 'string' ? data.row.id : null,
        row_version: Number.isInteger(data?.row?.version) ? data.row.version : null,
        row_value_matches: data?.row?.values?.Name === ${JSON.stringify(body?.values?.Name ?? null)},
        tables: tables.map(t => ({ id: t.id, org_matches: true })),
        list_complete: Array.isArray(data?.not_listed) && data.not_listed.length === 0,
      };
    } catch { return { token_matches: true, transport_failed: true }; }
  })()`,
  );
}

async function journal(path, state) {
  const temporary = `${path}.tmp`;
  const file = await open(temporary, 'w', 0o600);
  try {
    await file.writeFile(`${JSON.stringify(state)}\n`);
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, path);
}

export async function withRecordsPositiveFixture({
  panel,
  evaluate,
  orgId,
  bearerHash,
  journalPath,
  exercise,
  onStage = () => {},
  request = recordsFixtureRequest,
  id = randomUUID,
  maxArchiveAttempts = 3,
}) {
  let state;
  try {
    state = JSON.parse(await readFile(journalPath, 'utf8'));
    assert.equal(state.schema_version, 1, 'records_fixture_journal_invalid');
    assert.match(state.name, /^EXT-F-4130-[0-9a-f-]{36}$/i);
    assert.equal(PHASES.has(state.phase), true, 'records_fixture_journal_phase_invalid');
    if (state.table_id !== null) assert.match(state.table_id ?? '', UUID);
    if (state.row_id !== null) assert.match(state.row_id ?? '', UUID);
    if (state.phase === 'planned') {
      assert.equal(state.table_id, null, 'records_fixture_planned_table_id_present');
      assert.equal(state.row_id, null, 'records_fixture_planned_row_id_present');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const suffix = id();
    assert.match(suffix, UUID, 'records_fixture_run_id_invalid');
    state = {
      schema_version: 1,
      name: `EXT-F-4130-${suffix}`,
      table_id: null,
      row_id: null,
      phase: 'planned',
    };
    await journal(journalPath, state);
  }
  const call = async (method, path, body) => {
    const answer = await request(panel, evaluate, {
      method,
      path,
      body,
      orgId,
      bearerHash,
      name: state.name,
    });
    assert.equal(answer?.token_matches, true, 'records_fixture_principal_mismatch');
    assert.equal(answer.transport_failed, undefined, 'records_fixture_transport_failed');
    return answer;
  };
  const list = () =>
    call(
      'GET',
      `?organization=${encodeURIComponent(orgId)}&search=${encodeURIComponent(state.name)}`,
    );
  let bodyError;
  let cleanupError;
  try {
    const before = await list();
    assert.equal(before.status, 200, 'records_fixture_preflight_failed');
    assert.equal(before.list_complete, true, 'records_fixture_preflight_incomplete');
    if (state.phase === 'planned')
      assert.equal(before.tables.length, 0, 'records_fixture_name_not_unique');
    // Recovery is cleanup-only. Never create another row after an interrupted
    // run, and never count an old run's evidence as this run's native credit.
    if (state.phase !== 'planned') throw new Error('records_fixture_recovery_cleanup_only');
    if (!state.table_id) {
      onStage('records_fixture_table_create');
      state.phase = 'create_sent';
      await journal(journalPath, state);
      const made = await call('POST', '', {
        name: state.name,
        slug: state.name.toLowerCase(),
        columns: [
          { name: 'Name', type: 'text' },
          { name: 'Amount', type: 'number' },
        ],
      });
      assert.equal(made.status, 200, 'records_fixture_table_create_failed');
      assert.equal(made.done, true, 'records_fixture_table_not_done');
      if (!made.created || !made.org_matches) {
        state.phase = 'ownership_unverified';
        await journal(journalPath, state);
      }
      assert.equal(made.created, true, 'records_fixture_table_not_created');
      assert.equal(made.org_matches, true, 'records_fixture_table_wrong_org');
      assert.match(made.id ?? '', UUID, 'records_fixture_table_id_missing');
      state.table_id = made.id;
      state.phase = 'table_owned';
      await journal(journalPath, state);
    }
    onStage('records_fixture_row_create');
    const rowName = `${state.name}-row`;
    const row = await call('POST', `/${state.table_id}/rows`, {
      values: { Name: rowName, Amount: 7 },
    });
    assert.equal(row.status, 201, 'records_fixture_row_create_failed');
    assert.equal(row.done, true, 'records_fixture_row_not_done');
    assert.equal(row.row_value_matches, true, 'records_fixture_row_value_mismatch');
    assert.match(row.row_id ?? '', UUID, 'records_fixture_row_id_missing');
    state.row_id = row.row_id;
    state.phase = 'row_owned';
    await journal(journalPath, state);
    await exercise({
      tableId: state.table_id,
      rowId: state.row_id,
      rowName,
      rowVersion: row.row_version,
    });
  } catch (error) {
    bodyError = error;
  } finally {
    try {
      onStage('records_fixture_cleanup');
      // A timed-out create can have committed. Resolve only the run-unique
      // preflighted name; never archive a table whose ownership is ambiguous.
      if (state.phase !== 'planned' && state.phase !== 'ownership_unverified') {
        const found = await list();
        assert.equal(found.status, 200, 'records_fixture_cleanup_list_failed');
        assert.equal(found.list_complete, true, 'records_fixture_cleanup_list_incomplete');
        if (found.tables.length === 0 && state.phase === 'create_sent') {
          state.phase = 'no_fixture_created';
          await journal(journalPath, state);
        } else if (found.tables.length === 0 && state.phase === 'archive_sent') {
          // The previous process may have stopped after the archive committed.
          // This confirms absence, but the recovered run still earns no read credit.
          state.phase = 'archived_verified';
          await journal(journalPath, state);
        } else {
          assert.equal(found.tables.length, 1, 'records_fixture_cleanup_ownership_ambiguous');
          const tableId = found.tables[0].id;
          assert.match(tableId ?? '', UUID);
          if (state.table_id)
            assert.equal(tableId, state.table_id, 'records_fixture_cleanup_id_changed');
          state.table_id = tableId;
          state.phase = 'archive_sent';
          await journal(journalPath, state);
          let archived;
          for (let attempt = 0; attempt < maxArchiveAttempts; attempt++) {
            archived = await call('DELETE', `/${tableId}`);
            if (archived.status !== 503) break;
          }
          assert.equal(archived.status, 200, 'records_fixture_archive_failed');
          assert.equal(archived.done, true, 'records_fixture_archive_not_done');
          assert.equal(archived.archived, true, 'records_fixture_archive_not_confirmed');
          assert.equal(archived.org_matches, true, 'records_fixture_archive_wrong_org');
          assert.equal(archived.id, tableId, 'records_fixture_archive_wrong_table');
          const after = await list();
          assert.equal(after.status, 200, 'records_fixture_verify_list_failed');
          assert.equal(after.list_complete, true, 'records_fixture_verify_list_incomplete');
          assert.equal(after.tables.length, 0, 'records_fixture_still_visible');
          state.phase = 'archived_verified';
          await journal(journalPath, state);
        }
      }
    } catch (error) {
      cleanupError = error;
    }
  }
  if (cleanupError) throw cleanupError;
  if (bodyError) throw bodyError;
  return { archived_verified: state.phase === 'archived_verified', journal_path: journalPath };
}
