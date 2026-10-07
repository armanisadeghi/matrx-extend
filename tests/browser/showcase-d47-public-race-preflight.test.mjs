import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  assessPublicRacePreflight,
  createPublicRacePreflight,
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
    await controller.releaseInOrder();
  } finally {
    await controller.cleanup();
  }
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
  assert.equal(assessPublicRacePreflight(controller.facts), 'timing_interception_feasible');
});

const valid = {
  paused: [
    {
      network_id: 'a',
      frame_id: 'main',
      loader_id: 'old',
      identity_sha256: 'same',
      lifecycle: 'finished',
    },
    {
      network_id: 'b',
      frame_id: 'main',
      loader_id: 'new',
      identity_sha256: 'same',
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
  ];
  const cases = [valid, ...mutants.map((mutant) => ({ ...valid, ...mutant }))];
  const expected = ['timing_interception_feasible', ...mutants.map(() => 'unverified')];
  assert.deepEqual(cases.map(assessPublicRacePreflight), expected);
  // Executed constant-return negative control: a permissive oracle must fail
  // on the same canceled, ambiguous, wrong-order and failed-cleanup inputs.
  assert.notDeepEqual(
    cases.map(() => 'timing_interception_feasible'),
    expected,
  );
});
