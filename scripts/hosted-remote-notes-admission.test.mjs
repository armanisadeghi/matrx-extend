import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import * as admission from './hosted-remote-admission.mjs';

const sourceSha = '5b4678a4b'.padEnd(40, '0');
const input = {
  lane: 'A',
  acceptanceCase: 'notes-find-member',
  runnerLabel: 'macos-15-intel',
  developmentRunId: '38116138170',
  developmentArtifactId: '11700000000',
  sourceSha,
};
const identity = {
  sourceSha,
  developmentRunId: input.developmentRunId,
  developmentArtifactId: input.developmentArtifactId,
  developmentRunAttempt: 1,
  githubArtifactDigest: `sha256:${'b'.repeat(64)}`,
};
function nativeReport() {
  return {
    schema_version: 1,
    cases: ['EXT-F-2006-T02'],
    role: 'member',
    status: 'pass',
    extension_id: 'a'.repeat(32),
    imported_artifact: {
      kind: 'ci_development_test',
      eligibleStore: false,
      repository: 'armanisadeghi/matrx-extend',
      workflow: '.github/workflows/ci.yml',
      sourceSha,
      runId: Number(identity.developmentRunId),
      artifactId: Number(identity.developmentArtifactId),
      runAttempt: 1,
      githubArtifactDigest: identity.githubArtifactDigest,
      treeSha256: 'c'.repeat(64),
    },
    build: { before: { treeSha256: 'c'.repeat(64) }, after: { treeSha256: 'c'.repeat(64) } },
    observations: {
      hosted_authentication: {
        member_signed_in: true,
        non_admin_identity: true,
        organization_selected: true,
      },
      T02: {
        case_id: 'EXT-F-2006-T02',
        verdict: 'pass',
        cleanup_complete: true,
        home_cleanup_pending: [],
        cleanup: [1, 2, 3].map((n) => ({
          note_id: `67f40a32-d15a-4c98-a3ea-4be8ba35ad0${n}`,
          live_delete: true,
          editor_title_confirmed: true,
          response_status: 204,
        })),
        observations: {
          search_by_unique_title: { matches: 3, only_run_titles: true },
          all_homes_filter: { selected: true, owned_fixture_count: 3 },
          named_home_filter_1: { one_owned_note: true },
          named_home_filter_2: { one_owned_note: true },
          note_selector_open: true,
          note_row_open: true,
          general_default_fixture: true,
        },
      },
    },
  };
}

test('normal Notes plan dispatches member T02 on A rather than member Data or startup diagnostic', () => {
  assert.equal(typeof admission.planHostedNotes, 'function', 'normal helper has no Notes plan');
  const plan = admission.planHostedNotes(input);
  const fields = plan.args.filter((_v, i) => plan.args[i - 1] === '-f');
  assert.deepEqual(fields, [
    'acceptance_lane=A',
    'acceptance_case=notes-find-member',
    'scrape_auth_mode=member',
    'runner_label=macos-15-intel',
    'startup_display_mode=headed',
    'development_run_id=38116138170',
    'development_artifact_id=11700000000',
  ]);
  for (const change of [
    { lane: 'B' },
    { acceptanceCase: 'member-data' },
    { runnerLabel: 'macos-15' },
    { developmentArtifactId: '0' },
    { developmentRunId: '0' },
    { sourceSha: undefined },
    { workflowRef: 'feature' },
  ])
    assert.throws(() => admission.planHostedNotes({ ...input, ...change }));
  const workflow = readFileSync(
    new URL('../.github/workflows/hosted-guest-acceptance.yml', import.meta.url),
    'utf8',
  );
  assert.throws(
    () => admission.planHostedNotes({ ...input, workflow: `${workflow}\n# unreviewed` }),
    /HOSTED_WORKFLOW_BLOB_UNREVIEWED/,
  );
});

