import assert from 'node:assert/strict';

/*
 * Firefox 156 remote-sidebar adapter for an already-owned geckodriver session.
 * The caller supplies thin execute/sync and execute/async wrappers after it has
 * selected Marionette's chrome context. This module never launches Firefox,
 * authenticates, reads credentials, or uses Gecko's native OS input methods.
 *
 * The default network scope observes only allowlisted origins in the dedicated
 * Firefox process. Use ownerScope "addon_principal" when a check specifically
 * requires a WebExtension principal; browser.identity navigation may instead
 * be process-owned. Events intentionally omit query, fragment, headers, body,
 * cookies, and timing payloads.
 */

const EXPECTED_RUNTIME = Object.freeze({
  firefoxVersion: '156.0',
  buildId: '20260909172920',
  sourceRepository: 'https://hg.mozilla.org/releases/mozilla-release',
  sourceStamp: 'a80bd15ddee3b4bf3679aeba340e9d2db933c467',
  geckodriverVersion: '0.37.1',
});

const TRUSTED_MOUSE_SOURCE = Object.freeze({
  webidl: 'https://hg.mozilla.org/releases/mozilla-release/file/a80bd15ddee3b4bf3679aeba340e9d2db933c467/dom/webidl/Window.webidl#l625',
  options: 'https://hg.mozilla.org/releases/mozilla-release/file/a80bd15ddee3b4bf3679aeba340e9d2db933c467/dom/webidl/Window.webidl#l426',
  widgetDispatch: 'https://hg.mozilla.org/releases/mozilla-release/file/a80bd15ddee3b4bf3679aeba340e9d2db933c467/dom/base/nsContentUtils.cpp#l10514',
  distinctNativeOsRoute: 'https://hg.mozilla.org/releases/mozilla-release/file/a80bd15ddee3b4bf3679aeba340e9d2db933c467/dom/base/nsDOMWindowUtils.cpp#l934',
});

