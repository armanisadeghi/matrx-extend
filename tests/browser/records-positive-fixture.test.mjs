import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  recordsFixtureMarker,
  recordsFixtureRequest,
  withRecordsPositiveFixture,
} from './records-positive-fixture.mjs';

const tableId = '23951026-21cc-4cae-858b-51cbca121de1';
const rowId = '852412f5-f443-4135-bda4-fb0214dafd43';
const orgId = 'f9d83857-a225-4c73-adff-57cc468f9558';
const principalId = '8d807837-f8f1-47b7-98d6-28cdf5c6b6d1';
const runId = 'f1b2fcd9-4d61-4189-b123-410a3448f029';

async function scenario(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'records-fixture-unit-'));
  const journalPath = join(directory, 'journal.json');
  const calls = [];
  let tableExists = options.existingTable === true;
  let currentName = options.existingName ?? `EXT-F-4130-${runId}`;
  let archived = false;
  let rows = 0;
  let archiveAttempts = 0;
  const request = async (_panel, _evaluate, input) => {
    calls.push({ method: input.method, path: input.path });
    if (options.principalMismatch) return { token_matches: false };
    if (input.method === 'GET') {
      const owned =
        tableExists && !archived && (!options.notCreated || options.notCreatedMarked)
          ? [{ id: tableId, name: currentName }]
          : [];
      return {
        token_matches: true,
        status: 200,
        list_complete: true,
        tables: owned.filter((table) => table.name === input.name),
        owned_tables: input.path.includes('search=EXT-F-4130-') ? owned : [],
      };
    }
    if (input.method === 'POST' && input.path === '') {
      if (options.createRejectedNoWrite)
        return { token_matches: true, status: 422, done: false, created: false };
      tableExists = true;
      archived = false;
      currentName = input.body.name;
      assert.equal(input.body.description, recordsFixtureMarker(principalId, orgId));
      if (options.createTransportFailure) return { token_matches: true, transport_failed: true };
      return {
        token_matches: true,
        status: 200,
        done: true,
        created: !options.notCreated,
        org_matches: true,
        id: tableId,
      };
    }
    if (input.method === 'POST' && input.path.endsWith('/rows')) {
      rows++;
      return {
        token_matches: true,
        status: 201,
        done: true,
        row_value_matches: true,
        row_id: rowId,
        row_version: 1,
      };
    }
    if (input.method === 'DELETE') {
      archiveAttempts++;
      if (options.archiveFailure) return { token_matches: true, status: 503, done: false };
      if (archiveAttempts <= (options.busyArchiveAttempts ?? 0))
        return { token_matches: true, status: 503, done: false };
      archived = true;
      return {
        token_matches: true,
        status: 200,
        done: true,
        archived: true,
        org_matches: true,
        id: tableId,
      };
    }
    throw new Error('unexpected fixture operation');
  };
  const run = (exercise = async () => {}) =>
    withRecordsPositiveFixture({
      panel: {},
      evaluate: async () => {},
      orgId,
      principalId,
      bearerHash: 'a'.repeat(64),
      environment: options.environment ?? {
        GITHUB_ACTIONS: 'true',
        RUNNER_ENVIRONMENT: 'github-hosted',
        MATRX_HOSTED_ACCEPTANCE_CASE: 'records-readonly-admin',
        MATRX_HOSTED_ACCEPTANCE_LANE: 'A',
      },
      journalPath,
      exercise,
      request,
      id: () => runId,
    });
  return {
    run,
    calls,
    journalPath,
    cleanup: () => rm(directory, { recursive: true, force: true }),
    get archived() {
      return archived;
    },
    get rows() {
      return rows;
    },
    get archiveAttempts() {
      return archiveAttempts;
    },
  };
}

