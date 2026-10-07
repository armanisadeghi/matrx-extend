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

// Keep URL, query credentials and POST data in memory. Receipts contain only
// hashes and lifecycle identities; the response body is never read or replaced.
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
    facts.active_replay_at_old_pause !== true ||
    facts.unmatched_target_count !== 0 ||
    facts.cleanup !== 'disabled_detached'
  )
    return 'unverified';
  return 'timing_interception_feasible';
}

export async function createPublicRacePreflight(page, report, expectedPath, timeoutMs = 20000) {
  assert.ok(searchPaths.has(expectedPath), 'public_race_capture_endpoint_unverified');
  const cdp = await page.context().newCDPSession(page);
  const facts = {
    paused: [],
    contexts: [],
    release_order: [],
    unmatched_target_count: 0,
    cleanup: 'pending',
    active_replay_at_old_pause: false,
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
    if (event.requestId && event.frameId === mainFrame)
      requests.set(event.requestId, { frame_id: event.frameId, loader_id: event.loaderId });
  };
  const onContext = ({ context }) => {
    if (context.auxData?.isDefault && context.auxData.frameId === mainFrame && context.uniqueId)
      facts.contexts.push({
        unique_id: context.uniqueId,
        frame_id: mainFrame,
        loader_id: activeLoader,
      });
  };
  const onFrame = ({ frame }) => {
    if (frame.id === mainFrame) activeLoader = frame.loaderId;
  };
  const onTerminal =
    (kind) =>
    ({ requestId }) => {
      terminal.set(requestId, kind);
      for (const item of facts.paused) if (item.network_id === requestId) item.lifecycle = kind;
    };
  const onFinished = onTerminal('finished');
  const onFailed = onTerminal('failed');
  const continueUnmatched = (requestId) => {
    const pending = cdp.send('Fetch.continueRequest', { requestId }).catch(() => {
      facts.unmatched_target_count++;
    });
    passthrough.add(pending);
    void pending.finally(() => passthrough.delete(pending));
  };
  const onPaused = (event) => {
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
    facts.paused.push(item);
    held.set(event.requestId, item);
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
    assert.ok(entry, `public_race_${name}_not_held`);
    await cdp.send('Fetch.continueRequest', { requestId: entry[0] });
    held.delete(entry[0]);
    facts.release_order.push(name);
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
    let ok = true;
    for (const requestId of held.keys()) {
      try {
        await cdp.send('Fetch.continueRequest', { requestId });
      } catch {
        ok = false;
      }
    }
    held.clear();
    await Promise.allSettled([...passthrough]);
    if (enabled) {
      try {
        await cdp.send('Fetch.disable');
      } catch {
        ok = false;
      }
    }
    try {
      await cdp.detach();
    } catch {
      ok = false;
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
      await release(0, 'old');
      await release(1, 'current');
      await wait(
        () => facts.paused.every((item) => item.lifecycle !== 'pending'),
        'public_race_lifecycle_missing',
      );
    },
    cleanup,
  };
}