function remoteFrameMain(envelope, operation, outcomePredicate) {
  const reply = value => sendAsyncMessage(envelope.name, value);
  const handler = async () => {
    removeMessageListener(envelope.name, handler);
    const request = envelope.request;
    const document = content.document;
    const fail = (code, diagnostic) => reply({ ok: false, code, ...(diagnostic && { diagnostic }) });
    let stage = 'document';
    try {
      if (!document?.documentElement || !document.location.href.endsWith('/sidepanel.html')) {
        fail('remote_sidebar_document_mismatch'); return;
      }
      stage = 'dispatch';
      if (Date.now() >= request.deadlineAt) { fail('remote_operation_expired'); return; }
      if (request.kind === 'evaluate') {
        const remaining = Math.max(1, request.deadlineAt - Date.now());
        const value = await Promise.race([
          operation(document, ...(request.args || [])),
          new Promise((_, reject) => content.setTimeout(() => reject(new Error('remote_evaluate_timeout')), remaining)),
        ]);
        reply({ ok: true, value }); return;
      }
      if (request.kind === 'wait') {
        stage = 'wait_compile';
        const predicate = operation;
        while (true) {
          if (Date.now() >= request.deadlineAt) { fail('remote_wait_timeout'); return; }
          let value;
          stage = 'wait_predicate';
          value = predicate(document, ...(request.args || []));
          stage = 'wait_result';
          if (value && typeof value.then === 'function') { fail('remote_wait_predicate_must_be_sync'); return; }
          if (value) { reply({ ok: true, value }); return; }
          stage = 'wait_poll';
          await new Promise(resolve => content.setTimeout(resolve, Math.min(request.pollMs, Math.max(1, request.deadlineAt - Date.now()))));
        }
      }
      if (request.kind === 'trusted_click' || request.kind === 'trusted_press') {
        stage = 'trusted_click_target';
        const candidates = [...document.querySelectorAll(request.selector)];
        if (candidates.length !== 1) { fail('trusted_click_target_not_unique'); return; }
        const target = candidates[0];
        const rect = target.getBoundingClientRect();
        const style = content.getComputedStyle(target);
        if (rect.width <= 0 || rect.height <= 0 || style.visibility === 'hidden' || style.display === 'none') {
          fail('trusted_click_target_not_visible'); return;
        }
        if (target.disabled || target.getAttribute('aria-disabled') === 'true') {
          fail('trusted_click_target_disabled'); return;
        }
        if (request.kind === 'trusted_press' && target.getAttribute('role') !== 'combobox') {
          fail('trusted_press_requires_combobox'); return;
        }
        target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        if (Date.now() >= request.deadlineAt) { fail('trusted_click_expired'); return; }
        stage = 'trusted_click_actionability';
        const settleStartedAt = Date.now();
        let previousRect = null;
        let stableFrames = 0;
        let samples = 0;
        let current;
        while (true) {
          if (Date.now() >= request.deadlineAt) {
            fail('trusted_click_target_not_stable', {
              mode: request.kind,
              actionability: { samples, stableFrames, settleMs: Date.now() - settleStartedAt },
            }); return;
          }
          await new Promise(resolve => content.requestAnimationFrame(resolve));
          current = target.getBoundingClientRect();
          samples += 1;
          const unchanged = previousRect !== null
            && ['left', 'top', 'width', 'height'].every(key => Math.abs(current[key] - previousRect[key]) <= 0.25);
          const ancestorAnimations = [];
          for (let node = target; node && node !== document; node = node.parentNode)
            if (typeof node.getAnimations === 'function') ancestorAnimations.push(...node.getAnimations());
          const moving = ancestorAnimations.some(animation => animation.playState === 'running' || animation.pending === true);
          stableFrames = unchanged && !moving ? stableFrames + 1 : 0;
          previousRect = { left: current.left, top: current.top, width: current.width, height: current.height };
          if (stableFrames >= 3) break;
        }
        const x = current.left + current.width / 2;
        const y = current.top + current.height / 2;
        const hit = document.elementFromPoint(x, y);
        const hitExact = hit === target;
        const hitInside = hitExact || (hit !== null && target.contains(hit));
        const actionability = {
          samples,
          stableFrames,
          settleMs: Date.now() - settleStartedAt,
          targetTag: target.tagName.toLowerCase(),
          targetRole: target.getAttribute('role'),
          hitTag: typeof hit?.tagName === 'string' ? hit.tagName.toLowerCase() : null,
          hitRole: hit?.getAttribute?.('role') ?? null,
          hitRelation: hitExact ? 'exact' : hitInside ? 'descendant' : 'outside',
          centerInViewport: x >= 0 && y >= 0 && x < content.innerWidth && y < content.innerHeight,
        };
        if (current.width <= 0 || current.height <= 0 || !actionability.centerInViewport || !hitInside) {
          fail(request.kind === 'trusted_press'
            ? 'trusted_press_target_occluded'
            : 'trusted_click_target_occluded', { mode: request.kind, actionability }); return;
        }
        const events = [];
        const observe = event => {
          const exactTarget = event.target === target;
          const insideTarget = exactTarget || target.contains(event.target);
          events.push({
            type: event.type,
            trusted: event.isTrusted,
            targetRelation: exactTarget ? 'exact' : insideTarget ? 'descendant' : 'outside',
            targetTag: typeof event.target?.tagName === 'string' ? event.target.tagName.toLowerCase() : null,
            targetRole: event.target?.getAttribute?.('role') ?? null,
            originalTargetConnected: target.isConnected,
          });
        };
        for (const type of ['mousedown', 'mouseup', 'click']) document.addEventListener(type, observe, true);
        const options = { isDOMEventSynthesized: false, isWidgetEventSynthesized: false };
        stage = 'trusted_click_synthesis';
        try {
          if (Date.now() >= request.deadlineAt) { fail('trusted_click_expired'); return; }
          content.synthesizeMouseEvent('mousemove', x, y, { button: 0, buttons: 0 }, options);
          content.synthesizeMouseEvent('mousedown', x, y, { button: 0, buttons: 1, clickCount: 1 }, options);
          content.synthesizeMouseEvent('mouseup', x, y, { button: 0, buttons: 0, clickCount: 1 }, options);
          await new Promise(resolve => content.setTimeout(resolve, 0));
        } finally {
          for (const type of ['mousedown', 'mouseup', 'click']) document.removeEventListener(type, observe, true);
        }
        const expected = ['mousedown', 'mouseup', 'click'];
        const exactSequence = events.length === expected.length
          && events.every((event, index) => event.type === expected[index] && event.trusted === true);
        const initialTargeted = events[0]?.targetRelation === 'exact' || events[0]?.targetRelation === 'descendant';
        const strictTargeting = events.every(event => event.targetRelation === 'exact' || event.targetRelation === 'descendant');
        const diagnostic = { mode: request.kind, actionability, events };
        if (!exactSequence || !initialTargeted || (request.kind === 'trusted_click' && !strictTargeting)) {
          fail(request.kind === 'trusted_press'
            ? 'trusted_press_event_sequence_invalid'
            : 'trusted_click_event_sequence_invalid', diagnostic); return;
        }
        let outcome = true;
        if (request.outcomeSource) {
          stage = 'trusted_click_outcome';
          const predicate = outcomePredicate;
          while (true) {
            if (Date.now() >= request.deadlineAt) { fail('trusted_click_outcome_timeout'); return; }
            outcome = predicate(document, ...(request.outcomeArgs || []));
            if (outcome && typeof outcome.then === 'function') { fail('trusted_click_outcome_must_be_sync'); return; }
            if (outcome) break;
            await new Promise(resolve => content.setTimeout(resolve, Math.min(request.pollMs, Math.max(1, request.deadlineAt - Date.now()))));
          }
        }
        reply({ ok: true, value: { events, outcome, diagnostic } }); return;
      }
      fail('remote_operation_unknown');
    } catch (error) {
      const errorName = String(error?.name || 'error').replace(/[^a-z0-9]+/gi, '_').toLowerCase().slice(0, 40);
      const code = /^[a-z0-9_]{1,100}$/.test(String(error?.message || ''))
        ? String(error.message) : `remote_${request.kind}_${stage}_${errorName}`;
      reply({ ok: false, code });
    }
  };
  addMessageListener(envelope.name, handler);
}

