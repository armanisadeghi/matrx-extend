/* Real extension lifecycle actions. The caller supplies CDP-backed worker and
 * panel handles from vault-realbrowser-acceptance; no DOM state is fabricated. */
const crypto = require('node:crypto');

const assert = (value, code) => {
  if (!value) throw new Error(code);
};
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
// Settings is an icon-only navigation control. Scope it by its stable title
// and rendered geometry; a hidden duplicate remains an ambiguity, never a click.
const visibleSettingsControl = `(() => {
  const controls = Array.from(document.querySelectorAll('button[title="Settings"]')).filter((button) => {
    const rect = button.getBoundingClientRect();
    const style = getComputedStyle(button);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && button.getAttribute('aria-hidden') !== 'true';
  });
  return controls.length === 1 ? controls[0] : null;
})()`;
const visibleVaultControl = `(() => {
  const controls = Array.from(document.querySelectorAll('button[title="Vault"]')).filter((button) => {
    const rect = button.getBoundingClientRect();
    const style = getComputedStyle(button);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && button.getAttribute('aria-hidden') !== 'true';
  });
  return controls.length === 1 ? controls[0] : null;
})()`;
const signedOutSidePanelPredicate = `(() => {
  const visibleButtons = Array.from(document.querySelectorAll('button')).filter((button) => {
    const rect = button.getBoundingClientRect();
    const style = getComputedStyle(button);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && button.getAttribute('aria-hidden') !== 'true';
  });
  return visibleButtons.filter((button) => button.textContent.trim() === 'Sign in').length === 1
    && visibleButtons.filter((button) => button.textContent.trim() === 'Sign out').length === 0;
})()`;

async function inspectIdentity(worker) {
  const session = await worker.evaluate(async () => {
    const keys = [
      'matrx.user.profile',
      'matrx.auth.accessToken',
      'matrx.auth.refreshTokenEnc',
      'matrx.auth.refreshTokenIv',
      'matrx.org.active',
    ];
    const value = await chrome.storage.local.get(keys);
    return {
      userId:
        typeof value['matrx.user.profile']?.id === 'string' ? value['matrx.user.profile'].id : null,
      access: typeof value['matrx.auth.accessToken'] === 'string',
      refresh:
        typeof value['matrx.auth.refreshTokenEnc'] === 'string' &&
        typeof value['matrx.auth.refreshTokenIv'] === 'string',
      organization: typeof value['matrx.org.active']?.id === 'string',
    };
  });
  assert(
    typeof session?.userId === 'string' && session.access && session.refresh,
    'lifecycle_initial_identity_unavailable',
  );
  return {
    identitySha256: hash(session.userId),
    activeOrganizationPresent: session.organization === true,
  };
}

function sameLifecycleIdentity(initialIdentitySha256, recoveredIdentitySha256) {
  return (
    typeof initialIdentitySha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(initialIdentitySha256) &&
    initialIdentitySha256 === recoveredIdentitySha256
  );
}

// Playwright can retain its original Worker facade after chrome.runtime.reload().
// The browser-level target is the lifecycle authority: only a different MV3
// service-worker target proves that reload replaced the executing worker.
async function waitForReplacementExtensionWorkerTarget({
  cdp,
  workerUrl,
  previousTargetId,
  wait,
  attempts = 60,
}) {
  assert(typeof workerUrl === 'string' && workerUrl.length > 0, 'lifecycle_worker_url_missing');
  assert(
    typeof previousTargetId === 'string' && previousTargetId.length > 0,
    'lifecycle_initial_worker_target_missing',
  );
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const targets = await cdp.send('Target.getTargets');
    const replacement = targets.targetInfos.find(
      (target) =>
        target.type === 'service_worker' &&
        target.url === workerUrl &&
        target.targetId !== previousTargetId,
    );
    if (replacement) return replacement;
    await wait(250);
  }
  throw new Error('lifecycle_replacement_worker_target_timeout');
}

