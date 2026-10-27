import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { safeEndpointObservation } from './native-cdp-startup-diagnostic.mjs';
import { runNativeResourceAction } from './native-resource-boundary.mjs';
import { requireBrowserDisplayMode } from './native-sidepanel-qa-harness.mjs';

const source = await readFile(
  new URL('./scrape-guest-native-acceptance.mjs', import.meta.url),
  'utf8',
);
const start = source.indexOf('await runNativeSidepanelQa({');
const end = source.indexOf('    extensionDir:', start);
assert.ok(start >= 0 && end > start, 'Scrape launch call missing');
const callerPrefix = source.slice(start, end);
const evaluateCaller = (prefix, reloadOpenDiagnostic = false) =>
  new Function(
    'runNativeSidepanelQa',
    'RELOAD_OPEN_DIAGNOSTIC',
    `return (async () => { return ${prefix} }); })();`,
  )((options) => options, reloadOpenDiagnostic);

test('Scrape real caller requests headed mode; omitting it fails the foreground contract', async () => {
  for (const diagnostic of [false, true]) {
    const options = await evaluateCaller(callerPrefix, diagnostic);
    assert.equal(options.headed, true);
    assert.equal(options.reloadOpenDiagnostic, diagnostic);
  }
  const omittedHeaded = callerPrefix.replace(/\bheaded:\s*true,?\s*/, '');
  assert.notEqual(omittedHeaded, callerPrefix, 'mutation must reach the actual caller');
  assert.notEqual((await evaluateCaller(omittedHeaded)).headed, true);
});

test('owned CDP command line proves requested and observed display modes without leaking arguments', () => {
  const headed = { arguments: ['--user-data-dir=/owned/profile', '--remote-debugging-port=0'] };
  const headless = { arguments: [...headed.arguments, '--headless=new'] };
  assert.deepEqual(requireBrowserDisplayMode(headed, true), {
    requested_mode: 'headed',
    observed_mode: 'headed',
    verified_by: 'Browser.getBrowserCommandLine',
  });
  assert.deepEqual(requireBrowserDisplayMode(headless, false), {
    requested_mode: 'headless',
    observed_mode: 'headless',
    verified_by: 'Browser.getBrowserCommandLine',
  });
  assert.throws(() => requireBrowserDisplayMode(headless, true), /display_mode_mismatch/);
  assert.throws(() => requireBrowserDisplayMode(headed, false), /display_mode_mismatch/);
});

const harness = await readFile(
  new URL('./native-sidepanel-qa-harness.mjs', import.meta.url),
  'utf8',
);
const seamStart = harness.indexOf("    onStage('command_line_query');");
const seamEnd = harness.indexOf('    let extensionWorker;', seamStart);
assert.ok(seamStart >= 0 && seamEnd > seamStart, 'owned CDP launch verification seam missing');
const seamSource = harness.slice(seamStart, seamEnd);

async function verifyLaunchSeam(fragment = seamSource) {
  const runSeam = new Function(
    'cdp',
    'headed',
    'onStage',
    'requireOwnedCommandLine',
    'requireBrowserDisplayMode',
    'onBrowserLaunchObservation',
    'profile',
    'resourceAction',
    `return (async () => { ${fragment} })();`,
  );
  const stages = [];
  const observations = [];
  let commands = 0;
  let healthChecks = 0;
  let healthError = null;
  // The real action primitive owns forwarding. Only the external health check
  // and CDP response are adapted, including a distinct refused-health input.
  const action = (work) =>
    runNativeResourceAction(async () => {
      healthChecks += 1;
      if (healthError) throw healthError;
    }, work);
  const execute = (arguments_) =>
    runSeam(
      {
        send: async (method) => {
          assert.equal(method, 'Browser.getBrowserCommandLine');
          commands += 1;
          return { arguments: arguments_ };
        },
      },
      true,
      (stage) => stages.push(stage),
      () => {},
      requireBrowserDisplayMode,
      (observation) => observations.push(observation),
      '/owned/profile',
      action,
    );
  const headed = ['--user-data-dir=/owned/profile', '--remote-debugging-port=0'];
  await execute(headed);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].observed_mode, 'headed');
  await assert.rejects(execute([...headed, '--headless=new']), /display_mode_mismatch/);
  assert.equal(observations.length, 1, 'mismatched launch must not reach acceptance receipt');
  assert.deepEqual(stages, [
    'command_line_query',
    'command_line_verify',
    'command_line_query',
    'command_line_verify',
  ]);
  assert.equal(commands, 2);
  assert.equal(healthChecks, 2);
  healthError = new Error('controlled external health refusal');
  await assert.rejects(execute(headed), (error) => error === healthError);
  assert.equal(commands, 2, 'refused health must not query the browser');
  assert.equal(observations.length, 1, 'refused health must not emit an acceptance receipt');
  assert.equal(healthChecks, 3);
  assert.deepEqual(stages.slice(4), ['command_line_query']);
}

