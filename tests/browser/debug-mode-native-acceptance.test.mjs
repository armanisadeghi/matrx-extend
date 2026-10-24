import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { hostedAcceptanceRoute } from '../../scripts/hosted-acceptance-route.mjs';
import { requireHostedAcceptanceCredential } from '../../scripts/hosted-profile-route.mjs';
import {
  ADMIN_TAB_TITLES,
  DEBUG_MODE_STORAGE_KEY,
  parseDebugModePreference,
  requireAdminTabProjection,
} from './debug-mode-native-contract.mjs';

test('Debug Mode is a registered native case and requires the verified admin identity', () => {
  const selected = hostedAcceptanceRoute(
    'debug-mode-admin',
    'release',
    { kind: 'published_release' },
    'guest',
    { lane: 'A' },
  );
  assert.equal(selected.acceptanceCase, 'debug-mode-admin');
  assert.equal(selected.scrapeRoute, null);

  assert.throws(
    () => requireHostedAcceptanceCredential('debug-mode-admin', {}),
    /hosted_admin_secret_required/,
  );
  assert.throws(
    () =>
      requireHostedAcceptanceCredential('debug-mode-admin', {
        MATRX_HOSTED_ADMIN_CREDENTIALS_JSON: '{"email":"someone-else@example.test","password":"opaque"}',
      }),
    /d87_admin_identity_required/,
  );
  assert.doesNotThrow(() =>
    requireHostedAcceptanceCredential('debug-mode-admin', {
      MATRX_HOSTED_ADMIN_CREDENTIALS_JSON:
        '{"email":"admin@admin.com","password":"opaque"}',
    }),
  );
});

test('Debug Mode accepts only one lane-A release artifact, never a dev or Store artifact', async () => {
  const workflow = await readFile(
    new URL('../../.github/workflows/hosted-guest-acceptance.yml', import.meta.url),
    'utf8',
  );
  const gateName = 'Require bounded lane and isolate shared credentials';
  const gate = workflow.split(`      - name: ${gateName}\n`)[1]?.split('\n      - name:')[0];
  assert.ok(gate, 'hosted lane admission step missing');
  const script = gate
    .split('        run: |\n')[1]
    .split('\n')
    .map((line) => (line.startsWith('          ') ? line.slice(10) : line))
    .join('\n');
  assert.match(script, /debug-mode-admin/);

  const run = ({ lane = 'A', release = '40000000000', devRun = '', devArtifact = '', store = 'false' }) =>
    spawnSync('bash', ['-euo', 'pipefail', '-c', script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ACCEPTANCE_LANE: lane,
        ACCEPTANCE_CASE: 'debug-mode-admin',
        RELEASE_RUN_ID: release,
        DEVELOPMENT_RUN_ID: devRun,
        DEVELOPMENT_ARTIFACT_ID: devArtifact,
        PUBLISHED_STORE_CRX: store,
        RELOAD_OPEN_DIAGNOSTIC: '0',
        RELOAD_SENDER_DOCUMENT_DIAGNOSTIC: '0',
        SEO_CASE_SCOPE: 'full',
        SEO_METADATA_FIXTURE: 'none',
        SEO_RESOURCE_DIAGNOSTIC: '0',
        NOTES_STARTUP_DIAGNOSTIC: '0',
        SEO_INTERRUPT_AFTER_TARGET: 'none',
        SCRAPE_AUTH_MODE: 'guest',
        SCRAPE_SAVE_DESTINATION: 'project',
        SCRAPE_SAVE_SCOPE: 'single',
        SCRAPE_SCOPE: 'full',
        DESKTOP_SETTINGS_CASE: 'full',
      },
    });

  assert.equal(run({}).status, 0);
  for (const inputs of [
    { lane: 'B' },
    { release: '', devRun: '40000000001', devArtifact: '50000000001' },
    { store: 'true' },
    { release: '', devRun: '40000000001' },
  ]) {
    const result = run(inputs);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Debug Mode requires lane A and one validated release artifact/);
  }
});

test('Debug preference parsing preserves default-off and rejects malformed persisted values', () => {
  assert.equal(DEBUG_MODE_STORAGE_KEY, 'matrx.store.debug-mode');
  assert.equal(parseDebugModePreference(undefined), false);
  assert.equal(parseDebugModePreference(null), false);
  assert.equal(parseDebugModePreference('{"state":{"on":false},"version":0}'), false);
  assert.equal(parseDebugModePreference('{"state":{"on":true},"version":0}'), true);
  assert.throws(() => parseDebugModePreference('{'), /debug_mode_storage_json_invalid/);
  assert.throws(
    () => parseDebugModePreference('{"state":{"on":"true"},"version":0}'),
    /debug_mode_storage_preference_invalid/,
  );
});

test('admin tabs require both verified admin storage and the persisted Debug preference in fixed order', () => {
  assert.deepEqual(ADMIN_TAB_TITLES, [
    'Showcase (admin only)',
    'Pilot (admin only — sandboxed tab group)',
    'Token broker (admin only)',
    'Debug (admin only)',
  ]);
  assert.equal(
    requireAdminTabProjection({
      isVerifiedAdmin: true,
      debugModeOn: true,
      visibleAdminTabTitles: [...ADMIN_TAB_TITLES],
    }),
    true,
  );
  assert.equal(
    requireAdminTabProjection({
      isVerifiedAdmin: true,
      debugModeOn: false,
      visibleAdminTabTitles: [],
    }),
    false,
  );
  assert.equal(
    requireAdminTabProjection({
      isVerifiedAdmin: false,
      debugModeOn: true,
      visibleAdminTabTitles: [],
    }),
    false,
  );
  assert.throws(
    () =>
      requireAdminTabProjection({
        isVerifiedAdmin: false,
        debugModeOn: true,
        visibleAdminTabTitles: [...ADMIN_TAB_TITLES],
      }),
    /admin_tab_projection_mismatch/,
  );
  assert.throws(
    () =>
      requireAdminTabProjection({
        isVerifiedAdmin: true,
        debugModeOn: true,
        visibleAdminTabTitles: [...ADMIN_TAB_TITLES].reverse(),
      }),
    /admin_tab_projection_mismatch/,
  );
});
