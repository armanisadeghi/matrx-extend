#!/usr/bin/env node
/** Lightweight Mac-side dispatch; package and browser work runs under GitHub-hosted permits. */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sanitizeHostedResourceJournal } from './copy-hosted-resource-journal.mjs';

const OWNER = 'armanisadeghi/matrx-extend';
const PHASES = ['hosted-package', 'hosted-browser', 'hosted-guest'];
// Reviewed bytes of this narrow lane's active hosted workflow. Any workflow edit needs review.
const REVIEWED_WORKFLOW_SHA256 = '1cb3d900ed62405504e6d7c90cf7dab79716299a70f9318bd8005f476b12c75a';
const RESOURCE_POLICY = JSON.parse(
  readFileSync(new URL('../docs/stabilization/resource-policy.json', import.meta.url), 'utf8'),
);
const DECIMAL = /^[1-9][0-9]*$/;
const SHA = /^[a-f0-9]{40}$/;
function refuse(code) {
  throw new Error(code);
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

export function planHostedMemberData({
  lane,
  developmentRunId,
  developmentArtifactId,
  workflowRef = 'main',
  workflow,
  sourceSha,
}) {
  if (lane !== 'A') refuse('HOSTED_MEMBER_LANE_REFUSED');
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
      'member_data_scope=auto-extract',
      '-f',
      'scrape_auth_mode=member',
      '-f',
      `development_run_id=${developmentRunId}`,
      '-f',
      `development_artifact_id=${developmentArtifactId}`,
    ],
  };
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
    const watched = events.findIndex(
      (e, i) => i > admitted && e.code.startsWith('RESOURCE_WATCH_'),
    );
    const exited = events.findIndex(
      (e, i) => i > admitted && e.code === 'RESOURCE_JOB_EXIT' && e.childExitCode === 0,
    );
    const elapsed = Date.parse(events[exited]?.at) - Date.parse(events[admitted]?.at);
    if (
      admitted < 1 ||
      exited < 0 ||
      !Number.isFinite(elapsed) ||
      elapsed < 0 ||
      (elapsed >= RESOURCE_POLICY.watchIntervalSeconds * 1000 && (watched < 0 || watched >= exited))
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
function requireDevelopmentArtifact({ runId, artifactId, sourceSha }) {
  const run = ghJson(`repos/${OWNER}/actions/runs/${runId}`);
  if (
    run.name !== 'CI' ||
    run.event !== 'push' ||
    run.head_branch !== 'main' ||
    run.conclusion !== 'success' ||
    run.head_sha !== sourceSha
  )
    refuse('HOSTED_DEVELOPMENT_RUN_INVALID');
  const listing = ghJson(`repos/${OWNER}/actions/runs/${runId}/artifacts?per_page=100`);
  const matches = listing.artifacts?.filter(
    (artifact) =>
      String(artifact.id) === artifactId &&
      artifact.expired === false &&
      artifact.name === `matrx-extend-development-test-${sourceSha}-${runId}-${run.run_attempt}`,
  );
  if (matches?.length !== 1) refuse('HOSTED_DEVELOPMENT_ARTIFACT_INVALID');
  return { sourceSha, artifactId, developmentRunId: runId, developmentRunAttempt: run.run_attempt };
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
function verifyArchive(zip, bytes, runId, attempt, sourceSha) {
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
  const report = JSON.parse(
    archiveEntry(zip, bytes, find('data-member-auto-extract-acceptance.json')),
  );
  if (
    report.case_id !== 'EXT-F-2005-T08' ||
    report.auth_mode !== 'member' ||
    report.artifact?.source_sha !== sourceSha ||
    !DECIMAL.test(String(report.artifact?.run_id ?? '')) ||
    !DECIMAL.test(String(report.artifact?.artifact_id ?? ''))
  )
    refuse('HOSTED_NATIVE_REPORT_PROVENANCE_INVALID');
  return { files, report, archiveDigest: digest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const mode = process.argv[2];
    const args = argsMap(process.argv.slice(3));
    if (mode === 'plan' || mode === 'dispatch') {
      const lane = args.get('--lane');
      const developmentRunId = args.get('--development-run-id');
      const developmentArtifactId = args.get('--development-artifact-id');
      const sourceSha = args.get('--source-sha');
      const plan = planHostedMemberData({
        lane,
        developmentRunId,
        developmentArtifactId,
        sourceSha,
      });
      if (!SHA.test(sourceSha ?? '')) refuse('HOSTED_SOURCE_SHA_INVALID');
      const artifact = requireDevelopmentArtifact({
        runId: developmentRunId,
        artifactId: developmentArtifactId,
        sourceSha,
      });
      if (mode === 'dispatch') {
        const localSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
        const remoteSha = ghJson(`repos/${OWNER}/git/ref/heads/main`).object?.sha;
        const dirty = execFileSync(
          'git',
          [
            'status',
            '--porcelain',
            '--',
            '.github/workflows/hosted-guest-acceptance.yml',
            'scripts/hosted-remote-admission.mjs',
          ],
          { encoding: 'utf8' },
        ).trim();
        if (localSha !== remoteSha || dirty) refuse('HOSTED_DISPATCH_SOURCE_NOT_SYNCHRONIZED');
        const result = spawnSync(plan.command, [...plan.args, '-R', OWNER], { stdio: 'inherit' });
        if (result.status !== 0) refuse('HOSTED_DISPATCH_FAILED');
      }
      process.stdout.write(
        `${JSON.stringify({ mode, plan, artifact, host: 'github-hosted', localHeavyWork: false })}\n`,
      );
    } else if (mode === 'verify') {
      const runId = args.get('--run-id');
      const attempt = args.get('--attempt');
      const zip = args.get('--artifact-zip');
      if (!zip) refuse('HOSTED_ARCHIVE_MISSING');
      const run = ghJson(`repos/${OWNER}/actions/runs/${runId}`);
      if (
        run.path !== '.github/workflows/hosted-guest-acceptance.yml' ||
        run.name !== 'Native A · member-data' ||
        run.event !== 'workflow_dispatch' ||
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
        sourceSha,
      );
      const artifact = requireDevelopmentArtifact({
        runId: String(report.artifact.run_id),
        artifactId: String(report.artifact.artifact_id),
        sourceSha,
      });
      const verdict = verifyHostedResourceJournals({ runId, attempt, files });
      process.stdout.write(
        `${JSON.stringify({ runId, attempt, ...workflowSource, archiveDigest, artifact, ...verdict })}\n`,
      );
    } else refuse('HOSTED_MODE_INVALID');
  } catch (error) {
    process.stderr.write(`HOSTED_REMOTE_REFUSED ${error?.message ?? 'UNKNOWN'}\n`);
    process.exitCode = 1;
  }
}
