import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { restoreMemberForegroundWithReport } from './member-chat-visible-proof.mjs';
import {
  recordMemberForegroundVisibility,
  restoreMemberForeground,
} from './member-foreground-diagnostic.mjs';

function foregroundCase({ failAt = null, visible = true, reportOutput = null } = {}) {
  const events = [];
  let webClosed = false;
  let rootActive = false;
  let panelOpened = false;
  const diagnostic = {
    steps: [],
    visibility_observations: [],
    failure_substep: null,
    failure_class: null,
    failure_snapshot: null,
  };
  const web = {
    isClosed: () => webClosed,
    close: async () => {
      events.push('web_close');
      if (failAt === 'web_close') throw new Error('Target closed');
      webClosed = true;
    },
  };
  const page = {
    isClosed: () => false,
    bringToFront: async () => {
      assert.equal(webClosed, true);
      events.push('root_foreground');
      if (failAt === 'root_foreground') throw new Error('Protocol error');
      rootActive = true;
    },
  };
  const native = {
    panelTarget: { targetId: 'owned-panel' },
    browserSession: {
      send: async () => ({
        targetInfos: failAt === 'web_close' ? [] : [{ targetId: 'owned-panel' }],
      }),
    },
    transportFailureClass: () => 'none',
    reopenPanel: async () => {
      assert.equal(rootActive, true);
      events.push('panel_reopen');
      recordMemberForegroundVisibility(diagnostic, {
        phase: 'before_reopen',
        measured: true,
        visibility: 'hidden',
        secret: 'must-not-enter-report',
      });
      if (failAt === 'panel_reopen') throw new Error('native_sidepanel_open_refused:private');
      panelOpened = true;
    },
  };
  const evaluate = async (_panel, expression) => {
    assert.equal(expression, 'document.visibilityState');
    return panelOpened && visible ? 'visible' : 'hidden';
  };
  const waitFor = async (_label, read, accepts, timeout) => {
    assert.equal(timeout, 10_000);
    events.push('visibility_wait');
    if (!accepts(await read())) throw new Error('reviewer_native_panel_foreground_not_observed');
  };
  let tick = 0;
  return {
    events,
    diagnostic,
    run: () => {
      const options = {
        web,
        page,
        native,
        panel: {},
        waitFor,
        evaluate,
        diagnostic,
        onFailure: async () => {
          assert.ok(diagnostic.failure_snapshot);
          events.push('report_saved');
        },
        now: () => ++tick,
      };
      if (!reportOutput) return restoreMemberForeground(options);
      const { diagnostic: _diagnostic, onFailure: _onFailure, ...runnerOptions } = options;
      return restoreMemberForegroundWithReport({
        ...runnerOptions,
        output: reportOutput.output,
        report: reportOutput.report,
        stage: 'reviewer_native_panel_foreground',
      }).finally(() => events.push('report_saved'));
    },
  };
}

test('member foreground performs all four real operations in order and accepts visible panel', async () => {
  const scenario = foregroundCase();
  await scenario.run();
  assert.deepEqual(scenario.events, [
    'web_close',
    'root_foreground',
    'panel_reopen',
    'visibility_wait',
  ]);
  assert.deepEqual(
    scenario.diagnostic.steps.map((row) => [row.name, row.completed_ms !== null]),
    [
      ['web_close', true],
      ['root_foreground', true],
      ['panel_reopen', true],
      ['visibility_wait', true],
    ],
  );
  assert.equal(scenario.diagnostic.failure_class, null);
});

