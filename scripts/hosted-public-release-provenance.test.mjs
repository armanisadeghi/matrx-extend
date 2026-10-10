import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Execute the real dispatch gate: allowing both provenance modes or selecting a CRX must fail.
test('guest Data and SEO admit exact release or complete CI provenance and refuse mixed modes', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/hosted-guest-acceptance.yml', import.meta.url),
    'utf8',
  );
  const step = workflow
    .split('      - name: Require exactly one artifact provenance mode\n')[1]
    .split('\n      - name:')[0];
  const script = step
    .split('        run: |\n')[1]
    .split('\n')
    .map((line) => (line.startsWith('          ') ? line.slice(10) : line))
    .join('\n');
  for (const acceptanceCase of ['guest-data', 'guest-seo']) {
    for (const [release, devRun, devArtifact, crx, accepted] of [
      ['38065000000', '', '', 'false', true],
      ['', '38064000000', '11675000000', 'false', true],
      ['', '', '', 'false', false],
      ['38065000000', '38064000000', '11675000000', 'false', false],
      ['', '38064000000', '', 'false', false],
      ['', '', '', 'true', false],
    ]) {
      const result = spawnSync('bash', ['-euo', 'pipefail', '-c', script], {
        encoding: 'utf8',
        env: {
          ...process.env,
          RUNNER_LABEL: process.arch === 'arm64' ? 'macos-15' : 'macos-15-intel',
          RUNNER_ARCH: process.arch === 'arm64' ? 'ARM64' : 'X64',
          ACCEPTANCE_CASE: acceptanceCase,
          RELEASE_RUN_ID: release,
          DEVELOPMENT_RUN_ID: devRun,
          DEVELOPMENT_ARTIFACT_ID: devArtifact,
          PUBLISHED_STORE_CRX: crx,
          SCRAPE_DIAGNOSTIC_CPU_RATE: '',
          SCRAPE_AUTH_MODE: 'guest',
          SCRAPE_WIDTH_MODE: 'narrow',
          SCRAPE_NORMAL_WIDTH_PX: '',
        },
      });
      assert.equal(
        result.status === 0,
        accepted,
        `${acceptanceCase} release=${release} dev=${devRun}/${devArtifact} crx=${crx}: ${result.stderr}`,
      );
    }
  }
});