const REMOTE_FRAME_MAIN_SOURCE = remoteFrameMain.toString();

const REMOTE_OPERATION_SCRIPT = String.raw`
const done = arguments[arguments.length - 1];
const addonId = arguments[0];
const request = arguments[1];
const remoteFrameMainSource = arguments[2];
const win = Services.wm.getMostRecentWindow('navigator:browser');
const finish = (() => {
  let sent = false;
  return value => { if (!sent) { sent = true; done(value); } };
})();
try {
  const matches = [...win.SidebarController.sidebars.entries()].filter(([, item]) => item.extensionId === addonId);
  if (matches.length !== 1) { finish({ ok: false, code: 'sidebar_registration_not_unique' }); return; }
  const [sidebarId] = matches[0];
  const host = win.SidebarController.browser;
  const panel = host?.contentDocument?.getElementById('webext-panels-browser');
  if (win.SidebarController.currentID !== sidebarId || host?.hidden || !panel?.browsingContext) {
    finish({ ok: false, code: 'owned_sidebar_not_active' }); return;
  }
  if (!panel.currentURI?.spec?.endsWith('/sidepanel.html')) {
    finish({ ok: false, code: 'owned_sidebar_document_mismatch' }); return;
  }
  const name = '__matrx_sidebar_adapter_' + Services.uuid.generateUUID().toString();
  const operationSource = request.source ? '(' + request.source + ')' : 'null';
  const outcomeSource = request.outcomeSource ? '(' + request.outcomeSource + ')' : 'null';
  const frameScript = '(' + remoteFrameMainSource + ')(' + JSON.stringify({ name, request }) + ',' + operationSource + ',' + outcomeSource + ');';
  let timeoutId;
  const listener = message => {
    panel.messageManager.removeMessageListener(name, listener);
    if (timeoutId !== undefined) win.clearTimeout(timeoutId);
    finish(message.data);
  };
  panel.messageManager.addMessageListener(name, listener);
  panel.messageManager.loadFrameScript('data:application/javascript,' + encodeURIComponent(frameScript), false);
  panel.messageManager.sendAsyncMessage(name, {});
  timeoutId = win.setTimeout(() => {
    panel.messageManager.removeMessageListener(name, listener);
    finish({ ok: false, code: 'remote_operation_timeout' });
  }, request.outerTimeoutMs);
} catch {
  finish({ ok: false, code: 'remote_operation_setup_failed' });
}`;

const RUNTIME_SCRIPT = String.raw`
return {
  firefoxVersion: Services.appinfo.version,
  buildId: Services.appinfo.appBuildID,
  sidebarWindowType: Services.wm.getMostRecentWindow('navigator:browser')?.document?.documentElement?.getAttribute('windowtype') ?? null,
};`;

