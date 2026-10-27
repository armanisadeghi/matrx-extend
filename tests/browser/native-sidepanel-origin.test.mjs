import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runNativeResourceAction } from './native-resource-boundary.mjs';
import { launchNativeBrowser } from './native-sidepanel-qa-harness.mjs';

const source = await readFile(
  new URL('./native-sidepanel-qa-harness.mjs', import.meta.url),
  'utf8',
);
const contextStart = source.indexOf("    onStage('page_create');");
const contextEnd = source.indexOf("    onStage('local_page_navigation');", contextStart);
assert.ok(contextStart >= 0 && contextEnd > contextStart, 'page creation boundary exists');
const contextSource = source.slice(contextStart, contextEnd);
const launchStart = source.indexOf(
  "    let chromeStderr = '';",
  source.indexOf('export async function runNativeSidepanelQa'),
);
const launchEnd = source.indexOf("\n\n    try {\n      onStage('cdp_connect');", launchStart);
assert.ok(launchStart >= 0 && launchEnd > launchStart, 'gated native launch boundary exists');
const launchSource = source.slice(launchStart, launchEnd);

// Keep the real action/launch composition; adapt only external health, browser
// transport and process creation. No real Chrome or policy state is changed.
async function verifyOrigins(fragment = contextSource) {
  const declarations = source.match(/^const WEB_ORIGIN = (.+);$/m);
  const run = new Function(
    'playwrightBrowser',
    'markBrowserAgentTraffic',
    'onStage',
    'resourceAction',
    `return (async () => { ${declarations?.[0] ?? ''} ${fragment} })();`,
  );
  const calls = [];
  const events = [];
  const context = {
    newPage: async () => {
      events.push('new-page');
      return {};
    },
  };
  let healthError = null;
  const action = (work) =>
    runNativeResourceAction(async () => {
      events.push('health');
      if (healthError) throw healthError;
    }, work);
  const execute = () =>
    run(
      { contexts: () => [context] },
      async (observedContext, tool, origin) => {
        assert.equal(observedContext, context);
        events.push('mark');
        calls.push({ tool, origin });
      },
      () => {},
      action,
    );
  await execute();
  assert.deepEqual(calls, [
    { tool: 'native-sidepanel-qa-harness', origin: 'https://www.aimatrx.com' },
    { tool: 'native-sidepanel-qa-harness', origin: 'https://server.app.matrxserver.com' },
  ]);
  assert.deepEqual(events, ['health', 'mark', 'health', 'mark', 'health', 'new-page']);
  healthError = new Error('controlled external health refusal');
  await assert.rejects(execute(), (error) => error === healthError);
  assert.equal(calls.length, 2, 'refused marking must not reach either origin');
  assert.deepEqual(events.slice(6), ['health'], 'refusal must not create a page');
}

async function verifyLaunch(helper = launchNativeBrowser) {
  const launch = new Function(
    'spawn',
    'headed',
    'chromeExecutable',
    'profile',
    'verifiedExtensionDir',
    'launchNativeBrowser',
    'resourceAction',
    'onStage',
    'performance',
    'enableUserSiteRestrictions',
    'enableWebMcpTesting',
    `return (async () => { let child; let startupStartedAt; let launchError; ${launchSource} return { child, startupStartedAt }; })();`,
  );
  for (const headed of [true, false]) {
    const profile = headed ? '/owned/headed' : '/owned/headless';
    const calls = [];
    const events = [];
    const child = new EventEmitter();
    child.pid = headed ? 31 : 32;
    child.stderr = new EventEmitter();
    let healthError = null;
    const action = (work) =>
      runNativeResourceAction(async () => {
        events.push('health');
        if (healthError) throw healthError;
      }, work);
    const execute = () =>
      launch(
        (...args) => {
          events.push('spawn');
          calls.push(args);
          return child;
        },
        headed,
        '/owned/Chromium',
        profile,
        '/verified/extension',
        helper,
        action,
        (stage) => events.push(stage),
        { now: () => 17 },
        false,
        false,
      );
    const result = await execute();
    assert.equal(result.child, child);
    assert.equal(result.startupStartedAt, 17);
    assert.deepEqual(events, ['health', 'browser_spawn', 'spawn']);
    assert.equal(child.listenerCount('spawn'), 1);
    assert.equal(child.listenerCount('error'), 1);
    assert.equal(child.stderr.listenerCount('data'), 1);
    assert.deepEqual(calls, [
      [
        '/owned/Chromium',
        [
          ...(!headed ? ['--headless=new'] : []),
          '--enable-automation',
          '--no-first-run',
          '--no-default-browser-check',
          '--use-mock-keychain',
          '--remote-debugging-address=127.0.0.1',
          '--remote-debugging-port=0',
          `--user-data-dir=${profile}`,
          '--disable-extensions-except=/verified/extension',
          '--load-extension=/verified/extension',
          'about:blank',
        ],
        { stdio: ['ignore', 'ignore', 'pipe'] },
      ],
    ]);
    healthError = new Error('controlled external health refusal');
    await assert.rejects(execute(), (error) => error === healthError);
    assert.equal(calls.length, 1, 'refusal must not create a second Chrome child');
    assert.deepEqual(events.slice(3), ['health'], 'refusal must precede native launch stage');
    assert.equal(child.listenerCount('spawn'), 1, 'refusal must not attach more listeners');
  }
}

test('native sidepanel startup marks canonical web/server origins through the gated page boundary', () =>
  verifyOrigins());
test('native gated launch requests a blank initial page instead of implicit New Tab startup', () =>
  verifyLaunch());
test('origin/launch oracles reject in-memory constant success and omitted health gating', async () => {
  await assert.rejects(verifyOrigins(''), assert.AssertionError);
  await assert.rejects(
    verifyLaunch(async () => undefined),
    assert.AssertionError,
  );
  await assert.rejects(
    verifyLaunch(async ({ launch }) => launch()),
    assert.AssertionError,
  );
});
