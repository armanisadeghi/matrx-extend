import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import * as failures from './profile-native-failure.mjs';

const source = await readFile(new URL('./profile-native-acceptance.mjs', import.meta.url), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
function section(start, end) {
  assert.ok(source.includes(start) && source.includes(end));
  return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
}

// SUT: the actual runner's save/discard operation, request observer and final
// report handler. Only browser transport/UI and owned persistence are replaced.
for (const code of [
  'SYNTHETICSECRET1234567890',
  'private-code@invalid.test',
  'https://invalid.test/?token=synthetic',
  { token: 'SYNTHETICSECRET1234567890' },
  null,
  '42501',
  'PGRST301',
]) {
  test(`complete save/discard report bounds backend diagnostic ${code}`, async () => {
    const report = { stage: 'profile', cases: [] };
    const primary = new Error('private-primary@invalid.test');
    const secondary = new Error('private-cleanup@invalid.test');
    const listeners = new Map();
    let value = 'Original preferred name';
    let dirty = false;
    const panel = {
      on(name, fn) {
        listeners.set(name, fn);
        return () => listeners.delete(name);
      },
      async send(name) {
        if (name === 'Network.getResponseBody')
          return { body: JSON.stringify({ code, message: 'private-body@invalid.test' }) };
        return {};
      },
    };
    const state = async () => ({
      preferred: value,
      dirty,
      saveEnabled: dirty,
      error: null,
      loading: false,
      back: true,
    });
    let writes = 0;
    const journal = {
      async save(_value, action) {
        writes++;
        await action();
        if (writes === 1) throw primary;
        throw secondary;
      },
    };
    const clickProfileHeader = async (_panel, label) => {
      if (label === 'Discard') {
        value = 'Original preferred name';
        dirty = false;
        return;
      }
      listeners.get('Network.requestWillBeSent')({
        requestId: String(writes),
        request: { url: 'https://db.invalid/rest/v1/user_form_profile', method: 'POST' },
      });
      listeners.get('Network.responseReceived')({
        requestId: String(writes),
        response: { status: 500 },
      });
      listeners.get('Network.loadingFinished')({ requestId: String(writes) });
      dirty = false;
      await Promise.resolve();
    };
    const dependencies = {
      assert,
      randomUUID,
      report,
      ...failures,
      panel,
      journal,
      state,
      clickProfileHeader,
      fillPreferred: async (_panel, next) => {
        value = next;
        dirty = true;
      },
      waitFor: async (_name, read, predicate) => {
        const result = await read();
        assert.ok(predicate(result));
        return result;
      },
      profilePointer: async () => {},
      openProfile: async () => {},
    };
    const run = new AsyncFunction(
      ...Object.keys(dependencies),
      `
      ${section('function redactedState(', 'async function openProfile(')}
      ${section('async function caseSaveDiscard(', 'async function caseT25(')}
      const error = await runProfileExecutionBoundary(report,
        () => caseSaveDiscard(panel, 'Original preferred name', 'member@invalid.test', 'member', 'warm', journal),
        { getOperation: () => 'warm_profile', readUiState: async () => null });
      recordProfileFinalFailure(report, error);
      return error;
    `,
    );
    assert.equal(await run(...Object.values(dependencies)), primary);
    assert.equal(writes, 2);
    assert.equal(listeners.size, 0);
    const diagnostic = report.save_discard_diagnostics[0];
    assert.equal(diagnostic.first_failure, 'profile_unclassified_failure');
    assert.equal(diagnostic.cleanup_failure, 'profile_unclassified_failure');
    assert.equal(diagnostic.requests.length, 2);
    assert.equal(
      diagnostic.requests[0].error_code,
      code === null
        ? null
        : ['42501', 'PGRST301'].includes(code)
          ? code
          : 'profile_backend_unclassified_error',
    );
    const serialized = JSON.stringify(report);
    assert.ok(!serialized.includes('SYNTHETICSECRET1234567890'));
    assert.ok(!serialized.includes('@invalid.test'));
  });
}

test('actual runner cleanup retains execution Error and independent cleanup failure', async () => {
  const primary = new Error('private-primary@invalid.test');
  const secondary = new Error('private-cleanup@invalid.test');
  const report = { first_save: {} };
  let detached = 0;
  const dependencies = {
    report,
    executionError: primary,
    reloadAttempted: false,
    reloadedPanel: {
      detach: async () => {
        detached++;
      },
    },
    reacquiredPanel: null,
    owned: {},
    pendingMarker: null,
    ownedJournal: {
      reconcile: async () => {
        throw secondary;
      },
    },
    safeProfileFailureCode: failures.safeProfileFailureCode,
  };
  const run = new AsyncFunction(
    ...Object.keys(dependencies),
    section('      let cleanupError = null;', '\n    },\n  });'),
  );
  await assert.rejects(run(...Object.values(dependencies)), (error) => error === primary);
  assert.equal(detached, 1);
  assert.equal(report.cleanup_failure_code, 'profile_unclassified_failure');
  assert.equal(report.restoration.verified, false);
  assert.ok(!JSON.stringify(report).includes('@invalid.test'));
});

for (const executionFails of [true, false]) {
  test(`complete runner cleanup and native teardown preserve ${executionFails ? 'execution' : 'cleanup-only'} Error`, async () => {
    const primary = new Error('profile_initial_load_failed');
    const cleanup = new Error('owned_profile_cleanup_row_missing');
    const teardown = new Error('private-teardown@invalid.test');
    const report = { first_save: {} };
    const harness = await readFile(
      new URL('./native-sidepanel-qa-harness.mjs', import.meta.url),
      'utf8',
    );
    const tailStart = harness.indexOf('  } finally {\n    // Browser.close');
    const tailEnd = harness.indexOf('\n}\n', tailStart);
    assert.ok(tailStart > 0 && tailEnd > tailStart);
    const harnessFinally = harness.slice(tailStart + 4, tailEnd);
    const catchBody = source.slice(
      source.lastIndexOf('} catch (error) {') + 2,
      source.lastIndexOf('} finally {'),
    );
    const cleanupBody = section('      nativeExecutionError = executionError;', '\n    },\n  });');
    let removed = false;
    let detached = 0;
    let finalError;
    const dependencies = {
      report,
      executionError: executionFails ? primary : null,
      reloadAttempted: false,
      reloadedPanel: {
        detach: async () => {
          detached++;
        },
      },
      reacquiredPanel: null,
      owned: {},
      pendingMarker: null,
      ownedJournal: {
        reconcile: async () => {
          throw cleanup;
        },
      },
      cdp: null,
      server: null,
      child: null,
      root: '/owned-profile',
      stopOwnedChild: async () => {},
      rm: async () => {
        removed = true;
        throw teardown;
      },
      safeProfileFailureCode: failures.safeProfileFailureCode,
      recordProfileFinalFailure: (target, error) => {
        finalError = error;
        failures.recordProfileFinalFailure(target, error);
      },
    };
    const run = new AsyncFunction(
      ...Object.keys(dependencies),
      `
      let nativeExecutionError = null;
      let heldFieldCases = [];
      try {
        try { ${cleanupBody} } ${harnessFinally}
      } ${catchBody}}
    `,
    );
    await run(...Object.values(dependencies));
    assert.equal(finalError, executionFails ? primary : cleanup);
    assert.equal(removed, true);
    assert.equal(detached, 1);
    assert.equal(
      report.failure_code,
      executionFails ? 'profile_initial_load_failed' : 'owned_profile_cleanup_row_missing',
    );
    assert.equal(report.cleanup_failure_code, 'owned_profile_cleanup_row_missing');
    assert.deepEqual(report.teardown_failures, [
      { stage: 'native_harness', code: 'profile_unclassified_failure' },
    ]);
    assert.ok(!JSON.stringify(report).includes('@invalid.test'));
  });
}

test('actual native panel detach cannot replace a primary transport failure', async () => {
  const harness = await readFile(
    new URL('./native-sidepanel-qa-harness.mjs', import.meta.url),
    'utf8',
  );
  const start = harness.indexOf('async function attachTargetSession(');
  const end = harness.indexOf('\nfunction stopOwnedChild(', start);
  const attach = new AsyncFunction(`${harness.slice(start, end)}; return attachTargetSession;`);
  const cdp = {
    send: async (name) => {
      if (name === 'Target.attachToTarget') return { sessionId: 'owned-session' };
      throw new Error('private-transport@invalid.test');
    },
  };
  const panel = await (await attach())(cdp, 'owned-target');
  await panel.detach();
});
