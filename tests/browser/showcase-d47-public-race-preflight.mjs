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
    facts.release_order.join(',') !== 'old,current' ||
    facts.paused.some((item) => item.lifecycle !== 'finished') ||
    facts.paused.some((item) => !/^[a-f0-9]{64}$/.test(item.response_sha256 ?? '')) ||
    facts.active_replay_at_old_pause !== true ||
    facts.extension_capture_at_old_pause !== true ||
    facts.capture_probe_cleanup !== 'removed_detached' ||
    facts.unmatched_target_count !== 0 ||
    facts.cleanup !== 'disabled_detached'
  )
    return 'unverified';
  return 'timing_interception_feasible';
}

// The worker's chrome.debugger event is the extension-side positive signal.
// Keep the hook nonce and payload inside the worker; only booleans leave it.
export async function installPublicCaptureProbe(worker, pageUrl) {
  const removeExpression = `(() => {
    const p = globalThis.__d47PublicCaptureProbe;
    if (!p) return true;
    chrome.debugger.onEvent.removeListener(p.listener);
    chrome.debugger.onDetach.removeListener(p.detach);
    const removed = !chrome.debugger.onEvent.hasListener(p.listener) &&
      !chrome.debugger.onDetach.hasListener(p.detach);
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
      const state = { tabId: exact[0].id, handshake: false, detached: false };
      const listener = (source, method, params = {}) => {
        if (source.tabId !== state.tabId || source.sessionId || method !== 'Runtime.bindingCalled' ||
            !String(params.name).startsWith('__matrx_capture_')) return;
        try {
          const packet = JSON.parse(params.payload);
          if (packet?.__matrx_capture_hook === 'network-tap') state.handshake = true;
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
      await worker.send('Runtime.evaluate', { expression: removeExpression, returnByValue: true });
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
    async cleanup() {
      let result;
      try {
        result = await worker.send('Runtime.evaluate', {
          expression: removeExpression,
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
    cleanup: 'pending',
    active_replay_at_old_pause: false,
    exact_row_at_old_pause: false,
    running_at_old_pause: false,
    activity_observation_available_at_old_pause: false,
    extension_capture_at_old_pause: false,
    capture_probe_cleanup: 'pending',
  };
  report.public_race_preflight = facts;
  const requests = new Map();
  const held = new Map();
  const terminal = new Map();
  const passthrough = new Set();
  let enabled = false;
  let mainFrame;
  let activeLoader;
  let closed = false;
  const onRequest = (event) => {
    if (closed) return;
    if (event.requestId && event.frameId === mainFrame)
      requests.set(event.requestId, { frame_id: event.frameId, loader_id: event.loaderId });
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
  const continueUnmatched = (requestId) => {
    const pending = cdp.send('Fetch.continueRequest', { requestId }).catch(() => {
      if (!closed) facts.unmatched_target_count++;
    });
    passthrough.add(pending);
    void pending.finally(() => passthrough.delete(pending));
  };
  const onPaused = async (event) => {
    if (closed) return;
    const network = requests.get(event.networkId);
    const identity = publicRaceRequestIdentity(event.request, expectedPath);
    const target = identity !== null;
    if (
      !target ||
      event.responseStatusCode === undefined ||
      !network ||
      network.frame_id !== mainFrame
    ) {
      if (target) facts.unmatched_target_count++;
      // Fetch pauses every Algolia response matching the domain pattern. Every
      // non-target must be resumed immediately, without modifying it.
      continueUnmatched(event.requestId);
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
    if (facts.paused.length >= 2 || item.status !== 200) {
      facts.unmatched_target_count++;
      continueUnmatched(event.requestId);
      return;
    }
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
      facts.paused.push(item);
    } catch {
      if (closed) return;
      facts.unmatched_target_count++;
      held.delete(event.requestId);
      continueUnmatched(event.requestId);
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
      await wait(
        () => facts.contexts.some((context) => context.loader_id === facts.paused[1].loader_id),
        'public_race_current_context_missing',
      );
    },
    async releaseInOrder() {
      const old = await release(0, 'old');
      const current = await release(1, 'current');
      if (!old || !current) throw new Error('public_race_release_failed');
      await wait(
        () => facts.paused.every((item) => item.lifecycle !== 'pending'),
        'public_race_lifecycle_missing',
      );
    },
    cleanup,
  };
}
