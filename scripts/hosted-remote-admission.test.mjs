import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  planHostedGuestSeo,
  planHostedMemberData,
  requireExactArchiveJournalSet,
  requireHostedWorkflowContract,
  requireSynchronizedDispatchSource,
  verifyHostedGuestSeoReport,
  verifyHostedResourceJournals,
  verifyHostedWorkflowCheckout,
} from './hosted-remote-admission.mjs';

const seoInput = {
  lane: 'B',
  acceptanceCase: 'guest-seo',
  seoCaseScope: 'notice-stacked',
  seoMetadataFixture: 'none',
  seoResourceDiagnostic: 'false',
  seoInterruptAfterTarget: 'none',
  runnerLabel: 'macos-15-intel',
  developmentRunId: '38116138170',
  developmentArtifactId: '11700000000',
  sourceSha: 'a'.repeat(40),
};

test('guest SEO B dispatch plan admits only the reviewed notice-stacked route', () => {
  const plan = planHostedGuestSeo(seoInput);
  assert.deepEqual(plan.args, [
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
    'seo_case_scope=notice-stacked',
    '-f',
    'seo_metadata_fixture=none',
    '-f',
    'seo_resource_diagnostic=false',
    '-f',
    'seo_interrupt_after_target=none',
    '-f',
    'runner_label=macos-15-intel',
    '-f',
    'development_run_id=38116138170',
    '-f',
    'development_artifact_id=11700000000',
  ]);
  for (const [key, value, refusal] of [
    ['lane', 'A', 'HOSTED_SEO_LANE_REFUSED'],
    ['acceptanceCase', 'member-data', 'HOSTED_SEO_CASE_REFUSED'],
    ['seoCaseScope', 'notice', 'HOSTED_SEO_SCOPE_REFUSED'],
    ['seoMetadataFixture', 'owned', 'HOSTED_SEO_FIXTURE_REFUSED'],
    ['seoResourceDiagnostic', 'true', 'HOSTED_SEO_DIAGNOSTIC_REFUSED'],
    [
      'seoInterruptAfterTarget',
      'manual_button_returns_to_current_page',
      'HOSTED_SEO_INTERRUPT_REFUSED',
    ],
    ['runnerLabel', 'macos-15', 'HOSTED_SEO_RUNNER_REFUSED'],
    ['workflowRef', 'feature', 'HOSTED_WORKFLOW_REF_REFUSED'],
    ['developmentRunId', '0', 'HOSTED_ARTIFACT_ID_INVALID'],
    ['developmentArtifactId', '0', 'HOSTED_ARTIFACT_ID_INVALID'],
    ['sourceSha', undefined, 'HOSTED_SOURCE_SHA_INVALID'],
  ])
    assert.throws(() => planHostedGuestSeo({ ...seoInput, [key]: value }), new RegExp(refusal));
  const workflow = readFileSync(
    new URL('../.github/workflows/hosted-guest-acceptance.yml', import.meta.url),
    'utf8',
  );
  assert.throws(
    () => planHostedGuestSeo({ ...seoInput, workflow: `${workflow}\n# changed` }),
    /HOSTED_WORKFLOW_BLOB_UNREVIEWED/,
  );
});

test('guest SEO dispatch refuses dirty helper/workflow or a different main commit', () => {
  const sha = 'a'.repeat(40);
  assert.equal(requireSynchronizedDispatchSource(sha, sha, ''), true);
  assert.throws(
    () => requireSynchronizedDispatchSource(sha, 'b'.repeat(40), ''),
    /HOSTED_DISPATCH_SOURCE_NOT_SYNCHRONIZED/,
  );
  assert.throws(
    () => requireSynchronizedDispatchSource(sha, sha, ' M scripts/hosted-remote-admission.mjs'),
    /HOSTED_DISPATCH_SOURCE_NOT_SYNCHRONIZED/,
  );
  assert.throws(
    () =>
      requireSynchronizedDispatchSource(
        sha,
        sha,
        ' M .github/workflows/hosted-guest-acceptance.yml',
      ),
    /HOSTED_DISPATCH_SOURCE_NOT_SYNCHRONIZED/,
  );
});

