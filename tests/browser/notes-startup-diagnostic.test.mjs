import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  observeOwnedEndpointAfterTimeout,
  runNativeSidepanelQa as realNativeRunner,
} from './native-sidepanel-qa-harness.mjs';
import {
  notesEndpointObservationEnabled,
  notesNativeStartupOperation,
  notesStartupErrorCategory,
  safeNotesEndpointObservation,
} from './notes-startup-diagnostic.mjs';

const source = await readFile(new URL('./notes-native-acceptance.mjs', import.meta.url), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
// SUT: actual Notes driver startup orchestration and persisted failure report.
// Filesystem, provenance service and browser are external. No Notes product credit.
async function drive(failureAt, error, nativeStage = 'cdp_connect', diagnostic = false) {
  const report = { status: 'unverified', observations: {}, build: null };
  const process = {
    exitCode: 0,
    env: {
      NOTES_EXPECTED_CI_RUN_ID: '12',
      NOTES_EXPECTED_ARTIFACT_ID: '34',
      NOTES_HOSTED_FIND: '1',
      MATRX_HOSTED_ACCEPTANCE_LANE: 'A',
      MATRX_CDP_STARTUP_DIAGNOSTIC: diagnostic ? '1' : '0',
    },
    stdout: { write() {} },
  };
  let persisted;
  let browserCalls = 0;
  const run = new AsyncFunction(
    'deps',
    `
    const { report, process, assert, notesEndpointObservationEnabled,
      notesNativeStartupOperation, notesStartupErrorCategory, safeNotesEndpointObservation,
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
    notesEndpointObservationEnabled,
    safeNotesEndpointObservation,
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
      if (diagnostic && failureAt === 'native') {
        assert.equal(options.startupEndpointObservationMs, 15_000);
        for (const value of [
          {
            phase: 'cdp_timeout',
            endpointPresent: false,
            inspectionFailed: false,
            exitObserved: false,
            elapsedMs: 8006,
            polls: 218,
          },
          {
            phase: 'post_timeout',
            endpointPresent: true,
            inspectionFailed: false,
            exitObserved: false,
            elapsedMs: 1250,
            polls: 13,
            privatePath: '/owned/profile/DevToolsActivePort',
            pid: 123,
          },
        ])
          options.onStartupEndpointObservation(value);
      } else assert.equal(options.onStartupEndpointObservation, undefined);
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

test('Notes A retains late endpoint evidence after the original timeout remains unverified', async () => {
  const original = new Error('owned_cdp_endpoint_timeout');
  const { persisted, exitCode } = await drive('native', original, 'cdp_connect', true);
  assert.equal(persisted.status, 'unverified');
  assert.equal(exitCode, 1);
  assert.equal(persisted.failure_stage, 'native_cdp_connect');
  assert.deepEqual(
    persisted.observations.startup_endpoint.map(({ outcome }) => outcome),
    ['timed_out', 'late_endpoint'],
  );
  assert.equal(persisted.observations.startup_endpoint[1].elapsedMs, 1250);
  assert.doesNotMatch(JSON.stringify(persisted), /DevToolsActivePort|\/owned\/profile|"pid"/);
  const ordinary = await drive('native', original);
  assert.equal(ordinary.persisted.observations.startup_endpoint, undefined);
});

test('post-timeout observation classifies exit and stall without private values', () => {
  const base = {
    phase: 'post_timeout',
    endpointPresent: false,
    inspectionFailed: false,
    exitObserved: false,
    elapsedMs: 15_000,
    polls: 150,
    pid: 123,
  };
  assert.equal(safeNotesEndpointObservation(base).outcome, 'still_absent');
  assert.equal(
    safeNotesEndpointObservation({ ...base, exitObserved: true }).outcome,
    'child_exited',
  );
  assert.equal(
    safeNotesEndpointObservation({ ...base, inspectionFailed: true }).outcome,
    'inspection_failed',
  );
  assert.equal(Object.hasOwn(safeNotesEndpointObservation(base), 'pid'), false);
  assert.equal(
    notesEndpointObservationEnabled({
      NOTES_HOSTED_FIND: '1',
      MATRX_HOSTED_ACCEPTANCE_LANE: 'A',
      MATRX_CDP_STARTUP_DIAGNOSTIC: '1',
    }),
    true,
  );
  for (const env of [
    {
      NOTES_HOSTED_FIND: '0',
      MATRX_HOSTED_ACCEPTANCE_LANE: 'A',
      MATRX_CDP_STARTUP_DIAGNOSTIC: '1',
    },
    {
      NOTES_HOSTED_FIND: '1',
      MATRX_HOSTED_ACCEPTANCE_LANE: 'B',
      MATRX_CDP_STARTUP_DIAGNOSTIC: '1',
    },
    {
      NOTES_HOSTED_FIND: '1',
      MATRX_HOSTED_ACCEPTANCE_LANE: 'A',
      MATRX_CDP_STARTUP_DIAGNOSTIC: '0',
    },
  ])
    assert.equal(notesEndpointObservationEnabled(env), false);
});

test('owned post-timeout poller observes late publication, child exit, and a bounded stall', async () => {
  const missing = () => {
    throw Object.assign(new Error('private path'), { code: 'ENOENT' });
  };
  async function observe({
    publishOnPoll = Number.POSITIVE_INFINITY,
    exitOnPoll = Number.POSITIVE_INFINITY,
    failOnPoll = Number.POSITIVE_INFINITY,
  }) {
    let elapsedMs = 0;
    let polls = 0;
    const child = { exitCode: null, signalCode: null };
    const value = await observeOwnedEndpointAfterTimeout({
      profile: '/private/owned-profile',
      child,
      windowMs: 300,
      clock: { now: () => elapsedMs },
      sleep: async (ms) => {
        elapsedMs += ms;
      },
      fileSystem: {
        lstat: async () => {
          polls++;
          if (polls === exitOnPoll) child.exitCode = 1;
          if (polls === failOnPoll)
            throw Object.assign(new Error('private path'), { code: 'EACCES' });
          if (polls < publishOnPoll) missing();
        },
      },
    });
    assert.ok(value.elapsedMs <= 300, 'observation exceeded its bounded window');
    assert.equal(value.polls, polls);
    assert.doesNotMatch(JSON.stringify(value), /private|owned-profile|"pid"/);
    return safeNotesEndpointObservation(value);
  }
  assert.deepEqual(
    [
      (await observe({ publishOnPoll: 3 })).outcome,
      (await observe({ exitOnPoll: 2 })).outcome,
      (await observe({})).outcome,
      (await observe({ failOnPoll: 2 })).outcome,
    ],
    ['late_endpoint', 'child_exited', 'still_absent', 'inspection_failed'],
  );
});
