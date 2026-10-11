import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  planHostedMemberData,
  requireExactArchiveJournalSet,
  requireHostedWorkflowContract,
  verifyHostedResourceJournals,
} from './hosted-remote-admission.mjs';

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