test('guest SEO native report must prove the bounded target and exact frozen CI artifact', () => {
  const report = {
    schema_version: 1,
    feature_id: 'EXT-F-1008',
    mode: 'guest',
    status: 'partial',
    resource_diagnostic_enabled: false,
    case_selection: {
      scope: 'notice-stacked',
      selected_cases: ['T02'],
      selected_subtargets: ['multiple_and_long_notice_clearance_at_native_360px'],
    },
    targets: [
      {
        case_id: 'EXT-F-1008-T02',
        subtarget: 'multiple_and_long_notice_clearance_at_native_360px',
        status: 'pass',
        evidence: {
          viewport_width: 360,
          viewport_source: 'native',
          notice_count: 2,
          long_message_length: 199,
          distinct_notice_titles: 2,
          visible_dismiss_counts: [1, 1],
          target_hit_points: 9,
          notice_hit_points: 0,
          current_title_matched: true,
          independently_dismissed: [
            [0, 1],
            [0, 0],
          ],
          cleared_count: 0,
        },
      },
    ],
    imported_artifact: {
      kind: 'ci_development_test',
      eligibleStore: false,
      repository: 'armanisadeghi/matrx-extend',
      workflow: '.github/workflows/ci.yml',
      sourceSha: 'a'.repeat(40),
      runId: 38116138170,
      runAttempt: 1,
      artifactId: 11700000000,
      githubArtifactDigest: `sha256:${'b'.repeat(64)}`,
      treeSha256: 'c'.repeat(64),
    },
    build: { before: { treeSha256: 'c'.repeat(64) }, after: { treeSha256: 'c'.repeat(64) } },
  };
  const identity = {
    sourceSha: 'a'.repeat(40),
    developmentRunId: '38116138170',
    developmentArtifactId: '11700000000',
  };
  assert.equal(verifyHostedGuestSeoReport(report, identity), true);
  for (const changed of [
    { status: 'unverified' },
    { resource_diagnostic_enabled: true },
    { interruption_test_target: 'manual_button_returns_to_current_page' },
    { receipt_state: 'in_progress' },
    { case_selection: { ...report.case_selection, scope: 'notice' } },
    { targets: [{ ...report.targets[0], status: 'unverified' }] },
    {
      targets: [
        { ...report.targets[0], evidence: { ...report.targets[0].evidence, notice_hit_points: 1 } },
      ],
    },
    { imported_artifact: { ...report.imported_artifact, sourceSha: 'b'.repeat(40) } },
    { imported_artifact: { ...report.imported_artifact, artifactId: 11700000001 } },
    { build: { before: report.build.before, after: { treeSha256: 'd'.repeat(64) } } },
  ])
    assert.throws(
      () => verifyHostedGuestSeoReport({ ...report, ...changed }, identity),
      /HOSTED_SEO_NATIVE_REPORT_PROVENANCE_INVALID/,
    );
});

test('remote member Data plan carries exact frozen artifact and guarded hosted workflow', () => {
  const plan = planHostedMemberData({
    lane: 'A',
    developmentRunId: '38116138170',
    developmentArtifactId: '11700000000',
    workflowRef: 'main',
  });
  assert.deepEqual(plan, {
    command: 'gh',
    args: [
      'workflow',
      'run',
      'hosted-guest-acceptance.yml',
      '--ref',
      'main',
      '-f',
      'acceptance_lane=A',
      '-f',
      'acceptance_case=member-data',
      '-f',
      'member_data_scope=auto-extract',
      '-f',
      'scrape_auth_mode=member',
      '-f',
      'development_run_id=38116138170',
      '-f',
      'development_artifact_id=11700000000',
    ],
  });
});

test('remote workflow contract refuses a diagnostic edit even when resource guards remain intact', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/hosted-guest-acceptance.yml', import.meta.url),
    'utf8',
  );
  assert.equal(requireHostedWorkflowContract(workflow), true);
  const unreviewed = workflow.replace('          - notes-cdp\n', '');
  assert.notEqual(unreviewed, workflow, 'diagnostic mutation must change the workflow bytes');
  assert.throws(
    () => requireHostedWorkflowContract(unreviewed),
    /HOSTED_WORKFLOW_BLOB_UNREVIEWED/,
    'unreviewed diagnostic workflow accepted',
  );
});

