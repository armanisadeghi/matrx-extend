import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const searchHosts = new Set([
  'uj5wyc0l7x-dsn.algolia.net',
  'uj5wyc0l7x-1.algolianet.com',
  'uj5wyc0l7x-2.algolianet.com',
  'uj5wyc0l7x-3.algolianet.com',
]);
const searchPaths = new Set(['/1/indexes/Item_dev/query', '/1/indexes/Item_dev_sort_date/query']);
const digest = (value) => createHash('sha256').update(value).digest('hex');

// CDP messages can contain request URLs and headers. Only these fixed categories
// are allowed into a receipt; never retain the message, stack, or raw error code.
export function publicCdpFailureCategory(error) {
  const message = String(error?.message ?? '');
  if (/invalid interception id|invalid request id|no resource with given identifier/i.test(message))
    return 'request_no_longer_intercepted';
  if (/target closed|session closed|session.*detached|connection closed/i.test(message))
    return 'cdp_session_closed';
  if (/cancell?ed|aborted|net::ERR_ABORTED/i.test(message)) return 'request_cancelled';
  if (/timed? ?out/i.test(message)) return 'cdp_timeout';
  return 'other_cdp_failure';
}

// Keep URL, query credentials, POST data and response bytes in memory. Receipts
// contain only hashes and lifecycle identities; no response is replaced.
export function publicRaceRequestIdentity(request, expectedPath) {
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return null;
  }
  if (
    url.protocol !== 'https:' ||
    !searchHosts.has(url.host) ||
    !searchPaths.has(url.pathname) ||
    (expectedPath && url.pathname !== expectedPath) ||
    request.method !== 'POST' ||
    typeof request.postData !== 'string'
  )
    return null;
  return {
    endpoint_shape: url.pathname,
    url_sha256: digest(request.url),
    body_sha256: digest(request.postData),
    identity_sha256: digest(JSON.stringify([request.url, request.method, request.postData])),
  };
}

export function assessPublicRacePreflight(facts) {
  if (
    facts.paused.length !== 2 ||
    facts.paused.some((item) => !item.network_id || !item.frame_id || !item.loader_id) ||
    facts.paused[0].identity_sha256 !== facts.paused[1].identity_sha256 ||
    facts.paused[0].loader_id === facts.paused[1].loader_id ||
    !facts.paused.every((item) =>
      facts.contexts.some(
        (context) => context.frame_id === item.frame_id && context.loader_id === item.loader_id,
      ),
    ) ||
    facts.contexts.find((context) => context.loader_id === facts.paused[0].loader_id)?.unique_id ===
      facts.contexts.find((context) => context.loader_id === facts.paused[1].loader_id)
        ?.unique_id ||
    facts.release_attempts.map((attempt) => attempt.step).join(',') !== 'old,current' ||
    facts.release_attempts[1].outcome !== 'continued' ||
    (facts.paused[0].lifecycle === 'finished' &&
      facts.release_attempts[0].outcome !== 'continued') ||
    (facts.paused[0].lifecycle === 'failed' &&
      facts.release_attempts[0].outcome !== 'cdp_rejected') ||
    facts.paused[1].lifecycle !== 'finished' ||
    !['finished', 'failed'].includes(facts.paused[0].lifecycle) ||
    facts.paused.some((item) => !/^[a-f0-9]{64}$/.test(item.response_sha256 ?? '')) ||
    facts.old_paused_before_replay !== true ||
    facts.extension_capture_at_current_pause !== true ||
    facts.current_binding_matches_response !== true ||
    !['captured_initial_request', 'honest_retrigger_guidance'].includes(facts.terminal_outcome) ||
    facts.capture_probe_cleanup !== 'removed_detached' ||
    facts.unmatched_target_count !== 0 ||
    facts.continuation_rejections.target !== 0 ||
    facts.cleanup !== 'disabled_detached'
  )
    return 'unverified';
  return facts.paused[0].lifecycle === 'finished'
    ? 'prior_document_released_current_verified'
    : 'prior_document_cancelled_current_verified';
}

