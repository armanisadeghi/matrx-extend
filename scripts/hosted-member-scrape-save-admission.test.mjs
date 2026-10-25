import assert from 'node:assert/strict';
import test from 'node:test';
import {
  planHostedMemberScrapeSave,
  requireMemberScrapeSaveDispatchAdmission,
  verifyHostedMemberScrapeSaveDispatchDestination,
  verifyHostedMemberScrapeSaveDispatchScope,
  verifyHostedMemberScrapeSaveReport,
} from './hosted-remote-admission.mjs';

const sourceSha = 'a'.repeat(40);
const identity = {
  sourceSha,
  developmentRunId: '123',
  developmentArtifactId: '456',
  githubArtifactDigest: `sha256:${'d'.repeat(64)}`,
  developmentRunAttempt: 1,
};
const input = {
  lane: 'A',
  acceptanceCase: 'scrape-save-member',
  destination: 'none',
  scope: 'single',
  runnerLabel: 'macos-15-intel',
  ...identity,
};

test('member Save Source plans only single or no-destination D217 lane A runs', () => {
  const plan = planHostedMemberScrapeSave(input);
  assert.ok(plan.args.includes('acceptance_case=scrape-save-member'));
  assert.ok(plan.args.includes('scrape_save_destination=none'));
  assert.ok(plan.args.includes('scrape_save_scope=single'));
  const project = planHostedMemberScrapeSave({ ...input, destination: 'project' });
  assert.ok(project.args.includes('scrape_save_destination=project'));
  assert.ok(project.args.includes('scrape_save_scope=single'));
  const staleRetry = planHostedMemberScrapeSave({
    ...input,
    destination: 'none',
    scope: 'stale-profile-retry',
  });
  assert.ok(staleRetry.args.includes('scrape_save_scope=stale-profile-retry'));
  assert.ok(staleRetry.args.includes('scrape_save_destination=none'));
  assert.ok(!staleRetry.args.includes('scrape_save_scope=single'));
  for (const change of [
    { lane: 'B' },
    { destination: 'library' },
    { destination: 'project', scope: 'duplicate-rename' },
    { scope: 'duplicate-rename' },
    { destination: 'project', scope: 'stale-profile-retry' },
    { destination: 'none', scope: 'duplicate-rename-retry' },
    { acceptanceCase: 'guest-scrape-development' },
  ])
    assert.throws(() => planHostedMemberScrapeSave({ ...input, ...change }));
});

test('member Save dispatch scope must occur once and match native report', () => {
  const prefix =
    'guest\tRequire bounded lane and isolate shared credentials\t2026-10-20T05:01:00.0000000Z   ';
  const log = `${prefix}SCRAPE_SAVE_SCOPE: stale-profile-retry\n`;
  assert.equal(
    verifyHostedMemberScrapeSaveDispatchScope(log, 'stale-profile-retry'),
    'stale-profile-retry',
  );
  assert.throws(
    () => verifyHostedMemberScrapeSaveDispatchScope(log, 'single'),
    /HOSTED_MEMBER_SCRAPE_SCOPE_MISMATCH/,
  );
  assert.throws(
    () => verifyHostedMemberScrapeSaveDispatchScope('', 'stale-profile-retry'),
    /HOSTED_MEMBER_SCRAPE_SCOPE_UNVERIFIED/,
  );
  assert.throws(
    () => verifyHostedMemberScrapeSaveDispatchScope(log + log, 'stale-profile-retry'),
    /HOSTED_MEMBER_SCRAPE_SCOPE_UNVERIFIED/,
  );
  assert.throws(
    () =>
      verifyHostedMemberScrapeSaveDispatchScope(
        log + `${prefix}SCRAPE_SAVE_SCOPE: duplicate-rename\n`,
        'stale-profile-retry',
      ),
    /HOSTED_MEMBER_SCRAPE_SCOPE_UNVERIFIED/,
  );
  for (const value of ['', 'stale profile retry'])
    assert.throws(
      () =>
        verifyHostedMemberScrapeSaveDispatchScope(
          log + `${prefix}SCRAPE_SAVE_SCOPE: ${value}\n`,
          'stale-profile-retry',
        ),
      /HOSTED_MEMBER_SCRAPE_SCOPE_UNVERIFIED/,
    );
});

