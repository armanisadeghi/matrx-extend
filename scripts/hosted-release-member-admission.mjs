#!/usr/bin/env node
/** Exact published Store payload; browser setup remains owned by the guarded hosted workflow. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  requireSynchronizedDispatchSource,
  verifyHostedWorkflowCheckout,
} from './hosted-remote-admission.mjs';
const OWNER = 'armanisadeghi/matrx-extend';
const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const decimal = /^[1-9][0-9]*$/;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Match the two existing hosted workflow architectures; resources are still guarded there. */
export function releaseMemberRunnerLabel(value = 'macos-15-intel') {
  assert.ok(['macos-15', 'macos-15-intel'].includes(value), 'release_member_runner_label_invalid');
  return value;
}

export function releaseMemberPlan(
  { releaseRunId, artifactId, sourceSha, runnerLabel },
  run,
  listing,
  receipt,
  tagSha,
) {
  runnerLabel = releaseMemberRunnerLabel(runnerLabel);
  assert.ok(
    decimal.test(releaseRunId ?? '') && decimal.test(artifactId ?? '') && SHA.test(sourceSha ?? ''),
    'release_member_identity_invalid',
  );
  assert.ok(
    String(run.id) === releaseRunId &&
      /^Hosted release(?: \(by [A-Za-z0-9_-]+\))?$/.test(run.name ?? '') &&
      run.path === '.github/workflows/release.yml' &&
      run.event === 'workflow_dispatch' &&
      run.head_branch === 'main' &&
      run.conclusion === 'success',
    'release_member_run_invalid',
  );
  const artifacts = listing.artifacts?.filter(
    (a) => !a.expired && /^matrx-extend-v\d+\.\d+\.\d+$/.test(a.name),
  );
  assert.ok(
    listing.total_count === listing.artifacts?.length && artifacts?.length === 1,
    'release_member_artifacts_incomplete',
  );
  const artifact = artifacts[0];
  assert.ok(
    String(artifact.id) === artifactId &&
      String(artifact.workflow_run?.id) === releaseRunId &&
      /^sha256:[a-f0-9]{64}$/.test(artifact.digest ?? ''),
    'release_member_artifact_invalid',
  );
  assert.ok(
    receipt.sourceSha === sourceSha &&
      tagSha === sourceSha &&
      receipt.publishState === 'pushed' &&
      artifact.name === `matrx-extend-v${receipt.version}` &&
      HASH.test(receipt.storeZip?.sha256 ?? ''),
    'release_member_receipt_invalid',
  );
  return {
    artifact,
    args: [
      'workflow',
      'run',
      'hosted-guest-acceptance.yml',
      '--ref',
      'main',
      ...[
        'acceptance_lane=A',
        'acceptance_case=member-chat',
        `release_run_id=${releaseRunId}`,
        `runner_label=${runnerLabel}`,
        'requested_by=release-member-admission',
      ].flatMap((value) => ['-f', value]),
      '-R',
      OWNER,
    ],
  };
}

export function admitReleaseMember({ localSha, remoteSha, dirty, runs, secretNames }) {
  requireSynchronizedDispatchSource(localSha, remoteSha, dirty);
  assert.ok(
    Array.isArray(runs) &&
      runs.every((run) => run.status === 'completed' || /^Native B · /.test(run.name ?? '')),
    'release_member_lane_a_busy',
  );
  assert.ok(
    Array.isArray(secretNames) && secretNames.includes('MATRX_REVIEWER_MAGIC_LINK_JSON'),
    'hosted_member_link_secret_required',
  );
}

export function verifyReleaseMemberBytes(archiveBytes, artifact, receipt, storeBytes) {
  assert.equal(
    `sha256:${digest(archiveBytes)}`,
    artifact.digest,
    'release_member_archive_digest_mismatch',
  );
  assert.equal(digest(storeBytes), receipt.storeZip.sha256, 'release_member_store_digest_mismatch');
}

function reviewedStabilizationPath(path) {
  if (
    [
      'docs/stabilization/CHECKLIST.md',
      'docs/stabilization/STATUS.md',
      'docs/stabilization/STATUS.html',
      'docs/stabilization/inventory.json',
      'docs/stabilization/defects/EXT-D-0228.json',
    ].includes(path)
  )
    return true;
  if (
    /^docs\/stabilization\/evidence\/guest-values-b-[1-9][0-9]{10}\/(?:result\.sanitized\.json|values-open\.png)$/.test(
      path,
    )
  )
    return true;
  const memberEvidence =
    /^docs\/stabilization\/evidence\/member-run([1-9][0-9]{10})-[0-9]{8}\/(.+)$/.exec(path);
  return (
    memberEvidence !== null &&
    (memberEvidence[2] === 'native-summary.json' ||
      new RegExp(
        `^hosted-(?:browser|guest|package)-${memberEvidence[1]}-[1-9][0-9]*\\.sanitized\\.jsonl$`,
      ).test(memberEvidence[2]))
  );
}

