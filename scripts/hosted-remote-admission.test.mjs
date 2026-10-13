import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { requireHostedDevelopmentCheckout } from './development-source-compatibility.mjs';
import {
  matchesHostedRunName,
  planHostedGuestSeo,
  planHostedMemberData,
  requireDevelopmentArtifact,
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

test('reviewed D217 workflow admits existing routes but refuses scope removal or unreviewed bytes', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/hosted-guest-acceptance.yml', import.meta.url),
    'utf8',
  );
  assert.equal(requireHostedWorkflowContract(workflow), true);
  const missingScope = workflow.replace('          - stale-profile-retry\n', '');
  assert.notEqual(missingScope, workflow, 'D217 scope mutation must change workflow bytes');
  assert.throws(
    () => requireHostedWorkflowContract(missingScope),
    /HOSTED_WORKFLOW_BLOB_UNREVIEWED/,
  );
  assert.throws(
    () => requireHostedWorkflowContract(`${workflow}\n# unreviewed`),
    /HOSTED_WORKFLOW_BLOB_UNREVIEWED/,
  );
});

test('standalone hosted CLI reaches admission refusals without installed packages', () => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'hosted-admission-bootstrap-')));
  try {
    mkdirSync(join(scratch, 'scripts'));
    mkdirSync(join(scratch, 'docs/stabilization'), { recursive: true });
    for (const name of [
      'hosted-remote-admission.mjs',
      'copy-hosted-resource-journal.mjs',
      'development-source-compatibility.mjs',
    ])
      copyFileSync(new URL(name, import.meta.url), join(scratch, 'scripts', name));
    copyFileSync(
      new URL('../docs/stabilization/resource-policy.json', import.meta.url),
      join(scratch, 'docs/stabilization/resource-policy.json'),
    );
    for (const [args, refusal] of [
      [['invalid-mode'], 'HOSTED_MODE_INVALID'],
      [['plan', '--lane', 'C'], 'HOSTED_MEMBER_LANE_REFUSED'],
    ]) {
      const result = spawnSync(
        process.execPath,
        [join(scratch, 'scripts/hosted-remote-admission.mjs'), ...args],
        { encoding: 'utf8', env: { ...process.env, NODE_PATH: '' } },
      );
      assert.equal(result.status, 1, result.stderr);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr, `HOSTED_REMOTE_REFUSED ${refusal}\n`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('hosted run verification accepts attributed exact route names only', () => {
  const expected = 'Native B · guest-seo';
  assert.equal(matchesHostedRunName(expected, expected), true);
  assert.equal(matchesHostedRunName(`${expected} (by extend-stabilization)`, expected), true);
  assert.equal(matchesHostedRunName(`${expected} (by other-lane)`, expected), true);
  assert.equal(matchesHostedRunName(`${expected} (by )`, expected), false);
  assert.equal(matchesHostedRunName(`${expected} (by other-lane) extra`, expected), false);
  assert.equal(
    matchesHostedRunName('Native B · guest-scrape (by extend-stabilization)', expected),
    false,
  );
  assert.equal(
    matchesHostedRunName('Native A · guest-seo (by extend-stabilization)', expected),
    false,
  );
});

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
    'requested_by=extend-stabilization',
    '-f',
    'seo_case_scope=notice-stacked',
    '-f',
    'seo_metadata_fixture=none',
    '-f',
    'seo_diagnostic=none',
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
      'requested_by=extend-stabilization',
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
  // A CPU episode is sampled by the same guard loop as RESOURCE_WATCH_HEALTHY.
  // The hosted browser may finish during that episode and recover before its valid final.
  const cpuSample = {
    pressureLevel: 1,
    availableMemoryGiB: 12.6,
    requiredMemoryGiB: 4,
    oneMinuteLoad: 1.51,
    logicalCpus: 4,
    cpuBusyFraction: 0.84,
    swapUsedMiB: 0,
    repoFreeGiB: 108.71806335449219,
    profileFreeGiB: 108.71806335449219,
    safetyFreeGiB: 108.71806335449219,
    systemFreeGiB: 108.71806335449219,
  };
  const browserCpuJournal = (watchOverride = {}) =>
    `${journal('hosted-browser')
      .trim()
      .split('\n')
      .map((line) => {
        const event = JSON.parse(line);
        return JSON.stringify(
          event.code === 'RESOURCE_WATCH_HEALTHY'
            ? {
                ...event,
                code: 'RESOURCE_CPU_PENDING',
                reasons: ['RESOURCE_CPU_BUSY'],
                sample: cpuSample,
                ...watchOverride,
              }
            : event,
        );
      })
      .join('\n')}\n`;
  const cpuPending = {
    ...complete,
    [`hosted-browser-${runId}-${attempt}.jsonl`]: browserCpuJournal(),
  };
  assert.equal(verifyHostedResourceJournals({ runId, attempt, files: cpuPending }).valid, true);
  for (const watchOverride of [
    { reasons: undefined, sample: undefined },
    { at: '2026-10-11T08:01:00Z' },
    { at: '2026-10-11T08:02:00Z' },
  ]) {
    const notObservedDuringChild = {
      ...complete,
      [`hosted-browser-${runId}-${attempt}.jsonl`]: browserCpuJournal(watchOverride),
    };
    assert.throws(
      () => verifyHostedResourceJournals({ runId, attempt, files: notObservedDuringChild }),
      /HOSTED_JOURNAL_EVIDENCE_MISSING/,
    );
  }
  const invalidCpuFinal = {
    ...cpuPending,
    [`hosted-browser-${runId}-${attempt}.jsonl`]: cpuPending[
      `hosted-browser-${runId}-${attempt}.jsonl`
    ].replace('"decision":"valid"', '"decision":"invalid"'),
  };
  assert.throws(
    () => verifyHostedResourceJournals({ runId, attempt, files: invalidCpuFinal }),
    /JOURNAL_FINAL_DECISION_INVALID/,
  );
  const cpuAfterExit = {
    ...complete,
    [`hosted-browser-${runId}-${attempt}.jsonl`]: browserCpuJournal({
      at: '2026-10-11T08:02:00.500Z',
    }),
  };
  assert.throws(
    () => verifyHostedResourceJournals({ runId, attempt, files: cpuAfterExit }),
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

// The Settings CLI owns routing/refusal/order; only GitHub and git are doubled.
test('Settings member route refuses alternate lanes, cases, runners and unreviewed workflow', async () => {
  const admission = await import('./hosted-remote-admission.mjs');
  assert.equal(
    typeof admission.planHostedSettingsMember,
    'function',
    'guarded Settings route is missing',
  );
  const input = settingsInput();
  assert.deepEqual(admission.planHostedSettingsMember(input).args, [
    'workflow',
    'run',
    'hosted-guest-acceptance.yml',
    '--ref',
    'main',
    '-f',
    'acceptance_lane=A',
    '-f',
    'acceptance_case=settings-account-popover-member',
    '-f',
    'requested_by=extend-stabilization',
    '-f',
    'scrape_auth_mode=guest',
    '-f',
    'development_run_id=38205458398',
    '-f',
    'development_artifact_id=11730000001',
    '-f',
    'runner_label=macos-15-intel',
  ]);
  for (const change of [
    { lane: 'B' },
    { acceptanceCase: 'settings-account-popover-admin' },
    { runnerLabel: 'macos-15' },
    { sourceSha: null },
    { developmentRunId: '0' },
    { developmentArtifactId: '0' },
    { workflowRef: 'other' },
    {
      workflow:
        readFileSync(
          new URL('../.github/workflows/hosted-guest-acceptance.yml', import.meta.url),
          'utf8',
        ) + '\n# drift',
    },
  ])
    assert.throws(() => admission.planHostedSettingsMember({ ...input, ...change }));
});
function settingsInput() {
  return {
    lane: 'A',
    acceptanceCase: 'settings-account-popover-member',
    runnerLabel: 'macos-15-intel',
    developmentRunId: '38205458398',
    developmentArtifactId: '11730000001',
    sourceSha: '2d52a79cfa5920f82b16a4287986c2fcf51795a5',
  };
}

test('EXT-D-0202 Settings member plan passes the real workflow provenance shell while member auth stays required', async () => {
  const { planHostedSettingsMember } = await import('./hosted-remote-admission.mjs');
  const { requireHostedAcceptanceCredential } = await import('./hosted-profile-route.mjs');
  const workflow = readFileSync(
    new URL('../.github/workflows/hosted-guest-acceptance.yml', import.meta.url),
    'utf8',
  );
  const gate = workflow
    .split('      - name: Require exactly one artifact provenance mode\n')[1]
    ?.split('\n      - name:')[0];
  assert.ok(gate, 'real workflow provenance step missing');
  const script = gate
    .split('        run: |\n')[1]
    .split('\n')
    .map((line) => (line.startsWith('          ') ? line.slice(10) : line))
    .join('\n');
  // Resolve real workflow input defaults and environment bindings; the plan owns overrides.
  const inputs = {};
  for (const [, name, body] of workflow.matchAll(/^ {6}(\w+):\n((?: {8,}\S.*\n)+)/gm))
    inputs[name] = body.match(/^ {8}default: (.*)$/m)?.[1] ?? '';
  const args = planHostedSettingsMember(settingsInput()).args;
  for (let i = 0; i < args.length; i++)
    if (args[i] === '-f') {
      const [name, value] = args[++i].split('=');
      inputs[name] = value;
    }
  const env = { ...process.env, RUNNER_ARCH: 'X64' };
  for (const [, name, input] of gate.matchAll(/^ {10}([A-Z_]+): \$\{\{ inputs\.([a-z_]+) \}\}$/gm))
    env[name] = inputs[input] ?? '';
  // Only the host architecture is doubled; execute the production shell unchanged.
  const run = (overrides) =>
    spawnSync('bash', ['-euo', 'pipefail', '-c', `uname() { printf 'x86_64\\n'; }\n${script}`], {
      encoding: 'utf8',
      env: { ...env, ...overrides },
    });
  const accepted = run({});
  assert.equal(accepted.status, 0, `Settings plan rejected by real workflow: ${accepted.stderr}`);
  for (const overrides of [
    { SCRAPE_AUTH_MODE: 'member' },
    { DEVELOPMENT_ARTIFACT_ID: '' },
    { PUBLISHED_STORE_CRX: 'true' },
  ])
    assert.notEqual(run(overrides).status, 0, 'invalid provenance passed the real workflow');
  assert.equal(env.ACCEPTANCE_CASE, 'settings-account-popover-member');
  assert.throws(
    () =>
      requireHostedAcceptanceCredential(env.ACCEPTANCE_CASE, {
        MATRX_SCRAPE_AUTH_MODE: env.SCRAPE_AUTH_MODE,
      }),
    /hosted_member_link_secret_required/,
  );
});
// Current native report schema; no person identifiers or credentials are represented.
function settingsReport() {
  const signedIn = { accessTokenPresent: true, profilePresent: true, isAdmin: false };
  const guest = { accessTokenPresent: false, profilePresent: false, isAdmin: null };
  const menu = (signedIn) => ({
    triggerCount: 1,
    triggerState: 'open',
    contentState: 'open',
    openDialogCount: 1,
    wrapperCount: 1,
    profile: signedIn ? 1 : 0,
    preferences: 1,
    signOut: 1,
    guestHeader: !signedIn,
  });
  return {
    schema_version: 1,
    role: 'member',
    status: 'pass',
    build: { kind: 'local_dev_unpacked', sourceSha: null },
    identity_before: signedIn,
    cases: [
      {
        id: 'EXT-F-1001-T20',
        status: 'pass',
        observations: [
          { menu: menu(true) },
          {
            destination: { activePaneCount: 1, profilePaneCount: 1, backCount: 1, saveCount: 1 },
            identity: signedIn,
          },
        ],
      },
      {
        id: 'EXT-F-1001-T23',
        status: 'pass',
        observations: [
          { selected: { count: 1, title: 'Settings', paneActive: true }, identity: signedIn },
        ],
      },
      {
        id: 'EXT-F-1001-T26',
        status: 'pass',
        observations: [
          { guest, reopenedMenu: menu(false) },
          { persistedGuest: guest, persistedMenu: menu(false) },
        ],
      },
    ],
  };
}
function settingsLog(input = settingsInput()) {
  const prefix =
    'hosted\tExercise the selected Chrome side-panel case\t2026-10-12T05:00:00.0000000Z ';
  return (
    prefix +
    `DEVELOPMENT_TEST_IMPORTED /Users/runner/work/matrx-extend/matrx-extend/test-results/ci-artifacts/${input.sourceSha}/${input.developmentRunId}-1 exact_pushed_commit_only\n` +
    prefix +
    `PREPARED_DEVELOPMENT ${input.sourceSha} ${'c'.repeat(64)}\n`
  );
}
test('Settings verifier refuses false native role, destination, signout and reload claims', async () => {
  const a = await import('./hosted-remote-admission.mjs');
  assert.equal(
    typeof a.verifyHostedSettingsMemberReport,
    'function',
    'Settings native verifier missing',
  );
  assert.equal(a.verifyHostedSettingsMemberReport(settingsReport()), true);
  for (const mutate of [
    (r) => (r.status = 'unverified'),
    (r) => (r.role = 'admin'),
    (r) => (r.identity_before.isAdmin = true),
    (r) => r.cases.pop(),
    (r) => (r.cases[0].id = 'EXT-F-1001-T21'),
    (r) => (r.cases[0].status = 'fail'),
    (r) => (r.cases[0].observations[0].menu.profile = 0),
    (r) => (r.cases[0].observations[1].destination.profilePaneCount = 0),
    (r) => (r.cases[0].observations[1].destination.saveCount = 0),
    (r) => (r.cases[1].observations[0].selected.title = 'Profile'),
    (r) => (r.cases[1].observations[0].identity.accessTokenPresent = false),
    (r) => (r.cases[2].observations[0].guest.accessTokenPresent = true),
    (r) => (r.cases[2].observations[1].persistedGuest.profilePresent = true),
    (r) => (r.cases[2].observations[1].persistedMenu.profile = 1),
  ]) {
    const r = settingsReport();
    mutate(r);
    assert.throws(() => a.verifyHostedSettingsMemberReport(r));
  }
});
test('Settings log provenance requires exact step, source, run, attempt, complete markers and order', async () => {
  const a = await import('./hosted-remote-admission.mjs');
  assert.equal(
    typeof a.verifyHostedSettingsMemberLog,
    'function',
    'Settings provenance verifier missing',
  );
  const input = settingsInput();
  const identity = {
    sourceSha: input.sourceSha,
    developmentRunId: input.developmentRunId,
    developmentRunAttempt: 1,
    artifactId: input.developmentArtifactId,
    githubArtifactDigest: `sha256:${'b'.repeat(64)}`,
  };
  const log = settingsLog();
  assert.deepEqual(a.verifyHostedSettingsMemberLog(log, identity), { treeSha256: 'c'.repeat(64) });
  assert.deepEqual(
    a.verifyHostedSettingsMemberLog(log.replace('c'.repeat(64), 'd'.repeat(64)), identity),
    { treeSha256: 'd'.repeat(64) },
  );
  for (const invalid of [
    '',
    log.replaceAll(input.sourceSha, 'f'.repeat(40)),
    log.replace(input.developmentRunId, '38205458399'),
    log.replace('-1 exact', '-2 exact'),
    log.replaceAll('Exercise the selected Chrome side-panel case', 'Set up job'),
    log + log,
    log.replace('PREPARED_DEVELOPMENT', 'missing'),
    log.replace('exact_pushed_commit_only', 'unverified'),
    log.split('\n').filter(Boolean).reverse().join('\n'),
    log.replace(/hosted\t[^\t]+\t[^ ]+ /g, ''),
  ])
    assert.throws(() => a.verifyHostedSettingsMemberLog(invalid, identity));
});

test('Settings CLI verification binds the real archive, authenticated logs and all resource finals', async () => {
  const { createHash } = await import('node:crypto');
  const dir = mkdtempSync(join(tmpdir(), 'settings-verify-'));
  const input = settingsInput();
  const runId = '38206000001';
  const workflow = readFileSync(
    new URL('../.github/workflows/hosted-guest-acceptance.yml', import.meta.url),
    'utf8',
  );
  const zip = join(dir, 'evidence.zip');
  const reportPath = join(dir, 'settings-account-popover-member.json');
  const journal = (prefix, decision = 'valid') =>
    [
      { at: '2026-10-12T05:00:00Z', code: 'RESOURCE_JOURNAL_OPENED' },
      { at: '2026-10-12T05:01:00Z', code: 'RESOURCE_ADMITTED', mode: 'run' },
      { at: '2026-10-12T05:01:15Z', code: 'RESOURCE_WATCH_HEALTHY' },
      { at: '2026-10-12T05:02:00Z', code: 'RESOURCE_JOB_EXIT', childExitCode: 0 },
      {
        at: '2026-10-12T05:02:01Z',
        code: 'RESOURCE_FINAL_DECISION',
        admitted: true,
        resourceInvalid: decision !== 'valid',
        exitCode: decision === 'valid' ? 0 : 3,
        decision,
      },
    ]
      .map((e) => JSON.stringify({ schema: 1, runId: `${prefix}-${runId}-1`, ...e }))
      .join('\n') + '\n';
  const { mkdirSync } = await import('node:fs');
  const journals = join(dir, 'docs/stabilization/resource-journals');
  mkdirSync(journals, { recursive: true });
  const repack = (invalid = {}) => {
    rmSync(zip, { force: true });
    writeFileSync(reportPath, JSON.stringify(invalid.report ?? settingsReport()));
    for (const prefix of ['hosted-package', 'hosted-browser', 'hosted-guest'])
      writeFileSync(
        join(journals, `${prefix}-${runId}-1.jsonl`),
        journal(prefix, invalid.invalidPhase === prefix ? 'invalid' : 'valid'),
      );
    const packed = spawnSync(
      'zip',
      ['-q', '-r', zip, 'settings-account-popover-member.json', 'docs'],
      { cwd: dir, encoding: 'utf8' },
    );
    assert.equal(packed.status, 0, packed.stderr);
    return `sha256:${createHash('sha256').update(readFileSync(zip)).digest('hex')}`;
  };
  const state = {
    sourceSha: input.sourceSha,
    developmentRunId: input.developmentRunId,
    artifactId: input.developmentArtifactId,
    runId,
    workflow,
    nativeLog: settingsLog(),
  };
  const fake = `#!/usr/bin/env node
const c=JSON.parse(process.env.SETTINGS_VERIFY_STUB), a=process.argv.slice(2);
if(a[0]==='run'){process.stdout.write(c.nativeLog);process.exit(0);}
const e=a[1];let r;
if(e.includes('/contents/'))r={path:'.github/workflows/hosted-guest-acceptance.yml',type:'file',encoding:'base64',content:Buffer.from(c.workflow).toString('base64')};
else if(e.includes('/artifacts?'))r={artifacts:e.includes('/'+c.runId+'/')?[{name:'hosted-guest-'+c.runId+'-1',expired:false,digest:c.archiveDigest}]:[{id:c.artifactId,expired:false,name:'matrx-extend-development-test-'+c.sourceSha+'-'+c.developmentRunId+'-1',digest:'sha256:'+'b'.repeat(64)}]};
else if(e.endsWith('/'+c.runId))r={name:'Native A · settings-account-popover-member',path:'.github/workflows/hosted-guest-acceptance.yml',event:'workflow_dispatch',head_branch:'main',head_sha:c.workflowSha||c.sourceSha,conclusion:c.conclusion||'success',run_attempt:1};
else if(e.endsWith('/'+c.developmentRunId))r={name:'CI',path:'.github/workflows/ci.yml',event:'push',head_branch:'main',head_sha:c.sourceSha,conclusion:'success',run_attempt:1};
else process.exit(98);
process.stdout.write(JSON.stringify(r));
`;
  writeFileSync(join(dir, 'gh'), fake);
  chmodSync(join(dir, 'gh'), 0o700);
  const execute = (change = {}, invalid = {}) =>
    spawnSync(
      process.execPath,
      [
        resolve('scripts/hosted-remote-admission.mjs'),
        'verify-settings-member',
        '--run-id',
        runId,
        '--attempt',
        '1',
        '--artifact-zip',
        zip,
        '--source-sha',
        input.sourceSha,
        '--development-run-id',
        input.developmentRunId,
        '--development-artifact-id',
        input.developmentArtifactId,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          SETTINGS_VERIFY_STUB: JSON.stringify({
            ...state,
            archiveDigest: repack(invalid),
            ...change,
          }),
        },
      },
    );
  try {
    const accepted = execute();
    assert.equal(accepted.status, 0, accepted.stderr);
    const receipt = JSON.parse(accepted.stdout);
    assert.equal(receipt.valid, true);
    assert.deepEqual(Object.keys(receipt.receipts), [
      'hosted-package',
      'hosted-browser',
      'hosted-guest',
    ]);
    for (const [change, invalid, reason] of [
      [{ nativeLog: '' }, {}, 'HOSTED_SETTINGS_MEMBER_LOG_PROVENANCE_INVALID'],
      [{ workflowSha: 'f'.repeat(40) }, {}, 'HOSTED_SETTINGS_MEMBER_SOURCE_DRIFT'],
      [{ conclusion: 'failure' }, {}, 'HOSTED_RUN_NOT_SUCCESSFUL'],
      [{ archiveDigest: `sha256:${'f'.repeat(64)}` }, {}, 'HOSTED_ARCHIVE_DIGEST_MISMATCH'],
      [
        {},
        { report: { ...settingsReport(), role: 'admin' } },
        'HOSTED_SETTINGS_MEMBER_NATIVE_REPORT_INVALID',
      ],
      ...['hosted-package', 'hosted-browser', 'hosted-guest'].map((prefix) => [
        {},
        { invalidPhase: prefix },
        'HOSTED_JOURNAL_NOT_VALID',
      ]),
    ]) {
      const result = execute(change, invalid);
      assert.notEqual(result.status, 0, reason);
      assert.match(result.stderr, new RegExp(reason));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The real CLI owns validation/order/routing. Only GitHub and git subprocesses are external doubles.
test('normal Settings CLI dispatch sends exactly the guarded route and never dispatches after a refusal', async () => {
  const admission = await import('./hosted-remote-admission.mjs');
  const input = settingsInput();
  const sourceSha = input.sourceSha;
  const identity = { githubArtifactDigest: `sha256:${'b'.repeat(64)}` };
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
const cfg = JSON.parse(process.env.SETTINGS_ADMISSION_STUB);
const args = process.argv.slice(2);
function selectedSource(name, original) {
  if (!cfg.moveAfterAdmission) return original;
  const path = cfg.log + '.' + name;
  const count = fs.existsSync(path) ? Number(fs.readFileSync(path, 'utf8')) : 0;
  fs.writeFileSync(path, String(count + 1));
  return count === 0 ? original : 'f'.repeat(40);
}
if (process.argv[1].endsWith('/git')) {
  if (args[0] === 'rev-parse') process.stdout.write(selectedSource('local', cfg.localSha || cfg.sourceSha));
  else if (args[0] === 'status') process.stdout.write(cfg.dirty || '');
  else if (args[0] === 'log' || args[0] === 'merge-base') fs.writeFileSync(cfg.log + '.history', args[0]);
  else process.exit(99);
} else if (args[0] === 'workflow') {
  fs.writeFileSync(cfg.log, JSON.stringify(args));
  process.exit(cfg.dispatchFailure ? 1 : 0);
} else {
  const endpoint = args[1]; let result;
  if (endpoint.includes('/git/ref/')) result = { object: { sha: selectedSource('remote', cfg.remoteSha || cfg.sourceSha) } };
  else if (endpoint.includes('/contents/')) result = { path: '.github/workflows/hosted-guest-acceptance.yml', type: 'file', encoding: 'base64', content: Buffer.from(cfg.workflow).toString('base64') };
  else if (endpoint.includes('/actions/secrets')) result = { secrets: cfg.noSecret ? [] : [{ name: 'MATRX_REVIEWER_MAGIC_LINK_JSON' }] };
  else if (endpoint.includes('/actions/workflows/')) result = { total_count: (cfg.runs || (endpoint.includes('hosted-resource-diagnostic') ? cfg.diagnosisRuns : []) || []).length, workflow_runs: cfg.runs || (endpoint.includes('hosted-resource-diagnostic') ? cfg.diagnosisRuns : []) || [] };
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
  const execute = (mode, change = {}, extra = [], guestCase = 'settings-controls') => {
    for (const name of ['local', 'remote', 'history']) rmSync(`${log}.${name}`, { force: true });
    const scrape = mode.endsWith('-scrape');
    const settingsGuest = mode.endsWith('-settings-guest');
    return spawnSync(
      process.execPath,
      [
        resolve('scripts/hosted-remote-admission.mjs'),
        mode,
        '--lane',
        scrape || settingsGuest ? 'B' : 'A',
        '--case',
        scrape
          ? 'guest-scrape-development'
          : settingsGuest
            ? guestCase
            : 'settings-account-popover-member',
        ...(scrape ? ['--scrape-scope', 'seo-schema-empty', '--auth-mode', 'guest'] : []),
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
          SETTINGS_ADMISSION_STUB: JSON.stringify({ ...state, ...change }),
        },
      },
    );
  };
  try {
    const plan = execute('plan-settings-member');
    assert.equal(plan.status, 0, plan.stderr);
    assert.equal(JSON.parse(plan.stdout).artifact.artifactId, input.developmentArtifactId);
    const guestPlan = execute('plan-settings-guest');
    assert.equal(guestPlan.status, 0, guestPlan.stderr);
    assert.deepEqual(
      JSON.parse(guestPlan.stdout).plan.args,
      admission.planHostedSettingsGuest({
        ...input,
        lane: 'B',
        acceptanceCase: 'settings-controls',
      }).args,
    );
    const capturePlan = execute('plan-settings-guest', {}, [], 'settings-auto-scrape-capture');
    assert.equal(capturePlan.status, 0, capturePlan.stderr);
    const captureExpected = [
      'workflow',
      'run',
      'hosted-guest-acceptance.yml',
      '--ref',
      'main',
      '-f',
      'acceptance_lane=B',
      '-f',
      'acceptance_case=settings-auto-scrape-capture',
      '-f',
      'requested_by=extend-stabilization',
      '-f',
      'scrape_auth_mode=guest',
      '-f',
      'runner_label=macos-15-intel',
      '-f',
      'development_run_id=38205458398',
      '-f',
      'development_artifact_id=11730000001',
    ];
    assert.deepEqual(JSON.parse(capturePlan.stdout).plan.args, captureExpected);
    for (const guestCase of ['settings-theme-rendering', 'settings-persistence', 'member-data']) {
      const refused = execute('dispatch-settings-guest', {}, [], guestCase);
      assert.notEqual(refused.status, 0);
      assert.match(refused.stderr, /HOSTED_SETTINGS_GUEST_CASE_MODE_MISMATCH/);
      assert.throws(() => readFileSync(log), /ENOENT/);
    }
    const captureExtra = execute(
      'dispatch-settings-guest',
      {},
      ['--auth-mode', 'member'],
      'settings-auto-scrape-capture',
    );
    assert.notEqual(captureExtra.status, 0);
    assert.match(captureExtra.stderr, /HOSTED_ARGUMENT_INVALID/);
    assert.throws(() => readFileSync(log), /ENOENT/);
    for (const [change, reason] of [
      [{ wrongArtifact: '11700000001' }, 'HOSTED_DEVELOPMENT_ARTIFACT_INVALID'],
      [
        { dirty: ' M .github/workflows/hosted-guest-acceptance.yml' },
        'HOSTED_DISPATCH_SOURCE_NOT_SYNCHRONIZED',
      ],
      [{ dirty: '?? unrelated-pending.ts' }, 'HOSTED_DISPATCH_SOURCE_NOT_SYNCHRONIZED'],
      [{ remoteSha: 'f'.repeat(40) }, 'HOSTED_DISPATCH_SOURCE_NOT_SYNCHRONIZED'],
      [
        { localSha: 'f'.repeat(40), remoteSha: 'f'.repeat(40) },
        'HOSTED_SETTINGS_MEMBER_SOURCE_DRIFT',
      ],
      [{ workflow: `${workflow}\n# unreviewed` }, 'HOSTED_WORKFLOW_BLOB_UNREVIEWED'],
      [
        { runs: [{ name: 'Native A · member-data', status: 'queued' }] },
        'HOSTED_SETTINGS_MEMBER_A_CAPACITY_REFUSED',
      ],
      [
        { diagnosisRuns: [{ name: 'Hosted resource diagnosis', status: 'in_progress' }] },
        'HOSTED_SETTINGS_MEMBER_A_CAPACITY_REFUSED',
      ],
      [{ noSecret: true }, 'HOSTED_SETTINGS_MEMBER_SECRET_MISSING'],
    ]) {
      const result = execute('dispatch-settings-member', change);
      assert.notEqual(result.status, 0, reason);
      assert.match(result.stderr, new RegExp(reason));
      assert.throws(() => readFileSync(log), /ENOENT/, 'refusal was bypassed with a dispatch');
    }
    const unknown = execute('dispatch-settings-member', {}, [
      '--startup-display-mode',
      'notes-cdp',
    ]);
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stderr, /HOSTED_ARGUMENT_INVALID/);
    // Local and remote both advance after initial admission; artifact selection stays frozen.
    for (const [mode, reason] of [
      ['dispatch-settings-member', 'HOSTED_SETTINGS_MEMBER_SOURCE_DRIFT'],
      ['dispatch-scrape', 'HOSTED_SCRAPE_SOURCE_DRIFT'],
    ]) {
      const moved = execute(mode, { moveAfterAdmission: true });
      assert.notEqual(moved.status, 0, reason);
      assert.match(moved.stderr, new RegExp(reason));
      assert.throws(() => readFileSync(log), /ENOENT/, 'source race reached workflow dispatch');
    }
    const result = execute('dispatch-settings-member', {
      runs: [{ name: 'Native B · guest-scrape-development', status: 'in_progress' }],
    });
    assert.equal(result.status, 0, result.stderr);
    assert.throws(
      () => readFileSync(`${log}.history`),
      /ENOENT/,
      'Settings queried Notes ancestry/history',
    );
    assert.deepEqual(JSON.parse(readFileSync(log)), [
      ...admission.planHostedSettingsMember(input).args,
      '-R',
      'armanisadeghi/matrx-extend',
    ]);
    rmSync(log);
    for (const [change, reason] of [
      [{ wrongArtifact: '11700000001' }, 'HOSTED_DEVELOPMENT_ARTIFACT_INVALID'],
      [{ dirty: '?? concurrent.ts' }, 'HOSTED_DISPATCH_SOURCE_NOT_SYNCHRONIZED'],
      [
        { localSha: 'f'.repeat(40), remoteSha: 'f'.repeat(40) },
        'HOSTED_SETTINGS_GUEST_SOURCE_DRIFT',
      ],
      [{ workflow: `${workflow}\n# unreviewed` }, 'HOSTED_WORKFLOW_BLOB_UNREVIEWED'],
      [
        { runs: [{ name: 'Native B · settings-controls', status: 'in_progress' }] },
        'HOSTED_SETTINGS_GUEST_B_CAPACITY_REFUSED',
      ],
      [
        { diagnosisRuns: [{ name: 'Hosted resource diagnosis', status: 'queued' }] },
        'HOSTED_SETTINGS_GUEST_B_CAPACITY_REFUSED',
      ],
    ]) {
      const refused = execute('dispatch-settings-guest', change);
      assert.notEqual(refused.status, 0, reason);
      assert.match(refused.stderr, new RegExp(reason));
      assert.throws(() => readFileSync(log), /ENOENT/);
    }
    const guestUnknown = execute('dispatch-settings-guest', {}, ['--auth-mode', 'member']);
    assert.notEqual(guestUnknown.status, 0);
    assert.match(guestUnknown.stderr, /HOSTED_ARGUMENT_INVALID/);
    const guestMoved = execute('dispatch-settings-guest', { moveAfterAdmission: true });
    assert.notEqual(guestMoved.status, 0);
    assert.match(guestMoved.stderr, /HOSTED_SETTINGS_GUEST_SOURCE_DRIFT/);
    assert.throws(() => readFileSync(log), /ENOENT/);
    const guestResult = execute('dispatch-settings-guest', {
      runs: [{ name: 'Native A · settings-account-popover-member', status: 'in_progress' }],
      noSecret: true,
    });
    assert.equal(guestResult.status, 0, guestResult.stderr);
    assert.deepEqual(JSON.parse(readFileSync(log)), [
      ...admission.planHostedSettingsGuest({
        ...input,
        lane: 'B',
        acceptanceCase: 'settings-controls',
      }).args,
      '-R',
      'armanisadeghi/matrx-extend',
    ]);
    rmSync(log);
    const captureDispatch = execute(
      'dispatch-settings-guest',
      {},
      [],
      'settings-auto-scrape-capture',
    );
    assert.equal(captureDispatch.status, 0, captureDispatch.stderr);
    assert.deepEqual(JSON.parse(readFileSync(log)), [
      ...captureExpected,
      '-R',
      'armanisadeghi/matrx-extend',
    ]);
    rmSync(log);
    const failed = execute('dispatch-settings-member', { dispatchFailure: true });
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /HOSTED_DISPATCH_FAILED/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}
function commit(root, path, content) {
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), content);
  git(root, 'add', '--', path);
  git(root, 'commit', '-qm', 'Update input');
  return git(root, 'rev-parse', 'HEAD');
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'hosted-equivalence-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'Artifact guard');
  git(root, 'config', 'user.email', 'artifact-guard@test.invalid');
  const artifactSha = commit(root, 'src/panel.js', 'runtime');
  const run = {
    name: 'CI',
    path: '.github/workflows/ci.yml',
    event: 'push',
    head_branch: 'main',
    conclusion: 'success',
    head_sha: artifactSha,
    run_attempt: 1,
  };
  const artifact = {
    id: 123,
    expired: false,
    name: `matrx-extend-development-test-${artifactSha}-456-1`,
    digest: `sha256:${'b'.repeat(64)}`,
  };
  const fetchJson = (endpoint) =>
    endpoint.includes('/artifacts?') ? { artifacts: [artifact] } : run;
  const admit = (sourceSha, extra = {}) =>
    requireDevelopmentArtifact(
      {
        runId: '456',
        artifactId: '123',
        sourceSha,
        allowRuntimeEquivalent: true,
        repoRoot: root,
        ...extra,
      },
      fetchJson,
    );
  return { root, artifactSha, admit, run, artifact };
}

test('docs-only main accepts previous successful CI bytes and preserves original artifact identity', () => {
  const f = fixture();
  try {
    const main = commit(f.root, 'docs/stabilization/reports/seo.json', '{}');
    git(f.root, 'update-ref', 'refs/remotes/origin/main', main);
    const result = f.admit(main);
    assert.equal(result.sourceSha, f.artifactSha);
    assert.equal(result.compatibility, 'runtime-equivalent');
    assert.equal(result.mainSha, main);
    assert.equal(result.githubArtifactDigest, `sha256:${'b'.repeat(64)}`);
    assert.throws(
      () => f.admit(main, { allowRuntimeEquivalent: false }),
      /HOSTED_DEVELOPMENT_RUN_INVALID/,
    );
    assert.throws(
      () => f.admit(main, { expectedDigest: `sha256:${'c'.repeat(64)}` }),
      /HOSTED_DEVELOPMENT_ARTIFACT_DIGEST_MISMATCH/,
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

for (const path of [
  'src/panel.js',
  'wxt.config.ts',
  '.github/workflows/ci.yml',
  'package.json',
  'pnpm-lock.yaml',
  '.env',
  'unknown.txt',
  'docs/stabilization/resource-policy.json',
  'docs/stabilization/evidence/runtime.js',
]) {
  test(`refuses runtime/build/unknown history at ${path} even after revert`, () => {
    const f = fixture();
    try {
      commit(f.root, path, 'changed');
      const main = commit(f.root, path, 'runtime');
      git(f.root, 'update-ref', 'refs/remotes/origin/main', main);
      assert.throws(() => f.admit(main), /HOSTED_DEVELOPMENT_RUNTIME_SOURCE_DRIFT/);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
}

test('refuses unsynchronized and pending runtime inputs', () => {
  const f = fixture();
  try {
    const main = commit(f.root, 'docs/stabilization/reports/seo.json', '{}');
    git(f.root, 'update-ref', 'refs/remotes/origin/main', f.artifactSha);
    assert.throws(() => f.admit(main), /HOSTED_DEVELOPMENT_RUNTIME_SOURCE_DRIFT/);
    git(f.root, 'update-ref', 'refs/remotes/origin/main', main);
    writeFileSync(join(f.root, 'src/panel.js'), 'pending runtime');
    assert.throws(() => f.admit(main), /HOSTED_DEVELOPMENT_RUNTIME_SOURCE_DRIFT/);
    writeFileSync(join(f.root, 'src/panel.js'), 'runtime');
    assert.equal(f.admit(main).sourceSha, f.artifactSha);
    f.run.conclusion = 'failure';
    assert.throws(() => f.admit(main), /HOSTED_DEVELOPMENT_RUN_INVALID/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

// SUT owns source/identity validation and dispatch ordering; only GitHub is doubled.
test('normal guest SEO CLI dispatch reuses docs-equivalent CI and refuses tracked/untracked docs, runtime or moving main', () => {
  const f = fixture();
  try {
    const main = commit(f.root, 'docs/stabilization/reports/seo.json', '{}');
    git(f.root, 'update-ref', 'refs/remotes/origin/main', main);
    const bin = join(f.root, 'test-bin');
    mkdirSync(bin);
    // Keep the external command double outside Git's pending input census.
    writeFileSync(join(f.root, '.git/info/exclude'), '/test-bin/\n/dispatch.json\n');
    const log = join(f.root, 'dispatch.json');
    const stub = join(bin, 'gh');
    writeFileSync(
      stub,
      `#!/usr/bin/env node
const fs = require('node:fs');
const cfg = JSON.parse(process.env.SEO_ADMISSION_STUB);
const args = process.argv.slice(2);
if (args[0] === 'workflow') {
  fs.writeFileSync(cfg.log, JSON.stringify(args));
} else {
  const endpoint = args[1];
  let result;
  if (endpoint.includes('/git/ref/')) result = { object: { sha: cfg.remoteSha } };
  else if (endpoint.includes('/artifacts?')) result = { artifacts: [cfg.artifact] };
  else result = cfg.run;
  process.stdout.write(JSON.stringify(result));
}
`,
    );
    chmodSync(stub, 0o755);
    const execute = (remoteSha = main) =>
      spawnSync(
        process.execPath,
        [
          resolve('scripts/hosted-remote-admission.mjs'),
          'dispatch-guest-seo',
          '--lane',
          'B',
          '--case',
          'guest-seo',
          '--seo-case-scope',
          'notice-stacked',
          '--seo-metadata-fixture',
          'none',
          '--seo-resource-diagnostic',
          'false',
          '--seo-interrupt-after-target',
          'none',
          '--runner-label',
          'macos-15-intel',
          '--development-run-id',
          '456',
          '--development-artifact-id',
          '123',
          '--source-sha',
          main,
        ],
        {
          cwd: f.root,
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            SEO_ADMISSION_STUB: JSON.stringify({
              run: f.run,
              artifact: f.artifact,
              remoteSha,
              log,
            }),
          },
        },
      );
    const admitted = execute();
    assert.equal(admitted.status, 0, admitted.stderr);
    const receipt = JSON.parse(admitted.stdout);
    assert.equal(receipt.artifact.sourceSha, f.artifactSha);
    assert.equal(receipt.artifact.mainSha, main);
    assert.equal(receipt.artifact.compatibility, 'runtime-equivalent');
    assert.ok(JSON.parse(readFileSync(log, 'utf8')).includes('development_run_id=456'));
    rmSync(log);
    writeFileSync(join(f.root, 'docs/stabilization/reports/seo.json'), 'pending docs');
    const pendingDocs = execute();
    assert.notEqual(pendingDocs.status, 0);
    assert.match(pendingDocs.stderr, /HOSTED_DISPATCH_SOURCE_NOT_SYNCHRONIZED/);
    assert.throws(() => readFileSync(log), { code: 'ENOENT' });
    writeFileSync(join(f.root, 'docs/stabilization/reports/seo.json'), '{}');
    const untrackedDoc = join(f.root, 'docs/stabilization/reports/pending.json');
    writeFileSync(untrackedDoc, '{}');
    const untrackedDocs = execute();
    assert.notEqual(untrackedDocs.status, 0);
    assert.match(untrackedDocs.stderr, /HOSTED_DISPATCH_SOURCE_NOT_SYNCHRONIZED/);
    assert.throws(() => readFileSync(log), { code: 'ENOENT' });
    rmSync(untrackedDoc);
    const moved = execute('f'.repeat(40));
    assert.notEqual(moved.status, 0);
    assert.throws(() => readFileSync(log), { code: 'ENOENT' });
    writeFileSync(join(f.root, 'src/panel.js'), 'pending runtime');
    const dirty = execute();
    assert.notEqual(dirty.status, 0);
    assert.match(dirty.stderr, /HOSTED_DEVELOPMENT_RUNTIME_SOURCE_DRIFT/);
    assert.throws(() => readFileSync(log), { code: 'ENOENT' });
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('hosted runner proves its actual immutable checkout before product acceptance', () => {
  const f = fixture();
  try {
    const main = commit(f.root, 'docs/stabilization/reports/seo.json', '{}');
    git(f.root, 'update-ref', 'refs/remotes/origin/main', main);
    assert.equal(
      requireHostedDevelopmentCheckout(f.root, f.artifactSha, main).compatibility,
      'runtime-equivalent',
    );
    assert.throws(
      () => requireHostedDevelopmentCheckout(f.root, f.artifactSha, f.artifactSha),
      /HOSTED_DEVELOPMENT_CHECKOUT_INVALID/,
    );
    assert.throws(
      () => requireHostedDevelopmentCheckout(f.root, f.artifactSha, undefined),
      /HOSTED_DEVELOPMENT_CHECKOUT_INVALID/,
    );
    const moved = commit(f.root, 'src/panel.js', 'new runtime after dispatch');
    git(f.root, 'update-ref', 'refs/remotes/origin/main', moved);
    assert.throws(
      () => requireHostedDevelopmentCheckout(f.root, f.artifactSha, moved),
      /ci_dev_runtime_source_changed/,
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
