import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { hostedAcceptanceRoute } from './hosted-acceptance-route.mjs';

test('the native hosted route admits every account popover role before browser launch', () => {
  for (const role of ['guest', 'member', 'admin']) {
    const selected = `settings-account-popover-${role}`;
    const route = hostedAcceptanceRoute(
      selected,
      'development',
      { kind: 'ci_development_test', eligibleStore: false },
      'guest',
      { lane: 'A' },
    );
    assert.equal(route.acceptanceCase, selected);
    assert.equal(route.scrapeRoute, null);
  }
  assert.throws(
    () =>
      hostedAcceptanceRoute(
        'settings-account-popover-unknown',
        'development',
        { kind: 'ci_development_test' },
        'guest',
      ),
    /unknown_hosted_acceptance_case/,
  );
});

test('Settings provenance is rejected before release downloads and browser resource admission', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/hosted-guest-acceptance.yml', import.meta.url),
    'utf8',
  );
  const gateName = 'Require a matching CI development artifact for Settings acceptance';
  const gate = workflow.split(`      - name: ${gateName}\n`)[1]?.split('\n      - name:')[0];
  assert.ok(gate, 'workflow must contain the early Settings provenance gate');
  const script = gate
    .split('        run: |\n')[1]
    .split('\n')
    .map((line) => (line.startsWith('          ') ? line.slice(10) : line))
    .join('\n');
  assert.ok(script, 'Settings provenance gate must run executable shell');

  const releaseStep = workflow.indexOf(
    '      - name: Require a successful published release artifact',
  );
  const gateStep = workflow.indexOf(`      - name: ${gateName}`);
  const browserAdmission = workflow.indexOf('      - name: Wait for measured package readiness');
  assert.ok(gateStep < releaseStep && releaseStep < browserAdmission);

  for (const acceptanceCase of [
    'settings-controls',
    'settings-theme-rendering',
    'settings-auto-scrape-capture',
    'settings-account-popover-guest',
    'settings-account-popover-member',
    'settings-account-popover-admin',
  ]) {
    for (const [release, devRun, devArtifact, crx, accepted] of [
      ['38079287426', '', '', 'false', false],
      ['', '38080000000', '11680000000', 'false', true],
      ['', '', '', 'false', false],
      ['', '38080000000', '', 'false', false],
      ['', '38080000000', '11680000000', 'true', false],
    ]) {
      const result = spawnSync('bash', ['-euo', 'pipefail', '-c', script], {
        encoding: 'utf8',
        env: {
          ...process.env,
          ACCEPTANCE_CASE: acceptanceCase,
          RELEASE_RUN_ID: release,
          DEVELOPMENT_RUN_ID: devRun,
          DEVELOPMENT_ARTIFACT_ID: devArtifact,
          PUBLISHED_STORE_CRX: crx,
        },
      });
      assert.equal(
        result.status === 0,
        accepted,
        `${acceptanceCase} release=${release} dev=${devRun}/${devArtifact} crx=${crx}: ${result.stderr}`,
      );
      if (!accepted) {
        assert.match(
          result.stderr,
          /Settings acceptance requires a matching CI development run and artifact/,
        );
      }
    }
  }
});
