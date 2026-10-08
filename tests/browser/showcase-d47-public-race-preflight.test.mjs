import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import {
  assessPublicRacePreflight,
  createPublicRacePreflight,
  installPublicCaptureProbe,
  publicCdpFailureCategory,
  publicRaceRequestIdentity,
} from './showcase-d47-public-race-preflight.mjs';

const request = {
  url: 'https://uj5wyc0l7x-dsn.algolia.net/1/indexes/Item_dev/query?x-algolia-api-key=private',
  method: 'POST',
  postData: '{"query":"OpenAI"}',
};

test('routed public scenario starts the old page request before Run and never navigates again', async () => {
  const source = await readFile(
    new URL('./showcase-d47-public-initial-load.mjs', import.meta.url),
    'utf8',
  );
  const check = (text) => {
    const prior = text.indexOf("await resourceAction(() => page.reload({ waitUntil: 'commit' }))");
    const old = text.indexOf('await interception.oldPaused()', prior);
    const run = text.indexOf("semanticTitle: 'Run pattern'", old);
    const current = text.indexOf('await interception.currentPaused()', run);
    assert.ok(
      prior >= 0 && prior < old && old < run && run < current,
      'prior_document_must_precede_new_saved_replay',
    );
    assert.doesNotMatch(
      text.slice(run, current),
      /page\.(?:goto|reload)\(/,
      'new_replay_must_own_its_single_navigation',
    );
  };
  check(source);
  assert.throws(
    () => check(source.replace('await interception.oldPaused();', '')),
    /prior_document_must_precede_new_saved_replay/,
  );
  assert.throws(
    () =>
      check(
        source.replace(
          'await interception.currentPaused();',
          'await page.goto(pageUrl); await interception.currentPaused();',
        ),
      ),
    /new_replay_must_own_its_single_navigation/,
  );
});

test('public response identity is exact across URL and body without exposing either', () => {
  const identity = publicRaceRequestIdentity(request);
  assert.match(identity.identity_sha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(identity).includes('private'), false);
  assert.equal(JSON.stringify(identity).includes('OpenAI'), false);
  assert.notEqual(
    publicRaceRequestIdentity({ ...request, postData: '{"query":"Other"}' }).identity_sha256,
    identity.identity_sha256,
  );
  assert.notEqual(
    publicRaceRequestIdentity({ ...request, url: `${request.url}2` }).identity_sha256,
    identity.identity_sha256,
  );
  assert.equal(publicRaceRequestIdentity({ ...request, method: 'GET' }), null);
  assert.equal(
    publicRaceRequestIdentity({ ...request, url: 'https://localhost/1/indexes/Item_dev/query' }),
    null,
  );
  assert.equal(publicRaceRequestIdentity({ ...request, postData: undefined }), null);
});

test('CDP failure categories never retain URLs, credentials, or raw messages', () => {
  const secret = 'https://private.example/?token=secret';
  assert.equal(
    publicCdpFailureCategory(
      new Error(`Protocol error (Fetch.continueRequest): Invalid Interception id ${secret}`),
    ),
    'request_no_longer_intercepted',
  );
  assert.equal(publicCdpFailureCategory(new Error(`unexpected ${secret}`)), 'other_cdp_failure');
  assert.equal(
    publicCdpFailureCategory(new Error(`Target closed ${secret}`)),
    'cdp_session_closed',
  );
  assert.equal(
    publicCdpFailureCategory(new Error(`net::ERR_ABORTED ${secret}`)),
    'request_cancelled',
  );
  assert.equal(publicCdpFailureCategory(new Error(`Timed out ${secret}`)), 'cdp_timeout');
  assert.equal(JSON.stringify(publicCdpFailureCategory(new Error(secret))).includes(secret), false);
});

test('extension capture proof requires its own hook and an attached owned tab', async () => {
  const listeners = new Set();
  const detachers = new Set();
  let attached = true;
  let detached = false;
  const events = {
    addListener: (listener) => listeners.add(listener),
    removeListener: (listener) => listeners.delete(listener),
    hasListener: (listener) => listeners.has(listener),
  };
  const detachEvents = {
    addListener: (listener) => detachers.add(listener),
    removeListener: (listener) => detachers.delete(listener),
    hasListener: (listener) => detachers.has(listener),
  };
  let holdDigests = false;
  const digestReleases = [];
  const sandbox = {
    crypto: {
      subtle: {
        digest: async (...args) => {
          if (holdDigests) await new Promise((resolve) => digestReleases.push(resolve));
          return webcrypto.subtle.digest(...args);
        },
      },
    },
    TextEncoder,
    chrome: {
      tabs: { query: async () => [{ id: 47, url: 'https://hn.algolia.com/?q=OpenAI' }] },
      debugger: {
        onEvent: events,
        onDetach: detachEvents,
        getTargets: async () => [{ tabId: 47, attached }],
      },
    },
  };
  sandbox.globalThis = sandbox;
  const worker = {
    send: async (method, args) =>
      method === 'Runtime.enable'
        ? {}
        : { result: { value: await runInNewContext(args.expression, sandbox) } },
    detach: async () => {
      detached = true;
    },
  };
  const probe = await installPublicCaptureProbe(worker, 'https://hn.algolia.com/?q=OpenAI');
  try {
    assert.equal(await probe.attest(), false);
    for (const listener of listeners)
      listener({ tabId: 47 }, 'Runtime.executionContextCreated', {
        context: { id: 9, uniqueId: 'current-context', auxData: { isDefault: true } },
      });
    for (const listener of listeners)
      listener({ tabId: 47 }, 'Runtime.bindingCalled', {
        name: '__matrx_capture_current',
        executionContextId: 9,
        payload: '{"__matrx_capture_hook":"network-tap"}',
      });
    assert.equal(await probe.attest(), true);
    for (const listener of listeners)
      listener({ tabId: 47 }, 'Runtime.bindingCalled', {
        name: '__matrx_capture_current',
        executionContextId: 9,
        payload: JSON.stringify({
          method: 'POST',
          status: 200,
          url: request.url,
          body: '{"hits":[]}',
          request_body_key: 'sha256:body',
          request_sequence: 1,
          body_truncated: false,
        }),
      });
    assert.deepEqual(JSON.parse(JSON.stringify(await probe.packets())), [
      {
        binding_name: '__matrx_capture_current',
        context_unique_id: 'current-context',
        url_sha256: createHash('sha256').update(request.url).digest('hex'),
        response_sha256: createHash('sha256').update('{"hits":[]}').digest('hex'),
        request_body_key: 'sha256:body',
        request_sequence: 1,
      },
    ]);
    attached = false;
    assert.equal(await probe.attest(), false);
    attached = true;
    for (const listener of detachers) listener({ tabId: 47 });
    assert.equal(await probe.attest(), false);
    holdDigests = true;
    const state = sandbox.__d47PublicCaptureProbe.state;
    for (const listener of listeners)
      listener({ tabId: 47 }, 'Runtime.bindingCalled', {
        name: '__matrx_capture_current',
        executionContextId: 9,
        payload: JSON.stringify({
          method: 'POST',
          status: 200,
          url: request.url,
          body: '{"hits":[]}',
          request_body_key: 'sha256:body',
          request_sequence: 2,
        }),
      });
    assert.equal(digestReleases.length, 2);
    let cleaned = false;
    const cleanup = probe.cleanup().then(() => {
      cleaned = true;
    });
    assert.equal(state.closed, true);
    assert.equal(cleaned, false);
    for (const release of digestReleases) release();
    await cleanup;
    assert.equal(state.packets.length, 1, 'closed probe cannot publish a late digest');
    assert.equal(state.pending.size, 0);
  } finally {
    for (const release of digestReleases) release();
    await probe.cleanup();
  }
  assert.equal(detached, true);
  assert.equal(listeners.size, 0);
  assert.equal(detachers.size, 0);
});

test('controller continues original paused responses in order and disables interception', async () => {
  const cdp = new EventEmitter();
  const calls = [];
  cdp.send = async (method, args) => {
    calls.push({ method, args });
    if (method === 'Page.getFrameTree')
      return { frameTree: { frame: { id: 'main', loaderId: 'initial' } } };
    if (method === 'Runtime.enable')
      setTimeout(
        () =>
          cdp.emit('Runtime.executionContextCreated', {
            context: { uniqueId: 'initial-context', auxData: { isDefault: true, frameId: 'main' } },
          }),
        0,
      );
    if (method === 'Fetch.getResponseBody')
      return {
        body: args.requestId === 'hold-old' ? '{"hits":[]}' : '{"hits":[{"id":47}]}',
        base64Encoded: false,
      };
    if (method === 'Fetch.continueRequest')
      cdp.emit('Network.loadingFinished', {
        requestId: args.requestId === 'hold-old' ? 'old' : 'new',
      });
    return {};
  };
  cdp.detach = async () => {
    calls.push({ method: 'detach' });
  };
  const controller = await createPublicRacePreflight(
    { context: () => ({ newCDPSession: async () => cdp }) },
    {},
    '/1/indexes/Item_dev/query',
    500,
  );
  try {
    assert.deepEqual(
      calls
        .find((call) => call.method === 'Fetch.enable')
        .args.patterns.map((pattern) => pattern.requestStage),
      ['Response', 'Response', 'Response', 'Response'],
    );
    const pause = (name) => {
      cdp.emit('Page.frameNavigated', { frame: { id: 'main', loaderId: name } });
      cdp.emit('Runtime.executionContextCreated', {
        context: { uniqueId: `${name}-context`, auxData: { isDefault: true, frameId: 'main' } },
      });
      cdp.emit('Network.requestWillBeSent', { requestId: name, frameId: 'main', loaderId: name });
      cdp.emit('Fetch.requestPaused', {
        requestId: `hold-${name}`,
        networkId: name,
        responseStatusCode: 200,
        request,
      });
    };
    pause('old');
    await controller.oldPaused();
    pause('new');
    await controller.currentPaused();
    controller.facts.old_paused_before_replay = true;
    controller.facts.extension_capture_at_current_pause = true;
    controller.facts.current_binding_matches_response = true;
    controller.facts.terminal_outcome = 'captured_initial_request';
    await controller.releaseInOrder();
  } finally {
    await controller.cleanup();
  }
  controller.facts.capture_probe_cleanup = 'removed_detached';
  assert.deepEqual(
    calls
      .filter((call) => call.method === 'Fetch.continueRequest')
      .map((call) => call.args.requestId),
    ['hold-old', 'hold-new'],
  );
  assert.equal(
    calls.some((call) => call.method === 'Fetch.fulfillRequest'),
    false,
  );
  assert.equal(calls.at(-2).method, 'Fetch.disable');
  assert.equal(calls.at(-1).method, 'detach');
  assert.notEqual(
    controller.facts.paused[0].response_sha256,
    controller.facts.paused[1].response_sha256,
  );
  assert.deepEqual(
    calls
      .filter((call) => call.method === 'Fetch.getResponseBody')
      .map((call) => call.args.requestId),
    ['hold-old', 'hold-new'],
  );
  assert.equal(
    assessPublicRacePreflight(controller.facts),
    'prior_document_released_current_verified',
  );
});

test('a second prior-document response cannot occupy the current-document slot', async () => {
  const cdp = new EventEmitter();
  const continued = [];
  cdp.send = async (method, args) => {
    if (method === 'Page.getFrameTree')
      return { frameTree: { frame: { id: 'main', loaderId: 'initial' } } };
    if (method === 'Runtime.enable')
      queueMicrotask(() =>
        cdp.emit('Runtime.executionContextCreated', {
          context: { uniqueId: 'initial-context', auxData: { isDefault: true, frameId: 'main' } },
        }),
      );
    if (method === 'Fetch.getResponseBody') return { body: '{"hits":[]}', base64Encoded: false };
    if (method === 'Fetch.continueRequest') continued.push(args.requestId);
    return {};
  };
  cdp.detach = async () => {};
  const controller = await createPublicRacePreflight(
    { context: () => ({ newCDPSession: async () => cdp }) },
    {},
    '/1/indexes/Item_dev/query',
    100,
  );
  const pause = (networkId, loaderId) => {
    cdp.emit('Network.requestWillBeSent', { requestId: networkId, frameId: 'main', loaderId });
    cdp.emit('Fetch.requestPaused', {
      requestId: `hold-${networkId}`,
      networkId,
      responseStatusCode: 200,
      request,
    });
  };
  try {
    cdp.emit('Page.frameNavigated', { frame: { id: 'main', loaderId: 'old' } });
    cdp.emit('Runtime.executionContextCreated', {
      context: { uniqueId: 'old-context', auxData: { isDefault: true, frameId: 'main' } },
    });
    pause('old-first', 'old');
    await controller.oldPaused();
    pause('old-second', 'old');
    cdp.emit('Page.frameNavigated', { frame: { id: 'main', loaderId: 'current' } });
    cdp.emit('Runtime.executionContextCreated', {
      context: { uniqueId: 'current-context', auxData: { isDefault: true, frameId: 'main' } },
    });
    pause('new', 'current');
    await controller.currentPaused();
    pause('old-third', 'old');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(controller.facts.paused[1].loader_id, 'current');
    assert.equal(controller.facts.unmatched_target_count, 0);
    assert.ok(continued.includes('hold-old-second'));
    assert.ok(continued.includes('hold-old-third'));
    assert.equal(controller.facts.pause_rejections.target_duplicate_prior_document, 2);
  } finally {
    await controller.cleanup();
  }
});

test('missing old response records the first failing CDP boundary without exposing traffic', async () => {
  const observe = async (networkSeen, bodyAvailable) => {
    const cdp = new EventEmitter();
    cdp.send = async (method) => {
      if (method === 'Page.getFrameTree')
        return { frameTree: { frame: { id: 'main', loaderId: 'initial' } } };
      if (method === 'Runtime.enable')
        queueMicrotask(() =>
          cdp.emit('Runtime.executionContextCreated', {
            context: { uniqueId: 'initial-context', auxData: { isDefault: true, frameId: 'main' } },
          }),
        );
      if (method === 'Fetch.getResponseBody') {
        if (!bodyAvailable) throw new Error(`Body unavailable ${request.url}`);
        return { body: '{"hits":[]}', base64Encoded: false };
      }
      return {};
    };
    cdp.detach = async () => {};
    const controller = await createPublicRacePreflight(
      { context: () => ({ newCDPSession: async () => cdp }) },
      {},
      '/1/indexes/Item_dev/query',
      20,
    );
    if (networkSeen)
      cdp.emit('Network.requestWillBeSent', {
        requestId: 'old',
        frameId: 'main',
        loaderId: 'initial',
      });
    cdp.emit('Fetch.requestPaused', {
      requestId: 'hold-old',
      networkId: 'old',
      responseStatusCode: 200,
      request,
    });
    await assert.rejects(controller.oldPaused(), /public_race_old_response_missing/);
    await controller.cleanup();
    assert.equal(controller.facts.paused.length, 0);
    assert.equal(controller.facts.unmatched_target_count, 1);
    assert.equal(controller.facts.fetch_event_count, 1);
    assert.equal(controller.facts.network_event_count, Number(networkSeen));
    assert.equal(JSON.stringify(controller.facts).includes('private'), false);
    assert.equal(assessPublicRacePreflight(controller.facts), 'unverified');
    return controller.facts.pause_rejections;
  };
  const noNetwork = await observe(false, true);
  const noBody = await observe(true, false);
  assert.equal(noNetwork.target_without_network, 1);
  assert.equal(noNetwork.target_body_unavailable, 0);
  assert.equal(noBody.target_without_network, 0);
  assert.equal(noBody.target_body_unavailable, 1);
});

test('observed non-main-frame target is distinct from absent Network identity', async () => {
  const cdp = new EventEmitter();
  cdp.send = async (method) => {
    if (method === 'Page.getFrameTree')
      return { frameTree: { frame: { id: 'main', loaderId: 'initial' } } };
    if (method === 'Runtime.enable')
      queueMicrotask(() =>
        cdp.emit('Runtime.executionContextCreated', {
          context: { uniqueId: 'initial-context', auxData: { isDefault: true, frameId: 'main' } },
        }),
      );
    return {};
  };
  cdp.detach = async () => {};
  const controller = await createPublicRacePreflight(
    { context: () => ({ newCDPSession: async () => cdp }) },
    {},
    '/1/indexes/Item_dev/query',
    20,
  );
  cdp.emit('Network.requestWillBeSent', {
    requestId: 'child-network',
    frameId: 'child-private',
    loaderId: 'child-loader-private',
  });
  cdp.emit('Fetch.requestPaused', {
    requestId: 'child-fetch',
    networkId: 'child-network',
    responseStatusCode: 200,
    request,
  });
  await assert.rejects(controller.oldPaused(), /public_race_old_response_missing/);
  await controller.cleanup();
  assert.equal(controller.facts.pause_rejections.target_outside_main_frame, 1);
  assert.equal(controller.facts.pause_rejections.target_without_network, 0);
  assert.equal(controller.facts.unmatched_target_count, 1);
  assert.equal(JSON.stringify(controller.facts).includes('child-private'), false);
  assert.equal(JSON.stringify(controller.facts).includes('private'), false);
  assert.equal(assessPublicRacePreflight(controller.facts), 'unverified');
});

test('continuation rejection counts target and non-target pauses separately', async () => {
  for (const target of [false, true]) {
    const cdp = new EventEmitter();
    cdp.send = async (method, args) => {
      if (method === 'Page.getFrameTree')
        return { frameTree: { frame: { id: 'main', loaderId: 'initial' } } };
      if (method === 'Runtime.enable')
        queueMicrotask(() =>
          cdp.emit('Runtime.executionContextCreated', {
            context: { uniqueId: 'initial-context', auxData: { isDefault: true, frameId: 'main' } },
          }),
        );
      if (method === 'Fetch.continueRequest' && args.requestId === 'rejected')
        throw new Error(`Rejected continuation ${request.url}`);
      return {};
    };
    cdp.detach = async () => {};
    const controller = await createPublicRacePreflight(
      { context: () => ({ newCDPSession: async () => cdp }) },
      {},
      '/1/indexes/Item_dev/query',
      20,
    );
    cdp.emit('Fetch.requestPaused', {
      requestId: 'rejected',
      networkId: 'other',
      responseStatusCode: 200,
      request: target ? request : { ...request, method: 'GET' },
    });
    await assert.rejects(controller.oldPaused(), /public_race_old_response_missing/);
    await controller.cleanup();
    assert.equal(
      controller.facts.pause_rejections[target ? 'target_without_network' : 'non_target'],
      1,
    );
    assert.deepEqual(controller.facts.continuation_rejections, {
      non_target: Number(!target),
      target: Number(target),
    });
    assert.equal(controller.facts.unmatched_target_count, Number(target));
    assert.equal(JSON.stringify(controller.facts).includes('private'), false);
    assert.equal(assessPublicRacePreflight(controller.facts), 'unverified');
  }
});

test('canceled old release still attempts current release and every owned cleanup step', async () => {
  const cdp = new EventEmitter();
  const calls = [];
  cdp.send = async (method, args = {}) => {
    calls.push({ method, requestId: args.requestId });
    if (method === 'Page.getFrameTree')
      return { frameTree: { frame: { id: 'main', loaderId: 'initial' } } };
    if (method === 'Runtime.enable')
      queueMicrotask(() =>
        cdp.emit('Runtime.executionContextCreated', {
          context: { uniqueId: 'initial-context', auxData: { isDefault: true, frameId: 'main' } },
        }),
      );
    if (method === 'Fetch.getResponseBody') return { body: '{"hits":[]}', base64Encoded: false };
    if (method === 'Fetch.continueRequest' && args.requestId === 'hold-old')
      throw new Error('Invalid Interception id https://private.example/?token=secret');
    if (method === 'Fetch.continueRequest' && args.requestId === 'hold-new')
      cdp.emit('Network.loadingFinished', { requestId: 'new' });
    return {};
  };
  cdp.detach = async () => {
    calls.push({ method: 'detach' });
  };
  const report = {};
  const controller = await createPublicRacePreflight(
    { context: () => ({ newCDPSession: async () => cdp }) },
    report,
    '/1/indexes/Item_dev/query',
    500,
  );
  const pause = (name) => {
    cdp.emit('Page.frameNavigated', { frame: { id: 'main', loaderId: name } });
    cdp.emit('Runtime.executionContextCreated', {
      context: { uniqueId: `${name}-context`, auxData: { isDefault: true, frameId: 'main' } },
    });
    cdp.emit('Network.requestWillBeSent', { requestId: name, frameId: 'main', loaderId: name });
    cdp.emit('Fetch.requestPaused', {
      requestId: `hold-${name}`,
      networkId: name,
      responseStatusCode: 200,
      request,
    });
  };
  pause('old');
  await controller.oldPaused();
  pause('new');
  await controller.currentPaused();
  cdp.emit('Network.loadingFailed', { requestId: 'old' });
  await controller.releaseInOrder();
  await controller.cleanup();
  assert.deepEqual(controller.facts.release_attempts, [
    { step: 'old', outcome: 'cdp_rejected', error_category: 'request_no_longer_intercepted' },
    { step: 'current', outcome: 'continued' },
  ]);
  assert.deepEqual(controller.facts.release_order, ['current']);
  assert.deepEqual(
    calls.filter((call) => call.method === 'Fetch.continueRequest').map((call) => call.requestId),
    ['hold-old', 'hold-new'],
  );
  assert.equal(calls.at(-2).method, 'Fetch.disable');
  assert.equal(calls.at(-1).method, 'detach');
  assert.equal(controller.facts.cleanup, 'disabled_detached');
  assert.equal(assessPublicRacePreflight(controller.facts), 'unverified');
  assert.equal(JSON.stringify(report).includes('private.example'), false);
});

test('a response body resolving or rejecting after cleanup cannot append a late pause observation', async () => {
  for (const settlement of ['resolve', 'reject']) {
    const cdp = new EventEmitter();
    const calls = [];
    let settleBody;
    let bodyStarted;
    const bodyStartedPromise = new Promise((resolve) => {
      bodyStarted = resolve;
    });
    const bodyPromise = new Promise((resolve, reject) => {
      settleBody = { resolve, reject };
    });
    cdp.send = async (method, args = {}) => {
      calls.push({ method, requestId: args.requestId });
      if (method === 'Page.getFrameTree')
        return { frameTree: { frame: { id: 'main', loaderId: 'initial' } } };
      if (method === 'Runtime.enable')
        queueMicrotask(() =>
          cdp.emit('Runtime.executionContextCreated', {
            context: { uniqueId: 'initial-context', auxData: { isDefault: true, frameId: 'main' } },
          }),
        );
      if (method === 'Fetch.getResponseBody') {
        bodyStarted();
        return bodyPromise;
      }
      return {};
    };
    cdp.detach = async () => {
      calls.push({ method: 'detach' });
    };
    const controller = await createPublicRacePreflight(
      { context: () => ({ newCDPSession: async () => cdp }) },
      {},
      '/1/indexes/Item_dev/query',
      500,
    );
    cdp.emit('Network.requestWillBeSent', {
      requestId: 'old',
      frameId: 'main',
      loaderId: 'initial',
    });
    cdp.emit('Fetch.requestPaused', {
      requestId: 'hold-old',
      networkId: 'old',
      responseStatusCode: 200,
      request,
    });
    await bodyStartedPromise;
    await controller.cleanup();
    const factsAtCleanup = JSON.stringify(controller.facts);
    if (settlement === 'resolve') settleBody.resolve({ body: '{"hits":[]}', base64Encoded: false });
    else settleBody.reject(new Error('Body unavailable https://private.example/?token=secret'));
    cdp.emit('Network.loadingFinished', { requestId: 'old' });
    assert.equal(JSON.stringify(controller.facts), factsAtCleanup);
    assert.equal(controller.facts.paused.length, 0);
    assert.deepEqual(controller.facts.cleanup_attempts, [
      { step: 'unclassified_held_response', outcome: 'continued' },
      { step: 'disable', outcome: 'completed' },
      { step: 'detach', outcome: 'completed' },
    ]);
    assert.equal(calls.at(-2).method, 'Fetch.disable');
    assert.equal(calls.at(-1).method, 'detach');
    assert.equal(assessPublicRacePreflight(controller.facts), 'unverified');
    assert.equal(controller.facts.cleanup, 'disabled_detached');
    assert.equal(JSON.stringify(controller.facts).includes('private.example'), false);
  }
});

test('disable and detach failures independently preserve later cleanup attempts', async () => {
  for (const failedStep of ['Fetch.disable', 'detach']) {
    const cdp = new EventEmitter();
    const calls = [];
    cdp.send = async (method) => {
      calls.push(method);
      if (method === 'Page.getFrameTree')
        return { frameTree: { frame: { id: 'main', loaderId: 'initial' } } };
      if (method === 'Runtime.enable')
        queueMicrotask(() =>
          cdp.emit('Runtime.executionContextCreated', {
            context: { uniqueId: 'initial-context', auxData: { isDefault: true, frameId: 'main' } },
          }),
        );
      if (method === failedStep)
        throw new Error('Target closed https://private.example/?token=secret');
      return {};
    };
    cdp.detach = async () => {
      calls.push('detach');
      if (failedStep === 'detach')
        throw new Error('Target closed https://private.example/?token=secret');
    };
    const controller = await createPublicRacePreflight(
      { context: () => ({ newCDPSession: async () => cdp }) },
      {},
      '/1/indexes/Item_dev/query',
      500,
    );
    await controller.cleanup();
    assert.deepEqual(calls.slice(-2), ['Fetch.disable', 'detach']);
    assert.equal(controller.facts.cleanup, 'unverified');
    assert.equal(assessPublicRacePreflight(controller.facts), 'unverified');
    assert.equal(JSON.stringify(controller.facts).includes('private.example'), false);
    assert.deepEqual(controller.facts.cleanup_attempts, [
      {
        step: 'disable',
        outcome: failedStep === 'Fetch.disable' ? 'cdp_rejected' : 'completed',
        ...(failedStep === 'Fetch.disable' ? { error_category: 'cdp_session_closed' } : {}),
      },
      {
        step: 'detach',
        outcome: failedStep === 'detach' ? 'cdp_rejected' : 'completed',
        ...(failedStep === 'detach' ? { error_category: 'cdp_session_closed' } : {}),
      },
    ]);
  }
});

const valid = {
  paused: [
    {
      network_id: 'a',
      frame_id: 'main',
      loader_id: 'old',
      identity_sha256: 'same',
      response_sha256: 'a'.repeat(64),
      lifecycle: 'finished',
    },
    {
      network_id: 'b',
      frame_id: 'main',
      loader_id: 'new',
      identity_sha256: 'same',
      response_sha256: 'b'.repeat(64),
      lifecycle: 'finished',
    },
  ],
  contexts: [
    { unique_id: 'old-context', frame_id: 'main', loader_id: 'old' },
    { unique_id: 'new-context', frame_id: 'main', loader_id: 'new' },
  ],
  release_order: ['old', 'current'],
  release_attempts: [
    { step: 'old', outcome: 'continued' },
    { step: 'current', outcome: 'continued' },
  ],
  unmatched_target_count: 0,
  continuation_rejections: { non_target: 0, target: 0 },
  cleanup: 'disabled_detached',
  old_paused_before_replay: true,
  extension_capture_at_current_pause: true,
  capture_probe_cleanup: 'removed_detached',
  current_binding_matches_response: true,
  terminal_outcome: 'captured_initial_request',
};

test('preflight requires two matching real request identities, new document and delivery lifecycle', () => {
  const mutants = [
    { paused: valid.paused.slice(0, 1) },
    {
      paused: [{ ...valid.paused[0], lifecycle: 'failed' }, valid.paused[1]],
      release_attempts: [
        { step: 'old', outcome: 'cdp_rejected' },
        { step: 'current', outcome: 'continued' },
      ],
    },
    { paused: [valid.paused[0], { ...valid.paused[1], identity_sha256: 'different' }] },
    { paused: [valid.paused[0], { ...valid.paused[1], loader_id: 'old' }] },
    { contexts: [valid.contexts[0], { ...valid.contexts[1], unique_id: 'old-context' }] },
    { release_attempts: [...valid.release_attempts].reverse() },
    { unmatched_target_count: 1 },
    { continuation_rejections: { non_target: 0, target: 1 } },
    { cleanup: 'unverified' },
    { old_paused_before_replay: false },
    { extension_capture_at_current_pause: false },
    { current_binding_matches_response: false },
    { terminal_outcome: 'unverified' },
    { capture_probe_cleanup: 'unverified' },
    { paused: [{ ...valid.paused[0], response_sha256: undefined }, valid.paused[1]] },
  ];
  const cases = [valid, ...mutants.map((mutant) => ({ ...valid, ...mutant }))];
  const expected = [
    'prior_document_released_current_verified',
    ...mutants.map((_, index) =>
      index === 1 ? 'prior_document_cancelled_current_verified' : 'unverified',
    ),
  ];
  assert.deepEqual(cases.map(assessPublicRacePreflight), expected);
});

test('actual verdict rejects constant and missing-evidence mutations in memory', async () => {
  const source = await readFile(
    new URL('./showcase-d47-public-race-preflight.mjs', import.meta.url),
    'utf8',
  );
  const load = async (from, to) => {
    assert.ok(source.includes(from), 'mutation_seam_missing');
    const module = await import(
      `data:text/javascript;base64,${Buffer.from(source.replace(from, to)).toString('base64')}`
    );
    return module.assessPublicRacePreflight;
  };
  const constant = await load(
    'export function assessPublicRacePreflight(facts) {',
    "export function assessPublicRacePreflight(facts) { return 'prior_document_released_current_verified';",
  );
  const noLease = await load('facts.extension_capture_at_current_pause !== true ||', 'false ||');
  const noDigest = await load(
    "facts.paused.some((item) => !/^[a-f0-9]{64}$/.test(item.response_sha256 ?? '')) ||",
    'false ||',
  );
  const checks = [
    [constant, { ...valid, extension_capture_at_current_pause: false }],
    [noLease, { ...valid, extension_capture_at_current_pause: false }],
    [
      noDigest,
      { ...valid, paused: [{ ...valid.paused[0], response_sha256: undefined }, valid.paused[1]] },
    ],
  ];
  for (const [mutant, input] of checks) {
    assert.equal(assessPublicRacePreflight(input), 'unverified');
    assert.throws(() => assert.equal(mutant(input), 'unverified'), { name: 'AssertionError' });
  }
});