const START_OBSERVER_SCRIPT = String.raw`
const addonId = arguments[0];
const origins = arguments[1];
const maxEvents = arguments[2];
const ownerScope = arguments[3];
const win = Services.wm.getMostRecentWindow('navigator:browser');
const key = '__matrxOwnedNetworkObserverV1';
const windows = [...Services.wm.getEnumerator('navigator:browser')];
if (windows.some(candidate => candidate[key])) return { ok: false, code: 'network_observer_already_started' };
const allowed = new Set(origins);
const state = { events: [], dropped: 0, observerErrors: 0, sequence: 0, disposed: false };
const topics = ['http-on-modify-request', 'http-on-examine-response', 'http-on-examine-cached-response'];
const observer = {
  observe(subject, topic) {
    try {
      const channel = subject.QueryInterface(Ci.nsIHttpChannel);
      const uri = channel.URI;
      const origin = uri.prePath;
      if (!allowed.has(origin)) return;
      const loadInfo = channel.loadInfo;
      const principals = [loadInfo?.loadingPrincipal, loadInfo?.triggeringPrincipal, loadInfo?.principalToInherit];
      const ownerAddonIds = [...new Set(principals.map(principal => principal?.addonPolicy?.id).filter(Boolean))];
      const addonPrincipal = ownerAddonIds.includes(addonId);
      if (ownerScope === 'addon_principal' && !addonPrincipal) return;
      if (state.events.length >= maxEvents) { state.dropped += 1; return; }
      const response = topic !== 'http-on-modify-request';
      let status = null;
      if (response) { try { status = channel.responseStatus; } catch {} }
      state.events.push({
        sequence: ++state.sequence,
        phase: response ? 'response' : 'request',
        responseSource: topic === 'http-on-examine-cached-response' ? 'cache' : response ? 'network' : null,
        requestId: String(channel.channelId),
        method: channel.requestMethod,
        origin,
        pathname: uri.filePath || '/',
        status,
        owner: addonPrincipal ? 'addon_principal' : 'owned_firefox_process',
        contentPolicyType: loadInfo?.externalContentPolicyType ?? null,
      });
    } catch { state.observerErrors += 1; }
  },
};
const registered = [];
try {
  for (const topic of topics) { Services.obs.addObserver(observer, topic); registered.push(topic); }
} catch {
  for (const topic of registered) { try { Services.obs.removeObserver(observer, topic); } catch {} }
  return { ok: false, code: 'network_observer_registration_failed' };
}
win[key] = { addonId, origins: [...allowed], maxEvents, ownerScope, state, topics, observer };
return { ok: true, ownerAddonId: addonId, origins: [...allowed], maxEvents, ownerScope,
  captureContract: 'method_origin_path_status_owner_only_no_headers_query_body' };
`;

const READ_OBSERVER_SCRIPT = String.raw`
const key = '__matrxOwnedNetworkObserverV1';
const windows = [...Services.wm.getEnumerator('navigator:browser')];
const matches = windows.filter(candidate => candidate[key]);
if (matches.length > 1) return { ok: false, code: 'network_observer_not_unique' };
const owned = matches[0]?.[key];
if (!owned) return { ok: false, code: 'network_observer_not_started' };
return { ok: true, ownerAddonId: owned.addonId, origins: owned.origins, maxEvents: owned.maxEvents, ownerScope: owned.ownerScope,
  events: owned.state.events, dropped: owned.state.dropped,
  observerErrors: owned.state.observerErrors, disposed: owned.state.disposed,
  captureContract: 'method_origin_path_status_owner_only_no_headers_query_body' };
`;

const DISPOSE_OBSERVER_SCRIPT = String.raw`
const key = '__matrxOwnedNetworkObserverV1';
const windows = [...Services.wm.getEnumerator('navigator:browser')];
const matches = windows.filter(candidate => candidate[key]);
if (matches.length > 1) return { ok: false, code: 'network_observer_not_unique' };
const win = matches[0];
const owned = win?.[key];
if (!owned) return { ok: false, code: 'network_observer_not_started' };
let removalFailures = 0;
const remainingTopics = [];
for (const topic of owned.topics) {
  try { Services.obs.removeObserver(owned.observer, topic); }
  catch { removalFailures += 1; remainingTopics.push(topic); }
}
owned.topics = remainingTopics;
owned.state.disposed = removalFailures === 0;
const result = { ok: removalFailures === 0, ownerAddonId: owned.addonId, origins: owned.origins, ownerScope: owned.ownerScope,
  maxEvents: owned.maxEvents, events: owned.state.events, dropped: owned.state.dropped,
  observerErrors: owned.state.observerErrors, disposed: owned.state.disposed, removalFailures,
  captureContract: 'method_origin_path_status_owner_only_no_headers_query_body' };
if (owned.state.disposed) delete win[key];
return result;
`;

