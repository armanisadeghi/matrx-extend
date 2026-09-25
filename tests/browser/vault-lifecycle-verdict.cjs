/* Pure final-admission gate for explicitly armed generator lifecycle probes.
 * It accepts only observed completion; generic read-only admission remains a
 * separate concern in the outer runner. */

function assertRequestedLifecycleVerdicts({
  workerRestartRequested = false,
  windowSwitchRequested = false,
  panelCloseRequested = false,
  generator,
}) {
  if (panelCloseRequested && generator?.panelCloseLifecycle?.disposition !== 'passed')
    throw new Error('generator_panel_close_lifecycle_not_passed');

  const requireEvidence = (lifecycle, fields, prefix) => {
    for (const field of fields) {
      const value = field.split('.').reduce((current, key) => current?.[key], lifecycle);
      if (value !== true) throw new Error(`${prefix}_missing_${field.replace('.', '_')}`);
    }
  };

  if (workerRestartRequested && generator?.workerRestartLifecycle?.disposition !== 'passed')
    throw new Error('generator_worker_restart_lifecycle_not_passed');
  if (workerRestartRequested) {
    const lifecycle = generator.workerRestartLifecycle;
    requireEvidence(
      lifecycle,
      [
        'workerRealmReset',
        'oldWorkerTargetGone',
        'samePanelTargetAndDocument',
        'uiCandidateClearedOnDisconnect',
        'oldOfferCompletedBeforeExpiry',
        'oldOfferFieldsUnchanged',
        'freshUiGenerateUse',
      ],
      'generator_worker_restart_lifecycle',
    );
    if (lifecycle.oldOfferStatus !== 'stale')
      throw new Error('generator_worker_restart_lifecycle_old_offer_not_stale');
  }

  if (windowSwitchRequested && generator?.windowSwitchLifecycle?.disposition !== 'passed')
    throw new Error('generator_window_switch_lifecycle_not_passed');

  if (windowSwitchRequested) {
    const lifecycle = generator.windowSwitchLifecycle;
    if (lifecycle.transitionKind !== 'switch_away_then_close_other_window')
      throw new Error('generator_window_switch_lifecycle_transition_kind_invalid');
    requireEvidence(
      lifecycle,
      [
        'otherWindowFocusedBeforeOldUse',
        'otherWindowFocusedThroughOldUse',
        'uiCandidateClearedOnWindowSwitch',
        'samePanelTargetAndDocument',
        'oldOfferCompletedBeforeExpiry',
        'oldOfferFieldsUnchanged',
        'originalFocusedAfterClose',
        'freshUiGenerateUse',
      ],
      'generator_window_switch_lifecycle',
    );
    if (lifecycle.oldOfferStatus !== 'stale')
      throw new Error('generator_window_switch_lifecycle_old_offer_not_stale');
  }

  if (
    windowSwitchRequested &&
    !['verified_chrome_window_removed', 'verified_created_target_closed'].includes(
      generator?.windowSwitchLifecycle?.ownedExtraWindowCleanup,
    )
  )
    throw new Error('generator_window_switch_cleanup_not_verified');
}

module.exports = { assertRequestedLifecycleVerdicts };
