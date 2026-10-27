import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { Window } from 'happy-dom';
import * as driverDiagnostics from './data-member-driver-diagnostic.mjs';
import {
  captureDataMemberDriverDiagnostic,
  recordDataMemberDriverDiagnostic,
} from './data-member-driver-diagnostic.mjs';
import { activeTabPanelExpression, evaluate, waitFor } from './settings-panel-driver.mjs';
import { click } from './settings-panel-driver.mjs';

function makePanel({ duplicate = false, hidden = false } = {}) {
  const window = new Window({ url: 'https://catalog.test/products' });
  window.document.body.innerHTML = `
    <button role="tab" title="Data" data-state="${hidden ? 'inactive' : 'active'}" aria-selected="${hidden ? 'false' : 'true'}" aria-controls="data-pane" ${hidden ? 'style="display:none"' : ''}></button>
    <div id="data-pane" role="tabpanel" data-state="${hidden ? 'inactive' : 'active'}"></div>
    ${duplicate ? '<button title="Data"></button>' : ''}`;
  const target = window.document.querySelector('button[title="Data"]');
  const rect = { x: 10, y: 10, left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30 };
  for (const button of window.document.querySelectorAll('button[title="Data"]'))
    button.getBoundingClientRect = () => rect;
  target.scrollIntoView = () => {};
  target.getAnimations = () => [];
  window.HTMLElement.prototype.getAnimations = () => [];
  window.document.elementFromPoint = () => target;
  const events = [];
  return {
    events,
    window,
    panel: {
      async send(method, args) {
        if (method === 'Runtime.evaluate')
          return { result: { value: window.eval(args.expression) } };
        if (method === 'Input.dispatchMouseEvent') events.push(args.type);
        return {};
      },
    },
  };
}

test('member Data reopen diagnostic records multiple visible title targets without clicking', async () => {
  const { panel, window, events } = makePanel({ duplicate: true });
  try {
    await assert.rejects(click(panel, 'title', 'Data'), (error) => {
      const report = { status: 'unverified' };
      assert.deepEqual(recordDataMemberDriverDiagnostic(error, report), {
        code: 'pointer_target_not_unique',
        sample_stage: 'visibility_filter',
        matched_target_count: 2,
        visible_target_count: 2,
        data_tab: {
          matching_tab_count: 1,
          visible_tab_count: 1,
          active_tab_count: 1,
          active_data_pane_count: 1,
        },
      });
      assert.deepEqual(report.driver_diagnostic, {
        code: 'pointer_target_not_unique',
        sample_stage: 'visibility_filter',
        matched_target_count: 2,
        visible_target_count: 2,
        data_tab: {
          matching_tab_count: 1,
          visible_tab_count: 1,
          active_tab_count: 1,
          active_data_pane_count: 1,
        },
      });
      assert.equal(report.status, 'unverified');
      assert.deepEqual(events, [], 'ambiguous target must not dispatch a click');
      return true;
    });
  } finally {
    window.happyDOM.abort();
  }
});

test('member Data reopen diagnostic distinguishes a hidden title target from duplicate visible targets', async () => {
  const { panel, window, events } = makePanel({ hidden: true });
  try {
    await assert.rejects(click(panel, 'title', 'Data'), (error) => {
      const report = { status: 'unverified' };
      assert.deepEqual(recordDataMemberDriverDiagnostic(error, report), {
        code: 'pointer_target_not_unique',
        sample_stage: 'visibility_filter',
        matched_target_count: 1,
        visible_target_count: 0,
        data_tab: {
          matching_tab_count: 1,
          visible_tab_count: 0,
          active_tab_count: 0,
          active_data_pane_count: 0,
        },
      });
      assert.deepEqual(report.driver_diagnostic, {
        code: 'pointer_target_not_unique',
        sample_stage: 'visibility_filter',
        matched_target_count: 1,
        visible_target_count: 0,
        data_tab: {
          matching_tab_count: 1,
          visible_tab_count: 0,
          active_tab_count: 0,
          active_data_pane_count: 0,
        },
      });
      assert.equal(report.status, 'unverified');
      assert.deepEqual(events, [], 'hidden target must not dispatch a click');
      return true;
    });
  } finally {
    window.happyDOM.abort();
  }
});

test('member Data diagnostic refuses unsupported and unbounded failure detail', () => {
  assert.equal(
    captureDataMemberDriverDiagnostic({
      driverFailure: { code: 'pointer_initial_evaluation_failed' },
    }),
    null,
  );
  const diagnostic = captureDataMemberDriverDiagnostic({
    driverFailure: {
      code: 'pointer_target_not_unique',
      sampleStage: 'visibility_filter',
      matchedTargetCount: Number.MAX_SAFE_INTEGER,
      visibleMatchCount: 1,
      dataTabTargetDiagnostic: {
        matching_tab_count: 1,
        visible_tab_count: 1,
        active_tab_count: 1,
        active_data_pane_count: 1,
        rawText: 'must not persist',
      },
    },
  });
  assert.deepEqual(diagnostic, {
    code: 'pointer_target_not_unique',
    sample_stage: 'visibility_filter',
    matched_target_count: null,
    visible_target_count: 1,
    data_tab: {
      matching_tab_count: 1,
      visible_tab_count: 1,
      active_tab_count: 1,
      active_data_pane_count: 1,
    },
  });
});

