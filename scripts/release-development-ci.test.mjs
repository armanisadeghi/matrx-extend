import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { EXTEND_GITHUB_REPO } from './app-layout.mjs';
import { verifyGitHubMetadata } from './current-test-artifact.mjs';
import {
  assertDispatchedSource,
  decideReleaseCiDispatch,
  releaseCiApiTimeoutMs,
} from './release-development-ci.mjs';

const sourceSha = 'a'.repeat(40);
const laterSha = 'b'.repeat(40);
const baseRun = {
  id: 123,
  name: `CI release source ${sourceSha} (by extend-stabilization)`,
  repository: { full_name: EXTEND_GITHUB_REPO },
  head_repository: { full_name: EXTEND_GITHUB_REPO },
  workflow_id: 99,
  path: '.github/workflows/ci.yml',
  event: 'workflow_dispatch',
  actor: { login: 'github-actions[bot]' },
  head_branch: 'main',
  head_sha: sourceSha,
  status: 'completed',
  conclusion: 'success',
  run_attempt: 1,
};
const artifact = {
  id: 321,
  name: `matrx-extend-development-test-${sourceSha}-123-1`,
  digest: `sha256:${'c'.repeat(64)}`,
  expired: false,
  workflow_run: { id: 123, head_sha: sourceSha },
};

test('CI API deadline defaults to ten seconds and accepts a valid operational override', () => {
  assert.equal(releaseCiApiTimeoutMs(null), 10000);
  assert.equal(releaseCiApiTimeoutMs('3000'), 3000);
  for (const invalid of ['0', '-1', 'NaN', '1.5', '9007199254740992'])
    assert.throws(() => releaseCiApiTimeoutMs(invalid), /release_ci_api_timeout_invalid/);
});

test('release source dispatch skips covered commits, retries failed CI, and refuses a moved main', () => {
  const target = { sourceSha, currentMainSha: sourceSha };
  assert.equal(decideReleaseCiDispatch({ ...target, runs: [] }), 'dispatch');
  assert.equal(
    decideReleaseCiDispatch({ ...target, runs: [{ ...baseRun, status: 'in_progress' }] }),
    'already-running',
  );
  assert.equal(
    decideReleaseCiDispatch({ ...target, runs: [{ ...baseRun, hasDevelopmentArtifact: true }] }),
    'artifact-exists',
  );
  assert.equal(decideReleaseCiDispatch({ ...target, runs: [baseRun] }), 'dispatch');
  assert.equal(
    decideReleaseCiDispatch({ ...target, runs: [{ ...baseRun, conclusion: 'failure' }] }),
    'dispatch',
  );
  assert.equal(
    decideReleaseCiDispatch({ ...target, currentMainSha: laterSha, runs: [] }),
    'superseded',
  );
  assert.equal(
    decideReleaseCiDispatch({ ...target, runs: [{ ...baseRun, head_sha: laterSha }] }),
    'dispatch',
  );
  assert.equal(
    decideReleaseCiDispatch({
      ...target,
      runs: [{ ...baseRun, actor: { login: 'human' }, status: 'in_progress' }],
    }),
    'already-running',
  );
});

test('release-origin dispatch is admitted only for the exact main commit; push remains independent', () => {
  const context = {
    eventName: 'workflow_dispatch',
    ref: 'refs/heads/main',
    headSha: sourceSha,
    expectedSourceSha: sourceSha,
  };
  assert.doesNotThrow(() => assertDispatchedSource(context));
  for (const changed of [
    { headSha: laterSha },
    { expectedSourceSha: laterSha },
    { ref: 'refs/tags/v0.2.586' },
  ]) {
    assert.throws(() => assertDispatchedSource({ ...context, ...changed }), /source_refused/);
  }
  assert.doesNotThrow(() => assertDispatchedSource({ ...context, eventName: 'push' }));
});

test('artifact metadata accepts exact dispatch and still rejects a substituted run source', () => {
  const verified = () => verifyGitHubMetadata(baseRun, { id: 99 }, artifact, '123', '321');
  assert.equal(verified(), 'c'.repeat(64));
  assert.throws(
    () =>
      verifyGitHubMetadata({ ...baseRun, head_sha: laterSha }, { id: 99 }, artifact, '123', '321'),
    /test_artifact_github_metadata_refused/,
  );
  assert.equal(
    verifyGitHubMetadata(
      { ...baseRun, actor: { login: 'authorized-human' } },
      { id: 99 },
      artifact,
      '123',
      '321',
    ),
    'c'.repeat(64),
  );
});

