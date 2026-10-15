import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import * as admission from './hosted-remote-admission.mjs';

const sourceSha = 'a'.repeat(40);
const input = {
  lane: 'A',
  developmentRunId: '38116138170',
  developmentArtifactId: '11700000000',
  sourceSha,
};

test('normal member Data route selects lifecycle T03 without silently dispatching T08', () => {
  for (const memberDataScope of ['lifecycle', 'auto-extract']) {
    const plan = admission.planHostedMemberData({ ...input, memberDataScope });
    assert.equal(
      plan.args.filter((arg) => arg.startsWith('member_data_scope=')).join(),
      `member_data_scope=${memberDataScope}`,
    );
  }
  assert.throws(
    () => admission.planHostedMemberData({ ...input, memberDataScope: 'diagnostic' }),
    /HOSTED_MEMBER_DATA_SCOPE_REFUSED/,
  );
});

const identity = {
  sourceSha,
  developmentRunId: '38116138170',
  developmentArtifactId: '11700000000',
};
// Captured report vocabulary from the member driver and native reload capture contract.
function lifecycleReport() {
  const observations = Object.fromEntries(
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
    ].map((key) => [key, true]),
  );
  observations.pattern_write_requests = 1;
  observations.pattern_write_status = 201;
  for (const phase of ['before_reload', 'after_reload'])
    observations[`clipboard_${phase}`] = {
      tsv_matches_fixture: true,
      json_matches_fixture: true,
      ai_contains_all_fixture_rows: true,
      native_copy_feedback_observed: true,
      clipboard_readback: true,
      observation_permission_restored: true,
    };
  return {
    schema_version: 1,
    case_id: 'EXT-F-2005-T03',
    auth_mode: 'member',
    status: 'pass',
    stage: 'complete',
    failure_stage: null,
    reload_open_diagnostic: { enabled: false },
    reload_sender_document_diagnostic: { enabled: false },
    authentication: {
      mode: 'member',
      web_signed_in: true,
      extension_signed_in: true,
      non_admin_identity_verified: true,
      canonical_nonadmin_check_passed: true,
      organization_selected: true,
      selected_organization_id_verified: true,
      organization_resolution: 'load_ladder',
    },
    artifact: {
      source_sha: sourceSha,
      run_id: 38116138170,
      artifact_id: 11700000000,
      tree_sha256: 'b'.repeat(64),
    },
    runtime_tree_after: 'b'.repeat(64),
    observations,
    reload_lifecycle: {
      old_worker_absent: true,
      old_panel_absent: true,
      replacement_worker_present: true,
      replacement_panel_created_event: true,
      timeline: {
        final_predicate: true,
        old_worker_id: 'worker-old',
        old_panel_id: 'panel-old',
        replacement_worker_id: 'worker-new',
        final_snapshot: [{ kind: 'panel', target_id: 'panel-new' }],
      },
      open_panel_request: {
        received: true,
        ok: true,
        opened: true,
        category: 'opened',
        fixture: {
          availability: 'ready',
          click_received: true,
          send_invoked: true,
          send_returned: true,
          callback_entered: true,
          callback_has_reply: true,
          callback_last_error: false,
          send_threw: false,
        },
      },
    },
    reload_context: { exact_expected_appeared: true },
    cleanup: {
      verified: true,
      deleted_rows: 1,
      exact_owned_name_organization_lookup: true,
      active_rows_after_delete: 0,
    },
  };
}

test('T03 report requires production callback ingress, reload saved rows and confirmed cleanup', () => {
  assert.equal(admission.verifyHostedMemberDataLifecycleReport(lifecycleReport(), identity), true);
  const mutations = [
    (r) => {
      r.case_id = 'EXT-F-2005-T08';
    },
    (r) => {
      r.status = 'partial';
    },
    (r) => {
      r.authentication.non_admin_identity_verified = false;
    },
    (r) => {
      r.artifact.artifact_id++;
    },
    (r) => {
      r.runtime_tree_after = 'c'.repeat(64);
    },
    (r) => {
      r.reload_open_diagnostic.enabled = true;
    },
    (r) => {
      r.reload_sender_document_diagnostic.enabled = true;
    },
    (r) => {
      r.reload_lifecycle.open_panel_request = null;
    },
    (r) => {
      r.reload_lifecycle.open_panel_request.category = 'reply_not_observed';
    },
    (r) => {
      r.reload_lifecycle.open_panel_request.fixture.callback_entered = false;
    },
    (r) => {
      r.reload_lifecycle.open_panel_request.fixture.callback_last_error = true;
    },
    (r) => {
      r.reload_lifecycle.timeline.replacement_worker_id = 'worker-old';
    },
    (r) => {
      r.reload_lifecycle.timeline.final_snapshot[0].target_id = 'panel-old';
    },
    (r) => {
      r.reload_context.exact_expected_appeared = false;
    },
    (r) => {
      r.observations.saved_pattern_run_after_reload = false;
    },
    (r) => {
      r.observations.clipboard_after_reload.json_matches_fixture = false;
    },
    (r) => {
      r.observations.request_header_organization_matched_selected = false;
    },
    (r) => {
      r.cleanup.active_rows_after_delete = 1;
    },
    (r) => {
      r.cleanup.deleted_rows = 0;
    },
  ];
  for (const change of mutations) {
    const report = lifecycleReport();
    change(report);
    assert.throws(
      () => admission.verifyHostedMemberDataLifecycleReport(report, identity),
      /HOSTED_MEMBER_DATA_LIFECYCLE_REPORT_INVALID/,
    );
  }
});

