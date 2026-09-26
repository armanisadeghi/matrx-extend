'use strict';

const assert = require('node:assert/strict');
const { runOwnedBrowserRestart } = require('./vault-extension-browser-restart-acceptance.cjs');

const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const workerUrl = `chrome-extension://${extensionId}/background.js`;
const panelUrl = `chrome-extension://${extensionId}/sidepanel.html`;
const identity = { userId: 'owned-admin', access: true, refresh: true };
const worker = (runtimeId = extensionId) => ({
  evaluate: async (fn) => (fn.toString().includes('runtime.id') ? runtimeId : identity),
});

const scenario = (overrides = {}) => {
  const state = {
    replacementClosed: false,
    replacementProcessExited: false,
    replacementJournalDisposed: false,
    writes: 0,
    order: [],
  };
  const targets = overrides.targets ?? [
    { targetId: 'new-worker', type: 'service_worker', url: workerUrl },
    { targetId: 'new-panel', type: 'page', url: panelUrl },
  ];
  const context = overrides.context ?? {
    close: async () => {
      state.replacementClosed = true;
    },
  };
  return {
    state,
    args: {
      profile: '/owned/disposable-profile',
      extensionId,
      workerUrl,
      initialContext: {
        close: async () => {
          state.initialClosed = true;
          state.order.push('initial-context-close');
        },
      },
      initialPanel: {
        dispose: async () => {
          state.initialPanelDisposed = true;
          state.order.push('initial-panel-dispose');
        },
        targetId: 'old-panel',
      },
      initialWorker: worker(),
      initialWorkerTargetId: 'old-worker',
      initialPanelTargetId: 'old-panel',
      initialBrowserPid: 111,
      initialCdp: {
        detach: async () => {
          state.initialCdpDetached = true;
          state.order.push('initial-cdp-detach');
        },
      },
      initialJournal: {
        dispose: async () => {
          state.initialJournalDisposed = true;
          state.order.push('initial-journal-dispose');
        },
      },
      assertOwnedProfile: async (profile) => profile === '/owned/disposable-profile',
      launchOptions: { executablePath: '/owned/chrome', args: ['--headless=new'] },
      launchOwnedPersistentContext: async ({ profile, launchOptions }) => {
        assert.equal(profile, '/owned/disposable-profile');
        assert.equal(launchOptions.executablePath, '/owned/chrome');
        state.order.push('replacement-launch');
        return { context, browserPid: overrides.browserPid ?? 222 };
      },
      assertLaunchProvenance: async ({ profile, launchOptions, browserPid }) =>
        profile === '/owned/disposable-profile' &&
        launchOptions.executablePath === '/owned/chrome' &&
        browserPid === 222,
      verifyProcessExited: async (pid) =>
        (pid === 111 && overrides.oldExited !== false) ||
        (pid === (overrides.browserPid ?? 222) && overrides.replacementExited !== false),
      verifyOwnedBrowserProcess: async ({ profile, launchOptions, browserPid }) =>
        profile === '/owned/disposable-profile' &&
        launchOptions.args[0] === '--headless=new' &&
        browserPid === 222 &&
        overrides.newOwned !== false,
      connectOwnedCdp: async () => {
        state.order.push('replacement-cdp-connect');
        return {
          send: async () => ({ targetInfos: targets }),
          detach: async () => {
            state.replacementCdpDetached = true;
          },
        };
      },
      createReplacementJournal: async () => ({
        start: async () => {
          state.order.push('replacement-journal-start');
        },
        bindPanelTarget: async () => {
          state.order.push('replacement-journal-bind');
        },
        settle: async () => {
          state.order.push('replacement-journal-settle');
        },
        assertCoverage: async () => {
          state.order.push('replacement-journal-coverage');
          if (overrides.coverageFailure) throw new Error('vault_network_observer_failed');
        },
        snapshot: () => ({ vaultMutationRequests: overrides.replacementMutations ?? 0 }),
        dispose: async () => {
          state.replacementJournalDisposed = true;
        },
      }),
      acquireWorker: async () => {
        state.order.push('replacement-worker-acquire');
        return { worker: worker(), targetId: overrides.workerTargetId ?? 'new-worker' };
      },
      openPanel: async () => {
        state.order.push('replacement-panel-open');
        return { targetId: overrides.panelTargetId ?? 'new-panel', dispose: async () => {} };
      },
      verifySettingsIdentity: async () => true,
      verifyPostBindVaultRead: async ({ panel, journal, worker, workerTargetId }) => {
        assert.equal(panel.targetId, overrides.panelTargetId ?? 'new-panel');
        assert.equal(typeof journal.assertCoverage, 'function');
        assert.equal(typeof worker.evaluate, 'function');
        assert.equal(workerTargetId, overrides.workerTargetId ?? 'new-worker');
        state.order.push('replacement-post-bind-vault-read');
        return overrides.postBindVaultRead !== false;
      },
      vaultWriteCount: () => state.writes,
      proof: {},
      ...overrides,
    },
  };
};

