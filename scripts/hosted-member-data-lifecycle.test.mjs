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
        pre_click_old_worker_present: true,
        dropped_entries: 0,
        entries: [
          {
            at: '2026-10-20T17:33:32.872Z',
            phase: 'pre_click_snapshot',
            targets: [
              { kind: 'worker', type: 'service_worker', target_id: 'worker-old' },
              { kind: 'panel', type: 'page', target_id: 'panel-old' },
            ],
          },
          { at: '2026-10-20T17:33:32.873Z', phase: 'click_started' },
          {
            at: '2026-10-20T17:33:32.965Z',
            phase: 'target_destroyed',
            target: { kind: 'panel', type: 'page', target_id: 'panel-old' },
          },
          {
            at: '2026-10-20T17:33:34.908Z',
            phase: 'target_created',
            target: { kind: 'panel', type: 'page', target_id: 'panel-new' },
          },
        ],
        final_snapshot: [
          { kind: 'worker', type: 'service_worker', target_id: 'worker-new' },
          { kind: 'panel', type: 'page', target_id: 'panel-new' },
        ],
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
      r.reload_lifecycle.timeline.final_snapshot[1].target_id = 'panel-old';
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

test('T03 accepts correlated post-click panel materialization and refuses mismatched evidence', () => {
  const report = lifecycleReport();
  const lifecycle = report.reload_lifecycle;
  lifecycle.replacement_panel_created_event = false;
  lifecycle.timeline.entries[3].phase = 'target_info_changed';
  assert.equal(
    admission.memberDataReplacementPanelProofBasis(lifecycle),
    'correlated_panel_materialization',
  );
  assert.equal(admission.verifyHostedMemberDataLifecycleReport(report, identity), true);

  // A poll may legitimately observe the new document before its classified event.
  const snapshotFirst = structuredClone(report);
  snapshotFirst.reload_lifecycle.timeline.entries.splice(3, 0, {
    at: '2026-10-20T17:33:34.000Z',
    phase: 'poll_transition',
    targets: [structuredClone(lifecycle.timeline.final_snapshot[1])],
  });
  assert.equal(admission.verifyHostedMemberDataLifecycleReport(snapshotFirst, identity), true);

  const mutations = [
    (r) =>
      r.reload_lifecycle.timeline.entries.splice(1, 0, r.reload_lifecycle.timeline.entries.pop()),
    (r) => {
      r.reload_lifecycle.timeline.entries[3].target.target_id = 'different-panel';
    },
    (r) => {
      r.reload_lifecycle.timeline.final_snapshot[1].target_id = 'panel-old';
    },
    (r) => {
      r.reload_lifecycle.timeline.entries[3].target.kind = 'extension_other';
    },
    (r) => {
      r.reload_lifecycle.timeline.entries[3].target.type = 'other';
    },
    (r) => {
      r.reload_lifecycle.timeline.entries[3].at = '2026-10-20T17:33:32.870Z';
    },
    (r) => {
      r.reload_lifecycle.timeline.entries[2].at = '2026-10-20T17:33:35.000Z';
    },
    (r) => {
      r.reload_lifecycle.timeline.entries.splice(2, 0, {
        at: '2026-10-20T17:33:32.964Z',
        phase: 'target_info_changed',
        target: { kind: 'panel', type: 'page', target_id: 'panel-new' },
      });
    },
    (r) => {
      r.reload_lifecycle.timeline.entries[0].targets.shift();
    },
    (r) => {
      r.reload_lifecycle.timeline.pre_click_old_worker_present = false;
    },
    (r) => {
      r.reload_lifecycle.timeline.entries.push({
        at: '2026-10-20T17:33:35.100Z',
        phase: 'target_created',
        target: { kind: 'panel', type: 'page', target_id: 'panel-new' },
      });
    },
    (r) => {
      r.reload_lifecycle.timeline.entries[0].targets.push({
        kind: 'extension_other',
        target_id: 'panel-new',
      });
    },
    (r) => {
      r.reload_lifecycle.open_panel_request.opened = false;
    },
    (r) => {
      r.reload_context.exact_expected_appeared = false;
    },
    (r) => {
      r.observations.saved_pattern_run_after_reload = false;
    },
    (r) => {
      r.reload_lifecycle.timeline.entries[3].phase = 'target_created';
    },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(report);
    mutate(changed);
    assert.throws(
      () => admission.verifyHostedMemberDataLifecycleReport(changed, identity),
      /HOSTED_MEMBER_DATA_LIFECYCLE_REPORT_INVALID/,
    );
  }
});