test('member Data admission refuses occupied A fixtures, missing secret and source drift', () => {
  const receipt = {
    localSha: sourceSha,
    remoteSha: sourceSha,
    sourceSha,
    dirty: '',
    runs: [],
    secretNames: ['MATRX_REVIEWER_MAGIC_LINK_JSON'],
  };
  assert.equal(admission.requireMemberDataDispatchAdmission(receipt), true);
  assert.equal(
    admission.requireMemberDataDispatchAdmission({
      ...receipt,
      runs: [{ name: 'Native B · guest-seo', status: 'in_progress' }],
    }),
    true,
  );
  for (const [change, code] of [
    [{ sourceSha: 'b'.repeat(40) }, 'HOSTED_MEMBER_DATA_SOURCE_DRIFT'],
    [{ secretNames: [] }, 'HOSTED_MEMBER_DATA_SECRET_MISSING'],
    [
      { runs: [{ name: 'Native A · member-data', status: 'queued' }] },
      'HOSTED_MEMBER_DATA_A_CAPACITY_REFUSED',
    ],
    [{ runs: undefined }, 'HOSTED_MEMBER_DATA_A_CAPACITY_REFUSED'],
    [
      { dirty: ' M scripts/hosted-remote-admission.mjs' },
      'HOSTED_DISPATCH_SOURCE_NOT_SYNCHRONIZED',
    ],
  ])
    assert.throws(
      () => admission.requireMemberDataDispatchAdmission({ ...receipt, ...change }),
      new RegExp(code),
    );
});

test('terminal member Data verification refuses a remaining or unmeasured shared secret', () => {
  assert.equal(admission.requireMemberDataSecretCleanup([]), true);
  assert.equal(admission.requireMemberDataSecretCleanup(['OTHER_REVIEW_FIXTURE']), true);
  for (const names of [undefined, ['MATRX_REVIEWER_MAGIC_LINK_JSON']])
    assert.throws(
      () => admission.requireMemberDataSecretCleanup(names),
      /HOSTED_MEMBER_DATA_SECRET_CLEANUP_UNVERIFIED/,
    );
});

