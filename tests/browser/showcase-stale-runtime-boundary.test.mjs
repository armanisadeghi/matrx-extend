import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import vm from 'node:vm';
import { armShowcaseStaleBoundary } from './showcase-stale-runtime-boundary.mjs';

test('captured A EXIT stays outside Chrome until released; B detection passes through', async () => {
  const delivered = [];
  const runtime = {
    id: 'cihdmkcdjjckfhjpgoedmgfpoljebaml',
    sendMessage(message) {
      delivered.push(message);
      return Promise.resolve({ ack: true });
    },
  };
  const world = vm.createContext({
    chrome: { runtime },
    window: {
      __matrxListPickerStart() {},
    },
    location: { href: 'http://localhost/events' },
  });
  const cdp = new EventEmitter();
  cdp.send = async (method, params) => {
    if (method === 'Runtime.enable') {
      queueMicrotask(() =>
        cdp.emit('Runtime.executionContextCreated', {
          context: { id: 7, auxData: { isDefault: false, frameId: 'owned-frame' } },
        }),
      );
      return {};
    }
    assert.equal(method, 'Runtime.evaluate');
    assert.equal(params.contextId, 7);
    return {
      result: {
        value: JSON.parse(JSON.stringify(await vm.runInContext(params.expression, world))),
      },
    };
  };
  cdp.detach = async () => {};
  const page = {
    url: () => 'http://localhost/events',
    context: () => ({ newCDPSession: async () => cdp }),
  };
  const boundary = await armShowcaseStaleBoundary(page, runtime.id);
  const a = '11111111-1111-4111-8111-111111111111';
  const b = '22222222-2222-4222-8222-222222222222';
  const oldExit = { __matrx: true, kind: 'data:list-picker-exit', payload: { session_id: a } };
  const currentDetection = {
    __matrx: true,
    kind: 'data:list-picker-item-detected',
    payload: { session_id: b },
  };
  const heldPromise = runtime.sendMessage(oldExit);
  assert.equal(delivered.length, 0);
  assert.deepEqual((await boundary.snapshot()).held, [{ kind: oldExit.kind, session_id: a }]);
  await runtime.sendMessage(currentDetection);
  assert.deepEqual(delivered, [currentDetection]);
  assert.deepEqual(await boundary.release(a), { released: true, ack: true });
  assert.deepEqual(await heldPromise, { ack: true });
  assert.deepEqual(delivered, [currentDetection, oldExit]);
  await boundary.close();
});

test('refuses a page without the owned extension picker world', async () => {
  const cdp = new EventEmitter();
  cdp.send = async (method) => {
    if (method === 'Runtime.enable')
      queueMicrotask(() =>
        cdp.emit('Runtime.executionContextCreated', {
          context: { id: 1, auxData: { isDefault: true, frameId: 'page' } },
        }),
      );
    return {};
  };
  await assert.rejects(
    armShowcaseStaleBoundary(
      {
        url: () => 'http://localhost/events',
        context: () => ({ newCDPSession: async () => cdp }),
      },
      'cihdmkcdjjckfhjpgoedmgfpoljebaml',
    ),
    /showcase_picker_isolated_context_missing/,
  );
});