const START_VAULT_CREATE_RECEIPT_OBSERVER_SCRIPT = String.raw`
const addonId = arguments[0];
const origin = arguments[1];
const key = '__matrxOwnedVaultCreateReceiptObserverV1';
const windows = [...Services.wm.getEnumerator('navigator:browser')];
if (windows.some(candidate => candidate[key])) return { ok: false, code: 'receipt_observer_already_started' };
const win = Services.wm.getMostRecentWindow('navigator:browser');
const state = { requests: [], responses: [], keys: [], dropped: 0, observerErrors: 0, disposed: false };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const observer = { observe(subject, topic) {
  try {
    const channel = subject.QueryInterface(Ci.nsIHttpChannel);
    const uri = channel.URI;
    if (channel.requestMethod !== 'POST' || uri.prePath !== origin || (uri.filePath || '/') !== '/api/vault/items') return;
    const loadInfo = channel.loadInfo;
    const principals = [loadInfo?.loadingPrincipal, loadInfo?.triggeringPrincipal, loadInfo?.principalToInherit];
    if (!principals.some(principal => principal?.addonPolicy?.id === addonId)) return;
    const requestId = String(channel.channelId);
    if (topic === 'http-on-modify-request') {
      let idempotencyKey = null;
      channel.visitRequestHeaders({ visitHeader(name, value) {
        if (String(name).toLowerCase() === 'idempotency-key' && uuid.test(String(value))) idempotencyKey = String(value).toLowerCase();
      }});
      if (state.requests.length >= 16) { state.dropped += 1; return; }
      state.requests.push({ requestId });
      if (idempotencyKey !== null && !state.keys.includes(idempotencyKey)) state.keys.push(idempotencyKey);
      return;
    }
    if (state.responses.length >= 16) { state.dropped += 1; return; }
    let status = null; try { status = channel.responseStatus; } catch {}
    state.responses.push({ requestId, status });
  } catch { state.observerErrors += 1; }
}};
const topics = ['http-on-modify-request', 'http-on-examine-response', 'http-on-examine-cached-response'];
try { for (const topic of topics) Services.obs.addObserver(observer, topic); }
catch { for (const topic of topics) { try { Services.obs.removeObserver(observer, topic); } catch {} } return { ok: false, code: 'receipt_observer_registration_failed' }; }
win[key] = { addonId, origin, state, topics, observer };
return { ok: true, captureContract: 'exact_addon_post_items_uuid_idempotency_only' };
`;

const READ_VAULT_CREATE_RECEIPT_OBSERVER_SCRIPT = String.raw`
const key = '__matrxOwnedVaultCreateReceiptObserverV1';
const matches = [...Services.wm.getEnumerator('navigator:browser')].filter(candidate => candidate[key]);
if (matches.length !== 1) return { ok: false, code: 'receipt_observer_not_unique' };
const owned = matches[0][key];
return { ok: true, requests: owned.state.requests, responses: owned.state.responses, keys: owned.state.keys,
  dropped: owned.state.dropped, observerErrors: owned.state.observerErrors, disposed: owned.state.disposed,
  captureContract: 'exact_addon_post_items_uuid_idempotency_only' };
`;

const DISPOSE_VAULT_CREATE_RECEIPT_OBSERVER_SCRIPT = String.raw`
const key = '__matrxOwnedVaultCreateReceiptObserverV1';
const matches = [...Services.wm.getEnumerator('navigator:browser')].filter(candidate => candidate[key]);
if (matches.length !== 1) return { ok: false, code: 'receipt_observer_not_unique' };
const win = matches[0]; const owned = win[key]; let removalFailures = 0;
for (const topic of owned.topics) { try { Services.obs.removeObserver(owned.observer, topic); } catch { removalFailures += 1; } }
owned.state.disposed = removalFailures === 0;
const result = { ok: removalFailures === 0, requests: owned.state.requests, responses: owned.state.responses,
  keys: owned.state.keys, dropped: owned.state.dropped, observerErrors: owned.state.observerErrors,
  disposed: owned.state.disposed, captureContract: 'exact_addon_post_items_uuid_idempotency_only' };
if (owned.state.disposed) delete win[key]; return result;
`;

function sourceOf(fn, label, { readOnly = false } = {}) {
  assert.equal(typeof fn, 'function', `${label}_must_be_function`);
  const source = fn.toString();
  assert.ok(source.length > 0 && source.length <= 20_000, `${label}_source_invalid`);
  if (readOnly) {
    const mutationOrScheduling = /\b(?:setTimeout|setInterval|requestAnimationFrame|queueMicrotask)\s*\(|\.(?:click|focus|blur|remove|append|appendChild|prepend|replaceChildren|setAttribute|removeAttribute|dispatchEvent)\s*\(|\b(?:innerHTML|outerHTML|textContent|value)\s*=(?!=)/;
    assert.equal(mutationOrScheduling.test(source), false, `${label}_must_be_read_only`);
  }
  return source;
}

function validateTiming(timeoutMs, pollMs) {
  assert.ok(Number.isInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 30_000, 'remote_timeout_invalid');
  assert.ok(Number.isInteger(pollMs) && pollMs >= 10 && pollMs <= 1_000, 'remote_poll_invalid');
}

function validateOrigins(origins) {
  assert.ok(Array.isArray(origins) && origins.length > 0 && origins.length <= 16, 'network_origins_invalid');
  return [...new Set(origins.map(value => {
    const url = new URL(value);
    assert.equal(url.href, url.origin + '/', 'network_origin_must_not_include_path_query_or_credentials');
    assert.ok(url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)), 'network_origin_not_allowed');
    return url.origin;
  }))];
}

