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