test('Notes admission refuses dirty checkout, workflow/runtime drift, A capacity or missing credential metadata', () => {
  assert.equal(
    typeof admission.requireNotesDispatchAdmission,
    'function',
    'normal helper lacks Notes admission',
  );
  const state = {
    localSha: sourceSha,
    remoteSha: sourceSha,
    dirty: '',
    sourceSha,
    changedPaths: [],
    ancestor: true,
    runs: [],
    secretNames: ['MATRX_REVIEWER_MAGIC_LINK_JSON'],
  };
  assert.equal(admission.requireNotesDispatchAdmission(state), true);
  assert.equal(
    admission.requireNotesDispatchAdmission({
      ...state,
      runs: [{ name: 'Native B · guest-seo', status: 'in_progress' }],
    }),
    true,
  );
  for (const change of [
    { dirty: ' M .github/workflows/hosted-guest-acceptance.yml' },
    { dirty: '?? src/pending.ts' },
    { remoteSha: 'd'.repeat(40) },
    { ancestor: false },
    { changedPaths: ['src/features/notes/NotesTab.tsx'] },
    { changedPaths: ['tests/browser/notes-find-native-case.mjs'] },
    { changedPaths: ['.github/workflows/hosted-guest-acceptance.yml'] },
    { runs: [{ name: 'Native A · member-data', status: 'in_progress' }] },
    { runs: [{ name: 'Native A · notes-find-member', status: 'queued' }] },
    { runs: [{ name: 'unknown workflow name', status: 'waiting' }] },
    { secretNames: [] },
  ])
    assert.throws(() => admission.requireNotesDispatchAdmission({ ...state, ...change }));
});

test('Notes verifier requires exact case, artifact, member identity, native search/home/open observations and cleanup', () => {
  assert.equal(
    typeof admission.verifyHostedNotesReport,
    'function',
    'normal helper lacks Notes native verifier',
  );
  assert.equal(admission.verifyHostedNotesReport(nativeReport(), identity), true);
  const variants = [
    (r) => {
      r.cases = ['EXT-F-2005-T08'];
    },
    (r) => {
      r.status = 'unverified';
    },
    (r) => {
      r.role = 'admin';
    },
    (r) => {
      r.observations.startup_endpoint = [];
    },
    (r) => {
      r.imported_artifact.artifactId++;
    },
    (r) => {
      r.imported_artifact.sourceSha = 'd'.repeat(40);
    },
    (r) => {
      r.imported_artifact.githubArtifactDigest = `sha256:${'d'.repeat(64)}`;
    },
    (r) => {
      r.build.after.treeSha256 = 'e'.repeat(64);
    },
    (r) => {
      r.observations.hosted_authentication.non_admin_identity = false;
    },
    (r) => {
      r.observations.T02.observations.search_by_unique_title.matches = 0;
    },
    (r) => {
      r.observations.T02.observations.note_row_open = false;
    },
    (r) => {
      r.observations.T02.cleanup_complete = false;
    },
    (r) => {
      r.observations.T02.cleanup.pop();
    },
    (r) => {
      r.observations.T02.home_cleanup_pending = ['pending'];
    },
    (r) => {
      r.observations.T02.cleanup[0].live_delete = false;
    },
  ];
  for (const mutate of variants) {
    const report = nativeReport();
    mutate(report);
    assert.throws(
      () => admission.verifyHostedNotesReport(report, identity),
      /HOSTED_NOTES_NATIVE_REPORT_PROVENANCE_INVALID/,
    );
  }
});

