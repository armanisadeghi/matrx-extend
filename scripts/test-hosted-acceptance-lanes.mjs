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
  const check = (lane, acceptanceCase, scrapeAuth = 'guest', seoCaseScope = 'full') =>
    spawnSync('bash', ['-euo', 'pipefail', '-c', admission], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ACCEPTANCE_LANE: lane,
        ACCEPTANCE_CASE: acceptanceCase,
        SCRAPE_AUTH_MODE: scrapeAuth,
        DESKTOP_SETTINGS_CASE: 'full',
        SEO_CASE_SCOPE: seoCaseScope,
      },
    });
  for (const lane of ['A', 'B']) assert.equal(check(lane, 'guest-chat').status, 0, lane);
  for (const lane of ['', 'C', 'A-extra'])
    assert.notEqual(check(lane, 'guest-chat').status, 0, lane);
  const cases = dispatch.inputs.acceptance_case.options;
  for (const acceptanceCase of cases) {
    assert.equal(check('A', acceptanceCase).status, 0, acceptanceCase);
    const usesSharedFixture =
      acceptanceCase.endsWith('-admin') ||
      acceptanceCase.endsWith('-member') ||
      acceptanceCase === 'member-chat' ||
      acceptanceCase === 'prepare-stale-results' ||
      acceptanceCase.startsWith('showcase-');
    assert.equal(check('B', acceptanceCase).status === 0, !usesSharedFixture, acceptanceCase);
  }
  for (const unknownCase of ['', 'surprise-guest', 'surprise-admin'])
    assert.notEqual(check('A', unknownCase).status, 0, unknownCase);
  for (const scrapeAuth of ['member', 'admin']) {
    assert.notEqual(check('B', 'guest-scrape', scrapeAuth).status, 0, scrapeAuth);
    assert.equal(check('A', 'guest-scrape', scrapeAuth).status, 0, scrapeAuth);
  }
  assert.equal(check('B', 'guest-scrape', 'guest').status, 0);
  assert.equal(check('B', 'guest-seo').status, 0);
  assert.equal(check('B', 'guest-seo', 'guest', 'controlled').status, 0);
  assert.notEqual(check('B', 'guest-chat', 'guest', 'controlled').status, 0);
  assert.notEqual(check('B', 'guest-seo', 'guest', 'unknown').status, 0);
});