test('T03 accepts millisecond ties only when the recorded entries prove all three boundaries', () => {
  // Hosted run 39472238118 recorded pre_click_snapshot and click_started in
  // this order at the same millisecond; its native report otherwise passed.
  const boundary = (ties) => {
    const report = lifecycleReport();
    report.reload_lifecycle.replacement_panel_created_event = false;
    report.reload_lifecycle.timeline.entries[3].phase = 'target_info_changed';
    const entries = report.reload_lifecycle.timeline.entries;
    if (ties.includes(0)) entries[0].at = entries[1].at;
    if (ties.includes(1)) entries[2].at = entries[1].at;
    if (ties.includes(2)) entries[3].at = entries[2].at;
    return report;
  };
  for (const ties of [[0], [1], [2], [0, 1, 2]]) {
    const report = boundary(ties);
    assert.equal(
      admission.memberDataReplacementPanelProofBasis(report.reload_lifecycle),
      'correlated_panel_materialization',
      `equal timestamp at boundaries ${ties.join(',')}`,
    );
    assert.equal(admission.verifyHostedMemberDataLifecycleReport(report, identity), true);
  }
  for (const [first, second] of [
    [0, 1],
    [1, 2],
    [2, 3],
  ]) {
    const report = boundary([0, 1, 2]);
    const entries = report.reload_lifecycle.timeline.entries;
    [entries[first], entries[second]] = [entries[second], entries[first]];
    assert.equal(admission.memberDataReplacementPanelProofBasis(report.reload_lifecycle), null);
    assert.throws(
      () => admission.verifyHostedMemberDataLifecycleReport(report, identity),
      /HOSTED_MEMBER_DATA_LIFECYCLE_REPORT_INVALID/,
    );
  }
});

test('T03 rejects first ownership before retirement across every producer observation channel', () => {
  const base = lifecycleReport();
  base.reload_lifecycle.replacement_panel_created_event = false;
  base.reload_lifecycle.timeline.entries[3].phase = 'target_info_changed';
  for (const phase of [
    'initial_snapshot',
    'pre_click_snapshot',
    'poll_transition',
    'target_created',
    'target_info_changed',
    'target_destroyed',
  ]) {
    const report = structuredClone(base);
    const timeline = report.reload_lifecycle.timeline;
    const target = structuredClone(timeline.final_snapshot[1]);
    const observation = {
      at: '2026-10-20T17:33:32.964Z',
      phase,
      ...(phase.startsWith('target_') ? { target } : { targets: [target] }),
    };
    timeline.entries.splice(2, 0, observation);
    assert.throws(
      () => admission.verifyHostedMemberDataLifecycleReport(report, identity),
      /HOSTED_MEMBER_DATA_LIFECYCLE_REPORT_INVALID/,
      phase,
    );
  }
});