// The worker's chrome.debugger event is the extension-side positive signal.
// Keep the hook nonce and payload inside the worker; only booleans leave it.
export async function installPublicCaptureProbe(worker, pageUrl) {
  const removeExpression = `(async () => {
    const p = globalThis.__d47PublicCaptureProbe;
    if (!p) return true;
    p.state.closed = true;
    chrome.debugger.onEvent.removeListener(p.listener);
    chrome.debugger.onDetach.removeListener(p.detach);
    const removed = !chrome.debugger.onEvent.hasListener(p.listener) &&
      !chrome.debugger.onDetach.hasListener(p.detach);
    await Promise.allSettled([...p.state.pending]);
    if (removed) delete globalThis.__d47PublicCaptureProbe;
    return removed;
  })()`;
  try {
    await worker.send('Runtime.enable');
    const installed = await worker.send('Runtime.evaluate', {
      expression: `(async () => {
      if (globalThis.__d47PublicCaptureProbe) throw new Error('public_probe_already_installed');
      const expected = ${JSON.stringify(pageUrl)};
      const tabs = await chrome.tabs.query({ url: 'https://hn.algolia.com/*' });
      const exact = tabs.filter(tab => tab.url === expected && Number.isInteger(tab.id));
      if (exact.length !== 1) return false;
      const state = { tabId: exact[0].id, handshake: false, detached: false,
        contexts: {}, hooks: {}, packets: [], pending: new Set(), closed: false };
      const listener = (source, method, params = {}) => {
        if (state.closed || source.tabId !== state.tabId || source.sessionId) return;
        if (method === 'Runtime.executionContextCreated') {
          const context = params.context;
          if (context?.auxData?.isDefault && context.uniqueId)
            state.contexts[context.id] = context.uniqueId;
          return;
        }
        if (method !== 'Runtime.bindingCalled' ||
            !String(params.name).startsWith('__matrx_capture_')) return;
        try {
          const packet = JSON.parse(params.payload);
          if (packet?.__matrx_capture_hook === 'network-tap') {
            state.handshake = true;
            state.hooks[params.executionContextId] = params.name;
          } else if (state.hooks[params.executionContextId] === params.name &&
              packet?.method === 'POST' && packet?.status === 200 &&
              typeof packet.url === 'string' && typeof packet.body === 'string' &&
              typeof packet.request_body_key === 'string' &&
              Number.isSafeInteger(packet.request_sequence) && !packet.body_truncated) {
            const contextUniqueId = state.contexts[params.executionContextId] ?? null;
            const pending = (async () => {
              const hash = async value => [...new Uint8Array(await crypto.subtle.digest(
                'SHA-256', new TextEncoder().encode(value)))]
                .map(byte => byte.toString(16).padStart(2, '0')).join('');
              const [urlSha, bodySha] = await Promise.all([hash(packet.url), hash(packet.body)]);
              if (state.closed) return;
              state.packets.push({ binding_name: params.name,
                context_unique_id: contextUniqueId,
                url_sha256: urlSha, response_sha256: bodySha,
                request_body_key: packet.request_body_key,
                request_sequence: packet.request_sequence });
            })().catch(() => { /* incomplete probe remains unverified */ });
            state.pending.add(pending);
            void pending.finally(() => state.pending.delete(pending));
          }
        } catch { /* no raw payload leaves the worker */ }
      };
      const detach = (source) => { if (source.tabId === state.tabId) state.detached = true; };
      globalThis.__d47PublicCaptureProbe = { expected, state, listener, detach };
      chrome.debugger.onEvent.addListener(listener);
      chrome.debugger.onDetach.addListener(detach);
      return true;
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    assert.equal(installed.result?.value, true, 'public_capture_probe_install_failed');
  } catch (error) {
    try {
      await worker.send('Runtime.evaluate', {
        expression: removeExpression,
        awaitPromise: true,
        returnByValue: true,
      });
    } finally {
      await worker.detach();
    }
    throw error;
  }
  return {
    async attest() {
      const result = await worker.send('Runtime.evaluate', {
        expression: `(async () => {
          const p = globalThis.__d47PublicCaptureProbe;
          if (!p) return false;
          const tabs = await chrome.tabs.query({ url: 'https://hn.algolia.com/*' });
          const exact = tabs.filter(tab => tab.url === p.expected && tab.id === p.state.tabId);
          if (exact.length !== 1) return false;
          const targets = await chrome.debugger.getTargets();
          return p.state.handshake && !p.state.detached &&
            targets.some(target => target.tabId === p.state.tabId && target.attached === true);
        })()`,
        awaitPromise: true,
        returnByValue: true,
      });
      return result.result?.value === true;
    },
    async packets() {
      const result = await worker.send('Runtime.evaluate', {
        expression: `(async () => {
          const state = globalThis.__d47PublicCaptureProbe?.state;
          if (!state || state.closed) return [];
          await Promise.allSettled([...state.pending]);
          return state.closed ? [] : state.packets;
        })()`,
        awaitPromise: true,
        returnByValue: true,
      });
      return result.result?.value ?? [];
    },
    async cleanup() {
      let result;
      try {
        result = await worker.send('Runtime.evaluate', {
          expression: removeExpression,
          awaitPromise: true,
          returnByValue: true,
        });
      } finally {
        await worker.detach();
      }
      assert.equal(result.result?.value, true, 'public_capture_probe_cleanup_unverified');
    },
  };
}

export async function createPublicRacePreflight(page, report, expectedPath, timeoutMs = 20000) {
  assert.ok(searchPaths.has(expectedPath), 'public_race_capture_endpoint_unverified');
  const cdp = await page.context().newCDPSession(page);
  const facts = {
    paused: [],
    contexts: [],
    release_order: [],
    release_attempts: [],
    cleanup_attempts: [],
    unmatched_target_count: 0,
    network_event_count: 0,
    fetch_event_count: 0,
    pause_rejections: {
      non_target: 0,
      target_without_response: 0,
      target_without_network: 0,
      target_outside_main_frame: 0,
      target_unexpected_status_or_extra: 0,
      target_duplicate_prior_document: 0,
      target_not_active_main_document: 0,
      target_current_identity_mismatch: 0,
      target_body_unavailable: 0,
    },
    continuation_rejections: { non_target: 0, target: 0 },
    cleanup: 'pending',
    old_paused_before_replay: false,
    extension_capture_at_current_pause: false,
    current_binding_matches_response: false,
    terminal_outcome: 'unverified',
    capture_probe_cleanup: 'pending',
  };
  report.public_race_preflight = facts;
  const requests = new Map();
  const held = new Map();
  const slots = [];
  const terminal = new Map();
  const passthrough = new Set();
  let enabled = false;
  let mainFrame;
  let activeLoader;
  let closed = false;
  const onRequest = (event) => {
    if (closed) return;
    facts.network_event_count++;
    if (event.requestId)
      requests.set(
        event.requestId,
        event.frameId === mainFrame
          ? { frame_id: mainFrame, loader_id: event.loaderId }
          : { frame_id: null, loader_id: null },
      );
  };
  const onContext = ({ context }) => {
    if (closed) return;
    if (context.auxData?.isDefault && context.auxData.frameId === mainFrame && context.uniqueId)
      facts.contexts.push({
        unique_id: context.uniqueId,
        frame_id: mainFrame,
        loader_id: activeLoader,
      });
  };
  const onFrame = ({ frame }) => {
    if (closed) return;
    if (frame.id === mainFrame) activeLoader = frame.loaderId;
  };
  const onTerminal =
    (kind) =>
    ({ requestId }) => {
      if (closed) return;
      terminal.set(requestId, kind);
      for (const item of facts.paused) if (item.network_id === requestId) item.lifecycle = kind;
    };
  const onFinished = onTerminal('finished');
  const onFailed = onTerminal('failed');
  const continueUnmatched = (requestId, target) => {
    const pending = cdp.send('Fetch.continueRequest', { requestId }).catch(() => {
      if (closed) return;
      facts.continuation_rejections[target ? 'target' : 'non_target']++;
    });
    passthrough.add(pending);
    void pending.finally(() => passthrough.delete(pending));
  };
  const onPaused = async (event) => {
    if (closed) return;
    facts.fetch_event_count++;
    const network = requests.get(event.networkId);
    const identity = publicRaceRequestIdentity(event.request, expectedPath);
    const target = identity !== null;
    if (
      !target ||
      event.responseStatusCode === undefined ||
      !network ||
      network.frame_id !== mainFrame
    ) {
      const reason = !target
        ? 'non_target'
        : event.responseStatusCode === undefined
          ? 'target_without_response'
          : !network
            ? 'target_without_network'
            : 'target_outside_main_frame';
      facts.pause_rejections[reason]++;
      if (target) facts.unmatched_target_count++;
      // Fetch pauses every Algolia response matching the domain pattern. Every
      // non-target must be resumed immediately, without modifying it.
      continueUnmatched(event.requestId, target);
      return;
    }
    const item = {
      ...identity,
      network_id: event.networkId,
      frame_id: network.frame_id,
      loader_id: network.loader_id,
      status: event.responseStatusCode,
      lifecycle: terminal.get(event.networkId) ?? 'pending',
    };
    if (item.status !== 200) {
      facts.pause_rejections.target_unexpected_status_or_extra++;
      facts.unmatched_target_count++;
      continueUnmatched(event.requestId, target);
      return;
    }
    if (slots.length > 0 && item.loader_id === slots[0].loader_id) {
      facts.pause_rejections.target_duplicate_prior_document++;
      continueUnmatched(event.requestId, target);
      return;
    }
    if (item.loader_id !== activeLoader) {
      facts.pause_rejections.target_not_active_main_document++;
      facts.unmatched_target_count++;
      continueUnmatched(event.requestId, target);
      return;
    }
    if (slots.length >= 2) {
      facts.pause_rejections.target_unexpected_status_or_extra++;
      facts.unmatched_target_count++;
      continueUnmatched(event.requestId, target);
      return;
    }
    if (slots.length === 1 && item.identity_sha256 !== slots[0].identity_sha256) {
      facts.pause_rejections.target_current_identity_mismatch++;
      facts.unmatched_target_count++;
      continueUnmatched(event.requestId, target);
      return;
    }
    // Reserve by Network loader before the asynchronous response-body read.
    // The public page can issue another matching request from its old document
    // while the first body is still being read.
    slots.push(item);
    held.set(event.requestId, item);
    try {
      const response = await cdp.send('Fetch.getResponseBody', { requestId: event.requestId });
      if (typeof response?.body !== 'string' || typeof response?.base64Encoded !== 'boolean')
        throw new Error('public_race_response_body_unavailable');
      if (
        response.base64Encoded &&
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(response.body)
      )
        throw new Error('public_race_response_body_encoding_invalid');
      const bytes = Buffer.from(response.body, response.base64Encoded ? 'base64' : 'utf8');
      if (closed) return;
      item.response_sha256 = digest(bytes);
      while (slots[facts.paused.length]?.response_sha256)
        facts.paused.push(slots[facts.paused.length]);
    } catch {
      if (closed) return;
      facts.pause_rejections.target_body_unavailable++;
      facts.unmatched_target_count++;
      held.delete(event.requestId);
      continueUnmatched(event.requestId, target);
    }
  };
  cdp.on('Network.requestWillBeSent', onRequest);
  cdp.on('Runtime.executionContextCreated', onContext);
  cdp.on('Page.frameNavigated', onFrame);
  cdp.on('Network.loadingFinished', onFinished);
  cdp.on('Network.loadingFailed', onFailed);
  cdp.on('Fetch.requestPaused', onPaused);
  const wait = async (predicate, code) => {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (Date.now() >= deadline) throw new Error(code);
      await new Promise((done) => setTimeout(done, 50));
    }
  };
  const release = async (index, name) => {
    const entry = [...held.entries()].find(([, item]) => item === facts.paused[index]);
    if (!entry) {
      facts.release_attempts.push({ step: name, outcome: 'not_held' });
      return false;
    }
    try {
      await cdp.send('Fetch.continueRequest', { requestId: entry[0] });
      held.delete(entry[0]);
      facts.release_order.push(name);
      facts.release_attempts.push({ step: name, outcome: 'continued' });
      return true;
    } catch (error) {
      // Chrome may already have canceled this old-document request during the
      // replay's navigation. A recorded loadingFailed is its terminal state.
      if (entry[1].lifecycle === 'failed') held.delete(entry[0]);
      facts.release_attempts.push({
        step: name,
        outcome: 'cdp_rejected',
        error_category: publicCdpFailureCategory(error),
      });
      return false;
    }
  };
  try {
    await cdp.send('Network.enable');
    await cdp.send('Page.enable');
    const frameTree = (await cdp.send('Page.getFrameTree')).frameTree;
    mainFrame = frameTree.frame.id;
    activeLoader = frameTree.frame.loaderId;
    await cdp.send('Runtime.enable');
    await wait(
      () => facts.contexts.some((context) => context.loader_id === activeLoader),
      'public_race_initial_context_missing',
    );
    // Response-stage interception delays real bytes only. No fulfill/fail
    // command, mock body, header edit, or request-stage interception is used.
    enabled = true;
    await cdp.send('Fetch.enable', {
      patterns: [...searchHosts].map((host) => ({
        urlPattern: `https://${host}/*`,
        requestStage: 'Response',
      })),
    });
  } catch (error) {
    await cleanup();
    throw error;
  }
  async function cleanup() {
    if (closed) return;
    closed = true;
    // A body read may still settle after teardown. It owns a held request, which
    // we continue below, but its continuation must not append a late receipt.
    cdp.off('Network.requestWillBeSent', onRequest);
    cdp.off('Runtime.executionContextCreated', onContext);
    cdp.off('Page.frameNavigated', onFrame);
    cdp.off('Network.loadingFinished', onFinished);
    cdp.off('Network.loadingFailed', onFailed);
    cdp.off('Fetch.requestPaused', onPaused);
    let ok = true;
    for (const requestId of held.keys()) {
      const item = held.get(requestId);
      const step =
        item === facts.paused[0]
          ? 'old'
          : item === facts.paused[1]
            ? 'current'
            : 'unclassified_held_response';
      try {
        await cdp.send('Fetch.continueRequest', { requestId });
        facts.cleanup_attempts.push({ step, outcome: 'continued' });
      } catch (error) {
        ok = false;
        facts.cleanup_attempts.push({
          step,
          outcome: 'cdp_rejected',
          error_category: publicCdpFailureCategory(error),
        });
      }
    }
    held.clear();
    await Promise.allSettled([...passthrough]);
    if (enabled) {
      try {
        await cdp.send('Fetch.disable');
        facts.cleanup_attempts.push({ step: 'disable', outcome: 'completed' });
      } catch (error) {
        ok = false;
        facts.cleanup_attempts.push({
          step: 'disable',
          outcome: 'cdp_rejected',
          error_category: publicCdpFailureCategory(error),
        });
      }
    }
    try {
      await cdp.detach();
      facts.cleanup_attempts.push({ step: 'detach', outcome: 'completed' });
    } catch (error) {
      ok = false;
      facts.cleanup_attempts.push({
        step: 'detach',
        outcome: 'cdp_rejected',
        error_category: publicCdpFailureCategory(error),
      });
    }
    facts.cleanup = ok ? 'disabled_detached' : 'unverified';
  }
  return {
    facts,
    async oldPaused() {
      await wait(() => facts.paused.length >= 1, 'public_race_old_response_missing');
      assert.equal(facts.paused.length, 1, 'public_race_old_ambiguous');
      await wait(
        () => facts.contexts.some((context) => context.loader_id === facts.paused[0].loader_id),
        'public_race_old_context_missing',
      );
    },
    async currentPaused() {
      await wait(() => facts.paused.length >= 2, 'public_race_current_response_missing');
      assert.equal(facts.paused.length, 2, 'public_race_current_ambiguous');
      assert.equal(
        facts.paused[1].loader_id,
        activeLoader,
        'public_race_current_not_active_main_document',
      );
      await wait(
        () => facts.contexts.some((context) => context.loader_id === facts.paused[1].loader_id),
        'public_race_current_context_missing',
      );
    },
    async releaseInOrder() {
      const old = await release(0, 'old');
      assert.equal(
        facts.paused[1]?.loader_id,
        activeLoader,
        'public_race_current_not_active_at_release',
      );
      const current = await release(1, 'current');
      if (!current) throw new Error('public_race_current_release_failed');
      await wait(
        () => facts.paused.every((item) => item.lifecycle !== 'pending'),
        'public_race_lifecycle_missing',
      );
      if (!old && facts.paused[0].lifecycle !== 'failed')
        throw new Error('public_race_old_release_unclassified');
    },
    cleanup,
  };
}
