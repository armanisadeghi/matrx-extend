import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { reloadCase } from './native-reload-fixture.mjs';
import { safeReloadOperationFailure } from './native-reload-operation-boundary.mjs';
import { captureFailure } from './profile-reload-capture.mjs';

const source = await readFile(
  new URL('./data-member-native-acceptance.mjs', import.meta.url),
  'utf8',
);
const start = source.indexOf("        report.stage = 'extension_reload';");
const end = source.indexOf("        await click(panel, 'title', 'Data');", start);
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const adopt = new AsyncFunction(
  'assert',
  'native',
  'panel',
  'report',
  'captureFailure',
  'safeReloadOperationFailure',
  `${source.slice(start, end)} return panel;`,
);

test('member Data adopts verified replacement without touching retired session or reacquiring', async () => {
  const replacement = {
    targetId: 'replacement-panel',
    async send(method) {
      assert.equal(method, 'Page.bringToFront');
    },
  };
  const previous = {
    targetId: 'retired-panel',
    async detach() {
      throw new Error('retired_session_must_not_be_used');
    },
  };
  const native = {
    async reloadExtension() {
      return {
        panel: replacement,
        management_reload_clicked: true,
        old_targets_retired: true,
        worker_replaced: true,
        panel_replaced: true,
        retirement_evidence: { timeline: { final_predicate: true } },
      };
    },
    async acquireLivePanel() {
      throw new Error('already_verified_replacement_must_not_be_reacquired');
    },
  };
  const report = { observations: {} };
  assert.equal(
    await adopt(assert, native, previous, report, captureFailure, safeReloadOperationFailure),
    replacement,
  );
  assert.equal(report.observations.reload_replacement_adopted, true);
});

test('member Data preserves bounded helper operation failure without exception text', async () => {
  const error = Object.assign(new Error('private browser URL and payload'), {
    reloadOperationFailure: {
      operation: 'fixture_focus',
      exceptionClass: 'ProtocolError',
      cleanupFailures: [],
    },
  });
  const report = { observations: {} };
  await assert.rejects(
    adopt(
      assert,
      {
        reloadExtension: async () => {
          throw error;
        },
        transportFailureClass: () => 'protocol_error',
      },
      {},
      report,
      captureFailure,
      safeReloadOperationFailure,
    ),
  );
  assert.equal(report.reload_failure.helper.operation, 'fixture_focus');
  assert.equal(report.reload_failure.failure.transport_failure_class, 'protocol_error');
  assert.equal(JSON.stringify(report).includes('private browser'), false);
});

test('member Data refuses an unverified or unchanged replacement before activation', async () => {
  for (const verified of [false, true]) {
    let activated = false;
    const report = { observations: {} };
    const panel = {
      targetId: 'retired-panel',
      async send() {
        activated = true;
      },
    };
    const native = {
      async reloadExtension() {
        return {
          management_reload_clicked: true,
          old_targets_retired: true,
          worker_replaced: true,
          panel_replaced: true,
          panel,
          retirement_evidence: { timeline: { final_predicate: verified } },
        };
      },
    };
    await assert.rejects(
      adopt(assert, native, panel, report, captureFailure, safeReloadOperationFailure),
    );
    assert.equal(activated, false);
    assert.equal(report.observations.reload_replacement_adopted, undefined);
  }
});

// SUT: the member driver's actual reload invocation/catch and report finalizer.
// Chrome protocol/worker APIs and disk are external doubles. The real reload
// helper, installed probe, capture, refusal, and JSON serialization all execute.
test('member Data persists distinct probe evidence after successful and failed reload invocation', async () => {
  const { refuseDiagnosticAcceptance } = await import('./scrape-reload-open-diagnostic.mjs');
  const finalizerStart = source.lastIndexOf('} finally {') + '} finally {'.length;
  const finalize = new AsyncFunction(
    'report',
    'refuseDiagnosticAcceptance',
    'writeFile',
    `const RELOAD_OPEN_DIAGNOSTIC = true, process = {}, output = 'owned.json';
     const mkdir = async () => {};
     ${source.slice(finalizerStart, source.lastIndexOf('}'))}
     return process.exitCode;`,
  );
  for (const failed of [false, true]) {
    const listeners = new Set();
    const worker = createContext({
      chrome: {
        runtime: {
          onMessageExternal: {
            addListener: (listener) => listeners.add(listener),
            removeListener: (listener) => listeners.delete(listener),
          },
          getContexts: async () => [
            {
              contextType: 'SIDE_PANEL',
              documentUrl: 'chrome-extension://cihdmkcdjjckfhjpgoedmgfpoljebaml/sidepanel.html',
              tabId: -1,
            },
          ],
        },
        sidePanel: { open: () => Promise.resolve() },
      },
    });
    // The worker's ordinary listener precedes the installed diagnostic listener.
    // No test writes a diagnostic boolean: real probe code observes delivery/open.
    const ordinaryListener = (message) => {
      if (message.action === 'openPanel') worker.chrome.sidePanel.open({ windowId: 7 });
    };
    listeners.add(ordinaryListener);
    const originalOpen = worker.chrome.sidePanel.open;
    const report = { status: failed ? 'fail' : 'pass', observations: {} };
    const native = {
      reloadExtension: () =>
        reloadCase({
          initiallyEnabled: true,
          panelAppears: !failed,
          expectFailure: failed,
          openReply: failed ? null : { ok: true, result: { opened: true } },
          workerRuntime: {
            evaluate: (expression) => runInContext(expression, worker),
            click: async () => {
              if (!failed)
                for (const listener of [...listeners])
                  listener({
                    channel: 'FRONTEND_RPC',
                    action: 'openPanel',
                    requestId: 'native-sidepanel-qa',
                  });
              await Promise.resolve();
            },
          },
        }),
      transportFailureClass: () => 'none',
    };
    const invocation = adopt(
      assert,
      native,
      { targetId: 'retired-panel' },
      report,
      captureFailure,
      safeReloadOperationFailure,
    );
    if (failed) await assert.rejects(invocation, /native_extension_replacement_panel_unverified/);
    else assert.equal((await invocation).targetId, 'new-panel');
    assert.equal(listeners.size, 1, 'probe listener restored');
    assert.equal(worker.chrome.sidePanel.open, originalOpen, 'open wrapper restored');
    let persisted;
    const exitCode = await finalize(report, refuseDiagnosticAcceptance, async (_path, bytes) => {
      persisted = JSON.parse(bytes);
    });
    assert.equal(persisted.status, 'unverified');
    assert.equal(exitCode, 1);
    if (failed) {
      assert.equal(
        persisted.reload_failure.failure.failure_code,
        'native_extension_replacement_panel_unverified',
      );
      assert.deepEqual(
        persisted.reload_failure?.failure?.retirement_evidence?.open_panel_diagnostic,
        {
          availability: 'ready',
          perturbation: 'cdp_worker_attach_and_synchronous_open_wrapper',
          ingress: false,
          open_invoked: false,
          open_settlement: 'unobserved',
          send_response: 'unobservable_without_instrumented_build',
        },
        'failed reload probe must survive member report persistence',
      );
    } else {
      assert.deepEqual(
        persisted.reload_open_probe,
        {
          availability: 'ready',
          perturbation: 'cdp_worker_attach_and_synchronous_open_wrapper',
          ingress: true,
          open_invoked: true,
          open_settlement: 'resolved',
          send_response: 'unobservable_without_instrumented_build',
        },
        'successful reload probe must survive member report persistence',
      );
    }
  }
});
