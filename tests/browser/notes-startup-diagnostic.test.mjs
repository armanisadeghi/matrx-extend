import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runNativeSidepanelQa as realNativeRunner } from './native-sidepanel-qa-harness.mjs';
import {
  notesNativeStartupOperation,
  notesStartupErrorCategory,
} from './notes-startup-diagnostic.mjs';

const source = await readFile(new URL('./notes-native-acceptance.mjs', import.meta.url), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
// SUT: actual Notes driver startup orchestration and persisted failure report.
// Filesystem, provenance service and browser are external. No Notes product credit.
async function drive(failureAt, error, nativeStage = 'cdp_connect') {
  const report = { status: 'unverified', observations: {}, build: null };
  const process = {
    exitCode: 0,
    env: { NOTES_EXPECTED_CI_RUN_ID: '12', NOTES_EXPECTED_ARTIFACT_ID: '34' },
    stdout: { write() {} },
  };
  let persisted;
  let browserCalls = 0;
  const run = new AsyncFunction(
    'deps',
    `
    const { report, process, assert, notesNativeStartupOperation, notesStartupErrorCategory,
      verifyImportedNativeEvidence, runNativeSidepanelQa, writeFile, signInSettings } = deps;
    const HOSTED_FIND = true, ROLE = 'member', CASE = 't02', RECEIPT = '/owned/receipt',
      EXPECTED_SOURCE_SHA = 'a'.repeat(40), REPO = '/owned', OUTPUT = '/owned/report';
    let stage = 'receipt';
    ${source.match(/let startupPending = true;/)?.[0] ?? ''}
    const before = { extensionDir: '/owned/build' };
    const identity = async () => before;
    const supabaseOrigin = async () => { if (deps.failureAt === 'origin') throw deps.error; return 'https://db.matrxserver.com'; };
    const privateConfig = async () => null;
    const fail = (code) => { report.failure_code = code; throw new Error('notes_native_unverified'); };
    const mkdir = async () => {}, join = (...parts) => parts.join('/');
    ${source.slice(source.indexOf('try {\n  const before = await identity();'))}
  `,
  );
  await run({
    failureAt,
    error,
    report,
    process,
    assert,
    notesNativeStartupOperation,
    notesStartupErrorCategory,
    verifyImportedNativeEvidence: async () => {
      if (failureAt === 'artifact') throw error;
      return {
        sourceSha: 'a'.repeat(40),
        runId: failureAt === 'provenance' ? 0 : 12,
        artifactId: 34,
      };
    },
    runNativeSidepanelQa: async (options) => {
      browserCalls++;
      if (failureAt === 'native-real') return realNativeRunner(options);
      options.onStage?.(nativeStage);
      if (failureAt === 'authentication') return options.exercisePanel({});
      throw error;
    },
    signInSettings: async () => {
      throw error;
    },
    writeFile: async (_path, value) => {
      persisted = JSON.parse(value);
    },
  });
  return { persisted, exitCode: process.exitCode, browserCalls };
}

for (const [failureAt, error, nativeStage, operation, category] of [
  [
    'artifact',
    Object.assign(new Error('private token https://private.invalid/?auth=hidden'), {
      code: 'ENOENT',
    }),
    null,
    'imported_artifact_verify',
    'filesystem_missing',
  ],
  [
    'origin',
    new SyntaxError('private configuration'),
    null,
    'supabase_origin_read',
    'syntax_error',
  ],
  ['native-real', new Error('unused'), null, 'native_receipt', 'operation_failed'],
  ['provenance', new Error('unused'), null, 'hosted_provenance_verify', 'assertion_failed'],
  [
    'native',
    Object.assign(new Error('https://private.invalid/one-use-link'), { name: 'TimeoutError' }),
    'cdp_connect',
    'native_cdp_connect',
    'timeout_error',
  ],
  [
    'native',
    Object.assign(new Error('private auth value'), { code: 'untrusted-secret-code' }),
    'https://private.invalid/auth',
    'native_operation_unknown',
    'operation_failed',
  ],
]) {
  test(`startup persists fixed operation ${operation} with safe category ${category}`, async () => {
    const { persisted, exitCode, browserCalls } = await drive(failureAt, error, nativeStage);
    assert.deepEqual(
      persisted.observations.startup_failure,
      { operation, category },
      'startup diagnostic missing or incorrectly attributed',
    );
    assert.equal(persisted.failure_stage, operation);
    assert.equal(persisted.status, 'unverified');
    assert.equal(persisted.failure_code, 'stage_operation_failed');
    assert.equal(exitCode, 1);
    assert.equal(browserCalls, failureAt.startsWith('native') ? 1 : 0);
    assert.equal(persisted.build.after, null);
    assert.doesNotMatch(JSON.stringify(persisted.observations), /private|https:|hidden|auth/);
  });
}

test('authentication failures stay outside the startup diagnostic boundary', async () => {
  const { persisted, exitCode } = await drive(
    'authentication',
    new Error('private authentication'),
    'exercise_panel',
  );
  assert.equal(persisted.observations.startup_failure, undefined);
  assert.equal(persisted.failure_stage, 'real_signin');
  assert.equal(persisted.failure_code, 'stage_operation_failed');
  assert.equal(persisted.status, 'unverified');
  assert.equal(exitCode, 1);
});