// This executes the real CLI name-entry/dataState/outer-reporting blocks; it does not prove Chrome or React behavior.
async function runNameEntryScenario(scenario, mutation = null) {
  const beforeUnavailable = ['read_failure', 'read_and_click_failure'].includes(scenario);
  const afterUnavailable = ['after_read_failure', 'read_and_wait_failure'].includes(scenario);
  const clickFailure = ['click_failure', 'read_and_click_failure'].includes(scenario);
  const wrongFocus = ['wrong_focus', 'read_and_wait_failure'].includes(scenario);
  let source = await readFile(
    new URL('./data-member-native-acceptance.mjs', import.meta.url),
    'utf8',
  );
  if (mutation === 'drop_catch')
    source = source.replace('  recordDataMemberDriverDiagnostic(error, report);', '');
  if (mutation === 'drop_wait_callback')
    source = source.replace('        dataMemberNameEntrySample,', '');
  if (mutation === 'drop_after_click')
    source = source.replace(
      / {6}await observeDataMemberNameEntry\(report, 'after_click',[\s\S]*?\);/,
      '',
    );
  let diagnosticApi = driverDiagnostics;
  if (mutation === 'constant_projector') {
    let moduleSource = await readFile(
      new URL('./data-member-driver-diagnostic.mjs', import.meta.url),
      'utf8',
    );
    const projectionStart = moduleSource.indexOf('export function dataMemberNameEntrySample(');
    const projectionEnd = moduleSource.indexOf('/** Diagnostic reads', projectionStart);
    assert.ok(projectionStart > 0 && projectionEnd > projectionStart);
    moduleSource = `${moduleSource.slice(0, projectionStart)}export function dataMemberNameEntrySample() { return {sampled:true, read_failure_category:null, active:true, input_count:1, focused:false, nonempty:false, value_length:0, expected_length:29, matches:false, document_time_origin:10}; }\n${moduleSource.slice(projectionEnd)}`;
    diagnosticApi = new Function(
      `${moduleSource.replaceAll('export ', '')};return {recordDataMemberDriverDiagnostic, observeDataMemberNameEntry, dataMemberNameEntrySample};`,
    )();
  }
  const codeStart = source.indexOf('function safeFailureCode(');
  const codeEnd = source.indexOf('\nasync function deleteSavedPattern', codeStart);
  assert.ok(codeStart > 0 && codeEnd > codeStart);
  const actualSafeFailureCode = new Function(
    `${source.slice(codeStart, codeEnd)};return safeFailureCode;`,
  )();
  const stateStart = source.indexOf('async function dataState(');
  const stateEnd = source.indexOf('\nasync function extractionState', stateStart);
  const start = source.indexOf("      report.stage = 'save_pattern';");
  const end = source.indexOf('      const observer = observePatternWrites(', start);
  const catchStart = source.lastIndexOf('} catch (error) {');
  const catchEnd = source.indexOf('} finally {', catchStart);
  assert.ok(
    stateStart > 0 && stateEnd > stateStart && start > 0 && end > start && catchEnd > catchStart,
  );
  const window = new Window();
  try {
    window.document.body.innerHTML =
      '<button role="tab" title="Data" data-state="active" aria-controls="pane"></button><div id="pane" role="tabpanel" data-state="active"><input placeholder="Pattern name…"><button>Save pattern</button></div>';
    const expected = 'CANARY_owned_pattern_identity';
    let input = window.document.querySelector('input');
    if (scenario === 'prefill') input.value = 'CANARY_private_prefill';
    const events = [];
    let reads = 0;
    let documentOrigin = 10;
    const primary = new Error('CANARY_private_primary');
    let caught;
    const report = { observations: {} };
    const panel = {
      async send(method, params) {
        if (method === 'Runtime.evaluate') {
          reads++;
          if (scenario === 'wait_read_failure' && reads > 3)
            throw new Error('Target closed CANARY_private_read');
          if ((beforeUnavailable && reads === 1) || (afterUnavailable && reads === 2))
            throw new Error('CANARY_private_read');
          return {
            result: {
              value: runInNewContext(params.expression, {
                document: window.document,
                performance: { timeOrigin: documentOrigin },
              }),
            },
          };
        }
        events.push(method);
        if (method === 'Input.insertText') {
          assert.equal(params.text, expected);
          if (scenario === 'document_changed') documentOrigin = 20;
          if (scenario === 'remount') {
            const replacement = input.cloneNode();
            input.replaceWith(replacement);
            input = replacement;
          }
          if (window.document.activeElement === input) input.value += params.text;
        }
        return {};
      },
    };
    const deps = {
      report,
      panel,
      patternName: expected,
      assert,
      activeTabPanelExpression,
      evaluate,
      click: async (_panel, kind, label) => {
        events.push('click');
        assert.equal(kind, 'data-pattern-name');
        assert.equal(label, 'Pattern name…');
        if (clickFailure) throw primary;
        if (!wrongFocus) input.focus();
      },
      waitFor: async (...args) => {
        events.push('wait');
        try {
          return await waitFor(args[0], args[1], args[2], 1, args[4]);
        } catch (error) {
          caught = error;
          throw error;
        }
      },
      safeFailureCode: (error) => {
        if (clickFailure) assert.equal(error, primary);
        else {
          assert.equal(error, caught);
          assert.doesNotMatch(
            error.message,
            /CANARY/,
            'actual wait diagnostic callback must discard transient text',
          );
        }
        return actualSafeFailureCode(error);
      },
      recordDataMemberDriverDiagnostic: diagnosticApi.recordDataMemberDriverDiagnostic,
      observeDataMemberNameEntry: diagnosticApi.observeDataMemberNameEntry,
      dataMemberNameEntrySample: diagnosticApi.dataMemberNameEntrySample,
      process: { stderr: { write: () => {} }, exitCode: 0 },
    };
    await new Function(
      ...Object.keys(deps),
      `return (async () => {${source.slice(stateStart, stateEnd)}\ntry {${source.slice(start, end)}${source.slice(catchStart, catchEnd)}}})();`,
    )(...Object.values(deps));
    const d = report.name_entry_diagnostic;
    assert.ok(d, 'actual caller must retain name-entry samples');
    assert.equal(d.before_click.sampled, !beforeUnavailable);
    if (clickFailure) {
      assert.deepEqual(events, ['click']);
      assert.equal(report.status, 'fail');
      assert.equal(report.error_code, 'native_acceptance_error');
      assert.doesNotMatch(JSON.stringify(report), /CANARY/);
      return;
    }
    assert.deepEqual(events.slice(0, 3), ['click', 'Input.insertText', 'wait']);
    assert.ok(d.after_click, 'actual caller must retain after-click sample');
    assert.equal(d.after_click.sampled, !afterUnavailable);
    assert.equal(d.after_insert.sampled, true);
    if (beforeUnavailable)
      assert.equal(d.before_click.read_failure_category, 'diagnostic_read_unavailable');
    if (afterUnavailable)
      assert.equal(d.after_click.read_failure_category, 'diagnostic_read_unavailable');
    assert.equal(d.after_insert.focused, !wrongFocus && scenario !== 'remount');
    assert.equal(
      d.before_click.nonempty,
      scenario === 'prefill' ? true : beforeUnavailable ? null : false,
    );
    assert.equal(d.after_insert.expected_length, expected.length);
    assert.equal(d.document_replaced, scenario === 'document_changed');
    assert.equal(d.input_replacement, 'unknown');
    if (
      ['wrong_focus', 'prefill', 'remount', 'wait_read_failure', 'read_and_wait_failure'].includes(
        scenario,
      )
    ) {
      assert.equal(report.status, 'fail');
      assert.equal(report.error_code, 'data_member_pattern_name_entered_not_observed');
      assert.ok(d.last_wait, 'actual outer catch must retain last wait');
      if (scenario !== 'wait_read_failure') {
        assert.equal(d.last_wait.focused, d.after_insert.focused);
        assert.equal(d.last_wait.value_length, d.after_insert.value_length);
      }
      assert.equal(d.last_wait.matches, scenario === 'wait_read_failure' ? null : false);
      assert.equal(
        d.wait_failure_category,
        scenario === 'wait_read_failure' ? 'panel_target_unavailable' : null,
      );
      assert.equal(d.wait_label, 'data_member_pattern_name_entered');
    } else {
      assert.ok(events.includes('Network.enable'));
      assert.equal(d.after_insert.matches, true);
    }
    assert.doesNotMatch(
      JSON.stringify(report),
      /CANARY|private_prefill|private_read|private_primary|transient/,
    );
  } finally {
    await window.happyDOM.abort();
  }
}

for (const scenario of [
  'wrong_focus',
  'prefill',
  'document_changed',
  'remount',
  'read_failure',
  'after_read_failure',
  'click_failure',
  'wait_read_failure',
  'read_and_click_failure',
  'read_and_wait_failure',
  'success',
])
  test(`actual member Data name-entry retains ${scenario} observations and primary failure`, () =>
    runNameEntryScenario(scenario));

test('member Data actual-caller oracle kills catch erasure, skipped capture and constant-projector guts in memory', async () => {
  await assert.rejects(
    () => runNameEntryScenario('wait_read_failure', 'drop_wait_callback'),
    /actual wait diagnostic callback must discard transient text/,
  );
  await assert.rejects(
    () => runNameEntryScenario('wrong_focus', 'drop_catch'),
    /actual outer catch must retain last wait/,
  );
  await assert.rejects(
    () => runNameEntryScenario('prefill', 'drop_after_click'),
    /actual caller must retain after-click sample/,
  );
  await assert.rejects(
    () => runNameEntryScenario('prefill', 'constant_projector'),
    (error) => error.code === 'ERR_ASSERTION',
  );
});
