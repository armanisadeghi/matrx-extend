#!/usr/bin/env node
/** Lightweight Mac-side dispatch; package and browser work runs under GitHub-hosted permits. */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sanitizeHostedResourceJournal } from './copy-hosted-resource-journal.mjs';
import {
  isRuntimeEquivalentDocumentationPath,
  sourceCompatibility,
} from './development-source-compatibility.mjs';
import {
  PUBLISHED_STORE_CRX,
  requirePublishedStoreCrxTarget,
} from './published-store-crx-target.mjs';

const OWNER = 'armanisadeghi/matrx-extend';
const PHASES = ['hosted-package', 'hosted-browser', 'hosted-guest'];
const DISPATCH_REQUESTER = 'extend-stabilization';
// Reviewed bytes of this narrow lane's active hosted workflow. Any workflow edit needs review.
// Notes CDP opt-in uses startup_display_mode; SEO diagnostics share one input, leaving 25.
// D221 adds only the reviewed lane A admin Screenshots case on an exact CI development artifact.
// EXT-D-0243 enables existing startup observers for guest/member Chat after independent review.
// EXT-D-0262 adds one guest Settings admin-absence route on the existing guarded lane.
// The existing phase, fixture, and credential guards remain mandatory.
const REVIEWED_WORKFLOW_SHA256 = 'c001f41ae6e982998b923bf25e7470e4e84006055eba883358fae9ecb696bb8b';
const RESOURCE_POLICY = JSON.parse(
  readFileSync(new URL('../docs/stabilization/resource-policy.json', import.meta.url), 'utf8'),
);
const DECIMAL = /^[1-9][0-9]*$/;
const SHA = /^[a-f0-9]{40}$/;
function refuse(code) {
  throw new Error(code);
}

export function matchesHostedRunName(actual, expected) {
  return (
    actual === expected ||
    (typeof actual === 'string' &&
      actual.startsWith(`${expected} (by `) &&
      /^Native [AB] · .+ \(by [A-Za-z0-9_-]+\)$/.test(actual))
  );
}

