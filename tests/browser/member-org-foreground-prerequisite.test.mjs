import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { Window } from 'happy-dom';
import {
  recordMemberAuthTopologyBoundary,
  requireOriginalMemberPanel,
} from './member-foreground-diagnostic.mjs';
import { click } from './settings-panel-driver.mjs';

const source = readFileSync(
  fileURLToPath(new URL('./reviewer-chat-store-acceptance.mjs', import.meta.url)),
  'utf8',
);
const start = source.indexOf(
  "        if (!UNINTERRUPTED) {\n          stage = 'reviewer_native_panel_foreground';",
);
const end = source.indexOf("        stage = 'reviewer_organization_resolve';", start);
assert.ok(start > 0 && end > start, 'actual member organization prerequisite must be located');
const actualPrerequisite = source.slice(start, end);
const branchStart = end;
const branchEnd = source.indexOf('        let approvedSelection = null;', branchStart);
assert.ok(branchEnd > branchStart, 'actual no-selected-organization branch must be located');
const actualSelectionBranch = source.slice(branchStart, branchEnd);
const selectionHelperStart = source.indexOf('async function selectReviewerOrganization(');
const selectionHelperEnd = source.indexOf(
  '/** Approve only the owned extension OAuth',
  selectionHelperStart,
);
assert.ok(selectionHelperStart > 0 && selectionHelperEnd > selectionHelperStart);
const actualSelectionHelper = source.slice(selectionHelperStart, selectionHelperEnd);

function scenario({
  restoreFailure = false,
  replaceTarget = false,
  mutate = (value) => value,
} = {}) {
  const events = [];
  const state = {
    visible: false,
    targetId: 'original',
    contextId: 'context',
    documentId: 'document',
  };
  const topology = (phase) => ({
    phase,
    panel_target_id: state.targetId,
    panel_target_ids: [state.targetId],
    panel_targets_measured: true,
    panel_visibility: state.visible ? 'visible' : 'hidden',
    topology_measured: true,
    panel_contexts: [{ context_id: state.contextId, document_id: state.documentId }],
  });
  const report = { auth_topology: [], foreground_diagnostic: null };
  const context = {
    UNINTERRUPTED: false,
    report,
    panel: {},
    web: {},
    page: {},
    native: { panelTarget: { targetId: 'original' } },
    evaluate: async () => {},
    OUTPUT: '/tmp/member-prerequisite',
    stage: 'identity',
    sampleAuthBoundary: async (phase) => {
      events.push(`topology:${phase}`);
      const row = topology(phase);
      report.auth_topology.push(row);
      return row;
    },
    recordMemberPickerBoundary: async ({ phase }) => {
      events.push(`picker:${phase}`);
      return { phase, measured: true, panel_visibility: state.visible ? 'visible' : 'hidden' };
    },
    writeReviewerReport: async () => {},
    restoreMemberForegroundWithReport: async () => {
      events.push('trusted_restore');
      if (restoreFailure) throw new Error('reviewer_native_panel_foreground_not_observed');
      state.visible = true;
      if (replaceTarget) state.targetId = 'replacement';
    },
    requireOriginalMemberPanel,
    waitFor: async () => {},
  };
  return {
    events,
    report,
    run: () => runInNewContext(`(async () => { ${mutate(actualPrerequisite)} })()`, context),
  };
}

test('actual runner restores original visible member panel before organization picker input', async () => {
  const run = scenario();
  await run.run();
  assert.ok(run.events.indexOf('trusted_restore') >= 0);
  assert.ok(
    run.events.indexOf('trusted_restore') < run.events.indexOf('picker:after_admin_check_stop'),
  );
  assert.equal(run.report.foreground_diagnostic?.failure_class, null);
});

test('actual runner refuses failed restoration before picker input', async () => {
  const run = scenario({ restoreFailure: true });
  await assert.rejects(run.run(), /reviewer_native_panel_foreground_not_observed/);
  assert.equal(
    run.events.some((event) => event.startsWith('picker:')),
    false,
  );
});

test('actual runner refuses target replacement before picker input', async () => {
  const run = scenario({ replaceTarget: true });
  await assert.rejects(run.run(), /reviewer_member_original_panel_unverified/);
  assert.equal(
    run.events.some((event) => event.startsWith('picker:')),
    false,
  );
});

test('same original target may remount its document during trusted reopen', () => {
  const before = {
    panel_targets_measured: true,
    topology_measured: true,
    panel_target_id: 'original',
    panel_target_ids: ['original'],
    panel_contexts: [{ context_id: 'old-context', document_id: 'old-document' }],
    panel_visibility: 'hidden',
  };
  const after = {
    ...before,
    panel_contexts: [{ context_id: 'new-context', document_id: 'new-document' }],
    panel_visibility: 'visible',
  };
  assert.equal(requireOriginalMemberPanel(before, after, 'original'), after);
});

