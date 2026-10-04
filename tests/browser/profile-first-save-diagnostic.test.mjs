import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { assertFirstSaveIdentity } from './profile-empty-row-restoration.mjs';
import { runProfileExecutionBoundary } from './profile-native-failure.mjs';

const source = await readFile(new URL('./profile-native-acceptance.mjs', import.meta.url), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const start = source.indexOf('if (!initialRow.row_present) {');
const end = source.indexOf('const marker =', start);
assert.ok(start >= 0 && end > start);
const gate = source.slice(start, end);
const userId = 'db4a31ad-6b18-4d33-a296-593f1e7288c9';
const organizationId = 'edb9a817-d8c1-4d2c-8205-af047333fd60';

// SUT is the actual runner chain through identity, config, owner read and its
// real failure boundary. Only filesystem/config and browser I/O are replaced.
for (const [fault, operation, kind] of [
  ['identity', 'first_save_identity', 'assertion'],
  ['config', 'first_save_api_config', 'file_missing'],
  ['read', 'first_save_owner_read_before_write', 'type_error'],
  ['row', 'first_save_owner_read_before_write', 'assertion'],
  ['none', 'first_save_owner_read_before_write', null],
]) {
  test(`first-save ${fault} boundary cannot collapse into warm_profile or expose private errors`, async () => {
    const report = { stage: 'profile' };
    const calls = [];
    const run = new AsyncFunction(
      'assert',
      'assertFirstSaveIdentity',
      'runProfileExecutionBoundary',
      'report',
      'fault',
      'calls',
      'userId',
      'organizationId',
      `
      let executionOperation = 'warm_profile';
      let ownerConfig;
      const initialRow = { row_present: false };
      const AUTH_MODE = 'admin';
      const identity = { userId, email: 'admin@admin.com' };
      const stored = { profileId: userId, isAdmin: true, accessTokenPresent: fault !== 'identity', organizationId, organizationName: 'Matrx Org' };
      const selectedOrg = 'Matrx Org';
      const panel = {};
      const profileApiConfig = async () => { calls.push('config'); if (fault === 'config') throw Object.assign(new Error('private-config-secret'), { code: 'ENOENT' }); return {url:'https://db.invalid',key:'private-key'}; };
      const readProfileOwnerRow = async (_panel, config, owner) => { calls.push('read'); assert.equal(config.organizationId, organizationId); assert.equal(owner, userId); if (fault === 'read') throw new TypeError('private-transport-secret'); return fault === 'row' ? { private: 'private-row' } : null; };
      return runProfileExecutionBoundary(report, async () => { ${gate} } }, { getOperation: () => executionOperation, readUiState: async () => null });
    `,
    );
    const error = await run(
      assert,
      assertFirstSaveIdentity,
      runProfileExecutionBoundary,
      report,
      fault,
      calls,
      userId,
      organizationId,
    );
    assert.deepEqual(
      calls,
      fault === 'identity' ? [] : fault === 'config' ? ['config'] : ['config', 'read'],
    );
    if (fault === 'none') {
      assert.equal(error, null);
      assert.equal(report.execution_failure, undefined);
    } else {
      assert.equal(report.execution_failure.operation, operation);
      assert.equal(report.execution_failure.cause_kind, kind);
      assert.equal(JSON.stringify(report).includes('private-'), false);
    }
  });
}

test('no-write cleanup reports no mutation without inventing a final readback', async () => {
  const start = source.indexOf('} else if (!pendingMarker && !initialRow.row_present) {');
  const end = source.indexOf('\n      } catch (error)', start);
  assert.ok(start >= 0 && end > start);
  const report = {};
  await new AsyncFunction(
    'report',
    `const pendingMarker = null; const initialRow = { row_present: false }; if (false) { ${source.slice(start, end)}`,
  )(report);
  assert.deepEqual(report.restoration, {
    verified: false,
    mutation_not_attempted: true,
    final_readback_performed: false,
  });
});

// Execute the actual connected owner-read helpers and actual Runtime.evaluate
// adapter. CDP is the external dependency; no replacement owns the diagnostics.
for (const refused of [true, false]) {
  test(`owner read records fixed runtime failure only when CDP refuses: ${refused}`, async () => {
    const { evaluate } = await import('./settings-panel-driver.mjs');
    const report = { stage: 'profile' };
    let sends = 0;
    const panel = {
      async send(method) {
        assert.equal(method, 'Runtime.evaluate');
        sends++;
        if (refused) return { exceptionDetails: { text: 'private-runtime-secret' } };
        return { result: { value: { ok: true, status: 200, rows: [] } } };
      },
    };
    const start = source.indexOf('async function profileOwnerRequest(');
    const end = source.indexOf('async function deleteOwnedProfileRow(', start);
    const run = new AsyncFunction(
      'assert',
      'evaluate',
      'panel',
      'runProfileExecutionBoundary',
      'report',
      `
      ${source.slice(start, end)}
      return runProfileExecutionBoundary(report, async () => {
        const row = await readProfileOwnerRow(panel, { url: 'https://db.invalid', key: 'private-key', organizationId: '${organizationId}' }, '${userId}');
        assert.equal(row, null);
      }, {getOperation: () => 'first_save_owner_read_before_write', readUiState: async () => null});
    `,
    );
    const error = await run(assert, evaluate, panel, runProfileExecutionBoundary, report);
    assert.equal(sends, 1);
    if (refused) {
      assert.equal(report.execution_failure_code, 'profile_owner_runtime_evaluation_failed');
      assert.equal(report.execution_failure.owner_request, 'runtime_evaluation_failed');
      assert.equal(error.cause.message, 'panel_runtime_exception');
      assert.equal(JSON.stringify(report).includes('private-'), false);
    } else {
      assert.equal(error, null);
      assert.equal(report.execution_failure, undefined);
    }
  });
}

for (const fault of [
  'storage',
  'token_missing',
  'fetch',
  'http_status',
  'response_json',
  'row_shape',
  'none',
]) {
  test(`actual browser owner request distinguishes ${fault} without private payload`, async () => {
    const { runInNewContext } = await import('node:vm');
    const { evaluate } = await import('./settings-panel-driver.mjs');
    const report = { stage: 'profile' };
    const calls = [];
    const reject = () => {
      throw new Error('private-runtime-secret');
    };
    const panel = {
      async send(_method, { expression }) {
        const value = await runInNewContext(expression, {
          chrome: {
            storage: {
              local: {
                async get() {
                  calls.push('storage');
                  if (fault === 'storage') reject();
                  return {
                    'matrx.auth.accessToken': fault === 'token_missing' ? null : 'private-token',
                  };
                },
              },
            },
          },
          async fetch() {
            calls.push('fetch');
            if (fault === 'fetch') reject();
            return {
              ok: fault !== 'http_status',
              status: fault === 'http_status' ? 403 : 200,
              async json() {
                calls.push('json');
                if (fault === 'response_json') reject();
                return fault === 'row_shape' ? { private: 'private-row' } : [];
              },
            };
          },
        });
        return { result: { value } };
      },
    };
    const start = source.indexOf('async function profileOwnerRequest(');
    const end = source.indexOf('async function deleteOwnedProfileRow(', start);
    const run = new AsyncFunction(
      'assert',
      'evaluate',
      'panel',
      'runProfileExecutionBoundary',
      'report',
      `
      ${source.slice(start, end)}
      return runProfileExecutionBoundary(report, async () => {
        assert.equal(await readProfileOwnerRow(panel, { url:'https://db.invalid', key:'private-key', organizationId:'${organizationId}' }, '${userId}'), null);
      }, {getOperation: () => 'first_save_owner_read_before_write', readUiState: async () => null});
    `,
    );
    const error = await run(assert, evaluate, panel, runProfileExecutionBoundary, report);
    assert.deepEqual(
      calls,
      ['storage', 'token_missing'].includes(fault)
        ? ['storage']
        : ['fetch', 'http_status'].includes(fault)
          ? ['storage', 'fetch']
          : ['storage', 'fetch', 'json'],
    );
    if (fault === 'none') assert.equal(error, null);
    else {
      assert.equal(report.execution_failure.owner_request, fault);
      assert.equal(
        report.execution_failure.owner_status,
        fault === 'http_status' ? 403 : fault === 'row_shape' ? 200 : null,
      );
      assert.equal(report.execution_failure_code, 'profile_owner_request_failed');
    }
    assert.equal(JSON.stringify(report).includes('private-'), false);
  });
}