test('member foreground persists a bounded failure before native cleanup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'member-foreground-report-'));
  try {
    const output = join(directory, 'report.json');
    const report = { status: 'unverified', foreground_diagnostic: null };
    const scenario = foregroundCase({ failAt: 'panel_reopen', reportOutput: { output, report } });
    report.foreground_diagnostic = scenario.diagnostic;
    await assert.rejects(scenario.run, /native_sidepanel_open_refused/);
    const persisted = JSON.parse(await readFile(output, 'utf8'));
    scenario.events.push('native_cleanup');
    assert.deepEqual(scenario.events.slice(-3), ['panel_reopen', 'report_saved', 'native_cleanup']);
    assert.equal(persisted.failure_stage, 'reviewer_native_panel_foreground');
    assert.equal(persisted.failure_code, 'unclassified_failure');
    assert.equal(persisted.foreground_diagnostic.failure_substep, 'panel_reopen');
    assert.equal(persisted.foreground_diagnostic.failure_class, 'opener_refused');
    assert.equal(persisted.foreground_diagnostic.failure_snapshot.exact_panel_target_present, true);
    assert.doesNotMatch(JSON.stringify(persisted), /private|must-not-enter-report/);
    const otherOutput = join(directory, 'closed-target.json');
    const otherReport = { status: 'unverified', foreground_diagnostic: null };
    const closed = foregroundCase({
      failAt: 'web_close',
      reportOutput: { output: otherOutput, report: otherReport },
    });
    otherReport.foreground_diagnostic = closed.diagnostic;
    await assert.rejects(closed.run, /Target closed/);
    const otherPersisted = JSON.parse(await readFile(otherOutput, 'utf8'));
    assert.equal(otherPersisted.foreground_diagnostic.failure_substep, 'web_close');
    assert.equal(otherPersisted.foreground_diagnostic.failure_class, 'target_closed');
    assert.equal(
      otherPersisted.foreground_diagnostic.failure_snapshot.exact_panel_target_present,
      false,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('member foreground writes no failure report when visibility is restored', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'member-foreground-success-'));
  try {
    const output = join(directory, 'report.json');
    const report = { status: 'unverified', foreground_diagnostic: null };
    const scenario = foregroundCase({ reportOutput: { output, report } });
    report.foreground_diagnostic = scenario.diagnostic;
    await scenario.run();
    await assert.rejects(access(output), { code: 'ENOENT' });
    assert.equal(report.foreground_diagnostic.failure_substep, null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('member foreground captures failing substep and fixed class without raw opener detail', async () => {
  const scenario = foregroundCase({ failAt: 'panel_reopen' });
  await assert.rejects(scenario.run, /native_sidepanel_open_refused/);
  assert.equal(scenario.diagnostic.failure_substep, 'panel_reopen');
  assert.deepEqual(scenario.events.slice(-2), ['panel_reopen', 'report_saved']);
  assert.equal(scenario.diagnostic.failure_class, 'opener_refused');
  assert.deepEqual(scenario.diagnostic.failure_snapshot, {
    web_closed: true,
    root_closed: false,
    targets_measured: true,
    exact_panel_target_present: true,
    visibility_measured: true,
    panel_visible: false,
    panel_hidden: true,
  });
  assert.equal(JSON.stringify(scenario.diagnostic).includes('private'), false);
  assert.equal(JSON.stringify(scenario.diagnostic).includes('must-not-enter-report'), false);
});

test('member foreground refuses hidden panel and records visibility timeout', async () => {
  const scenario = foregroundCase({ visible: false });
  await assert.rejects(scenario.run, /not_observed/);
  assert.equal(scenario.diagnostic.failure_substep, 'visibility_wait');
  assert.equal(scenario.diagnostic.failure_class, 'timeout');
  assert.equal(scenario.diagnostic.failure_snapshot.panel_hidden, true);
});

test('member foreground distinguishes closed target before root foreground', async () => {
  const scenario = foregroundCase({ failAt: 'web_close' });
  await assert.rejects(scenario.run, /Target closed/);
  assert.deepEqual(scenario.events, ['web_close', 'report_saved']);
  assert.equal(scenario.diagnostic.failure_substep, 'web_close');
  assert.equal(scenario.diagnostic.failure_class, 'target_closed');
  assert.equal(scenario.diagnostic.failure_snapshot.exact_panel_target_present, false);
});
