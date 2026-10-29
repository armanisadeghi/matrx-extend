import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { Window } from 'happy-dom';
import { test } from 'vitest';
import * as diagnostics from '../browser/data-member-driver-diagnostic.mjs';
import { activeTabPanelExpression, evaluate, waitFor } from '../browser/settings-panel-driver.mjs';

const original = readFileSync('tests/browser/data-member-native-acceptance.mjs', 'utf8');
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

// Execute the actual post-click wait, DOM observation and outer CLI catch. Only the CDP transport is replaced.
async function failureReport(scenario: string, eraseCatch = false, constantProjection = false) {
  const source = eraseCatch
    ? original.replace('  recordDataMemberDriverDiagnostic(error, report);', '')
    : original;
  const stateStart = source.indexOf('async function dataState(');
  const stateEnd = source.indexOf('\nasync function extractionState', stateStart);
  const waitStart = source.indexOf(
    "        await waitFor(\n          'data_member_reloaded_data_tab_ready'",
  );
  const waitEnd = source.indexOf('        const reloaded =', waitStart);
  const codeStart = source.indexOf('function safeFailureCode(');
  const codeEnd = source.indexOf('\nasync function deleteSavedPattern', codeStart);
  const catchStart = source.lastIndexOf('} catch (error) {');
  const catchEnd = source.indexOf('} finally {', catchStart);
  assert.ok(stateStart > 0 && stateEnd > stateStart && waitStart > 0 && waitEnd > waitStart);
  const window = new Window();
  try {
    window.document.body.innerHTML =
      '<div id="app"><button role="tab" title="Data" data-state="inactive" aria-selected="false" aria-controls="pane">CANARY_private_text</button><div id="pane" role="tabpanel" data-state="inactive"><input value="CANARY_private_value"></div></div>';
    const tab = window.document.querySelector('button')!;
    const pane = window.document.querySelector('#pane')!;
    tab.getBoundingClientRect = () => ({ width: 10, height: 10 }) as DOMRect;
    if (scenario === 'selected_missing_pane') {
      tab.setAttribute('data-state', 'active');
      tab.setAttribute('aria-selected', 'true');
      pane.remove();
    }
    if (scenario === 'selected_inactive_pane' || scenario.startsWith('active')) {
      tab.setAttribute('data-state', 'active');
      tab.setAttribute('aria-selected', 'true');
      if (scenario.startsWith('active')) pane.setAttribute('data-state', 'active');
    }
    const report: any = { status: 'unverified', stage: 'extension_reload_reopen_data' };
    const panel = {
      async send(_method: string, params: any) {
        if (scenario === 'target_lost') throw new Error('Target closed CANARY_auth_url_and_token');
        return {
          result: {
            value: runInNewContext(params.expression, {
              document: window.document,
              getComputedStyle:
                scenario === 'active_diagnostic_unavailable'
                  ? () => {
                      throw new Error('CANARY_private_diagnostic');
                    }
                  : window.getComputedStyle.bind(window),
              performance: { timeOrigin: 123 },
            }),
          },
        };
      },
    };
    let diagnosticApi = diagnostics;
    if (constantProjection) {
      const helper = readFileSync('tests/browser/data-member-driver-diagnostic.mjs', 'utf8');
      const start = helper.indexOf('export function dataMemberReloadWaitSample(');
      assert.ok(start > 0);
      diagnosticApi = new Function(`${helper.slice(0, start).replaceAll('export ', '')}
        function dataMemberReloadWaitSample() { return { sampled: true, active: false, matching_tab_count: 1, visible_tab_count: 1, active_tab_count: 0, selected_tab_count: 0, linked_pane_count: 1, linked_active_pane_count: 0, active_tab_category: 'none', render_error_present: false, saved_pattern_visible: null }; }
        return { recordDataMemberDriverDiagnostic, dataMemberReloadWaitSample };`)();
    }
    const deps = {
      ...diagnosticApi,
      panel,
      report,
      patternName: 'CANARY_private_pattern',
      evaluate,
      activeTabPanelExpression,
      waitFor: (...args: any[]) => waitFor(args[0], args[1], args[2], 1, args[4]),
      process: { exitCode: 0, stderr: { write() {} } },
    };
    await new AsyncFunction(
      ...Object.keys(deps),
      `${source.slice(stateStart, stateEnd)}\n${source.slice(codeStart, codeEnd)}\ntry {${source.slice(waitStart, waitEnd)} ${source.slice(catchStart, catchEnd)} }`,
    )(...Object.values(deps));
    if (scenario.startsWith('active')) {
      assert.equal(report.status, 'unverified');
      assert.equal(report.error_code, undefined);
      assert.equal(report.reload_data_wait_diagnostic, undefined);
      return report;
    }
    assert.equal(report.status, 'fail');
    assert.equal(report.error_code, 'data_member_reloaded_data_tab_ready_not_observed');
    assert.equal(report.failure_stage, 'extension_reload_reopen_data');
    const d = report.reload_data_wait_diagnostic;
    assert.ok(d, 'actual outer catch must retain the failed post-reload wait');
    assert.equal(d.stage, 'extension_reload_reopen_data');
    assert.equal(d.target, 'data_tab_and_linked_pane');
    assert.equal(d.wait_label, 'data_member_reloaded_data_tab_ready');
    assert.equal(
      d.wait_failure_category,
      scenario === 'target_lost' ? 'panel_target_unavailable' : null,
    );
    assert.equal(d.last_wait.sampled, scenario !== 'target_lost');
    assert.equal(d.last_wait.active, scenario === 'target_lost' ? null : false);
    assert.equal(d.last_wait.matching_tab_count, scenario === 'target_lost' ? null : 1);
    assert.equal(
      d.last_wait.active_tab_count,
      scenario === 'target_lost' ? null : scenario === 'inactive' ? 0 : 1,
    );
    assert.equal(
      d.last_wait.selected_tab_count,
      scenario === 'target_lost' ? null : scenario === 'inactive' ? 0 : 1,
    );
    assert.equal(
      d.last_wait.linked_pane_count,
      scenario === 'target_lost' ? null : scenario === 'selected_missing_pane' ? 0 : 1,
    );
    assert.equal(d.last_wait.linked_active_pane_count, scenario === 'target_lost' ? null : 0);
    assert.doesNotMatch(JSON.stringify(report), /CANARY|transient|123|auth_url|token/);
    return report;
  } finally {
    await window.happyDOM.abort();
  }
}