test('T03 refuses malformed or contradictory proof instants even with a later valid event', () => {
  for (const phase of ['poll_transition', 'target_info_changed']) {
    for (const at of ['invalid', null, '', '2026-10-20T17:33:32.964Z']) {
      const report = lifecycleReport();
      report.reload_lifecycle.replacement_panel_created_event = false;
      const timeline = report.reload_lifecycle.timeline;
      timeline.entries[3].phase = 'target_info_changed';
      const target = structuredClone(timeline.final_snapshot[1]);
      timeline.entries.push({
        at,
        phase,
        ...(phase === 'poll_transition' ? { targets: [target] } : { target }),
      });
      assert.throws(
        () => admission.verifyHostedMemberDataLifecycleReport(report, identity),
        /HOSTED_MEMBER_DATA_LIFECYCLE_REPORT_INVALID/,
        `${phase}: ${at}`,
      );
    }
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
else if(e.includes('/artifacts?')) r={artifacts:e.includes('/'+c.runId+'/')?[{name:'hosted-guest-'+c.runId+'-1',expired:false,digest:c.archiveDigest}]:[{id:11700000000,expired:false,name:'matrx-extend-development-test-'+(c.artifactSourceSha||c.sourceSha)+'-38116138170-1',digest:'sha256:'+'b'.repeat(64)}]};
else if(e.endsWith('/'+c.runId)) r={name:'Native A · member-data',path:'.github/workflows/hosted-guest-acceptance.yml',event:'workflow_dispatch',head_branch:'main',head_sha:c.workflowSha||c.sourceSha,conclusion:'success',run_attempt:1};
else if(e.endsWith('/38116138170')) r={name:'CI',path:'.github/workflows/ci.yml',event:'push',head_branch:'main',status:'completed',head_sha:c.artifactSourceSha||c.sourceSha,conclusion:'success',run_attempt:1};
else process.exit(98);
process.stdout.write(JSON.stringify(r));
`;
  writeFileSync(join(dir, 'gh'), fake);
  chmodSync(join(dir, 'gh'), 0o700);
  const fakeGit = `#!/usr/bin/env node
const c=JSON.parse(process.env.T03_VERIFY_STUB),a=process.argv.slice(2);
if(a[0]==='rev-parse') process.stdout.write(c.sourceSha);
else if(a[0]==='status'||a[0]==='ls-files') process.stdout.write('');
else if(a[0]==='merge-base') process.exit(c.notAncestor?1:0);
else if(a[0]==='diff'||a[0]==='log') process.stdout.write(c.changedPath?c.changedPath+'\\0':'');
else process.exit(99);
`;
  writeFileSync(join(dir, 'git'), fakeGit);
  chmodSync(join(dir, 'git'), 0o700);
  const execute = (change = {}) => {
    rmSync(zip, { force: true });
    writeFileSync(
      join(dir, 'data-member-native-acceptance.json'),
      JSON.stringify(
        change.report ?? {
          ...lifecycleReport(),
          artifact: {
            ...lifecycleReport().artifact,
            source_sha: change.artifactSourceSha ?? sourceSha,
          },
        },
      ),
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
    assert.equal(
      JSON.parse(accepted.stdout).memberDataLifecycleProof.verifierFileSha256,
      createHash('sha256')
        .update(readFileSync(resolve('scripts/hosted-remote-admission.mjs')))
        .digest('hex'),
    );
    const correlated = lifecycleReport();
    correlated.reload_lifecycle.replacement_panel_created_event = false;
    correlated.reload_lifecycle.timeline.entries[3].phase = 'target_info_changed';
    const correlatedResult = execute({ report: correlated });
    assert.equal(correlatedResult.status, 0, correlatedResult.stderr);
    assert.equal(
      JSON.parse(correlatedResult.stdout).memberDataLifecycleProof.replacementPanelBasis,
      'correlated_panel_materialization',
    );
    const documentationOnly = {
      artifactSourceSha: 'c'.repeat(40),
      changedPath: 'docs/stabilization/reports/data-t03-repaired-native-20261020.json',
    };
    const equivalent = execute(documentationOnly);
    assert.equal(equivalent.status, 0, equivalent.stderr);
    assert.equal(JSON.parse(equivalent.stdout).artifact.compatibility, 'runtime-equivalent');
    for (const changedPath of [
      'scripts/hosted-remote-admission.mjs',
      'src/features/data/DataView.tsx',
      'tests/browser/data-member-native-acceptance.mjs',
      '.github/workflows/hosted-guest-acceptance.yml',
      'pnpm-lock.yaml',
    ]) {
      const refused = execute({ ...documentationOnly, changedPath });
      assert.equal(refused.status, 1, changedPath);
      assert.match(refused.stderr, /HOSTED_DEVELOPMENT_RUNTIME_SOURCE_DRIFT/);
    }
    const wrongClaim = lifecycleReport();
    wrongClaim.artifact.source_sha = 'd'.repeat(40);
    const mismatchedReport = execute({ ...documentationOnly, report: wrongClaim });
    assert.equal(mismatchedReport.status, 1);
    assert.match(mismatchedReport.stderr, /HOSTED_NATIVE_REPORT_PROVENANCE_INVALID/);
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