(async () => {
  const passed = scenario();
  const result = await runOwnedBrowserRestart(passed.args);
  assert.equal(passed.state.initialClosed, true);
  assert.equal(passed.state.initialPanelDisposed, true);
  assert.equal(passed.state.initialJournalDisposed, true);
  assert.ok(
    passed.state.order.indexOf('initial-journal-dispose') <
      passed.state.order.indexOf('initial-cdp-detach'),
    'initial journal must dispose before its CDP transport detaches',
  );
  assert.ok(
    passed.state.order.indexOf('replacement-journal-start') <
      passed.state.order.indexOf('replacement-worker-acquire'),
    'replacement journal must start before replacement worker use',
  );
  assert.ok(
    passed.state.order.indexOf('replacement-cdp-connect') <
      passed.state.order.indexOf('replacement-journal-start'),
    'replacement journal must start immediately after replacement CDP connection',
  );
  assert.equal(passed.state.replacementClosed, false, 'successful restart leaves replacement open');
  assert.ok(result.context);
  assert.equal(passed.args.proof.lifecycle.browserRestart.disposition, 'passed');
  assert.equal(passed.args.proof.lifecycle.browserRestart.newBrowserProcessObserved, true);
  assert.equal(passed.args.proof.lifecycle.browserRestart.launchProvenanceVerified, true);
  assert.equal(passed.args.proof.lifecycle.browserRestart.replacementJournalBound, true);
  assert.equal(passed.args.proof.lifecycle.browserRestart.replacementWorkerTargetId, 'new-worker');
  assert.equal(passed.args.proof.lifecycle.browserRestart.postBindVaultReadRecovered, true);
  assert.ok(
    passed.state.order.indexOf('replacement-journal-bind') <
      passed.state.order.indexOf('replacement-post-bind-vault-read'),
    'a real Vault read must follow panel binding',
  );
  assert.ok(
    passed.state.order.indexOf('replacement-journal-settle') <
      passed.state.order.indexOf('replacement-journal-coverage'),
    'replacement journal must settle before coverage is asserted',
  );

  for (const [name, overrides, code, launched, journalCreated] of [
    [
      'old process alive',
      { oldExited: false },
      'browser_restart_previous_process_alive',
      false,
      false,
    ],
    ['reused process pid', { browserPid: 111 }, 'browser_restart_process_pid_reused', true, false],
    [
      'unverified launch provenance',
      { assertLaunchProvenance: async () => false },
      'browser_restart_launch_provenance_unverified',
      true,
      false,
    ],
    [
      'unowned replacement process',
      { newOwned: false },
      'browser_restart_replacement_process_unowned',
      true,
      false,
    ],
    [
      'forged worker target',
      { targets: [{ targetId: 'new-panel', type: 'page', url: panelUrl }] },
      'browser_restart_replacement_worker_target_unverified',
      true,
      true,
    ],
    [
      'worker facade churn',
      { workerTargetId: 'stale-worker' },
      'browser_restart_replacement_worker_target_unverified',
      true,
      true,
    ],
    [
      'forged panel target',
      { panelTargetId: 'forged-panel' },
      'browser_restart_panel_target_unverified',
      true,
      true,
    ],
    [
      'vault write during restart',
      {
        vaultWriteCount: (() => {
          let count = 0;
          return () => count++;
        })(),
      },
      'browser_restart_evidence_incomplete',
      true,
      true,
    ],
    [
      'replacement journal mutation',
      { replacementMutations: 1 },
      'browser_restart_evidence_incomplete',
      true,
      true,
    ],
    [
      'replacement journal coverage failure',
      { coverageFailure: true },
      'vault_network_observer_failed',
      true,
      true,
    ],
    [
      'missing post-bind vault read',
      { postBindVaultRead: false },
      'browser_restart_post_bind_vault_read_unverified',
      true,
      true,
    ],
  ]) {
    const failed = scenario(overrides);
    await assert.rejects(() => runOwnedBrowserRestart(failed.args), new RegExp(code), name);
    assert.equal(failed.state.replacementClosed, launched, `${name} replacement cleanup mismatch`);
    assert.equal(
      failed.state.replacementJournalDisposed,
      journalCreated,
      `${name} journal cleanup mismatch`,
    );
  }

  const closeRejected = scenario({
    context: {
      close: async () => {
        closeRejected.state.replacementClosed = true;
        throw new Error('close_rejected');
      },
    },
    verifyProcessExited: async (pid) => {
      if (pid === 111) return true;
      closeRejected.state.replacementProcessExited = true;
      return false;
    },
    postBindVaultRead: false,
  });
  await assert.rejects(
    () => runOwnedBrowserRestart(closeRejected.args),
    /browser_restart_replacement_cleanup_unproven/,
  );
  const cleanup = closeRejected.args.proof.lifecycle.browserRestart;
  assert.equal(
    closeRejected.state.replacementClosed,
    true,
    'cleanup must still attempt context close',
  );
  assert.equal(
    closeRejected.state.replacementProcessExited,
    true,
    'cleanup must verify replacement exit',
  );
  assert.equal(cleanup.cleanupAttempted, true);
  assert.equal(cleanup.cleanupProven, false);
  assert.ok(cleanup.cleanupFailures.some((failure) => failure.step === 'context_close'));
  assert.ok(cleanup.cleanupFailures.some((failure) => failure.step === 'process_exit_verify'));
  const boundContext = {
    closed: false,
    async close() {
      assert.equal(this, boundContext, 'replacement close must keep its context receiver');
      this.closed = true;
    },
  };
  const boundCleanup = scenario({ context: boundContext, postBindVaultRead: false });
  await assert.rejects(
    () => runOwnedBrowserRestart(boundCleanup.args),
    /browser_restart_post_bind_vault_read_unverified/,
  );
  assert.equal(boundContext.closed, true);
  assert.equal(boundCleanup.args.proof.lifecycle.browserRestart.cleanupProven, true);
  process.stdout.write(
    'PASS: owned restart rejects forged process, launch, worker, and panel evidence\n',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
