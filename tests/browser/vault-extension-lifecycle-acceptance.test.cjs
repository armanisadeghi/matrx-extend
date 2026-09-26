const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  inspectIdentity,
  refreshReadyExtensionWorker,
  sameLifecycleIdentity,
  runExtensionDisableEnable,
  runExtensionReload,
  runSettingsSignOut,
  visibleSettingsControl,
  visibleVaultControl,
  signedOutSidePanelPredicate,
} = require('./vault-extension-lifecycle-acceptance.cjs');

(async () => {
  const state = {
    'matrx.user.profile': { id: '8ed08df2-2d6a-4f7d-a6f7-1a6b7c362cce' },
    'matrx.auth.accessToken': 'token',
    'matrx.auth.refreshTokenEnc': 'cipher',
    'matrx.auth.refreshTokenIv': 'iv',
    'matrx.org.active': { id: '439723a2-20cb-4531-8876-1b2e7c6e68ba' },
  };
  const snapshot = {
    userId: state['matrx.user.profile'].id,
    access: true,
    refresh: true,
    organization: true,
  };
  const targetListeners = new Map();
  const reloadCdp = {
    send: async (method, params) => {
      assert.equal(method, 'Target.setDiscoverTargets');
      assert.deepEqual(params, { discover: true });
    },
    on: (event, listener) => targetListeners.set(event, listener),
    off: (event, listener) => {
      if (targetListeners.get(event) === listener) targetListeners.delete(event);
    },
    emit: (event, payload) => targetListeners.get(event)?.(payload),
  };
  const worker = {
    evaluate: async (fn) => {
      if (!fn.toString().includes('runtime.reload')) return snapshot;
      reloadCdp.emit('Target.targetCreated', {
        targetInfo: {
          targetId: 'replacement-worker',
          type: 'service_worker',
          url: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/background.js',
        },
      });
      return undefined;
    },
  };
  await assert.rejects(
    () => inspectIdentity({ evaluate: async () => ({ userId: null }) }),
    /lifecycle_initial_identity_unavailable/,
  );
  const initialHash = crypto.createHash('sha256').update(snapshot.userId).digest('hex');
  assert.equal(sameLifecycleIdentity(initialHash, initialHash), true);
  assert.equal(
    sameLifecycleIdentity(initialHash, crypto.createHash('sha256').update('other').digest('hex')),
    false,
  );
  assert.equal(sameLifecycleIdentity(undefined, initialHash), false);
  await assert.rejects(
    () =>
      refreshReadyExtensionWorker({
        replacementTarget: { targetId: 'replacement-worker' },
        refreshWorker: async () => ({
          evaluate: async () => {
            throw new Error('Protocol error: target not available');
          },
        }),
        extensionId: 'abcdefghijklmnopabcdefghijklmnop',
        wait: async () => {},
        attempts: 1,
      }),
    /lifecycle_reenabled_worker_handle_unavailable/,
  );
  await assert.rejects(
    () =>
      refreshReadyExtensionWorker({
        replacementTarget: { targetId: 'replacement-worker' },
        refreshWorker: async () => ({ evaluate: async () => 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }),
        extensionId: 'abcdefghijklmnopabcdefghijklmnop',
        wait: async () => {},
        attempts: 1,
      }),
    /lifecycle_reenabled_extension_identity_mismatch/,
  );
  assert.match(visibleSettingsControl, /button\[title="Settings"\]/);
  assert.doesNotMatch(visibleSettingsControl, /textContent/);
  assert.match(visibleVaultControl, /button\[title="Vault"\]/);
  assert.doesNotMatch(visibleVaultControl, /textContent/);
  assert.match(signedOutSidePanelPredicate, /=== 1/);
  assert.match(signedOutSidePanelPredicate, /=== 0/);
  assert.doesNotMatch(signedOutSidePanelPredicate, /includes\('Settings'\)/);

  const reloadProof = {};
  const replacement = { ...worker };
  const reloadBoundary = {
    cdp: reloadCdp,
    workerUrl: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/background.js',
    previousWorkerTargetId: 'old-worker',
    previousPanelTargetId: 'old-panel',
    assertPreviousTargetsGone: async () => ({ workerTargetGone: true, panelTargetGone: true }),
    reopenPanel: async () => ({ targetId: 'replacement-panel' }),
  };
  const returned = await runExtensionReload({
    worker,
    ...reloadBoundary,
    refreshWorker: async (target) => {
      assert.equal(target.targetId, 'replacement-worker');
      return replacement;
    },
    verifySettingsIdentity: async () => true,
    checkpoint: () => {},
    proof: reloadProof,
  });
  assert.equal(returned, replacement);
  assert.equal(reloadProof.lifecycle.extensionReload.disposition, 'passed');

  // The replacement target must be captured before reload, then rebound before
  // the owned-window action.openPopup path opens the replacement panel.
  const reloadWakeOrder = [];
  await runExtensionReload({
    worker,
    cdp: {
      ...reloadCdp,
      send: async (method, params) => {
        reloadWakeOrder.push('watcher-armed');
        assert.equal(method, 'Target.setDiscoverTargets');
        assert.deepEqual(params, { discover: true });
      },
    },
    workerUrl: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/background.js',
    previousWorkerTargetId: 'old-worker',
    previousPanelTargetId: 'old-panel',
    assertPreviousTargetsGone: async () => {
      reloadWakeOrder.push('previous-targets-gone');
      return { workerTargetGone: true, panelTargetGone: true };
    },
    refreshWorker: async (target) => {
      assert.deepEqual(reloadWakeOrder, ['watcher-armed', 'previous-targets-gone']);
      assert.equal(target.targetId, 'replacement-worker');
      reloadWakeOrder.push('replacement-worker');
      return replacement;
    },
    reopenPanel: async (reboundWorker) => {
      assert.equal(reboundWorker, replacement);
      reloadWakeOrder.push('replacement-panel');
      return { targetId: 'replacement-panel' };
    },
    verifySettingsIdentity: async () => {
      reloadWakeOrder.push('settings');
      return true;
    },
    checkpoint: () => {},
    proof: {},
  });
  assert.deepEqual(reloadWakeOrder, [
    'watcher-armed',
    'previous-targets-gone',
    'replacement-worker',
    'replacement-panel',
    'settings',
  ]);

  // A stale panel can remain callable across a reload, but it cannot be used
  // as recovery evidence even if its Settings interaction appears successful.
  let stalePanelSettingsCalls = 0;
  let stalePanelRefreshCalls = 0;
  await assert.rejects(
    () =>
      runExtensionReload({
        worker,
        ...reloadBoundary,
        previousWorkerTargetId: 'old-worker',
        previousPanelTargetId: 'old-panel',
        assertPreviousTargetsGone: async () => ({ workerTargetGone: true, panelTargetGone: true }),
        reopenPanel: async () => ({
          targetId: 'old-panel',
          click: async () => {},
        }),
        refreshWorker: async () => {
          stalePanelRefreshCalls += 1;
          return replacement;
        },
        verifySettingsIdentity: async (panel) => {
          stalePanelSettingsCalls += 1;
          await panel.click();
          return true;
        },
        checkpoint: () => {},
        proof: {},
      }),
    /lifecycle_reload_panel_target_not_replaced/,
  );
  assert.equal(stalePanelSettingsCalls, 0);
  assert.equal(stalePanelRefreshCalls, 1);

  let oldTargetReopenCalls = 0;
  await assert.rejects(
    () =>
      runExtensionReload({
        worker,
        ...reloadBoundary,
        previousWorkerTargetId: 'old-worker',
        previousPanelTargetId: 'old-panel',
        assertPreviousTargetsGone: async () => ({ workerTargetGone: false, panelTargetGone: true }),
        reopenPanel: async () => {
          oldTargetReopenCalls += 1;
          return { targetId: 'replacement-panel' };
        },
        refreshWorker: async () => replacement,
        verifySettingsIdentity: async () => true,
        checkpoint: () => {},
        proof: {},
      }),
    /lifecycle_reload_old_worker_target_observed/,
  );
  assert.equal(oldTargetReopenCalls, 0);

  const unobservedProof = {};
  await assert.rejects(
    () =>
      runExtensionReload({
        worker,
        ...reloadBoundary,
        refreshWorker: async () => worker,
        verifySettingsIdentity: async () => true,
        checkpoint: () => {},
        proof: unobservedProof,
      }),
    /lifecycle_reload_worker_target_not_replaced/,
  );

  let extensionEnabled = true;
  let extensionsPageClosed = false;
  const toggle = {
    count: async () => 1,
    evaluate: async () => extensionEnabled,
    click: async () => {
      extensionEnabled = !extensionEnabled;
    },
  };
  const disableCleanupProof = {};
  await assert.rejects(
    () =>
      runExtensionDisableEnable({
        worker: {
          evaluate: async (fn) =>
            fn.toString().includes('storage.local') ? snapshot : 'abcdefghijklmnopabcdefghijklmnop',
        },
        cdp: {
          send: async () => ({
            targetInfos: [
              { targetId: 'old-worker', type: 'service_worker' },
              { targetId: 'old-panel', type: 'page' },
            ],
          }),
        },
        workerUrl: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/background.js',
        previousTargetId: 'old-worker',
        panelTargetId: 'old-panel',
        extensionId: 'abcdefghijklmnopabcdefghijklmnop',
        context: {
          newPage: async () => ({
            locator: (selector) => {
              assert.equal(selector, 'extensions-detail-view #enableToggle');
              return toggle;
            },
            goto: async () => {},
            close: async () => {
              extensionsPageClosed = true;
            },
          }),
        },
        refreshWorker: async () => worker,
        disposePanel: async () => {},
        reopenPanel: async () => ({ targetId: 'new-panel' }),
        verifySettingsIdentity: async () => true,
        checkpoint: () => {},
        proof: disableCleanupProof,
        wait: async () => {},
      }),
    /lifecycle_disable_targets_not_destroyed/,
  );
  assert.equal(extensionEnabled, true, 'failed probe must restore the Extensions UI toggle');
  assert.equal(extensionsPageClosed, true, 'failed probe must close the Extensions UI page');
  assert.deepEqual(disableCleanupProof.lifecycle.disableEnableCleanup, {
    disableRequested: true,
    disabledInExtensionsUi: true,
    reenableAttempted: true,
    enabledAfterCleanup: true,
    restoredByCleanup: true,
  });

  let replacementTargetQueries = 0;
  let replacementRuntimeChecks = 0;
  const readinessPhases = [];
  extensionEnabled = true;
  const readinessProof = {};
  const readyResult = await runExtensionDisableEnable({
    worker: {
      evaluate: async (fn) =>
        fn.toString().includes('storage.local') ? snapshot : 'abcdefghijklmnopabcdefghijklmnop',
    },
    cdp: {
      send: async () => {
        replacementTargetQueries += 1;
        return {
          targetInfos:
            replacementTargetQueries === 1
              ? []
              : [
                  {
                    targetId: 'replacement-worker',
                    type: 'service_worker',
                    url: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/background.js',
                  },
                ],
        };
      },
    },
    workerUrl: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/background.js',
    previousTargetId: 'old-worker',
    panelTargetId: 'old-panel',
    extensionId: 'abcdefghijklmnopabcdefghijklmnop',
    context: {
      newPage: async () => ({ locator: () => toggle, goto: async () => {}, close: async () => {} }),
    },
    refreshWorker: async () => ({
      evaluate: async (fn) => {
        if (fn.toString().includes('runtime.id')) {
          replacementRuntimeChecks += 1;
          if (replacementRuntimeChecks === 1)
            throw new Error('generator_worker_cdp_evaluate_refused');
          return 'abcdefghijklmnopabcdefghijklmnop';
        }
        return snapshot;
      },
    }),
    disposePanel: async () => {},
    reopenPanel: async () => ({ targetId: 'replacement-panel' }),
    verifySettingsIdentity: async () => true,
    checkpoint: (phase) => readinessPhases.push(phase),
    proof: readinessProof,
    wait: async () => {},
  });
  assert.equal(
    replacementRuntimeChecks,
    2,
    'replacement worker must retry one transient CDP refusal',
  );
  assert.equal(readyResult.panel.targetId, 'replacement-panel');
  assert.equal(readinessProof.lifecycle.disableEnable.disposition, 'passed');
  assert.deepEqual(readinessPhases, [
    'lifecycle_extension_disable',
    'lifecycle_extension_enable',
    'lifecycle_extension_enable_ui_observed',
    'lifecycle_extension_enable_replacement_target_observed',
    'lifecycle_extension_enable_worker_ready',
    'lifecycle_extension_enable_identity_recovered',
    'lifecycle_extension_enable_panel_reopened',
    'lifecycle_extension_enable_settings_identity_recovered',
  ]);

  const order = [];
  const signOutProof = {};
  await runSettingsSignOut({
    worker: { evaluate: async () => true },
    panel: {
      click: async () => {
        order.push('click');
      },
      waitFor: async (expression) => {
        if (expression.includes("'Sign in'")) {
          assert.doesNotMatch(
            expression,
            /includes\('Settings'\)/,
            'guest panel predicate must not require a Settings heading',
          );
          order.push('signedout-ui-wait');
        } else order.push('settings-wait');
      },
      evaluate: async () => true,
    },
    checkpoint: () => {},
    proof: signOutProof,
    waitForLogout204: async () => {
      order.push('logout204');
      return true;
    },
    verifySignedOutVaultHidden: async () => {
      order.push('vault-hidden');
      return true;
    },
    verifyBearerlessVaultApiRefusal: async () => ({
      status: 401,
      authorizationHeaderAbsent: true,
      refused: true,
    }),
  });
  assert.ok(
    order.indexOf('logout204') < order.indexOf('signedout-ui-wait'),
    'logout must be observed before later UI waits',
  );
  assert.equal(signOutProof.lifecycle.signOut.disposition, 'passed');
  assert.equal(signOutProof.lifecycle.signOut.signedOutVaultHidden, true);
  assert.deepEqual(signOutProof.lifecycle.signOut.bearerlessVaultApiRefusal, {
    status: 401,
    authorizationHeaderAbsent: true,
    refused: true,
  });
  process.stdout.write(
    'PASS: lifecycle helpers require actual signed-out UI, hidden Vault navigation, and bearerless API refusal\n',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
