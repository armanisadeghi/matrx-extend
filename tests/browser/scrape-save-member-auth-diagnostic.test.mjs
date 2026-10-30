import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  recordScrapeMemberAuthFailure,
  recordScrapeSaveCheckpoint,
  recordScrapeSaveFailure,
  writeScrapeSaveReport,
} from './scrape-save-auth-report.mjs';
import { runMemberAuthBoundary } from './settings-member-auth-diagnostic.mjs';

const staleGuestSource = await readFile(
  new URL('./scrape-save-stale-profile.mjs', import.meta.url),
  'utf8',
);
const staleGuestProducer = staleGuestSource
  .slice(
    staleGuestSource.indexOf('/** Remove credentials'),
    staleGuestSource.indexOf('/** Passive'),
  )
  .replaceAll('export async function', 'async function');
const prepareGuestCall = (
  await readFile(new URL('./scrape-save-native-acceptance.mjs', import.meta.url), 'utf8')
).match(/panel = await prepareStaleProfileGuest\([\s\S]*?\n {10}\);/);
assert.ok(prepareGuestCall, 'actual D217 preparation caller required');
const retryStart = staleGuestSource.indexOf('export async function exerciseStaleProfileRetry');
const reloadStart = staleGuestSource.indexOf('    const replacement = ', retryStart);
const retryGuestProducer = staleGuestSource.slice(
  reloadStart,
  staleGuestSource.indexOf('    observer = observeStaleProfileRequests', reloadStart),
);
const retryProgress = (
  await readFile(new URL('./scrape-save-native-acceptance.mjs', import.meta.url), 'utf8')
).match(/onStaleGuestProgress: ([\s\S]*?),\n {12}onPanel:/);
assert.ok(retryProgress, 'actual D217 postreload progress caller required');

// The coordinator is testing an expired-session Scrape retry in the disposable member profile.
// Browser IO is external; real preparation/assertion ordering, predicates and atomic publication run.
async function staleGuestBoundary({
  outputDir,
  failAt,
  context = 'prepare',
  hold,
  producer = staleGuestProducer,
}) {
  const report = { stage: 'member_auth', observations: { d217: {} } };
  const panel = {};
  const phases = [];
  const checkpoint = (report, kind, value) => {
    phases.push(value.phase);
    recordScrapeSaveCheckpoint(report, kind, value, outputDir);
  };
  const probe = async (phase) => {
    if (phase !== failAt) return;
    const pending = JSON.parse(
      await readFile(join(outputDir, 'scrape-save-native-acceptance.json'), 'utf8'),
    );
    assert.equal(pending.stale_guest_progress.phase, phase);
    if (hold) await hold();
    throw new Error('private-browser-error-url-and-token');
  };
  const { prepareStaleProfileGuest, assertStaleGuest } = new Function(
    'assert',
    'evaluate',
    'click',
    'openSection',
    'waitFor',
    'accountIdentity',
    `${producer}\nreturn { prepareStaleProfileGuest, assertStaleGuest };`,
  )(
    assert,
    async (_panel, expression) => {
      if (expression.includes('credentials_removed')) {
        await probe('credentials_remove');
        return { credentials_removed: true, ignored_secret: 'private-browser-error-url-and-token' };
      }
      await probe('storage_read');
      return {
        profile_matches: true,
        oauth_absent: failAt !== 'storage_assertion',
        legacy_bearer_absent: true,
        supabase_sessions_absent: true,
      };
    },
    async (_panel, _kind, label) => probe(label === 'Settings' ? 'settings_click' : 'scrape_click'),
    async () => probe('account_open'),
    async (_label, read, accept) => {
      await probe('rendered_guest');
      const state = await read();
      assert.equal(accept(state), true);
      return state;
    },
    async () => ({ signInEnabled: true, signOutVisible: false }),
  );
  const native = {
    panel,
    resourceAction: (action) => action(),
    reloadExtension: async () => {
      await probe('extension_reload');
      return {
        panel,
        management_reload_clicked: true,
        worker_replaced: true,
        old_targets_retired: true,
      };
    },
  };
  const run =
    context === 'prepare'
      ? new Function(
          'native',
          'identity',
          'report',
          'prepareStaleProfileGuest',
          'recordScrapeSaveCheckpoint',
          `return (async () => { let panel; ${prepareGuestCall[0]} return panel; })();`,
        )(native, { profileId: 'private-profile-id' }, report, prepareStaleProfileGuest, checkpoint)
      : new Function(
          'native',
          'panel',
          'identity',
          'onPanel',
          'evidence',
          'assertStaleGuest',
          'onStaleGuestProgress',
          `return (async () => { ${retryGuestProducer} return panel; })();`,
        )(
          native,
          panel,
          { profileId: 'private-profile-id' },
          () => {},
          {},
          assertStaleGuest,
          new Function('report', 'recordScrapeSaveCheckpoint', `return (${retryProgress[1]});`)(
            report,
            checkpoint,
          ),
        );
  return { report, run, phases, panel };
}

