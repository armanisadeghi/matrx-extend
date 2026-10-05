import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import {
  classifyPanelTransition,
  startPanelTransitionRecorder,
  traceOrganizationPointers,
} from './panel-transition-recorder.mjs';

function fixture() {
  let tick = 0;
  let visibility = 'visible';
  const listeners = new Map();
  const context = createContext({
    window: {},
    performance: { now: () => ++tick },
    document: {
      get visibilityState() {
        return visibility;
      },
      addEventListener: (name, listener) => listeners.set(name, listener),
      removeEventListener: (name, listener) => {
        if (listeners.get(name) === listener) listeners.delete(name);
      },
    },
  });
  const calls = [];
  const panel = {
    async send(method, args) {
      calls.push(method);
      if (method === 'Runtime.evaluate')
        return { result: { value: runInContext(args.expression, context) } };
      return { ok: true };
    },
  };
  return {
    panel,
    calls,
    listeners,
    hide() {
      visibility = 'hidden';
      listeners.get('visibilitychange')?.();
    },
  };
}

test('resource wait hidden event precedes organization entry with no pointer action', async () => {
  const env = fixture();
  const recorder = await startPanelTransitionRecorder(env.panel);
  await recorder.mark('before_health');
  env.hide();
  await recorder.mark('after_health');
  await recorder.mark('organization_entry');
  await recorder.mark('organization_skip');
  const result = await recorder.stop();
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.events.map(({ kind, visibility }) => [kind, visibility]))),
    [
      ['start', 'visible'],
      ['before_health', 'visible'],
      ['visibilitychange', 'hidden'],
      ['after_health', 'hidden'],
      ['organization_entry', 'hidden'],
      ['organization_skip', 'hidden'],
      ['stop', 'hidden'],
    ],
  );
  assert.deepEqual(
    Array.from(result.events, (event) => event.ms),
    [1, 2, 3, 4, 5, 6, 7],
  );
  assert.equal(result.status, 'measured');
  assert.equal(classifyPanelTransition(result), 'during_resource_wait');
  assert.equal(env.listeners.size, 0);
  assert.equal(env.calls.includes('Input.dispatchMouseEvent'), false);
});

test('actual pointer dispatch brackets hidden transition and strips input details', async () => {
  const env = fixture();
  const recorder = await startPanelTransitionRecorder(env.panel);
  await recorder.mark('after_health');
  await recorder.mark('organization_entry');
  await recorder.mark('organization_select');
  const instrumented = traceOrganizationPointers(env.panel, recorder);
  const originalSend = env.panel.send;
  env.panel.send = async (method, args) => {
    if (method === 'Input.dispatchMouseEvent') env.hide();
    return originalSend(method, args);
  };
  await instrumented.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: 37,
    y: 59,
    privateIdentity: 'do-not-record',
  });
  const result = await recorder.stop();
  assert.deepEqual(JSON.parse(JSON.stringify(result.events.map((event) => event.kind))), [
    'start',
    'after_health',
    'organization_entry',
    'organization_select',
    'pointer_before',
    'visibilitychange',
    'pointer_after',
    'stop',
  ]);
  assert.equal(JSON.stringify(result).includes('do-not-record'), false);
  assert.equal(classifyPanelTransition(result), 'during_pointer_dispatch');
  assert.equal(JSON.stringify(result).includes('37'), false);
  assert.equal(env.listeners.size, 0);
});

test('lost renderer context is explicitly unavailable', async () => {
  const env = fixture();
  const recorder = await startPanelTransitionRecorder(env.panel);
  env.panel.send = async () => {
    throw new Error('private-url-or-identity');
  };
  assert.deepEqual(await recorder.stop(), { status: 'unavailable', events: [] });
  assert.equal(classifyPanelTransition({ status: 'unavailable', events: [] }), 'unmeasured');
  assert.equal(JSON.stringify(await recorder.stop()).includes('private'), false);
});
