import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectGuestValuesHandlerIdentity } from './guest-values-handler-identity.mjs';

function fixture({ callback = true, hidden = false, overflow = false, fail = false } = {}) {
  const calls = [];
  let listener = null;
  const remote = (objectId, type = 'object', description = '') => ({ objectId, type, description });
  const location = (scriptId, columnNumber) => ({
    name: '[[FunctionLocation]]',
    value: { value: { scriptId, lineNumber: 0, columnNumber } },
  });
  const scopes = (objectId) => ({ name: '[[Scopes]]', value: remote(objectId) });
  const properties = {
    root: { internalProperties: [location('focus', 500), scopes('root-scopes')] },
    'root-scopes': {
      result: [
        { name: '0', value: remote('root-closure', 'object', 'Closure') },
        { name: '1', value: remote('global', 'object', 'Global') },
      ],
    },
    'root-closure': {
      result: [
        { name: 'PRIVATE_AUTH_TOKEN', value: remote('leaf', 'function', 'SECRET') },
        { name: 'slot', value: remote('sibling', 'function', 'SECRET') },
        { name: 'private', value: remote('secret', 'object', 'SECRET') },
        ...(overflow
          ? Array.from({ length: 50 }, (_, i) => ({
              name: `extra${i}`,
              value: { type: 'string', value: 'SECRET' },
            }))
          : []),
      ],
    },
    leaf: {
      internalProperties: [location(callback ? 'expected' : 'other', 20680), scopes('leaf-scopes')],
    },
    'leaf-scopes': { result: [{ name: '0', value: remote('leaf-closure', 'object', 'Closure') }] },
    'leaf-closure': { result: [] },
    sibling: {
      internalProperties: hidden
        ? [scopes('sibling-scopes')]
        : [location('focus', 400), scopes('sibling-scopes')],
    },
    'sibling-scopes': {
      result: [{ name: '0', value: remote('sibling-closure', 'object', 'Closure') }],
    },
    'sibling-closure': { result: [] },
  };
  const panel = {
    on: (name, fn) => {
      assert.equal(name, 'Debugger.scriptParsed');
      listener = fn;
      return () => {
        listener = null;
        calls.push(['off']);
      };
    },
    send: async (method, args) => {
      calls.push([method, args]);
      if (method === 'Debugger.enable') {
        if (fail) throw new Error('PRIVATE_AUTH_TOKEN');
        listener?.({
          scriptId: 'expected',
          url: 'chrome-extension://PRIVATE/chunks/react-CIAGJaBG.js',
        });
        return {};
      }
      if (method === 'Runtime.evaluate') return { result: remote('root', 'function', 'SECRET') };
      if (method === 'Runtime.getProperties') {
        if (args.objectId === 'global') throw new Error('global scope must not be read');
        return properties[args.objectId];
      }
      return {};
    },
  };
  return {
    panel,
    calls,
    get listener() {
      return listener;
    },
  };
}

test('recognizes the compiled Values leaf through closure functions without exposing scope data', async () => {
  const input = fixture();
  const receipt = await inspectGuestValuesHandlerIdentity(input.panel);
  assert.equal(receipt.status, 'present');
  assert.equal(receipt.expected_compiled_match, true);
  assert.equal(receipt.edges.length, 2);
  assert.equal(receipt.nodes.length, 3);
  assert.equal(JSON.stringify(receipt).includes('SECRET'), false);
  assert.equal(JSON.stringify(receipt).includes('PRIVATE'), false);
  assert.equal(JSON.stringify(receipt).includes('objectId'), false);
  assert.ok(
    input.calls.every(
      ([method]) =>
        !method.startsWith('Input.') &&
        method !== 'Runtime.callFunctionOn' &&
        method !== 'Debugger.setBreakpoint' &&
        method !== 'Debugger.pause',
    ),
  );
  assert.ok(input.calls.some(([method]) => method === 'Runtime.releaseObjectGroup'));
  assert.ok(input.calls.some(([method]) => method === 'Debugger.disable'));
  assert.equal(input.listener, null);
});

test('never infers absence from an unmatched function graph with object-held or hidden bindings', async () => {
  const objectHeld = await inspectGuestValuesHandlerIdentity(fixture({ callback: false }).panel);
  assert.equal(objectHeld.status, 'unknown');
  assert.equal(objectHeld.reason, 'expected_callback_not_observed');
  assert.equal(objectHeld.expected_compiled_match, false);
  const hidden = await inspectGuestValuesHandlerIdentity(
    fixture({ callback: false, hidden: true }).panel,
  );
  assert.equal(hidden.status, 'unknown');
  assert.equal(hidden.reason, 'expected_callback_not_observed');
  const capped = await inspectGuestValuesHandlerIdentity(
    fixture({ callback: false, overflow: true }).panel,
  );
  assert.equal(capped.status, 'unknown');
  assert.equal(capped.reason, 'expected_callback_not_observed');
  assert.equal(capped.truncated, true);
  assert.ok(capped.nodes.length <= capped.limits.functions);
});

test('CDP failure yields a bounded unknown and still releases the object group and listener', async () => {
  const input = fixture({ fail: true });
  const receipt = await inspectGuestValuesHandlerIdentity(input.panel);
  assert.deepEqual(receipt, {
    status: 'unknown',
    reason: 'cdp_inspection_unavailable',
    expected_compiled_match: false,
    nodes: [],
    edges: [],
    truncated: false,
    limits: { functions: 24, depth: 4, scopes: 8, bindings: 40 },
    closure_function_count: 0,
  });
  assert.ok(input.calls.some(([method]) => method === 'Runtime.releaseObjectGroup'));
  assert.equal(input.listener, null);
});