// Target discovery precedes creation of the service worker's execution
// context. Retry only the documented transient CDP refusal, and only while
// proving the replacement's exact extension identity.
async function refreshReadyExtensionWorker({
  replacementTarget,
  refreshWorker,
  extensionId,
  wait,
  attempts = 60,
}) {
  let lastRefusal;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const candidate = await refreshWorker(replacementTarget);
    let runtimeId;
    try {
      runtimeId = await candidate.evaluate(() => chrome.runtime.id);
    } catch (error) {
      if (error?.message !== 'generator_worker_cdp_evaluate_refused') {
        if (/^generator_worker_cdp_evaluate_(?:timeout|refused)$/.test(error?.message ?? ''))
          throw error;
        throw new Error('lifecycle_reenabled_worker_handle_unavailable');
      }
      lastRefusal = error;
      await wait(100);
      continue;
    }
    assert(runtimeId === extensionId, 'lifecycle_reenabled_extension_identity_mismatch');
    return candidate;
  }
  throw new Error(
    `lifecycle_reenabled_worker_execution_context_timeout${lastRefusal ? '' : '_unobserved'}`,
  );
}

async function runExtensionReload({
  worker,
  previousWorkerTargetId,
  previousPanelTargetId,
  assertPreviousTargetsGone,
  reopenPanel,
  refreshWorker,
  verifySettingsIdentity,
  checkpoint,
  proof,
}) {
  assert(
    typeof previousWorkerTargetId === 'string' && previousWorkerTargetId.length > 0,
    'lifecycle_reload_initial_worker_target_missing',
  );
  assert(
    typeof previousPanelTargetId === 'string' && previousPanelTargetId.length > 0,
    'lifecycle_reload_initial_panel_target_missing',
  );
  assert(
    typeof assertPreviousTargetsGone === 'function',
    'lifecycle_reload_target_retirement_missing',
  );
  assert(typeof reopenPanel === 'function', 'lifecycle_reload_panel_reopen_missing');
  const before = await inspectIdentity(worker);
  checkpoint('lifecycle_extension_reload');
  await worker.evaluate(() => chrome.runtime.reload());
  checkpoint('lifecycle_extension_reload_previous_targets_retired');
  const previousTargetsGone = await assertPreviousTargetsGone();
  assert(
    previousTargetsGone?.workerTargetGone === true,
    'lifecycle_reload_old_worker_target_observed',
  );
  assert(
    previousTargetsGone?.panelTargetGone === true,
    'lifecycle_reload_old_panel_target_observed',
  );

  // MV3 workers are demand-started. Rebind a target that was created after
  // reload before using Settings to wake the worker; a surviving, callable
  // pre-reload panel is explicitly insufficient lifecycle evidence.
  checkpoint('lifecycle_extension_reload_panel_reopened');
  const panel = await reopenPanel();
  assert(
    typeof panel?.targetId === 'string' && panel.targetId !== previousPanelTargetId,
    'lifecycle_reload_panel_target_not_replaced',
  );
  checkpoint('lifecycle_extension_reload_settings_wake');
  const settingsUiRecovered = await verifySettingsIdentity(panel);
  const refreshed = await refreshWorker(worker);
  const replacement = refreshed?.worker || refreshed;
  const replacementWorkerObserved =
    refreshed?.replacementWorkerTargetObserved === true && replacement !== worker;
  const replacementWorkerTargetId = refreshed?.replacementWorkerTargetId;
  assert(
    typeof replacementWorkerTargetId === 'string' &&
      replacementWorkerTargetId !== previousWorkerTargetId,
    'lifecycle_reload_worker_target_not_replaced',
  );
  const after = await inspectIdentity(replacement);
  proof.lifecycle ||= {};
  proof.lifecycle.initialIdentitySha256 ||= before.identitySha256;
  proof.lifecycle.extensionReload = {
    disposition:
      replacementWorkerObserved &&
      sameLifecycleIdentity(before.identitySha256, after.identitySha256) &&
      settingsUiRecovered
        ? 'passed'
        : 'failed',
    replacementWorkerObserved,
    previousWorkerTargetRetired: previousTargetsGone.workerTargetGone,
    previousPanelTargetRetired: previousTargetsGone.panelTargetGone,
    initialWorkerTargetId: previousWorkerTargetId,
    replacementWorkerTargetId,
    initialPanelTargetId: previousPanelTargetId,
    replacementPanelTargetId: panel.targetId,
    sameIdentityRecovered: before.identitySha256 === after.identitySha256,
    settingsUiRecovered,
    identitySha256: after.identitySha256,
  };
  return replacement;
}

