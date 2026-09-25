'use strict';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIMEOUT_MS = 15_000;
const assert = (condition, code) => {
  if (!condition) throw new Error(code);
};

function createVaultSaveResponseLoss({
  context,
  apiOrigin,
  exactExtensionWorkerUrl,
  existingFixtureKeys,
  onRejectedBeforeForwardKey = () => {},
}) {
  assert(context?.route && context?.unroute, 'response_loss_context_required');
  const endpoint = new URL('/api/vault/items', new URL(apiOrigin).origin).toString();
  assert(
    typeof exactExtensionWorkerUrl === 'string' && exactExtensionWorkerUrl.length > 0,
    'response_loss_worker_url_required',
  );
  assert(
    existingFixtureKeys instanceof Set && existingFixtureKeys.size === 4,
    'response_loss_fixture_keys_required',
  );
  const fixtureKeys = new Set(existingFixtureKeys);
  assert(
    [...fixtureKeys].every((key) => typeof key === 'string' && UUID.test(key)),
    'response_loss_fixture_key_invalid',
  );
  assert(
    typeof onRejectedBeforeForwardKey === 'function',
    'response_loss_rejected_key_callback_required',
  );

  let installed = false,
    disposed = false,
    closing = false,
    failure = null;
  let firstClaimed = false,
    firstForwardAttempted = false,
    firstForwarded = false,
    forwardOutcomeAmbiguous = false;
  let firstLost = false,
    retryAllowed = false,
    secondForwarded = false,
    firstStatus = null,
    firstKey;
  let callbacks = 0,
    totalPosts = 0,
    rejectedPosts = 0,
    unrouteSucceeded = false;
  let firstLossWaiters = [];
  const handlers = new Set();
  const fail = (code) => {
    if (failure) return;
    failure = code;
    for (const waiter of firstLossWaiters) waiter.reject(new Error(code));
    firstLossWaiters = [];
  };
  const resolveFirstLoss = () => {
    for (const waiter of firstLossWaiters) waiter.resolve();
    firstLossWaiters = [];
  };
  const abort = async (route, failureCode) => {
    try {
      await route.abort();
      return true;
    } catch {
      fail(failureCode);
      return false;
    }
  };
  const rejectBeforeForward = async (route, key, code) => {
    rejectedPosts += 1;
    fail(code);
    const aborted = await abort(route, 'response_loss_abort_failed');
    if (
      aborted &&
      typeof key === 'string' &&
      UUID.test(key) &&
      key !== firstKey &&
      !fixtureKeys.has(key)
    ) {
      try {
        await onRejectedBeforeForwardKey(key);
        callbacks += 1;
      } catch {
        fail('response_loss_rejected_key_callback_failed');
      }
    }
  };
  const abortAfterForward = async (route, code) => {
    forwardOutcomeAmbiguous = true;
    fail(code);
    await abort(route, 'response_loss_abort_failed');
  };
  const handle = async (route, request) => {
    const workerUrl = request.serviceWorker?.()?.url?.() ?? null;
    const method = request.method?.();
    const headers = request.headers?.() ?? {};
    const key = headers['idempotency-key'] ?? headers['Idempotency-Key'];
    if (method !== 'POST' || workerUrl !== exactExtensionWorkerUrl) {
      try {
        await route.continue();
      } catch {
        fail('response_loss_unrelated_continue_failed');
      }
      return;
    }
    totalPosts += 1;
    if (closing) {
      await abort(route, 'response_loss_closing_abort_failed');
      return;
    }
    if (failure) return rejectBeforeForward(route, key, 'response_loss_post_after_failure');
    if (!firstClaimed) {
      // Claim before the first await so a concurrent matching POST cannot fetch.
      firstClaimed = true;
      firstKey = key;
      if (typeof key !== 'string' || !UUID.test(key) || fixtureKeys.has(key))
        return rejectBeforeForward(route, key, 'response_loss_initial_key_invalid');
      firstForwardAttempted = true;
      let response;
      try {
        response = await route.fetch({ maxRetries: 0, maxRedirects: 0, timeout: TIMEOUT_MS });
      } catch {
        return abortAfterForward(route, 'response_loss_first_forward_ambiguous');
      }
      firstForwarded = true;
      firstStatus = response.status?.();
      if (!Number.isInteger(firstStatus) || firstStatus < 200 || firstStatus >= 300) {
        try {
          await response.dispose?.();
        } catch {
          return abortAfterForward(route, 'response_loss_response_dispose_ambiguous');
        }
        return abortAfterForward(route, 'response_loss_first_status_not_2xx');
      }
      try {
        await response.dispose?.();
      } catch {
        return abortAfterForward(route, 'response_loss_response_dispose_ambiguous');
      }
      if (closing) return abortAfterForward(route, 'response_loss_closed_after_forward');
      if (!(await abort(route, 'response_loss_abort_failed'))) return;
      firstLost = true;
      resolveFirstLoss();
      return;
    }
    if (!retryAllowed || secondForwarded || key !== firstKey)
      return rejectBeforeForward(
        route,
        key,
        key !== firstKey ? 'response_loss_retry_key_changed' : 'response_loss_retry_not_explicit',
      );
    secondForwarded = true;
    try {
      await route.continue();
    } catch {
      fail('response_loss_retry_continue_failed');
    }
  };
  const handler = (route, request) => {
    const pending = handle(route, request)
      .catch(() => fail('response_loss_handler_failed'))
      .finally(() => handlers.delete(pending));
    handlers.add(pending);
    return pending;
  };
  const drain = async () => {
    const deadline = Date.now() + TIMEOUT_MS;
    while (handlers.size && Date.now() < deadline)
      await Promise.race([
        Promise.allSettled([...handlers]),
        new Promise((resolve) => setTimeout(resolve, 25)),
      ]);
    if (handlers.size) fail('response_loss_handler_drain_timeout');
  };

  return {
    async install() {
      assert(!installed && !disposed, 'response_loss_install_invalid_state');
      await context.route(endpoint, handler);
      installed = true;
    },
    async waitForFirstLoss(timeoutMs = TIMEOUT_MS) {
      assert(installed && !disposed, 'response_loss_wait_invalid_state');
      if (firstLost) return;
      assert(!failure, failure || 'response_loss_first_loss_missing');
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('response_loss_first_loss_timeout')),
          timeoutMs,
        );
        firstLossWaiters.push({
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
      });
      assert(!failure && firstLost, failure || 'response_loss_first_loss_missing');
    },
    allowExplicitRetry() {
      assert(
        firstLost && !failure && !retryAllowed && !secondForwarded,
        'response_loss_retry_gate_invalid',
      );
      retryAllowed = true;
    },
    assertCompleted() {
      assert(!failure, failure || 'response_loss_failed');
      assert(
        firstClaimed &&
          firstForwardAttempted &&
          firstForwarded &&
          firstLost &&
          retryAllowed &&
          secondForwarded,
        'response_loss_incomplete',
      );
      assert(totalPosts === 2 && rejectedPosts === 0, 'response_loss_post_count_invalid');
    },
    snapshot() {
      return Object.freeze({
        installed,
        disposed,
        closing,
        firstAttemptIntercepted: firstClaimed,
        firstForwardAttempted,
        firstForwarded,
        forwardOutcomeAmbiguous,
        firstStatus,
        responseDeliberatelyLost: firstLost,
        explicitRetryAllowed: retryAllowed,
        secondForwarded,
        totalMatchingWorkerPosts: totalPosts,
        rejectedBeforeForwardPosts: rejectedPosts,
        rejectedBeforeForwardCallbacks: callbacks,
        handlerCount: handlers.size,
        unrouteSucceeded,
        failure: failure ?? 'none',
      });
    },
    async dispose() {
      if (disposed) return;
      closing = true;
      if (firstLossWaiters.length) fail('response_loss_disposed');
      if (installed) {
        try {
          await context.unroute(endpoint, handler);
          unrouteSucceeded = true;
        } catch {
          fail('response_loss_unroute_failed');
        }
      }
      await drain();
      disposed = true;
      if (!unrouteSucceeded || failure || handlers.size)
        throw new Error(failure || 'response_loss_handler_drain_failed');
    },
  };
}

exports.createVaultSaveResponseLoss = createVaultSaveResponseLoss;
