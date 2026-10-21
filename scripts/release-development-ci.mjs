#!/usr/bin/env node
/** Dispatch full CI for a release commit whose GITHUB_TOKEN push cannot start CI. */
import { readFile } from 'node:fs/promises';
import { verifyGitHubMetadata } from './current-test-artifact.mjs';
import { isEligibleDevelopmentCiEvent } from './development-ci-event.mjs';

const OWNER = 'armanisadeghi/matrx-extend';
const SHA = /^[a-f0-9]{40}$/;
const DECIMAL = /^[1-9]\d*$/;

export function releaseCiApiTimeoutMs(value = process.env.MATRX_RELEASE_CI_API_TIMEOUT_MS) {
  const timeout = Number(value ?? '10000');
  if (!Number.isSafeInteger(timeout) || timeout <= 0)
    throw new Error('release_ci_api_timeout_invalid');
  return timeout;
}

export function decideReleaseCiDispatch({ sourceSha, currentMainSha, runs }) {
  if (!SHA.test(sourceSha ?? '') || !SHA.test(currentMainSha ?? ''))
    throw new Error('release_ci_invalid_sha');
  if (currentMainSha !== sourceSha) return 'superseded';
  if (!Array.isArray(runs)) throw new Error('release_ci_runs_unavailable');
  const eligible = runs.filter(
    (run) =>
      run.path === '.github/workflows/ci.yml' &&
      run.head_sha === sourceSha &&
      run.head_branch === 'main' &&
      isEligibleDevelopmentCiEvent(run),
  );
  if (
    eligible.some(
      (run) =>
        run.status === 'completed' && run.conclusion === 'success' && run.hasDevelopmentArtifact,
    )
  )
    return 'artifact-exists';
  if (eligible.some((run) => run.status !== 'completed')) return 'already-running';
  return 'dispatch';
}

async function request(path, options = {}) {
  const token = process.env.GITHUB_TOKEN;
  if (!token || process.env.GITHUB_REPOSITORY !== OWNER)
    throw new Error('release_ci_github_context_refused');
  const response = await fetch(
    `${process.env.GITHUB_API_URL ?? 'https://api.github.com'}/repos/${OWNER}${path}`,
    {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      signal: AbortSignal.timeout(releaseCiApiTimeoutMs()),
    },
  );
  if (!response.ok) throw new Error(`release_ci_github_http_${response.status}`);
  return response.status === 204 ? null : response.json();
}

async function dispatch(receiptPath) {
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  const sourceSha = receipt.sourceSha;
  if (receipt.publishState !== 'pushed' || !SHA.test(sourceSha ?? ''))
    throw new Error('release_ci_receipt_refused');
  const branch = await request('/branches/main');
  const listing = await request(
    `/actions/workflows/ci.yml/runs?head_sha=${sourceSha}&per_page=100`,
  );
  const successful = (listing?.workflow_runs ?? []).filter(
    (run) => run.status === 'completed' && run.conclusion === 'success',
  );
  const workflow = successful.length ? await request('/actions/workflows/ci.yml') : null;
  const runs = await Promise.all(
    (listing?.workflow_runs ?? []).map(async (run) => {
      if (run.status !== 'completed' || run.conclusion !== 'success') return run;
      const artifacts = await request(`/actions/runs/${run.id}/artifacts?per_page=100`);
      return {
        ...run,
        hasDevelopmentArtifact: artifacts?.artifacts?.some((artifact) => {
          if (artifact.size_in_bytes <= 0) return false;
          try {
            verifyGitHubMetadata(run, workflow, artifact, String(run.id), String(artifact.id));
            return true;
          } catch {
            return false;
          }
        }),
      };
    }),
  );
  const decision = decideReleaseCiDispatch({
    sourceSha,
    currentMainSha: branch?.commit?.sha,
    runs,
  });
  if (decision === 'dispatch') {
    if (!DECIMAL.test(process.env.GITHUB_RUN_ID ?? ''))
      throw new Error('release_ci_run_id_refused');
    await request('/actions/workflows/ci.yml/dispatches', {
      method: 'POST',
      body: JSON.stringify({
        ref: 'main',
        inputs: {
          expected_source_sha: sourceSha,
          requested_by: `hosted-release-${process.env.GITHUB_RUN_ID}`,
        },
      }),
    });
  }
  process.stdout.write(`RELEASE_DEVELOPMENT_CI ${decision} ${sourceSha}\n`);
}

export function assertDispatchedSource({ eventName, ref, headSha, expectedSourceSha }) {
  if (eventName !== 'workflow_dispatch') return;
  if (
    ref !== 'refs/heads/main' ||
    !SHA.test(expectedSourceSha ?? '') ||
    headSha !== expectedSourceSha
  )
    throw new Error('release_ci_dispatched_source_refused');
}

if (process.argv[1]?.endsWith('/release-development-ci.mjs')) {
  try {
    if (process.argv[2] === 'dispatch' && process.argv.length === 4)
      await dispatch(process.argv[3]);
    else if (process.argv[2] === 'assert-source' && process.argv.length === 3)
      assertDispatchedSource({
        eventName: process.env.GITHUB_EVENT_NAME,
        ref: process.env.GITHUB_REF,
        headSha: process.env.GITHUB_SHA,
        expectedSourceSha: process.env.EXPECTED_SOURCE_SHA,
      });
    else throw new Error('release_ci_arguments_refused');
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