test('remote evidence refuses a missing or pending hosted acceptance final', () => {
  const runId = '38122233344';
  const attempt = '1';
  const journal = (prefix, decision = 'valid') =>
    `${[
      {
        schema: 1,
        at: '2026-10-11T08:00:00Z',
        runId: `${prefix}-${runId}-${attempt}`,
        code: 'RESOURCE_JOURNAL_OPENED',
      },
      {
        schema: 1,
        at: '2026-10-11T08:01:00Z',
        runId: `${prefix}-${runId}-${attempt}`,
        code: 'RESOURCE_ADMITTED',
        mode: 'run',
      },
      {
        schema: 1,
        at: '2026-10-11T08:01:15Z',
        runId: `${prefix}-${runId}-${attempt}`,
        code: 'RESOURCE_WATCH_HEALTHY',
      },
      {
        schema: 1,
        at: '2026-10-11T08:02:00Z',
        runId: `${prefix}-${runId}-${attempt}`,
        code: 'RESOURCE_JOB_EXIT',
        childExitCode: 0,
      },
      {
        schema: 1,
        at: '2026-10-11T08:02:01Z',
        runId: `${prefix}-${runId}-${attempt}`,
        code: 'RESOURCE_FINAL_DECISION',
        admitted: true,
        resourceInvalid: false,
        exitCode: 0,
        decision,
      },
    ]
      .map((event) => JSON.stringify(event))
      .join('\n')}\n`;
  const complete = Object.fromEntries(
    ['hosted-package', 'hosted-browser', 'hosted-guest'].map((prefix) => [
      `${prefix}-${runId}-${attempt}.jsonl`,
      journal(prefix),
    ]),
  );
  assert.deepEqual(verifyHostedResourceJournals({ runId, attempt, files: complete }).valid, true);
  const missing = { ...complete };
  delete missing[`hosted-guest-${runId}-${attempt}.jsonl`];
  assert.throws(
    () => verifyHostedResourceJournals({ runId, attempt, files: missing }),
    /HOSTED_JOURNAL_MISSING/,
  );
  const pending = {
    ...missing,
    [`hosted-guest-${runId}-${attempt}.pending.jsonl`]: journal('hosted-guest'),
  };
  assert.throws(
    () => verifyHostedResourceJournals({ runId, attempt, files: pending }),
    /HOSTED_JOURNAL_PENDING/,
  );
  const invalid = {
    ...complete,
    [`hosted-browser-${runId}-${attempt}.jsonl`]: journal('hosted-browser', 'invalid'),
  };
  assert.throws(
    () => verifyHostedResourceJournals({ runId, attempt, files: invalid }),
    /JOURNAL_FINAL_DECISION_INVALID|HOSTED_JOURNAL_NOT_VALID/,
  );
  const noWatch = {
    ...complete,
    [`hosted-package-${runId}-${attempt}.jsonl`]: journal('hosted-package')
      .split('\n')
      .filter((line) => !line.includes('RESOURCE_WATCH_HEALTHY'))
      .join('\n'),
  };
  assert.throws(
    () => verifyHostedResourceJournals({ runId, attempt, files: noWatch }),
    /HOSTED_JOURNAL_EVIDENCE_MISSING/,
  );
  const quick = {
    ...complete,
    [`hosted-package-${runId}-${attempt}.jsonl`]: journal('hosted-package')
      .split('\n')
      .filter((line) => !line.includes('RESOURCE_WATCH_HEALTHY'))
      .join('\n')
      .replace('08:02:00Z', '08:01:03Z')
      .replace('08:02:01Z', '08:01:04Z'),
  };
  assert.equal(verifyHostedResourceJournals({ runId, attempt, files: quick }).valid, true);
  const foreign = {
    ...complete,
    [`hosted-guest-${runId}-${attempt}.jsonl`]: journal('hosted-guest').replaceAll(
      `hosted-guest-${runId}-${attempt}`,
      `hosted-guest-${runId}-2`,
    ),
  };
  assert.throws(
    () => verifyHostedResourceJournals({ runId, attempt, files: foreign }),
    /JOURNAL_EVENT_INVALID/,
  );
});

