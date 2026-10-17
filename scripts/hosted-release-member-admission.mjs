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

export function releaseMemberPlan(
  { releaseRunId, artifactId, sourceSha },
  run,
  listing,
  receipt,
  tagSha,
) {
  assert.ok(
    decimal.test(releaseRunId ?? '') && decimal.test(artifactId ?? '') && SHA.test(sourceSha ?? ''),
    'release_member_identity_invalid',
  );
  assert.ok(
    String(run.id) === releaseRunId &&
      run.name === 'Hosted release' &&
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
        'runner_label=macos-15-intel',
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

export function requireReleaseMemberSource(ancestor, paths) {
  assert.equal(ancestor, true, 'release_member_source_not_ancestor');
  assert.ok(
    paths.every(
      (path) =>
        /^docs\/stabilization\//.test(path) ||
        /^scripts\/hosted-release-member-admission(?:\.test)?\.mjs$/.test(path),
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

function proveSource(sourceSha, workflowSha) {
  execFileSync('git', ['merge-base', '--is-ancestor', sourceSha, workflowSha]);
  const changedPaths = execFileSync(
    'git',
    ['log', '--no-renames', '--format=', '--name-only', '-z', `${sourceSha}..${workflowSha}`],
    { encoding: 'utf8' },
  )
    .split('\0')
    .filter(Boolean);
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
    const [mode, releaseRunId, artifactId, sourceSha] = process.argv.slice(2);
    assert.ok(
      ['plan', 'dispatch'].includes(mode) && process.argv.length === 6,
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
      { releaseRunId, artifactId, sourceSha },
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
