import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('hosted theme rendering probe is admitted as a guest case without shared credentials', () => {
  const result = spawnSync(process.execPath, ['scripts/hosted-guest-acceptance.mjs'], {
    env: {
      GITHUB_ACTIONS: 'true',
      MATRX_HOSTED_PHASE: 'preflight',
      MATRX_HOSTED_ACCEPTANCE_CASE: 'settings-theme-rendering',
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /HOSTED_CREDENTIAL_PREFLIGHT_READY/);
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /member_link_secret_required|admin_secret_required/,
  );
});

test('hosted theme probe preserves lane, development-artifact, and Settings-driver gates', () => {
  const workflow = readFileSync('.github/workflows/hosted-guest-acceptance.yml', 'utf8');
  const hosted = readFileSync('scripts/hosted-guest-acceptance.mjs', 'utf8');
  const driver = readFileSync('tests/browser/settings-local-controls-acceptance.mjs', 'utf8');

  assert.match(workflow, /- settings-theme-rendering/);
  assert.match(workflow, /settings-controls\|settings-theme-rendering\|settings-persistence/);
  assert.match(hosted, /'settings-theme-rendering'/);
  assert.match(
    hosted,
    /acceptanceCase === 'settings-controls' \|\| acceptanceCase === 'settings-theme-rendering'[\s\S]*?ci_development_test/,
  );
  assert.match(
    hosted,
    /acceptanceCase === 'settings-controls' \|\| acceptanceCase === 'settings-theme-rendering'[\s\S]*?settings-local-controls-acceptance\.mjs/,
  );
  assert.match(driver, /MATRX_HOSTED_ACCEPTANCE_CASE === 'settings-theme-rendering'/);
  assert.match(driver, /runGuestThemeRenderingProbe\(panel, theme/);
  assert.match(driver, /if \(!THEME_RENDERING_PROBE\) enforceFullExtensionRechecks/);
});