test('owned fixture journals before writes, exercises actual returned IDs, then archives and verifies absence', async () => {
  const s = await scenario();
  try {
    let exercised = false;
    const receipt = await s.run(async (fixture) => {
      exercised = true;
      assert.deepEqual(fixture, {
        tableId,
        rowId,
        rowName: `EXT-F-4130-${runId}-row`,
        rowVersion: 1,
      });
      const journal = JSON.parse(await readFile(s.journalPath, 'utf8'));
      assert.equal(journal.phase, 'row_owned');
      assert.equal(journal.table_id, tableId);
      assert.equal(journal.row_id, rowId);
      assert.equal(JSON.stringify(journal).includes(orgId), false);
    });
    assert.equal(exercised, true);
    assert.equal(receipt.archived_verified, true);
    assert.equal(s.archived, true);
    assert.deepEqual(
      s.calls.map(({ method }) => method),
      ['GET', 'GET', 'POST', 'POST', 'GET', 'DELETE', 'GET'],
    );
    assert.equal(JSON.parse(await readFile(s.journalPath, 'utf8')).phase, 'archived_verified');
  } finally {
    await s.cleanup();
  }
});

test('a failed read still archives the owned table; a failed archive never reports success', async () => {
  const s = await scenario();
  try {
    await assert.rejects(
      s.run(async () => {
        throw new Error('read assertion failed');
      }),
      /read assertion failed/,
    );
    assert.equal(s.archived, true);
  } finally {
    await s.cleanup();
  }
  const failed = await scenario({ archiveFailure: true });
  try {
    await assert.rejects(failed.run(), /records_fixture_archive_failed/);
    assert.equal(failed.archived, false);
    assert.equal(JSON.parse(await readFile(failed.journalPath, 'utf8')).phase, 'archive_sent');
  } finally {
    await failed.cleanup();
  }
});

test('lost create response is recovered by owned name and archived without creating a row', async () => {
  const s = await scenario({ createTransportFailure: true });
  try {
    await assert.rejects(s.run(), /records_fixture_transport_failed/);
    assert.equal(s.archived, true);
    assert.equal(s.rows, 0);
  } finally {
    await s.cleanup();
  }
});

test('existing table or wrong principal refuses before fixture writes', async () => {
  for (const options of [{ notCreated: true }, { principalMismatch: true }]) {
    const s = await scenario(options);
    try {
      await assert.rejects(s.run());
      assert.equal(s.rows, 0);
      assert.equal(s.archived, false);
    } finally {
      await s.cleanup();
    }
  }
});

test('fixture recovery refuses any caller outside the guarded hosted Records case', async () => {
  for (const environment of [
    {},
    {
      GITHUB_ACTIONS: 'true',
      RUNNER_ENVIRONMENT: 'github-hosted',
      MATRX_HOSTED_ACCEPTANCE_CASE: 'guest-chat',
      MATRX_HOSTED_ACCEPTANCE_LANE: 'A',
    },
    {
      GITHUB_ACTIONS: 'true',
      RUNNER_ENVIRONMENT: 'self-hosted',
      MATRX_HOSTED_ACCEPTANCE_CASE: 'records-readonly-admin',
      MATRX_HOSTED_ACCEPTANCE_LANE: 'A',
    },
    {
      GITHUB_ACTIONS: 'true',
      RUNNER_ENVIRONMENT: 'github-hosted',
      MATRX_HOSTED_ACCEPTANCE_CASE: 'records-readonly-admin',
      MATRX_HOSTED_ACCEPTANCE_LANE: 'B',
    },
  ]) {
    const s = await scenario({ environment });
    try {
      await assert.rejects(s.run(), /records_fixture_(hosted|runner|case|lane_a)_required/);
      assert.equal(s.calls.length, 0);
    } finally {
      await s.cleanup();
    }
  }
});

test('server-side marker is stable for one principal and organization but differs across seats', () => {
  const marker = recordsFixtureMarker(principalId, orgId);
  assert.equal(recordsFixtureMarker(principalId, orgId), marker);
  assert.notEqual(recordsFixtureMarker(tableId, orgId), marker);
  assert.notEqual(recordsFixtureMarker(principalId, tableId), marker);
  assert.doesNotMatch(marker, new RegExp(`${principalId}|${orgId}`));
});

