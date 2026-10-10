import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { hostedScrapeReloadDiagnostic } from './hosted-scrape-reload-diagnostic.mjs';

test('diagnostic flag defaults off and only development Scrape and member Data routes accept opt-in', () => {
  assert.equal(hostedScrapeReloadDiagnostic('guest-scrape-development'), '0');
  assert.equal(hostedScrapeReloadDiagnostic('guest-scrape-development', '1'), '1');
  assert.equal(hostedScrapeReloadDiagnostic('member-data', '1'), '1');
  assert.equal(hostedScrapeReloadDiagnostic('member-data', '0'), '0');
  for (const [acceptanceCase, value] of [
    ['guest-scrape', '1'],
    ['guest-chat', '1'],
    ['guest-scrape-development', 'true'],
  ])
    assert.throws(() => hostedScrapeReloadDiagnostic(acceptanceCase, value));
});

test('hosted preflight refuses diagnostic on wrong case before resource or browser setup', () => {
  const preflight = (acceptanceCase, flag) =>
    spawnSync(process.execPath, ['scripts/hosted-guest-acceptance.mjs'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_ACTIONS: 'true',
        MATRX_HOSTED_PHASE: 'preflight',
        MATRX_HOSTED_ACCEPTANCE_CASE: acceptanceCase,
        MATRX_SCRAPE_RELOAD_OPEN_DIAGNOSTIC: flag,
        MATRX_SCRAPE_AUTH_MODE: 'guest',
        MATRX_HOSTED_MEMBER_LINK_JSON: '',
        MATRX_SCRAPE_WIDTH_MODE: 'normal',
        MATRX_SCRAPE_MIN_PANEL_WIDTH_PX: '600',
      },
    });
  assert.equal(preflight('guest-scrape-development', '0').status, 0);
  assert.equal(preflight('guest-scrape-development', '1').status, 0);
  // Valid diagnostic routing must reach the unchanged member credential gate.
  const member = preflight('member-data', '1');
  assert.notEqual(member.status, 0);
  assert.match(member.stderr, /hosted_member_link_secret_required/);
  assert.doesNotMatch(member.stderr, /scrape_reload_diagnostic_requires/);
  for (const [acceptanceCase, flag] of [
    ['guest-scrape', '1'],
    ['guest-chat', '1'],
    ['guest-scrape-development', 'yes'],
  ]) {
    const result = preflight(acceptanceCase, flag);
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stderr, /hosted phase requires owned resource permit/);
  }
});

test('hosted workflow exposes and forwards opt-in in preflight and acceptance', () => {
  const yaml = readFileSync('.github/workflows/hosted-guest-acceptance.yml', 'utf8');
  assert.match(
    yaml,
    /scrape_reload_open_diagnostic:\n\s+description:[^\n]+\n\s+required: false\n\s+default: false\n\s+type: boolean/,
  );
  assert.equal(
    (
      yaml.match(
        /MATRX_SCRAPE_RELOAD_OPEN_DIAGNOSTIC: \$\{\{ inputs\.scrape_reload_open_diagnostic == true && '1' \|\| '0' \}\}/g,
      ) ?? []
    ).length,
    2,
  );
  const hosted = readFileSync('scripts/hosted-guest-acceptance.mjs', 'utf8');
  assert.match(hosted, /MATRX_SCRAPE_RELOAD_OPEN_DIAGNOSTIC: scrapeReloadDiagnostic/);
});