// The real verify CLI owns archive selection/digest, report identity, secret and journal gates.
test('normal T03 verify binds the lifecycle archive and refuses incomplete terminal evidence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'member-data-lifecycle-verify-'));
  const zip = join(dir, 'hosted.zip');
  const runId = '38122233344';
  const workflow = readFileSync(
    new URL('../.github/workflows/hosted-guest-acceptance.yml', import.meta.url),
    'utf8',
  );
  const journalDir = join(dir, 'docs/stabilization/resource-journals');
  mkdirSync(journalDir, { recursive: true });
  const journal = (prefix, invalid) =>
    `${[
      { at: '2026-10-12T05:00:00Z', code: 'RESOURCE_JOURNAL_OPENED' },
      { at: '2026-10-12T05:01:00Z', code: 'RESOURCE_ADMITTED', mode: 'run' },
      { at: '2026-10-12T05:01:30Z', code: 'RESOURCE_WATCH_HEALTHY' },
      { at: '2026-10-12T05:02:00Z', code: 'RESOURCE_JOB_EXIT', childExitCode: 0 },
      {
        at: '2026-10-12T05:02:01Z',
        code: 'RESOURCE_FINAL_DECISION',
        admitted: true,
        resourceInvalid: false,
        exitCode: 0,
        decision: invalid ? 'invalid' : 'valid',
      },
    ]
      .map((event) => JSON.stringify({ schema: 1, runId: `${prefix}-${runId}-1`, ...event }))
      .join('\n')}\n`;
  const fake = `#!/usr/bin/env node
const c=JSON.parse(process.env.T03_VERIFY_STUB),e=process.argv[3];let r;
if(e.includes('/contents/')) r={path:'.github/workflows/hosted-guest-acceptance.yml',type:'file',encoding:'base64',content:Buffer.from(c.workflow).toString('base64')};
else if(e.includes('/actions/secrets')) r={total_count:c.secretPresent?1:0,secrets:c.secretPresent?[{name:'MATRX_REVIEWER_MAGIC_LINK_JSON'}]:[]};
else if(e.includes('/artifacts?')) r={artifacts:e.includes('/'+c.runId+'/')?[{name:'hosted-guest-'+c.runId+'-1',expired:false,digest:c.archiveDigest}]:[{id:11700000000,expired:false,name:'matrx-extend-development-test-'+c.sourceSha+'-38116138170-1',digest:'sha256:'+'b'.repeat(64)}]};
else if(e.endsWith('/'+c.runId)) r={name:'Native A · member-data',path:'.github/workflows/hosted-guest-acceptance.yml',event:'workflow_dispatch',head_branch:'main',head_sha:c.workflowSha||c.sourceSha,conclusion:'success',run_attempt:1};
else if(e.endsWith('/38116138170')) r={name:'CI',path:'.github/workflows/ci.yml',event:'push',head_branch:'main',head_sha:c.sourceSha,conclusion:'success',run_attempt:1};
else process.exit(98);
process.stdout.write(JSON.stringify(r));
`;
  writeFileSync(join(dir, 'gh'), fake);
  chmodSync(join(dir, 'gh'), 0o700);
  const execute = (change = {}) => {
    rmSync(zip, { force: true });
    writeFileSync(
      join(dir, 'data-member-native-acceptance.json'),
      JSON.stringify(change.report ?? lifecycleReport()),
    );
    for (const prefix of ['hosted-package', 'hosted-browser', 'hosted-guest']) {
      const basename = `${prefix}-${runId}-1`;
      rmSync(join(journalDir, `${basename}.jsonl`), { force: true });
      rmSync(join(journalDir, `${basename}.pending.jsonl`), { force: true });
      writeFileSync(
        join(journalDir, `${basename}${change.pendingPhase === prefix ? '.pending' : ''}.jsonl`),
        journal(prefix, change.invalidPhase === prefix),
      );
    }
    const packed = spawnSync(
      'zip',
      ['-q', '-r', zip, 'data-member-native-acceptance.json', 'docs'],
      { cwd: dir, encoding: 'utf8' },
    );
    assert.equal(packed.status, 0, packed.stderr);
    const archiveDigest = `sha256:${createHash('sha256').update(readFileSync(zip)).digest('hex')}`;
    return spawnSync(
      process.execPath,
      [
        resolve('scripts/hosted-remote-admission.mjs'),
        'verify',
        '--member-data-scope',
        change.scope ?? 'lifecycle',
        '--run-id',
        runId,
        '--attempt',
        '1',
        '--artifact-zip',
        zip,
        '--source-sha',
        sourceSha,
        '--development-run-id',
        identity.developmentRunId,
        '--development-artifact-id',
        change.requestedArtifact ?? identity.developmentArtifactId,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          T03_VERIFY_STUB: JSON.stringify({ runId, sourceSha, workflow, archiveDigest, ...change }),
        },
      },
    );
  };
  try {
    const accepted = execute();
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.equal(JSON.parse(accepted.stdout).valid, true);
    for (const [change, code] of [
      [{ scope: 'auto-extract' }, 'HOSTED_ARCHIVE_ENTRY_MISSING_OR_DUPLICATE'],
      [{ requestedArtifact: '11700000001' }, 'HOSTED_DEVELOPMENT_ARTIFACT_INVALID'],
      [{ workflowSha: 'f'.repeat(40) }, 'HOSTED_MEMBER_DATA_SOURCE_DRIFT'],
      [{ archiveDigest: `sha256:${'f'.repeat(64)}` }, 'HOSTED_ARCHIVE_DIGEST_MISMATCH'],
      [{ secretPresent: true }, 'HOSTED_MEMBER_DATA_SECRET_CLEANUP_UNVERIFIED'],
      [
        { report: { ...lifecycleReport(), reload_context: null } },
        'HOSTED_MEMBER_DATA_LIFECYCLE_REPORT_INVALID',
      ],
      [{ invalidPhase: 'hosted-guest' }, 'JOURNAL_FINAL_DECISION_INVALID'],
      [{ pendingPhase: 'hosted-browser' }, 'HOSTED_ARCHIVE_JOURNAL_SET_INVALID'],
    ]) {
      const result = execute(change);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, new RegExp(code));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