test('created=false only archives an exact marked fixture and leaves an unmarked collision untouched', async () => {
  for (const marked of [true, false]) {
    const s = await scenario({ notCreated: true, notCreatedMarked: marked });
    try {
      await assert.rejects(s.run(), /records_fixture_table_not_created/);
      assert.equal(s.archived, marked);
      const state = JSON.parse(await readFile(s.journalPath, 'utf8'));
      assert.equal(state.phase, marked ? 'archived_verified' : 'no_owned_fixture_found');
      const writes = s.calls.filter(({ method }) => method === 'POST').length;
      await assert.rejects(s.run(), /records_fixture_recovery_cleanup_only/);
      assert.equal(s.calls.filter(({ method }) => method === 'POST').length, writes);
    } finally {
      await s.cleanup();
    }
  }
});

test('no_fixture_created and archived_verified journals are terminal on retry', async () => {
  for (const options of [{ createRejectedNoWrite: true }, {}]) {
    const s = await scenario(options);
    try {
      if (options.createRejectedNoWrite)
        await assert.rejects(s.run(), /records_fixture_table_create_failed/);
      else await s.run();
      const phase = JSON.parse(await readFile(s.journalPath, 'utf8')).phase;
      assert.equal(
        phase,
        options.createRejectedNoWrite ? 'no_fixture_created' : 'archived_verified',
      );
      const writes = s.calls.filter(({ method }) => method !== 'GET').length;
      await assert.rejects(s.run(), /records_fixture_recovery_cleanup_only/);
      assert.equal(s.calls.filter(({ method }) => method !== 'GET').length, writes);
    } finally {
      await s.cleanup();
    }
  }
});

test('interrupted owned journal performs cleanup only and cannot earn read credit', async () => {
  const s = await scenario({ existingTable: true });
  try {
    await writeFile(
      s.journalPath,
      JSON.stringify({
        schema_version: 1,
        name: `EXT-F-4130-${runId}`,
        table_id: tableId,
        row_id: null,
        phase: 'table_owned',
      }),
    );
    await assert.rejects(
      s.run(() => {
        throw new Error('should not exercise');
      }),
      /records_fixture_recovery_cleanup_only/,
    );
    assert.equal(s.archived, true);
    assert.equal(s.rows, 0);
  } finally {
    await s.cleanup();
  }
});

test('new hosted attempt discovers prior marked fixture without the prior journal', async () => {
  const previousName = 'EXT-F-4130-682fbb1e-e613-459a-968d-51f807b4fd33';
  const s = await scenario({ existingTable: true, existingName: previousName });
  try {
    const result = await s.run();
    assert.equal(result.archived_verified, true);
    assert.deepEqual(
      s.calls.slice(0, 3).map(({ method }) => method),
      ['GET', 'DELETE', 'GET'],
    );
    assert.equal(s.archiveAttempts, 2);
    assert.equal(s.rows, 1);
  } finally {
    await s.cleanup();
  }
});

test('busy archival continues through the supported retry response', async () => {
  const s = await scenario({ busyArchiveAttempts: 2 });
  try {
    const result = await s.run();
    assert.equal(result.archived_verified, true);
    assert.equal(s.archiveAttempts, 3);
  } finally {
    await s.cleanup();
  }
});

test('an interrupted completed archive is verified without issuing another write', async () => {
  const s = await scenario();
  try {
    await writeFile(
      s.journalPath,
      JSON.stringify({
        schema_version: 1,
        name: `EXT-F-4130-${runId}`,
        table_id: tableId,
        row_id: rowId,
        phase: 'archive_sent',
      }),
    );
    await assert.rejects(s.run(), /records_fixture_recovery_cleanup_only/);
    assert.equal(s.archiveAttempts, 0);
    assert.equal(JSON.parse(await readFile(s.journalPath, 'utf8')).phase, 'archived_verified');
  } finally {
    await s.cleanup();
  }
});

