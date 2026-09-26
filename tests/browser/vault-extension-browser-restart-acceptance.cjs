'use strict';

const crypto = require('node:crypto');

const assert = (value, code) => {
  if (!value) throw new Error(code);
};

const identityHash = async (worker) => {
  const identity = await worker.evaluate(async () => {
    const value = await chrome.storage.local.get([
      'matrx.user.profile',
      'matrx.auth.accessToken',
      'matrx.auth.refreshTokenEnc',
      'matrx.auth.refreshTokenIv',
    ]);
    return {
      userId:
        typeof value['matrx.user.profile']?.id === 'string' ? value['matrx.user.profile'].id : null,
      access: typeof value['matrx.auth.accessToken'] === 'string',
      refresh:
        typeof value['matrx.auth.refreshTokenEnc'] === 'string' &&
        typeof value['matrx.auth.refreshTokenIv'] === 'string',
    };
  });
  assert(
    identity?.userId && identity.access && identity.refresh,
    'browser_restart_identity_unavailable',
  );
  return crypto.createHash('sha256').update(identity.userId).digest('hex');
};

async function runOwnedBrowserRestart({
  profile,
  extensionId,
  workerUrl,
  initialContext,
  initialPanel,
  initialWorker,
  initialWorkerTargetId,
  initialPanelTargetId,
  initialBrowserPid,
  initialCdp,
  initialJournal,
  assertOwnedProfile,
  launchOptions,
  launchOwnedPersistentContext,
  assertLaunchProvenance,
  verifyProcessExited,
  verifyOwnedBrowserProcess,
  connectOwnedCdp,
  createReplacementJournal,
  acquireWorker,
  openPanel,
  verifySettingsIdentity,
  verifyPostBindVaultRead,
  vaultWriteCount,
  proof,
}) {
  assert(typeof profile === 'string' && profile.length > 0, 'browser_restart_profile_missing');
  assert(
    typeof extensionId === 'string' && /^[a-p]{32}$/.test(extensionId),
    'browser_restart_extension_id_invalid',
  );
  assert(
    typeof workerUrl === 'string' && workerUrl.startsWith(`chrome-extension://${extensionId}/`),
    'browser_restart_worker_url_invalid',
  );
  for (const [value, code] of [
    [initialContext?.close, 'browser_restart_initial_context_missing'],
    [initialWorker?.evaluate, 'browser_restart_initial_worker_missing'],
    [
      typeof initialWorkerTargetId === 'string' && initialWorkerTargetId,
      'browser_restart_initial_worker_target_missing',
    ],
    [
      typeof initialPanelTargetId === 'string' && initialPanelTargetId,
      'browser_restart_initial_panel_target_missing',
    ],
    [
      Number.isSafeInteger(initialBrowserPid) && initialBrowserPid > 1,
      'browser_restart_initial_pid_invalid',
    ],
    [typeof initialJournal?.dispose === 'function', 'browser_restart_initial_journal_missing'],
    [typeof assertOwnedProfile === 'function', 'browser_restart_profile_ownership_missing'],
    [
      launchOptions && typeof launchOptions === 'object' && !Array.isArray(launchOptions),
      'browser_restart_launch_options_missing',
    ],
    [typeof launchOwnedPersistentContext === 'function', 'browser_restart_launcher_missing'],
    [typeof assertLaunchProvenance === 'function', 'browser_restart_launch_provenance_missing'],
    [typeof verifyProcessExited === 'function', 'browser_restart_exit_verifier_missing'],
    [typeof verifyOwnedBrowserProcess === 'function', 'browser_restart_process_ownership_missing'],
    [typeof connectOwnedCdp === 'function', 'browser_restart_cdp_connector_missing'],
    [typeof createReplacementJournal === 'function', 'browser_restart_journal_factory_missing'],
    [typeof acquireWorker === 'function', 'browser_restart_worker_acquirer_missing'],
    [typeof openPanel === 'function', 'browser_restart_panel_opener_missing'],
    [typeof verifySettingsIdentity === 'function', 'browser_restart_settings_verifier_missing'],
    [typeof verifyPostBindVaultRead === 'function', 'browser_restart_post_bind_read_missing'],
    [typeof vaultWriteCount === 'function', 'browser_restart_write_counter_missing'],
  ])
    assert(Boolean(value), code);

  assert(
    (await assertOwnedProfile(profile)) === true,
    'browser_restart_profile_ownership_unverified',
  );
  const beforeIdentitySha256 = await identityHash(initialWorker);
  const writesBefore = vaultWriteCount();
  assert(
    Number.isInteger(writesBefore) && writesBefore >= 0,
    'browser_restart_write_count_invalid',
  );
  let replacementContext;
  let replacementPanel;
  let replacementCdp;
  let replacementJournal;
  let succeeded = false;
  const lifecycle = ((proof.lifecycle ||= {}).browserRestart = {
    disposition: 'in_progress',
    previousBrowserExited: false,
    newBrowserProcessObserved: false,
    settingsUiRecovered: false,
    sameIdentityRecovered: false,
    identitySha256: null,
    previousWorkerTargetGone: false,
    previousPanelTargetGone: false,
    replacementWorkerObserved: false,
    replacementPanelObserved: false,
    replacementWorkerTargetId: null,
    noVaultWrites: false,
    replacementJournalBound: false,
    postBindVaultReadRecovered: false,
    previousBrowserPid: initialBrowserPid,
    replacementBrowserPid: null,
    launchProvenanceVerified: false,
    cleanupAttempted: false,
    cleanupProven: false,
    cleanupFailures: [],
    replacementProcessExited: null,
    replacementOwnership: 'helper',
  });
  try {
    await initialPanel?.dispose?.();
    await initialJournal.dispose();
    await initialContext.close();
    lifecycle.previousBrowserExited = (await verifyProcessExited(initialBrowserPid)) === true;
    assert(lifecycle.previousBrowserExited, 'browser_restart_previous_process_alive');
    await initialCdp?.detach?.().catch(() => {});

    const launched = await launchOwnedPersistentContext({ profile, launchOptions });
    replacementContext = launched?.context;
    const replacementBrowserPid = launched?.browserPid;
    assert(replacementContext?.close, 'browser_restart_replacement_context_missing');
    assert(
      Number.isSafeInteger(replacementBrowserPid) && replacementBrowserPid > 1,
      'browser_restart_replacement_pid_invalid',
    );
    lifecycle.replacementBrowserPid = replacementBrowserPid;
    assert(replacementBrowserPid !== initialBrowserPid, 'browser_restart_process_pid_reused');
    lifecycle.launchProvenanceVerified =
      (await assertLaunchProvenance({
        profile,
        launchOptions,
        context: replacementContext,
        browserPid: replacementBrowserPid,
      })) === true;
    assert(lifecycle.launchProvenanceVerified, 'browser_restart_launch_provenance_unverified');
    lifecycle.newBrowserProcessObserved =
      (await verifyOwnedBrowserProcess({
        profile,
        launchOptions,
        context: replacementContext,
        browserPid: replacementBrowserPid,
      })) === true;
    assert(lifecycle.newBrowserProcessObserved, 'browser_restart_replacement_process_unowned');
    replacementCdp = await connectOwnedCdp(replacementContext, profile);
    replacementJournal = await createReplacementJournal({
      context: replacementContext,
      cdp: replacementCdp,
      profile,
    });
    assert(
      typeof replacementJournal?.start === 'function',
      'browser_restart_replacement_journal_missing',
    );
    assert(
      typeof replacementJournal?.bindPanelTarget === 'function',
      'browser_restart_replacement_journal_bind_missing',
    );
    assert(
      typeof replacementJournal?.settle === 'function',
      'browser_restart_replacement_journal_settle_missing',
    );
    assert(
      typeof replacementJournal?.assertCoverage === 'function',
      'browser_restart_replacement_journal_coverage_missing',
    );
    assert(
      typeof replacementJournal?.snapshot === 'function',
      'browser_restart_replacement_journal_snapshot_missing',
    );
    assert(
      typeof replacementJournal?.dispose === 'function',
      'browser_restart_replacement_journal_dispose_missing',
    );
    await replacementJournal.start();
    const targets = await replacementCdp.send('Target.getTargets');
    const ids = new Set(targets.targetInfos.map((target) => target.targetId));
    lifecycle.previousWorkerTargetGone = !ids.has(initialWorkerTargetId);
    lifecycle.previousPanelTargetGone = !ids.has(initialPanelTargetId);
    assert(
      lifecycle.previousWorkerTargetGone && lifecycle.previousPanelTargetGone,
      'browser_restart_previous_targets_survived',
    );
    const acquiredWorker = await acquireWorker(replacementContext, replacementCdp);
    const replacementWorker = acquiredWorker?.worker;
    const replacementWorkerTargetId = acquiredWorker?.targetId;
    assert(replacementWorker?.evaluate, 'browser_restart_replacement_worker_missing');
    assert(
      typeof replacementWorkerTargetId === 'string' && replacementWorkerTargetId,
      'browser_restart_replacement_worker_target_missing',
    );
    const runtimeId = await replacementWorker.evaluate(() => chrome.runtime.id);
    assert(runtimeId === extensionId, 'browser_restart_extension_identity_mismatch');
    const replacementTargets = (await replacementCdp.send('Target.getTargets')).targetInfos;
    const replacementTargetsForWorker = replacementTargets.filter(
      (target) =>
        target.targetId === replacementWorkerTargetId &&
        target.type === 'service_worker' &&
        target.url === workerUrl,
    );
    assert(
      replacementTargetsForWorker.length === 1,
      'browser_restart_replacement_worker_target_unverified',
    );
    const replacementTarget = replacementTargetsForWorker[0];
    lifecycle.replacementWorkerTargetId = replacementTarget.targetId;
    lifecycle.replacementWorkerObserved = replacementTarget.targetId !== initialWorkerTargetId;
    assert(lifecycle.replacementWorkerObserved, 'browser_restart_worker_target_reused');
    replacementPanel = await openPanel({
      context: replacementContext,
      cdp: replacementCdp,
      worker: replacementWorker,
    });
    assert(
      typeof replacementPanel?.targetId === 'string',
      'browser_restart_replacement_panel_missing',
    );
    lifecycle.replacementPanelObserved = replacementPanel.targetId !== initialPanelTargetId;
    assert(lifecycle.replacementPanelObserved, 'browser_restart_panel_target_reused');
    const exactPanelTargets = (await replacementCdp.send('Target.getTargets')).targetInfos.filter(
      (target) =>
        target.targetId === replacementPanel.targetId &&
        target.type === 'page' &&
        target.url === `chrome-extension://${extensionId}/sidepanel.html`,
    );
    assert(exactPanelTargets.length === 1, 'browser_restart_panel_target_unverified');
    await replacementJournal.bindPanelTarget(replacementPanel.targetId);
    lifecycle.replacementJournalBound = true;
    lifecycle.postBindVaultReadRecovered =
      (await verifyPostBindVaultRead({
        context: replacementContext,
        cdp: replacementCdp,
        worker: replacementWorker,
        workerTargetId: replacementTarget.targetId,
        panel: replacementPanel,
        journal: replacementJournal,
      })) === true;
    assert(
      lifecycle.postBindVaultReadRecovered,
      'browser_restart_post_bind_vault_read_unverified',
    );
    lifecycle.settingsUiRecovered =
      (await verifySettingsIdentity(replacementWorker, replacementPanel)) === true;
    const recoveredIdentitySha256 = await identityHash(replacementWorker);
    lifecycle.identitySha256 = recoveredIdentitySha256;
    lifecycle.sameIdentityRecovered = recoveredIdentitySha256 === beforeIdentitySha256;
    await replacementJournal.settle();
    await replacementJournal.assertCoverage();
    const replacementJournalSnapshot = replacementJournal.snapshot();
    lifecycle.noVaultWrites =
      vaultWriteCount() === writesBefore && replacementJournalSnapshot?.vaultMutationRequests === 0;
    lifecycle.disposition =
      lifecycle.previousBrowserExited &&
      lifecycle.newBrowserProcessObserved &&
      lifecycle.settingsUiRecovered &&
      lifecycle.sameIdentityRecovered &&
      lifecycle.noVaultWrites
        ? 'passed'
        : 'failed';
    assert(lifecycle.disposition === 'passed', 'browser_restart_evidence_incomplete');
    succeeded = true;
    lifecycle.replacementOwnership = 'caller';
    return {
      context: replacementContext,
      cdp: replacementCdp,
      journal: replacementJournal,
      panel: replacementPanel,
      worker: replacementWorker,
    };
  } finally {
    // On a failed restart, the helper owns the replacement it launched. A
    // successful return transfers that ownership to the caller, which must
    // retain final-close proof in its own custody record.
    if (!succeeded) {
      lifecycle.cleanupAttempted = replacementContext != null;
      const cleanupStep = async (name, operation) => {
        try {
          await operation?.();
        } catch (error) {
          lifecycle.cleanupFailures.push({
            step: name,
            code: error instanceof Error ? error.message : String(error),
          });
        }
      };
      await cleanupStep('panel_dispose', () => replacementPanel?.dispose());
      await cleanupStep('journal_dispose', () => replacementJournal?.dispose());
      await cleanupStep('cdp_detach', () => replacementCdp?.detach());
      await cleanupStep('context_close', () => replacementContext?.close());
      if (Number.isSafeInteger(lifecycle.replacementBrowserPid)) {
        try {
          lifecycle.replacementProcessExited =
            (await verifyProcessExited(lifecycle.replacementBrowserPid)) === true;
        } catch (error) {
          lifecycle.cleanupFailures.push({
            step: 'process_exit_verify',
            code: error instanceof Error ? error.message : String(error),
          });
          lifecycle.replacementProcessExited = false;
        }
        if (!lifecycle.replacementProcessExited) {
          lifecycle.cleanupFailures.push({
            step: 'process_exit_verify',
            code: 'browser_restart_replacement_process_alive',
          });
        }
        lifecycle.cleanupProven = lifecycle.cleanupFailures.length === 0;
        if (!lifecycle.cleanupProven) {
          const cleanupError = new Error('browser_restart_replacement_cleanup_unproven');
          cleanupError.cleanupFailures = lifecycle.cleanupFailures;
          throw cleanupError;
        }
      }
    }
  }
}

module.exports = { identityHash, runOwnedBrowserRestart };
