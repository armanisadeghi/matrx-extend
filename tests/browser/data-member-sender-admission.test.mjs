import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync('.github/workflows/hosted-guest-acceptance.yml', 'utf8');
const admission = workflow.match(
  /# BEGIN hosted lane admission([\s\S]*?)# END hosted lane admission/,
)[1];

test('workflow sender diagnostic permits only Member Data and retains ordinary routes', () => {
  for (const [acceptanceCase, enabled, expected] of [
    ['member-data', '1', 0],
    ['guest-chat', '1', 1],
    ['guest-scrape-development', '1', 1],
    ['guest-chat', '0', 0],
    ['guest-scrape-development', '0', 0],
  ]) {
    const result = spawnSync('bash', ['-eu', '-c', admission], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ACCEPTANCE_LANE: 'A',
        ACCEPTANCE_CASE: acceptanceCase,
        RELOAD_SENDER_DOCUMENT_DIAGNOSTIC: enabled,
        SCRAPE_AUTH_MODE: acceptanceCase === 'member-data' ? 'member' : 'guest',
        SCRAPE_SAVE_DESTINATION: 'project',
        DESKTOP_SETTINGS_CASE: 'full',
        SEO_CASE_SCOPE: 'full',
        SEO_METADATA_FIXTURE: 'none',
        SEO_INTERRUPT_AFTER_TARGET: 'none',
      },
    });
    assert.equal(result.status, expected, `${acceptanceCase}/${enabled}: ${result.stderr}`);
    if (expected === 1)
      assert.match(result.stderr, /Sender document diagnostic requires member-data/);
  }
});
