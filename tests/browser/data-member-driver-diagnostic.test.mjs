import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import {
  captureDataMemberDriverDiagnostic,
  recordDataMemberDriverDiagnostic,
} from './data-member-driver-diagnostic.mjs';
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
