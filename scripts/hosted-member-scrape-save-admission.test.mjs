import assert from 'node:assert/strict';
import test from 'node:test';
import {
  planHostedMemberScrapeSave,
  requireMemberScrapeSaveDispatchAdmission,
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

test('member Save Source plans only a single no-destination guarded lane A run', () => {
  const plan = planHostedMemberScrapeSave(input);
  assert.ok(plan.args.includes('acceptance_case=scrape-save-member'));
  assert.ok(plan.args.includes('scrape_save_destination=none'));
  assert.ok(plan.args.includes('scrape_save_scope=single'));
  for (const change of [
    { lane: 'B' },
    { destination: 'project' },
    { scope: 'duplicate-rename' },
    { acceptanceCase: 'guest-scrape-development' },
  ])
    assert.throws(() => planHostedMemberScrapeSave({ ...input, ...change }));
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
  for (const changed of [
    { auth_mode: 'guest' },
    { destination_mode: 'project' },
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
else if(e.includes('/actions/secrets')) r={total_count:0,secrets:[]};
else if(e.includes('/artifacts?')) r=e.includes('/'+c.runId+'/')?{artifacts:[{name:'hosted-guest-'+c.runId+'-1',expired:false,digest:c.archiveDigest}]}:{artifacts:[{id:456,expired:false,name:'matrx-extend-development-test-'+c.sourceSha+'-123-1',digest:c.developmentDigest}]};
else if(e.endsWith('/'+c.runId)) r={name:'Native A · scrape-save-member',path:'.github/workflows/hosted-guest-acceptance.yml',event:'workflow_dispatch',head_branch:'main',head_sha:c.sourceSha,conclusion:'success',run_attempt:1};
else if(e.endsWith('/123')) r={name:'CI',path:'.github/workflows/ci.yml',event:'push',head_branch:'main',head_sha:c.sourceSha,conclusion:'success',run_attempt:1};
else process.exit(98); process.stdout.write(JSON.stringify(r));
`,
  );
  chmodSync(join(dir, 'gh'), 0o700);
  const execute = (payload, reportName = 'scrape-save-native-acceptance.json') => {
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
          }),
        },
      },
    );
  };
  try {
    const good = execute(report);
    assert.equal(good.status, 0, good.stderr);
    assert.equal(JSON.parse(good.stdout).valid, true);
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
