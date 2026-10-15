import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { captureContextBoundary, captureLifecycleEvidence } from './profile-reload-capture.mjs';

const source = readFileSync(
  new URL('./data-member-native-acceptance.mjs', import.meta.url),
  'utf8',
);
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const reloadStart = source.indexOf('        report.reload_lifecycle = captureLifecycleEvidence');
const reloadEnd = source.indexOf(
  '        report.observations.reload_replacement_adopted = true;',
  reloadStart,
);
const callbackStart = source.indexOf('        if (!AUTO_SCOPE) {', reloadEnd);
const callbackEnd = source.indexOf("        await runAndCopy('after_reload');", callbackStart);
const retainReload = new AsyncFunction(
  'assert',
  'report',
  'reload',
  'AUTO_SCOPE',
  'captureLifecycleEvidence',
  'captureContextBoundary',
  source.slice(reloadStart, reloadEnd) + source.slice(callbackStart, callbackEnd),
);

test('member driver retains the actual callback receipt and refuses absent or refused ingress', async () => {
  for (const [category, ok, opened] of [
    ['opened', true, true],
    ['open_refused', true, false],
    ['reply_not_observed', null, null],
  ]) {
    const report = { observations: {} };
    const reload = {
      retirement_evidence: {
        open_panel_request: {
          received: category !== 'reply_not_observed',
          ok,
          opened,
          category,
          private_reply: 'never retain this',
        },
        old_worker_absent: true,
      },
      context_boundary: { exact_expected_appeared: true },
    };
    const run = retainReload(
      assert,
      report,
      reload,
      false,
      captureLifecycleEvidence,
      captureContextBoundary,
    );
    if (category === 'opened') {
      await run;
      assert.equal(report.observations.saved_pattern_survived_extension_reload, true);
    } else
      await assert.rejects(run, /data_member_reload_(?:callback_missing|open_callback_unverified)/);
    assert.equal(report.reload_lifecycle.open_panel_request.category, category);
    assert.equal(report.reload_context.exact_expected_appeared, true);
    assert.doesNotMatch(JSON.stringify(report), /private_reply|never retain/);
  }
});

const cleanupStart = source.indexOf('            const afterDelete = await queryOwnedPattern');
const cleanupEnd = source.indexOf('\n          } catch (error)', cleanupStart);
const retainCleanup = new AsyncFunction(
  'assert',
  'queryOwnedPattern',
  'patternName',
  'identity',
  'report',
  source.slice(cleanupStart, cleanupEnd),
);

test('member driver rereads its exact owned name and organization before claiming no active rows', async () => {
  for (const [status, rows] of [
    [200, []],
    [200, [{ id: 'owned-row' }]],
    [503, []],
  ]) {
    const calls = [];
    const report = { cleanup: {} };
    const run = retainCleanup(
      assert,
      async (...args) => {
        calls.push(args);
        return { status, rows };
      },
      'Northline Furnishings catalog member 38116138170-1',
      { organizationId: 'member-org' },
      report,
    );
    if (status === 200 && rows.length === 0) {
      await run;
      assert.equal(report.cleanup.active_rows_after_delete, 0);
    } else {
      await assert.rejects(run, /data_member_cleanup_(?:active_rows_remain|readback_failed)/);
      assert.equal(report.cleanup.active_rows_after_delete, undefined);
    }
    assert.deepEqual(calls, [['Northline Furnishings catalog member 38116138170-1', 'member-org']]);
  }
});