test('member Save destination counts every preflight field before certification', () => {
  const prefix =
    'guest\tRequire bounded lane and isolate shared credentials\t2026-10-20T05:01:00.0000000Z   ';
  const log = `${prefix}SCRAPE_SAVE_DESTINATION: none\n`;
  assert.equal(verifyHostedMemberScrapeSaveDispatchDestination(log, 'none'), 'none');
  assert.throws(
    () => verifyHostedMemberScrapeSaveDispatchDestination(log, 'project'),
    /HOSTED_MEMBER_SCRAPE_DESTINATION_MISMATCH/,
  );
  for (const value of ['library', '', 'owned project'])
    assert.throws(
      () =>
        verifyHostedMemberScrapeSaveDispatchDestination(
          log + `${prefix}SCRAPE_SAVE_DESTINATION: ${value}\n`,
          'none',
        ),
      /HOSTED_MEMBER_SCRAPE_DESTINATION_UNVERIFIED/,
    );
});

test('member Save Source dispatch refuses occupied lane, missing login and source drift', () => {
  const admitted = {
    localSha: sourceSha,
    remoteSha: sourceSha,
    sourceSha,
    dirty: '',
    runs: [],
    secretNames: ['MATRX_REVIEWER_MAGIC_LINK_JSON'],
  };
  assert.equal(requireMemberScrapeSaveDispatchAdmission(admitted), true);
  for (const change of [
    { runs: [{ status: 'in_progress', name: 'Native A · member-data' }] },
    { secretNames: [] },
    { sourceSha: 'b'.repeat(40) },
  ])
    assert.throws(() => requireMemberScrapeSaveDispatchAdmission({ ...admitted, ...change }));
});

