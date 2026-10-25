import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import {
  newReport,
  observeFocusedGuestPhase,
  recordFocusedBuildProvenance,
  requireFocusedImportedEvidence,
  runFocusedGuestSequence,
} from './settings-guest-admin-absence-native.mjs';

const guestIdentity = {
  active: true,
  accessTokenPresent: false,
  profilePresent: false,
  organizationChoicePresent: false,
  accountSectionCount: 1,
  accountOpen: true,
  emailRowCount: 1,
  emailUnavailable: true,
  footerSignInCount: 1,
  footerSignOutCount: 0,
};

function documentFor({
  active = true,
  signIn = true,
  sections = ['Account', 'Organization', 'Appearance'],
  text = '',
  permissionControlCount = 0,
} = {}) {
  const pane = {
    innerText: text,
    matches: (selector) => selector === '[role="tabpanel"][data-state="active"]',
    querySelectorAll(selector) {
      if (selector === 'button') return [{ textContent: signIn ? 'Sign in' : 'Sign out' }];
      if (selector === 'button[aria-expanded]')
        return sections.map((name) => ({ textContent: name }));
      if (selector === '[aria-label="DevTools Protocol permission"]')
        return Array.from({ length: permissionControlCount }, () => ({}));
      throw new Error(`unexpected DOM selector: ${selector}`);
    },
  };
  return {
    querySelectorAll(selector) {
      assert.equal(selector, 'button[role="tab"][data-state="active"]');
      return active
        ? [
            {
              title: 'Settings',
              getAttribute: (name) =>
                name === 'title' ? 'Settings' : name === 'aria-controls' ? 'settings-pane' : null,
            },
          ]
        : [];
    },
    getElementById: (id) => (id === 'settings-pane' ? pane : null),
  };
}

function panel(targetId, { dom = documentFor(), identity = guestIdentity } = {}) {
  return {
    targetId,
    async send(method, { expression }) {
      assert.equal(method, 'Runtime.evaluate');
      const value = expression.includes("'matrx.oauth.session'")
        ? identity
        : runInNewContext(expression, { document: dom });
      return { result: { value } };
    },
  };
}

const prepared = async () => {};

test('focused native build report carries the validated exact CI source, run, artifact and digest', () => {
  const evidence = {
    schema_version: 1,
    kind: 'ci_development_test',
    eligibleStore: false,
    publish_state: 'not_published',
    repository: 'armanisadeghi/matrx-extend',
    workflow: '.github/workflows/ci.yml',
    sourceSha: 'a'.repeat(40),
    runId: 39360000000,
    runAttempt: 1,
    artifactId: 12240000000,
    githubArtifactDigest: `sha256:${'b'.repeat(64)}`,
    version: '0.2.568',
    treeSha256: 'c'.repeat(64),
  };
  const expected = {
    expectedSourceSha: evidence.sourceSha,
    expectedRunId: String(evidence.runId),
    expectedArtifactId: String(evidence.artifactId),
    expectedVersion: evidence.version,
    expectedTreeSha256: evidence.treeSha256,
  };
  const report = newReport();
  const reportBuild = recordFocusedBuildProvenance(report, evidence, expected);
  assert.deepEqual(report.build, reportBuild);
  assert.deepEqual(
    [
      reportBuild.sourceSha,
      reportBuild.runId,
      reportBuild.runAttempt,
      reportBuild.artifactId,
      reportBuild.githubArtifactDigest,
    ],
    [evidence.sourceSha, evidence.runId, 1, evidence.artifactId, evidence.githubArtifactDigest],
  );
  for (const dropped of [
    'sourceSha',
    'runId',
    'runAttempt',
    'artifactId',
    'githubArtifactDigest',
  ]) {
    const changed = { ...evidence };
    delete changed[dropped];
    assert.throws(() => requireFocusedImportedEvidence(changed, expected));
  }
  assert.throws(
    () =>
      requireFocusedImportedEvidence(evidence, {
        ...expected,
        expectedSourceSha: 'd'.repeat(40),
      }),
    /development artifact is not exact hosted source/,
  );
});