// The real CLI owns validation/order/routing. Only GitHub and git subprocesses are external doubles.
test('normal Notes CLI dispatch sends exactly the guarded route and never dispatches after a refusal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'notes-admission-'));
  const log = join(dir, 'dispatch.json');
  const workflow = readFileSync(
    new URL('../.github/workflows/hosted-guest-acceptance.yml', import.meta.url),
    'utf8',
  );
  const state = {
    sourceSha,
    artifactId: input.developmentArtifactId,
    runId: input.developmentRunId,
    digest: identity.githubArtifactDigest,
    workflow,
    log,
  };
  const fake = `#!/usr/bin/env node
const fs = require('node:fs');
const cfg = JSON.parse(process.env.NOTES_ADMISSION_STUB);
const args = process.argv.slice(2);
if (process.argv[1].endsWith('/git')) {
  if (args[0] === 'rev-parse') process.stdout.write(cfg.sourceSha);
  else if (args[0] === 'status') process.stdout.write(cfg.dirty || '');
  else if (args[0] === 'log') process.stdout.write((cfg.paths || []).join('\\0'));
  else if (args[0] === 'merge-base') process.exit(cfg.notAncestor ? 1 : 0);
  else process.exit(99);
} else if (args[0] === 'workflow') {
  fs.writeFileSync(cfg.log, JSON.stringify(args));
  process.exit(cfg.dispatchFailure ? 1 : 0);
} else {
  const endpoint = args[1]; let result;
  if (endpoint.includes('/git/ref/')) result = { object: { sha: cfg.remoteSha || cfg.sourceSha } };
  else if (endpoint.includes('/contents/')) result = { path: '.github/workflows/hosted-guest-acceptance.yml', type: 'file', encoding: 'base64', content: Buffer.from(cfg.workflow).toString('base64') };
  else if (endpoint.includes('/actions/secrets')) result = { secrets: cfg.noSecret ? [] : [{ name: 'MATRX_REVIEWER_MAGIC_LINK_JSON' }] };
  else if (endpoint.includes('/actions/workflows/')) result = { total_count: (cfg.runs || []).length, workflow_runs: cfg.runs || [] };
  else if (endpoint.includes('/artifacts?')) result = { artifacts: [{ id: cfg.wrongArtifact || cfg.artifactId, expired: false, name: 'matrx-extend-development-test-' + cfg.sourceSha + '-' + cfg.runId + '-1', digest: cfg.digest }] };
  else if (endpoint.endsWith('/actions/runs/' + cfg.runId)) result = { name: 'CI', path: '.github/workflows/ci.yml', event: 'push', head_branch: 'main', conclusion: 'success', head_sha: cfg.sourceSha, run_attempt: 1 };
  else process.exit(98);
  process.stdout.write(JSON.stringify(result));
}
`;
  for (const name of ['gh', 'git']) {
    writeFileSync(join(dir, name), fake);
    chmodSync(join(dir, name), 0o700);
  }
  const execute = (mode, change = {}, extra = []) =>
    spawnSync(
      process.execPath,
      [
        resolve('scripts/hosted-remote-admission.mjs'),
        mode,
        '--lane',
        'A',
        '--case',
        'notes-find-member',
        '--runner-label',
        'macos-15-intel',
        '--development-run-id',
        input.developmentRunId,
        '--development-artifact-id',
        input.developmentArtifactId,
        '--source-sha',
        sourceSha,
        ...extra,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          NOTES_ADMISSION_STUB: JSON.stringify({ ...state, ...change }),
        },
      },
    );
  try {
    const plan = execute('plan-notes');
    assert.equal(plan.status, 0, plan.stderr);
    assert.equal(JSON.parse(plan.stdout).artifact.artifactId, input.developmentArtifactId);
    for (const [change, reason] of [
      [{ wrongArtifact: '11700000001' }, 'HOSTED_DEVELOPMENT_ARTIFACT_INVALID'],
      [
        { dirty: ' M .github/workflows/hosted-guest-acceptance.yml' },
        'HOSTED_DISPATCH_SOURCE_NOT_SYNCHRONIZED',
      ],
      [{ dirty: '?? unrelated-pending.ts' }, 'HOSTED_DISPATCH_SOURCE_NOT_SYNCHRONIZED'],
      [{ paths: ['src/features/notes/NotesTab.tsx'] }, 'HOSTED_NOTES_RUNTIME_SOURCE_DRIFT'],
      [{ workflow: `${workflow}\n# unreviewed` }, 'HOSTED_WORKFLOW_BLOB_UNREVIEWED'],
      [
        { runs: [{ name: 'Native A · member-data', status: 'queued' }] },
        'HOSTED_NOTES_A_CAPACITY_REFUSED',
      ],
      [{ noSecret: true }, 'HOSTED_NOTES_MEMBER_SECRET_MISSING'],
    ]) {
      const result = execute('dispatch-notes', change);
      assert.notEqual(result.status, 0, reason);
      assert.match(result.stderr, new RegExp(reason));
      assert.throws(() => readFileSync(log), /ENOENT/, 'refusal was bypassed with a dispatch');
    }
    const unknown = execute('dispatch-notes', {}, ['--startup-display-mode', 'notes-cdp']);
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stderr, /HOSTED_ARGUMENT_INVALID/);
    const result = execute('dispatch-notes');
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(log)), [
      ...admission.planHostedNotes(input).args,
      '-R',
      'armanisadeghi/matrx-extend',
    ]);
    rmSync(log);
    const failed = execute('dispatch-notes', { dispatchFailure: true });
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /HOSTED_DISPATCH_FAILED/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
