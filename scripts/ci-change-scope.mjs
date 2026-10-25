#!/usr/bin/env node
/** Fail closed when the event's exact comparison range cannot be proved. */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { isSuccessfulDevelopmentCiRun } from './development-ci-event.mjs';
import { isRuntimeEquivalentDocumentationPath } from './development-source-compatibility.mjs';

export function classifyChangedPaths(paths, baseAvailable = true) {
  if (!baseAvailable || !Array.isArray(paths) || paths.length === 0) return 'full';
  return paths.every(isRuntimeEquivalentDocumentationPath) ? 'docs' : 'full';
}

export function changedPaths(root, base, head) {
  if (!/^[a-f0-9]{40}$/.test(base ?? '') || !/^[a-f0-9]{40}$/.test(head ?? '')) return null;
  if (/^0+$/.test(base) || /^0+$/.test(head)) return null;
  try {
    execFileSync('git', ['cat-file', '-e', `${base}^{commit}`], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['cat-file', '-e', `${head}^{commit}`], { cwd: root, stdio: 'ignore' });
    const ancestor = execFileSync('git', ['merge-base', base, head], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    if (ancestor !== base) return null;
    const endpointPaths = execFileSync(
      'git',
      ['diff', '--no-renames', '--name-only', '-z', base, head],
      {
        cwd: root,
        encoding: 'utf8',
      },
    )
      .split('\0')
      .filter(Boolean);
    const committedPaths = execFileSync(
      'git',
      ['log', '--no-renames', '--format=', '--name-only', '-z', `${base}..${head}`],
      {
        cwd: root,
        encoding: 'utf8',
      },
    )
      .split('\0')
      .filter(Boolean);
    return [...new Set([...endpointPaths, ...committedPaths])];
  } catch {
    return null;
  }
}

export function classifyProvenChange(root, base, head, artifactSha) {
  const eventPaths = changedPaths(root, base, head);
  if (classifyChangedPaths(eventPaths, eventPaths !== null) !== 'docs') return 'full';
  const sinceArtifact = changedPaths(root, artifactSha, head);
  return classifyChangedPaths(sinceArtifact, sinceArtifact !== null);
}

async function githubJson(path) {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!token || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '')) return null;
  try {
    const response = await fetch(
      `${process.env.GITHUB_API_URL ?? 'https://api.github.com'}/repos/${repository}${path}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(10000),
      },
    );
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

export async function latestSuccessfulDevelopmentArtifactSource() {
  const listing = await githubJson('/actions/artifacts?per_page=100');
  if (!Array.isArray(listing?.artifacts)) return null;
  for (const artifact of listing.artifacts) {
    const match = /^matrx-extend-development-test-([a-f0-9]{40})-(\d+)-(\d+)$/.exec(
      artifact.name ?? '',
    );
    if (!match || artifact.expired || artifact.size_in_bytes <= 0) continue;
    const [, sha, runId, attempt] = match;
    if (String(artifact.workflow_run?.id) !== runId || artifact.workflow_run?.head_sha !== sha)
      continue;
    const run = await githubJson(`/actions/runs/${runId}`);
    if (!run) return null;
    if (
      isSuccessfulDevelopmentCiRun(run) &&
      run.head_sha === sha &&
      String(run.run_attempt) === attempt
    )
      return sha;
  }
  return null;
}

if (process.argv[1]?.endsWith('/ci-change-scope.mjs')) {
  const paths = changedPaths(process.cwd(), process.env.CI_BASE_SHA, process.env.CI_HEAD_SHA);
  const allowedEvent =
    process.env.CI_EVENT_NAME === 'pull_request' ||
    (process.env.CI_EVENT_NAME === 'push' && process.env.CI_EVENT_REF === 'refs/heads/main');
  const source =
    allowedEvent && classifyChangedPaths(paths, paths !== null) === 'docs'
      ? await latestSuccessfulDevelopmentArtifactSource()
      : null;
  const scope = source
    ? classifyProvenChange(process.cwd(), process.env.CI_BASE_SHA, process.env.CI_HEAD_SHA, source)
    : 'full';
  console.log(
    JSON.stringify({
      scope,
      paths: paths ?? [],
      baseAvailable: paths !== null,
      provenArtifactSource: source,
    }),
  );
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `scope=${scope}\n`);
}
