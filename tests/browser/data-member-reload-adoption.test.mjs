import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
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
