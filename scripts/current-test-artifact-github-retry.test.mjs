import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ghJson } from './current-test-artifact.mjs';

async function withFakeGh(outcomes, check) {
  const dir = await mkdtemp(join(tmpdir(), 'matrx-artifact-gh-test-'));
  const originalPath = process.env.PATH;
  const originalState = process.env.MATRX_ARTIFACT_GH_TEST_STATE;
  const originalOutcomes = process.env.MATRX_ARTIFACT_GH_TEST_OUTCOMES;
  const originalDelay = process.env.MATRX_ARTIFACT_GH_RETRY_DELAY_MS;
  const state = join(dir, 'calls');
  const executable = join(dir, 'gh');
  await writeFile(
    executable,
    `#!/usr/bin/env node
const fs = require('node:fs');
const state = process.env.MATRX_ARTIFACT_GH_TEST_STATE;
const calls = Number(fs.existsSync(state) ? fs.readFileSync(state, 'utf8') : '0') + 1;
fs.writeFileSync(state, String(calls));
const outcomes = JSON.parse(process.env.MATRX_ARTIFACT_GH_TEST_OUTCOMES);
const outcome = outcomes[Math.min(calls - 1, outcomes.length - 1)];
if (process.argv[2] !== 'api' || process.argv[3] !== '/repos/armanisadeghi/matrx-extend/actions/runs/38339589962') process.exit(19);
if (outcome === 'transient') { process.stderr.write('error connecting to api.github.com\\n'); process.exit(1); }
if (outcome === 'auth') { process.stderr.write('HTTP 401: Bad credentials\\n'); process.exit(1); }
if (outcome === 'malformed') { process.stdout.write('{'); process.exit(0); }
process.stdout.write(JSON.stringify({ id: outcome }));
`,
    { mode: 0o700 },
  );
  process.env.PATH = `${dir}:${originalPath}`;
  process.env.MATRX_ARTIFACT_GH_TEST_STATE = state;
  process.env.MATRX_ARTIFACT_GH_TEST_OUTCOMES = JSON.stringify(outcomes);
  process.env.MATRX_ARTIFACT_GH_RETRY_DELAY_MS = '0';
  try {
    await check(async () =>
      Number(
        await readFile(state, 'utf8').catch((error) => {
          if (error.code === 'ENOENT') return '0';
          throw error;
        }),
      ),
    );
  } finally {
    process.env.PATH = originalPath;
    if (originalState === undefined)
      Reflect.deleteProperty(process.env, 'MATRX_ARTIFACT_GH_TEST_STATE');
    else process.env.MATRX_ARTIFACT_GH_TEST_STATE = originalState;
    if (originalOutcomes === undefined)
      Reflect.deleteProperty(process.env, 'MATRX_ARTIFACT_GH_TEST_OUTCOMES');
    else process.env.MATRX_ARTIFACT_GH_TEST_OUTCOMES = originalOutcomes;
    if (originalDelay === undefined)
      Reflect.deleteProperty(process.env, 'MATRX_ARTIFACT_GH_RETRY_DELAY_MS');
    else process.env.MATRX_ARTIFACT_GH_RETRY_DELAY_MS = originalDelay;
    await rm(dir, { recursive: true, force: true });
  }
}

const endpoint = '/repos/armanisadeghi/matrx-extend/actions/runs/38339589962';

test('artifact import recovers from one GitHub connection failure and uses the later response', async () => {
  await withFakeGh(['transient', 38339589962], async (calls) => {
    assert.deepEqual(await ghJson(endpoint), { id: 38339589962 });
    assert.equal(await calls(), 2);
  });
});

test('artifact import refuses a persistent GitHub connection failure after bounded attempts', async () => {
  await withFakeGh(['transient'], async (calls) => {
    await assert.rejects(ghJson(endpoint), /test_artifact_github_api_unavailable/);
    assert.equal(await calls(), 3);
  });
});

test('artifact import does not retry an authentication refusal', async () => {
  await withFakeGh(['auth'], async (calls) => {
    await assert.rejects(ghJson(endpoint), /test_artifact_github_api_failed/);
    assert.equal(await calls(), 1);
  });
});

test('artifact import refuses malformed GitHub metadata without retrying', async () => {
  await withFakeGh(['malformed', 38339589962], async (calls) => {
    await assert.rejects(ghJson(endpoint), /test_artifact_github_response_invalid/);
    assert.equal(await calls(), 1);
  });
});