export function requireReleaseMemberSource(ancestor, paths) {
  assert.equal(ancestor, true, 'release_member_source_not_ancestor');
  assert.ok(
    paths.every(
      (path) =>
        reviewedStabilizationPath(path) ||
        /^docs\/stabilization\/reports\/[a-z0-9]+(?:-[a-z0-9]+)*\.json(?![\s\S])/.test(path) ||
        path ===
          'docs/stabilization/evidence/member-release-admission-20261017/release-api-metadata.json' ||
        path ===
          'docs/stabilization/evidence/settings-navigation-lane-a-preflight-20261017/resource-journals/settings-nav-preflight-20261017-01.sanitized.jsonl' ||
        /^scripts\/hosted-release-member-admission(?:\.test)?\.mjs$/.test(path) ||
        path === 'tests/browser/guest-chat-store-acceptance.mjs' ||
        path === 'tests/browser/guest-chat-store-sequence.test.mjs' ||
        path === 'tests/browser/guest-chat-store-screenshot.mjs' ||
        path === 'tests/browser/guest-chat-completion-oracle.mjs' ||
        path === 'tests/browser/guest-chat-completion-oracle.test.mjs' ||
        path === 'tests/browser/guest-chat-transport-observer.mjs' ||
        path === 'tests/browser/guest-chat-transport-observer.test.mjs' ||
        path === 'tests/browser/prepare-reviewer-magic-link.mjs' ||
        path === 'tests/browser/prepare-reviewer-magic-link.test.mjs' ||
        path === 'tests/browser/member-native-auth-proof.mjs' ||
        path === 'tests/browser/member-native-auth-proof.test.mjs' ||
        path === 'tests/browser/member-chat-completion-oracle.mjs' ||
        path === 'tests/browser/member-chat-completion-oracle.test.mjs' ||
        path === 'tests/browser/reviewer-chat-store-acceptance.mjs' ||
        path === 'tests/browser/reviewer-chat-identity-diagnostic.mjs' ||
        path === 'tests/browser/reviewer-chat-identity-diagnostic.test.mjs' ||
        path === 'tests/browser/reviewer-chat-organization-boundary.test.mjs' ||
        path === 'tests/browser/settings-panel-driver.mjs' ||
        path === 'tests/browser/package-chat-controls.mjs' ||
        path === 'tests/browser/package-chat-controls.test.mjs',
    ),
    'release_member_product_changed',
  );
}

const gh = (endpoint) => JSON.parse(execFileSync('gh', ['api', endpoint], { encoding: 'utf8' }));
const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
function admission() {
  const localSha = git(['rev-parse', 'HEAD']);
  const remoteSha = gh(`repos/${OWNER}/git/ref/heads/main`).object?.sha;
  const dirty = git([
    'status',
    '--porcelain',
    '--',
    '.github/workflows/hosted-guest-acceptance.yml',
    'scripts/hosted-release-member-admission.mjs',
    'scripts/hosted-release-member-admission.test.mjs',
    'scripts/hosted-remote-admission.mjs',
  ]);
  verifyHostedWorkflowCheckout({
    path: '.github/workflows/hosted-guest-acceptance.yml',
    head_sha: remoteSha,
  });
  const runs = ['hosted-guest-acceptance.yml', 'hosted-resource-diagnostic.yml'].flatMap(
    (workflow) =>
      ['queued', 'in_progress', 'waiting', 'pending', 'requested'].flatMap((status) => {
        const listing = gh(
          `repos/${OWNER}/actions/workflows/${workflow}/runs?status=${status}&per_page=100`,
        );
        assert.ok(
          Array.isArray(listing.workflow_runs) &&
            listing.total_count === listing.workflow_runs.length,
          'release_member_run_census_incomplete',
        );
        return listing.workflow_runs;
      }),
  );
  const secrets = gh(`repos/${OWNER}/actions/secrets?per_page=100`);
  assert.equal(
    secrets.total_count,
    secrets.secrets?.length,
    'release_member_secret_census_incomplete',
  );
  admitReleaseMember({
    localSha,
    remoteSha,
    dirty,
    runs,
    secretNames: secrets.secrets.map((s) => s.name),
  });
  return remoteSha;
}