test('the real release CLI asks GitHub for one exact-source CI run after a pushed receipt', async () => {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({ method: request.method, path: request.url, body });
    response.setHeader('Content-Type', 'application/json');
    if (request.url.endsWith('/branches/main'))
      response.end(JSON.stringify({ commit: { sha: sourceSha } }));
    else if (request.url.includes('/actions/workflows/ci.yml/runs?'))
      response.end(JSON.stringify({ workflow_runs: [] }));
    else if (request.url.endsWith('/actions/workflows/ci.yml/dispatches')) {
      response.statusCode = 204;
      response.end();
    } else {
      response.statusCode = 404;
      response.end('{}');
    }
  });
  const scratch = await mkdtemp(join(tmpdir(), 'release-dev-ci-test-'));
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const receipt = join(scratch, 'receipt.json');
    await writeFile(receipt, JSON.stringify({ sourceSha, publishState: 'pushed' }));
    const child = spawn(
      process.execPath,
      [new URL('./release-development-ci.mjs', import.meta.url).pathname, 'dispatch', receipt],
      {
        env: {
          ...process.env,
          GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`,
          GITHUB_TOKEN: 'fixture-token',
          GITHUB_REPOSITORY: EXTEND_GITHUB_REPO,
          GITHUB_RUN_ID: '456',
        },
      },
    );
    let output = '';
    let errors = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (errors += chunk));
    const exit = await new Promise((resolve) => child.on('close', resolve));
    assert.equal(exit, 0, errors);
    assert.match(output, new RegExp(`RELEASE_DEVELOPMENT_CI dispatch ${sourceSha}`));
    const posts = requests.filter((request) => request.method === 'POST');
    assert.equal(posts.length, 1);
    assert.equal(posts[0].path, `/repos/${EXTEND_GITHUB_REPO}/actions/workflows/ci.yml/dispatches`);
    assert.deepEqual(JSON.parse(posts[0].body), {
      ref: 'main',
      inputs: { expected_source_sha: sourceSha, requested_by: 'hosted-release-456' },
    });
  } finally {
    server.close();
    await rm(scratch, { recursive: true, force: true });
  }
});

test('release CLI dedup requires the importer-accepted artifact digest and run identity', async () => {
  let artifactMode = 'valid';
  const requests = [];
  const run = {
    ...baseRun,
    repository: { full_name: EXTEND_GITHUB_REPO },
    head_repository: { full_name: EXTEND_GITHUB_REPO },
  };
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({ method: request.method, path: request.url, body });
    response.setHeader('Content-Type', 'application/json');
    if (request.url.endsWith('/branches/main'))
      response.end(JSON.stringify({ commit: { sha: sourceSha } }));
    else if (request.url.includes('/actions/workflows/ci.yml/runs?'))
      response.end(JSON.stringify({ workflow_runs: [run] }));
    else if (request.url.endsWith('/actions/workflows/ci.yml'))
      response.end(JSON.stringify({ id: 99 }));
    else if (request.url.endsWith('/actions/runs/123/artifacts?per_page=100')) {
      const candidate = {
        ...artifact,
        size_in_bytes: 100,
        digest: artifactMode === 'missing-digest' ? null : artifact.digest,
        workflow_run: {
          id: artifactMode === 'wrong-run-id' ? 124 : 123,
          head_sha: sourceSha,
        },
      };
      response.end(JSON.stringify({ artifacts: [candidate] }));
    } else if (request.url.endsWith('/actions/workflows/ci.yml/dispatches')) {
      response.statusCode = 204;
      response.end();
    } else {
      response.statusCode = 404;
      response.end('{}');
    }
  });
  const scratch = await mkdtemp(join(tmpdir(), 'release-dev-ci-dedup-'));
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const receipt = join(scratch, 'receipt.json');
    await writeFile(receipt, JSON.stringify({ sourceSha, publishState: 'pushed' }));
    for (const [mode, expectedPostCount] of [
      ['valid', 0],
      ['missing-digest', 1],
      ['wrong-run-id', 1],
    ]) {
      artifactMode = mode;
      requests.length = 0;
      const child = spawn(
        process.execPath,
        [new URL('./release-development-ci.mjs', import.meta.url).pathname, 'dispatch', receipt],
        {
          env: {
            ...process.env,
            GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`,
            GITHUB_TOKEN: 'fixture-token',
            GITHUB_REPOSITORY: EXTEND_GITHUB_REPO,
            GITHUB_RUN_ID: '456',
          },
        },
      );
      let errors = '';
      child.stderr.on('data', (chunk) => (errors += chunk));
      const exit = await new Promise((resolve) => child.on('close', resolve));
      assert.equal(exit, 0, `${mode}: ${errors}`);
      assert.equal(
        requests.filter((request) => request.method === 'POST').length,
        expectedPostCount,
        mode,
      );
    }
  } finally {
    server.close();
    await rm(scratch, { recursive: true, force: true });
  }
});
