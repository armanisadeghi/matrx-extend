import assert from 'node:assert/strict';
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
  const sandbox = {
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
      listener({ tabId: 47 }, 'Runtime.bindingCalled', {
        name: '__matrx_capture_current',
        payload: '{"__matrx_capture_hook":"network-tap"}',
      });
    assert.equal(await probe.attest(), true);
    attached = false;
    assert.equal(await probe.attest(), false);
    attached = true;
    for (const listener of detachers) listener({ tabId: 47 });
    assert.equal(await probe.attest(), false);
  } finally {
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
    controller.facts.active_replay_at_old_pause = true;
    controller.facts.extension_capture_at_old_pause = true;
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
  assert.equal(assessPublicRacePreflight(controller.facts), 'timing_interception_feasible');
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
      throw new Error(`Invalid Interception id https://private.example/?token=secret`);
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
  await assert.rejects(controller.releaseInOrder(), /public_race_release_failed/);
  await controller.cleanup();
  assert.deepEqual(controller.facts.release_attempts, [
    { step: 'old', outcome: 'cdp_rejected', error_category: 'request_no_longer_intercepted' },
    { step: 'current', outcome: 'continued' },
  ]);
  assert.deepEqual(controller.facts.release_order, ['current']);
  assert.deepEqual(
    calls.filter((call) => call.method === 'Fetch.continueRequest').map((call) => call.requestId),
    ['hold-old', 'hold-new', 'hold-old'],
  );
  assert.equal(calls.at(-2).method, 'Fetch.disable');
  assert.equal(calls.at(-1).method, 'detach');
  assert.equal(controller.facts.cleanup, 'unverified');
  assert.equal(assessPublicRacePreflight(controller.facts), 'unverified');
  assert.equal(JSON.stringify(report).includes('private.example'), false);
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
  unmatched_target_count: 0,
  cleanup: 'disabled_detached',
  active_replay_at_old_pause: true,
  extension_capture_at_old_pause: true,
  capture_probe_cleanup: 'removed_detached',
};

test('preflight requires two matching real request identities, new document and delivery lifecycle', () => {
  const mutants = [
    { paused: valid.paused.slice(0, 1) },
    { paused: [{ ...valid.paused[0], lifecycle: 'failed' }, valid.paused[1]] },
    { paused: [valid.paused[0], { ...valid.paused[1], identity_sha256: 'different' }] },
    { paused: [valid.paused[0], { ...valid.paused[1], loader_id: 'old' }] },
    { contexts: [valid.contexts[0], { ...valid.contexts[1], unique_id: 'old-context' }] },
    { release_order: ['current', 'old'] },
    { unmatched_target_count: 1 },
    { cleanup: 'unverified' },
    { active_replay_at_old_pause: false },
    { extension_capture_at_old_pause: false },
    { capture_probe_cleanup: 'unverified' },
    { paused: [{ ...valid.paused[0], response_sha256: undefined }, valid.paused[1]] },
  ];
  const cases = [valid, ...mutants.map((mutant) => ({ ...valid, ...mutant }))];
  const expected = ['timing_interception_feasible', ...mutants.map(() => 'unverified')];
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
    "export function assessPublicRacePreflight(facts) { return 'timing_interception_feasible';",
  );
  const noLease = await load('facts.extension_capture_at_old_pause !== true ||', 'false ||');
  const noDigest = await load(
    "facts.paused.some((item) => !/^[a-f0-9]{64}$/.test(item.response_sha256 ?? '')) ||",
    'false ||',
  );
  const checks = [
    [constant, { ...valid, extension_capture_at_old_pause: false }],
    [noLease, { ...valid, extension_capture_at_old_pause: false }],
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
