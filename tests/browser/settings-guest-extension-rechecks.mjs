import assert from 'node:assert/strict';
import { click, waitFor } from './settings-panel-driver.mjs';

const nativeDriver = { click, waitFor };
const LIFECYCLE_FIELDS = [
  'management_reload_clicked',
  'old_targets_retired',
  'worker_replaced',
  'panel_replaced',
];

function replacementPanel(result, previousPanel) {
  const lifecycleProven =
    LIFECYCLE_FIELDS.every((field) => result?.[field] === true) &&
    result?.retirement_evidence?.timeline?.final_predicate === true;
  const nextPanel = result?.panel;
  if (
    !lifecycleProven ||
    typeof previousPanel?.targetId !== 'string' ||
    typeof nextPanel?.targetId !== 'string' ||
    nextPanel.targetId === previousPanel.targetId
  ) {
    throw new Error('settings_full_extension_replacement_unverified');
  }
  return nextPanel;
}

export async function runGuestChoicesAcrossExtensionRestarts({
  panel: startingPanel,
  section,
  controlLabel,
  choices,
  baseline,
  settings,
  openSection,
  read,
  matches,
  reloadExtension,
  acquireLivePanel,
  onPanelChanged = () => {},
  record,
  afterReload = async () => {},
  failureCategory = 'full_extension_preference_or_restore_failed',
  safeStages = [],
  safeFailureKind = 'case_and_restore',
  driver = nativeDriver,
}) {
  assert.ok(startingPanel && typeof startingPanel.targetId === 'string');
  assert.ok(baseline && choices.some(([value]) => value === baseline.value));
  let activePanel = startingPanel;
  let failureStage = null;
  let choiceFailureStage = null;
  let restoreFailureStage = null;
  let choiceFailure = false;
  let restoreFailure = false;

  const inspectBaseline = async (stage) => {
    await settings(activePanel);
    await openSection(activePanel, section);
    const state = await read(activePanel);
    const matched = matches(state, baseline.value, baseline.label);
    record(`${stage}: original preference matches`, matched ? 'pass' : 'fail', state);
    assert.equal(matched, true, `${stage}_baseline_mismatch`);
    return state;
  };

  const restartAndRead = async (value, label, stage) => {
    const previousPanel = activePanel;
    const result = await reloadExtension();
    const nextPanel = replacementPanel(result, previousPanel);
    activePanel = nextPanel;
    onPanelChanged(activePanel);
    record(`${label} extension worker and panel were replaced`, 'pass', {
      managementReloadClicked: result.management_reload_clicked,
      oldTargetsRetired: result.old_targets_retired,
      workerReplaced: result.worker_replaced,
      panelReplaced: result.panel_replaced,
      replacementTargetChanged: nextPanel.targetId !== previousPanel.targetId,
      lifecyclePredicatePassed: result.retirement_evidence.timeline.final_predicate,
    });
    await previousPanel.detach?.();
    await settings(activePanel);
    await openSection(activePanel, section);
    const state = await driver.waitFor(
      `${controlLabel}_${value}_after_extension_reload`,
      () => read(activePanel),
      (observed) => matches(observed, value, label),
    );
    record(`${label} survives full extension reload`, 'pass', state);
    await afterReload({ panel: activePanel, value, label, observation: state });
    return { state, stage };
  };

  try {
    failureStage = 'initial_baseline';
    await inspectBaseline('initial');
    for (const [value, label] of choices.filter(([candidate]) => candidate !== baseline.value)) {
      failureStage = 'choice_select';
      await openSection(activePanel, section);
      await driver.click(activePanel, 'settings-select', controlLabel);
      await driver.click(activePanel, 'option', label);
      const state = await driver.waitFor(
        `${controlLabel}_${value}_before_extension_reload`,
        () => read(activePanel),
        (observed) => matches(observed, value, label),
      );
      record(`${label} changes visible and stored preference`, 'pass', state);
      failureStage = 'extension_reload';
      await restartAndRead(value, label, failureStage);
    }
  } catch {
    choiceFailure = true;
    choiceFailureStage = failureStage;
  }

  try {
    failureStage = 'restore_panel';
    let current;
    try {
      await settings(activePanel);
      await openSection(activePanel, section);
      current = await read(activePanel);
    } catch {
      if (typeof acquireLivePanel !== 'function') throw new Error('restore_panel_unavailable');
      const recovered = await acquireLivePanel();
      if (typeof recovered?.targetId !== 'string') throw new Error('restore_panel_unavailable');
      await activePanel.detach?.();
      activePanel = recovered;
      onPanelChanged(activePanel);
      await settings(activePanel);
      await openSection(activePanel, section);
      current = await read(activePanel);
    }
    if (!matches(current, baseline.value, baseline.label)) {
      const visible = current?.selected ?? current?.visible ?? null;
      if (visible === baseline.label && current?.stored !== baseline.value) {
        const alternate = choices.find(([value]) => value !== baseline.value);
        if (!alternate) throw new Error('settings_full_extension_baseline_alternate_unavailable');
        failureStage = 'restore_choice';
        await driver.click(activePanel, 'settings-select', controlLabel);
        await driver.click(activePanel, 'option', alternate[1]);
        current = await driver.waitFor(
          `${controlLabel}_alternate_before_baseline_restore`,
          () => read(activePanel),
          (observed) => matches(observed, alternate[0], alternate[1]),
        );
      }
      if (!matches(current, baseline.value, baseline.label)) {
        failureStage = 'restore_choice';
        await driver.click(activePanel, 'settings-select', controlLabel);
        await driver.click(activePanel, 'option', baseline.label);
        current = await driver.waitFor(
          `${controlLabel}_baseline_before_extension_reload`,
          () => read(activePanel),
          (observed) => matches(observed, baseline.value, baseline.label),
        );
      }
    }
    record('original preference restored before extension reload', 'pass', current);
    failureStage = 'restore_extension_reload';
    await restartAndRead(baseline.value, baseline.label, failureStage);
    record('original preference restored after extension reload', 'pass', await read(activePanel));
  } catch {
    restoreFailure = true;
    restoreFailureStage = failureStage;
  }

  if (choiceFailure || restoreFailure) {
    const error = new Error(failureCategory);
    const reportedStage = restoreFailure ? restoreFailureStage : choiceFailureStage;
    if (safeStages.includes(reportedStage)) {
      error.safeCategory = failureCategory;
      error.safeStage = reportedStage;
      error.safeFailureKind =
        choiceFailure && restoreFailure ? 'case_and_restore' : restoreFailure ? 'restore' : 'case';
      if (safeFailureKind !== 'case_and_restore') error.safeFailureKind = safeFailureKind;
    }
    throw error;
  }
  return activePanel;
}