test('remote plan refuses workflow mutations that remove a hosted guard or fixture boundary', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/hosted-guest-acceptance.yml', import.meta.url),
    'utf8',
  );
  assert.equal(requireHostedWorkflowContract(workflow), true);
  for (const [removed, reason] of [
    ['stabilization-resource.mjs run --run-id "hosted-package-', 'HOSTED_PHASE_GUARD_MISSING'],
    ['stabilization-resource.mjs run --run-id "hosted-browser-', 'HOSTED_PHASE_GUARD_MISSING'],
    ['stabilization-resource.mjs run --run-id "hosted-guest-', 'HOSTED_PHASE_GUARD_MISSING'],
    [
      'MATRX_HOSTED_MEMBER_LINK_JSON: ${{ secrets.MATRX_REVIEWER_MAGIC_LINK_JSON }}',
      'HOSTED_SECRET_BOUNDARY_MISSING',
    ],
    ['hosted-guest-side-panel-A', 'HOSTED_FIXTURE_SERIALIZATION_MISSING'],
  ]) {
    assert.throws(
      () => requireHostedWorkflowContract(workflow.replaceAll(removed, 'REMOVED')),
      new RegExp(reason),
    );
  }
  assert.throws(
    () =>
      planHostedMemberData({
        lane: 'B',
        developmentRunId: '38116138170',
        developmentArtifactId: '11700000000',
      }),
    /HOSTED_MEMBER_LANE_REFUSED/,
  );
});

test('hosted verification refuses a same-name successful run whose exact checkout lacks the resource guard', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/hosted-guest-acceptance.yml', import.meta.url),
    'utf8',
  );
  const run = {
    head_sha: '46c31547517484946d16472ecaeab534354f60e1',
    path: '.github/workflows/hosted-guest-acceptance.yml',
    name: 'Native A · member-data',
    event: 'workflow_dispatch',
    conclusion: 'success',
    run_attempt: 1,
  };
  const endpoint = `repos/armanisadeghi/matrx-extend/contents/.github/workflows/hosted-guest-acceptance.yml?ref=${run.head_sha}`;
  const response = (source) => ({
    path: run.path,
    type: 'file',
    encoding: 'base64',
    content: Buffer.from(source).toString('base64'),
  });
  const guarded = verifyHostedWorkflowCheckout(run, (requested) => {
    assert.equal(requested, endpoint);
    return response(workflow);
  });
  assert.equal(guarded.workflowSha, run.head_sha);
  assert.throws(
    () =>
      verifyHostedWorkflowCheckout(run, (requested) => {
        assert.equal(requested, endpoint);
        return response(
          workflow.replaceAll('stabilization-resource.mjs run --run-id "hosted-guest-', 'REMOVED'),
        );
      }),
    /HOSTED_PHASE_GUARD_MISSING/,
  );
  const commented = workflow.replace(
    /^(\s*)(node scripts\/stabilization-resource\.mjs run --run-id "hosted-(?:package|browser|guest)-)/gm,
    '$1# $2',
  );
  assert.equal(
    (commented.match(/^\s*# node scripts\/stabilization-resource\.mjs run/gm) ?? []).length,
    3,
  );
  assert.throws(
    () => verifyHostedWorkflowCheckout(run, () => response(commented)),
    /HOSTED_WORKFLOW_BLOB_UNREVIEWED/,
  );
  assert.throws(
    () =>
      planHostedMemberData({
        lane: 'A',
        developmentRunId: '38116138170',
        developmentArtifactId: '11700000000',
        workflow: commented,
      }),
    /HOSTED_WORKFLOW_BLOB_UNREVIEWED/,
  );
});

test('hosted archive must contain exactly the current package, browser, and guest finals', () => {
  const root = 'archive/docs/stabilization/resource-journals/';
  const names = ['hosted-package', 'hosted-browser', 'hosted-guest'].map(
    (prefix) => `${root}${prefix}-38122233344-1.jsonl`,
  );
  assert.equal(
    requireExactArchiveJournalSet(
      [...names, 'archive/test-results/data-member-auto-extract-acceptance.json'],
      '38122233344',
      '1',
    ),
    true,
  );
  assert.throws(
    () => requireExactArchiveJournalSet(names.slice(0, 2), '38122233344', '1'),
    /HOSTED_ARCHIVE_JOURNAL_SET_INVALID/,
  );
  assert.throws(
    () =>
      requireExactArchiveJournalSet(
        [...names, `${root}hosted-guest-38122233344-1.pending.jsonl`],
        '38122233344',
        '1',
      ),
    /HOSTED_ARCHIVE_JOURNAL_SET_INVALID/,
  );
  assert.throws(
    () =>
      requireExactArchiveJournalSet(
        [...names, `${root}hosted-guest-38111111111-1.jsonl`],
        '38122233344',
        '1',
      ),
    /HOSTED_ARCHIVE_JOURNAL_SET_INVALID/,
  );
});