export function createFirefoxSidebarAdapter({ executeChromeSync, executeChromeAsync, performKeyboardActions, addonId }) {
  assert.equal(typeof executeChromeSync, 'function', 'execute_chrome_sync_missing');
  assert.equal(typeof executeChromeAsync, 'function', 'execute_chrome_async_missing');
  if (performKeyboardActions !== undefined)
    assert.equal(typeof performKeyboardActions, 'function', 'perform_keyboard_actions_invalid');
  assert.ok(typeof addonId === 'string' && addonId.length > 3, 'addon_id_invalid');
  let observerStarted = false;
  let vaultCreateReceiptObserverStarted = false;

  const remote = async request => {
    const bounded = { ...request, deadlineAt: Date.now() + request.timeoutMs };
    const result = await executeChromeAsync(REMOTE_OPERATION_SCRIPT, [addonId, bounded, REMOTE_FRAME_MAIN_SOURCE]);
    if (result?.ok !== true) {
      const error = new Error(result?.code ?? 'remote_operation_invalid_result');
      if (result?.diagnostic) error.diagnostic = result.diagnostic;
      throw error;
    }
    return result.value;
  };

  return Object.freeze({
    expectedRuntime: EXPECTED_RUNTIME,
    trustedMouseSource: TRUSTED_MOUSE_SOURCE,
    async attestRuntime(hostRuntime) {
      assert.deepEqual(hostRuntime, {
        sourceRepository: EXPECTED_RUNTIME.sourceRepository,
        sourceStamp: EXPECTED_RUNTIME.sourceStamp,
        geckodriverVersion: EXPECTED_RUNTIME.geckodriverVersion,
      }, 'firefox_host_runtime_not_reviewed');
      const runtime = await executeChromeSync(RUNTIME_SCRIPT, []);
      assert.deepEqual(runtime, {
        firefoxVersion: EXPECTED_RUNTIME.firefoxVersion,
        buildId: EXPECTED_RUNTIME.buildId,
        sidebarWindowType: 'navigator:browser',
      }, 'firefox_runtime_not_reviewed');
      return { ...runtime, ...hostRuntime, trustedMouseSource: TRUSTED_MOUSE_SOURCE, nativeOsInputUsed: false };
    },
    evaluate(fn, args = [], { timeoutMs = 10_000 } = {}) {
      validateTiming(timeoutMs, 50);
      assert.ok(Array.isArray(args), 'remote_args_invalid');
      return remote({ kind: 'evaluate', source: sourceOf(fn, 'remote_evaluate'), args, timeoutMs, outerTimeoutMs: timeoutMs + 1_000 });
    },
    waitFor(fn, args = [], { timeoutMs = 15_000, pollMs = 100 } = {}) {
      validateTiming(timeoutMs, pollMs);
      assert.ok(Array.isArray(args), 'remote_args_invalid');
      return remote({ kind: 'wait', source: sourceOf(fn, 'remote_wait', { readOnly: true }), args, timeoutMs, pollMs, outerTimeoutMs: timeoutMs + 1_000 });
    },
    trustedClick(selector, {
      outcome,
      outcomeArgs = [],
      timeoutMs = 15_000,
      pollMs = 100,
    } = {}) {
      assert.ok(typeof selector === 'string' && selector.length > 0 && selector.length <= 1_000, 'trusted_click_selector_invalid');
      validateTiming(timeoutMs, pollMs);
      assert.ok(Array.isArray(outcomeArgs), 'trusted_click_outcome_args_invalid');
      return remote({
        kind: 'trusted_click', selector,
        outcomeSource: outcome ? sourceOf(outcome, 'trusted_click_outcome', { readOnly: true }) : null,
        outcomeArgs, timeoutMs, pollMs, outerTimeoutMs: timeoutMs + 1_000,
      });
    },
    trustedPress(selector, {
      outcome,
      outcomeArgs = [],
      timeoutMs = 15_000,
      pollMs = 100,
    } = {}) {
      assert.ok(typeof selector === 'string' && selector.length > 0 && selector.length <= 1_000, 'trusted_press_selector_invalid');
      assert.equal(typeof outcome, 'function', 'trusted_press_outcome_required');
      validateTiming(timeoutMs, pollMs);
      assert.ok(Array.isArray(outcomeArgs), 'trusted_press_outcome_args_invalid');
      return remote({
        kind: 'trusted_press', selector,
        outcomeSource: sourceOf(outcome, 'trusted_press_outcome', { readOnly: true }),
        outcomeArgs, timeoutMs, pollMs, outerTimeoutMs: timeoutMs + 1_000,
      });
    },
    async trustedKeyboardSelectExact(selector, expectedLabel, { timeoutMs = 15_000, pollMs = 100 } = {}) {
      assert.equal(typeof performKeyboardActions, 'function', 'perform_keyboard_actions_missing');
      assert.ok(typeof expectedLabel === 'string' && expectedLabel.length > 0, 'keyboard_expected_label_missing');
      validateTiming(timeoutMs, pollMs);
      const stateKey = `__matrxTrustedKeyboard_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      let diagnostic;
      try {
        const initial = await remote({ kind: 'evaluate', source: sourceOf((document, selector, label, key) => {
          const targets = [...document.querySelectorAll(selector)];
          if (targets.length !== 1 || targets[0].getAttribute('role') !== 'combobox')
            return { ok: false, code: 'keyboard_combobox_not_unique' };
          const target = targets[0];
          const listbox = document.getElementById(target.getAttribute('aria-controls'));
          if (!listbox || listbox.getAttribute('role') !== 'listbox')
            return { ok: false, code: 'keyboard_owned_listbox_missing' };
          const options = [...listbox.querySelectorAll('[role="option"]')]
            .filter(node => node.getAttribute('aria-disabled') !== 'true' && !node.hasAttribute('data-disabled'));
          const matches = options.filter(node => node.textContent?.trim() === label);
          if (matches.length !== 1) return { ok: false, code: 'keyboard_exact_option_not_unique' };
          if (!listbox.contains(document.activeElement)) return { ok: false, code: 'keyboard_owned_option_not_focused' };
          const events = [];
          const observe = event => events.push({ type: event.type, key: event.key, trusted: event.isTrusted,
            owned: listbox.contains(event.target) || target === event.target || target.contains(event.target) });
          document.addEventListener('keydown', observe, true);
          document.addEventListener('keyup', observe, true);
          document[key] = { target, listbox, expected: matches[0], observe, events };
          return { ok: true, index: options.indexOf(matches[0]), optionCount: options.length };
        }, 'keyboard_exact_setup'), args: [selector, expectedLabel, stateKey], timeoutMs, outerTimeoutMs: timeoutMs + 1000 });
        if (initial?.ok !== true) throw new Error(initial?.code ?? 'keyboard_exact_setup_failed');
        const route = await executeChromeSync(`
          const win = Services.wm.getMostRecentWindow('navigator:browser');
          const [id] = [...win.SidebarController.sidebars.entries()].find(([,item]) => item.extensionId === arguments[0]) ?? [];
          const host = win.SidebarController.browser;
          const panel = host?.contentDocument?.getElementById('webext-panels-browser');
          if (!id || win.SidebarController.currentID !== id || !panel) return false;
          panel.focus();
          return panel.ownerDocument.activeElement === panel && host.ownerDocument.activeElement === host;
        `, [addonId]);
        if (route !== true) throw new Error('keyboard_sidebar_focus_route_failed');
        // Home and ArrowDown operate Radix's real roving focus. Never synthesize selection.
        const keys = ['\uE011', ...Array(initial.index).fill('\uE015')];
        for (const key of keys) {
          await performKeyboardActions([key]);
          // Radix schedules the focus move; one browser frame settles each key.
          await remote({ kind: 'evaluate', source: sourceOf(async document => {
            await new Promise(resolve => document.defaultView.requestAnimationFrame(resolve));
            return true;
          }, 'keyboard_focus_settle'), args: [], timeoutMs, outerTimeoutMs: timeoutMs + 1000 });
        }
        const exact = await remote({ kind: 'evaluate', source: sourceOf((document, key) => {
          const state = document[key];
          return !!state && state.expected === document.activeElement && state.expected.isConnected;
        }, 'keyboard_exact_before_commit', { readOnly: true }), args: [stateKey], timeoutMs, outerTimeoutMs: timeoutMs + 1000 });
        if (!exact) throw new Error('keyboard_exact_option_not_focused_before_enter');
        await performKeyboardActions(['\uE007']);
        await remote({ kind: 'wait', source: sourceOf((document, selector, label) => {
          const target = document.querySelector(selector);
          return target?.textContent?.trim() === label && target.getAttribute('aria-expanded') === 'false';
        }, 'keyboard_exact_outcome', { readOnly: true }), args: [selector, expectedLabel], timeoutMs, pollMs, outerTimeoutMs: timeoutMs + 1000 });
        diagnostic = { exactOptionFocusedBeforeEnter: true, exactLabelSelected: true, navigationKeyCount: keys.length };
      } finally {
        const result = await remote({ kind: 'evaluate', source: sourceOf((document, key) => {
          const state = document[key];
          if (!state) return { removed: true, events: [] };
          document.removeEventListener('keydown', state.observe, true);
          document.removeEventListener('keyup', state.observe, true);
          delete document[key];
          return { removed: !document[key], events: state.events };
        }, 'keyboard_exact_teardown'), args: [stateKey], timeoutMs, outerTimeoutMs: timeoutMs + 1000 });
        if (diagnostic) {
          const expectedKeys = ['Home', ...Array(diagnostic.navigationKeyCount - 1).fill('ArrowDown'), 'Enter'];
          assert.equal(result.events.length, expectedKeys.length * 2, 'keyboard_event_count_mismatch');
          result.events.forEach((event, index) => {
            assert.equal(event.type, index % 2 === 0 ? 'keydown' : 'keyup', 'keyboard_event_order_mismatch');
            assert.equal(event.key, expectedKeys[Math.floor(index / 2)], 'keyboard_event_key_mismatch');
            assert.equal(event.trusted, true, 'keyboard_event_untrusted');
            assert.equal(event.owned, true, 'keyboard_event_outside_owned_select');
          });
          diagnostic.trustedOwnedEvents = true;
          diagnostic.listenerStateRemoved = result.removed;
        }
      }
      return diagnostic;
    },
    async startNetworkObserver({ origins, maxEvents = 2_000, ownerScope = 'owned_firefox_process' }) {
      assert.equal(observerStarted, false, 'network_observer_already_started_locally');
      const normalized = validateOrigins(origins);
      assert.ok(Number.isInteger(maxEvents) && maxEvents >= 1 && maxEvents <= 10_000, 'network_max_events_invalid');
      assert.ok(['owned_firefox_process', 'addon_principal'].includes(ownerScope), 'network_owner_scope_invalid');
      const result = await executeChromeSync(START_OBSERVER_SCRIPT, [addonId, normalized, maxEvents, ownerScope]);
      assert.equal(result?.ok, true, result?.code ?? 'network_observer_start_failed');
      observerStarted = true;
      return result;
    },
    async readNetworkObserver() {
      assert.equal(observerStarted, true, 'network_observer_not_started_locally');
      const result = await executeChromeSync(READ_OBSERVER_SCRIPT, []);
      assert.equal(result?.ok, true, result?.code ?? 'network_observer_read_failed');
      assert.equal(result.dropped, 0, 'network_observer_capacity_exceeded');
      assert.equal(result.observerErrors, 0, 'network_observer_internal_error');
      return result;
    },
    async disposeNetworkObserver() {
      assert.equal(observerStarted, true, 'network_observer_not_started_locally');
      const result = await executeChromeSync(DISPOSE_OBSERVER_SCRIPT, []);
      assert.equal(result?.ok, true, result?.code ?? 'network_observer_dispose_failed');
      assert.equal(result.disposed, true, 'network_observer_not_disposed');
      observerStarted = false;
      assert.equal(result.dropped, 0, 'network_observer_capacity_exceeded');
      assert.equal(result.observerErrors, 0, 'network_observer_internal_error');
      return result;
    },
    async startVaultCreateReceiptObserver({ origin }) {
      assert.equal(vaultCreateReceiptObserverStarted, false, 'receipt_observer_already_started_locally');
      const normalized = validateOrigins([origin]);
      const result = await executeChromeSync(START_VAULT_CREATE_RECEIPT_OBSERVER_SCRIPT, [addonId, normalized[0]]);
      assert.equal(result?.ok, true, result?.code ?? 'receipt_observer_start_failed');
      vaultCreateReceiptObserverStarted = true;
      return result;
    },
    async readVaultCreateReceiptObserver() {
      assert.equal(vaultCreateReceiptObserverStarted, true, 'receipt_observer_not_started_locally');
      const result = await executeChromeSync(READ_VAULT_CREATE_RECEIPT_OBSERVER_SCRIPT, []);
      assert.equal(result?.ok, true, result?.code ?? 'receipt_observer_read_failed');
      assert.equal(result.dropped, 0, 'receipt_observer_capacity_exceeded');
      assert.equal(result.observerErrors, 0, 'receipt_observer_internal_error');
      return result;
    },
    async disposeVaultCreateReceiptObserver() {
      assert.equal(vaultCreateReceiptObserverStarted, true, 'receipt_observer_not_started_locally');
      const result = await executeChromeSync(DISPOSE_VAULT_CREATE_RECEIPT_OBSERVER_SCRIPT, []);
      assert.equal(result?.ok, true, result?.code ?? 'receipt_observer_dispose_failed');
      assert.equal(result.disposed, true, 'receipt_observer_not_disposed');
      vaultCreateReceiptObserverStarted = false;
      assert.equal(result.dropped, 0, 'receipt_observer_capacity_exceeded');
      assert.equal(result.observerErrors, 0, 'receipt_observer_internal_error');
      return result;
    },
  });
}

export { EXPECTED_RUNTIME, TRUSTED_MOUSE_SOURCE };
