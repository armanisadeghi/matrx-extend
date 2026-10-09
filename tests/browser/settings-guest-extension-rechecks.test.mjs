import assert from 'node:assert/strict';
import test from 'node:test';
import { runGuestChoicesAcrossExtensionRestarts } from './settings-guest-extension-rechecks.mjs';

function fixture({ skipLabel = null, skipLabels = [], corruptAfterRestart = false } = {}) {
  const state = {
    visible: 'System',
    stored: 'system',
    activeSettings: false,
    sectionOpen: false,
    clicks: [],
    restartInputs: [],
    nextTarget: 0,
    panel: { targetId: 'panel-0' },
  };
  const driver = {
    async click(_panel, kind, label) {
      state.clicks.push([kind, label]);
      if (kind === 'option' && label !== skipLabel && !skipLabels.includes(label)) {
        const value = choices.find(([, choiceLabel]) => choiceLabel === label)?.[0];
        state.visible = label;
        state.stored = value;
      }
    },
    async waitFor(_name, read, accept) {
      const result = await read();
      assert.equal(accept(result), true);
      return result;
    },
  };
  const choices = [
    ['dark', 'Dark'],
    ['light', 'Light'],
    ['system', 'System'],
  ];
  const settings = async () => {
    state.activeSettings = true;
  };
  const openSection = async () => {
    state.sectionOpen = true;
  };
  const read = async (panel) => ({
    activeSettings: state.activeSettings && panel === state.panel,
    sectionOpen: state.sectionOpen,
    selected: state.visible,
    stored: state.stored,
  });
  const reloadExtension = async () => {
    state.restartInputs.push(state.panel.targetId);
    const previous = state.panel;
    state.nextTarget += 1;
    state.panel = { targetId: `panel-${state.nextTarget}`, detach: async () => {} };
    state.visible =
      state.stored === 'dark' ? 'Dark' : state.stored === 'light' ? 'Light' : 'System';
    if (corruptAfterRestart && state.restartInputs.length === 1) state.stored = 'corrupt';
    return {
      panel: state.panel,
      previousTargetId: previous.targetId,
      management_reload_clicked: true,
      old_targets_retired: true,
      worker_replaced: true,
      panel_replaced: true,
      replacement_panel_target_id: state.panel.targetId,
      retirement_evidence: { timeline: { final_predicate: true } },
    };
  };
  return {
    state,
    settings,
    openSection,
    read,
    reloadExtension,
    driver,
    choices,
    matches: (observed, value, label) =>
      observed?.activeSettings === true &&
      observed?.sectionOpen === true &&
      observed?.selected === label &&
      observed?.stored === value,
  };
}

async function run(f, options = {}) {
  const records = [];
  const result = await runGuestChoicesAcrossExtensionRestarts({
    panel: f.state.panel,
    section: 'Appearance',
    controlLabel: 'Theme',
    choices: f.choices,
    baseline: { value: 'system', label: 'System' },
    settings: f.settings,
    openSection: f.openSection,
    read: f.read,
    matches: f.matches,
    reloadExtension: f.reloadExtension,
    acquireLivePanel: async () => f.state.panel,
    record: (...entry) => records.push(entry),
    driver: f.driver,
    ...options,
  });
  return { result, records };
}

test('every nonbaseline choice survives its own replacement-worker extension restart and baseline is restored', async () => {
  const f = fixture();
  const { result, records } = await run(f);
  assert.equal(result.targetId, 'panel-3');
  assert.deepEqual(f.state.restartInputs, ['panel-0', 'panel-1', 'panel-2']);
  assert.deepEqual(
    records
      .filter(([name]) => name.endsWith('survives full extension reload'))
      .map(([name]) => name),
    [
      'Dark survives full extension reload',
      'Light survives full extension reload',
      'System survives full extension reload',
    ],
  );
  assert.equal(f.state.visible, 'System');
  assert.equal(f.state.stored, 'system');
  assert.equal(
    records.every(([, status]) => status === 'pass'),
    true,
  );
  assert.equal(
    records.some(([, status]) => status === 'fail'),
    false,
  );
});

