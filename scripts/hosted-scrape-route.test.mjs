import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { scrapeNativeSelection } from '../tests/browser/scrape-native-selection.mjs';
import { hostedAcceptanceRoute } from './hosted-acceptance-route.mjs';
import { requireHostedAcceptanceCredential } from './hosted-profile-route.mjs';
import {
  hostedScrapeSaveDestination,
  requireHostedScrapeRoute,
  verifyHostedScrapeSaveAssociations,
} from './hosted-scrape-route.mjs';

const development = { kind: 'ci_development_test', eligibleStore: false };
const store = { kind: 'published_store_zip_adapted' };

test('the native acceptance runner admits and routes guest T14 to its real recovery driver', () => {
  assert.deepEqual(
    hostedAcceptanceRoute('scrape-error-recovery-guest', 'development', development, 'guest'),
    {
      acceptanceCase: 'scrape-error-recovery-guest',
      scrapeRoute: {
        driver: 'tests/browser/scrape-error-recovery-guest.mjs',
        channel: 'development',
      },
    },
  );
  assert.throws(
    () => hostedAcceptanceRoute('not-a-hosted-case', 'development', development, 'guest'),
    /unknown_hosted_acceptance_case/,
  );
  assert.throws(
    () =>
      hostedAcceptanceRoute('scrape-error-recovery-guest', 'development', development, 'member'),
    /scrape_recovery_guest_auth_required/,
  );
  assert.deepEqual(
    scrapeNativeSelection({ MATRX_SCRAPE_AUTH_MODE: 'guest', MATRX_SCRAPE_WIDTH_MODE: 'narrow' }),
    { mode: 'guest', widthMode: 'narrow', minimumPanelWidth: null },
  );
});

function workflowStepScript(workflow, stepName) {
  const stepStart = workflow.indexOf(`      - name: ${stepName}`);
  assert.notEqual(stepStart, -1, `workflow step ${stepName} exists`);
  const runStart = workflow.indexOf('        run: |\n', stepStart);
  assert.notEqual(runStart, -1, `workflow step ${stepName} has a shell body`);
  const bodyStart = runStart + '        run: |\n'.length;
  const lines = workflow.slice(bodyStart).split('\n');
  const body = [];
  for (const line of lines) {
    if (line.startsWith('      - ')) break;
    if (line.length === 0) {
      body.push('');
      continue;
    }
    assert.ok(line.startsWith('          '), `unexpected YAML indentation in ${stepName}`);
    body.push(line.slice(10));
  }
  return body.join('\n');
}

