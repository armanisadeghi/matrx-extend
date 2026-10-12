import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { test } from 'node:test';

const workflowPath = new URL('../.github/workflows/hosted-guest-acceptance.yml', import.meta.url);
const workflow = JSON.parse(
  execFileSync(
    'ruby',
    [
      '-ryaml',
      '-rjson',
      '-e',
      'puts JSON.dump(YAML.load_file(ARGV.fetch(0)))',
      workflowPath.pathname,
    ],
    { encoding: 'utf8' },
  ),
);
const provenance = workflow.jobs.guest.steps.find(
  (step) => step.name === 'Require exactly one artifact provenance mode',
).run;
const arm = execFileSync('uname', ['-m'], { encoding: 'utf8' }).trim() === 'arm64';

function check(acceptanceCase, overrides = {}, script = provenance) {
  return spawnSync('bash', ['-euo', 'pipefail', '-c', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      // Host architecture is external to the routing decision; exercise the real host branch.
      RUNNER_LABEL: arm ? 'macos-15' : 'macos-15-intel',
      RUNNER_ARCH: arm ? 'ARM64' : 'X64',
      ACCEPTANCE_CASE: acceptanceCase,
      RELEASE_RUN_ID: '',
      DEVELOPMENT_RUN_ID: '38200000001',
      DEVELOPMENT_ARTIFACT_ID: '11690000001',
      PUBLISHED_STORE_CRX: 'false',
      MEMBER_DATA_SCOPE: 'lifecycle',
      SCRAPE_DIAGNOSTIC_CPU_RATE: '',
      SCRAPE_AUTH_MODE: 'guest',
      SCRAPE_WIDTH_MODE: 'narrow',
      SCRAPE_NORMAL_WIDTH_PX: '',
      ...overrides,
    },
  });
}

test('Notes member development provenance reaches authentication preflight', () => {
  const result = check('notes-find-member', { SCRAPE_AUTH_MODE: 'member' });
  assert.equal(result.status, 0, `Notes member was refused before auth: ${result.stderr}`);
});

test('Notes refuses guest auth, other route scope, width overrides and mixed artifacts', () => {
  for (const overrides of [
    { SCRAPE_AUTH_MODE: 'guest' },
    { MEMBER_DATA_SCOPE: 'auto-extract' },
    { SCRAPE_WIDTH_MODE: 'normal', SCRAPE_NORMAL_WIDTH_PX: '600' },
    { SCRAPE_NORMAL_WIDTH_PX: '600' },
    { RELEASE_RUN_ID: '38200000002' },
    { DEVELOPMENT_ARTIFACT_ID: '' },
    { PUBLISHED_STORE_CRX: 'true' },
    { SCRAPE_DIAGNOSTIC_CPU_RATE: '4' },
  ]) {
    const result = check('notes-find-member', { SCRAPE_AUTH_MODE: 'member', ...overrides });
    assert.notEqual(result.status, 0, JSON.stringify(overrides));
  }
});

test('Notes exception does not admit member auth on guest routes', () => {
  for (const route of ['guest-seo', 'guest-data', 'guest-chat', 'scrape-error-recovery-guest']) {
    assert.equal(check(route).status, 0, route);
    assert.notEqual(check(route, { SCRAPE_AUTH_MODE: 'member' }).status, 0, route);
    assert.notEqual(check(route, { MEMBER_DATA_SCOPE: 'auto-extract' }).status, 0, route);
  }
});

test('member Data keeps its own member scope and width contract', () => {
  for (const scope of ['lifecycle', 'auto-extract']) {
    assert.equal(
      check('member-data', { SCRAPE_AUTH_MODE: 'member', MEMBER_DATA_SCOPE: scope }).status,
      0,
    );
  }
  for (const overrides of [
    { SCRAPE_AUTH_MODE: 'guest' },
    { MEMBER_DATA_SCOPE: 'notes' },
    { SCRAPE_WIDTH_MODE: 'normal', SCRAPE_NORMAL_WIDTH_PX: '600' },
  ]) {
    assert.notEqual(check('member-data', { SCRAPE_AUTH_MODE: 'member', ...overrides }).status, 0);
  }
});

test('Scrape development and release provenance constraints remain enforced', () => {
  assert.equal(check('guest-scrape-development').status, 0);
  assert.equal(check('scrape-save-member', { SCRAPE_AUTH_MODE: 'member' }).status, 0);
  assert.notEqual(check('guest-scrape').status, 0);
  const release = {
    RELEASE_RUN_ID: '38200000002',
    DEVELOPMENT_RUN_ID: '',
    DEVELOPMENT_ARTIFACT_ID: '',
  };
  assert.equal(check('guest-scrape', release).status, 0);
  assert.notEqual(check('guest-scrape-development', release).status, 0);
  assert.notEqual(
    check('scrape-save-member', { ...release, SCRAPE_AUTH_MODE: 'member' }).status,
    0,
  );
});
