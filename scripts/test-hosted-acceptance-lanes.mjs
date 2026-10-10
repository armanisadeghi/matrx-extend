import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const workflowPaths = [
  new URL('../.github/workflows/hosted-guest-acceptance.yml', import.meta.url).pathname,
  new URL('../.github/workflows/hosted-resource-diagnostic.yml', import.meta.url).pathname,
];
const [acceptanceYaml, diagnosticYaml] = JSON.parse(
  execFileSync(
    'ruby',
    [
      '-ryaml',
      '-rjson',
      '-e',
      'puts JSON.dump(ARGV.map { |path| YAML.load_file(path) })',
      ...workflowPaths,
    ],
    { encoding: 'utf8' },
  ),
);
const acceptance = readFileSync(workflowPaths[0], 'utf8');
const guest = acceptanceYaml.jobs.guest;
const admission = guest.steps[0].run;
// Psych implements YAML 1.1 and reads the GitHub Actions `on` key as boolean true.
const dispatch = (acceptanceYaml.on ?? acceptanceYaml.true).workflow_dispatch;

test('hosted acceptance has exactly two fixed concurrency lanes, including diagnosis', () => {
  assert.deepEqual(dispatch.inputs.acceptance_lane.options, ['A', 'B']);
  assert.equal(dispatch.inputs.acceptance_lane.default, 'A');
  assert.equal(
    guest.concurrency.group,
    "${{ inputs.acceptance_lane == 'B' && 'hosted-guest-side-panel-B' || 'hosted-guest-side-panel-A' }}",
  );
  const expression = guest.concurrency.group.slice(3, -2).trim();
  const groupFor = (acceptance_lane) =>
    runInNewContext(expression, { inputs: { acceptance_lane } });
  assert.deepEqual(['A', 'B', '', 'C'].map(groupFor), [
    'hosted-guest-side-panel-A',
    'hosted-guest-side-panel-B',
    'hosted-guest-side-panel-A',
    'hosted-guest-side-panel-A',
  ]);
  assert.equal(diagnosticYaml.jobs.diagnose.concurrency.group, 'hosted-guest-side-panel-A');
  assert.equal(guest.concurrency['cancel-in-progress'], false);
  assert.equal(diagnosticYaml.jobs.diagnose.concurrency['cancel-in-progress'], false);
  assert.equal(
    guest['runs-on'],
    "${{ inputs.runner_label == 'macos-15' && 'macos-15' || 'macos-15-intel' }}",
  );
  assert.equal(
    (acceptance.match(/node scripts\/stabilization-resource\.mjs run/g) ?? []).length,
    4,
  );
});