test('production launch seam verifies CDP mode and health before emitting receipt observation', () =>
  verifyLaunchSeam());
test('launch seam oracles reject in-memory constant success and omitted health gating', async () => {
  await assert.rejects(verifyLaunchSeam(''), assert.AssertionError);
  const guarded = "await resourceAction(() => cdp.send('Browser.getBrowserCommandLine'))";
  assert.equal(
    seamSource.split(guarded).length,
    2,
    'omitted-gate mutation must reach the real seam once',
  );
  await assert.rejects(
    verifyLaunchSeam(
      seamSource.replace(guarded, "await cdp.send('Browser.getBrowserCommandLine')"),
    ),
    assert.AssertionError,
  );
});

// Actual B driver invocation: dropped callback/window must fail even if headed launch remains.
test('B Scrape actual invocation retains safe passive timeout observations without full startup observers', async () => {
  const driver = await readFile(
    new URL('./scrape-seo-schema-empty-guest.mjs', import.meta.url),
    'utf8',
  );
  const start = driver.indexOf('await runNativeSidepanelQa({');
  const end = driver.indexOf('      exercisePanel:', start);
  assert.ok(start >= 0 && end > start, 'actual B invocation must be exercised');
  const report = {};
  const output = [];
  const fragment = driver.slice(start, end);
  const policyStart = driver.indexOf('const startupPolicy =');
  const policyEnd = driver.indexOf('const paneScreenshotNames', policyStart);
  const policyCode = driver
    .slice(policyStart, policyEnd)
    .replaceAll('import.meta.url', 'driverUrl');
  const options = await runInNewContext(
    `(async () => { ${policyCode} return ${fragment} }); })()`,
    {
      runNativeSidepanelQa: (value) => value,
      extensionDir: '/owned/extension',
      receiptPath: '/owned/receipt',
      receipt: {},
      join: (...parts) => parts.join('/'),
      fixturePath: '/seo-schema-empty',
      fixtureHtml: '',
      process: {
        env: {
          RUNNER_TEMP: '/owned',
          MATRX_STARTUP_INTERVAL_DIAGNOSTIC: '0',
          MATRX_CDP_STARTUP_DIAGNOSTIC: '0',
        },
        stderr: { write: (line) => output.push(line) },
      },
      report,
      safeEndpointObservation,
      readFile,
      URL,
      driverUrl: new URL('./scrape-seo-schema-empty-guest.mjs', import.meta.url).href,
    },
  );
  assert.equal(options.headed, true);
  assert.equal(
    options.startupEndpointObservationMs,
    15000,
    'B timeout observation window must use existing policy',
  );
  assert.equal(
    typeof options.onStartupEndpointObservation,
    'function',
    'B timeout callback must preserve bounded evidence',
  );
  const value = {
    phase: 'cdp_timeout',
    endpointPresent: null,
    presenceBasis: 'unobserved',
    sampleTiming: null,
    recordInspection: { outcome: 'not_attempted', timing: null },
    failureObservedElapsedMs: 8000,
    reportedElapsedMs: 8001,
    inspectionFailed: false,
    exitObserved: false,
    elapsedMs: 8000,
    polls: 238,
    privatePath: '/private/profile',
  };
  await options.onStartupEndpointObservation(value);
  assert.equal(report.startup_endpoint_observations.length, 1);
  assert.equal(report.startup_endpoint_observations[0].endpointPresent, null);
  assert.doesNotMatch(JSON.stringify(report), /privatePath|private\/profile/);
  assert.equal(output.length, 1, 'safe callback must survive a later final-writer interruption');
  assert.doesNotMatch(output[0], /privatePath|private\/profile/);
  await options.onStartupEndpointObservation({
    phase: 'post_timeout',
    endpointPresent: false,
    presenceBasis: 'lstat',
    sampleTiming: { startedElapsedMs: 1, completedElapsedMs: 2, origin: 'post_timeout_observer' },
    recordInspection: { outcome: 'not_attempted', timing: null },
    inspectionFailed: false,
    exitObserved: false,
    elapsedMs: 2,
    polls: 1,
    privatePath: '/private/profile',
  });
  assert.equal(
    report.startup_endpoint_observations.length,
    2,
    'each distinct safe observation must be retained',
  );
  assert.equal(
    report.startup_endpoint_observations[1].endpointPresent,
    false,
    'callback cannot manufacture constant unknown',
  );
  assert.equal(output.length, 2);
});
