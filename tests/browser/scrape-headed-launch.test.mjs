import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
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