for (const scenario of [
  'inactive',
  'selected_missing_pane',
  'selected_inactive_pane',
  'target_lost',
])
  test(`native failed post-reload wait retains ${scenario} safe evidence`, () =>
    failureReport(scenario));

test('the caller-path oracle rejects the old catch that loses wait metadata', async () => {
  await assert.rejects(
    failureReport('selected_missing_pane', true),
    /actual outer catch must retain/,
  );
});

test('reload wait projection rejects unrestricted and mistyped metadata', () => {
  const report: any = {};
  diagnostics.recordDataMemberDriverDiagnostic(
    {
      waitLabel: 'data_member_reloaded_data_tab_ready',
      waitFailureCategory: 'CANARY_private_category',
      waitDiagnostic: {
        active: 'CANARY_private_active',
        matchingTabCount: -1,
        visibleTabCount: Infinity,
        activeTabCount: 101,
        selectedTabCount: 'CANARY_private_selected',
        linkedPaneCount: {},
        linkedActivePaneCount: true,
        activeTabCategory: 'CANARY_private_title',
        renderErrorPresent: 'CANARY_private_render',
        transient: 'CANARY_private_error',
      },
    },
    report,
  );
  assert.equal(report.reload_data_wait_diagnostic.wait_failure_category, null);
  assert.equal(report.reload_data_wait_diagnostic.last_wait.sampled, false);
  for (const [key, value] of Object.entries(report.reload_data_wait_diagnostic.last_wait))
    if (key !== 'sampled') assert.equal(value, null, key);
  assert.doesNotMatch(JSON.stringify(report), /CANARY|transient/);
});

test('the caller-path oracle rejects a constant expected wait projection', async () => {
  await assert.rejects(
    failureReport('selected_missing_pane', false, true),
    (error: any) => error.code === 'ERR_ASSERTION',
  );
});

for (const scenario of ['active', 'active_diagnostic_unavailable'])
  test(`original reload ready predicate succeeds with ${scenario}`, () => failureReport(scenario));
