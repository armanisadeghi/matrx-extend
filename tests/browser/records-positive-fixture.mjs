import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, rename } from 'node:fs/promises';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OWNED_NAME =
  /^EXT-F-4130-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const RECORDS_FIXTURE_MARKER = 'matrx-extend-native-records-C04-C05-v1';
export function recordsFixtureMarker(principalId, orgId) {
  assert.match(principalId ?? '', UUID, 'records_fixture_principal_id_invalid');
  assert.match(orgId ?? '', UUID, 'records_fixture_org_id_invalid');
  return `${RECORDS_FIXTURE_MARKER}:${createHash('sha256').update(`${principalId}:${orgId}`).digest('hex')}`;
}

export function requireRecordsHostedFixture(environment) {
  assert.equal(environment.GITHUB_ACTIONS, 'true', 'records_fixture_hosted_required');
  assert.equal(environment.RUNNER_ENVIRONMENT, 'github-hosted', 'records_fixture_runner_required');
  assert.equal(
    environment.MATRX_HOSTED_ACCEPTANCE_CASE,
    'records-readonly-admin',
    'records_fixture_case_required',
  );
  assert.equal(environment.MATRX_HOSTED_ACCEPTANCE_LANE, 'A', 'records_fixture_lane_a_required');
}
const PHASES = new Set([
  'planned',
  'create_sent',
  'table_owned',
  'row_owned',
  'archive_sent',
  'archived_verified',
  'no_fixture_created',
  'ownership_unverified',
  'no_owned_fixture_found',
]);
const FIXTURE_ASSERTIONS = new Set([
  'records_fixture_archive_failed',
  'records_fixture_archive_id_invalid',
  'records_fixture_archive_not_confirmed',
  'records_fixture_archive_not_done',
  'records_fixture_archive_wrong_org',
  'records_fixture_archive_wrong_table',
  'records_fixture_cleanup_id_changed',
  'records_fixture_cleanup_list_failed',
  'records_fixture_cleanup_list_incomplete',
  'records_fixture_cleanup_ownership_ambiguous',
  'records_fixture_name_not_unique',
  'records_fixture_preflight_failed',
  'records_fixture_preflight_incomplete',
  'records_fixture_principal_mismatch',
  'records_fixture_prior_still_visible',
  'records_fixture_recovery_id_invalid',
  'records_fixture_recovery_list_failed',
  'records_fixture_recovery_list_incomplete',
  'records_fixture_recovery_name_invalid',
  'records_fixture_recovery_shape_invalid',
  'records_fixture_recovery_verify_failed',
  'records_fixture_recovery_verify_incomplete',
  'records_fixture_row_create_failed',
  'records_fixture_row_id_missing',
  'records_fixture_row_not_done',
  'records_fixture_row_value_mismatch',
  'records_fixture_still_visible',
  'records_fixture_table_create_failed',
  'records_fixture_table_id_missing',
  'records_fixture_table_not_created',
  'records_fixture_table_not_done',
  'records_fixture_table_wrong_org',
  'records_fixture_transport_failed',
  'records_fixture_verify_list_failed',
  'records_fixture_verify_list_incomplete',
]);

