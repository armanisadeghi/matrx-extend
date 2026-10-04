import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { requireHostedScrapeRoute } from './hosted-scrape-route.mjs';

const development = { kind: 'ci_development_test', eligibleStore: false };
const store = { kind: 'published_store_zip_adapted' };

test('development Scrape requires verified CI development provenance', () => {
  assert.deepEqual(
    requireHostedScrapeRoute('guest-scrape-development', 'development', development),
    {
      driver: 'tests/browser/scrape-guest-native-acceptance.mjs',
      channel: 'development',
    },
  );
  for (const [mode, prepared] of [
    ['release', development],
    ['published-crx', development],
    ['development', store],
    ['development', { ...development, eligibleStore: true }],
    ['development', { kind: 'local_dev_unpacked', eligibleStore: false }],
  ])
    assert.throws(() => requireHostedScrapeRoute('guest-scrape-development', mode, prepared));
});

test('Store Scrape keeps its release ZIP restriction', () => {
  assert.equal(requireHostedScrapeRoute('guest-scrape', 'release', store).channel, 'store');
  for (const [mode, prepared] of [
    ['development', development],
    ['release', development],
    ['published-crx', store],
  ])
    assert.throws(() => requireHostedScrapeRoute('guest-scrape', mode, prepared));
});

test('workflow admits development Scrape only with one complete development selection', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/hosted-guest-acceptance.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /- guest-scrape-development/);
  assert.match(
    workflow,
    /"\$ACCEPTANCE_CASE" == guest-scrape-development[^\n]*\n\s*\[\[ -z "\$RELEASE_RUN_ID" && -n "\$DEVELOPMENT_RUN_ID" && -n "\$DEVELOPMENT_ARTIFACT_ID" && "\$PUBLISHED_STORE_CRX" != true \]\]/,
  );
});
