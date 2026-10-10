import assert from 'node:assert/strict';
import { captureFailure, safeTransportFailureClass } from './profile-reload-capture.mjs';
import { click, waitFor } from './settings-panel-driver.mjs';

const nativeDriver = { click, waitFor };
export const GUEST_EXTENSION_RECHECK_FAILURE_STAGES = Object.freeze([
  'initial_baseline_settings',
  'initial_baseline_section',
  'initial_baseline_observation',
  'choice_section',
  'choice_control',
  'choice_option',
  'choice_observation',
  'choice_extension_reload',
  'choice_replacement_validation',
  'choice_detach_previous_panel',
  'choice_settings_reopen',
  'choice_section_reopen',
  'choice_preference_observation',
  'choice_after_reload_callback',
  'restore_settings',
  'restore_section',
  'restore_observation',
  'restore_acquire_panel',
  'restore_recovered_settings',
  'restore_recovered_section',
  'restore_recovered_observation',
  'restore_alternate_select',
  'restore_alternate_observation',
  'restore_baseline_select',
  'restore_baseline_observation',
  'restore_before_reload_record',
  'restore_extension_reload',
  'restore_replacement_validation',
  'restore_detach_previous_panel',
  'restore_settings_reopen',
  'restore_section_reopen',
  'restore_preference_observation',
  'restore_after_reload_callback',
  'restore_final_observation',
]);
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
  controlKind = 'settings-select',
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
  transportFailureClass = () => 'unavailable',
  driver = nativeDriver,
}) {
  assert.ok(startingPanel && typeof startingPanel.targetId === 'string');
  assert.ok(baseline && choices.some(([value]) => value === baseline.value));
  assert.ok(['settings-select', 'switch'].includes(controlKind));
  let activePanel = startingPanel;
  let failureStage = null;
  let failureDetailStage = 'initial_baseline_settings';
  let choiceFailureStage = null;
  let choiceFailureDetailStage = null;
  let choiceTransportClass = null;
  let choiceFailureCode = null;
  let choiceReloadBoundary = null;
  let restoreFailureStage = null;
  let restoreFailureDetailStage = null;
  let restoreTransportClass = null;
  let restoreFailureCode = null;
  let restoreReloadBoundary = null;
  let choiceFailure = false;
  let restoreFailure = false;

  const safeDetailStage = (stage) =>
    GUEST_EXTENSION_RECHECK_FAILURE_STAGES.includes(stage) ? stage : 'unavailable';
  const safeFailureCode = (error) => {
    const pointerCode = error?.driverFailure?.code;
    if (
      [
        'pointer_initial_evaluation_failed',
        'pointer_page_sample_failed',
        'pointer_target_not_unique',
        'pointer_followup_evaluation_failed',
        'pointer_stable_hit_not_observed',
        'pointer_press_dispatch_failed',
        'pointer_release_dispatch_failed',
      ].includes(pointerCode)
    )
      return pointerCode;
    return captureFailure(error, () => 'none').failure_code;
  };
  const reloadBoundary = (error) => {
    const captured = captureFailure(error, () => 'none');
    const evidence = captured.retirement_evidence;
    const phases = evidence?.timeline?.entries?.map((entry) => entry.phase) ?? [];
    return {
      lastCapturedPhase: phases.at(-1) ?? 'unavailable',
      timelineTruncated: evidence?.timeline ? (evidence.timeline.dropped_entries ?? 0) > 0 : null,
      clickStarted: phases.includes('click_started'),
      clickResolved: phases.includes('click_resolved'),
      preClickOldWorkerPresent: evidence?.timeline?.pre_click_old_worker_present ?? null,
      oldWorkerAbsent: evidence?.old_worker_absent ?? null,
      oldPanelAbsent: evidence?.old_panel_absent ?? null,
      replacementWorkerPresent: evidence?.replacement_worker_present ?? null,
      finalPredicate: evidence?.timeline?.final_predicate ?? null,
      contextExpectedAppeared: captured.context_boundary?.exact_expected_appeared ?? null,
    };
  };

  const inspectBaseline = async (stage) => {
    failureDetailStage = 'initial_baseline_settings';
    await settings(activePanel);
    failureDetailStage = 'initial_baseline_section';
    await openSection(activePanel, section);
    failureDetailStage = 'initial_baseline_observation';
    const state = await read(activePanel);
    const matched = matches(state, baseline.value, baseline.label);
    record(`${stage}: original preference matches`, matched ? 'pass' : 'fail', state);
    assert.equal(matched, true, `${stage}_baseline_mismatch`);
    return state;
  };

  const restartAndRead = async (value, label, stage) => {
    const restoring = stage === 'restore_extension_reload';
    const prefix = restoring ? 'restore' : 'choice';
    const previousPanel = activePanel;
    failureDetailStage = `${prefix}_extension_reload`;
    const result = await reloadExtension();
    failureDetailStage = `${prefix}_replacement_validation`;
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
    failureDetailStage = `${prefix}_detach_previous_panel`;
    await previousPanel.detach?.();
    failureDetailStage = restoring ? 'restore_settings_reopen' : 'choice_settings_reopen';
    await settings(activePanel);
    failureDetailStage = restoring ? 'restore_section_reopen' : 'choice_section_reopen';
    await openSection(activePanel, section);
    failureDetailStage = restoring
      ? 'restore_preference_observation'
      : 'choice_preference_observation';
    const state = await driver.waitFor(
      `${controlLabel}_${value}_after_extension_reload`,
      () => read(activePanel),
      (observed) => matches(observed, value, label),
    );
    record(`${label} survives full extension reload`, 'pass', state);
    failureDetailStage = restoring
      ? 'restore_after_reload_callback'
      : 'choice_after_reload_callback';
    await afterReload({ panel: activePanel, value, label, observation: state });
    return { state, stage };
  };

  try {
    failureStage = 'initial_baseline';
    await inspectBaseline('initial');
    for (const [value, label] of choices.filter(([candidate]) => candidate !== baseline.value)) {
      failureStage = 'choice_select';
      failureDetailStage = 'choice_section';
      await openSection(activePanel, section);
      failureDetailStage = 'choice_control';
      await driver.click(activePanel, controlKind, controlLabel);
      failureDetailStage = 'choice_option';
      if (controlKind === 'settings-select') await driver.click(activePanel, 'option', label);
      failureDetailStage = 'choice_observation';
      const state = await driver.waitFor(
        `${controlLabel}_${value}_before_extension_reload`,
        () => read(activePanel),
        (observed) => matches(observed, value, label),
      );
      record(`${label} changes visible and stored preference`, 'pass', state);
      failureStage = 'extension_reload';
      failureDetailStage = 'choice_extension_reload';
      await restartAndRead(value, label, failureStage);
    }
  } catch (error) {
    choiceFailure = true;
    choiceFailureStage = failureStage;
    choiceFailureDetailStage = safeDetailStage(failureDetailStage);
    choiceTransportClass = safeTransportFailureClass(transportFailureClass);
    choiceFailureCode = safeFailureCode(error);
    if (choiceFailureDetailStage === 'choice_extension_reload')
      choiceReloadBoundary = reloadBoundary(error);
  }

  try {
    failureStage = 'restore_panel';
    failureDetailStage = 'restore_settings';
    let current;
    try {
      await settings(activePanel);
      failureDetailStage = 'restore_section';
      await openSection(activePanel, section);
      failureDetailStage = 'restore_observation';
      current = await read(activePanel);
    } catch {
      if (typeof acquireLivePanel !== 'function') throw new Error('restore_panel_unavailable');
      failureDetailStage = 'restore_acquire_panel';
      const recovered = await acquireLivePanel();
      if (typeof recovered?.targetId !== 'string') throw new Error('restore_panel_unavailable');
      await activePanel.detach?.();
      activePanel = recovered;
      onPanelChanged(activePanel);
      failureDetailStage = 'restore_recovered_settings';
      await settings(activePanel);
      failureDetailStage = 'restore_recovered_section';
      await openSection(activePanel, section);
      failureDetailStage = 'restore_recovered_observation';
      current = await read(activePanel);
    }
    if (!matches(current, baseline.value, baseline.label)) {
      const visible = current?.selected ?? current?.visible ?? null;
      if (visible === baseline.label && current?.stored !== baseline.value) {
        const alternate = choices.find(([value]) => value !== baseline.value);
        if (!alternate) throw new Error('settings_full_extension_baseline_alternate_unavailable');
        failureStage = 'restore_choice';
        failureDetailStage = 'restore_alternate_select';
        await driver.click(activePanel, controlKind, controlLabel);
        if (controlKind === 'settings-select')
          await driver.click(activePanel, 'option', alternate[1]);
        failureDetailStage = 'restore_alternate_observation';
        current = await driver.waitFor(
          `${controlLabel}_alternate_before_baseline_restore`,
          () => read(activePanel),
          (observed) => matches(observed, alternate[0], alternate[1]),
        );
      }
      if (!matches(current, baseline.value, baseline.label)) {
        failureStage = 'restore_choice';
        failureDetailStage = 'restore_baseline_select';
        await driver.click(activePanel, controlKind, controlLabel);
        if (controlKind === 'settings-select')
          await driver.click(activePanel, 'option', baseline.label);
        failureDetailStage = 'restore_baseline_observation';
        current = await driver.waitFor(
          `${controlLabel}_baseline_before_extension_reload`,
          () => read(activePanel),
          (observed) => matches(observed, baseline.value, baseline.label),
        );
      }
    }
    failureDetailStage = 'restore_before_reload_record';
    record('original preference restored before extension reload', 'pass', current);
    failureStage = 'restore_extension_reload';
    failureDetailStage = 'restore_extension_reload';
    await restartAndRead(baseline.value, baseline.label, failureStage);
    failureDetailStage = 'restore_final_observation';
    record('original preference restored after extension reload', 'pass', await read(activePanel));
  } catch (error) {
    restoreFailure = true;
    restoreFailureStage = failureStage;
    restoreFailureDetailStage = safeDetailStage(failureDetailStage);
    restoreTransportClass = safeTransportFailureClass(transportFailureClass);
    restoreFailureCode = safeFailureCode(error);
    if (restoreFailureDetailStage === 'restore_extension_reload')
      restoreReloadBoundary = reloadBoundary(error);
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
    error.safeFirstChoiceFailureStage = choiceFailure ? choiceFailureDetailStage : 'not_failed';
    error.safeRestorationFailureStage = restoreFailure ? restoreFailureDetailStage : 'not_failed';
    error.safeFirstChoiceTransportClass = choiceFailure ? choiceTransportClass : 'not_applicable';
    error.safeRestorationTransportClass = restoreFailure ? restoreTransportClass : 'not_applicable';
    error.safeFirstChoiceFailureCode = choiceFailure ? choiceFailureCode : 'not_applicable';
    error.safeRestorationFailureCode = restoreFailure ? restoreFailureCode : 'not_applicable';
    error.safeFirstChoiceReloadBoundary = choiceReloadBoundary;
    error.safeRestorationReloadBoundary = restoreReloadBoundary;
    throw error;
  }
  return activePanel;
}
