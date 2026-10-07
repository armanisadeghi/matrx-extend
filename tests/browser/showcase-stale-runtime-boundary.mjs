import assert from 'node:assert/strict';

const EXIT = 'data:list-picker-exit';
const DETECTED = 'data:list-picker-item-detected';
const RESULT = 'data:list-picker-result';
export const STALE_PICKER_KINDS = { exit: EXIT, detected: DETECTED, result: RESULT };

export function assertFreshShowcasePickerContext(observation) {
  assert.deepEqual(
    observation,
    {
      both_present: true,
      start_distinct: true,
      teardown_distinct: true,
    },
    'showcase_reinject_reused_picker_module',
  );
}

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
    const state = { held: [], observed: [], original, holdKind: null, captured: false };
    const intercepted = function(message, ...args) {
      if (message?.__matrx === true &&
          ['data:list-picker-exit', 'data:list-picker-item-detected', 'data:list-picker-result'].includes(message.kind)) {
        state.observed.push({ kind: message.kind, session_id: message.payload?.session_id });
        if (message.kind === state.holdKind && !state.captured) {
          state.captured = true;
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
    async capturePickerContext() {
      assert.equal(
        await run(`(() => {
        const s = globalThis.__showcaseD42Boundary;
        const start = window.__matrxListPickerStart;
        const teardown = window.__matrxListPickerTeardown;
        if (s.pickerContext || typeof start !== 'function' || typeof teardown !== 'function')
          return false;
        s.pickerContext = { start, teardown };
        return true;
      })()`),
        true,
        'showcase_initial_picker_context_missing',
      );
    },
    async comparePickerContext() {
      return run(`(() => {
        const prior = globalThis.__showcaseD42Boundary.pickerContext;
        const start = window.__matrxListPickerStart;
        const teardown = window.__matrxListPickerTeardown;
        return {
          both_present: !!prior && typeof start === 'function' && typeof teardown === 'function',
          start_distinct: !!prior && typeof start === 'function' && start !== prior.start,
          teardown_distinct: !!prior && typeof teardown === 'function' && teardown !== prior.teardown,
        };
      })()`);
    },
    async armListenerCount() {
      assert.equal(
        await run(`(() => {
        const s = globalThis.__showcaseD42Boundary;
        if (s.listeners) return false;
        const originalAdd = document.addEventListener.bind(document);
        const originalRemove = document.removeEventListener.bind(document);
        const click = new Set();
        const hover = new Set();
        const tracked = (type, options) => options === true &&
          (type === 'click' ? click : type === 'mouseover' ? hover : null);
        const add = (type, listener, options) => {
          tracked(type, options)?.add(listener);
          return originalAdd(type, listener, options);
        };
        const remove = (type, listener, options) => {
          tracked(type, options)?.delete(listener);
          return originalRemove(type, listener, options);
        };
        document.addEventListener = add;
        document.removeEventListener = remove;
        if (document.addEventListener !== add || document.removeEventListener !== remove)
          return false;
        s.listeners = { click, hover, originalAdd, originalRemove };
        return true;
      })()`),
        true,
        'showcase_listener_tracker_not_armed',
      );
    },
    async listenerSnapshot() {
      return run(`(() => {
        const s = globalThis.__showcaseD42Boundary.listeners;
        return { click_count: s?.click.size ?? null, hover_count: s?.hover.size ?? null };
      })()`);
    },
    async closeListenerCount() {
      assert.equal(
        await run(`(() => {
        const s = globalThis.__showcaseD42Boundary.listeners;
        if (!s || s.click.size || s.hover.size) return false;
        document.addEventListener = s.originalAdd;
        document.removeEventListener = s.originalRemove;
        delete globalThis.__showcaseD42Boundary.listeners;
        return true;
      })()`),
        true,
        'showcase_listener_tracker_not_clear',
      );
    },
    async holdCancel() {
      const armedCancel = await run(`(() => {
        const s = globalThis.__showcaseD42Boundary;
        if (s.cancelHold) return false;
        const originalCancel = window.__matrxListPickerCancel;
        if (typeof originalCancel !== 'function') return false;
        s.cancelHold = { originalCancel, calls: [] };
        window.__matrxListPickerCancel = (id) => s.cancelHold.calls.push(id);
        return true;
      })()`);
      assert.equal(armedCancel, true, 'showcase_cancel_boundary_not_armed');
    },
    async cancelSnapshot() {
      return run(`(() => {
        const held = globalThis.__showcaseD42Boundary.cancelHold;
        return { count: held?.calls.length ?? 0, session_id: held?.calls[0] ?? null };
      })()`);
    },
    async releaseCancel(sessionId) {
      assert.match(sessionId, /^[0-9a-f-]{36}$/i, 'showcase_cancel_session_id_invalid');
      return run(`(() => {
        const held = globalThis.__showcaseD42Boundary.cancelHold;
        if (!held || held.calls.length !== 1 || held.calls[0] !== ${JSON.stringify(sessionId)})
          return { released: false };
        held.calls.shift();
        held.originalCancel(${JSON.stringify(sessionId)});
        return { released: true };
      })()`);
    },
    async holdNext(kind) {
      assert.ok(Object.values(STALE_PICKER_KINDS).includes(kind), 'showcase_invalid_hold_kind');
      const result = await run(`(() => {
        const s = globalThis.__showcaseD42Boundary;
        if (s.held.length) return false;
        s.holdKind = ${JSON.stringify(kind)};
        s.captured = false;
        return true;
      })()`);
      assert.equal(result, true, 'showcase_previous_message_still_held');
    },
    async snapshot() {
      return run(`(() => {
        const s = globalThis.__showcaseD42Boundary;
        return { held: s.held.map(x => ({ kind: x.message.kind, session_id: x.message.payload?.session_id,
          list_root: x.message.payload?.list_root ?? null,
          item_selector: x.message.payload?.item_selector ?? null })),
          observed: s.observed, url: location.href };
      })()`);
    },
    async release(kind, sessionId) {
      assert.ok(Object.values(STALE_PICKER_KINDS).includes(kind), 'showcase_invalid_release_kind');
      assert.match(sessionId, /^[0-9a-f-]{36}$/i, 'showcase_captured_session_id_invalid');
      return run(`(async () => {
        const s = globalThis.__showcaseD42Boundary;
        const held = s.held[0];
        if (!held || held.message.kind !== ${JSON.stringify(kind)} ||
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

// Hold Chrome's real installation call from the sidepanel. The returned
// promise remains pending until release, so the production per-tab queue must
// serialize the obsolete A install and the replacement B start itself.
export async function armShowcaseInstallBoundary(panel, { holdFirst = true } = {}) {
  const run = async (expression) => {
    const response = await panel.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    assert.ok(!response.exceptionDetails, 'showcase_install_boundary_evaluation_failed');
    return response.result?.value;
  };
  assert.equal(
    await run(`(() => {
      if (globalThis.__showcaseD42Install) return false;
      const scripting = chrome.scripting;
      const original = scripting.executeScript.bind(scripting);
      const state = { held: null, observed: [], starts: [], original,
        armed: ${holdFirst ? 'true' : 'false'} };
      const intercepted = function(details) {
        const isInstall = details?.files?.length === 1 &&
          details.files[0] === 'content-scripts/list-picker.js';
        if (!isInstall) {
          if (details?.func?.toString()?.includes('__matrxListPickerStart') &&
              typeof details?.args?.[0] === 'string' &&
              /^[0-9a-f-]{36}$/i.test(details.args[0]))
            state.starts.push({ session_id: details.args[0], tab_id: details.target?.tabId,
              document_id: details.target?.documentIds?.[0] ?? null });
          return original(details);
        }
        state.observed.push({ tab_id: details.target?.tabId,
          document_id: details.target?.documentIds?.[0] ?? null });
        if (!state.armed) return original(details);
        state.armed = false;
        return new Promise((resolve, reject) => {
          state.held = { details, resolve, reject };
        });
      };
      scripting.executeScript = intercepted;
      if (scripting.executeScript !== intercepted) return false;
      globalThis.__showcaseD42Install = state;
      return true;
    })()`),
    true,
    'showcase_install_boundary_not_writable',
  );
  return {
    async snapshot() {
      return run(`(() => {
        const s = globalThis.__showcaseD42Install;
        return { held: !!s.held, observed: s.observed, starts: s.starts };
      })()`);
    },
    async release() {
      return run(`(async () => {
        const s = globalThis.__showcaseD42Install;
        const held = s.held;
        if (!held) return { released: false };
        s.held = null;
        try {
          const value = await s.original(held.details);
          held.resolve(value);
          return { released: true };
        } catch (error) {
          held.reject(error);
          return { released: false };
        }
      })()`);
    },
    async close() {
      assert.equal(
        await run(`(() => {
          const s = globalThis.__showcaseD42Install;
          if (s.held) return false;
          chrome.scripting.executeScript = s.original;
          delete globalThis.__showcaseD42Install;
          return true;
        })()`),
        true,
        'showcase_install_boundary_still_held',
      );
    },
  };
}

export async function reinjectShowcasePicker(panel, tabId, documentId, sessionId) {
  assert.ok(Number.isInteger(tabId), 'showcase_reinject_tab_missing');
  assert.equal(typeof documentId, 'string', 'showcase_reinject_document_missing');
  assert.match(sessionId, /^[0-9a-f-]{36}$/i, 'showcase_reinject_session_missing');
  const response = await panel.send('Runtime.evaluate', {
    expression: `(async () => {
      const target = { tabId: ${tabId}, documentIds: [${JSON.stringify(documentId)}] };
      await chrome.scripting.executeScript({ target, files: ['content-scripts/list-picker.js'] });
      await chrome.scripting.executeScript({ target, func: (id) => {
        const start = window.__matrxListPickerStart;
        if (typeof start !== 'function') throw new Error('picker start hook missing');
        start(id, null);
      }, args: [${JSON.stringify(sessionId)}] });
      return true;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  assert.ok(!response.exceptionDetails, 'showcase_reinject_operation_failed');
  assert.equal(response.result?.value, true, 'showcase_reinject_unverified');
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