test('removing actual runner restoration turns hidden prerequisite red', async () => {
  const run = scenario({
    mutate: (value) =>
      value.replace('await restoreMemberForegroundWithReport({', 'await (async () => {})({'),
  });
  await assert.rejects(run.run(), /reviewer_member_panel_hidden_during_org_proof/);
  assert.equal(
    run.events.some((event) => event.startsWith('picker:')),
    false,
  );
});

test('first hidden topology persists only a bounded transition before later samples', async () => {
  let visible = true;
  const report = {};
  const url = 'chrome-extension://example/sidepanel.html';
  const native = {
    panelTarget: { targetId: 'original', url },
    browserSession: { send: async () => ({ targetInfos: [{ targetId: 'original', url }] }) },
    attachWorker: async () => ({
      send: async () => ({
        result: {
          value: {
            contexts: [
              {
                contextId: 'context',
                documentId: 'document',
                exactPanel: true,
                windowId: -1,
                tabId: -1,
              },
            ],
            windows: [{ id: 7, focused: true, state: 'normal' }],
            tabs: [],
          },
        },
      }),
      detach: async () => {},
    }),
  };
  const panel = {
    send: async () => ({
      result: { value: { visibility: visible ? 'visible' : 'hidden', focused: true } },
    }),
  };
  const writes = [];
  const sample = (phase) =>
    recordMemberAuthTopologyBoundary({
      native,
      panel,
      phase,
      report,
      output: '/tmp/member-boundary',
      writeReport: async (_output, value) => writes.push(structuredClone(value)),
    });
  await sample('after_organization_open');
  visible = false;
  await sample('after_extension_identity');
  await sample('before_foreground_restore');
  assert.deepEqual(report.first_hidden_boundary, {
    phase: 'after_extension_identity',
    previous_phase: 'after_organization_open',
    previous_visibility: 'visible',
    same_target: true,
    same_document: true,
  });
  assert.equal(writes[1].first_hidden_boundary.phase, 'after_extension_identity');
  assert.equal(JSON.stringify(writes).includes('chrome-extension://'), false);
});

function noSelectedOrganizationScenario({
  hideAt = 'reviewer_organization_resolved',
  mutate = (value) => value,
} = {}) {
  const events = [];
  let visible = true;
  const topology = (phase) => ({
    phase,
    panel_targets_measured: true,
    topology_measured: true,
    panel_target_id: 'original',
    panel_target_ids: ['original'],
    panel_contexts: [{ context_id: 'context', document_id: 'document' }],
    panel_visibility: visible ? 'visible' : 'hidden',
  });
  const context = {
    UNINTERRUPTED: false,
    restoredPanelTopology: topology('after_foreground_restore'),
    native: { panelTarget: { targetId: 'original' } },
    panel: {},
    email: 'member',
    report: { account: {} },
    stage: '',
    requireOriginalMemberPanel,
    sampleAuthBoundary: async (phase) => {
      if (phase === hideAt) visible = false;
      events.push(`topology:${phase}:${visible ? 'visible' : 'hidden'}`);
      return topology(phase);
    },
    accountObservation: async () => ({}),
    waitFor: async (label) => {
      events.push(`wait:${label}`);
      if (label === hideAt) visible = false;
      return {
        organizationSelected: label !== 'reviewer_organization_resolved',
        organizationPickerAvailable: true,
      };
    },
    selectReviewerOrganization: async (_panel, assertReady) => {
      if (assertReady) await assertReady('before_default_org_picker_click');
      events.push(`picker-input:${visible ? 'visible' : 'hidden'}`);
      if (assertReady) await assertReady('before_default_org_option_click');
      events.push(`option-input:${visible ? 'visible' : 'hidden'}`);
      return {};
    },
    storedSessionShape: async () => ({}),
    hash: () => 'fingerprint',
    capture: async () => null,
    artifacts: '/tmp',
  };
  return {
    events,
    run: () => runInNewContext(`(async () => { ${mutate(actualSelectionBranch)} })()`, context),
  };
}

test('actual no-selected branch refuses a hidden panel before its first picker input', async () => {
  const run = noSelectedOrganizationScenario();
  await assert.rejects(run.run(), /reviewer_member_panel_hidden_during_org_proof/);
  assert.equal(
    run.events.some((event) => event.startsWith('picker-input:')),
    false,
  );
});

test('actual no-selected branch refuses a hide between picker opening and option input', async () => {
  const run = noSelectedOrganizationScenario({ hideAt: 'before_default_org_option_click' });
  await assert.rejects(run.run(), /reviewer_member_panel_hidden_during_org_proof/);
  assert.ok(run.events.includes('picker-input:visible'));
  assert.equal(
    run.events.some((event) => event.startsWith('option-input:')),
    false,
  );
});

