#!/usr/bin/env node
/** Exact published Store payload; browser setup remains owned by the guarded hosted workflow. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EXTEND_GITHUB_REPO, TAG_PREFIX } from './app-layout.mjs';
import { isRuntimeEquivalentDocumentationPath } from './development-source-compatibility.mjs';
import {
  requireSynchronizedDispatchSource,
  verifyHostedWorkflowCheckout,
} from './hosted-remote-admission.mjs';
const OWNER = EXTEND_GITHUB_REPO; // standalone armanisadeghi/matrx-extend, nested aidream
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
      /^Hosted release(?: \(by [^\r\n]+\))?$/.test(run.name ?? '') &&
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
    Array.isArray(secretNames) && secretNames.includes('MATRX_PROFILE_APPROVED_ORGANIZATION_JSON'),
    'release_member_approved_organization_secret_required',
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
  // Operational records cannot alter the packaged extension. Keep this bound
  // to canonical stabilization folders and data formats; never admit source,
  // configuration, private fixtures, or path traversal through this class.
  const segments = path.split('/');
  if (
    segments.some((part) => !part || part === '.' || part === '..') ||
    segments.at(-1) === 'resource-policy.json' ||
    /%2f/i.test(path) ||
    /\.(?:mjs|cjs|js|ts|tsx|py|sh|yaml|yml)\./i.test(path) ||
    /(?:^|[/._-])(?:private|secret|secrets|credential|credentials|fixture|fixtures|config|env)(?:[/._-]|$)/i.test(
      path,
    ) ||
    /^docs\/stabilization\/runs\/hosted-settings-controls-/.test(path)
  )
    return false;
  // Completed records with an immutable reviewed-blob exception below cannot
  // become generally writable just because their directory is operational.
  if (
    path === 'docs/stabilization/evidence/store-release-20261017/tool-drift-release-repair.json' ||
    /^docs\/stabilization\/(?:runs\/hosted-settings-controls-39074994379\.json|resource-journals\/hosted-(?:browser|guest|package)-39074994379-1\.jsonl)$/.test(
      path,
    )
  )
    return false;
  if (
    /^docs\/stabilization\/resource-journals\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.sanitized\.jsonl$/.test(
      path,
    ) &&
    isRuntimeEquivalentDocumentationPath(path)
  )
    return true;
  if (
    /^docs\/stabilization\/(?:runs|reports)\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:json|jsonl|md|html|txt|log)$/.test(
      path,
    ) ||
    /^docs\/stabilization\/defects\/EXT-D-[0-9]{4}\.json$/.test(path)
  )
    return true;
  if (
    !/^docs\/stabilization\/evidence\/(?:member-run|guest-values-b-)/.test(path) &&
    /^docs\/stabilization\/evidence\/(?:[a-zA-Z0-9][a-zA-Z0-9._-]*\/)+[a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:json|jsonl|md|html|txt|log|png|jpg|jpeg|webp)$/.test(
      path,
    )
  ) {
    const run = path.match(/\/run([1-9][0-9]+)\//)?.[1];
    const journal = path.match(
      /\/resource-journals\/hosted-(?:browser|guest|package)-([1-9][0-9]+)-/,
    );
    if (path.includes('/resource-journals/'))
      return (
        run !== undefined &&
        ((journal !== null && journal[1] === run) ||
          /\/resource-journals\/hosted-(?:browser|guest|package)\.sanitized\.jsonl$/.test(path))
      );
    return true;
  }
  if (
    [
      'docs/stabilization/CHECKLIST.md',
      'docs/stabilization/COORDINATOR.md',
      'docs/stabilization/STATUS.md',
      'docs/stabilization/STATUS.html',
      'docs/stabilization/inventory.json',
    ].includes(path)
  )
    return true;
  if (/^docs\/stabilization\/defects\/EXT-D-[0-9]{4}\.json$/.test(path)) return true;
  if (
    /^docs\/stabilization\/evidence\/guest-values-b-[1-9][0-9]{10}\/(?:result\.sanitized\.json|values-open\.png)$/.test(
      path,
    )
  )
    return true;
  // Run receipts and sanitized evidence are non-runtime records, regardless
  // of the run verdict. Journal directory and filename must name one run.
  if (
    /^docs\/stabilization\/runs\/member-chat-store-v[0-9]{4}-run[1-9][0-9]{10,}\.json$/.test(path)
  )
    return true;
  const publicGuestReceipt =
    /^docs\/stabilization\/runs\/public-guest-chat-0\.2\.205-[1-9][0-9]{10,}\.json$/.test(path);
  if (publicGuestReceipt) return true;
  const publicGuestJournal =
    /^docs\/stabilization\/evidence\/published-v0205-guest-chat\/run([1-9][0-9]{10,})\/resource-journals\/hosted-(?:package|browser|guest)-\1-[1-9][0-9]*\.sanitized\.jsonl$/.test(
      path,
    );
  if (publicGuestJournal) return true;
  if (
    /^docs\/stabilization\/evidence\/published-v0205-guest-chat\/run[1-9][0-9]{10,}\/screenshots\/(?:native-side-panel|normal-target-after-open)\.png$/.test(
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
        path === 'tests/browser/member-chat-visible-proof.mjs' ||
        path === 'tests/browser/member-chat-visible-proof.test.mjs' ||
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

// Reviewed immutable .537 TEST-only drift; no Store eligibility is implied.
const reviewedCandidateSource = '1b612c67410576b5d077fe20bee4fd33455d987d';
const reviewedCandidateChanges = {
  bffebad8ab1684b7fa23c0cd68c89805cbb87385: {
    'tests/browser/vault-package-panel-walk.mjs': '2362f06b9dcfdf662c3d7bbe89af84fc0a99c9ea',
  },
  '4c24d46e1a5ed1e2b8ec790618fb57839ec86d74': {
    'pnpm-lock.yaml': '602fbd618dee1c8a5de04c2f627d74ff793fb8cc',
  },
  a9e9a5913adc6ce4a2c24a3ff60cd86cb3bce69c: {
    '_conflicts/2026-10-17-234541/pnpm-lock.yaml.held': '52ac526fe7c54b1120dc56b676ff7892fcaf1e62',
    '_conflicts/README.md': 'b4fbec0d398d59d482d03e5956d76f09b8105890',
    'docs/TOOLS.generated.md': 'da33a74f9e1100c576c2a3b4d8fab0f8b56c2ee0',
    'docs/stabilization/defects/EXT-D-0223.json': '43aed9f1500b83763a4550dd301ec83f29d01853',
    'package.json': '9c345f745ac563f076a2b16fa12bcb39d752808f',
    'pnpm-lock.yaml': '12744871d792a43173913da3deb8cabf75798886',
    'tests/browser/vault-package-panel-walk.mjs': 'd49410749f5c453cc56527d4b9d8f02e9d83d3a7',
    'tests/browser/vault-walk-cleanup.mjs': '61a144de5a3b60586040c8343225eb62c582945f',
    'types/tool-catalog.json': 'eb4a37a89a1a5564a5aea9ba6b7a923495e992d8',
    'types/tool-catalog.md': 'd357267ab44aa23b8cb8fbf8f2145eb812b22504',
  },
  '7aa553320ed9fa5019899a3f35337dcbe1d77711': {
    'tests/browser/vault-package-panel-walk.mjs': 'd49410749f5c453cc56527d4b9d8f02e9d83d3a7',
    'tests/browser/vault-walk-cleanup.mjs': '61a144de5a3b60586040c8343225eb62c582945f',
  },
  '15d9b71630b82c92bdbc750e86faede2ed212f11': {
    'pnpm-lock.yaml': '602fbd618dee1c8a5de04c2f627d74ff793fb8cc',
  },
};

export function proveSource(sourceSha, workflowSha) {
  execFileSync('git', ['merge-base', '--is-ancestor', sourceSha, workflowSha]);
  // SHA attests the reviewed two-file operational change, not a script namespace.
  // Census every other commit (including reverted changes) and all pending bytes.
  const reviewedGuestRoute = '1ec98baf21d2a6b8631971dd43c13fc199a6b2a4';
  const reviewedGuestPaths = [
    'scripts/hosted-remote-admission.mjs',
    'scripts/hosted-remote-guest-chat-admission.test.mjs',
  ];
  // Terminal resource-invalid Settings record (zero product credit). These
  // bytes are reviewed at this immutable commit, not a general evidence namespace.
  const reviewedSettingsRecord = '1d458dba919650fcb0f077c0a65f723bd9ef7cc0';
  const reviewedSettingsPaths = [
    'docs/stabilization/defects/EXT-D-0232.json',
    'docs/stabilization/runs/hosted-settings-controls-39074994379.json',
    'docs/stabilization/resource-journals/hosted-browser-39074994379-1.jsonl',
    'docs/stabilization/resource-journals/hosted-guest-39074994379-1.jsonl',
    'docs/stabilization/resource-journals/hosted-package-39074994379-1.jsonl',
  ];
  const reviewedStorePeer = '66b9b1b1852036d8aa565715455f94935177c522';
  const reviewedStoreReceipt =
    'docs/stabilization/evidence/store-release-20261017/tool-drift-release-repair.json';
  const reviewedChanges = [];
  const commits = git(['rev-list', `${sourceSha}..${workflowSha}`])
    .split('\n')
    .filter(Boolean);
  const changedPaths = commits.flatMap((commit) => {
    const parents = git(['rev-list', '--parents', '-n', '1', commit]).split(' ').slice(1);
    // A merge can bring the frozen candidate in as its second parent. Comparing
    // against every parent counts the candidate's own files as newly changed.
    // Compare against the parent(s) descended from the candidate instead;
    // ordinary commits on either branch are still censused individually.
    const candidateParents =
      parents.length > 1
        ? parents.filter((parent) => git(['merge-base', sourceSha, parent]) === sourceSha)
        : [];
    const paths =
      candidateParents.length > 0
        ? candidateParents.flatMap((parent) =>
            execFileSync('git', ['diff', '--no-renames', '--name-only', '-z', parent, commit], {
              encoding: 'utf8',
            })
              .split('\0')
              .filter(Boolean),
          )
        : execFileSync(
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
    return [...new Set(paths)].filter((path) => {
      const expectedBlob =
        sourceSha === reviewedCandidateSource
          ? reviewedCandidateChanges[commit]?.[path]
          : undefined;
      if (expectedBlob) {
        assert.equal(
          git(['rev-parse', `${commit}:${path}`]),
          expectedBlob,
          'release_member_reviewed_blob_mismatch',
        );
        reviewedChanges.push({ commit, path, blob: expectedBlob });
        return false;
      }
      return (
        (commit !== reviewedGuestRoute || !reviewedGuestPaths.includes(path)) &&
        (commit !== reviewedSettingsRecord || !reviewedSettingsPaths.includes(path)) &&
        (commit !== reviewedStorePeer || path !== reviewedStoreReceipt)
      );
    });
  });
  const pendingPaths = [
    ...execFileSync('git', ['diff', '--name-only', '-z', 'HEAD'], { encoding: 'utf8' }).split('\0'),
    ...execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
      encoding: 'utf8',
    }).split('\0'),
  ].filter(Boolean);
  requireReleaseMemberSource(true, [...changedPaths, ...pendingPaths]);
  return {
    scope:
      sourceSha === reviewedCandidateSource
        ? 'frozen-release-candidate-test'
        : 'frozen-release-test',
    storeEligibility: false,
    sourceSha,
    workflowSha,
    reviewedChanges,
    subsequentCommits: commits,
    subsequentChangedPaths: [...new Set(changedPaths)],
    pendingPaths,
  };
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
    const tagRef = `refs/tags/${TAG_PREFIX}v${receipt.version}`;
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
    const sourceReview = proveSource(sourceSha, workflowSha);
    if (mode === 'dispatch') execFileSync('gh', plan.args, { stdio: 'inherit' });
    console.log(
      JSON.stringify({
        mode,
        ...sourceReview,
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
