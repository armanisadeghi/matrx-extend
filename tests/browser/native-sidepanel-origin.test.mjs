import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('native sidepanel startup marks the canonical web and server origins without globals', async () => {
  const source = await readFile(
    new URL('./native-sidepanel-qa-harness.mjs', import.meta.url),
    'utf8',
  );
  const start = source.indexOf("    onStage('page_create');");
  const end = source.indexOf('    const page = await context.newPage();', start);
  assert.ok(start >= 0 && end > start, 'page_create marker block exists');

  const declarations = source.match(/^const WEB_ORIGIN = (.+);$/m);
  const calls = [];
  const run = new Function(
    'playwrightBrowser',
    'markBrowserAgentTraffic',
    'onStage',
    `return (async () => { ${declarations?.[0] ?? ''} ${source.slice(start, end)} })();`,
  );
  await run(
    { contexts: () => [{}] },
    async (_context, tool, origin) => calls.push({ tool, origin }),
    () => {},
  );
  assert.deepEqual(calls, [
    { tool: 'native-sidepanel-qa-harness', origin: 'https://www.aimatrx.com' },
    { tool: 'native-sidepanel-qa-harness', origin: 'https://server.app.matrxserver.com' },
  ]);
});

test('native launch requests a blank initial page instead of implicit New Tab startup', async () => {
  const source = await readFile(
    new URL('./native-sidepanel-qa-harness.mjs', import.meta.url),
    'utf8',
  );
  const start = source.indexOf('    child = ', source.indexOf("    onStage('browser_spawn');"));
  const end = source.indexOf("    let chromeStderr = '';", start);
  assert.ok(start >= 0 && end > start, 'native spawn block exists');
  // Execute the production launch call; only the external process creation is replaced.
  const launch = new Function(
    'spawn',
    'headed',
    'chromeExecutable',
    'profile',
    'verifiedExtensionDir',
    `let child; ${source.slice(start, end)} return child;`,
  );
  for (const headed of [true, false]) {
    const profile = headed ? '/owned/headed' : '/owned/headless';
    const calls = [];
    const child = { pid: headed ? 31 : 32 };
    assert.equal(
      launch(
        (...args) => {
          calls.push(args);
          return child;
        },
        headed,
        '/owned/Chromium',
        profile,
        '/verified/extension',
      ),
      child,
    );
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
  }
});