// The token and raw REST response remain in the extension context. Only a
// case-owned synthetic identity and fixed-shape observations cross to Node.
export async function recordsFixtureRequest(
  panel,
  evaluate,
  { method, path, body, orgId, bearerHash, name, marker },
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
      const owned = Array.isArray(data?.tables) ? data.tables.filter(t =>
        /^EXT-F-4130-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(t.name ?? '') &&
        t.description === ${JSON.stringify(marker)} &&
        t.organization_id === ${JSON.stringify(orgId)} && t.kind === 'custom') : [];
      const tables = owned.filter(t => t.name === ${JSON.stringify(name)});
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
        owned_tables: owned.map(t => ({ id: t.id, name: t.name })),
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
  principalId,
  bearerHash,
  journalPath,
  exercise,
  onStage = () => {},
  onFailure = () => {},
  request = recordsFixtureRequest,
  id = randomUUID,
  maxArchiveAttempts = 3,
  environment = process.env,
}) {
  requireRecordsHostedFixture(environment);
  const marker = recordsFixtureMarker(principalId, orgId);
  let phase = 'records_fixture_journal';
  let lastRequest = null;
  const mark = (value) => {
    phase = value;
    lastRequest = null;
    onStage(value);
  };
  const reportFailure = (boundary, error) => {
    const fixedAssertion = error?.code === 'ERR_ASSERTION' && FIXTURE_ASSERTIONS.has(error.message);
    onFailure({
      boundary,
      phase,
      classification:
        fixedAssertion || error?.message === 'records_fixture_recovery_cleanup_only'
          ? error.message
          : 'records_fixture_unexpected_error',
      request_method: lastRequest?.method ?? null,
      http_status: lastRequest?.status ?? null,
    });
  };
  let state;
  try {
    state = JSON.parse(await readFile(journalPath, 'utf8'));
    assert.equal(state.schema_version, 1, 'records_fixture_journal_invalid');
    assert.match(state.name, OWNED_NAME);
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
      marker,
    });
    lastRequest = {
      method,
      status:
        Number.isInteger(answer?.status) && answer.status >= 100 && answer.status <= 599
          ? answer.status
          : null,
    };
    assert.equal(answer?.token_matches, true, 'records_fixture_principal_mismatch');
    assert.equal(answer.transport_failed, undefined, 'records_fixture_transport_failed');
    return answer;
  };
  const list = () =>
    call(
      'GET',
      `?organization=${encodeURIComponent(orgId)}&search=${encodeURIComponent(state.name)}`,
    );
  const listOwned = () =>
    call('GET', `?organization=${encodeURIComponent(orgId)}&search=EXT-F-4130-`);
  const archiveOwned = async (tableId) => {
    assert.match(tableId ?? '', UUID, 'records_fixture_archive_id_invalid');
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
  };
  let bodyError;
  let cleanupError;
  try {
    mark('records_fixture_recovery_list');
    const prior = await listOwned();
    assert.equal(prior.status, 200, 'records_fixture_recovery_list_failed');
    assert.equal(prior.list_complete, true, 'records_fixture_recovery_list_incomplete');
    assert.ok(Array.isArray(prior.owned_tables), 'records_fixture_recovery_shape_invalid');
    for (const table of prior.owned_tables) {
      assert.match(table.name, OWNED_NAME, 'records_fixture_recovery_name_invalid');
      assert.match(table.id, UUID, 'records_fixture_recovery_id_invalid');
      if (table.name === state.name) continue;
      mark('records_fixture_prior_cleanup');
      await archiveOwned(table.id);
    }
    if (prior.owned_tables.some((table) => table.name !== state.name)) {
      mark('records_fixture_recovery_verify');
      const remaining = await listOwned();
      assert.equal(remaining.status, 200, 'records_fixture_recovery_verify_failed');
      assert.equal(remaining.list_complete, true, 'records_fixture_recovery_verify_incomplete');
      assert.equal(
        remaining.owned_tables.length,
        prior.owned_tables.filter((table) => table.name === state.name).length,
        'records_fixture_prior_still_visible',
      );
    }
    mark('records_fixture_preflight');
    const before = await list();
    assert.equal(before.status, 200, 'records_fixture_preflight_failed');
    assert.equal(before.list_complete, true, 'records_fixture_preflight_incomplete');
    if (state.phase === 'planned')
      assert.equal(before.tables.length, 0, 'records_fixture_name_not_unique');
    // Recovery is cleanup-only. Never create another row after an interrupted
    // run, and never count an old run's evidence as this run's native credit.
    if (state.phase !== 'planned') throw new Error('records_fixture_recovery_cleanup_only');
    if (!state.table_id) {
      mark('records_fixture_table_create');
      state.phase = 'create_sent';
      await journal(journalPath, state);
      const made = await call('POST', '', {
        name: state.name,
        slug: state.name.toLowerCase(),
        description: marker,
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
    mark('records_fixture_row_create');
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
    mark('records_fixture_positive_reads');
    await exercise({
      tableId: state.table_id,
      rowId: state.row_id,
      rowName,
      rowVersion: row.row_version,
    });
  } catch (error) {
    bodyError = error;
    reportFailure('body', error);
  } finally {
    try {
      mark('records_fixture_cleanup');
      // A timed-out create can have committed. Resolve only the run-unique
      // preflighted name; never archive a table whose ownership is ambiguous.
      if (state.phase !== 'planned') {
        const found = await list();
        assert.equal(found.status, 200, 'records_fixture_cleanup_list_failed');
        assert.equal(found.list_complete, true, 'records_fixture_cleanup_list_incomplete');
        if (
          found.tables.length === 0 &&
          ['create_sent', 'no_fixture_created'].includes(state.phase)
        ) {
          state.phase = 'no_fixture_created';
          await journal(journalPath, state);
        } else if (
          found.tables.length === 0 &&
          ['archive_sent', 'archived_verified'].includes(state.phase)
        ) {
          // The previous process may have stopped after the archive committed.
          // This confirms absence, but the recovered run still earns no read credit.
          state.phase = 'archived_verified';
          await journal(journalPath, state);
        } else if (
          found.tables.length === 0 &&
          ['ownership_unverified', 'no_owned_fixture_found'].includes(state.phase)
        ) {
          state.phase = 'no_owned_fixture_found';
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
          await archiveOwned(tableId);
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
      reportFailure('cleanup', error);
    }
  }
  if (cleanupError) throw cleanupError;
  if (bodyError) throw bodyError;
  return { archived_verified: state.phase === 'archived_verified', journal_path: journalPath };
}
