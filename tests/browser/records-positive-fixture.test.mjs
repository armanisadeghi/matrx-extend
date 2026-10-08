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
      if (options.recoveryListFailure && input.path.includes('search=EXT-F-4130-'))
        return {
          token_matches: true,
          status: 503,
          list_complete: false,
          tables: [],
          owned_tables: [],
        };
      const owned =
        tableExists && !archived && (!options.notCreated || options.notCreatedMarked)
          ? [{ id: tableId, name: currentName }]
          : [];
      return {
        token_matches: true,
        status: 200,
        list_complete: !(options.cleanupListIncomplete && tableExists && !archived),
        tables: owned.filter((table) => table.name === input.name),
        owned_tables: input.path.includes('search=EXT-F-4130-') ? owned : [],
      };
    }
    if (input.method === 'POST' && input.path === '') {
      if (options.onCreateDispatch)
        await options.onCreateDispatch(await readFile(journalPath, 'utf8'));
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
      onFailure: options.onFailure,
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
    const receipt = await s.run(async ({ cleanupOwnedTable, ...fixture }) => {
      exercised = true;
      assert.equal(typeof cleanupOwnedTable, 'function');
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

test('owned fixture permits in-session approval cleanup and outer finally verifies absence without archiving twice', async () => {
  const s = await scenario();
  try {
    const receipt = await s.run(async ({ tableId: ownedTableId, cleanupOwnedTable }) => {
      const cleaned = await cleanupOwnedTable(ownedTableId);
      assert.deepEqual(cleaned, {
        archived_verified: true,
        same_principal: true,
        table_invisible: true,
      });
    });
    assert.equal(receipt.archived_verified, true);
    assert.equal(s.archiveAttempts, 1);
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

test('incomplete ownership detail after a write prevents archival and success', async () => {
  const s = await scenario({ cleanupListIncomplete: true });
  try {
    await assert.rejects(s.run(), /records_fixture_cleanup_list_incomplete/);
    assert.equal(s.archiveAttempts, 0);
    assert.equal(s.archived, false);
    const saved = JSON.parse(await readFile(s.journalPath, 'utf8'));
    assert.equal(saved.phase, 'row_owned');
    assert.equal(saved.table_id, tableId);
  } finally {
    await s.cleanup();
  }
});

test('fixture receipt retains both the first body failure and cleanup failure without response data', async () => {
  const diagnostics = [];
  const s = await scenario({ archiveFailure: true, onFailure: (entry) => diagnostics.push(entry) });
  try {
    await assert.rejects(
      s.run(async () => {
        throw new Error('records_fixture_private_value');
      }),
      /records_fixture_archive_failed/,
    );
    assert.deepEqual(diagnostics, [
      {
        boundary: 'body',
        phase: 'records_fixture_positive_reads',
        classification: 'records_fixture_unexpected_error',
        request_method: null,
        http_status: null,
      },
      {
        boundary: 'cleanup',
        phase: 'records_fixture_cleanup',
        classification: 'records_fixture_archive_failed',
        request_method: 'DELETE',
        http_status: 503,
      },
    ]);
    assert.equal(JSON.stringify(diagnostics).includes('records_fixture_private_value'), false);
  } finally {
    await s.cleanup();
  }
});

test('planned-journal recovery failure identifies its request and leaves fixture unwritten', async () => {
  const diagnostics = [];
  const s = await scenario({
    recoveryListFailure: true,
    onFailure: (entry) => diagnostics.push(entry),
  });
  try {
    await assert.rejects(s.run(), /records_fixture_recovery_list_failed/);
    assert.deepEqual(diagnostics, [
      {
        boundary: 'body',
        phase: 'records_fixture_recovery_list',
        classification: 'records_fixture_recovery_list_failed',
        request_method: 'GET',
        http_status: 503,
      },
    ]);
    assert.deepEqual(
      s.calls.map(({ method }) => method),
      ['GET'],
    );
    assert.equal(JSON.parse(await readFile(s.journalPath, 'utf8')).phase, 'planned');
  } finally {
    await s.cleanup();
  }
});

test('recovery GET browser exception reaches the receipt with a bounded cause and method', async () => {
  for (const [failure, classification] of [
    ['panel_runtime_exception', 'records_fixture_panel_runtime_exception'],
    ['private token=must-not-leak', 'records_fixture_request_exception'],
  ]) {
    const directory = await mkdtemp(join(tmpdir(), 'records-fixture-exception-'));
    const journalPath = join(directory, 'journal.json');
    const report = { fixture_diagnostics: [] };
    try {
      await assert.rejects(
        withRecordsPositiveFixture({
          panel: {},
          evaluate: async () => {
            throw new Error(failure);
          },
          orgId,
          principalId,
          bearerHash: 'a'.repeat(64),
          journalPath,
          exercise: async () => {
            throw new Error('unreachable positive read');
          },
          onFailure: (diagnostic) => report.fixture_diagnostics.push(diagnostic),
          id: () => runId,
          environment: {
            GITHUB_ACTIONS: 'true',
            RUNNER_ENVIRONMENT: 'github-hosted',
            MATRX_HOSTED_ACCEPTANCE_CASE: 'records-readonly-admin',
            MATRX_HOSTED_ACCEPTANCE_LANE: 'A',
          },
        }),
        (error) => error.message === failure,
      );
      assert.deepEqual(report.fixture_diagnostics, [
        {
          boundary: 'body',
          phase: 'records_fixture_recovery_list',
          classification,
          request_method: 'GET',
          http_status: null,
          transport_failure_class: null,
        },
      ]);
      assert.equal(JSON.parse(await readFile(journalPath, 'utf8')).phase, 'planned');
      assert.equal(JSON.stringify(report).includes('must-not-leak'), false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test('recovery GET reports the bounded browser preflight phase without exception text', async () => {
  for (const phase of ['token_read', 'token_digest']) {
    const directory = await mkdtemp(join(tmpdir(), 'records-fixture-preflight-'));
    const journalPath = join(directory, 'journal.json');
    const diagnostics = [];
    const evaluate = async (_panel, expression) =>
      new Function('chrome', 'crypto', 'fetch', `return ${expression};`)(
        {
          storage: {
            local: {
              get: async () => {
                if (phase === 'token_read') throw new Error('private token=must-not-leak');
                return { 'matrx.auth.accessToken': 'unit-test-token' };
              },
            },
          },
        },
        phase === 'token_digest'
          ? {
              subtle: {
                digest: async () => {
                  throw new Error('private token=must-not-leak');
                },
              },
            }
          : webcrypto,
        async () => {
          throw new Error('request must not start before preflight');
        },
      );
    try {
      await assert.rejects(
        withRecordsPositiveFixture({
          panel: {},
          evaluate,
          orgId,
          principalId,
          bearerHash: 'a'.repeat(64),
          journalPath,
          exercise: async () => {
            throw new Error('unreachable positive read');
          },
          onFailure: (diagnostic) => diagnostics.push(diagnostic),
          id: () => runId,
          environment: {
            GITHUB_ACTIONS: 'true',
            RUNNER_ENVIRONMENT: 'github-hosted',
            MATRX_HOSTED_ACCEPTANCE_CASE: 'records-readonly-admin',
            MATRX_HOSTED_ACCEPTANCE_LANE: 'A',
          },
        }),
        /records_fixture_browser_preflight_failed/,
      );
      assert.deepEqual(diagnostics, [
        {
          boundary: 'body',
          phase: 'records_fixture_recovery_list',
          classification: 'records_fixture_browser_preflight_failed',
          request_method: 'GET',
          http_status: null,
          browser_error_stage: phase,
        },
      ]);
      assert.equal(JSON.stringify(diagnostics).includes('must-not-leak'), false);
      assert.equal(JSON.parse(await readFile(journalPath, 'utf8')).phase, 'planned');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
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

test('crash at create dispatch keeps the durable unknown write through empty and late recovery', async () => {
  let dispatchJournal;
  const s = await scenario({
    onCreateDispatch: async (serialized) => {
      dispatchJournal = serialized;
    },
  });
  const directory = await mkdtemp(join(tmpdir(), 'records-crash-recovery-'));
  const journalPath = join(directory, 'journal.json');
  const environment = {
    GITHUB_ACTIONS: 'true',
    RUNNER_ENVIRONMENT: 'github-hosted',
    MATRX_HOSTED_ACCEPTANCE_CASE: 'records-readonly-admin',
    MATRX_HOSTED_ACCEPTANCE_LANE: 'A',
  };
  let visible = false;
  let archived = false;
  const methods = [];
  try {
    await s.run();
    const atDispatch = JSON.parse(dispatchJournal);
    assert.equal(atDispatch.phase, 'create_sent');
    assert.equal(atDispatch.table_id, null);
    assert.equal(atDispatch.pending_write_unknown, true);
    await writeFile(journalPath, dispatchJournal, { mode: 0o600 });
    const request = async (_panel, _evaluate, input) => {
      methods.push(input.method);
      const found = visible && !archived ? [{ id: tableId, name: atDispatch.name }] : [];
      if (input.method === 'GET')
        return {
          token_matches: true,
          status: 200,
          list_complete: true,
          tables: found.filter((item) => item.name === input.name),
          owned_tables: input.path.includes('search=EXT-F-4130-') ? found : [],
        };
      assert.equal(input.method, 'DELETE');
      assert.equal(input.path, `/${tableId}`);
      archived = true;
      return {
        token_matches: true,
        status: 200,
        done: true,
        archived: true,
        org_matches: true,
        id: tableId,
      };
    };
    const recover = () =>
      withRecordsPositiveFixture({
        panel: {},
        evaluate: async () => assert.fail('no page evaluation'),
        orgId,
        principalId,
        bearerHash: 'a'.repeat(64),
        journalPath,
        exercise: async () => assert.fail('recovery must not create or read'),
        request,
        environment,
      });
    await assert.rejects(recover(), /records_fixture_cleanup_unverified/);
    assert.deepEqual(methods, ['GET', 'GET', 'GET']);
    assert.equal(JSON.parse(await readFile(journalPath, 'utf8')).pending_write_unknown, true);
    visible = true;
    await assert.rejects(recover(), /records_fixture_recovery_cleanup_only/);
    assert.equal(archived, true);
    assert.equal(methods.includes('POST'), false);
    const recovered = JSON.parse(await readFile(journalPath, 'utf8'));
    assert.equal(recovered.phase, 'archived_verified');
    assert.equal(recovered.pending_write_unknown, false);
  } finally {
    await s.cleanup();
    await rm(directory, { recursive: true, force: true });
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
      await assert.rejects(
        s.run(),
        marked ? /records_fixture_table_not_created/ : /records_fixture_cleanup_unverified/,
      );
      assert.equal(s.archived, marked);
      const state = JSON.parse(await readFile(s.journalPath, 'utf8'));
      assert.equal(state.phase, marked ? 'archived_verified' : 'ownership_unverified');
      assert.equal(state.pending_write_unknown, !marked);
      const writes = s.calls.filter(({ method }) => method === 'POST').length;
      await assert.rejects(
        s.run(),
        marked ? /records_fixture_recovery_cleanup_only/ : /records_fixture_cleanup_unverified/,
      );
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

test('slow page fetch completes through short CDP commands without resending the request', async () => {
  const token = 'unit-test-token';
  let fetches = 0;
  let evaluations = 0;
  const evaluate = async (_panel, expression) => {
    evaluations++;
    return Promise.race([
      new Function('chrome', 'crypto', 'fetch', `return ${expression};`)(
        { storage: { local: { get: async () => ({ 'matrx.auth.accessToken': token }) } } },
        webcrypto,
        async () => {
          fetches++;
          await new Promise((resolve) => setTimeout(resolve, 65));
          return {
            status: 200,
            json: async () => ({ done: true, created: true, id: tableId, organization_id: orgId }),
          };
        },
      ),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('owned_cdp_transport_failed')), 20),
      ),
    ]);
  };
  const result = await recordsFixtureRequest({}, evaluate, {
    method: 'POST',
    path: '',
    body: { name: 'owned' },
    orgId,
    bearerHash: createHash('sha256').update(token).digest('hex'),
    name: 'owned',
    marker: recordsFixtureMarker(principalId, orgId),
    requestTimeoutMs: 500,
    pollIntervalMs: 5,
  });
  assert.equal(result.status, 200);
  assert.equal(result.id, tableId);
  assert.equal(fetches, 1);
  assert.ok(evaluations > 1);
});

test('timed-out create aborts once and leaves a durable ambiguous-write journal', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'records-fixture-timeout-'));
  const journalPath = join(directory, 'journal.json');
  const token = 'unit-test-token';
  const requests = [];
  const diagnostics = [];
  const evaluate = async (_panel, expression) =>
    new Function('chrome', 'crypto', 'fetch', `return ${expression};`)(
      { storage: { local: { get: async () => ({ 'matrx.auth.accessToken': token }) } } },
      webcrypto,
      async (_url, options) => {
        requests.push(options.method);
        if (options.method === 'GET')
          return { status: 200, json: async () => ({ tables: [], not_listed: [] }) };
        assert.equal(options.method, 'POST');
        return new Promise((_, reject) =>
          options.signal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          }),
        );
      },
    );
  try {
    await assert.rejects(
      withRecordsPositiveFixture({
        panel: {},
        evaluate,
        orgId,
        principalId,
        bearerHash: createHash('sha256').update(token).digest('hex'),
        journalPath,
        exercise: async () => assert.fail('positive reads must not run'),
        onFailure: (diagnostic) => diagnostics.push(diagnostic),
        request: (panel, evaluator, input) =>
          recordsFixtureRequest(panel, evaluator, {
            ...input,
            requestTimeoutMs: 45,
            pollIntervalMs: 5,
          }),
        id: () => runId,
        environment: {
          GITHUB_ACTIONS: 'true',
          RUNNER_ENVIRONMENT: 'github-hosted',
          MATRX_HOSTED_ACCEPTANCE_CASE: 'records-readonly-admin',
          MATRX_HOSTED_ACCEPTANCE_LANE: 'A',
        },
      }),
      /records_fixture_cleanup_unverified/,
    );
    assert.deepEqual(requests, ['GET', 'GET', 'POST', 'GET']);
    assert.deepEqual(
      diagnostics.map(({ boundary, phase, classification, request_method }) => ({
        boundary,
        phase,
        classification,
        request_method,
      })),
      [
        {
          boundary: 'body',
          phase: 'records_fixture_table_create',
          classification: 'records_fixture_request_timeout',
          request_method: 'POST',
        },
        {
          boundary: 'cleanup',
          phase: 'records_fixture_cleanup',
          classification: 'records_fixture_cleanup_unverified',
          request_method: 'GET',
        },
      ],
    );
    const saved = JSON.parse(await readFile(journalPath, 'utf8'));
    assert.equal(saved.phase, 'ownership_unverified');
    assert.equal(saved.pending_write_unknown, true);
    assert.equal(saved.table_id, null);
    const recoveryMethods = [];
    await assert.rejects(
      withRecordsPositiveFixture({
        panel: {},
        evaluate,
        orgId,
        principalId,
        bearerHash: createHash('sha256').update(token).digest('hex'),
        journalPath,
        exercise: async () => assert.fail('recovered run must not earn read credit'),
        request: async (_panel, _evaluate, input) => {
          recoveryMethods.push(input.method);
          return {
            token_matches: true,
            status: 200,
            list_complete: true,
            tables: [],
            owned_tables: [],
          };
        },
        environment: {
          GITHUB_ACTIONS: 'true',
          RUNNER_ENVIRONMENT: 'github-hosted',
          MATRX_HOSTED_ACCEPTANCE_CASE: 'records-readonly-admin',
          MATRX_HOSTED_ACCEPTANCE_LANE: 'A',
        },
      }),
      /records_fixture_cleanup_unverified/,
    );
    assert.deepEqual(recoveryMethods, ['GET', 'GET', 'GET']);
    assert.equal(JSON.parse(await readFile(journalPath, 'utf8')).pending_write_unknown, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('page-local recovery scan verifies omitted list descriptions through canonical detail', async () => {
  const token = 'unit-test-token';
  const name = `EXT-F-4130-${runId}`;
  const foreign = '7b591026-9c8d-4437-9d28-caa508ee5d72';
  const marker = recordsFixtureMarker(principalId, orgId);
  const requests = [];
  const evaluate = async (_panel, expression) =>
    new Function('chrome', 'crypto', 'fetch', `return ${expression};`)(
      { storage: { local: { get: async () => ({ 'matrx.auth.accessToken': token }) } } },
      webcrypto,
      async (url) => {
        requests.push(url);
        if (url.endsWith('/columns'))
          return {
            status: 200,
            json: async () => ({ id: tableId, name, description: marker }),
          };
        return {
          status: 200,
          json: async () => ({
            not_listed: [],
            tables: [
              { id: tableId, name, description: null, organization_id: orgId, kind: 'custom' },
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
        };
      },
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
  assert.equal(requests.filter((url) => url.endsWith('/columns')).length, 1);
  assert.doesNotMatch(JSON.stringify(result), /someone else|Customer records/);
});

test('the real page request path archives a listed fixture whose description is omitted', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'records-detail-cleanup-'));
  const journalPath = join(directory, 'journal.json');
  const token = 'unit-test-token';
  const marker = recordsFixtureMarker(principalId, orgId);
  let exists = false;
  let archiveCalls = 0;
  const requests = [];
  const evaluate = async (_panel, expression) =>
    new Function('chrome', 'crypto', 'fetch', `return ${expression};`)(
      { storage: { local: { get: async () => ({ 'matrx.auth.accessToken': token }) } } },
      webcrypto,
      async (url, options) => {
        requests.push({ url, method: options.method ?? 'GET' });
        if (url.endsWith('/columns'))
          return {
            status: 200,
            json: async () => ({ id: tableId, name: `EXT-F-4130-${runId}`, description: marker }),
          };
        if (options.method === 'GET')
          return {
            status: 200,
            json: async () => ({
              tables: exists
                ? [
                    {
                      id: tableId,
                      name: `EXT-F-4130-${runId}`,
                      description: null,
                      organization_id: orgId,
                      kind: 'custom',
                    },
                  ]
                : [],
              not_listed: [],
            }),
          };
        if (options.method === 'POST' && url.endsWith('/rows'))
          return {
            status: 201,
            json: async () => ({
              done: true,
              row: { id: rowId, version: 1, values: { Name: `EXT-F-4130-${runId}-row` } },
            }),
          };
        if (options.method === 'POST') {
          assert.equal(JSON.parse(options.body).description, marker);
          exists = true;
          return {
            status: 200,
            json: async () => ({ done: true, created: true, organization_id: orgId, id: tableId }),
          };
        }
        if (options.method === 'DELETE') {
          archiveCalls++;
          assert.equal(url, `https://server.app.matrxserver.com/api/v1/tables/${tableId}`);
          exists = false;
          return {
            status: 200,
            json: async () => ({ done: true, archived: true, organization_id: orgId, id: tableId }),
          };
        }
        throw new Error('unexpected request');
      },
    );
  try {
    let exercised = false;
    const receipt = await withRecordsPositiveFixture({
      panel: {},
      evaluate,
      orgId,
      principalId,
      bearerHash: createHash('sha256').update(token).digest('hex'),
      journalPath,
      id: () => runId,
      environment: {
        GITHUB_ACTIONS: 'true',
        RUNNER_ENVIRONMENT: 'github-hosted',
        MATRX_HOSTED_ACCEPTANCE_CASE: 'records-readonly-admin',
        MATRX_HOSTED_ACCEPTANCE_LANE: 'A',
      },
      exercise: async ({ tableId: observedTable, rowId: observedRow }) => {
        exercised = true;
        assert.equal(observedTable, tableId);
        assert.equal(observedRow, rowId);
      },
    });
    assert.equal(exercised, true);
    assert.equal(receipt.archived_verified, true);
    assert.equal(archiveCalls, 1);
    assert.equal(exists, false);
    assert.equal(requests.filter(({ url }) => url.endsWith('/columns')).length, 1);
    assert.equal(JSON.parse(await readFile(journalPath, 'utf8')).phase, 'archived_verified');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('foreign marker on a same-name table refuses creation and archival', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'records-foreign-detail-'));
  const journalPath = join(directory, 'journal.json');
  const token = 'unit-test-token';
  const requests = [];
  const evaluate = async (_panel, expression) =>
    new Function('chrome', 'crypto', 'fetch', `return ${expression};`)(
      { storage: { local: { get: async () => ({ 'matrx.auth.accessToken': token }) } } },
      webcrypto,
      async (url, options) => {
        requests.push(options.method ?? 'GET');
        if (url.endsWith('/columns'))
          return {
            status: 200,
            json: async () => ({
              id: tableId,
              name: `EXT-F-4130-${runId}`,
              description: 'foreign marker',
            }),
          };
        return {
          status: 200,
          json: async () => ({
            not_listed: [],
            tables: [
              {
                id: tableId,
                name: `EXT-F-4130-${runId}`,
                description: null,
                organization_id: orgId,
                kind: 'custom',
              },
            ],
          }),
        };
      },
    );
  try {
    await assert.rejects(
      withRecordsPositiveFixture({
        panel: {},
        evaluate,
        orgId,
        principalId,
        bearerHash: createHash('sha256').update(token).digest('hex'),
        journalPath,
        id: () => runId,
        environment: {
          GITHUB_ACTIONS: 'true',
          RUNNER_ENVIRONMENT: 'github-hosted',
          MATRX_HOSTED_ACCEPTANCE_CASE: 'records-readonly-admin',
          MATRX_HOSTED_ACCEPTANCE_LANE: 'A',
        },
        exercise: async () => assert.fail('must not read'),
      }),
      /records_fixture_name_not_unique/,
    );
    assert.deepEqual(requests, ['GET', 'GET', 'GET', 'GET']);
    assert.equal(JSON.parse(await readFile(journalPath, 'utf8')).phase, 'planned');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('unavailable or mismatched detail cannot turn a visible candidate into a complete list', async () => {
  const token = 'unit-test-token';
  const name = `EXT-F-4130-${runId}`;
  const marker = recordsFixtureMarker(principalId, orgId);
  for (const detail of [
    { status: 503, body: null },
    { status: 200, body: { id: rowId, name, description: marker } },
    { status: 200, body: { id: tableId, name: 'different table', description: marker } },
  ]) {
    const evaluate = async (_panel, expression) =>
      new Function('chrome', 'crypto', 'fetch', `return ${expression};`)(
        { storage: { local: { get: async () => ({ 'matrx.auth.accessToken': token }) } } },
        webcrypto,
        async (url) =>
          url.endsWith('/columns')
            ? { status: detail.status, json: async () => detail.body }
            : {
                status: 200,
                json: async () => ({
                  not_listed: [],
                  tables: [
                    {
                      id: tableId,
                      name,
                      description: null,
                      organization_id: orgId,
                      kind: 'custom',
                    },
                  ],
                }),
              },
      );
    const result = await recordsFixtureRequest({}, evaluate, {
      method: 'GET',
      path: `?organization=${orgId}&search=${name}`,
      orgId,
      bearerHash: createHash('sha256').update(token).digest('hex'),
      name,
      marker,
    });
    assert.equal(result.list_complete, false);
    assert.deepEqual(result.tables, []);
    assert.equal(result.name_candidates, 1);
  }
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
