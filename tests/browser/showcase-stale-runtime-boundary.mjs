import assert from 'node:assert/strict';

const EXIT = 'data:list-picker-exit';
const DETECTED = 'data:list-picker-item-detected';

// CDP evaluates only in the owned fixture page's extension isolated world. This
// intercepts the producer's real Chrome API call before runtime delivery.
export async function armShowcaseStaleBoundary(page, extensionId) {
  const cdp = await page.context().newCDPSession(page);
  const contexts = [];
  cdp.on('Runtime.executionContextCreated', ({ context }) => contexts.push(context));
  await cdp.send('Runtime.enable');
  let contextId;
  for (let attempt = 0; !contextId && attempt < 40; attempt += 1) {
    for (const context of contexts) {
      if (context.auxData?.isDefault || !context.auxData?.frameId) continue;
      const probe = await cdp
        .send('Runtime.evaluate', {
          contextId: context.id,
          expression:
            '({ id: chrome?.runtime?.id, picker: typeof window.__matrxListPickerStart, url: location.href })',
          returnByValue: true,
        })
        .catch(() => null);
      if (
        probe?.result?.value?.id === extensionId &&
        probe.result.value.picker === 'function' &&
        probe.result.value.url === page.url()
      ) {
        assert.equal(contextId, undefined, 'showcase_picker_context_not_unique');
        contextId = context.id;
      }
    }
    if (!contextId) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(contextId, 'showcase_picker_isolated_context_missing');
  const run = async (expression) => {
    const value = await cdp.send('Runtime.evaluate', {
      contextId,
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    assert.ok(!value.exceptionDetails, 'showcase_picker_boundary_evaluation_failed');
    return value.result?.value;
  };
  const armed = await run(`(() => {
    const runtime = chrome.runtime;
    if (globalThis.__showcaseD42Boundary) return false;
    const original = runtime.sendMessage.bind(runtime);
    const state = { held: [], observed: [], original, capturedExit: false };
    const intercepted = function(message, ...args) {
      if (message?.__matrx === true &&
          ['data:list-picker-exit', 'data:list-picker-item-detected'].includes(message.kind)) {
        state.observed.push({ kind: message.kind, session_id: message.payload?.session_id });
        if (message.kind === 'data:list-picker-exit' && !state.capturedExit) {
          state.capturedExit = true;
          return new Promise((resolve, reject) => {
            state.held.push({ message, args, resolve, reject });
          });
        }
      }
      return original(message, ...args);
    };
    runtime.sendMessage = intercepted;
    if (runtime.sendMessage !== intercepted) return false;
    globalThis.__showcaseD42Boundary = state;
    return true;
  })()`);
  assert.equal(armed, true, 'showcase_picker_runtime_boundary_not_writable');
  return {
    async snapshot() {
      return run(`(() => {
        const s = globalThis.__showcaseD42Boundary;
        return { held: s.held.map(x => ({ kind: x.message.kind, session_id: x.message.payload?.session_id })),
          observed: s.observed, url: location.href };
      })()`);
    },
    async release(sessionId) {
      assert.match(sessionId, /^[0-9a-f-]{36}$/i, 'showcase_captured_session_id_invalid');
      return run(`(async () => {
        const s = globalThis.__showcaseD42Boundary;
        const held = s.held[0];
        if (!held || held.message.kind !== ${JSON.stringify(EXIT)} ||
            held.message.payload?.session_id !== ${JSON.stringify(sessionId)}) return { released: false };
        s.held.shift();
        try {
          const reply = await s.original(held.message, ...held.args);
          held.resolve(reply);
          return { released: true, ack: reply?.ack === true };
        } catch (error) {
          held.reject(error);
          return { released: false };
        }
      })()`);
    },
    async close() {
      await cdp.detach();
    },
  };
}

export async function observeShowcaseRelay(panel) {
  const expression = `(() => {
    const events = [];
    globalThis.__showcaseD42Relays = events;
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.__matrx === true &&
          ['${EXIT}', '${DETECTED}', 'data:list-picker-result'].includes(message.kind)) {
        events.push({ kind: message.kind, session_id: message.payload?.session_id,
          tab_id: message.payload?.tab_id ?? null,
          document_id: message.payload?.document_id ?? null });
      }
    });
    return true;
  })()`;
  const response = await panel.send('Runtime.evaluate', { expression, returnByValue: true });
  assert.equal(response.result?.value, true, 'showcase_relay_observer_missing');
}

export async function readShowcaseRelays(panel) {
  const response = await panel.send('Runtime.evaluate', {
    expression: 'globalThis.__showcaseD42Relays ?? null',
    returnByValue: true,
  });
  assert.ok(!response.exceptionDetails, 'showcase_relay_observer_lost');
  return response.result?.value;
}