test('lane admission refuses unknown lanes and isolates shared credentials', () => {
  assert.match(admission, /BEGIN hosted lane admission/);
  const check = (
    lane,
    acceptanceCase,
    scrapeAuth = 'guest',
    seoCaseScope = 'full',
    seoFixture = 'none',
    seoInterrupt = 'none',
    scrapeSaveScope = 'single',
    scrapeSaveDestination = 'project',
  ) =>
    spawnSync('bash', ['-euo', 'pipefail', '-c', admission], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ACCEPTANCE_LANE: lane,
        ACCEPTANCE_CASE: acceptanceCase,
        SCRAPE_AUTH_MODE: scrapeAuth,
        SCRAPE_SAVE_DESTINATION: scrapeSaveDestination,
        SCRAPE_SAVE_SCOPE: scrapeSaveScope,
        DESKTOP_SETTINGS_CASE: 'full',
        SEO_CASE_SCOPE: seoCaseScope,
        SEO_METADATA_FIXTURE: seoFixture,
        SEO_INTERRUPT_AFTER_TARGET: seoInterrupt,
      },
    });
  for (const lane of ['A', 'B']) assert.equal(check(lane, 'guest-chat').status, 0, lane);
  assert.equal(guest.steps[0].env.SCRAPE_SAVE_SCOPE, "${{ inputs.scrape_save_scope || 'single' }}");
  for (const lane of ['', 'C', 'A-extra'])
    assert.notEqual(check(lane, 'guest-chat').status, 0, lane);
  const cases = dispatch.inputs.acceptance_case.options;
  for (const acceptanceCase of cases) {
    const scrapeAuth =
      acceptanceCase === 'scrape-save-member' || acceptanceCase === 'member-data'
        ? 'member'
        : 'guest';
    if (acceptanceCase === 'scrape-error-recovery-guest') {
      assert.notEqual(
        check('A', acceptanceCase, scrapeAuth).status,
        0,
        'guest scrape error recovery is deliberately B-only',
      );
      assert.equal(check('B', acceptanceCase, 'guest').status, 0);
      for (const authMode of ['member', 'admin'])
        assert.notEqual(
          check('B', acceptanceCase, authMode).status,
          0,
          `guest scrape error recovery refuses ${authMode} auth`,
        );
      continue;
    }
    assert.equal(check('A', acceptanceCase, scrapeAuth).status, 0, acceptanceCase);
    const usesSharedFixture =
      acceptanceCase.endsWith('-admin') ||
      acceptanceCase.endsWith('-member') ||
      acceptanceCase === 'member-chat' ||
      acceptanceCase === 'member-data' ||
      acceptanceCase === 'prepare-stale-results' ||
      acceptanceCase.startsWith('showcase-');
    assert.equal(
      check('B', acceptanceCase, scrapeAuth).status === 0,
      !usesSharedFixture,
      acceptanceCase,
    );
  }
  assert.notEqual(
    check('B', 'records-readonly-admin').status,
    0,
    'Records admin cannot enter lane B',
  );
  for (const unknownCase of ['', 'surprise-guest', 'surprise-admin'])
    assert.notEqual(check('A', unknownCase).status, 0, unknownCase);
  for (const scrapeAuth of ['member', 'admin']) {
    assert.notEqual(check('B', 'guest-scrape', scrapeAuth).status, 0, scrapeAuth);
    assert.equal(check('A', 'guest-scrape', scrapeAuth).status, 0, scrapeAuth);
  }
  assert.equal(check('B', 'guest-scrape', 'guest').status, 0);
  assert.equal(
    check('A', 'scrape-save-member', 'member', 'full', 'none', 'none', 'duplicate-rename', 'none')
      .status,
    0,
  );
  for (const authMode of ['guest', 'admin'])
    assert.notEqual(
      check('A', 'scrape-save-member', authMode, 'full', 'none', 'none', 'duplicate-rename', 'none')
        .status,
      0,
      `duplicate rename refuses ${authMode} auth`,
    );
  assert.notEqual(
    check('B', 'scrape-save-member', 'member', 'full', 'none', 'none', 'duplicate-rename', 'none')
      .status,
    0,
    'duplicate rename requires lane A',
  );
  assert.notEqual(
    check('A', 'scrape-save-member', 'member', 'full', 'none', 'none', 'duplicate-rename').status,
    0,
  );
  assert.notEqual(
    check('A', 'guest-chat', 'guest', 'full', 'none', 'none', 'duplicate-rename').status,
    0,
  );
  assert.equal(check('B', 'guest-seo').status, 0);
  assert.equal(check('B', 'guest-seo', 'guest', 'controlled').status, 0);
  assert.notEqual(check('B', 'guest-chat', 'guest', 'controlled').status, 0);
  assert.notEqual(check('B', 'guest-seo', 'guest', 'unknown').status, 0);
  assert.equal(check('B', 'guest-seo', 'guest', 'full', 'airbnb').status, 0);
  assert.notEqual(check('B', 'guest-seo', 'guest', 'full', 'bogus').status, 0);
  assert.notEqual(check('B', 'guest-chat', 'guest', 'full', 'airbnb').status, 0);
  assert.notEqual(check('B', 'guest-seo', 'guest', 'controlled', 'airbnb').status, 0);
  const target = 'manual_button_returns_to_current_page';
  assert.equal(check('B', 'guest-seo', 'guest', 'controlled', 'none', target).status, 0);
  for (const [lane, acceptanceCase, scope, fixture, selector] of [
    ['A', 'guest-seo', 'controlled', 'none', target],
    ['B', 'guest-chat', 'controlled', 'none', target],
    ['B', 'guest-seo', 'full', 'none', target],
    ['B', 'guest-seo', 'controlled', 'airbnb', target],
    ['B', 'guest-seo', 'controlled', 'none', 'unknown_target'],
  ])
    assert.notEqual(check(lane, acceptanceCase, 'guest', scope, fixture, selector).status, 0);
});