export function proveSource(sourceSha, workflowSha) {
  execFileSync('git', ['merge-base', '--is-ancestor', sourceSha, workflowSha]);
  // SHA attests the reviewed two-file operational change, not a script namespace.
  // Census every other commit (including reverted changes) and all pending bytes.
  const reviewedGuestRoute = '1ec98baf21d2a6b8631971dd43c13fc199a6b2a4';
  const reviewedGuestPaths = [
    'scripts/hosted-remote-admission.mjs',
    'scripts/hosted-remote-guest-chat-admission.test.mjs',
  ];
  const commits = git(['rev-list', `${sourceSha}..${workflowSha}`])
    .split('\n')
    .filter(Boolean);
  const changedPaths = commits.flatMap((commit) => {
    const paths = execFileSync(
      'git',
      [
        'diff-tree',
        '--root',
        '-m',
        '-r',
        '--no-commit-id',
        '--no-renames',
        '--name-only',
        '-z',
        commit,
      ],
      { encoding: 'utf8' },
    )
      .split('\0')
      .filter(Boolean);
    return paths.filter(
      (path) => commit !== reviewedGuestRoute || !reviewedGuestPaths.includes(path),
    );
  });
  const pendingPaths = [
    ...execFileSync('git', ['diff', '--name-only', '-z', 'HEAD'], { encoding: 'utf8' }).split('\0'),
    ...execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
      encoding: 'utf8',
    }).split('\0'),
  ].filter(Boolean);
  requireReleaseMemberSource(true, [...changedPaths, ...pendingPaths]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let scratch;
  try {
    const [mode, releaseRunId, artifactId, sourceSha, requestedRunner] = process.argv.slice(2);
    const runnerLabel = releaseMemberRunnerLabel(requestedRunner);
    assert.ok(
      ['plan', 'dispatch'].includes(mode) && [6, 7].includes(process.argv.length),
      'release_member_arguments_invalid',
    );
    assert.ok(
      decimal.test(releaseRunId ?? '') &&
        decimal.test(artifactId ?? '') &&
        SHA.test(sourceSha ?? ''),
      'release_member_identity_invalid',
    );
    const workflowSha = admission();
    proveSource(sourceSha, workflowSha);
    const run = gh(`repos/${OWNER}/actions/runs/${releaseRunId}`);
    const listing = gh(`repos/${OWNER}/actions/runs/${releaseRunId}/artifacts?per_page=100`);
    scratch = mkdtempSync(join(tmpdir(), 'release-member-admission-'));
    const archive = execFileSync(
      'gh',
      ['api', `repos/${OWNER}/actions/artifacts/${artifactId}/zip`],
      { maxBuffer: 256 * 1024 * 1024 },
    );
    const archivePath = join(scratch, 'artifact.zip');
    writeFileSync(archivePath, archive, { mode: 0o600 });
    const entries = execFileSync('unzip', ['-Z1', archivePath], { encoding: 'utf8' })
      .trim()
      .split('\n');
    const matching = (name) => {
      const matches = entries.filter((entry) => entry === name || entry.endsWith(`/${name}`));
      assert.equal(matches.length, 1, 'release_member_archive_entry_ambiguous');
      return matches[0];
    };
    const receipt = JSON.parse(
      execFileSync('unzip', ['-p', archivePath, matching('release-receipt.json')], {
        encoding: 'utf8',
      }),
    );
    assert.match(receipt.version ?? '', /^\d+\.\d+\.\d+$/, 'release_member_version_invalid');
    const tagRef = `refs/tags/v${receipt.version}`;
    const remoteTags = git(['ls-remote', 'origin', tagRef, `${tagRef}^{}`])
      .split('\n')
      .map((line) => line.split('\t'));
    const tag =
      remoteTags.find(([, ref]) => ref === `${tagRef}^{}`)?.[0] ??
      remoteTags.find(([, ref]) => ref === tagRef)?.[0];
    const plan = releaseMemberPlan(
      { releaseRunId, artifactId, sourceSha, runnerLabel },
      run,
      listing,
      receipt,
      tag,
    );
    const store = execFileSync(
      'unzip',
      ['-p', archivePath, matching(`matrx-extend-${receipt.version}-store.zip`)],
      { maxBuffer: 256 * 1024 * 1024 },
    );
    verifyReleaseMemberBytes(archive, plan.artifact, receipt, store);
    assert.equal(admission(), workflowSha, 'release_member_workflow_changed');
    proveSource(sourceSha, workflowSha);
    if (mode === 'dispatch') execFileSync('gh', plan.args, { stdio: 'inherit' });
    console.log(
      JSON.stringify({
        mode,
        releaseRunId,
        artifactId,
        sourceSha,
        workflowSha,
        runnerLabel,
        version: receipt.version,
        storeZipSha256: receipt.storeZip.sha256,
        githubArtifactDigest: plan.artifact.digest,
        args: plan.args,
      }),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
}