async function runExtensionDisableEnable({
  worker,
  cdp,
  workerUrl,
  previousTargetId,
  panelTargetId,
  extensionId,
  context,
  refreshWorker,
  disposePanel,
  reopenPanel,
  verifySettingsIdentity,
  checkpoint,
  proof,
  wait,
}) {
  assert(
    typeof extensionId === 'string' && /^[a-p]{32}$/.test(extensionId),
    'lifecycle_extension_id_invalid',
  );
  assert(context && typeof context.newPage === 'function', 'lifecycle_extensions_context_missing');
  assert(cdp && typeof cdp.send === 'function', 'lifecycle_extensions_cdp_missing');
  assert(
    typeof panelTargetId === 'string' && panelTargetId.length > 0,
    'lifecycle_panel_target_missing',
  );
  assert(typeof refreshWorker === 'function', 'lifecycle_worker_refresh_missing');
  assert(typeof disposePanel === 'function', 'lifecycle_panel_dispose_missing');
  assert(typeof reopenPanel === 'function', 'lifecycle_panel_reopen_missing');
  assert(typeof verifySettingsIdentity === 'function', 'lifecycle_settings_verify_missing');
  assert(typeof wait === 'function', 'lifecycle_wait_missing');

  const before = await inspectIdentity(worker);
  const initialRuntimeId = await worker.evaluate(() => chrome.runtime.id);
  assert(initialRuntimeId === extensionId, 'lifecycle_initial_extension_identity_mismatch');
  checkpoint('lifecycle_extension_disable');

  const extensionsPage = await context.newPage();
  // The list card and the details page both expose #enableToggle in Chrome
  // 153. The id route below opens the details page; bind only its control.
  const toggle = extensionsPage.locator('extensions-detail-view #enableToggle');
  let disableRequested = false;
  const cleanup = ((proof.lifecycle ||= {}).disableEnableCleanup = {
    disableRequested: false,
    disabledInExtensionsUi: false,
    reenableAttempted: false,
    enabledAfterCleanup: false,
    restoredByCleanup: false,
  });
  const toggleEnabled = async () => {
    const count = await toggle.count();
    if (count !== 1) return null;
    return toggle.evaluate((element) => element.checked === true);
  };
  try {
    await extensionsPage.goto(`chrome://extensions/?id=${extensionId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    for (let attempt = 0; attempt < 60 && (await toggleEnabled()) !== true; attempt += 1)
      await wait(100);
    assert((await toggleEnabled()) === true, 'lifecycle_extensions_enable_toggle_missing');
    disableRequested = true;
    cleanup.disableRequested = true;
    await toggle.click();
    for (let attempt = 0; attempt < 60 && (await toggleEnabled()) !== false; attempt += 1)
      await wait(100);
    assert((await toggleEnabled()) === false, 'lifecycle_extensions_disable_ui_unobserved');
    cleanup.disabledInExtensionsUi = true;

    let disabledTargetsGone = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const targets = await cdp.send('Target.getTargets');
      const ids = new Set(targets.targetInfos.map((target) => target.targetId));
      if (!ids.has(previousTargetId) && !ids.has(panelTargetId)) {
        disabledTargetsGone = true;
        break;
      }
      await wait(100);
    }
    assert(disabledTargetsGone, 'lifecycle_disable_targets_not_destroyed');
    await disposePanel();

    checkpoint('lifecycle_extension_enable');
    await toggle.click();
    for (let attempt = 0; attempt < 60 && (await toggleEnabled()) !== true; attempt += 1)
      await wait(100);
    assert((await toggleEnabled()) === true, 'lifecycle_extensions_enable_ui_unobserved');
    checkpoint('lifecycle_extension_enable_ui_observed');
    const replacementTarget = await waitForReplacementExtensionWorkerTarget({
      cdp,
      workerUrl,
      previousTargetId,
      wait,
    });
    checkpoint('lifecycle_extension_enable_replacement_target_observed');
    const replacement = await refreshReadyExtensionWorker({
      replacementTarget,
      refreshWorker,
      extensionId,
      wait,
    });
    checkpoint('lifecycle_extension_enable_worker_ready');
    const after = await inspectIdentity(replacement);
    checkpoint('lifecycle_extension_enable_identity_recovered');
    const panel = await reopenPanel(extensionsPage, replacement);
    assert(
      typeof panel?.targetId === 'string' &&
        panel.targetId.length > 0 &&
        panel.targetId !== panelTargetId,
      'lifecycle_reenabled_panel_not_replaced',
    );
    checkpoint('lifecycle_extension_enable_panel_reopened');
    const settingsUiRecovered = await verifySettingsIdentity(replacement, panel);
    checkpoint('lifecycle_extension_enable_settings_identity_recovered');
    proof.lifecycle ||= {};
    proof.lifecycle.initialIdentitySha256 ||= before.identitySha256;
    proof.lifecycle.disableEnable = {
      disposition:
        disabledTargetsGone &&
        replacementTarget.targetId !== previousTargetId &&
        sameLifecycleIdentity(before.identitySha256, after.identitySha256) &&
        settingsUiRecovered
          ? 'passed'
          : 'failed',
      disabledInExtensionsUi: true,
      enabledInExtensionsUi: true,
      replacementWorkerObserved: replacementTarget.targetId !== previousTargetId,
      settingsUiRecovered,
      sameIdentityRecovered: before.identitySha256 === after.identitySha256,
      identitySha256: after.identitySha256,
      initialWorkerTargetId: previousTargetId,
      replacementWorkerTargetId: replacementTarget.targetId,
      initialPanelTargetDestroyed: disabledTargetsGone,
      replacementPanelTargetId: panel.targetId,
      replacementPanelObserved: panel.targetId !== panelTargetId,
    };
    assert(
      proof.lifecycle.disableEnable.disposition === 'passed',
      'lifecycle_disable_enable_failed',
    );
    return { worker: replacement, panel };
  } finally {
    // A failed probe must never leave the only owned extension disabled. This
    // uses the same Chrome-owned toggle as the probe itself and deliberately
    // suppresses cleanup errors so the preceding failure remains authoritative.
    if (disableRequested) {
      cleanup.reenableAttempted = true;
      try {
        if ((await toggleEnabled()) === false) {
          await toggle.click();
          for (let attempt = 0; attempt < 60 && (await toggleEnabled()) !== true; attempt += 1)
            await wait(100);
          cleanup.restoredByCleanup = true;
        }
        cleanup.enabledAfterCleanup = (await toggleEnabled()) === true;
      } catch {
        cleanup.enabledAfterCleanup = false;
      }
    }
    await extensionsPage.close().catch(() => {});
  }
}

async function runSettingsSignOut({
  worker,
  panel,
  checkpoint,
  proof,
  waitForLogout204,
  verifyBearerlessVaultApiRefusal,
  verifySignedOutVaultHidden,
}) {
  checkpoint('lifecycle_settings_sign_out');
  // Settings is the product navigation item; use the real CDP click helper.
  await panel.click(visibleSettingsControl);
  await panel.waitFor(`document.body.innerText.includes('Settings')`);
  await panel.click(
    `Array.from(document.querySelectorAll('button')).find((element) => element.textContent.trim() === 'Sign out')`,
  );
  const remoteLogout204 = await waitForLogout204();
  const cleared = await worker.evaluate(async () => {
    const keys = [
      'matrx.user.profile',
      'matrx.auth.accessToken',
      'matrx.auth.refreshTokenEnc',
      'matrx.auth.refreshTokenIv',
      'matrx.org.active',
    ];
    const value = await chrome.storage.local.get(keys);
    return keys.every((key) => value[key] === undefined);
  });
  await panel.waitFor(signedOutSidePanelPredicate);
  const sidePanelShowsSignedOut = await panel.evaluate(signedOutSidePanelPredicate);
  const signedOutVaultHidden = await verifySignedOutVaultHidden();
  const bearerlessVaultApiRefusal = await verifyBearerlessVaultApiRefusal();
  proof.lifecycle ||= {};
  proof.lifecycle.signOut = {
    disposition:
      cleared &&
      remoteLogout204 &&
      sidePanelShowsSignedOut &&
      signedOutVaultHidden &&
      bearerlessVaultApiRefusal?.refused
        ? 'passed'
        : 'failed',
    settingsSignOutClicked: true,
    sidePanelShowsSignedOut,
    signedOutVaultHidden,
    localAuthMaterialAbsent: cleared,
    activeOrganizationAbsent: cleared,
    remoteLogout204,
    bearerlessVaultApiRefusal,
  };
  assert(
    cleared &&
      remoteLogout204 &&
      sidePanelShowsSignedOut &&
      signedOutVaultHidden &&
      bearerlessVaultApiRefusal?.refused,
    'lifecycle_sign_out_evidence_incomplete',
  );
}

module.exports = {
  inspectIdentity,
  sameLifecycleIdentity,
  waitForReplacementExtensionWorkerTarget,
  refreshReadyExtensionWorker,
  runExtensionReload,
  runExtensionDisableEnable,
  runSettingsSignOut,
  visibleSettingsControl,
  visibleVaultControl,
  signedOutSidePanelPredicate,
};