function runWorkflowStep(script, env) {
  return spawnSync('bash', ['-euo', 'pipefail', '-c', script], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

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

test('D187 Save Source requires the exact unpublished CI development artifact', () => {
  assert.deepEqual(requireHostedScrapeRoute('scrape-save-member', 'development', development), {
    driver: 'tests/browser/scrape-save-native-acceptance.mjs',
    channel: 'development',
  });
  for (const [mode, prepared] of [
    ['release', development],
    ['published-crx', development],
    ['development', store],
    ['development', { ...development, eligibleStore: true }],
    ['development', { kind: 'local_dev_unpacked', eligibleStore: false }],
  ])
    assert.throws(() => requireHostedScrapeRoute('scrape-save-member', mode, prepared));
  assert.deepEqual(
    scrapeNativeSelection({ MATRX_SCRAPE_AUTH_MODE: 'member', MATRX_SCRAPE_WIDTH_MODE: 'narrow' }),
    { mode: 'member', widthMode: 'narrow', minimumPanelWidth: null },
  );
  assert.throws(
    () => requireHostedAcceptanceCredential('scrape-save-member', {}),
    /hosted_member_link_secret_required/,
  );
  assert.throws(
    () =>
      requireHostedAcceptanceCredential('scrape-save-member', {
        MATRX_HOSTED_MEMBER_LINK_JSON: JSON.stringify({
          email: 'admin@admin.com',
          action_link: 'https://www.aimatrx.com/auth/confirm?type=magiclink&token_hash=invalid',
        }),
      }),
    /d87_member_fingerprint_mismatch/,
  );
});

test('D187 destination mode admits only the explicit project and no-destination cases', () => {
  assert.equal(hostedScrapeSaveDestination('scrape-save-member', 'project'), 'project');
  assert.equal(hostedScrapeSaveDestination('scrape-save-member', 'none'), 'none');
  assert.throws(
    () => hostedScrapeSaveDestination('scrape-save-member', 'library'),
    /scrape_save_destination_invalid/,
  );
  assert.throws(
    () => hostedScrapeSaveDestination('guest-chat', 'none'),
    /scrape_save_destination_case_refused/,
  );
  assert.equal(verifyHostedScrapeSaveAssociations('none', [], null, 'org'), 'none');
  assert.throws(
    () => verifyHostedScrapeSaveAssociations('none', [{ other_type: 'project' }], null, 'org'),
    /scrape_save_unselected_association_persisted/,
  );
  assert.equal(
    verifyHostedScrapeSaveAssociations(
      'project',
      [{ other_type: 'project', other_id: 'project-id', organization_id: 'org' }],
      'project-id',
      'org',
    ),
    'project',
  );
  assert.throws(
    () => verifyHostedScrapeSaveAssociations('project', [], 'project-id', 'org'),
    /scrape_save_selected_project_edge_missing/,
  );
});

test('guest T14 recovery is development-artifact and guest-only', async () => {
  assert.deepEqual(
    requireHostedScrapeRoute('scrape-error-recovery-guest', 'development', development, 'guest'),
    {
      driver: 'tests/browser/scrape-error-recovery-guest.mjs',
      channel: 'development',
    },
  );
  for (const [mode, prepared, authMode] of [
    ['release', development, 'guest'],
    ['development', store, 'guest'],
    ['development', { ...development, eligibleStore: true }, 'guest'],
    ['development', development, 'member'],
    ['development', development, undefined],
  ]) {
    assert.throws(() =>
      requireHostedScrapeRoute('scrape-error-recovery-guest', mode, prepared, authMode),
    );
  }
});

test('Scrape auth mode requires matching staged credential before browser setup', () => {
  for (const acceptanceCase of ['guest-scrape', 'guest-scrape-development']) {
    requireHostedAcceptanceCredential(acceptanceCase, { MATRX_SCRAPE_AUTH_MODE: 'guest' });
    assert.throws(
      () => requireHostedAcceptanceCredential(acceptanceCase, { MATRX_SCRAPE_AUTH_MODE: 'member' }),
      /hosted_member_link_secret_required/,
    );
    assert.throws(
      () => requireHostedAcceptanceCredential(acceptanceCase, { MATRX_SCRAPE_AUTH_MODE: 'admin' }),
      /hosted_admin_secret_required/,
    );
    assert.throws(
      () =>
        requireHostedAcceptanceCredential(acceptanceCase, {
          MATRX_SCRAPE_AUTH_MODE: 'member',
          MATRX_HOSTED_MEMBER_LINK_JSON: JSON.stringify({
            email: 'admin@admin.com',
            action_link:
              'https://www.aimatrx.com/auth/confirm?type=magiclink&token_hash=wrong-role',
          }),
        }),
      /d87_member_fingerprint_mismatch/,
    );
    const adminEnv = {
      MATRX_SCRAPE_AUTH_MODE: 'admin',
      MATRX_HOSTED_ADMIN_CREDENTIALS_JSON: JSON.stringify({
        email: 'admin@admin.com',
        password: 'private',
      }),
    };
    assert.throws(
      () => requireHostedAcceptanceCredential(acceptanceCase, adminEnv),
      /hosted_profile_org_secret_required/,
    );
    requireHostedAcceptanceCredential(acceptanceCase, {
      ...adminEnv,
      MATRX_HOSTED_PROFILE_ORGANIZATION_JSON: JSON.stringify({
        approved_organization_name: 'Matrx Org',
      }),
    });
    assert.throws(
      () =>
        requireHostedAcceptanceCredential(acceptanceCase, {
          MATRX_SCRAPE_AUTH_MODE: 'admin',
          MATRX_HOSTED_ADMIN_CREDENTIALS_JSON: JSON.stringify({
            email: 'wrong@invalid.test',
            password: 'private',
          }),
        }),
      /d87_admin_identity_required/,
    );
  }
});

test('workflow admits development Scrape only with one complete development selection', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/hosted-guest-acceptance.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /- guest-scrape-development/);
  assert.match(workflow, /- scrape-error-recovery-guest/);
  assert.match(workflow, /- scrape-save-member/);
  assert.match(workflow, /D187 Save Source requires member auth/);
  assert.match(
    workflow,
    /\[\[ "\$ACCEPTANCE_CASE" != guest-scrape && "\$ACCEPTANCE_CASE" != guest-scrape-development && "\$ACCEPTANCE_CASE" != scrape-save-member \]\]/,
  );
  assert.match(
    workflow,
    /"\$ACCEPTANCE_CASE" == guest-scrape-development[^\n]*\n\s*\[\[ -z "\$RELEASE_RUN_ID" && -n "\$DEVELOPMENT_RUN_ID" && -n "\$DEVELOPMENT_ARTIFACT_ID" && "\$PUBLISHED_STORE_CRX" != true \]\]/,
  );
  assert.match(
    workflow,
    /"\$ACCEPTANCE_CASE" == scrape-error-recovery-guest[^\n]*\n\s*\[\[ -z "\$RELEASE_RUN_ID" && -n "\$DEVELOPMENT_RUN_ID" && -n "\$DEVELOPMENT_ARTIFACT_ID"/,
  );
  assert.match(workflow, /SCRAPE_AUTH_MODE" == guest && "\$ACCEPTANCE_LANE" == B/);
});

test('workflow admits member Data with member auth while preserving guest and D187 routing', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/hosted-guest-acceptance.yml', import.meta.url),
    'utf8',
  );
  const laneAdmission = workflowStepScript(
    workflow,
    'Require bounded lane and isolate shared credentials',
  );
  const artifactProvenance = workflowStepScript(
    workflow,
    'Require exactly one artifact provenance mode',
  );
  const isArm64 = process.arch === 'arm64';
  const shared = {
    ACCEPTANCE_LANE: 'A',
    SEO_CASE_SCOPE: 'full',
    SEO_METADATA_FIXTURE: 'none',
    SEO_INTERRUPT_AFTER_TARGET: 'none',
    DESKTOP_SETTINGS_CASE: 'full',
    RELEASE_RUN_ID: '',
    DEVELOPMENT_RUN_ID: '38024593121',
    DEVELOPMENT_ARTIFACT_ID: '11659157834',
    PUBLISHED_STORE_CRX: 'false',
    SCRAPE_DIAGNOSTIC_CPU_RATE: '',
    SCRAPE_WIDTH_MODE: 'narrow',
    SCRAPE_NORMAL_WIDTH_PX: '',
    SCRAPE_SAVE_DESTINATION: 'project',
    RUNNER_LABEL: isArm64 ? 'macos-15' : 'macos-15-intel',
    RUNNER_ARCH: isArm64 ? 'ARM64' : 'X64',
  };

  for (const [acceptanceCase, authMode, acceptanceLane, laneStatus, provenanceStatus] of [
    ['member-data', 'member', 'A', 0, 0],
    ['member-data', 'guest', 'A', 1, 1],
    ['guest-chat', 'guest', 'A', 0, 0],
    ['guest-chat', 'member', 'A', 0, 1],
    ['scrape-save-member', 'member', 'A', 0, 0],
    ['scrape-save-member', 'guest', 'A', 1, 0],
    ['scrape-error-recovery-guest', 'guest', 'B', 0, 0],
    ['scrape-error-recovery-guest', 'guest', 'A', 1, 0],
    ['scrape-error-recovery-guest', 'member', 'B', 1, 1],
  ]) {
    const env = {
      ...shared,
      ACCEPTANCE_LANE: acceptanceLane,
      ACCEPTANCE_CASE: acceptanceCase,
      SCRAPE_AUTH_MODE: authMode,
    };
    for (const [scriptName, script, expectedStatus] of [
      ['lane admission', laneAdmission, laneStatus],
      ['artifact preflight', artifactProvenance, provenanceStatus],
    ]) {
      const result = runWorkflowStep(script, env);
      assert.equal(
        result.status,
        expectedStatus,
        `${scriptName}: ${acceptanceCase} with ${authMode} auth: ${result.stderr || result.stdout}`,
      );
    }
  }
  assert.equal(
    runWorkflowStep(laneAdmission, {
      ...shared,
      ACCEPTANCE_CASE: 'scrape-save-member',
      SCRAPE_AUTH_MODE: 'member',
      SCRAPE_SAVE_DESTINATION: 'none',
    }).status,
    0,
  );
  assert.notEqual(
    runWorkflowStep(laneAdmission, {
      ...shared,
      ACCEPTANCE_CASE: 'scrape-save-member',
      SCRAPE_AUTH_MODE: 'member',
      SCRAPE_SAVE_DESTINATION: 'library',
    }).status,
    0,
  );
  assert.notEqual(
    runWorkflowStep(laneAdmission, {
      ...shared,
      ACCEPTANCE_CASE: 'guest-chat',
      SCRAPE_SAVE_DESTINATION: 'none',
    }).status,
    0,
  );
});