export function requireHostedWorkflowContract(workflow) {
  if (typeof workflow !== 'string') refuse('HOSTED_WORKFLOW_MISSING');
  for (const [code, pattern] of [
    ['HOSTED_RUNNER_REQUIRED', /runs-on: \$\{\{ inputs\.runner_label == 'macos-15'/],
    [
      'HOSTED_LANE_ADMISSION_MISSING',
      /BEGIN hosted lane admission[\s\S]*END hosted lane admission/,
    ],
    [
      'HOSTED_FIXTURE_SERIALIZATION_MISSING',
      /group: \$\{\{ inputs\.acceptance_lane == 'B' && 'hosted-guest-side-panel-B' \|\| 'hosted-guest-side-panel-A' \}\}[\s\S]*cancel-in-progress: false/,
    ],
    ['HOSTED_ARTIFACT_PROVENANCE_MISSING', /- name: Require exactly one artifact provenance mode/],
    [
      'HOSTED_FIXTURE_PREFLIGHT_MISSING',
      /- name: Require selected authentication before browser setup/,
    ],
    [
      'HOSTED_SECRET_BOUNDARY_MISSING',
      /MATRX_HOSTED_MEMBER_LINK_JSON: \$\{\{ secrets\.MATRX_REVIEWER_MAGIC_LINK_JSON \}\}/,
    ],
    [
      'HOSTED_ARTIFACT_IMPORT_MISSING',
      /MATRX_HOSTED_DEV_RUN_ID: \$\{\{ inputs\.development_run_id \}\}[\s\S]*MATRX_HOSTED_DEV_ARTIFACT_ID: \$\{\{ inputs\.development_artifact_id \}\}/,
    ],
    [
      'HOSTED_JOURNAL_UPLOAD_MISSING',
      /- name: Upload browser result and native-panel screenshots[\s\S]*if: always\(\)/,
    ],
  ])
    if (!pattern.test(workflow)) refuse(code);
  for (const prefix of PHASES) {
    if (
      !workflow.includes(
        `stabilization-resource.mjs run --run-id "${prefix}-\${{ github.run_id }}-\${{ github.run_attempt }}"`,
      )
    )
      refuse('HOSTED_PHASE_GUARD_MISSING');
    for (const suffix of ['.jsonl', '.pending.jsonl']) {
      if (
        !workflow.includes(
          `docs/stabilization/resource-journals/${prefix}-\${{ github.run_id }}-\${{ github.run_attempt }}${suffix}`,
        )
      )
        refuse('HOSTED_JOURNAL_UPLOAD_MISSING');
    }
  }
  if (createHash('sha256').update(workflow, 'utf8').digest('hex') !== REVIEWED_WORKFLOW_SHA256)
    refuse('HOSTED_WORKFLOW_BLOB_UNREVIEWED');
  return true;
}

export function verifyHostedWorkflowCheckout(run, fetchContent = ghJson) {
  if (
    run?.path !== '.github/workflows/hosted-guest-acceptance.yml' ||
    !SHA.test(run.head_sha ?? '')
  )
    refuse('HOSTED_WORKFLOW_CHECKOUT_INVALID');
  const source = fetchContent(
    `repos/${OWNER}/contents/.github/workflows/hosted-guest-acceptance.yml?ref=${run.head_sha}`,
  );
  if (source?.path !== run.path || source?.type !== 'file' || source?.encoding !== 'base64')
    refuse('HOSTED_WORKFLOW_SOURCE_MISSING');
  const encoded = source.content?.replace(/\s/g, '');
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
    refuse('HOSTED_WORKFLOW_SOURCE_INVALID');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded) refuse('HOSTED_WORKFLOW_SOURCE_INVALID');
  const workflow = bytes.toString('utf8');
  if (!bytes.equals(Buffer.from(workflow, 'utf8'))) refuse('HOSTED_WORKFLOW_SOURCE_INVALID');
  requireHostedWorkflowContract(workflow);
  return {
    workflowSha: run.head_sha,
    workflowSourceSha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

/** Exact released Store bytes on the isolated guest B lane; no credential staging. */
export function planHostedGuestChat({
  lane,
  acceptanceCase,
  runnerLabel = 'macos-15-intel',
  releaseRunId,
  artifactId,
  sourceSha,
  workflowRef = 'main',
  workflow,
}) {
  if (lane !== 'B') refuse('HOSTED_CHAT_LANE_REFUSED');
  if (acceptanceCase !== 'guest-chat') refuse('HOSTED_CHAT_CASE_REFUSED');
  if (runnerLabel !== 'macos-15-intel' && runnerLabel !== 'macos-15')
    refuse('HOSTED_CHAT_RUNNER_REFUSED');
  if (!DECIMAL.test(releaseRunId ?? '') || !DECIMAL.test(artifactId ?? ''))
    refuse('HOSTED_ARTIFACT_ID_INVALID');
  if (!SHA.test(sourceSha ?? '')) refuse('HOSTED_SOURCE_SHA_INVALID');
  if (workflowRef !== 'main') refuse('HOSTED_WORKFLOW_REF_REFUSED');
  requireHostedWorkflowContract(
    workflow ??
      readFileSync(
        new URL('../.github/workflows/hosted-guest-acceptance.yml', import.meta.url),
        'utf8',
      ),
  );
  return {
    command: 'gh',
    args: [
      'workflow',
      'run',
      'hosted-guest-acceptance.yml',
      '--ref',
      'main',
      ...[
        'acceptance_lane=B',
        'acceptance_case=guest-chat',
        'scrape_auth_mode=guest',
        `requested_by=${DISPATCH_REQUESTER}`,
        `runner_label=${runnerLabel}`,
        `release_run_id=${releaseRunId}`,
      ].flatMap((field) => ['-f', field]),
    ],
  };
}

/** Public Store bytes, pinned by the hosted CRX importer; no release/development artifact. */
export function planHostedPublishedGuestChat({
  lane,
  acceptanceCase,
  runnerLabel = 'macos-15-intel',
  publicVersion,
  publicId,
  sourceSha,
  workflowRef = 'main',
  workflow,
}) {
  if (lane !== 'B') refuse('HOSTED_CHAT_LANE_REFUSED');
  if (acceptanceCase !== 'guest-chat') refuse('HOSTED_CHAT_CASE_REFUSED');
  if (runnerLabel !== 'macos-15-intel' && runnerLabel !== 'macos-15')
    refuse('HOSTED_CHAT_RUNNER_REFUSED');
  if (publicVersion !== PUBLISHED_STORE_CRX.version || publicId !== PUBLISHED_STORE_CRX.id)
    refuse('HOSTED_CHAT_PUBLIC_TARGET_REFUSED');
  if (!SHA.test(sourceSha ?? '')) refuse('HOSTED_SOURCE_SHA_INVALID');
  if (workflowRef !== 'main') refuse('HOSTED_WORKFLOW_REF_REFUSED');
  requireHostedWorkflowContract(
    workflow ??
      readFileSync(
        new URL('../.github/workflows/hosted-guest-acceptance.yml', import.meta.url),
        'utf8',
      ),
  );
  return {
    command: 'gh',
    args: [
      'workflow',
      'run',
      'hosted-guest-acceptance.yml',
      '--ref',
      'main',
      ...[
        'acceptance_lane=B',
        'acceptance_case=guest-chat',
        'scrape_auth_mode=guest',
        `requested_by=${DISPATCH_REQUESTER}`,
        `runner_label=${runnerLabel}`,
        'published_store_crx=true',
      ].flatMap((field) => ['-f', field]),
    ],
  };
}

// Frozen release bytes can be reused only across canonical documentation-only history.
// Browser harnesses, workflows, dependencies and product edits require a fresh release.
export function requireGuestChatDispatchAdmission({
  localSha,
  remoteSha,
  dirty,
  sourceSha,
  ancestor,
  changedPaths,
  runs,
}) {
  requireSynchronizedDispatchSource(localSha, remoteSha, dirty);
  if (
    !SHA.test(sourceSha ?? '') ||
    ancestor !== true ||
    !Array.isArray(changedPaths) ||
    changedPaths.some((path) => !isRuntimeEquivalentDocumentationPath(path))
  )
    refuse('HOSTED_CHAT_RUNTIME_SOURCE_DRIFT');
  if (
    !Array.isArray(runs) ||
    runs.some((run) => run.status !== 'completed' && !/^Native A · /.test(run.name ?? ''))
  )
    refuse('HOSTED_CHAT_B_CAPACITY_REFUSED');
  return true;
}

async function guestChatCli(mode, args) {
  const published =
    mode === 'plan-published-guest-chat' || mode === 'dispatch-published-guest-chat';
  for (const key of args.keys())
    if (
      ![
        '--lane',
        '--case',
        '--runner-label',
        '--source-sha',
        '--workflow-ref',
        ...(published
          ? ['--public-version', '--public-id']
          : ['--release-run-id', '--artifact-id']),
      ].includes(key)
    )
      refuse('HOSTED_ARGUMENT_INVALID');
  const input = {
    lane: args.get('--lane'),
    acceptanceCase: args.get('--case'),
    runnerLabel: args.get('--runner-label') ?? 'macos-15-intel',
    releaseRunId: args.get('--release-run-id'),
    artifactId: args.get('--artifact-id'),
    sourceSha: args.get('--source-sha'),
    workflowRef: args.get('--workflow-ref') ?? 'main',
    publicVersion: args.get('--public-version'),
    publicId: args.get('--public-id'),
  };
  const plan = published ? planHostedPublishedGuestChat(input) : planHostedGuestChat(input);
  const git = (argv) => execFileSync('git', argv, { encoding: 'utf8' }).trim();
  const admit = () => {
    const localSha = git(['rev-parse', 'HEAD']);
    const remoteSha = ghJson(`repos/${OWNER}/git/ref/heads/main`).object?.sha;
    const dirty = git(['status', '--porcelain']);
    requireSynchronizedDispatchSource(localSha, remoteSha, dirty);
    verifyHostedWorkflowCheckout({
      path: '.github/workflows/hosted-guest-acceptance.yml',
      head_sha: remoteSha,
    });
    const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', input.sourceSha, remoteSha]);
    const changedPaths = execFileSync(
      'git',
      ['log', '--no-renames', '--format=', '--name-only', '-z', `${input.sourceSha}..${remoteSha}`],
      { encoding: 'utf8' },
    )
      .split('\0')
      .filter(Boolean);
    const runs = ['hosted-guest-acceptance.yml', 'hosted-resource-diagnostic.yml'].flatMap(
      (workflow) =>
        ['queued', 'in_progress', 'waiting', 'pending', 'requested'].flatMap((status) => {
          const listing = ghJson(
            `repos/${OWNER}/actions/workflows/${workflow}/runs?status=${status}&per_page=100`,
          );
          if (
            !Array.isArray(listing.workflow_runs) ||
            listing.total_count !== listing.workflow_runs.length
          )
            refuse('HOSTED_CHAT_B_CAPACITY_REFUSED');
          return listing.workflow_runs;
        }),
    );
    requireGuestChatDispatchAdmission({
      localSha,
      remoteSha,
      dirty,
      sourceSha: input.sourceSha,
      ancestor: !ancestor.error && ancestor.status === 0,
      changedPaths,
      runs,
    });
    return remoteSha;
  };
  const workflowSha = admit();
  if (published) {
    await requirePublishedStoreCrxTarget(
      input.publicVersion,
      new URL('../config/chrome-web-store-approved-baseline.json', import.meta.url),
    );
    if (admit() !== workflowSha) refuse('HOSTED_CHAT_WORKFLOW_CHANGED');
    if (mode === 'dispatch-published-guest-chat') {
      const result = spawnSync(plan.command, [...plan.args, '-R', OWNER], { stdio: 'inherit' });
      if (result.status !== 0) refuse('HOSTED_DISPATCH_FAILED');
    }
    process.stdout.write(
      `${JSON.stringify({
        mode,
        plan,
        workflowSha,
        sourceSha: input.sourceSha,
        publicVersion: PUBLISHED_STORE_CRX.version,
        publicId: PUBLISHED_STORE_CRX.id,
        crxSha256: PUBLISHED_STORE_CRX.crxSha256,
        host: 'github-hosted',
        localHeavyWork: false,
      })}\n`,
    );
    return;
  }
  // Reuse the existing release identity, published receipt, tag and archive-byte validators.
  const { releaseMemberPlan, verifyReleaseMemberBytes } = await import(
    './hosted-release-member-admission.mjs'
  );
  const run = ghJson(`repos/${OWNER}/actions/runs/${input.releaseRunId}`);
  const listing = ghJson(
    `repos/${OWNER}/actions/runs/${input.releaseRunId}/artifacts?per_page=100`,
  );
  let scratch;
  try {
    scratch = mkdtempSync(join(tmpdir(), 'guest-chat-admission-'));
    const archive = execFileSync(
      'gh',
      ['api', `repos/${OWNER}/actions/artifacts/${input.artifactId}/zip`],
      { maxBuffer: 256 * 1024 * 1024 },
    );
    const archivePath = join(scratch, 'artifact.zip');
    writeFileSync(archivePath, archive, { mode: 0o600 });
    const entries = execFileSync('unzip', ['-Z1', archivePath], { encoding: 'utf8' })
      .trim()
      .split('\n');
    const matching = (name) => {
      const matches = entries.filter((entry) => entry === name || entry.endsWith(`/${name}`));
      if (matches.length !== 1) refuse('HOSTED_CHAT_ARCHIVE_ENTRY_AMBIGUOUS');
      return matches[0];
    };
    const receipt = JSON.parse(
      execFileSync('unzip', ['-p', archivePath, matching('release-receipt.json')], {
        encoding: 'utf8',
      }),
    );
    if (!/^\d+\.\d+\.\d+$/.test(receipt.version ?? '')) refuse('HOSTED_CHAT_VERSION_INVALID');
    const tagRef = `refs/tags/v${receipt.version}`;
    const tags = git(['ls-remote', 'origin', tagRef, `${tagRef}^{}`])
      .split('\n')
      .map((line) => line.split('\t'));
    const tagSha =
      tags.find(([, ref]) => ref === `${tagRef}^{}`)?.[0] ??
      tags.find(([, ref]) => ref === tagRef)?.[0];
    const release = releaseMemberPlan(input, run, listing, receipt, tagSha);
    const store = execFileSync(
      'unzip',
      ['-p', archivePath, matching(`matrx-extend-${receipt.version}-store.zip`)],
      { maxBuffer: 256 * 1024 * 1024 },
    );
    verifyReleaseMemberBytes(archive, release.artifact, receipt, store);
    if (admit() !== workflowSha) refuse('HOSTED_CHAT_WORKFLOW_CHANGED');
    if (mode === 'dispatch-guest-chat') {
      const result = spawnSync(plan.command, [...plan.args, '-R', OWNER], { stdio: 'inherit' });
      if (result.status !== 0) refuse('HOSTED_DISPATCH_FAILED');
    }
    process.stdout.write(
      `${JSON.stringify({
        mode,
        plan,
        workflowSha,
        sourceSha: input.sourceSha,
        releaseRunId: input.releaseRunId,
        artifactId: input.artifactId,
        version: receipt.version,
        storeZipSha256: receipt.storeZip.sha256,
        githubArtifactDigest: release.artifact.digest,
        host: 'github-hosted',
        localHeavyWork: false,
      })}\n`,
    );
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
}

export function planHostedMemberData({
  lane,
  memberDataScope = 'auto-extract',
  developmentRunId,
  developmentArtifactId,
  workflowRef = 'main',
  workflow,
  sourceSha,
}) {
  if (lane !== 'A') refuse('HOSTED_MEMBER_LANE_REFUSED');
  if (memberDataScope === 'lifecycle' && !SHA.test(sourceSha ?? ''))
    refuse('HOSTED_SOURCE_SHA_INVALID');
  if (!['lifecycle', 'auto-extract'].includes(memberDataScope))
    refuse('HOSTED_MEMBER_DATA_SCOPE_REFUSED');
  if (!DECIMAL.test(developmentRunId ?? '') || !DECIMAL.test(developmentArtifactId ?? ''))
    refuse('HOSTED_ARTIFACT_ID_INVALID');
  if (workflowRef !== 'main') refuse('HOSTED_WORKFLOW_REF_REFUSED');
  if (sourceSha !== undefined && !SHA.test(sourceSha)) refuse('HOSTED_SOURCE_SHA_INVALID');
  requireHostedWorkflowContract(
    workflow ??
      readFileSync(
        new URL('../.github/workflows/hosted-guest-acceptance.yml', import.meta.url),
        'utf8',
      ),
  );
  return {
    command: 'gh',
    args: [
      'workflow',
      'run',
      'hosted-guest-acceptance.yml',
      '--ref',
      workflowRef,
      '-f',
      'acceptance_lane=A',
      '-f',
      'acceptance_case=member-data',
      '-f',
      `requested_by=${DISPATCH_REQUESTER}`,
      '-f',
      `member_data_scope=${memberDataScope}`,
      '-f',
      'scrape_auth_mode=member',
      '-f',
      `development_run_id=${developmentRunId}`,
      '-f',
      `development_artifact_id=${developmentArtifactId}`,
    ],
  };
}

/** D231: diagnostic only, using the existing guarded startup phase without authentication. */
export function planHostedStartupDiagnostic({
  lane,
  acceptanceCase,
  runnerLabel,
  displayMode = 'headed',
  ...input
}) {
  if (!['headed', 'headless'].includes(displayMode)) refuse('HOSTED_STARTUP_DISPLAY_MODE_REFUSED');
  if (lane !== 'A') refuse('HOSTED_STARTUP_LANE_REFUSED');
  if (acceptanceCase !== 'startup-resource-diagnostic') refuse('HOSTED_STARTUP_CASE_REFUSED');
  if (runnerLabel !== 'macos-15-intel') refuse('HOSTED_STARTUP_RUNNER_REFUSED');
  if (!SHA.test(input.sourceSha ?? '')) refuse('HOSTED_SOURCE_SHA_INVALID');
  planHostedMemberData({ ...input, lane });
  return {
    command: 'gh',
    args: [
      'workflow',
      'run',
      'hosted-guest-acceptance.yml',
      '--ref',
      'main',
      ...[
        'acceptance_lane=A',
        'acceptance_case=startup-resource-diagnostic',
        `requested_by=${DISPATCH_REQUESTER}`,
        'scrape_auth_mode=guest',
        'runner_label=macos-15-intel',
        `startup_display_mode=${displayMode}`,
        `development_run_id=${input.developmentRunId}`,
        `development_artifact_id=${input.developmentArtifactId}`,
      ].flatMap((field) => ['-f', field]),
    ],
  };
}

export function requireStartupDiagnosticDispatchAdmission({
  localSha,
  remoteSha,
  sourceSha,
  dirty,
  runs,
}) {
  requireExactDispatchSource(localSha, remoteSha, dirty, sourceSha, 'HOSTED_STARTUP_SOURCE_DRIFT');
  if (
    !Array.isArray(runs) ||
    runs.some((run) => run.status !== 'completed' && !/^Native B · /.test(run.name ?? ''))
  )
    refuse('HOSTED_STARTUP_A_CAPACITY_REFUSED');
  return true;
}

function startupDiagnosticCli(mode, args) {
  for (const key of args.keys())
    if (
      ![
        '--lane',
        '--case',
        '--runner-label',
        '--startup-display-mode',
        '--development-run-id',
        '--development-artifact-id',
        '--source-sha',
      ].includes(key)
    )
      refuse('HOSTED_ARGUMENT_INVALID');
  const sourceSha = args.get('--source-sha');
  const plan = planHostedStartupDiagnostic({
    lane: args.get('--lane'),
    acceptanceCase: args.get('--case'),
    runnerLabel: args.get('--runner-label'),
    displayMode: args.get('--startup-display-mode') ?? 'headed',
    sourceSha,
    developmentRunId: args.get('--development-run-id'),
    developmentArtifactId: args.get('--development-artifact-id'),
  });
  const artifact = requireDevelopmentArtifact({
    runId: args.get('--development-run-id'),
    artifactId: args.get('--development-artifact-id'),
    sourceSha,
  });
  if (mode === 'dispatch-startup-diagnostic') {
    const state = () => ({
      localSha: execFileSync('git', ['rev-parse', 'HEAD'], {
        encoding: 'utf8',
      }).trim(),
      remoteSha: ghJson(`repos/${OWNER}/git/ref/heads/main`).object?.sha,
      dirty: execFileSync('git', ['status', '--porcelain'], {
        encoding: 'utf8',
      }).trim(),
      sourceSha,
    });
    const initial = state();
    requireExactDispatchSource(
      initial.localSha,
      initial.remoteSha,
      initial.dirty,
      sourceSha,
      'HOSTED_STARTUP_SOURCE_DRIFT',
    );
    verifyHostedWorkflowCheckout({
      path: '.github/workflows/hosted-guest-acceptance.yml',
      head_sha: initial.remoteSha,
    });
    const runs = ['hosted-guest-acceptance.yml', 'hosted-resource-diagnostic.yml'].flatMap(
      (workflow) =>
        ['queued', 'in_progress', 'waiting', 'pending', 'requested'].flatMap((status) => {
          const listing = ghJson(
            `repos/${OWNER}/actions/workflows/${workflow}/runs?status=${status}&per_page=100`,
          );
          if (
            !Array.isArray(listing.workflow_runs) ||
            listing.total_count !== listing.workflow_runs.length
          )
            refuse('HOSTED_STARTUP_A_CAPACITY_REFUSED');
          return listing.workflow_runs;
        }),
    );
    requireStartupDiagnosticDispatchAdmission({ ...initial, runs });
    const final = state();
    requireExactDispatchSource(
      final.localSha,
      final.remoteSha,
      final.dirty,
      sourceSha,
      'HOSTED_STARTUP_SOURCE_DRIFT',
    );
    const result = spawnSync(plan.command, [...plan.args, '-R', OWNER], {
      stdio: 'inherit',
    });
    if (result.status !== 0) refuse('HOSTED_DISPATCH_FAILED');
  }
  process.stdout.write(
    `${JSON.stringify({
      mode,
      plan,
      artifact,
      host: 'github-hosted',
      localHeavyWork: false,
      verdict: 'DIAGNOSTIC_ONLY_NO_PRODUCT_ACCEPTANCE',
    })}\n`,
  );
}

/** One reviewed, guest-only SEO target. Every alternate input is an explicit refusal. */
export function planHostedGuestSeo({
  lane,
  acceptanceCase,
  seoCaseScope,
  seoMetadataFixture,
  seoResourceDiagnostic,
  seoInterruptAfterTarget,
  runnerLabel,
  developmentRunId,
  developmentArtifactId,
  workflowRef = 'main',
  workflow,
  sourceSha,
}) {
  if (lane !== 'B') refuse('HOSTED_SEO_LANE_REFUSED');
  if (acceptanceCase !== 'guest-seo') refuse('HOSTED_SEO_CASE_REFUSED');
  if (seoCaseScope !== 'notice-stacked') refuse('HOSTED_SEO_SCOPE_REFUSED');
  if (seoMetadataFixture !== 'none') refuse('HOSTED_SEO_FIXTURE_REFUSED');
  if (seoResourceDiagnostic !== 'false') refuse('HOSTED_SEO_DIAGNOSTIC_REFUSED');
  if (seoInterruptAfterTarget !== 'none') refuse('HOSTED_SEO_INTERRUPT_REFUSED');
  if (runnerLabel !== 'macos-15-intel') refuse('HOSTED_SEO_RUNNER_REFUSED');
  if (!DECIMAL.test(developmentRunId ?? '') || !DECIMAL.test(developmentArtifactId ?? ''))
    refuse('HOSTED_ARTIFACT_ID_INVALID');
  if (workflowRef !== 'main') refuse('HOSTED_WORKFLOW_REF_REFUSED');
  if (!SHA.test(sourceSha ?? '')) refuse('HOSTED_SOURCE_SHA_INVALID');
  requireHostedWorkflowContract(
    workflow ??
      readFileSync(
        new URL('../.github/workflows/hosted-guest-acceptance.yml', import.meta.url),
        'utf8',
      ),
  );
  return {
    command: 'gh',
    args: [
      'workflow',
      'run',
      'hosted-guest-acceptance.yml',
      '--ref',
      'main',
      '-f',
      'acceptance_lane=B',
      '-f',
      'acceptance_case=guest-seo',
      '-f',
      `requested_by=${DISPATCH_REQUESTER}`,
      '-f',
      'seo_case_scope=notice-stacked',
      '-f',
      'seo_metadata_fixture=none',
      '-f',
      'seo_diagnostic=none',
      '-f',
      'runner_label=macos-15-intel',
      '-f',
      `development_run_id=${developmentRunId}`,
      '-f',
      `development_artifact_id=${developmentArtifactId}`,
    ],
  };
}

/** One guest-owned page; broader Scrape, credential staging and diagnostics are refused. */
export function planHostedScrape({
  lane,
  acceptanceCase,
  scrapeScope,
  authMode,
  runnerLabel,
  ...input
}) {
  if (lane !== 'B') refuse('HOSTED_SCRAPE_LANE_REFUSED');
  if (acceptanceCase !== 'guest-scrape-development') refuse('HOSTED_SCRAPE_CASE_REFUSED');
  if (scrapeScope !== 'seo-schema-empty') refuse('HOSTED_SCRAPE_SCOPE_REFUSED');
  if (authMode !== 'guest') refuse('HOSTED_SCRAPE_AUTH_REFUSED');
  if (runnerLabel !== 'macos-15-intel') refuse('HOSTED_SCRAPE_RUNNER_REFUSED');
  if (!SHA.test(input.sourceSha ?? '')) refuse('HOSTED_SOURCE_SHA_INVALID');
  planHostedMemberData({ ...input, lane: 'A' });
  return {
    command: 'gh',
    args: [
      'workflow',
      'run',
      'hosted-guest-acceptance.yml',
      '--ref',
      'main',
      ...[
        'acceptance_lane=B',
        'acceptance_case=guest-scrape-development',
        `requested_by=${DISPATCH_REQUESTER}`,
        'scrape_scope=seo-schema-empty',
        'scrape_auth_mode=guest',
        'runner_label=macos-15-intel',
        `development_run_id=${input.developmentRunId}`,
        `development_artifact_id=${input.developmentArtifactId}`,
      ].flatMap((field) => ['-f', field]),
    ],
  };
}

export function requireScrapeDispatchAdmission({ localSha, remoteSha, sourceSha, dirty, runs }) {
  requireExactDispatchSource(localSha, remoteSha, dirty, sourceSha, 'HOSTED_SCRAPE_SOURCE_DRIFT');
  if (
    !Array.isArray(runs) ||
    runs.some((run) => run.status !== 'completed' && !/^Native A · /.test(run.name ?? ''))
  )
    refuse('HOSTED_SCRAPE_B_CAPACITY_REFUSED');
  return true;
}

/** Member Save: D187 single or D217 stale-profile retry without a destination. */
export function planHostedMemberScrapeSave({
  lane,
  acceptanceCase,
  destination,
  scope,
  runnerLabel,
  ...input
}) {
  if (lane !== 'A') refuse('HOSTED_MEMBER_SCRAPE_LANE_REFUSED');
  if (
    acceptanceCase !== 'scrape-save-member' ||
    !(
      (scope === 'single' && ['none', 'project'].includes(destination)) ||
      (scope === 'stale-profile-retry' && destination === 'none')
    )
  )
    refuse('HOSTED_MEMBER_SCRAPE_SCOPE_REFUSED');
  if (runnerLabel !== 'macos-15-intel') refuse('HOSTED_MEMBER_SCRAPE_RUNNER_REFUSED');
  planHostedMemberData({ ...input, lane });
  return {
    command: 'gh',
    args: [
      'workflow',
      'run',
      'hosted-guest-acceptance.yml',
      '--ref',
      'main',
      ...[
        'acceptance_lane=A',
        'acceptance_case=scrape-save-member',
        `requested_by=${DISPATCH_REQUESTER}`,
        'scrape_auth_mode=member',
        `scrape_save_destination=${destination}`,
        `scrape_save_scope=${scope}`,
        'runner_label=macos-15-intel',
        `development_run_id=${input.developmentRunId}`,
        `development_artifact_id=${input.developmentArtifactId}`,
      ].flatMap((field) => ['-f', field]),
    ],
  };
}

export function requireMemberScrapeSaveDispatchAdmission(input) {
  requireExactDispatchSource(
    input.localSha,
    input.remoteSha,
    input.dirty,
    input.sourceSha,
    'HOSTED_MEMBER_SCRAPE_SOURCE_DRIFT',
  );
  if (
    !Array.isArray(input.runs) ||
    input.runs.some((run) => run.status !== 'completed' && !/^Native B · /.test(run.name ?? ''))
  )
    refuse('HOSTED_MEMBER_SCRAPE_A_CAPACITY_REFUSED');
  if (!input.secretNames?.includes('MATRX_REVIEWER_MAGIC_LINK_JSON'))
    refuse('HOSTED_MEMBER_SCRAPE_SECRET_MISSING');
  return true;
}

function verifyD217StaleProfileEvidence(evidence) {
  const guestAttempt = (attempt) =>
    attempt?.sign_in_required === true &&
    attempt.no_organization_error === false &&
    attempt.queued === true &&
    attempt.edited_text_retained === true &&
    attempt.memberships === 0 &&
    attempt.landings === 0;
  const fixture = evidence?.fixture;
  const reload = evidence?.reload;
  const member = evidence?.member_retry;
  const persisted = evidence?.persisted_source_content;
  return (
    fixture?.credentials_removed === true &&
    fixture.restore_via_full_extension_reload === true &&
    fixture.guest_restore_observed === true &&
    guestAttempt(evidence.warm_save) &&
    guestAttempt(evidence.warm_retry) &&
    evidence.warm_retry.revision > evidence.warm_save.revision &&
    reload?.management_reload_clicked === true &&
    reload.old_targets_retired === true &&
    reload.worker_replaced === true &&
    reload.panel_replaced === true &&
    guestAttempt(evidence.postreload_retry) &&
    evidence.postreload_retry.revision > evidence.warm_retry.revision &&
    evidence.guest_zero_source_rows_verified_after_real_signin === true &&
    member?.landings === 1 &&
    member.landing_status === 200 &&
    member.organization_matches === true &&
    member.edited_portions_sent === true &&
    evidence.member_retry_queue_cleared === true &&
    persisted?.source_matches === true &&
    persisted.organization_matches === true &&
    persisted.edited_marker_persisted === true
  );
}

export function verifyHostedMemberScrapeSaveReport(report, identity) {
  const o = report?.observations;
  const auth = report?.authentication;
  const artifact = report?.artifact;
  const staleRetry = report?.save_scope === 'stale-profile-retry';
  if (
    report?.schema_version !== 1 ||
    report.feature_id !== 'EXT-F-1007' ||
    report.defect_id !== (staleRetry ? 'EXT-D-0217' : 'EXT-D-0187') ||
    JSON.stringify(report.case_ids) !==
      (staleRetry
        ? '["EXT-F-1007-T05","EXT-F-1007-T22"]'
        : '["EXT-F-1007-T04","EXT-F-1007-T29"]') ||
    report.auth_mode !== 'member' ||
    !(staleRetry
      ? report.destination_mode === 'none'
      : report.save_scope === 'single' && ['none', 'project'].includes(report.destination_mode)) ||
    report.status !== 'pass' ||
    report.stage !== 'complete' ||
    report.native_stage !== 'exercise_panel' ||
    report.failure_stage !== null ||
    report.error_code !== undefined ||
    auth?.mode !== 'member' ||
    !['load_ladder', 'device_choice'].includes(auth.organization_resolution) ||
    [
      'web_signed_in',
      'extension_signed_in',
      'non_admin_role_verified',
      'selected_organization_verified',
    ].some((key) => auth[key] !== true) ||
    artifact?.kind !== 'ci_development_test' ||
    artifact.eligible_store !== false ||
    artifact.source_sha !== identity.sourceSha ||
    String(artifact.run_id) !== identity.developmentRunId ||
    String(artifact.artifact_id) !== identity.developmentArtifactId ||
    !/^[a-f0-9]{64}$/.test(artifact.tree_sha256 ?? '') ||
    artifact.github_artifact_digest !== identity.githubArtifactDigest ||
    artifact.ci_run_attempt !== identity.developmentRunAttempt ||
    [
      'dialog_opened_from_captured_article',
      'prefilled_name_visible',
      'custom_name_entered_by_trusted_keyboard',
      'source_row_read_from_service',
      'custom_name_persisted',
      'organization_scope_persisted',
      'original_file_id_present',
      'saved_original_read_ready',
      'saved_source_reopened_in_ui',
      'cleanup_verified',
    ].some((key) => o?.[key] !== true) ||
    (staleRetry
      ? o?.saved_confirmation_visible !== false || !verifyD217StaleProfileEvidence(o?.d217)
      : o?.saved_confirmation_visible !== true) ||
    ['detail_open', 'name_matches', 'url_matches'].some((key) => o.reopen_header?.[key] !== true) ||
    ['article_title_matches', 'heading_matches', 'marker_matches'].some(
      (key) => o.capture?.[key] !== true || o.saved_original?.[key] !== true,
    ) ||
    ['heading_matches', 'marker_matches'].some((key) => o.reopen_ui?.[key] !== true) ||
    (report.destination_mode === 'project'
      ? o.owned_project_fixture_created !== true ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          o.project_id ?? '',
        ) ||
        o.project_selected_in_save_dialog !== true ||
        o.project_matches_selected_organization !== true ||
        o.selected_project_edge_persisted !== true ||
        o.no_destination_associations_persisted === true ||
        report.project_cleanup?.verified !== true ||
        report.project_cleanup.owned_project_absent !== true
      : o.owned_project_fixture_created !== false ||
        o.project_id !== null ||
        o.no_destination_associations_persisted !== true ||
        o.selected_project_edge_persisted === true ||
        report.project_cleanup !== undefined) ||
    report.cleanup?.verified !== true ||
    report.cleanup.run_owned_source_soft_deleted !== true ||
    report.cleanup.source_associations_removed !== true
  )
    refuse('HOSTED_MEMBER_SCRAPE_REPORT_INVALID');
  return true;
}

export function verifyHostedMemberScrapeSaveDispatchDestination(log, destination) {
  const observed = [
    ...log.matchAll(
      /^guest\tRequire bounded lane and isolate shared credentials\t\S+ {3}SCRAPE_SAVE_DESTINATION: ([^\r\n]*)\r?$/gm,
    ),
  ];
  if (observed.length !== 1) refuse('HOSTED_MEMBER_SCRAPE_DESTINATION_UNVERIFIED');
  if (!['none', 'project'].includes(observed[0][1]))
    refuse('HOSTED_MEMBER_SCRAPE_DESTINATION_UNVERIFIED');
  if (observed[0][1] !== destination) refuse('HOSTED_MEMBER_SCRAPE_DESTINATION_MISMATCH');
  return observed[0][1];
}

export function verifyHostedMemberScrapeSaveDispatchScope(log, scope) {
  const observed = [
    ...log.matchAll(
      /^guest\tRequire bounded lane and isolate shared credentials\t\S+ {3}SCRAPE_SAVE_SCOPE: ([^\r\n]*)\r?$/gm,
    ),
  ];
  if (observed.length !== 1) refuse('HOSTED_MEMBER_SCRAPE_SCOPE_UNVERIFIED');
  if (!['single', 'stale-profile-retry'].includes(observed[0][1]))
    refuse('HOSTED_MEMBER_SCRAPE_SCOPE_UNVERIFIED');
  if (observed[0][1] !== scope) refuse('HOSTED_MEMBER_SCRAPE_SCOPE_MISMATCH');
  return observed[0][1];
}

export function verifyHostedScrapeReport(report, identity) {
  const a = report?.artifact;
  const o = report?.observations;
  const imported = report?.imported_artifact;
  if (
    report?.schema_version !== 1 ||
    report.feature_id !== 'EXT-F-1007' ||
    report.case_id !== 'EXT-F-1007-T08' ||
    report.subtarget !== 'guest_no_signal_seo_and_empty_schema_panes' ||
    report.auth_mode !== 'guest' ||
    report.status !== 'pass' ||
    report.stage !== 'complete' ||
    report.failure_code !== null ||
    a?.kind !== 'ci_development_test' ||
    a.source_sha !== identity.sourceSha ||
    String(a.run_id) !== identity.developmentRunId ||
    String(a.artifact_id) !== identity.developmentArtifactId ||
    !/^[a-f0-9]{64}$/.test(a.tree_sha256 ?? '') ||
    imported?.kind !== 'ci_development_test' ||
    imported.eligibleStore !== false ||
    imported.sourceSha !== identity.sourceSha ||
    String(imported.runId) !== identity.developmentRunId ||
    String(imported.artifactId) !== identity.developmentArtifactId ||
    imported.runAttempt !== identity.developmentRunAttempt ||
    imported.githubArtifactDigest !== identity.githubArtifactDigest ||
    imported.treeSha256 !== a.tree_sha256 ||
    report.build?.before?.treeSha256 !== a.tree_sha256 ||
    report.build?.after?.treeSha256 !== a.tree_sha256 ||
    o?.case_id !== report.case_id ||
    o.subtarget !== report.subtarget ||
    o.seo?.visible !== true ||
    o.seo.selected !== 'SEO' ||
    o.seo.title_matches !== true ||
    o.seo.description_dash !== true ||
    !Array.isArray(o.seo.groups) ||
    !o.seo.groups.includes('Title & description') ||
    o.seo.groups.some((group) => !['Title & description', 'Performance'].includes(group)) ||
    o.schema?.visible !== true ||
    o.schema.selected !== 'Schema' ||
    o.schema.json_valid !== true ||
    o.schema.metadata_title_matches !== true ||
    o.schema.description_absent !== true ||
    o.schema.canonical_absent !== true ||
    ['og_count', 'twitter_count', 'schema_types_count', 'ld_json_count'].some(
      (key) => o.schema[key] !== 0,
    ) ||
    !Array.isArray(o.export_checks) ||
    o.export_checks.length !== 2 ||
    o.export_checks.some(
      (check, i) =>
        check.after_pane !== ['SEO', 'Schema'][i] ||
        check.identity_unchanged !== true ||
        check.digest_unchanged !== true,
    ) ||
    ['seo_no_signal_baseline', 'schema_empty', 'capture_export_unchanged_after_each_pane'].some(
      (key) => o.verdict?.[key] !== true,
    ) ||
    typeof report.native_target?.target_id !== 'string' ||
    !report.native_target.target_id ||
    report.native_target.type !== 'page' ||
    !/^chrome-extension:\/\/[a-p]{32}\/sidepanel\.html$/.test(report.native_target.url ?? '') ||
    report.capture_diagnostic?.events?.trusted_capture_click !== 1 ||
    report.panel_viewport?.mechanism !== 'native_default' ||
    !(report.panel_viewport.observed_px > 0)
  )
    refuse('HOSTED_SCRAPE_NATIVE_REPORT_PROVENANCE_INVALID');
  return true;
}

/** Member account-popover only; preserve the normal exact-source and lane-A gates. */
export function planHostedSettingsMember({ lane, acceptanceCase, runnerLabel, ...input }) {
  if (lane !== 'A') refuse('HOSTED_SETTINGS_MEMBER_LANE_REFUSED');
  if (acceptanceCase !== 'settings-account-popover-member')
    refuse('HOSTED_SETTINGS_MEMBER_CASE_REFUSED');
  if (runnerLabel !== 'macos-15-intel') refuse('HOSTED_SETTINGS_MEMBER_RUNNER_REFUSED');
  if (!SHA.test(input.sourceSha ?? '')) refuse('HOSTED_SOURCE_SHA_INVALID');
  const plan = planHostedMemberData({ ...input, lane });
  // Settings authenticates from acceptance_case; this generic Scrape field stays guest.
  return {
    ...plan,
    args: plan.args
      .map((arg) =>
        arg === 'acceptance_case=member-data'
          ? `acceptance_case=${acceptanceCase}`
          : arg === 'scrape_auth_mode=member'
            ? 'scrape_auth_mode=guest'
            : arg,
      )
      .filter(
        (arg, index, args) =>
          arg !== 'member_data_scope=auto-extract' &&
          !(arg === '-f' && args[index + 1] === 'member_data_scope=auto-extract'),
      )
      .concat(['-f', 'runner_label=macos-15-intel']),
  };
}

export function requireSettingsMemberDispatchAdmission({
  localSha,
  remoteSha,
  sourceSha,
  dirty,
  runs,
  secretNames,
}) {
  requireExactDispatchSource(
    localSha,
    remoteSha,
    dirty,
    sourceSha,
    'HOSTED_SETTINGS_MEMBER_SOURCE_DRIFT',
  );
  if (
    !Array.isArray(runs) ||
    runs.some((run) => run.status !== 'completed' && !/^Native B · /.test(run.name ?? ''))
  )
    refuse('HOSTED_SETTINGS_MEMBER_A_CAPACITY_REFUSED');
  if (!Array.isArray(secretNames) || !secretNames.includes('MATRX_REVIEWER_MAGIC_LINK_JSON'))
    refuse('HOSTED_SETTINGS_MEMBER_SECRET_MISSING');
  return true;
}

/** Reviewed guest Settings cases on the isolated B lane, from one frozen CI development artifact. */
export function planHostedSettingsGuest({ lane, acceptanceCase, runnerLabel, ...input }) {
  if (lane !== 'B') refuse('HOSTED_SETTINGS_GUEST_LANE_REFUSED');
  if (
    !['settings-controls', 'settings-guest-admin-absence', 'settings-auto-scrape-capture'].includes(
      acceptanceCase,
    )
  )
    refuse('HOSTED_SETTINGS_GUEST_CASE_REFUSED');
  if (runnerLabel !== 'macos-15-intel') refuse('HOSTED_SETTINGS_GUEST_RUNNER_REFUSED');
  if (!SHA.test(input.sourceSha ?? '')) refuse('HOSTED_SOURCE_SHA_INVALID');
  planHostedMemberData({ ...input, lane: 'A' });
  return {
    command: 'gh',
    args: [
      'workflow',
      'run',
      'hosted-guest-acceptance.yml',
      '--ref',
      'main',
      ...[
        'acceptance_lane=B',
        `acceptance_case=${acceptanceCase}`,
        `requested_by=${DISPATCH_REQUESTER}`,
        'scrape_auth_mode=guest',
        'runner_label=macos-15-intel',
        `development_run_id=${input.developmentRunId}`,
        `development_artifact_id=${input.developmentArtifactId}`,
      ].flatMap((field) => ['-f', field]),
    ],
  };
}

export function requireSettingsGuestDispatchAdmission({
  localSha,
  remoteSha,
  sourceSha,
  dirty,
  runs,
}) {
  requireExactDispatchSource(
    localSha,
    remoteSha,
    dirty,
    sourceSha,
    'HOSTED_SETTINGS_GUEST_SOURCE_DRIFT',
  );
  if (
    !Array.isArray(runs) ||
    runs.some((run) => run.status !== 'completed' && !/^Native A · /.test(run.name ?? ''))
  )
    refuse('HOSTED_SETTINGS_GUEST_B_CAPACITY_REFUSED');
  return true;
}

// The current native driver records no imported_artifact. Authenticated logs from the
// same successful workflow bind its frozen CI import; never infer provenance from null.
export function verifyHostedSettingsMemberLog(log, identity) {
  if (
    typeof log !== 'string' ||
    log.length > 8_000_000 ||
    !SHA.test(identity.sourceSha ?? '') ||
    !DECIMAL.test(identity.developmentRunId ?? '') ||
    !DECIMAL.test(String(identity.developmentRunAttempt ?? '')) ||
    !DECIMAL.test(identity.artifactId ?? '') ||
    !/^sha256:[a-f0-9]{64}$/.test(identity.githubArtifactDigest ?? '')
  )
    refuse('HOSTED_SETTINGS_MEMBER_LOG_INVALID');
  // gh --log prefixes each line with job, step and ISO timestamp. Match full payloads only.
  const payloads = log
    .split('\n')
    .map(
      (line) =>
        line.match(
          /^[^\t\r\n]+\tExercise the selected Chrome side-panel case\t\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d+Z (.*)$/,
        )?.[1] ?? '',
    );
  const imported = payloads.filter((line) => line.startsWith('DEVELOPMENT_TEST_IMPORTED '));
  const prepared = payloads.filter((line) => line.startsWith('PREPARED_DEVELOPMENT '));
  const importPattern = new RegExp(
    `^DEVELOPMENT_TEST_IMPORTED /[^\\s]+/test-results/ci-artifacts/${identity.sourceSha}/${identity.developmentRunId}-${identity.developmentRunAttempt} (?:current_pushed_source|exact_pushed_commit_only)$`,
  );
  const preparePattern = new RegExp(`^PREPARED_DEVELOPMENT ${identity.sourceSha} ([a-f0-9]{64})$`);
  if (
    imported.length !== 1 ||
    !importPattern.test(imported[0]) ||
    prepared.length !== 1 ||
    !preparePattern.test(prepared[0]) ||
    payloads.indexOf(imported[0]) >= payloads.indexOf(prepared[0])
  )
    refuse('HOSTED_SETTINGS_MEMBER_LOG_PROVENANCE_INVALID');
  return { treeSha256: prepared[0].match(preparePattern)[1] };
}

export function verifyHostedSettingsMemberReport(report) {
  const cases = report?.cases;
  const signedIn = (state) =>
    state?.accessTokenPresent === true && state.profilePresent === true && state.isAdmin === false;
  const guest = (state) =>
    state?.accessTokenPresent === false && state.profilePresent === false && state.isAdmin !== true;
  const menu = (state, profile, guestHeader) =>
    state?.triggerCount === 1 &&
    state.triggerState === 'open' &&
    state.contentState === 'open' &&
    state.wrapperCount === 1 &&
    state.openDialogCount === 1 &&
    state.profile === profile &&
    state.preferences === 1 &&
    state.signOut === 1 &&
    state.guestHeader === guestHeader;
  const profile = cases?.[0]?.observations;
  const preferences = cases?.[1]?.observations;
  const signOut = cases?.[2]?.observations;
  if (
    report?.schema_version !== 1 ||
    report.role !== 'member' ||
    report.status !== 'pass' ||
    report.failure !== undefined ||
    report.build?.kind !== 'local_dev_unpacked' ||
    report.build.sourceSha !== null ||
    !signedIn(report.identity_before) ||
    !Array.isArray(cases) ||
    cases.length !== 3 ||
    cases.some(
      (row, index) =>
        row.id !== ['EXT-F-1001-T20', 'EXT-F-1001-T23', 'EXT-F-1001-T26'][index] ||
        row.status !== 'pass',
    ) ||
    !Array.isArray(profile) ||
    profile.length !== 2 ||
    !menu(profile[0]?.menu, 1, false) ||
    !signedIn(profile[1]?.identity) ||
    profile[1]?.destination?.activePaneCount !== 1 ||
    profile[1].destination.profilePaneCount !== 1 ||
    profile[1].destination.backCount !== 1 ||
    profile[1].destination.saveCount !== 1 ||
    !Array.isArray(preferences) ||
    preferences.length !== 1 ||
    !signedIn(preferences[0]?.identity) ||
    preferences[0]?.selected?.count !== 1 ||
    preferences[0].selected.title !== 'Settings' ||
    preferences[0].selected.paneActive !== true ||
    !Array.isArray(signOut) ||
    signOut.length !== 2 ||
    !guest(signOut[0]?.guest) ||
    !menu(signOut[0]?.reopenedMenu, 0, true) ||
    !guest(signOut[1]?.persistedGuest) ||
    !menu(signOut[1]?.persistedMenu, 0, true)
  )
    refuse('HOSTED_SETTINGS_MEMBER_NATIVE_REPORT_INVALID');
  return true;
}

/** Normal member Notes cases only; CDP startup diagnostics have no acceptance route. */
export function planHostedNotes({ lane, acceptanceCase, runnerLabel, ...input }) {
  if (lane !== 'A') refuse('HOSTED_NOTES_LANE_REFUSED');
  if (!['notes-find-member', 'notes-lazy-general-member'].includes(acceptanceCase))
    refuse('HOSTED_NOTES_CASE_REFUSED');
  if (runnerLabel !== 'macos-15-intel') refuse('HOSTED_NOTES_RUNNER_REFUSED');
  if (!SHA.test(input.sourceSha ?? '')) refuse('HOSTED_SOURCE_SHA_INVALID');
  // Reuse the existing artifact-id, main-ref and reviewed workflow guards.
  planHostedMemberData({ ...input, lane });
  return {
    command: 'gh',
    args: [
      'workflow',
      'run',
      'hosted-guest-acceptance.yml',
      '--ref',
      'main',
      ...[
        'acceptance_lane=A',
        `acceptance_case=${acceptanceCase}`,
        `requested_by=${DISPATCH_REQUESTER}`,
        'scrape_auth_mode=member',
        'runner_label=macos-15-intel',
        'startup_display_mode=headed',
        `development_run_id=${input.developmentRunId}`,
        `development_artifact_id=${input.developmentArtifactId}`,
      ].flatMap((field) => ['-f', field]),
    ],
  };
}

// Only records and this reviewed dispatcher may advance beyond the frozen product.
// Harness, workflow, policy, dependency and application changes require a new CI artifact.
const NOTES_NON_RUNTIME_PATH =
  /^(?:scripts\/hosted-remote-(?:admission|notes-admission)(?:\.test)?\.mjs|docs\/stabilization\/(?:runs\/[^/]+\.json|resource-journals\/[^/]+\.jsonl|[^/]+\.(?:md|html|txt)|inventory\.json|(?:defects|reports|evidence)\/(?:[^/]+\/)*[^/]+\.(?:json|jsonl|md|html|txt|log|png|jpg|jpeg|webp)))$/;
export function requireNotesDispatchAdmission({
  localSha,
  remoteSha,
  dirty,
  sourceSha,
  ancestor,
  changedPaths,
  runs,
  secretNames,
}) {
  requireSynchronizedDispatchSource(localSha, remoteSha, dirty);
  if (
    !SHA.test(sourceSha ?? '') ||
    ancestor !== true ||
    !Array.isArray(changedPaths) ||
    changedPaths.some((path) => !NOTES_NON_RUNTIME_PATH.test(path))
  )
    refuse('HOSTED_NOTES_RUNTIME_SOURCE_DRIFT');
  if (
    !Array.isArray(runs) ||
    runs.some((run) => run.status !== 'completed' && !/^Native B · /.test(run.name ?? ''))
  )
    refuse('HOSTED_NOTES_A_CAPACITY_REFUSED');
  if (!Array.isArray(secretNames) || !secretNames.includes('MATRX_REVIEWER_MAGIC_LINK_JSON'))
    refuse('HOSTED_NOTES_MEMBER_SECRET_MISSING');
  return true;
}

export function verifyHostedNotesReport(report, identity) {
  const artifact = report?.imported_artifact;
  const t02 = report?.observations?.T02;
  const observations = t02?.observations;
  const auth = report?.observations?.hosted_authentication;
  if (
    report?.schema_version !== 1 ||
    report.status !== 'pass' ||
    report.role !== 'member' ||
    report.observations?.startup_endpoint !== undefined ||
    JSON.stringify(report.cases) !== '["EXT-F-2006-T02"]' ||
    report.failure_code !== undefined ||
    !/^[a-p]{32}$/.test(report.extension_id ?? '') ||
    auth?.member_signed_in !== true ||
    auth.non_admin_identity !== true ||
    auth.organization_selected !== true ||
    t02?.case_id !== 'EXT-F-2006-T02' ||
    t02.verdict !== 'pass' ||
    t02.failure_code !== undefined ||
    t02.cleanup_complete !== true ||
    (t02.cleanup_pending?.length ?? 0) !== 0 ||
    !Array.isArray(t02.home_cleanup_pending) ||
    t02.home_cleanup_pending.length !== 0 ||
    !Array.isArray(t02.cleanup) ||
    t02.cleanup.length !== 3 ||
    new Set(t02.cleanup.map((row) => row.note_id)).size !== 3 ||
    t02.cleanup.some(
      (row) =>
        // This dispatcher also runs before package installation in resource-guard CI.
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(row.note_id ?? '') ||
        row.live_delete !== true ||
        row.editor_title_confirmed !== true ||
        !Number.isInteger(row.response_status) ||
        row.response_status < 200 ||
        row.response_status >= 300,
    ) ||
    observations?.search_by_unique_title?.matches !== 3 ||
    observations.search_by_unique_title.only_run_titles !== true ||
    observations.all_homes_filter?.selected !== true ||
    observations.all_homes_filter.owned_fixture_count !== 3 ||
    observations.named_home_filter_1?.one_owned_note !== true ||
    observations.named_home_filter_2?.one_owned_note !== true ||
    observations.note_selector_open !== true ||
    observations.note_row_open !== true ||
    observations.general_default_fixture !== true ||
    artifact?.kind !== 'ci_development_test' ||
    artifact.eligibleStore !== false ||
    artifact.repository !== OWNER ||
    artifact.workflow !== '.github/workflows/ci.yml' ||
    artifact.sourceSha !== identity.sourceSha ||
    String(artifact.runId) !== identity.developmentRunId ||
    String(artifact.artifactId) !== identity.developmentArtifactId ||
    artifact.runAttempt !== Number(identity.developmentRunAttempt) ||
    !/^sha256:[a-f0-9]{64}$/.test(artifact.githubArtifactDigest ?? '') ||
    artifact.githubArtifactDigest !== identity.githubArtifactDigest ||
    !/^[a-f0-9]{64}$/.test(artifact.treeSha256 ?? '') ||
    report.build?.before?.treeSha256 !== artifact.treeSha256 ||
    report.build?.after?.treeSha256 !== artifact.treeSha256
  )
    refuse('HOSTED_NOTES_NATIVE_REPORT_PROVENANCE_INVALID');
  return true;
}

/** D201 picker only; this verdict never implies T02 search, move, or cleanup coverage. */
export function verifyHostedNotesLazyGeneralReport(report, identity) {
  const artifact = report?.imported_artifact;
  const auth = report?.observations?.hosted_authentication;
  const d201 = report?.observations?.D201;
  if (
    report?.schema_version !== 1 ||
    report.status !== 'pass' ||
    report.role !== 'member' ||
    JSON.stringify(report.cases) !== '["EXT-D-0201-picker"]' ||
    report.observations?.T02 !== undefined ||
    report.observations?.startup_endpoint !== undefined ||
    report.failure_code !== undefined ||
    !/^[a-p]{32}$/.test(report.extension_id ?? '') ||
    auth?.member_signed_in !== true ||
    auth.non_admin_identity !== true ||
    auth.organization_selected !== true ||
    d201?.case_id !== 'EXT-D-0201-picker' ||
    d201.verdict !== 'pass' ||
    d201.failure_code !== undefined ||
    d201.observations?.before?.canonical_general_nullable !== true ||
    d201.observations.before.general_scope_absent !== true ||
    d201.observations.before.selected_organization_confirmed !== true ||
    d201.observations.picker?.synthetic_general_visible !== true ||
    d201.observations.picker.selected_as_filter !== true ||
    d201.observations.picker.selection_stable !== true ||
    d201.observations.after?.canonical_general_nullable !== true ||
    d201.observations.after.general_scope_absent !== true ||
    d201.observations.after.unexpected_write_requests !== 0 ||
    artifact?.kind !== 'ci_development_test' ||
    artifact.eligibleStore !== false ||
    artifact.repository !== OWNER ||
    artifact.workflow !== '.github/workflows/ci.yml' ||
    artifact.sourceSha !== identity.sourceSha ||
    String(artifact.runId) !== identity.developmentRunId ||
    String(artifact.artifactId) !== identity.developmentArtifactId ||
    artifact.runAttempt !== Number(identity.developmentRunAttempt) ||
    !/^sha256:[a-f0-9]{64}$/.test(artifact.githubArtifactDigest ?? '') ||
    artifact.githubArtifactDigest !== identity.githubArtifactDigest ||
    !/^[a-f0-9]{64}$/.test(artifact.treeSha256 ?? '') ||
    report.build?.before?.treeSha256 !== artifact.treeSha256 ||
    report.build?.after?.treeSha256 !== artifact.treeSha256
  )
    refuse('HOSTED_NOTES_LAZY_GENERAL_REPORT_INVALID');
  return true;
}

/** Chrome may first announce a panel target before its URL identifies it as our document. */
export function memberDataReplacementPanelProofBasis(lifecycle) {
  const timeline = lifecycle?.timeline;
  const entries = timeline?.entries;
  const final = timeline?.final_snapshot;
  if (!Array.isArray(entries) || !Array.isArray(final) || timeline.dropped_entries !== 0)
    return null;
  // Every producer channel is part of the proof, including polling snapshots.
  // Validate the recorded clock before selecting evidence so a later event cannot
  // hide an earlier malformed or contradictory observation.
  const instants = entries.map((entry) =>
    typeof entry?.at === 'string' ? Date.parse(entry.at) : Number.NaN,
  );
  if (instants.some((at, index) => !Number.isFinite(at) || (index > 0 && at < instants[index - 1])))
    return null;
  const snapshotPhases = ['initial_snapshot', 'pre_click_snapshot', 'poll_transition'];
  const eventPhases = ['target_created', 'target_info_changed', 'target_destroyed'];
  if (
    entries.some(
      (entry) =>
        (snapshotPhases.includes(entry.phase) && !Array.isArray(entry.targets)) ||
        (eventPhases.includes(entry.phase) && !entry.target),
    )
  )
    return null;
  const observations = entries.flatMap((entry, index) =>
    [
      ...(entry.target ? [entry.target] : []),
      ...(Array.isArray(entry.targets) ? entry.targets : []),
    ].map((target) => ({ target, index, at: instants[index], phase: entry.phase })),
  );
  const validTarget = (target) =>
    target &&
    typeof target.target_id === 'string' &&
    target.target_id &&
    (target.kind !== 'panel' || target.type === 'page') &&
    (target.kind !== 'worker' || target.type === 'service_worker');
  if (
    !final.every(validTarget) ||
    observations.some(({ target }) => !validTarget(target)) ||
    new Set(final.map((target) => target.target_id)).size !== final.length
  )
    return null;
  const preClickIndex = entries.findIndex((entry) => entry.phase === 'pre_click_snapshot');
  const clickIndex = entries.findIndex(
    (entry, index) => index > preClickIndex && entry.phase === 'click_started',
  );
  const preClick = entries[preClickIndex];
  const clickAt = Date.parse(entries[clickIndex]?.at);
  if (
    preClickIndex < 0 ||
    clickIndex < 0 ||
    !Number.isFinite(clickAt) ||
    !Number.isFinite(Date.parse(preClick.at)) ||
    // The entry indices establish strict order; Date timestamps have only
    // millisecond precision, so adjacent events may have equal instants.
    Date.parse(preClick.at) > clickAt ||
    !Array.isArray(preClick.targets) ||
    timeline.pre_click_old_worker_present !== true ||
    !preClick.targets.some(
      (target) => target.target_id === timeline.old_worker_id && target.kind === 'worker',
    ) ||
    !preClick.targets.some(
      (target) => target.target_id === timeline.old_panel_id && target.kind === 'panel',
    )
  )
    return null;
  const panels = final.filter((target) => target.kind === 'panel' && target.type === 'page');
  if (panels.length !== 1) return null;
  const replacementId = panels[0].target_id;
  if (
    typeof replacementId !== 'string' ||
    !replacementId ||
    replacementId === timeline.old_panel_id ||
    preClick.targets.some((target) => target.target_id === replacementId) ||
    final.some(
      (target) =>
        target.target_id === timeline.old_panel_id || target.target_id === timeline.old_worker_id,
    ) ||
    !final.some(
      (target) => target.kind === 'worker' && target.target_id === timeline.replacement_worker_id,
    )
  )
    return null;
  const destroyedIndex = entries.findIndex(
    (entry, index) =>
      index > clickIndex &&
      entry.phase === 'target_destroyed' &&
      entry.target?.target_id === timeline.old_panel_id &&
      entry.target.kind === 'panel' &&
      entry.target.type === 'page' &&
      Number.isFinite(Date.parse(entry.at)) &&
      Date.parse(entry.at) >= clickAt,
  );
  if (destroyedIndex < 0) return null;
  const destroyedAt = Date.parse(entries[destroyedIndex].at);
  const matchesReplacement = (entry, phase) =>
    entry.phase === phase &&
    entry.target?.target_id === replacementId &&
    entry.target.kind === 'panel' &&
    entry.target.type === 'page';
  const materializations = observations.filter(
    ({ target }) =>
      target.target_id === replacementId && target.kind === 'panel' && target.type === 'page',
  );
  if (
    !materializations.length ||
    materializations.some(
      ({ index, at, phase }) =>
        index <= destroyedIndex || at < destroyedAt || phase === 'target_destroyed',
    )
  )
    return null;
  const afterRetirement = entries.slice(destroyedIndex + 1);
  if (
    lifecycle.replacement_panel_created_event === false &&
    entries.some((entry) => matchesReplacement(entry, 'target_created'))
  )
    return null;
  if (
    lifecycle.replacement_panel_created_event === true &&
    afterRetirement.some((entry) => matchesReplacement(entry, 'target_created'))
  )
    return 'created_event';
  if (
    lifecycle.replacement_panel_created_event === false &&
    afterRetirement.some((entry) => matchesReplacement(entry, 'target_info_changed'))
  )
    return 'correlated_panel_materialization';
  return null;
}

/** T03 uses the production callback as ingress evidence; diagnostic worker hooks are refused. */
export function verifyHostedMemberDataLifecycleReport(report, identity) {
  const o = report?.observations;
  const lifecycle = report?.reload_lifecycle;
  const request = lifecycle?.open_panel_request;
  const fixture = request?.fixture;
  const timeline = lifecycle?.timeline;
  const auth = report?.authentication;
  if (
    report?.schema_version !== 1 ||
    report.case_id !== 'EXT-F-2005-T03' ||
    report.auth_mode !== 'member' ||
    report.status !== 'pass' ||
    report.stage !== 'complete' ||
    report.failure_stage !== null ||
    report.error_code !== undefined ||
    report.reload_open_diagnostic?.enabled !== false ||
    report.reload_sender_document_diagnostic?.enabled !== false ||
    lifecycle?.open_panel_diagnostic != null ||
    auth?.mode !== 'member' ||
    [
      'web_signed_in',
      'extension_signed_in',
      'non_admin_identity_verified',
      'canonical_nonadmin_check_passed',
      'organization_selected',
      'selected_organization_id_verified',
    ].some((key) => auth[key] !== true) ||
    !['load_ladder', 'device_choice'].includes(auth.organization_resolution) ||
    report.artifact?.source_sha !== identity.sourceSha ||
    String(report.artifact?.run_id) !== identity.developmentRunId ||
    String(report.artifact?.artifact_id) !== identity.developmentArtifactId ||
    !/^[a-f0-9]{64}$/.test(report.artifact?.tree_sha256 ?? '') ||
    report.runtime_tree_after !== report.artifact.tree_sha256 ||
    [
      'two_distinct_previews',
      'save_pattern_visible',
      'pattern_name_visible',
      'saved_row_lookup_verified',
      'request_body_organization_present',
      'request_body_organization_matched_selected',
      'request_header_organization_matched_body',
      'request_header_organization_matched_selected',
      'saved_pattern_refreshed',
      'saved_pattern_run_before_reload',
      'saved_pattern_run_after_reload',
      'cancel_cleared_unsaved_selection',
      'reload_replacement_adopted',
      'saved_pattern_survived_extension_reload',
      'member_save_succeeded',
    ].some((key) => o?.[key] !== true) ||
    o?.pattern_write_requests !== 1 ||
    o.pattern_write_status !== 201 ||
    ['before_reload', 'after_reload'].some((phase) =>
      [
        'tsv_matches_fixture',
        'json_matches_fixture',
        'ai_contains_all_fixture_rows',
        'native_copy_feedback_observed',
        'clipboard_readback',
        'observation_permission_restored',
      ].some((key) => o?.[`clipboard_${phase}`]?.[key] !== true),
    ) ||
    lifecycle?.old_worker_absent !== true ||
    lifecycle.old_panel_absent !== true ||
    lifecycle.replacement_worker_present !== true ||
    memberDataReplacementPanelProofBasis(lifecycle) === null ||
    timeline?.final_predicate !== true ||
    !timeline.old_worker_id ||
    !timeline.old_panel_id ||
    !timeline.replacement_worker_id ||
    timeline.old_worker_id === timeline.replacement_worker_id ||
    !timeline.final_snapshot?.some(
      (target) => target.kind === 'panel' && target.target_id !== timeline.old_panel_id,
    ) ||
    report.reload_context?.exact_expected_appeared !== true ||
    request?.received !== true ||
    request.ok !== true ||
    request.opened !== true ||
    request.category !== 'opened' ||
    fixture?.availability !== 'ready' ||
    fixture.click_received !== true ||
    fixture.send_invoked !== true ||
    fixture.send_returned !== true ||
    fixture.callback_entered !== true ||
    fixture.callback_has_reply !== true ||
    fixture.callback_last_error !== false ||
    fixture.send_threw !== false ||
    report.cleanup?.verified !== true ||
    report.cleanup.deleted_rows !== 1 ||
    report.cleanup.exact_owned_name_organization_lookup !== true ||
    report.cleanup.active_rows_after_delete !== 0
  )
    refuse('HOSTED_MEMBER_DATA_LIFECYCLE_REPORT_INVALID');
  return true;
}

export function requireMemberDataSecretCleanup(secretNames) {
  if (!Array.isArray(secretNames) || secretNames.includes('MATRX_REVIEWER_MAGIC_LINK_JSON'))
    refuse('HOSTED_MEMBER_DATA_SECRET_CLEANUP_UNVERIFIED');
  return true;
}

export function requireMemberDataDispatchAdmission({
  localSha,
  remoteSha,
  sourceSha,
  artifactSourceSha = sourceSha,
  dirty,
  runs,
  secretNames,
}) {
  requireSynchronizedDispatchSource(localSha, remoteSha, dirty);
  if (sourceSha !== remoteSha) refuse('HOSTED_MEMBER_DATA_SOURCE_DRIFT');
  if (artifactSourceSha !== sourceSha) {
    let compatibility;
    try {
      compatibility = sourceCompatibility(process.cwd(), artifactSourceSha);
    } catch {
      refuse('HOSTED_MEMBER_DATA_SOURCE_DRIFT');
    }
    if (compatibility.mainSha !== sourceSha) refuse('HOSTED_MEMBER_DATA_SOURCE_DRIFT');
  }
  if (
    !Array.isArray(runs) ||
    runs.some((run) => run.status !== 'completed' && !/^Native B · /.test(run.name ?? ''))
  )
    refuse('HOSTED_MEMBER_DATA_A_CAPACITY_REFUSED');
  if (!Array.isArray(secretNames) || !secretNames.includes('MATRX_REVIEWER_MAGIC_LINK_JSON'))
    refuse('HOSTED_MEMBER_DATA_SECRET_MISSING');
  return true;
}

export function requireSynchronizedDispatchSource(localSha, remoteSha, dirty) {
  if (!SHA.test(localSha ?? '') || localSha !== remoteSha || dirty)
    refuse('HOSTED_DISPATCH_SOURCE_NOT_SYNCHRONIZED');
  return true;
}

export function requireExactDispatchSource(localSha, remoteSha, dirty, sourceSha, driftCode) {
  requireSynchronizedDispatchSource(localSha, remoteSha, dirty);
  if (sourceSha !== remoteSha) refuse(driftCode);
  return true;
}

/** A successful child is not a resource verdict; each hosted final must prove admission and watch. */
export function verifyHostedResourceJournals({ runId, attempt, files }) {
  if (!DECIMAL.test(runId ?? '') || !DECIMAL.test(attempt ?? '')) refuse('HOSTED_RUN_ID_INVALID');
  if (!files || typeof files !== 'object') refuse('HOSTED_JOURNALS_MISSING');
  const expected = PHASES.map((prefix) => `${prefix}-${runId}-${attempt}.jsonl`);
  for (const prefix of PHASES) {
    if (Object.hasOwn(files, `${prefix}-${runId}-${attempt}.pending.jsonl`))
      refuse('HOSTED_JOURNAL_PENDING');
  }
  if (Object.keys(files).some((name) => !expected.includes(name))) refuse('HOSTED_JOURNAL_FOREIGN');
  const receipts = {};
  for (const prefix of PHASES) {
    const id = `${prefix}-${runId}-${attempt}`;
    const name = `${id}.jsonl`;
    if (!Object.hasOwn(files, name)) refuse('HOSTED_JOURNAL_MISSING');
    const source = files[name];
    sanitizeHostedResourceJournal(source, id);
    const events = source
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    if (events[0]?.code !== 'RESOURCE_JOURNAL_OPENED') refuse('HOSTED_JOURNAL_OPEN_MISSING');
    const admitted = events.findIndex((e) => e.code === 'RESOURCE_ADMITTED' && e.mode === 'run');
    // CPU pending/recovered are emitted by the same periodic guard sample as
    // RESOURCE_WATCH_*; a valid run may contain only CPU-episode samples.
    const watched = events.findIndex(
      (e, i) =>
        i > admitted &&
        (e.code.startsWith('RESOURCE_WATCH_') ||
          ((e.code === 'RESOURCE_CPU_PENDING' || e.code === 'RESOURCE_CPU_RECOVERED') &&
            Array.isArray(e.reasons) &&
            Number.isFinite(e.sample?.cpuBusyFraction))),
    );
    const exited = events.findIndex(
      (e, i) => i > admitted && e.code === 'RESOURCE_JOB_EXIT' && e.childExitCode === 0,
    );
    const elapsed = Date.parse(events[exited]?.at) - Date.parse(events[admitted]?.at);
    const watchedAt = Date.parse(events[watched]?.at);
    if (
      admitted < 1 ||
      exited < 0 ||
      !Number.isFinite(elapsed) ||
      elapsed < 0 ||
      (elapsed >= RESOURCE_POLICY.watchIntervalSeconds * 1000 &&
        (watched < 0 ||
          watched >= exited ||
          !Number.isFinite(watchedAt) ||
          watchedAt <= Date.parse(events[admitted]?.at) ||
          watchedAt >= Date.parse(events[exited]?.at)))
    )
      refuse('HOSTED_JOURNAL_EVIDENCE_MISSING');
    if (events.at(-1)?.decision !== 'valid') refuse('HOSTED_JOURNAL_NOT_VALID');
    receipts[prefix] = {
      runId: id,
      sha256: createHash('sha256').update(source).digest('hex'),
      decision: 'valid',
    };
  }
  return { valid: true, receipts };
}

function argsMap(argv) {
  const map = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith('--') || !argv[i + 1] || map.has(argv[i]))
      refuse('HOSTED_ARGUMENT_INVALID');
    map.set(argv[i], argv[i + 1]);
  }
  return map;
}
function ghJson(endpoint) {
  return JSON.parse(
    execFileSync('gh', ['api', endpoint], { encoding: 'utf8', maxBuffer: 4_000_000 }),
  );
}
export function requireDevelopmentArtifact(
  {
    runId,
    artifactId,
    sourceSha,
    expectedDigest,
    allowRuntimeEquivalent = false,
    repoRoot = process.cwd(),
  },
  fetchJson = ghJson,
) {
  if (!DECIMAL.test(runId ?? '') || !DECIMAL.test(artifactId ?? '') || !SHA.test(sourceSha ?? ''))
    refuse('HOSTED_ARTIFACT_ID_INVALID');
  const run = fetchJson(`repos/${OWNER}/actions/runs/${runId}`);
  if (
    run.name !== 'CI' ||
    run.path !== '.github/workflows/ci.yml' ||
    run.event !== 'push' ||
    run.head_branch !== 'main' ||
    run.conclusion !== 'success' ||
    !SHA.test(run.head_sha ?? '') ||
    (run.head_sha !== sourceSha && !allowRuntimeEquivalent)
  )
    refuse('HOSTED_DEVELOPMENT_RUN_INVALID');
  let compatibility;
  if (allowRuntimeEquivalent) {
    try {
      compatibility = sourceCompatibility(repoRoot, run.head_sha);
      if (compatibility.mainSha !== sourceSha) refuse('HOSTED_DEVELOPMENT_RUNTIME_SOURCE_DRIFT');
    } catch {
      refuse('HOSTED_DEVELOPMENT_RUNTIME_SOURCE_DRIFT');
    }
  }
  const listing = fetchJson(`repos/${OWNER}/actions/runs/${runId}/artifacts?per_page=100`);
  const matches = listing.artifacts?.filter(
    (artifact) =>
      String(artifact.id) === artifactId &&
      artifact.expired === false &&
      artifact.name === `matrx-extend-development-test-${run.head_sha}-${runId}-${run.run_attempt}`,
  );
  if (matches?.length !== 1 || !/^sha256:[a-f0-9]{64}$/.test(matches[0].digest ?? ''))
    refuse('HOSTED_DEVELOPMENT_ARTIFACT_INVALID');
  if (expectedDigest !== undefined && matches[0].digest !== expectedDigest)
    refuse('HOSTED_DEVELOPMENT_ARTIFACT_DIGEST_MISMATCH');
  return {
    sourceSha: run.head_sha,
    ...(compatibility && {
      mainSha: compatibility.mainSha,
      compatibility: compatibility.compatibility,
      allowedDiffPaths: compatibility.diffPaths,
    }),
    artifactId,
    developmentRunId: runId,
    developmentRunAttempt: run.run_attempt,
    githubArtifactDigest: matches[0].digest,
  };
}

function archiveCommand(bytes, args) {
  if (bytes) {
    const result = spawnSync('bsdtar', args, {
      input: bytes,
      encoding: 'utf8',
      maxBuffer: 4_000_000,
    });
    if (result.status !== 0) refuse('HOSTED_ARCHIVE_READ_FAILED');
    return result.stdout;
  }
  return execFileSync('unzip', args, { encoding: 'utf8', maxBuffer: 4_000_000 });
}
function archiveEntry(zip, bytes, entry) {
  return archiveCommand(bytes, bytes ? ['-xOf', '-', entry] : ['-p', zip, entry]);
}
export function requireExactArchiveJournalSet(entries, runId, attempt) {
  const journalEntries = entries.filter((entry) =>
    /(?:^|\/)docs\/stabilization\/resource-journals\/[^/]+\.jsonl$/.test(entry),
  );
  const expectedNames = PHASES.map((prefix) => `${prefix}-${runId}-${attempt}.jsonl`);
  if (
    journalEntries.length !== PHASES.length ||
    journalEntries.some((entry) => !expectedNames.includes(entry.split('/').at(-1)))
  )
    refuse('HOSTED_ARCHIVE_JOURNAL_SET_INVALID');
  return true;
}
export function verifyHostedGuestSeoReport(
  report,
  { sourceSha, developmentRunId, developmentArtifactId },
) {
  const selected = report?.case_selection;
  const artifact = report?.imported_artifact;
  const target = report?.targets;
  const evidence = target?.[0]?.evidence;
  if (
    report?.schema_version !== 1 ||
    report?.feature_id !== 'EXT-F-1008' ||
    report?.mode !== 'guest' ||
    report?.status !== 'partial' ||
    report?.receipt_state === 'in_progress' ||
    report?.resource_diagnostic_enabled !== false ||
    report?.interruption_test_target !== undefined ||
    report?.evidence_classification !== undefined ||
    selected?.scope !== 'notice-stacked' ||
    !Array.isArray(selected.selected_cases) ||
    selected.selected_cases.length !== 1 ||
    selected.selected_cases[0] !== 'T02' ||
    !Array.isArray(selected.selected_subtargets) ||
    selected.selected_subtargets.length !== 1 ||
    selected.selected_subtargets[0] !== 'multiple_and_long_notice_clearance_at_native_360px' ||
    !Array.isArray(target) ||
    target.length !== 1 ||
    target[0]?.case_id !== 'EXT-F-1008-T02' ||
    target[0]?.subtarget !== 'multiple_and_long_notice_clearance_at_native_360px' ||
    target[0]?.status !== 'pass' ||
    evidence?.viewport_width !== 360 ||
    evidence?.viewport_source !== 'native' ||
    evidence?.notice_count !== 2 ||
    evidence?.long_message_length !== 199 ||
    evidence?.distinct_notice_titles !== 2 ||
    JSON.stringify(evidence?.visible_dismiss_counts) !== '[1,1]' ||
    evidence?.target_hit_points !== 9 ||
    evidence?.notice_hit_points !== 0 ||
    evidence?.current_title_matched !== true ||
    JSON.stringify(evidence?.independently_dismissed) !== '[[0,1],[0,0]]' ||
    evidence?.cleared_count !== 0 ||
    artifact?.kind !== 'ci_development_test' ||
    artifact?.eligibleStore !== false ||
    artifact?.repository !== OWNER ||
    artifact?.workflow !== '.github/workflows/ci.yml' ||
    artifact?.sourceSha !== sourceSha ||
    String(artifact?.runId ?? '') !== developmentRunId ||
    String(artifact?.artifactId ?? '') !== developmentArtifactId ||
    !DECIMAL.test(String(artifact?.runAttempt ?? '')) ||
    !/^sha256:[a-f0-9]{64}$/.test(artifact?.githubArtifactDigest ?? '') ||
    report?.build?.before?.treeSha256 !== artifact.treeSha256 ||
    report?.build?.after?.treeSha256 !== artifact.treeSha256
  )
    refuse('HOSTED_SEO_NATIVE_REPORT_PROVENANCE_INVALID');
  return true;
}
function verifyArchive(zip, bytes, runId, attempt, acceptanceCase, memberDataScope) {
  const listing = ghJson(`repos/${OWNER}/actions/runs/${runId}/artifacts?per_page=100`);
  const name = `hosted-guest-${runId}-${attempt}`;
  const matches = listing.artifacts?.filter(
    (artifact) => artifact.name === name && artifact.expired === false,
  );
  if (matches?.length !== 1 || !/^sha256:[a-f0-9]{64}$/.test(matches[0].digest ?? ''))
    refuse('HOSTED_ARCHIVE_PROVENANCE_MISSING');
  const digest = createHash('sha256')
    .update(bytes ?? readFileSync(zip))
    .digest('hex');
  if (`sha256:${digest}` !== matches[0].digest) refuse('HOSTED_ARCHIVE_DIGEST_MISMATCH');
  const entries = archiveCommand(bytes, bytes ? ['-tf', '-'] : ['-Z', '-1', zip])
    .trim()
    .split('\n');
  requireExactArchiveJournalSet(entries, runId, attempt);
  const find = (basename) => {
    const candidates = entries.filter(
      (entry) => entry === basename || entry.endsWith(`/${basename}`),
    );
    if (candidates.length !== 1) refuse('HOSTED_ARCHIVE_ENTRY_MISSING_OR_DUPLICATE');
    return candidates[0];
  };
  const files = {};
  for (const prefix of PHASES) {
    const basename = `${prefix}-${runId}-${attempt}.jsonl`;
    if (entries.some((entry) => entry.endsWith(`${prefix}-${runId}-${attempt}.pending.jsonl`)))
      refuse('HOSTED_JOURNAL_PENDING');
    files[basename] = archiveEntry(zip, bytes, find(basename));
  }
  const reportName =
    acceptanceCase === 'settings-account-popover-member'
      ? 'settings-account-popover-member.json'
      : acceptanceCase === 'scrape-save-member'
        ? 'scrape-save-native-acceptance.json'
        : acceptanceCase === 'guest-scrape-development'
          ? 'scrape-seo-schema-empty-guest-native.json'
          : acceptanceCase === 'guest-seo'
            ? 'seo-guest-acceptance.json'
            : ['notes-find-member', 'notes-lazy-general-member'].includes(acceptanceCase)
              ? 'notes-native-acceptance.json'
              : memberDataScope === 'lifecycle'
                ? 'data-member-native-acceptance.json'
                : 'data-member-auto-extract-acceptance.json';
  const report = JSON.parse(archiveEntry(zip, bytes, find(reportName)));
  if (
    acceptanceCase === 'member-data' &&
    (report.case_id !== (memberDataScope === 'lifecycle' ? 'EXT-F-2005-T03' : 'EXT-F-2005-T08') ||
      report.auth_mode !== 'member' ||
      !SHA.test(report.artifact?.source_sha ?? '') ||
      !DECIMAL.test(String(report.artifact?.run_id ?? '')) ||
      !DECIMAL.test(String(report.artifact?.artifact_id ?? '')))
  )
    refuse('HOSTED_NATIVE_REPORT_PROVENANCE_INVALID');
  return { files, report, archiveDigest: digest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const mode = process.argv[2];
    const args = argsMap(process.argv.slice(3));
    if (
      [
        'plan-guest-chat',
        'dispatch-guest-chat',
        'plan-published-guest-chat',
        'dispatch-published-guest-chat',
      ].includes(mode)
    ) {
      guestChatCli(mode, args).catch((error) => {
        process.stderr.write(`HOSTED_REMOTE_REFUSED ${error.message}\n`);
        process.exitCode = 1;
      });
    } else if (mode === 'plan-startup-diagnostic' || mode === 'dispatch-startup-diagnostic') {
      startupDiagnosticCli(mode, args);
    } else if (
      mode === 'plan' ||
      mode === 'dispatch' ||
      mode === 'plan-guest-seo' ||
      mode === 'dispatch-guest-seo' ||
      mode === 'plan-scrape' ||
      mode === 'dispatch-scrape' ||
      mode === 'plan-member-scrape-save' ||
      mode === 'dispatch-member-scrape-save' ||
      mode === 'plan-settings-member' ||
      mode === 'dispatch-settings-member' ||
      mode === 'plan-settings-guest' ||
      mode === 'dispatch-settings-guest' ||
      mode === 'plan-notes' ||
      mode === 'dispatch-notes' ||
      mode === 'plan-notes-lazy-general' ||
      mode === 'dispatch-notes-lazy-general'
    ) {
      const lane = args.get('--lane');
      const developmentRunId = args.get('--development-run-id');
      const developmentArtifactId = args.get('--development-artifact-id');
      const sourceSha = args.get('--source-sha');
      const guestSeo = mode.endsWith('-guest-seo');
      const settings = mode.endsWith('-settings-member');
      const settingsGuest = mode.endsWith('-settings-guest');
      const notes = mode.endsWith('-notes') || mode.endsWith('-notes-lazy-general');
      const scrape = mode.endsWith('-scrape');
      const memberScrape = mode.endsWith('-member-scrape-save');
      const memberData = mode === 'plan' || mode === 'dispatch';
      const memberDataScope = args.get('--member-data-scope') ?? 'auto-extract';
      if (
        notes &&
        args.get('--case') !==
          (mode.endsWith('-notes-lazy-general') ? 'notes-lazy-general-member' : 'notes-find-member')
      )
        refuse('HOSTED_NOTES_CASE_MODE_MISMATCH');
      if (settings && args.get('--case') !== 'settings-account-popover-member')
        refuse('HOSTED_SETTINGS_MEMBER_CASE_MODE_MISMATCH');
      if (
        settingsGuest &&
        ![
          'settings-controls',
          'settings-guest-admin-absence',
          'settings-auto-scrape-capture',
        ].includes(args.get('--case'))
      )
        refuse('HOSTED_SETTINGS_GUEST_CASE_MODE_MISMATCH');
      if (memberData)
        for (const key of args.keys())
          if (
            ![
              '--lane',
              '--member-data-scope',
              '--development-run-id',
              '--development-artifact-id',
              '--source-sha',
            ].includes(key)
          )
            refuse('HOSTED_ARGUMENT_INVALID');
      if (notes || scrape || memberScrape || settings || settingsGuest || memberData)
        for (const key of args.keys())
          if (
            ![
              '--lane',
              '--case',
              '--runner-label',
              ...(scrape ? ['--scrape-scope', '--auth-mode'] : []),
              ...(memberScrape ? ['--destination', '--scope'] : []),
              ...(memberData ? ['--member-data-scope'] : []),
              '--development-run-id',
              '--development-artifact-id',
              '--source-sha',
            ].includes(key)
          )
            refuse('HOSTED_ARGUMENT_INVALID');
      const plan = settingsGuest
        ? planHostedSettingsGuest({
            lane,
            acceptanceCase: args.get('--case'),
            runnerLabel: args.get('--runner-label'),
            developmentRunId,
            developmentArtifactId,
            sourceSha,
          })
        : memberScrape
          ? planHostedMemberScrapeSave({
              lane,
              acceptanceCase: args.get('--case'),
              destination: args.get('--destination'),
              scope: args.get('--scope'),
              runnerLabel: args.get('--runner-label'),
              developmentRunId,
              developmentArtifactId,
              sourceSha,
            })
          : scrape
            ? planHostedScrape({
                lane,
                acceptanceCase: args.get('--case'),
                scrapeScope: args.get('--scrape-scope'),
                authMode: args.get('--auth-mode'),
                runnerLabel: args.get('--runner-label'),
                developmentRunId,
                developmentArtifactId,
                sourceSha,
              })
            : notes
              ? planHostedNotes({
                  lane,
                  acceptanceCase: args.get('--case'),
                  runnerLabel: args.get('--runner-label'),
                  developmentRunId,
                  developmentArtifactId,
                  sourceSha,
                })
              : guestSeo
                ? planHostedGuestSeo({
                    lane,
                    acceptanceCase: args.get('--case'),
                    seoCaseScope: args.get('--seo-case-scope'),
                    seoMetadataFixture: args.get('--seo-metadata-fixture'),
                    seoResourceDiagnostic: args.get('--seo-resource-diagnostic'),
                    seoInterruptAfterTarget: args.get('--seo-interrupt-after-target'),
                    runnerLabel: args.get('--runner-label'),
                    developmentRunId,
                    developmentArtifactId,
                    sourceSha,
                  })
                : settings
                  ? planHostedSettingsMember({
                      lane,
                      acceptanceCase: args.get('--case'),
                      runnerLabel: args.get('--runner-label'),
                      developmentRunId,
                      developmentArtifactId,
                      sourceSha,
                    })
                  : planHostedMemberData({
                      lane,
                      memberDataScope,
                      developmentRunId,
                      developmentArtifactId,
                      sourceSha,
                    });
      if (!SHA.test(sourceSha ?? '')) refuse('HOSTED_SOURCE_SHA_INVALID');
      const artifact = requireDevelopmentArtifact({
        runId: developmentRunId,
        artifactId: developmentArtifactId,
        sourceSha,
        ...((guestSeo || memberData) && { allowRuntimeEquivalent: true }),
      });
      if (
        mode === 'dispatch-settings-member' ||
        mode === 'dispatch-settings-guest' ||
        mode === 'dispatch' ||
        mode === 'dispatch-guest-seo' ||
        mode === 'dispatch-notes' ||
        mode === 'dispatch-notes-lazy-general' ||
        mode === 'dispatch-scrape' ||
        mode === 'dispatch-member-scrape-save'
      ) {
        const localSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
        const remoteSha = ghJson(`repos/${OWNER}/git/ref/heads/main`).object?.sha;
        const dirty = execFileSync(
          'git',
          [
            'status',
            '--porcelain',
            '--',
            ...(notes || scrape || settings || settingsGuest || guestSeo
              ? []
              : [
                  '.github/workflows/hosted-guest-acceptance.yml',
                  'scripts/hosted-remote-admission.mjs',
                  ...(guestSeo ? ['scripts/hosted-seo-route.mjs'] : []),
                ]),
          ],
          { encoding: 'utf8' },
        ).trim();
        requireSynchronizedDispatchSource(localSha, remoteSha, dirty);
        if (notes || settings || memberData || memberScrape) {
          verifyHostedWorkflowCheckout({
            path: '.github/workflows/hosted-guest-acceptance.yml',
            head_sha: remoteSha,
          });
          const history = {};
          if (notes) {
            const ancestry = spawnSync('git', [
              'merge-base',
              '--is-ancestor',
              sourceSha,
              remoteSha,
            ]);
            history.ancestor = !ancestry.error && ancestry.status === 0;
            history.changedPaths = execFileSync(
              'git',
              [
                'log',
                '--no-renames',
                '--format=',
                '--name-only',
                '-z',
                `${sourceSha}..${remoteSha}`,
              ],
              { encoding: 'utf8' },
            )
              .split('\0')
              .filter(Boolean);
          }
          const runs = ['hosted-guest-acceptance.yml', 'hosted-resource-diagnostic.yml'].flatMap(
            (workflow) =>
              ['queued', 'in_progress', 'waiting', 'pending', 'requested'].flatMap((status) => {
                const listing = ghJson(
                  `repos/${OWNER}/actions/workflows/${workflow}/runs?status=${status}&per_page=100`,
                );
                if (
                  !Array.isArray(listing.workflow_runs) ||
                  listing.total_count !== listing.workflow_runs.length
                )
                  refuse(
                    memberData
                      ? 'HOSTED_MEMBER_DATA_A_CAPACITY_REFUSED'
                      : memberScrape
                        ? 'HOSTED_MEMBER_SCRAPE_A_CAPACITY_REFUSED'
                        : settings
                          ? 'HOSTED_SETTINGS_MEMBER_A_CAPACITY_REFUSED'
                          : 'HOSTED_NOTES_A_CAPACITY_REFUSED',
                  );
                return listing.workflow_runs;
              }),
          );
          const secrets = ghJson(`repos/${OWNER}/actions/secrets?per_page=100`);
          (memberData
            ? requireMemberDataDispatchAdmission
            : memberScrape
              ? requireMemberScrapeSaveDispatchAdmission
              : settings
                ? requireSettingsMemberDispatchAdmission
                : requireNotesDispatchAdmission)({
            localSha,
            remoteSha,
            dirty,
            sourceSha,
            ...(memberData && { artifactSourceSha: artifact.sourceSha }),
            ...history,
            runs,
            secretNames: secrets.secrets?.map((secret) => secret.name),
          });
          const afterAdmissionLocalSha = execFileSync('git', ['rev-parse', 'HEAD'], {
            encoding: 'utf8',
          }).trim();
          const afterAdmissionRemoteSha = ghJson(`repos/${OWNER}/git/ref/heads/main`).object?.sha;
          const afterAdmissionDirty = execFileSync('git', ['status', '--porcelain'], {
            encoding: 'utf8',
          }).trim();
          if (settings || memberScrape)
            requireExactDispatchSource(
              afterAdmissionLocalSha,
              afterAdmissionRemoteSha,
              afterAdmissionDirty,
              sourceSha,
              memberScrape
                ? 'HOSTED_MEMBER_SCRAPE_SOURCE_DRIFT'
                : 'HOSTED_SETTINGS_MEMBER_SOURCE_DRIFT',
            );
          else
            requireSynchronizedDispatchSource(
              afterAdmissionLocalSha,
              afterAdmissionRemoteSha,
              afterAdmissionDirty,
            );
          if (memberData) {
            const current = sourceCompatibility(process.cwd(), artifact.sourceSha);
            if (current.mainSha !== sourceSha) refuse('HOSTED_MEMBER_DATA_SOURCE_DRIFT');
          }
        }
        if (scrape || settingsGuest) {
          verifyHostedWorkflowCheckout({
            path: '.github/workflows/hosted-guest-acceptance.yml',
            head_sha: remoteSha,
          });
          const runs = ['hosted-guest-acceptance.yml', 'hosted-resource-diagnostic.yml'].flatMap(
            (workflow) =>
              ['queued', 'in_progress', 'waiting', 'pending', 'requested'].flatMap((status) => {
                const listing = ghJson(
                  `repos/${OWNER}/actions/workflows/${workflow}/runs?status=${status}&per_page=100`,
                );
                if (
                  !Array.isArray(listing.workflow_runs) ||
                  listing.total_count !== listing.workflow_runs.length
                )
                  refuse(
                    settingsGuest
                      ? 'HOSTED_SETTINGS_GUEST_B_CAPACITY_REFUSED'
                      : 'HOSTED_SCRAPE_B_CAPACITY_REFUSED',
                  );
                return listing.workflow_runs;
              }),
          );
          (settingsGuest ? requireSettingsGuestDispatchAdmission : requireScrapeDispatchAdmission)({
            localSha,
            remoteSha,
            dirty,
            sourceSha,
            runs,
          });
          requireExactDispatchSource(
            execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
            ghJson(`repos/${OWNER}/git/ref/heads/main`).object?.sha,
            execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
            sourceSha,
            settingsGuest ? 'HOSTED_SETTINGS_GUEST_SOURCE_DRIFT' : 'HOSTED_SCRAPE_SOURCE_DRIFT',
          );
        }
        if (guestSeo) {
          // Re-prove after admission reads: the workflow must still execute the
          // synchronized main whose inputs were compared to the frozen artifact.
          const current = sourceCompatibility(process.cwd(), artifact.sourceSha);
          requireSynchronizedDispatchSource(
            current.mainSha,
            ghJson(`repos/${OWNER}/git/ref/heads/main`).object?.sha,
            execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
          );
          if (current.mainSha !== sourceSha) refuse('HOSTED_DEVELOPMENT_RUNTIME_SOURCE_DRIFT');
        }
        const result = spawnSync(plan.command, [...plan.args, '-R', OWNER], { stdio: 'inherit' });
        if (result.status !== 0) refuse('HOSTED_DISPATCH_FAILED');
      }
      process.stdout.write(
        `${JSON.stringify({ mode, plan, artifact, host: 'github-hosted', localHeavyWork: false })}\n`,
      );
    } else if (
      mode === 'verify-settings-member' ||
      mode === 'verify' ||
      mode === 'verify-guest-seo' ||
      mode === 'verify-notes' ||
      mode === 'verify-notes-lazy-general' ||
      mode === 'verify-scrape' ||
      mode === 'verify-member-scrape-save'
    ) {
      const runId = args.get('--run-id');
      const attempt = args.get('--attempt');
      const zip = args.get('--artifact-zip');
      if (!zip) refuse('HOSTED_ARCHIVE_MISSING');
      const run = ghJson(`repos/${OWNER}/actions/runs/${runId}`);
      const settings = mode === 'verify-settings-member';
      const guestSeo = mode === 'verify-guest-seo';
      const notes = mode === 'verify-notes' || mode === 'verify-notes-lazy-general';
      const lazyGeneral = mode === 'verify-notes-lazy-general';
      const scrape = mode === 'verify-scrape';
      const memberScrape = mode === 'verify-member-scrape-save';
      const memberDataScope = args.get('--member-data-scope') ?? 'auto-extract';
      if (mode === 'verify' && !['lifecycle', 'auto-extract'].includes(memberDataScope))
        refuse('HOSTED_MEMBER_DATA_SCOPE_REFUSED');
      const expectedRunName = settings
        ? 'Native A · settings-account-popover-member'
        : memberScrape
          ? 'Native A · scrape-save-member'
          : scrape
            ? 'Native B · guest-scrape-development'
            : guestSeo
              ? 'Native B · guest-seo'
              : notes
                ? `Native A · ${lazyGeneral ? 'notes-lazy-general-member' : 'notes-find-member'}`
                : 'Native A · member-data';
      if (
        run.path !== '.github/workflows/hosted-guest-acceptance.yml' ||
        !matchesHostedRunName(run.name, expectedRunName) ||
        run.event !== 'workflow_dispatch' ||
        run.head_branch !== 'main' ||
        run.conclusion !== 'success' ||
        String(run.run_attempt) !== attempt
      )
        refuse('HOSTED_RUN_NOT_SUCCESSFUL');
      const workflowSource = verifyHostedWorkflowCheckout(run);
      const sourceSha = args.get('--source-sha');
      if (!SHA.test(sourceSha ?? '')) refuse('HOSTED_SOURCE_SHA_INVALID');
      const chunks = [];
      if (zip === '-') for await (const chunk of process.stdin) chunks.push(chunk);
      const { files, report, archiveDigest } = verifyArchive(
        zip === '-' ? null : resolve(zip),
        zip === '-' ? Buffer.concat(chunks) : null,
        runId,
        attempt,
        settings
          ? 'settings-account-popover-member'
          : memberScrape
            ? 'scrape-save-member'
            : scrape
              ? 'guest-scrape-development'
              : guestSeo
                ? 'guest-seo'
                : notes
                  ? lazyGeneral
                    ? 'notes-lazy-general-member'
                    : 'notes-find-member'
                  : 'member-data',
        memberDataScope,
      );
      const artifactRunId =
        notes ||
        scrape ||
        memberScrape ||
        settings ||
        (mode === 'verify' && memberDataScope === 'lifecycle')
          ? args.get('--development-run-id')
          : guestSeo
            ? String(report.imported_artifact?.runId ?? '')
            : String(report.artifact.run_id);
      const artifactId =
        notes ||
        scrape ||
        memberScrape ||
        settings ||
        (mode === 'verify' && memberDataScope === 'lifecycle')
          ? args.get('--development-artifact-id')
          : guestSeo
            ? String(report.imported_artifact?.artifactId ?? '')
            : String(report.artifact.artifact_id);
      const artifact = requireDevelopmentArtifact({
        runId: artifactRunId,
        artifactId,
        sourceSha,
        ...((guestSeo || mode === 'verify') && { allowRuntimeEquivalent: true }),
        ...((guestSeo || notes || scrape) && {
          expectedDigest: report.imported_artifact.githubArtifactDigest,
        }),
      });
      if (guestSeo && run.head_sha !== sourceSha) refuse('HOSTED_SEO_WORKFLOW_SOURCE_DRIFT');
      if (guestSeo)
        verifyHostedGuestSeoReport(report, {
          sourceSha: artifact.sourceSha,
          developmentRunId: artifactRunId,
          developmentArtifactId: artifactId,
        });
      if (
        guestSeo &&
        Number(artifact.developmentRunAttempt) !== report.imported_artifact.runAttempt
      )
        refuse('HOSTED_SEO_NATIVE_REPORT_PROVENANCE_INVALID');
      if (notes) {
        const ancestry = spawnSync('git', ['merge-base', '--is-ancestor', sourceSha, run.head_sha]);
        const paths = execFileSync(
          'git',
          [
            'log',
            '--no-renames',
            '--format=',
            '--name-only',
            '-z',
            `${sourceSha}..${run.head_sha}`,
          ],
          { encoding: 'utf8' },
        )
          .split('\0')
          .filter(Boolean);
        if (
          ancestry.error ||
          ancestry.status !== 0 ||
          paths.some((path) => !NOTES_NON_RUNTIME_PATH.test(path))
        )
          refuse('HOSTED_NOTES_RUNTIME_SOURCE_DRIFT');
        (lazyGeneral ? verifyHostedNotesLazyGeneralReport : verifyHostedNotesReport)(report, {
          ...artifact,
          developmentArtifactId: artifact.artifactId,
        });
      }
      let settingsProvenance;
      if (settings) {
        if (run.head_sha !== sourceSha) refuse('HOSTED_SETTINGS_MEMBER_SOURCE_DRIFT');
        verifyHostedSettingsMemberReport(report);
        // Keep raw logs private and bounded; only the verified tree digest is returned.
        const log = execFileSync(
          'gh',
          ['run', 'view', runId, '--attempt', attempt, '--log', '-R', OWNER],
          {
            encoding: 'utf8',
            maxBuffer: 8_000_000,
          },
        );
        settingsProvenance = verifyHostedSettingsMemberLog(log, artifact);
      }
      if (scrape) {
        if (run.head_sha !== sourceSha) refuse('HOSTED_SCRAPE_SOURCE_DRIFT');
        verifyHostedScrapeReport(report, {
          ...artifact,
          developmentArtifactId: artifact.artifactId,
        });
      }
      let certifiedDestination;
      let certifiedScope;
      if (memberScrape) {
        if (run.head_sha !== sourceSha) refuse('HOSTED_MEMBER_SCRAPE_SOURCE_DRIFT');
        verifyHostedMemberScrapeSaveReport(report, {
          sourceSha: artifact.sourceSha,
          developmentRunId: artifactRunId,
          developmentArtifactId: artifactId,
          githubArtifactDigest: artifact.githubArtifactDigest,
          developmentRunAttempt: artifact.developmentRunAttempt,
        });
        const logResult = spawnSync(
          'gh',
          ['run', 'view', runId, '--attempt', attempt, '--log', '-R', OWNER],
          { encoding: 'utf8', maxBuffer: 8_000_000 },
        );
        if (logResult.error || logResult.status !== 0)
          refuse('HOSTED_MEMBER_SCRAPE_DESTINATION_UNVERIFIED');
        certifiedDestination = verifyHostedMemberScrapeSaveDispatchDestination(
          logResult.stdout,
          report.destination_mode,
        );
        certifiedScope = verifyHostedMemberScrapeSaveDispatchScope(
          logResult.stdout,
          report.save_scope,
        );
        const secrets = ghJson(`repos/${OWNER}/actions/secrets?per_page=100`);
        if (secrets.total_count !== secrets.secrets?.length)
          refuse('HOSTED_MEMBER_SCRAPE_SECRET_CLEANUP_UNVERIFIED');
        requireMemberDataSecretCleanup(secrets.secrets?.map((secret) => secret.name));
      }
      if (mode === 'verify') {
        if (run.head_sha !== sourceSha) refuse('HOSTED_MEMBER_DATA_SOURCE_DRIFT');
        if (report.artifact?.source_sha !== artifact.sourceSha)
          refuse('HOSTED_NATIVE_REPORT_PROVENANCE_INVALID');
      }
      let memberDataLifecycleProof;
      if (mode === 'verify' && memberDataScope === 'lifecycle') {
        verifyHostedMemberDataLifecycleReport(report, {
          sourceSha: artifact.sourceSha,
          developmentRunId: artifactRunId,
          developmentArtifactId: artifactId,
        });
        memberDataLifecycleProof = {
          replacementPanelBasis: memberDataReplacementPanelProofBasis(report.reload_lifecycle),
          verifierFileSha256: createHash('sha256')
            .update(readFileSync(new URL(import.meta.url)))
            .digest('hex'),
        };
        const secrets = ghJson(`repos/${OWNER}/actions/secrets?per_page=100`);
        if (secrets.total_count !== secrets.secrets?.length)
          refuse('HOSTED_MEMBER_DATA_SECRET_CLEANUP_UNVERIFIED');
        requireMemberDataSecretCleanup(secrets.secrets?.map((secret) => secret.name));
      }
      const verdict = verifyHostedResourceJournals({ runId, attempt, files });
      process.stdout.write(
        `${JSON.stringify({ runId, attempt, ...workflowSource, archiveDigest, artifact, ...(certifiedDestination && { certifiedDestination }), ...(certifiedScope && { certifiedScope }), ...(settings && { settingsProvenance }), ...(memberDataLifecycleProof && { memberDataLifecycleProof }), ...verdict })}\n`,
      );
    } else refuse('HOSTED_MODE_INVALID');
  } catch (error) {
    process.stderr.write(`HOSTED_REMOTE_REFUSED ${error?.message ?? 'UNKNOWN'}\n`);
    process.exitCode = 1;
  }
}