test('member Save Source certificate requires real saved row, UI readback and exact cleanup', async () => {
  const report = {
    schema_version: 1,
    feature_id: 'EXT-F-1007',
    defect_id: 'EXT-D-0187',
    case_ids: ['EXT-F-1007-T04', 'EXT-F-1007-T29'],
    auth_mode: 'member',
    destination_mode: 'none',
    save_scope: 'single',
    status: 'pass',
    stage: 'complete',
    native_stage: 'exercise_panel',
    failure_stage: null,
    artifact: {
      kind: 'ci_development_test',
      eligible_store: false,
      source_sha: sourceSha,
      run_id: 123,
      artifact_id: 456,
      tree_sha256: 'c'.repeat(64),
      github_artifact_digest: identity.githubArtifactDigest,
      ci_run_attempt: 1,
    },
    authentication: {
      mode: 'member',
      web_signed_in: true,
      extension_signed_in: true,
      non_admin_role_verified: true,
      selected_organization_verified: true,
      organization_resolution: 'load_ladder',
    },
    observations: {
      dialog_opened_from_captured_article: true,
      prefilled_name_visible: true,
      custom_name_entered_by_trusted_keyboard: true,
      saved_confirmation_visible: true,
      source_row_read_from_service: true,
      custom_name_persisted: true,
      organization_scope_persisted: true,
      original_file_id_present: true,
      owned_project_fixture_created: false,
      project_id: null,
      no_destination_associations_persisted: true,
      saved_original_read_ready: true,
      saved_source_reopened_in_ui: true,
      cleanup_verified: true,
      reopen_header: { detail_open: true, name_matches: true, url_matches: true },
      capture: { article_title_matches: true, heading_matches: true, marker_matches: true },
      saved_original: { article_title_matches: true, heading_matches: true, marker_matches: true },
      reopen_ui: { heading_matches: true, marker_matches: true },
    },
    cleanup: {
      verified: true,
      run_owned_source_soft_deleted: true,
      source_associations_removed: true,
    },
  };
  assert.equal(verifyHostedMemberScrapeSaveReport(report, identity), true);
  const projectReport = {
    ...report,
    destination_mode: 'project',
    observations: {
      ...report.observations,
      owned_project_fixture_created: true,
      project_id: '123e4567-e89b-42d3-a456-426614174000',
      project_selected_in_save_dialog: true,
      project_matches_selected_organization: true,
      selected_project_edge_persisted: true,
      no_destination_associations_persisted: undefined,
    },
    project_cleanup: { verified: true, owned_project_absent: true },
  };
  assert.equal(verifyHostedMemberScrapeSaveReport(projectReport, identity), true);
  const guestAttempt = (revision) => ({
    revision,
    sign_in_required: true,
    no_organization_error: false,
    queued: true,
    edited_text_retained: true,
    memberships: 0,
    landings: 0,
  });
  const staleReport = {
    ...report,
    defect_id: 'EXT-D-0217',
    case_ids: ['EXT-F-1007-T05', 'EXT-F-1007-T22'],
    save_scope: 'stale-profile-retry',
    observations: {
      ...report.observations,
      saved_confirmation_visible: false,
      d217: {
        fixture: {
          credentials_removed: true,
          restore_via_full_extension_reload: true,
          guest_restore_observed: true,
        },
        warm_save: guestAttempt(1),
        warm_retry: guestAttempt(2),
        reload: {
          management_reload_clicked: true,
          old_targets_retired: true,
          worker_replaced: true,
          panel_replaced: true,
        },
        postreload_retry: guestAttempt(3),
        guest_zero_source_rows_verified_after_real_signin: true,
        member_retry: {
          landings: 1,
          landing_status: 200,
          organization_matches: true,
          edited_portions_sent: true,
        },
        member_retry_queue_cleared: true,
        persisted_source_content: {
          source_matches: true,
          organization_matches: true,
          edited_marker_persisted: true,
        },
      },
    },
  };
  assert.equal(verifyHostedMemberScrapeSaveReport(staleReport, identity), true);
  for (const changed of [
    { defect_id: 'EXT-D-0187' },
    { case_ids: report.case_ids },
    { destination_mode: 'project' },
    { observations: { ...staleReport.observations, saved_confirmation_visible: true } },
    {
      observations: {
        ...staleReport.observations,
        d217: { ...staleReport.observations.d217, warm_retry: guestAttempt(1) },
      },
    },
    {
      observations: {
        ...staleReport.observations,
        d217: {
          ...staleReport.observations.d217,
          postreload_retry: { ...guestAttempt(3), landings: 1 },
        },
      },
    },
    {
      observations: {
        ...staleReport.observations,
        d217: {
          ...staleReport.observations.d217,
          member_retry: {
            ...staleReport.observations.d217.member_retry,
            edited_portions_sent: false,
          },
        },
      },
    },
    {
      observations: {
        ...staleReport.observations,
        d217: {
          ...staleReport.observations.d217,
          persisted_source_content: {
            ...staleReport.observations.d217.persisted_source_content,
            edited_marker_persisted: false,
          },
        },
      },
    },
  ])
    assert.throws(
      () => verifyHostedMemberScrapeSaveReport({ ...staleReport, ...changed }, identity),
      /HOSTED_MEMBER_SCRAPE_REPORT_INVALID/,
    );
  for (const changed of [
    { observations: { ...projectReport.observations, owned_project_fixture_created: false } },
    { observations: { ...projectReport.observations, project_id: null } },
    { observations: { ...projectReport.observations, project_selected_in_save_dialog: false } },
    {
      observations: { ...projectReport.observations, project_matches_selected_organization: false },
    },
    { observations: { ...projectReport.observations, selected_project_edge_persisted: false } },
    { project_cleanup: { verified: true, owned_project_absent: false } },
    { project_cleanup: { verified: false, owned_project_absent: true } },
  ])
    assert.throws(() =>
      verifyHostedMemberScrapeSaveReport({ ...projectReport, ...changed }, identity),
    );
  for (const changed of [
    { auth_mode: 'guest' },
    { observations: { ...report.observations, owned_project_fixture_created: true } },
    { observations: { ...report.observations, project_id: projectReport.observations.project_id } },
    { observations: { ...report.observations, source_row_read_from_service: false } },
    {
      observations: {
        ...report.observations,
        saved_original: { ...report.observations.saved_original, marker_matches: false },
      },
    },
    { observations: { ...report.observations, no_destination_associations_persisted: false } },
    { cleanup: { ...report.cleanup, run_owned_source_soft_deleted: false } },
  ])
    assert.throws(() => verifyHostedMemberScrapeSaveReport({ ...report, ...changed }, identity));

  // Exercise the actual CLI archive parser and certificate path. GitHub is the only double.
  const { createHash } = await import('node:crypto');
  const { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = await import(
    'node:fs'
  );
  const { tmpdir } = await import('node:os');
  const { join, resolve } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'member-scrape-certificate-'));
  const runId = '789';
  const zip = join(dir, 'evidence.zip');
  const journals = join(dir, 'docs/stabilization/resource-journals');
  mkdirSync(journals, { recursive: true });
  const journal = (prefix) =>
    `${[
      { at: '2026-10-20T05:00:00Z', code: 'RESOURCE_JOURNAL_OPENED' },
      { at: '2026-10-20T05:01:00Z', code: 'RESOURCE_ADMITTED', mode: 'run' },
      { at: '2026-10-20T05:01:15Z', code: 'RESOURCE_WATCH_HEALTHY' },
      { at: '2026-10-20T05:02:00Z', code: 'RESOURCE_JOB_EXIT', childExitCode: 0 },
      {
        at: '2026-10-20T05:02:01Z',
        code: 'RESOURCE_FINAL_DECISION',
        admitted: true,
        resourceInvalid: false,
        exitCode: 0,
        decision: 'valid',
      },
    ]
      .map((event) => JSON.stringify({ schema: 1, runId: `${prefix}-${runId}-1`, ...event }))
      .join('\n')}\n`;
  for (const prefix of ['hosted-package', 'hosted-browser', 'hosted-guest'])
    writeFileSync(join(journals, `${prefix}-${runId}-1.jsonl`), journal(prefix));
  const workflow = readFileSync(
    new URL('../.github/workflows/hosted-guest-acceptance.yml', import.meta.url),
    'utf8',
  );
  writeFileSync(
    join(dir, 'gh'),
    `#!/usr/bin/env node
const c=JSON.parse(process.env.MEMBER_SCRAPE_VERIFY_STUB); const e=process.argv[3]; let r;
if(e.includes('/contents/')) r={path:'.github/workflows/hosted-guest-acceptance.yml',type:'file',encoding:'base64',content:Buffer.from(c.workflow).toString('base64')};
else if(process.argv[2]==='run' && process.argv[3]==='view') { process.stdout.write(c.runLog); process.exit(0); }
else if(e.includes('/actions/secrets')) r={total_count:0,secrets:[]};
else if(e.includes('/artifacts?')) r=e.includes('/'+c.runId+'/')?{artifacts:[{name:'hosted-guest-'+c.runId+'-1',expired:false,digest:c.archiveDigest}]}:{artifacts:[{id:456,expired:false,name:'matrx-extend-development-test-'+c.sourceSha+'-123-1',digest:c.developmentDigest}]};
else if(e.endsWith('/'+c.runId)) r={name:'Native A · scrape-save-member',path:'.github/workflows/hosted-guest-acceptance.yml',event:'workflow_dispatch',head_branch:'main',head_sha:c.sourceSha,conclusion:'success',run_attempt:1};
else if(e.endsWith('/123')) r={name:'CI',path:'.github/workflows/ci.yml',event:'push',head_branch:'main',status:'completed',head_sha:c.sourceSha,conclusion:'success',run_attempt:1};
else process.exit(98); process.stdout.write(JSON.stringify(r));
`,
  );
  chmodSync(join(dir, 'gh'), 0o700);
  const execute = (
    payload,
    reportName = 'scrape-save-native-acceptance.json',
    requestedDestination = 'none',
    requestedScope = 'single',
  ) => {
    writeFileSync(join(dir, reportName), JSON.stringify(payload));
    rmSync(zip, { force: true });
    const packed = spawnSync('zip', ['-q', '-r', zip, reportName, 'docs'], {
      cwd: dir,
      encoding: 'utf8',
    });
    assert.equal(packed.status, 0, packed.stderr);
    const archiveDigest = `sha256:${createHash('sha256').update(readFileSync(zip)).digest('hex')}`;
    return spawnSync(
      process.execPath,
      [
        resolve('scripts/hosted-remote-admission.mjs'),
        'verify-member-scrape-save',
        '--run-id',
        runId,
        '--attempt',
        '1',
        '--artifact-zip',
        zip,
        '--source-sha',
        sourceSha,
        '--development-run-id',
        '123',
        '--development-artifact-id',
        '456',
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          MEMBER_SCRAPE_VERIFY_STUB: JSON.stringify({
            runId,
            sourceSha,
            archiveDigest,
            developmentDigest: identity.githubArtifactDigest,
            workflow,
            runLog: `guest\tRequire bounded lane and isolate shared credentials\t2026-10-20T05:01:00.0000000Z   SCRAPE_SAVE_DESTINATION: ${requestedDestination}\nguest\tRequire bounded lane and isolate shared credentials\t2026-10-20T05:01:00.0000000Z   SCRAPE_SAVE_SCOPE: ${requestedScope}\n`,
          }),
        },
      },
    );
  };
  try {
    const good = execute(report);
    assert.equal(good.status, 0, good.stderr);
    assert.equal(JSON.parse(good.stdout).valid, true);
    assert.equal(JSON.parse(good.stdout).certifiedScope, 'single');
    const stale = execute(
      staleReport,
      'scrape-save-native-acceptance.json',
      'none',
      'stale-profile-retry',
    );
    assert.equal(stale.status, 0, stale.stderr);
    assert.equal(JSON.parse(stale.stdout).certifiedScope, 'stale-profile-retry');
    const wrongScope = execute(staleReport);
    assert.notEqual(wrongScope.status, 0);
    assert.match(wrongScope.stderr, /HOSTED_MEMBER_SCRAPE_SCOPE_MISMATCH/);
    const missingScope = execute(staleReport, 'scrape-save-native-acceptance.json', 'none', '');
    assert.notEqual(missingScope.status, 0);
    assert.match(missingScope.stderr, /HOSTED_MEMBER_SCRAPE_SCOPE_UNVERIFIED/);
    const badD217 = execute(
      {
        ...staleReport,
        observations: {
          ...staleReport.observations,
          d217: {
            ...staleReport.observations.d217,
            reload: { ...staleReport.observations.d217.reload, worker_replaced: false },
          },
        },
      },
      'scrape-save-native-acceptance.json',
      'none',
      'stale-profile-retry',
    );
    assert.notEqual(badD217.status, 0);
    assert.match(badD217.stderr, /HOSTED_MEMBER_SCRAPE_REPORT_INVALID/);
    const project = execute(projectReport, 'scrape-save-native-acceptance.json', 'project');
    assert.equal(project.status, 0, project.stderr);
    assert.equal(JSON.parse(project.stdout).valid, true);
    assert.equal(JSON.parse(project.stdout).certifiedDestination, 'project');
    const wrongProject = execute(projectReport);
    assert.notEqual(wrongProject.status, 0);
    assert.match(wrongProject.stderr, /HOSTED_MEMBER_SCRAPE_DESTINATION_MISMATCH/);
    const wrongNone = execute(report, 'scrape-save-native-acceptance.json', 'project');
    assert.notEqual(wrongNone.status, 0);
    assert.match(wrongNone.stderr, /HOSTED_MEMBER_SCRAPE_DESTINATION_MISMATCH/);
    const missingMode = execute(report, 'scrape-save-native-acceptance.json', '');
    assert.notEqual(missingMode.status, 0);
    assert.match(missingMode.stderr, /HOSTED_MEMBER_SCRAPE_DESTINATION_UNVERIFIED/);
    const duplicateMode = execute(
      report,
      'scrape-save-native-acceptance.json',
      'none\nguest\tRequire bounded lane and isolate shared credentials\t2026-10-20T05:01:01.0000000Z   SCRAPE_SAVE_DESTINATION: project',
    );
    assert.notEqual(duplicateMode.status, 0);
    assert.match(duplicateMode.stderr, /HOSTED_MEMBER_SCRAPE_DESTINATION_UNVERIFIED/);
    const badProjectCleanup = execute({
      ...projectReport,
      project_cleanup: { verified: false, owned_project_absent: false },
    });
    assert.notEqual(badProjectCleanup.status, 0);
    assert.match(badProjectCleanup.stderr, /HOSTED_MEMBER_SCRAPE_REPORT_INVALID/);
    const badCleanup = execute({ ...report, cleanup: { ...report.cleanup, verified: false } });
    assert.notEqual(badCleanup.status, 0);
    assert.match(badCleanup.stderr, /HOSTED_MEMBER_SCRAPE_REPORT_INVALID/);
    const missingReport = execute(report, 'wrong-report-name.json');
    assert.notEqual(missingReport.status, 0);
    assert.match(missingReport.stderr, /HOSTED_ARCHIVE_ENTRY_MISSING_OR_DUPLICATE/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
