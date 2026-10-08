import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
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

test('production launch seam verifies CDP mode before emitting the receipt observation', async () => {
  const harness = await readFile(
    new URL('./native-sidepanel-qa-harness.mjs', import.meta.url),
    'utf8',
  );
  const start = harness.indexOf("    onStage('command_line_query');");
  const end = harness.indexOf('    let extensionWorker;', start);
  assert.ok(start >= 0 && end > start, 'owned CDP launch verification seam missing');
  const runSeam = new Function(
    'cdp',
    'headed',
    'onStage',
    'requireOwnedCommandLine',
    'requireBrowserDisplayMode',
    'onBrowserLaunchObservation',
    'profile',
    `return (async () => { ${harness.slice(start, end)} })();`,
  );
  const stages = [];
  const observations = [];
  const execute = (arguments_) =>
    runSeam(
      {
        send: async (method) => {
          assert.equal(method, 'Browser.getBrowserCommandLine');
          return { arguments: arguments_ };
        },
      },
      true,
      (stage) => stages.push(stage),
      () => {},
      requireBrowserDisplayMode,
      (observation) => observations.push(observation),
      '/owned/profile',
    );
  await execute(['--user-data-dir=/owned/profile', '--remote-debugging-port=0']);
  assert.equal(observations[0].observed_mode, 'headed');
  await assert.rejects(
    execute(['--user-data-dir=/owned/profile', '--remote-debugging-port=0', '--headless=new']),
    /display_mode_mismatch/,
  );
  assert.equal(observations.length, 1, 'mismatched launch must not reach acceptance receipt');
  assert.deepEqual(stages, [
    'command_line_query',
    'command_line_verify',
    'command_line_query',
    'command_line_verify',
  ]);
});