test('removing both actual no-selected picker guards exposes hidden native input', async () => {
  const run = noSelectedOrganizationScenario({
    mutate: (value) => {
      const withoutBoundaryGuard = value.replace(
        `          if (!UNINTERRUPTED)
            requireOriginalMemberPanel(
              restoredPanelTopology,
              beforeSelection,
              native.panelTarget.targetId,
            );`,
        '          if (!UNINTERRUPTED) void beforeSelection;',
      );
      assert.notEqual(withoutBoundaryGuard, value);
      const withoutInputGuard = withoutBoundaryGuard.replace(
        'UNINTERRUPTED ? undefined : assertMemberPickerReady,',
        'undefined,',
      );
      assert.notEqual(withoutInputGuard, withoutBoundaryGuard);
      return withoutInputGuard;
    },
  });
  await run.run();
  assert.ok(run.events.includes('picker-input:hidden'));
});

test('actual selection helper checks visibility at both native input sites', async () => {
  for (const refuseAt of ['before_default_org_picker_click', 'before_default_org_option_click']) {
    const events = [];
    const panel = { send: async (_method, input) => events.push(input.type) };
    await assert.rejects(
      runInNewContext(
        `(async () => { ${actualSelectionHelper} return selectReviewerOrganization(panel, beforeInput); })()`,
        {
          UNINTERRUPTED: false,
          panel,
          beforeInput: async (phase) => {
            events.push(phase);
            if (phase === refuseAt)
              throw new Error('reviewer_member_panel_hidden_during_org_proof');
          },
          click: async () => events.push('picker_click'),
          evaluate: async () => ({
            labels: [],
            optionCount: 1,
            eligibleCount: 1,
            matchedCount: 1,
            target: true,
            x: 10,
            y: 10,
          }),
          hash: () => 'fingerprint',
        },
      ),
      /reviewer_member_panel_hidden_during_org_proof/,
    );
    assert.equal(
      events.some((event) => event === 'mousePressed'),
      false,
    );
    if (refuseAt === 'before_default_org_picker_click')
      assert.equal(events.includes('picker_click'), false);
    else assert.equal(events.includes('picker_click'), true);
  }
});

for (const change of ['hidden', 'replacement', 'after_press_hidden', 'none']) {
  test(`actual selection helper and shared click check original panel after pointer settling: ${change}`, async () => {
    const window = new Window();
    window.document.body.innerHTML =
      '<div><div><span>Acting as</span></div><div><button role="combobox" aria-expanded="false">Org</button></div></div>';
    const target = window.document.querySelector('button');
    for (const element of window.document.querySelectorAll('*')) {
      element.getBoundingClientRect = () => ({
        x: 100,
        y: 100,
        left: 100,
        top: 100,
        right: 124,
        bottom: 124,
        width: 24,
        height: 24,
      });
      element.scrollIntoView = () => {};
      element.getAnimations = () => [];
    }
    window.document.elementFromPoint = () => target;
    const events = [];
    const state = { visibility: 'visible', target: 'original' };
    let pointerSamples = 0;
    const panel = {
      send: async (method, args) => {
        if (method === 'Runtime.evaluate') {
          pointerSamples += 1;
          if (pointerSamples === 1 && change === 'hidden') state.visibility = 'hidden';
          if (pointerSamples === 1 && change === 'replacement') state.target = 'replacement';
          return { result: { value: window.eval(args.expression) } };
        }
        if (method === 'Input.dispatchMouseEvent') {
          events.push(args.type);
          if (change === 'after_press_hidden' && args.type === 'mousePressed')
            state.visibility = 'hidden';
        }
        return {};
      },
    };
    const beforeInput = async (phase) => {
      events.push(phase);
      if (state.visibility !== 'visible')
        throw new Error('reviewer_member_panel_hidden_during_org_proof');
      if (state.target !== 'original') throw new Error('reviewer_member_original_panel_unverified');
    };
    try {
      const run = runInNewContext(
        `(async () => { ${actualSelectionHelper} return selectReviewerOrganization(panel, beforeInput); })()`,
        {
          UNINTERRUPTED: false,
          panel,
          beforeInput,
          click,
          evaluate: async () => ({
            labels: [],
            optionCount: 1,
            eligibleCount: 1,
            matchedCount: 1,
            target: true,
            x: 112,
            y: 112,
          }),
          hash: () => 'fingerprint',
        },
      );
      if (change === 'none') {
        await run;
        assert.deepEqual(
          events.filter((event) => event.startsWith('mouse')),
          ['mousePressed', 'mouseReleased', 'mousePressed', 'mouseReleased'],
        );
      } else if (change === 'after_press_hidden') {
        await assert.rejects(run, /reviewer_member_panel_hidden_during_org_proof/);
        assert.deepEqual(
          events.filter((event) => event.startsWith('mouse')),
          ['mousePressed', 'mouseReleased'],
        );
      } else {
        await assert.rejects(
          run,
          change === 'hidden'
            ? /reviewer_member_panel_hidden_during_org_proof/
            : /reviewer_member_original_panel_unverified/,
        );
        assert.equal(events.includes('mousePressed'), false);
      }
      assert.ok(pointerSamples >= 1);
    } finally {
      await window.happyDOM.abort();
    }
  });
}