async function requireStaleGuestFailure(result, outputDir, phase, context) {
  await assert.rejects(result.run);
  const raw = await readFile(join(outputDir, 'scrape-save-native-acceptance.json'), 'utf8');
  const pending = JSON.parse(raw);
  assert.equal(pending.status, 'unverified');
  assert.equal(
    pending.stage,
    `stale_profile_guest_${context === 'prepare' ? 'prepare' : 'postreload'}`,
  );
  assert.equal(pending.stale_guest_progress.phase, phase);
  assert.equal(pending.diagnostic_progress.latest.label, `${context}:${phase}`);
  if (phase === 'storage_assertion') assert.equal(pending.stale_guest_progress.oauth_absent, false);
  assert.equal(raw.includes('private-'), false);
  assert.equal(result.report.auth_failure, undefined);
}

test('actual D217 caller durably identifies the failed postauth browser or storage boundary', async () => {
  for (const [phase, context] of [
    ['settings_click', 'prepare'],
    ['account_open', 'postreload_retry'],
    ['storage_assertion', 'prepare'],
  ]) {
    const outputDir = await mkdtemp(join(tmpdir(), 'scrape-stale-guest-'));
    try {
      const result = await staleGuestBoundary({ outputDir, failAt: phase, context });
      await requireStaleGuestFailure(result, outputDir, phase, context);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
});

test('stale guest guard rejects missing progress, skipped storage assertion and return-expected mutants in memory', async () => {
  for (const [producer, phase] of [
    [staleGuestProducer.replace(/^ {2}onProgress\([^\n]*\);\n/gm, ''), 'settings_click'],
    [
      staleGuestProducer.replace(
        / {2}assert.equal\(\n {4}Object.values\(stored\).every\(Boolean\),[\s\S]*?\n {2}\);/,
        '',
      ),
      'storage_assertion',
    ],
    [
      staleGuestProducer.replace(
        /async function prepareStaleProfileGuest[\s\S]*?\n}\n/,
        'async function prepareStaleProfileGuest(native) { return native.panel; }\n',
      ),
      'settings_click',
    ],
  ]) {
    assert.notEqual(producer, staleGuestProducer, 'mutation must reach actual producer');
    const outputDir = await mkdtemp(join(tmpdir(), 'scrape-stale-guest-mutant-'));
    try {
      const result = await staleGuestBoundary({ outputDir, failAt: phase, producer });
      await assert.rejects(() => requireStaleGuestFailure(result, outputDir, phase, 'prepare'));
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
});

test('actual D217 caller publishes before blocked browser IO and completes only after original predicates', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'scrape-stale-guest-pending-'));
  let release;
  let entered;
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  try {
    const result = await staleGuestBoundary({
      outputDir,
      failAt: 'settings_click',
      hold: async () => {
        entered();
        await blocked;
      },
    });
    const rejected = assert.rejects(result.run);
    await ready;
    const pending = JSON.parse(
      await readFile(join(outputDir, 'scrape-save-native-acceptance.json'), 'utf8'),
    );
    assert.equal(pending.stale_guest_progress.phase, 'settings_click');
    assert.equal(result.phases.includes('complete'), false);
    release();
    await rejected;
    const success = await staleGuestBoundary({ outputDir });
    assert.equal(await success.run, success.panel);
    assert.deepEqual(success.phases, [
      'credentials_remove',
      'credentials_assertion',
      'extension_reload',
      'settings_click',
      'account_open',
      'rendered_guest',
      'storage_read',
      'storage_assertion',
      'scrape_click',
      'complete',
    ]);
    assert.equal(success.report.observations.d217.fixture.guest_restore_observed, true);
    assert.equal(success.report.stage, 'member_logical_organization_proof');
    assert.throws(
      () =>
        recordScrapeSaveCheckpoint(
          success.report,
          'stale_guest_progress',
          { context: 'prepare', phase: 'private-url' },
          outputDir,
        ),
      /scrape_save_checkpoint_boundary_invalid/,
    );
  } finally {
    release?.();
    await rm(outputDir, { recursive: true, force: true });
  }
});