test('real page request uses the signed-in principal and returns only safe receipt fields', async () => {
  const token = 'unit-test-token';
  const expectedHash = createHash('sha256').update(token).digest('hex');
  let request;
  const evaluate = async (_panel, expression) =>
    new Function('chrome', 'crypto', 'fetch', `return ${expression};`)(
      { storage: { local: { get: async () => ({ 'matrx.auth.accessToken': token }) } } },
      webcrypto,
      async (url, options) => {
        request = { url, options };
        return {
          status: 200,
          json: async () => ({
            done: true,
            created: true,
            id: tableId,
            organization_id: orgId,
            internal_error: 'must never leave page',
          }),
        };
      },
    );
  const result = await recordsFixtureRequest({}, evaluate, {
    method: 'POST',
    path: '',
    body: { name: 'owned', columns: [{ name: 'Name', type: 'text' }] },
    orgId,
    bearerHash: expectedHash,
    name: 'owned',
    marker: recordsFixtureMarker(principalId, orgId),
  });
  assert.equal(request.url, 'https://server.app.matrxserver.com/api/v1/tables');
  assert.equal(request.options.headers.Authorization, `Bearer ${token}`);
  assert.equal(request.options.headers['X-Organization-Id'], orgId);
  assert.equal(result.id, tableId);
  assert.equal(result.org_matches, true);
  assert.doesNotMatch(JSON.stringify(result), /unit-test-token|must never leave page|f9d83857/);
});

test('page-local recovery scan selects only exact marked synthetic tables in the same organization', async () => {
  const token = 'unit-test-token';
  const name = `EXT-F-4130-${runId}`;
  const foreign = '7b591026-9c8d-4437-9d28-caa508ee5d72';
  const marker = recordsFixtureMarker(principalId, orgId);
  const evaluate = async (_panel, expression) =>
    new Function('chrome', 'crypto', 'fetch', `return ${expression};`)(
      { storage: { local: { get: async () => ({ 'matrx.auth.accessToken': token }) } } },
      webcrypto,
      async () => ({
        status: 200,
        json: async () => ({
          not_listed: [],
          tables: [
            { id: tableId, name, description: marker, organization_id: orgId, kind: 'custom' },
            {
              id: foreign,
              name,
              description: 'someone else',
              organization_id: orgId,
              kind: 'custom',
            },
            { id: foreign, name, description: marker, organization_id: foreign, kind: 'custom' },
            {
              id: foreign,
              name: 'Customer records',
              description: marker,
              organization_id: orgId,
              kind: 'custom',
            },
          ],
        }),
      }),
    );
  const result = await recordsFixtureRequest({}, evaluate, {
    method: 'GET',
    path: `?organization=${orgId}&search=EXT-F-4130-`,
    orgId,
    bearerHash: createHash('sha256').update(token).digest('hex'),
    name,
    marker,
  });
  assert.deepEqual(result.owned_tables, [{ id: tableId, name }]);
  assert.deepEqual(result.tables, [{ id: tableId, org_matches: true }]);
  assert.doesNotMatch(JSON.stringify(result), /someone else|Customer records/);
});

test('hosted Records keeps the canonical A/B groups and passes admitted lane A to the driver', async () => {
  const workflow = await readFile(
    new URL('../../.github/workflows/hosted-guest-acceptance.yml', import.meta.url),
    'utf8',
  );
  const expression = workflow.match(/^ {6}group: \$\{\{ (.+) \}\}$/m)?.[1];
  assert.ok(expression);
  const group = new Function('inputs', `return ${expression};`);
  assert.equal(
    group({ acceptance_case: 'records-readonly-admin', acceptance_lane: 'A' }),
    'hosted-guest-side-panel-A',
  );
  assert.equal(
    group({ acceptance_case: 'records-readonly-admin', acceptance_lane: 'B' }),
    'hosted-guest-side-panel-B',
  );
  assert.equal(
    group({ acceptance_case: 'guest-chat', acceptance_lane: 'A' }),
    'hosted-guest-side-panel-A',
  );
  assert.equal(
    group({ acceptance_case: 'guest-chat', acceptance_lane: 'B' }),
    'hosted-guest-side-panel-B',
  );
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /MATRX_HOSTED_ACCEPTANCE_LANE: \$\{\{ inputs\.acceptance_lane \}\}/);
});
