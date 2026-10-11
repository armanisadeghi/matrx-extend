// A close/reopen proof requires document retirement, not focus or visibility alone.
export async function runOwnedPanelReopen({ identify, close, retired, open, acquire }) {
  let stage = 'identify';
  const evidence = {
    closeRequested: false,
    oldTargetRetired: false,
    oldContextRetired: false,
    trustedOpen: false,
    targetReplaced: false,
    contextReplaced: false,
    visible: false,
  };
  try {
    const before = await identify();
    if (!before?.targetId || !before?.contextId) throw new Error('panel_identity_missing');
    stage = 'close';
    evidence.closeRequested = (await close(before)) === true;
    if (!evidence.closeRequested) throw new Error('panel_close_refused');
    stage = 'retirement';
    const retirement = await retired(before);
    evidence.oldTargetRetired = retirement?.targetRetired === true;
    evidence.oldContextRetired = retirement?.contextRetired === true;
    if (!evidence.oldTargetRetired || !evidence.oldContextRetired)
      throw new Error('panel_retirement_unproven');
    stage = 'trusted_open';
    evidence.trustedOpen = (await open()) === true;
    if (!evidence.trustedOpen) throw new Error('panel_open_refused');
    stage = 'reacquire';
    const replacement = await acquire();
    evidence.targetReplaced = Boolean(
      replacement?.panel?.targetId && replacement.panel.targetId !== before.targetId,
    );
    evidence.contextReplaced = Boolean(
      replacement?.contextId && replacement.contextId !== before.contextId,
    );
    evidence.visible = replacement?.visible === true;
    if (!evidence.targetReplaced || !evidence.contextReplaced || !evidence.visible)
      throw new Error('panel_replacement_unproven');
    return { panel: replacement.panel, evidence };
  } catch (error) {
    const failure = new Error(`native_panel_reopen_failed:${stage}`);
    failure.panelReopenDiagnostic = { stage, ...evidence };
    throw failure;
  }
}