const source = await readFile(
  new URL('./scrape-save-native-acceptance.mjs', import.meta.url),
  'utf8',
);
const authCall = source.match(
  /let identity;\s*try \{[\s\S]*?identity = await resourceAction\(\(\) =>[\s\S]*?\n\s*\} catch \(error\) \{[\s\S]*?\n\s*\}/,
);
assert.ok(authCall, 'Scrape acceptance must use the real member sign-in caller');

const runAuth = new Function(
  'report',
  'resourceAction',
  'signInSettings',
  'recordScrapeMemberAuthFailure',
  'recordScrapeSaveCheckpoint',
  'page',
  'panel',
  'REPO',
  'process',
  'assert',
  `return (async () => { ${authCall[0]} })();`,
);

test('Scrape member auth retains the first safe boundary and failure code', async () => {
  for (const [stage, code] of [
    ['member_credential_validation', 'd87_auth_secret_invalid'],
    ['member_extension_token_observation', 'd87_extension_identity_not_observed'],
  ]) {
    const report = {};
    const outputDir = await mkdtemp(join(tmpdir(), 'scrape-auth-callback-'));
    const secret = 'private-action-link';
    const approvedFile = '/private/approved-member-organization.json';
    const failure = new Error('member_auth_boundary_failed');
    failure.memberAuthBoundary = stage;
    failure.memberAuthFailureCode = code;
    await assert.rejects(
      runAuth(
        report,
        (action) => action(),
        async ({ onStage, onAuthDiagnostic, memberApprovedOrganizationFile }) => {
          assert.equal(memberApprovedOrganizationFile, approvedFile);
          onStage?.(stage);
          onAuthDiagnostic?.({
            phase: 'organization_selected',
            organization_selected: false,
            raw: secret,
          });
          throw failure;
        },
        recordScrapeMemberAuthFailure,
        (report, kind, value) => recordScrapeSaveCheckpoint(report, kind, value, outputDir),
        {},
        {},
        '.',
        {
          env: {
            MATRX_REVIEWER_MAGIC_LINK_FILE: secret,
            MATRX_REVIEWER_APPROVED_ORGANIZATION_FILE: approvedFile,
          },
        },
        assert,
      ),
      (error) => error === failure,
    );
    assert.deepEqual(report.auth_failure, { stage, code });
    assert.equal(report.auth_stage, stage);
    assert.deepEqual(report.auth_diagnostic, {
      phase: 'organization_selected',
      organization_selected: false,
    });
    await rm(outputDir, { recursive: true, force: true });
    assert.equal(JSON.stringify(report).includes(secret), false);
  }
});

test('real member boundary failure survives Scrape final report write without private error text', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'scrape-auth-report-'));
  try {
    for (const [stage, code, secret] of [
      ['member_credential_validation', 'd87_auth_secret_invalid', 'private-link-file-path'],
      [
        'member_extension_token_observation',
        'd87_extension_identity_not_observed',
        'private-session-token',
      ],
    ]) {
      const report = { stage: 'member_auth', status: 'unverified', auth_stage: null };
      let failure;
      try {
        await runMemberAuthBoundary(
          stage,
          (value) => {
            report.auth_stage = value;
          },
          async () => {
            throw new Error(`${code}:${secret}`);
          },
        );
      } catch (error) {
        failure = error;
        recordScrapeMemberAuthFailure(report, error);
      }
      assert.equal(failure?.message, 'member_auth_boundary_failed');
      const line = recordScrapeSaveFailure(report, failure);
      await writeScrapeSaveReport(report, outputDir);
      const path = join(outputDir, 'scrape-save-native-acceptance.json');
      const raw = await readFile(path, 'utf8');
      assert.deepEqual(JSON.parse(raw), {
        stage: 'member_auth',
        status: 'fail',
        auth_stage: stage,
        auth_failure: { stage, code },
        failure_stage: 'member_auth',
        error_code: 'member_auth_boundary_failed',
      });
      assert.equal(raw.includes(secret), false);
      assert.equal(line.includes(secret), false);
      assert.equal((await stat(path)).mode & 0o777, 0o600);
    }
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

const helperUrl = new URL('./scrape-save-auth-report.mjs', import.meta.url);
const nativeCallback = source
  .match(/onStage: \(value\) => \{[\s\S]*?\n {4}\}/)?.[0]
  .replace('onStage: ', '');
const memberStart = source.indexOf("report.stage = 'member_auth';");
const memberEnd = source.indexOf('\n        if (staleProfileRetry)', memberStart);
const memberProducer = source.slice(memberStart, memberEnd);
const saveStart = source.indexOf("report.stage = 'save_submit';");
const saveEnd = source.indexOf('\n        const afterSave', saveStart);
const saveProducer = source.slice(saveStart, saveEnd);
const failureFinalStart = source.lastIndexOf(
  '} catch (error) {\n  const failureLine = recordScrapeSaveFailure',
);
const failureFinalProducer = source.slice(failureFinalStart);
assert.ok(failureFinalStart > saveEnd, 'scrape_save_actual_failure_final_producer_required');
assert.ok(
  nativeCallback &&
    memberStart > 0 &&
    memberEnd > memberStart &&
    saveStart > 0 &&
    saveEnd > saveStart,
  'scrape_save_checkpoint_actual_producer_seams_required',
);

async function interruptedProducer(mode, { mutant = null } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'scrape-durable-boundary-'));
  let child;
  let stderr = '';
  try {
    let importedHelper = helperUrl.href;
    if (
      [
        'truncate-final',
        'corrupt-timestamps',
        'reset-first-at',
        'premature-memory-commit',
      ].includes(mutant)
    ) {
      let helper = (await readFile(helperUrl, 'utf8')).replace(
        "'./settings-member-auth-diagnostic.mjs'",
        JSON.stringify(new URL('./settings-member-auth-diagnostic.mjs', import.meta.url).href),
      );
      let atomicSource = await readFile(
        new URL('./atomic-json-report.mjs', import.meta.url),
        'utf8',
      );
      if (mutant === 'truncate-final')
        atomicSource = atomicSource.replace(
          'renameSync(temporary, destination);',
          "if (report.status === 'pass') writeFileSync(destination, '{');\n    renameSync(temporary, destination);",
        );
      const atomicPath = join(directory, 'atomic-json-report.mjs');
      await writeFile(atomicPath, atomicSource, { mode: 0o600 });
      helper = helper.replace(
        "'./atomic-json-report.mjs'",
        JSON.stringify(new URL(`file://${atomicPath}`).href),
      );
      if (mutant === 'corrupt-timestamps')
        helper = helper.replace(
          'const at = new Date().toISOString();',
          "const at = 'invalid_timestamp';",
        );
      if (mutant === 'reset-first-at')
        helper = helper.replace('first_at: previous?.first_at ?? at,', 'first_at: at,');
      if (mutant === 'premature-memory-commit')
        helper = helper.replace(
          '  publishScrapeSaveReport(\n',
          '  report.auth_diagnostic = nextDiagnostic;\n  report.diagnostic_progress = nextProgress;\n  publishScrapeSaveReport(\n',
        );
      const helperPath = join(directory, 'mutant-helper.mjs');
      await writeFile(helperPath, helper, { mode: 0o600 });
      importedHelper = new URL(`file://${helperPath}`).href;
    }
    const childPath = join(directory, 'actual-producer.mjs');
    await writeFile(
      childPath,
      `
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { waitFor } from ${JSON.stringify(new URL('./settings-panel-driver.mjs', import.meta.url).href)};
import assert from 'node:assert/strict';
const outputDir = ${JSON.stringify(directory)};
const mode = ${JSON.stringify(mode)};
const actualToISOString = Date.prototype.toISOString;
let clockTick = 0;
Date.prototype.toISOString = function () { return actualToISOString.call(new Date(Date.UTC(2026, 9, 25, 17, 0, clockTick++))); };
const park = (milestone, details = {}) => {
  process.send({ milestone, ...details });
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
};
let renames = 0;
const rename = fs.renameSync;
fs.renameSync = (...args) => {
  renames += 1;
  if (mode === 'final_interrupt' && renames === 2) park('final_before_rename');
  if (mode === 'io_failure' || mode === 'auth_io_failure' || mode === 'auth_retry' && renames === 3) throw Object.assign(new Error('owned_io_refusal'), { code: 'EACCES' });
  return rename(...args);
};
syncBuiltinESMExports();
const helper = await import(${JSON.stringify(importedHelper)});
const report = {
  status: 'unverified', stage: 'inputs', native_stage: null, auth_stage: null,
  artifact: { kind: 'ci_development_test', eligible_store: false, source_sha: '${'4'.repeat(40)}', run_id: 40207639522, artifact_id: 12603809037, tree_sha256: '${'7'.repeat(64)}', version: '0.2.622' },
  harness_checkout_sha: '${'8'.repeat(40)}',
  observations: { action_link: 'private-checkpoint-canary', access_token: 'private-checkpoint-canary' },
};
if (mode.startsWith('unknown_')) report.observations = {};
const recordScrapeSaveCheckpoint = ${mutant === 'drop-checkpoint' ? '() => {}' : '(report, kind, value) => helper.recordScrapeSaveCheckpoint(report, kind, value, outputDir)'};
const native = ${mutant === 'raw-stage-assignment' ? nativeCallback.replace('{', '{ report.native_stage = value;') : nativeCallback};
const healthEvents = [];
const resourceAction = async (action) => { healthEvents.push('action'); return action(); };
const requireResourceHealth = async () => { healthEvents.push('health'); };
const processStub = { env: { MATRX_REVIEWER_MAGIC_LINK_FILE: 'private-checkpoint-canary', MATRX_REVIEWER_APPROVED_ORGANIZATION_FILE: 'private-checkpoint-canary' } };
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runMember = new AsyncFunction('report', 'requireResourceHealth', 'resourceAction', 'signInSettings', 'recordScrapeMemberAuthFailure', 'recordScrapeSaveCheckpoint', 'page', 'panel', 'REPO', 'process', 'assert', 'UUID', 'let selectedOrganizationId; ' + ${JSON.stringify(mutant === 'raw-stage-assignment' ? memberProducer.replace('onStage: (value) => {', 'onStage: (value) => { report.auth_stage = value;') : memberProducer)});
const runFinal = new AsyncFunction('report', 'error', 'recordScrapeSaveFailure', 'writeScrapeSaveReport', 'process', 'try { throw error; ' + ${JSON.stringify(failureFinalProducer)});
try {
  if (mode === 'unknown_native_stage') { native('panel_context'); native('private-stage-canary'); }
  else if (mode === 'native') { native('panel_target'); park('native_published'); }
  else if (mode === 'final_interrupt') {
    native('panel_reply'); report.status = 'pass'; report.stage = 'complete';
    helper.writeScrapeSaveReport(report, outputDir);
  } else if (mode === 'pre_save' || mode === 'io_failure') {
    const runSave = new AsyncFunction('report', 'dialogState', 'panel', 'assert', 'recordScrapeSaveCheckpoint', 'staleProfileRetry', 'resourceAction', 'click', ${JSON.stringify(saveProducer)});
    await runSave(report, async () => ({ open: true }), {}, assert, recordScrapeSaveCheckpoint, false, resourceAction, async () => park('save_action_entry'));
  } else {
    await runMember(report, requireResourceHealth, resourceAction, async (options) => {
      assert.equal(healthEvents[0], 'health');
      if (mode === 'unknown_auth_stage') options.onStage('private-stage-canary');
      if (mode === 'auth_start') park('auth_action_entry');
      if (mode === 'auth_target') {
        options.onStage('member_logical_organization_proof');
        options.onAuthDiagnostic({ phase: 'logical_organization_request', target: 'organization_request_wait' });
        options.onAuthDiagnostic({ phase: 'logical_organization_request', target: 'organization_settings_return', private_url: 'private-checkpoint-canary' });
        park('auth_target_published');
      }
      options.onStage('member_organization_selected');
      if (mode === 'auth_retry') {
        let reads = 0;
        await waitFor('scrape_checkpoint_retry', async () => {
          reads += 1;
          options.onAuthDiagnostic({ phase: 'organization_selected', organization_selected: true });
          return true;
        }, (value) => value === true, 1000);
        park('auth_retry_published', { reads });
      }
      options.onAuthDiagnostic({ phase: 'organization_selected', organization_selected: false, access_token: 'private-checkpoint-canary' });
      const firstDiagnosticAt = report.diagnostic_progress.latest.at;
      options.onAuthDiagnostic({ phase: 'organization_selected', organization_selected: true, expected_organization_matches: true, action_link: 'private-checkpoint-canary' });
      options.onAuthDiagnostic({ phase: 'organization_selected', organization_selected: true, expected_organization_matches: true, ignored_secret: 'private-checkpoint-canary' });
      if (mode === 'auth_diagnostic') park('auth_diagnostic_published', { first_diagnostic_at: firstDiagnosticAt });
      return { organizationId: 'a4152086-c3e5-44e8-a853-8e3da9918dd8', web_signed_in: true, extension_signed_in: true, admin_role: false, canonical_nonadmin_check: { returned_rows: mode === 'auth_assertion_failure' ? 1 : 0 }, organization_selected: true, organization_resolution: 'load_ladder', action_link: 'private-checkpoint-canary' };
    }, helper.recordScrapeMemberAuthFailure, recordScrapeSaveCheckpoint, {}, {}, '.', processStub, assert, /^[0-9a-f-]{36}$/);
    park('auth_complete_published');
  }
} catch (error) {
  if (mode.startsWith('unknown_')) {
    await runFinal(report, error, helper.recordScrapeSaveFailure, (report) => helper.writeScrapeSaveReport(report, outputDir), { exitCode: 0, stderr: { write() {} } });
    park('unknown_stage_reported');
  }
  park('operation_refused', { code: error.code ?? error.message, ...(mode === 'auth_io_failure' ? { health_events: healthEvents } : {}) });
}
`,
      { mode: 0o600 },
    );
    child = fork(childPath, { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const exit = once(child, 'exit');
    const message = await Promise.race([
      once(child, 'message', { signal: AbortSignal.timeout(5000) }).then(([value]) => value),
      exit.then(([code, signal]) =>
        assert.fail(`scrape_checkpoint_child_exited_before_boundary:${code}:${signal}:${stderr}`),
      ),
    ]);
    child.kill('SIGTERM');
    const [, signal] = await exit;
    assert.equal(
      signal,
      'SIGTERM',
      'ordinary resource termination must retain default signal behavior',
    );
    const path = join(directory, 'scrape-save-native-acceptance.json');
    let raw;
    try {
      raw = await readFile(path, 'utf8');
    } catch {
      raw = null;
    }
    let report;
    try {
      report = JSON.parse(raw);
    } catch {
      report = null;
    }
    return {
      message,
      report,
      raw,
      mode: raw ? (await stat(path)).mode & 0o777 : null,
      files: await readdir(directory),
    };
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await rm(directory, { recursive: true, force: true });
  }
}

function requireDurableCheckpoint(result, kind) {
  assert.ok(result.report, 'scrape_checkpoint_before_action_missing_or_truncated');
  assert.equal(
    result.report.status,
    'unverified',
    'intermediate evidence must never advertise completion',
  );
  assert.equal(
    result.report.diagnostic_progress.latest.kind,
    kind,
    'scrape_checkpoint_latest_boundary_missing',
  );
  assert.equal(result.mode, 0o600);
  assert.equal(
    result.raw.includes('private-checkpoint-canary'),
    false,
    'checkpoint must project private input away',
  );
  assert.equal(result.report.artifact.source_sha, '4'.repeat(40));
  assert.equal(result.report.artifact.run_id, 40207639522);
  assert.equal(result.report.harness_checkout_sha, '8'.repeat(40));
  const progress = result.report.diagnostic_progress;
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  let priorSequence = 0;
  let priorTime = Number.NEGATIVE_INFINITY;
  for (const boundary of progress.boundaries) {
    assert.match(boundary.at, iso, 'scrape_checkpoint_timestamp_invalid');
    assert.match(boundary.first_at, iso, 'scrape_checkpoint_first_timestamp_invalid');
    assert.ok(
      Date.parse(boundary.first_at) <= Date.parse(boundary.at),
      'first observation must precede its latest revision',
    );
    assert.ok(
      boundary.sequence > priorSequence,
      'retained boundaries must preserve publication order',
    );
    assert.ok(
      Date.parse(boundary.at) >= priorTime,
      'boundary timestamps must follow publication order',
    );
    priorSequence = boundary.sequence;
    priorTime = Date.parse(boundary.at);
  }
  assert.equal(progress.latest.sequence, progress.sequence);
  assert.deepEqual(
    progress.latest,
    Object.fromEntries(
      Object.entries(progress.boundaries.at(-1)).filter(([key]) => key !== 'first_at'),
    ),
  );
}

test('ordinary SIGTERM preserves the real native callback checkpoint', async () => {
  const result = await interruptedProducer('native');
  requireDurableCheckpoint(result, 'native_stage');
  assert.equal(result.report.native_stage, 'panel_target');
});

test('authentication intent is on disk before its real caller enters a pending operation', async () => {
  const result = await interruptedProducer('auth_start');
  assert.equal(result.message.milestone, 'auth_action_entry');
  requireDurableCheckpoint(result, 'auth_start');
});

test('same-stage safe authentication observations publish before callback return and SIGTERM', async () => {
  const result = await interruptedProducer('auth_diagnostic');
  requireDurableCheckpoint(result, 'auth_diagnostic');
  assert.equal(result.report.auth_stage, 'member_organization_selected');
  assert.deepEqual(result.report.auth_diagnostic, {
    phase: 'organization_selected',
    organization_selected: true,
    expected_organization_matches: true,
  });
  assert.deepEqual(
    result.report.diagnostic_progress.boundaries.map((entry) => entry.kind),
    ['auth_start', 'auth_stage', 'auth_diagnostic'],
  );
  assert.equal(
    result.report.diagnostic_progress.sequence,
    4,
    'identical safe observations must not publish another checkpoint',
  );
  assert.equal(
    result.report.diagnostic_progress.boundaries.at(-1).first_at,
    result.message.first_diagnostic_at,
    'scrape_checkpoint_first_timestamp_replaced',
  );
});

test('authentication completion checkpoint follows all real member assertions', async () => {
  const complete = await interruptedProducer('auth_complete');
  requireDurableCheckpoint(complete, 'auth_complete');
  assert.deepEqual(complete.report.authentication, {
    mode: 'member',
    web_signed_in: true,
    extension_signed_in: true,
    non_admin_role_verified: true,
    selected_organization_verified: true,
    organization_resolution: 'load_ladder',
  });
  const refused = await interruptedProducer('auth_assertion_failure');
  assert.equal(refused.message.milestone, 'operation_refused');
  assert.equal(
    refused.report.authentication,
    null,
    'failed member assertions must not publish authentication completion proof',
  );
  assert.equal(
    refused.report.diagnostic_progress.boundaries.some((entry) => entry.kind === 'auth_complete'),
    false,
  );
});

test('pre-Save intent is durable before the real guarded click enters pending IO', async () => {
  const result = await interruptedProducer('pre_save');
  assert.equal(result.message.milestone, 'save_action_entry');
  requireDurableCheckpoint(result, 'pre_save');
});

test('checkpoint publication failure prevents the real Save caller from clicking', async () => {
  const result = await interruptedProducer('io_failure');
  assert.deepEqual(result.message, { milestone: 'operation_refused', code: 'EACCES' });
  assert.equal(result.report, null);
});

test('interrupted final publication preserves the previous complete checkpoint bytes', async () => {
  const result = await interruptedProducer('final_interrupt');
  assert.equal(result.message.milestone, 'final_before_rename');
  requireDurableCheckpoint(result, 'native_stage');
  assert.equal(result.report.native_stage, 'panel_reply');
});

test('guards reject dropped checkpoint and destructive final-writer mutants in scratch only', async () => {
  const dropped = await interruptedProducer('native', { mutant: 'drop-checkpoint' });
  assert.throws(
    () => requireDurableCheckpoint(dropped, 'native_stage'),
    /scrape_checkpoint_before_action_missing_or_truncated/,
  );
  const truncated = await interruptedProducer('final_interrupt', { mutant: 'truncate-final' });
  assert.throws(
    () => requireDurableCheckpoint(truncated, 'native_stage'),
    /scrape_checkpoint_before_action_missing_or_truncated/,
  );
});

test('checkpoint provenance rejects private or malformed identifiers rather than serializing them', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'scrape-provenance-projection-'));
  try {
    const report = {
      artifact: {
        source_sha: 'private-provenance-canary',
        tree_sha256: 'private-provenance-canary',
        version: 'private-provenance-canary',
        run_id: 'private-provenance-canary',
        artifact_id: 'private-provenance-canary',
      },
      harness_checkout_sha: 'private-provenance-canary',
      native_stage: 'panel_context',
    };
    recordScrapeSaveCheckpoint(report, 'native_stage', 'panel_context', outputDir);
    const raw = await readFile(join(outputDir, 'scrape-save-native-acceptance.json'), 'utf8');
    const actual = JSON.parse(raw);
    assert.equal(actual.artifact, null);
    assert.equal(actual.harness_checkout_sha, null);
    assert.equal(raw.includes('private-provenance-canary'), false);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('authentication checkpoint IO refusal stops before the actual sign-in action', async () => {
  const result = await interruptedProducer('auth_io_failure');
  assert.deepEqual(result.message, {
    milestone: 'operation_refused',
    code: 'EACCES',
    health_events: ['health'],
  });
  assert.equal(result.report, null);
});

test('checkpoint provenance never relabels Store or unknown artifacts as development evidence', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'scrape-artifact-classification-'));
  try {
    const artifact = {
      kind: 'ci_development_test',
      eligible_store: false,
      source_sha: '3'.repeat(40),
      tree_sha256: '6'.repeat(64),
      version: '0.2.622',
      run_id: 40207639522,
      artifact_id: 12603809037,
    };
    for (const variant of [
      { ...artifact, kind: 'store_release' },
      { ...artifact, eligible_store: true },
    ]) {
      const report = { artifact: variant, native_stage: 'panel_target' };
      recordScrapeSaveCheckpoint(report, 'native_stage', 'panel_target', outputDir);
      const actual = JSON.parse(
        await readFile(join(outputDir, 'scrape-save-native-acceptance.json'), 'utf8'),
      );
      assert.equal(actual.artifact, null);
    }
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('timestamp and first-observation guards catch corrupted scratch writer variants', async () => {
  const invalid = await interruptedProducer('native', { mutant: 'corrupt-timestamps' });
  assert.throws(
    () => requireDurableCheckpoint(invalid, 'native_stage'),
    /scrape_checkpoint_timestamp_invalid/,
  );
  const reset = await interruptedProducer('auth_diagnostic', { mutant: 'reset-first-at' });
  requireDurableCheckpoint(reset, 'auth_diagnostic');
  assert.throws(
    () =>
      assert.equal(
        reset.report.diagnostic_progress.boundaries.at(-1).first_at,
        reset.message.first_diagnostic_at,
        'scrape_checkpoint_first_timestamp_replaced',
      ),
    /scrape_checkpoint_first_timestamp_replaced/,
  );
});

test('authentication checkpoint projects only observed finite results and omits private fields', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'scrape-auth-result-projection-'));
  try {
    const report = {
      authentication: {
        mode: 'member',
        web_signed_in: false,
        extension_signed_in: true,
        non_admin_role_verified: 'private-auth-result-canary',
        selected_organization_verified: true,
        organization_resolution: 'device_choice',
        action_link: 'private-auth-result-canary',
        user_id: 'private-auth-result-canary',
      },
    };
    recordScrapeSaveCheckpoint(report, 'auth_complete', undefined, outputDir);
    const raw = await readFile(join(outputDir, 'scrape-save-native-acceptance.json'), 'utf8');
    const actual = JSON.parse(raw);
    assert.deepEqual(actual.authentication, {
      mode: 'member',
      web_signed_in: false,
      extension_signed_in: true,
      non_admin_role_verified: null,
      selected_organization_verified: true,
      organization_resolution: 'device_choice',
    });
    assert.equal(raw.includes('private-auth-result-canary'), false);
    assert.equal(actual.status, 'unverified');
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('same-stage logical organization target changes retain ordered safe milestones', async () => {
  const result = await interruptedProducer('auth_target');
  requireDurableCheckpoint(result, 'auth_diagnostic');
  assert.deepEqual(result.report.auth_diagnostic, {
    phase: 'logical_organization_request',
    target: 'organization_settings_return',
  });
  assert.deepEqual(
    result.report.diagnostic_progress.boundaries.map((entry) => entry.label),
    [
      'auth_start',
      'member_logical_organization_proof',
      'logical_organization_request:organization_request_wait',
      'logical_organization_request:organization_settings_return',
    ],
  );
});

test('a swallowed first diagnostic publication failure retries identical data through the actual waitFor', async () => {
  const result = await interruptedProducer('auth_retry');
  assert.deepEqual(result.message, { milestone: 'auth_retry_published', reads: 2 });
  requireDurableCheckpoint(result, 'auth_diagnostic');
  assert.equal(
    result.report.diagnostic_progress.sequence,
    3,
    'only successful publications commit progress',
  );
  assert.deepEqual(result.report.auth_diagnostic, {
    phase: 'organization_selected',
    organization_selected: true,
  });
});

test('unknown actual native/auth stages cannot reach the real failure and final report', async () => {
  for (const mode of ['unknown_native_stage', 'unknown_auth_stage']) {
    const result = await interruptedProducer(mode);
    assert.equal(result.message.milestone, 'unknown_stage_reported');
    assert.equal(result.report.status, 'fail');
    assert.equal(
      result.raw.includes('private-stage-canary'),
      false,
      'stage_canary_reached_final_report',
    );
    assert.equal(result.report.error_code, 'scrape_save_checkpoint_boundary_invalid');
    if (mode === 'unknown_native_stage') assert.equal(result.report.native_stage, 'panel_context');
    else assert.equal(result.report.auth_stage, null);
  }
});

test('actual retry and final-report guards reject old premature-commit and raw-stage variants', async () => {
  const droppedRetry = await interruptedProducer('auth_retry', {
    mutant: 'premature-memory-commit',
  });
  assert.throws(
    () => requireDurableCheckpoint(droppedRetry, 'auth_diagnostic'),
    /scrape_checkpoint_latest_boundary_missing/,
  );
  for (const mode of ['unknown_native_stage', 'unknown_auth_stage']) {
    const leakedStage = await interruptedProducer(mode, { mutant: 'raw-stage-assignment' });
    assert.throws(
      () =>
        assert.equal(
          leakedStage.raw.includes('private-stage-canary'),
          false,
          'stage_canary_reached_final_report',
        ),
      /stage_canary_reached_final_report/,
    );
  }
});

test('member Records auth checkpoint retains safe pointer evidence without exposing failure contents', async () => {
  const { refreshMemberLogicalOrganizationGet } = await import('./member-logical-org-proof.mjs');
  for (const [hitTarget, animating, category, stable, center] of [
    [false, true, 'hit_affecting_or_unknown', false, 'other_element'],
    [true, false, 'none', true, 'target'],
  ]) {
    const outputDir = await mkdtemp(join(tmpdir(), 'auth-pointer-evidence-'));
    const report = {};
    const error = new Error('private-token');
    error.driverFailure = {
      code: 'pointer_stable_hit_not_observed',
      matchedTargetCount: 1,
      visibleMatchCount: 1,
      hitTarget,
      animating,
      animationCategory: category,
      positionStable: stable,
      stableSamples: 2,
      targetHasArea: true,
      clippedTargetHasArea: true,
      selectedPointAvailable: true,
      centerHitCategory: center,
      raw: 'private-token',
    };
    try {
      await assert.rejects(
        () =>
          runMemberAuthBoundary('member_logical_organization_proof', null, () =>
            refreshMemberLogicalOrganizationGet(
              {},
              { arm() {} },
              async () => {
                throw error;
              },
              (value) => recordScrapeSaveCheckpoint(report, 'auth_diagnostic', value, outputDir),
            ),
          ),
        (caught) => caught.memberAuthFailureCode === 'pointer_stable_hit_not_observed',
      );
      const saved = JSON.parse(
        await readFile(join(outputDir, 'scrape-save-native-acceptance.json'), 'utf8'),
      );
      assert.equal(saved.auth_diagnostic.hit_target, hitTarget);
      assert.equal(saved.auth_diagnostic.animating, animating);
      assert.equal(saved.auth_diagnostic.animation_category, category);
      assert.equal(saved.auth_diagnostic.position_stable, stable);
      assert.equal(saved.auth_diagnostic.center_hit_category, center);
      assert.equal(JSON.stringify(saved).includes('private-token'), false);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
});