test('a skipped choice fails its assertion and still restarts with the original preference restored', async () => {
  const f = fixture({ skipLabel: 'Dark' });
  await assert.rejects(run(f), /full_extension_preference_or_restore_failed/);
  assert.deepEqual(f.state.restartInputs, ['panel-0']);
  assert.equal(f.state.visible, 'System');
  assert.equal(f.state.stored, 'system');
});

test('wrong stored value after extension restart fails and restores the original UI and storage', async () => {
  const f = fixture({ corruptAfterRestart: true });
  await assert.rejects(run(f), /full_extension_preference_or_restore_failed/);
  assert.equal(f.state.visible, 'System');
  assert.equal(f.state.stored, 'system');
  assert.ok(
    f.state.restartInputs.length >= 2,
    'cleanup must exercise another real extension restart',
  );
});

test('failed baseline restoration remains a failure and does not claim the original preference was restored', async () => {
  const f = fixture({ skipLabels: ['System'] });
  const records = [];
  await assert.rejects(
    run(f, { record: (...entry) => records.push(entry) }),
    /full_extension_preference_or_restore_failed/,
  );
  assert.equal(f.state.visible, 'Light');
  assert.equal(f.state.stored, 'light');
  assert.equal(
    records.some(([name]) => name === 'original preference restored after extension reload'),
    false,
  );
});

test('baseline-looking UI with storage drift is repaired through an alternate choice before restoration', async () => {
  const f = fixture();
  f.state.stored = 'light';
  await assert.rejects(run(f), /full_extension_preference_or_restore_failed/);
  const options = f.state.clicks.filter(([kind]) => kind === 'option').map(([, label]) => label);
  assert.deepEqual(options.slice(-2), ['Dark', 'System']);
  assert.equal(f.state.visible, 'System');
  assert.equal(f.state.stored, 'system');
});

test('panel-only reload cannot satisfy the required extension replacement boundary', async () => {
  const f = fixture();
  const records = [];
  let nextId = 0;
  await assert.rejects(
    runGuestChoicesAcrossExtensionRestarts({
      panel: f.state.panel,
      section: 'Appearance',
      controlLabel: 'Theme',
      choices: f.choices,
      baseline: { value: 'system', label: 'System' },
      settings: f.settings,
      openSection: f.openSection,
      read: f.read,
      matches: f.matches,
      reloadExtension: async () => {
        nextId += 1;
        f.state.panel = { targetId: `panel-${nextId}` };
        return { panel: f.state.panel };
      },
      acquireLivePanel: async () => f.state.panel,
      record: (...entry) => records.push(entry),
      driver: f.driver,
    }),
    /full_extension_preference_or_restore_failed/,
  );
  assert.equal(
    records.some(([name]) => name.endsWith('survives full extension reload')),
    false,
  );
  assert.equal(f.state.visible, 'System');
  assert.equal(f.state.stored, 'system');
});

test('extension reload transport failures retain the first safe choice and restoration stages', async () => {
  const f = fixture();
  let reloadAttempts = 0;
  let observedError;
  await assert.rejects(
    run(f, {
      reloadExtension: async () => {
        reloadAttempts += 1;
        throw new Error('owned_cdp_transport_failed');
      },
      safeStages: ['extension_reload', 'restore_extension_reload'],
      transportFailureClass: () => 'unexpected_close',
    }),
    (error) => {
      observedError = error;
      return error.message === 'full_extension_preference_or_restore_failed';
    },
  );
  assert.equal(reloadAttempts, 2);
  assert.equal(observedError.safeFirstChoiceFailureStage, 'choice_extension_reload');
  assert.equal(observedError.safeRestorationFailureStage, 'restore_extension_reload');
  assert.equal(observedError.safeFirstChoiceTransportClass, 'unexpected_close');
  assert.equal(observedError.safeRestorationTransportClass, 'unexpected_close');
  assert.equal(observedError.safeCleanupFailed, undefined);
  assert.equal(observedError.message.includes('owned_cdp_transport_failed'), false);
});