test('focused actual guest Settings recorder fails missing active pane, anchor, identity, or present admin control', async () => {
  const good = newReport();
  assert.equal(
    await observeFocusedGuestPhase({
      panel: panel('warm'),
      phase: 'fresh',
      report: good,
      prepareSettings: prepared,
    }),
    true,
  );
  assert.deepEqual(
    good.cases.map((record) => record.criteria.map((entry) => entry.status)),
    [
      ['pass', 'pass'],
      ['pass', 'pass'],
    ],
  );

  for (const changed of [
    { dom: documentFor({ active: false }) },
    { dom: documentFor({ sections: ['Account', 'Appearance'] }) },
    { dom: documentFor({ signIn: false }) },
    { dom: documentFor({ text: 'Audit key' }) },
    { dom: documentFor({ permissionControlCount: 1 }) },
    { identity: { ...guestIdentity, accessTokenPresent: true } },
  ]) {
    const report = newReport();
    assert.equal(
      await observeFocusedGuestPhase({
        panel: panel('bad', changed),
        phase: 'fresh',
        report,
        prepareSettings: prepared,
      }),
      false,
    );
    assert.ok(
      report.cases.every((record) => record.criteria.some((entry) => entry.status === 'fail')),
    );
  }
});

test('focused sequence requires real replacement lifecycle and original page, then leaves T63 member clause unverified', async () => {
  let normalTargetId = 'normal-page';
  const browserSession = {
    async send(method) {
      assert.equal(method, 'Target.getTargets');
      return {
        targetInfos: [{ type: 'page', url: 'http://127.0.0.1/owned', targetId: normalTargetId }],
      };
    },
  };
  const page = { url: () => 'http://127.0.0.1/owned' };
  const warm = panel('panel-before');
  const reloaded = panel('panel-after');
  const realReceipt = () => ({
    management_reload_clicked: true,
    old_targets_retired: true,
    worker_replaced: true,
    panel_replaced: true,
    retirement_evidence: { timeline: { final_predicate: true } },
    replacement_panel_target_id: reloaded.targetId,
    panel: reloaded,
  });
  const input = { panel: warm, browserSession, page, prepareSettings: prepared };
  const report = newReport();
  await runFocusedGuestSequence({ ...input, report, reloadExtension: async () => realReceipt() });
  assert.equal(report.cases[0].status, 'pass');
  assert.equal(report.cases[1].status, 'unverified');
  assert.equal(
    report.cases[1].criteria.at(-1).name,
    'ordinary-member denial before and after reload',
  );
  assert.equal(report.focused_guest_subtargets_status, 'pass');
  assert.equal(report.status, 'partial');

  for (const changed of [
    { dom: documentFor({ active: false }) },
    { dom: documentFor({ sections: ['Account', 'Appearance'] }) },
    { dom: documentFor({ text: 'Permission gate' }) },
  ]) {
    const badReplacement = panel('panel-after', changed);
    await assert.rejects(
      runFocusedGuestSequence({
        ...input,
        report: newReport(),
        reloadExtension: async () => ({
          ...realReceipt(),
          panel: badReplacement,
          replacement_panel_target_id: badReplacement.targetId,
        }),
      }),
      /focused_guest_reloaded_observation_failed/,
    );
  }

  for (const fakeReload of [
    { ...realReceipt(), management_reload_clicked: false },
    { ...realReceipt(), old_targets_retired: false },
    { ...realReceipt(), worker_replaced: false },
    { ...realReceipt(), panel_replaced: false },
    { ...realReceipt(), retirement_evidence: { timeline: { final_predicate: false } } },
    { ...realReceipt(), panel: warm, replacement_panel_target_id: warm.targetId },
  ]) {
    await assert.rejects(
      runFocusedGuestSequence({
        ...input,
        report: newReport(),
        reloadExtension: async () => fakeReload,
      }),
    );
  }
  normalTargetId = 'wrong-page';
  await assert.rejects(
    runFocusedGuestSequence({
      ...input,
      report: newReport(),
      reloadExtension: async () => {
        normalTargetId = 'changed-after-fresh';
        return realReceipt();
      },
    }),
    /original normal page target changed/,
  );
});
