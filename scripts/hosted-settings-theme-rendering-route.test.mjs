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
  const admissionCases = workflow.match(/case "\$ACCEPTANCE_CASE" in([\s\S]*?)\n\s*\*\)/)?.[1];
  assert.ok(admissionCases, 'hosted acceptance allowlist must be present');
  for (const acceptanceCase of [
    'settings-controls',
    'settings-theme-rendering',
    'settings-persistence',
  ]) {
    const escapedCase = acceptanceCase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(admissionCases, new RegExp(`(?:^|\\|)${escapedCase}(?:\\||\\))`));
  }
  assert.match(hosted, /'settings-theme-rendering'/);
  assert.match(
    hosted,
    /\[\s*'settings-controls',\s*'settings-theme-rendering'[\s\S]*?\.includes\(\s*acceptanceCase,\s*\)\s*\)\s*assert\.equal\(kind,\s*'ci_development_test'/,
  );
  assert.match(
    hosted,
    /\[\s*'settings-controls',\s*'settings-theme-rendering'[\s\S]*?\.includes\(\s*acceptanceCase,\s*\)[\s\S]*?settings-local-controls-acceptance\.mjs/,
  );
  assert.match(driver, /MATRX_HOSTED_ACCEPTANCE_CASE === 'settings-theme-rendering'/);
  assert.match(driver, /runGuestThemeRenderingProbe\(panel, theme/);
  assert.match(driver, /if \(!THEME_RENDERING_PROBE\) enforceFullExtensionRechecks/);
});
