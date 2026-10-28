import assert from 'node:assert/strict';
import test from 'node:test';
import {
  originalSettingsCleanupFailure,
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
    safeFirstChoiceReloadBoundary: {
      lastCapturedPhase: 'click_started',
      timelineTruncated: true,
      clickStarted: true,
      clickResolved: false,
      preClickOldWorkerPresent: true,
      oldWorkerAbsent: false,
      oldPanelAbsent: false,
      replacementWorkerPresent: false,
      finalPredicate: false,
      contextExpectedAppeared: null,
      secret: 'private content',
    },
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
    firstChoiceReloadBoundary: {
      helperFailure: null,
      lastCapturedPhase: 'click_started',
      timelineTruncated: true,
      clickStarted: true,
      clickResolved: false,
      preClickOldWorkerPresent: true,
      oldWorkerAbsent: false,
      oldPanelAbsent: false,
      replacementWorkerPresent: false,
      finalPredicate: false,
      contextExpectedAppeared: null,
    },
    restorationReloadBoundary: null,
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
    safeFirstChoiceReloadBoundary: {
      lastCapturedPhase: 'private-value',
      timelineTruncated: 'private-value',
      clickStarted: 'private-value',
    },
  });
  assert.deepEqual(receipt, {
    category: 'full_extension_preference_or_restore_failed',
    firstChoiceFailureStage: 'unavailable',
    restorationFailureStage: 'restore_extension_reload',
    firstChoiceTransportClass: 'unavailable',
    restorationTransportClass: 'socket_error',
    firstChoiceFailureCode: 'unavailable',
    restorationFailureCode: 'owned_cdp_transport_failed',
    firstChoiceReloadBoundary: {
      helperFailure: null,
      lastCapturedPhase: 'unavailable',
      timelineTruncated: null,
      clickStarted: null,
      clickResolved: null,
      preClickOldWorkerPresent: null,
      oldWorkerAbsent: null,
      oldPanelAbsent: null,
      replacementWorkerPresent: null,
      finalPredicate: null,
      contextExpectedAppeared: null,
    },
    restorationReloadBoundary: null,
    cleanupAlsoFailed: false,
  });
});

for (const primary of [undefined, null, false, 0, '']) {
  test(`falsey primary rejection remains rejected after successful cleanup (${String(primary)})`, async () => {
    let outcome;
    try {
      outcome = {
        returned: await preserveFailureDuringCleanup(
          async () => {
            throw primary;
          },
          async () => {},
        ),
      };
    } catch (error) {
      outcome = { error };
    }
    assert.equal(
      Object.hasOwn(outcome, 'error'),
      true,
      'cleanup must not swallow a falsey rejection',
    );
    assert.equal(outcome.error, primary);
  });
  test(`dual failure retains falsey original cause and cleanup flag (${String(primary)})`, async () => {
    await assert.rejects(
      preserveFailureDuringCleanup(
        async () => {
          throw primary;
        },
        async () => {
          throw new Error('cleanup');
        },
      ),
      (error) =>
        error instanceof Error &&
        Object.is(error.cause, primary) &&
        error.safeCleanupFailed === true &&
        error.message === 'settings_probe_cleanup_failed',
    );
  });
}

test('frozen primary reload diagnostics survive simultaneous cleanup failure without raw serialization', async () => {
  const primary = Object.freeze(
    Object.assign(new Error('private-primary-value'), {
      safeCategory: 'full_extension_preference_or_restore_failed',
      safeFirstChoiceFailureStage: 'choice_extension_reload',
      privatePayload: 'private-auth-material',
    }),
  );
  let caught;
  try {
    await preserveFailureDuringCleanup(
      async () => {
        throw primary;
      },
      async () => {
        throw new Error('private-cleanup-value');
      },
    );
  } catch (error) {
    caught = error;
  }
  assert.equal(caught?.cause, primary, 'immutable original is retained as the exact cause');
  assert.equal(caught?.safeCleanupFailed, true);
  const receipt = serializeGuestReloadFailure(caught);
  assert.equal(receipt?.firstChoiceFailureStage, 'choice_extension_reload');
  assert.equal(receipt?.cleanupAlsoFailed, true);
  assert.equal(JSON.stringify(receipt).includes('private-'), false);
});

test('canonical cleanup forwards results only after executing operation then cleanup, rejecting bypasses', async () => {
  const verify = async (candidate) => {
    for (const value of ['settings-snapshot-ready', 'reload-check-ready']) {
      const events = [];
      const result = await candidate(
        async () => {
          events.push('operation');
          return value;
        },
        async () => {
          events.push('cleanup');
        },
      );
      assert.deepEqual(events, ['operation', 'cleanup']);
      assert.equal(result, value);
    }
  };
  await verify(preserveFailureDuringCleanup);
  await assert.rejects(
    verify(async () => 'settings-snapshot-ready'),
    assert.AssertionError,
  );
  await assert.rejects(
    verify(async (operation) => operation()),
    assert.AssertionError,
  );
  await assert.rejects(
    verify(async (_operation, cleanup) => cleanup()),
    assert.AssertionError,
  );
});

test('canonical cleanup resolver uses wrapper identity and preserves exact immutable or primitive originals', async () => {
  const mutable = Object.assign(new Error('CANARY_primary', { cause: new Error('CANARY_decoy') }), {
    safeCategory: 'full_extension_preference_or_restore_failed',
    safeFirstChoiceFailureStage: 'choice_extension_reload',
  });
  const frozen = Object.freeze(
    Object.assign(new Error('CANARY_frozen', { cause: mutable }), {
      safeCategory: 'full_extension_preference_or_restore_failed',
      safeFirstChoiceFailureStage: 'restore_extension_reload',
    }),
  );
  const verify = async (resolve) => {
    for (const primary of [mutable, frozen, undefined, null, false, 0, '', 'CANARY_primitive']) {
      let caught;
      try {
        await preserveFailureDuringCleanup(
          async () => {
            throw primary;
          },
          async () => {
            throw new Error('CANARY_cleanup');
          },
        );
      } catch (error) {
        caught = error;
      }
      assert.equal(
        resolve(caught),
        primary,
        'only authentic wrapper resolves to its exact original',
      );
      assert.equal(caught.safeCleanupFailed, true);
      if (primary === mutable || primary === frozen) {
        const receipt = serializeGuestReloadFailure(caught);
        assert.equal(receipt.firstChoiceFailureStage, primary.safeFirstChoiceFailureStage);
        assert.equal(receipt.cleanupAlsoFailed, true);
        assert.doesNotMatch(JSON.stringify(receipt), /CANARY/);
      }
    }
    const forged = { safeCleanupFailed: true, cause: mutable };
    assert.equal(resolve(forged), forged);
    const throwing = Object.defineProperty({ safeCleanupFailed: true }, 'cause', {
      get() {
        throw new Error('CANARY_getter');
      },
    });
    assert.equal(resolve(throwing), throwing);
  };
  await verify(originalSettingsCleanupFailure);
  await assert.rejects(
    verify(() => mutable),
    /only authentic wrapper/,
  );
  await assert.rejects(
    verify((failure) => (failure?.safeCleanupFailed ? failure.cause : failure)),
    /only authentic wrapper/,
  );
});
