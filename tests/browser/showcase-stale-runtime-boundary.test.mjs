import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import vm from 'node:vm';
import {
  STALE_PICKER_KINDS,
  armShowcaseStaleBoundary,
} from './showcase-stale-runtime-boundary.mjs';

test('each held A channel stays outside Chrome until its exact envelope is released', async () => {
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
  await boundary.holdNext(STALE_PICKER_KINDS.exit);
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
  assert.deepEqual((await boundary.snapshot()).held, [
    { kind: oldExit.kind, session_id: a, list_root: null, item_selector: null },
  ]);
  await runtime.sendMessage(currentDetection);
  assert.deepEqual(delivered, [currentDetection]);
  assert.deepEqual(await boundary.release(STALE_PICKER_KINDS.exit, b), { released: false });
  assert.deepEqual((await boundary.snapshot()).held, [
    { kind: oldExit.kind, session_id: a, list_root: null, item_selector: null },
  ]);
  assert.deepEqual(delivered, [currentDetection]);
  assert.deepEqual(await boundary.release(STALE_PICKER_KINDS.exit, a), {
    released: true,
    ack: true,
  });
  assert.deepEqual(await heldPromise, { ack: true });
  assert.deepEqual(delivered, [currentDetection, oldExit]);
  assert.deepEqual(await boundary.release(STALE_PICKER_KINDS.exit, a), { released: false });
  assert.deepEqual(delivered, [currentDetection, oldExit]);
  for (const kind of [STALE_PICKER_KINDS.detected, STALE_PICKER_KINDS.result]) {
    await boundary.holdNext(kind);
    const oldMessage = {
      __matrx: true,
      kind,
      payload: { session_id: a, list_root: '#archive', item_selector: '.archive-card' },
    };
    const held = runtime.sendMessage(oldMessage);
    assert.deepEqual((await boundary.snapshot()).held, [
      { kind, session_id: a, list_root: '#archive', item_selector: '.archive-card' },
    ]);
    assert.equal(delivered.includes(oldMessage), false, `${kind} reached Chrome before release`);
    await assert.rejects(boundary.holdNext(kind), /showcase_previous_message_still_held/);
    assert.deepEqual(await boundary.release(STALE_PICKER_KINDS.exit, a), { released: false });
    assert.deepEqual(await boundary.release(kind, a), { released: true, ack: true });
    assert.deepEqual(await held, { ack: true });
    assert.equal(delivered.at(-1), oldMessage);
  }
  await boundary.close();
});

test('refuses default or foreign extension picker worlds', async () => {
  for (const world of ['default', 'foreign-extension']) {
    const cdp = new EventEmitter();
    cdp.send = async (method) => {
      if (method === 'Runtime.enable')
        queueMicrotask(() =>
          cdp.emit('Runtime.executionContextCreated', {
            context: { id: 1, auxData: { isDefault: world === 'default', frameId: 'page' } },
          }),
        );
      if (method === 'Runtime.evaluate')
        return {
          result: {
            value: {
              id: 'different-extension',
              picker: 'function',
              url: 'http://localhost/events',
            },
          },
        };
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
  }
});
