import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { hostedAcceptanceRoute } from './hosted-acceptance-route.mjs';
import { hostedNotesFindRoute } from './hosted-notes-find-route.mjs';
import { requireHostedAcceptanceCredential } from './hosted-profile-route.mjs';
const prepared = {
  kind: 'ci_development_test',
  sourceSha: 'a'.repeat(40),
  runId: 123,
  artifactId: 456,
  extensionDir: '/tmp/artifact/chrome-mv3',
  relocatedReceipt: '/tmp/artifact/local-dev-receipt.json',
};

test('Notes route admits only lane A and the exact CI member T02 artifact', () => {
  assert.equal(
    hostedAcceptanceRoute('notes-find-member', 'development', prepared).acceptanceCase,
    'notes-find-member',
  );
  const route = hostedNotesFindRoute('notes-find-member', prepared, 'A');
  assert.equal(route.driver, 'tests/browser/notes-native-acceptance.mjs');
  assert.equal(route.env.NOTES_CASE, 't02');
  assert.equal(route.env.NOTES_ROLE, 'member');
  assert.equal(route.env.NOTES_EXPECTED_CI_RUN_ID, '123');
  assert.equal(route.env.NOTES_EXPECTED_ARTIFACT_ID, '456');
  for (const lane of ['B', '', undefined])
    assert.throws(
      () => hostedNotesFindRoute('notes-find-member', prepared, lane),
      /lane_a_required/,
    );
  for (const change of [
    { kind: 'published_store_zip' },
    { sourceSha: '' },
    { runId: 0 },
    { artifactId: null },
    { extensionDir: 'relative' },
    { relocatedReceipt: '' },
  ])
    assert.throws(() => hostedNotesFindRoute('notes-find-member', { ...prepared, ...change }, 'A'));
  assert.throws(() => hostedNotesFindRoute('guest-chat', prepared, 'A'), /case_refused/);
});
test('D201 lazy General picker uses a separate read-only member case on the same CI target', () => {
  const name = 'notes-lazy-general-member';
  assert.equal(hostedAcceptanceRoute(name, 'development', prepared).acceptanceCase, name);
  const route = hostedNotesFindRoute(name, prepared, 'A');
  assert.equal(route.driver, 'tests/browser/notes-native-acceptance.mjs');
  assert.equal(route.env.NOTES_CASE, 'lazy-general-picker');
  assert.equal(route.env.NOTES_ROLE, 'member');
  assert.equal(route.env.NOTES_EXPECTED_SOURCE_SHA, prepared.sourceSha);
  assert.equal(route.env.NOTES_EXPECTED_CI_RUN_ID, '123');
  assert.equal(route.env.NOTES_EXPECTED_ARTIFACT_ID, '456');
  for (const bad of ['B', undefined])
    assert.throws(() => hostedNotesFindRoute(name, prepared, bad), /lane_a_required/);
  for (const change of [{ kind: 'release' }, { runId: 0 }, { sourceSha: '' }])
    assert.throws(() => hostedNotesFindRoute(name, { ...prepared, ...change }, 'A'));
  assert.throws(() => requireHostedAcceptanceCredential(name, {}), /member_link_secret_required/);
});
test('Notes credential preflight refuses missing and wrong member identity', () => {
  assert.throws(
    () => requireHostedAcceptanceCredential('notes-find-member', {}),
    /hosted_member_link_secret_required/,
  );
  assert.throws(
    () =>
      requireHostedAcceptanceCredential('notes-find-member', {
        MATRX_HOSTED_MEMBER_LINK_JSON: JSON.stringify({ email: 'admin@admin.com' }),
      }),
    /d87_member_fingerprint_mismatch/,
  );
});
test('workflow dispatch reaches Notes and preserves guarded evidence without private ledgers', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/hosted-guest-acceptance.yml', import.meta.url),
    'utf8',
  );
  const parsed = JSON.parse(
    spawnSync(
      'ruby',
      [
        '-ryaml',
        '-rjson',
        '-e',
        'puts JSON.dump(YAML.load_file(ARGV[0]))',
        new URL('../.github/workflows/hosted-guest-acceptance.yml', import.meta.url).pathname,
      ],
      { encoding: 'utf8' },
    ).stdout,
  );
  assert.ok(
    (parsed.on ?? parsed.true).workflow_dispatch.inputs.acceptance_case.options.includes(
      'notes-find-member',
    ),
  );
  const admission = parsed.jobs.guest.steps[0].run;
  const check = (lane) =>
    spawnSync('bash', ['-euo', 'pipefail', '-c', admission], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ACCEPTANCE_LANE: lane,
        ACCEPTANCE_CASE: 'notes-find-member',
        SCRAPE_AUTH_MODE: 'guest',
        SCRAPE_SAVE_DESTINATION: 'project',
        SCRAPE_SAVE_SCOPE: 'single',
        DESKTOP_SETTINGS_CASE: 'full',
        SEO_CASE_SCOPE: 'full',
        SEO_METADATA_FIXTURE: 'none',
        SEO_INTERRUPT_AFTER_TARGET: 'none',
      },
    });
  assert.equal(check('A').status, 0);
  assert.notEqual(check('B').status, 0);
  const upload = parsed.jobs.guest.steps.find((s) => s.uses === 'actions/upload-artifact@v4').with
    .path;
  assert.ok(upload.includes('test-results/notes-native-acceptance.json'));
  assert.ok(!/notes-(?:find-fixture|owned-fixture|private-config)/.test(upload));
  for (const phase of ['package', 'browser', 'guest'])
    assert.ok(upload.includes(`resource-journals/hosted-${phase}-`));
  assert.match(workflow, /native-ai-member-probe \|\| "\$ACCEPTANCE_CASE" == notes-find-member/);
  const runner = readFileSync(new URL('./hosted-guest-acceptance.mjs', import.meta.url), 'utf8');
  assert.match(runner, /const driver =\s*notesFindRoute\?\.driver/);
  assert.match(runner, /\.\.\.\(notesFindRoute\?\.env/);
  assert.match(runner, /hostedNotesFindRoute\(acceptanceCase, prepared,/);
});
test('workflow admits D201 only as member CI development on native A and keeps T02 separate', () => {
  const path = new URL('../.github/workflows/hosted-guest-acceptance.yml', import.meta.url)
    .pathname;
  const parsed = JSON.parse(
    spawnSync('ruby', ['-ryaml', '-rjson', '-e', 'puts JSON.dump(YAML.load_file(ARGV[0]))', path], {
      encoding: 'utf8',
    }).stdout,
  );
  const choice = (parsed.on ?? parsed.true).workflow_dispatch.inputs.acceptance_case.options;
  assert.ok(choice.includes('notes-lazy-general-member'));
  const admission = parsed.jobs.guest.steps[0].run;
  const provenance = parsed.jobs.guest.steps.find(
    (step) => step.name === 'Require exactly one artifact provenance mode',
  ).run;
  const check = (script, overrides = {}) =>
    spawnSync('bash', ['-euo', 'pipefail', '-c', script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ACCEPTANCE_CASE: 'notes-lazy-general-member',
        ACCEPTANCE_LANE: 'A',
        SCRAPE_AUTH_MODE: 'member',
        SCRAPE_SAVE_DESTINATION: 'project',
        SCRAPE_SAVE_SCOPE: 'single',
        DESKTOP_SETTINGS_CASE: 'full',
        SEO_CASE_SCOPE: 'full',
        SEO_METADATA_FIXTURE: 'none',
        SEO_INTERRUPT_AFTER_TARGET: 'none',
        MEMBER_DATA_SCOPE: 'lifecycle',
        RELEASE_RUN_ID: '',
        DEVELOPMENT_RUN_ID: '38116138170',
        DEVELOPMENT_ARTIFACT_ID: '11700000000',
        PUBLISHED_STORE_CRX: 'false',
        SCRAPE_WIDTH_MODE: 'narrow',
        SCRAPE_NORMAL_WIDTH_PX: '',
        SCRAPE_DIAGNOSTIC_CPU_RATE: '',
        RUNNER_LABEL: process.arch === 'arm64' ? 'macos-15' : 'macos-15-intel',
        RUNNER_ARCH: process.arch === 'arm64' ? 'ARM64' : 'X64',
        ...overrides,
      },
    });
  assert.equal(check(admission).status, 0);
  const validProvenance = check(provenance);
  assert.equal(validProvenance.status, 0, validProvenance.stderr);
  for (const change of [
    { ACCEPTANCE_LANE: 'B' },
    { SCRAPE_AUTH_MODE: 'guest' },
    { RELEASE_RUN_ID: '38116138171' },
    { DEVELOPMENT_ARTIFACT_ID: '' },
  ]) {
    assert.notEqual(
      check(admission, change).status + check(provenance, change).status,
      0,
      JSON.stringify(change),
    );
  }
  const workflow = readFileSync(path, 'utf8');
  assert.match(
    workflow,
    /inputs\.acceptance_case == 'notes-find-member' && inputs\.acceptance_lane == 'A'/,
  );
  assert.doesNotMatch(
    workflow,
    /notes-lazy-general-member && inputs\.acceptance_lane == 'A' && '1'/,
  );
});

test('hosted Notes native path uses real member proof and owned fixture cleanup', () => {
  const driver = readFileSync(
    new URL('../tests/browser/notes-native-acceptance.mjs', import.meta.url),
    'utf8',
  );
  assert.match(driver, /HOSTED_FIND[\s\S]*signInSettings\(/);
  assert.match(driver, /memberLinkFile: process.env.MATRX_REVIEWER_MAGIC_LINK_FILE/);
  assert.match(driver, /allowLadderOrganization: true/);
  assert.match(
    driver,
    /report.imported_artifact.runId, Number\(process.env.NOTES_EXPECTED_CI_RUN_ID\)/,
  );
  assert.match(
    driver,
    /report.imported_artifact.artifactId,[\s\S]*Number\(process.env.NOTES_EXPECTED_ARTIFACT_ID\)/,
  );
  const fixture = readFileSync(
    new URL('../tests/browser/notes-find-native-case.mjs', import.meta.url),
    'utf8',
  );
  assert.match(fixture, /finally \{[\s\S]*recordNotesFindDeleted/);
  assert.match(fixture, /!testError && report.cleanup_complete \? 'pass' : 'unverified'/);
});
