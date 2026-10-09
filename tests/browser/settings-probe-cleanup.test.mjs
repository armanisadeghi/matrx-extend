import assert from 'node:assert/strict';
import test from 'node:test';
import {
  preserveFailureDuringCleanup,
  serializeGuestReloadFailure,
} from './settings-probe-cleanup.mjs';

test('cleanup transport failure does not replace the primary reload failure', async () => {
  const primary = Object.assign(new Error('full_extension_preference_or_restore_failed'), {
    safeCategory: 'full_extension_preference_or_restore_failed',
    safeFirstChoiceFailureStage: 'choice_extension_reload',
  });
  let caught;
  await assert.rejects(
    preserveFailureDuringCleanup(
      async () => {
        throw primary;
      },
      async () => {
        throw new Error('owned_cdp_transport_failed');
      },
    ),
    (error) => {
      caught = error;
      return true;
    },
  );
  assert.equal(caught, primary);
  assert.equal(caught.safeFirstChoiceFailureStage, 'choice_extension_reload');
  assert.equal(caught.safeCleanupFailed, true);
  assert.equal(caught.message, 'full_extension_preference_or_restore_failed');
});

test('cleanup failure remains a failure when the probe itself succeeded', async () => {
  await assert.rejects(
    preserveFailureDuringCleanup(
      async () => 'probe-result',
      async () => {
        throw new Error('owned_cdp_transport_failed');
      },
    ),
    /^Error: settings_probe_cleanup_failed$/,
  );
});

test('reload failure receipt serializes only allowlisted stage and transport diagnostics', () => {
  const error = Object.assign(new Error('owned_cdp_transport_failed'), {
    safeCategory: 'full_extension_preference_or_restore_failed',
    safeFirstChoiceFailureStage: 'choice_extension_reload',
    safeRestorationFailureStage: 'restore_extension_reload',
    safeFirstChoiceTransportClass: 'unexpected_close',
    safeRestorationTransportClass: 'unexpected_close',
    safeFirstChoiceFailureCode: 'pointer_target_not_unique',
    safeRestorationFailureCode: 'native_extension_replacement_panel_unverified',
    safeCleanupFailed: true,
  });
  const receipt = serializeGuestReloadFailure(error);
  assert.deepEqual(receipt, {
    category: 'full_extension_preference_or_restore_failed',
    firstChoiceFailureStage: 'choice_extension_reload',
    restorationFailureStage: 'restore_extension_reload',
    firstChoiceTransportClass: 'unexpected_close',
    restorationTransportClass: 'unexpected_close',
    firstChoiceFailureCode: 'pointer_target_not_unique',
    restorationFailureCode: 'native_extension_replacement_panel_unverified',
    cleanupAlsoFailed: true,
  });
  assert.equal(JSON.stringify(receipt).includes('owned_cdp_transport_failed'), false);
  assert.equal(JSON.stringify(receipt).includes('stack'), false);
});

test('reload failure receipt replaces unrecognized diagnostics with safe defaults', () => {
  const receipt = serializeGuestReloadFailure({
    safeCategory: 'full_extension_preference_or_restore_failed',
    safeFirstChoiceFailureStage: 'private-value',
    safeRestorationFailureStage: 'restore_extension_reload',
    safeFirstChoiceTransportClass: 'private-value',
    safeRestorationTransportClass: 'socket_error',
    safeFirstChoiceFailureCode: 'private-value',
    safeRestorationFailureCode: 'owned_cdp_transport_failed',
  });
  assert.deepEqual(receipt, {
    category: 'full_extension_preference_or_restore_failed',
    firstChoiceFailureStage: 'unavailable',
    restorationFailureStage: 'restore_extension_reload',
    firstChoiceTransportClass: 'unavailable',
    restorationTransportClass: 'socket_error',
    firstChoiceFailureCode: 'unavailable',
    restorationFailureCode: 'owned_cdp_transport_failed',
    cleanupAlsoFailed: false,
  });
});
