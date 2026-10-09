import assert from 'node:assert/strict';
import test from 'node:test';
import { clickPickerDone } from './data-guest-picker-driver.mjs';

function ownedPage(hitBackendNodeId) {
  const calls = [];
  const session = {
    async send(method, params) {
      calls.push({ method, params });
      if (method === 'DOM.enable') return {};
      if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
      if (method === 'DOM.querySelector')
        return { nodeId: params.selector === '#matrx-data-picker-host' ? 2 : 4 };
      if (method === 'DOM.describeNode' && params.nodeId === 2)
        return { node: { shadowRoots: [{ nodeId: 3, shadowRootType: 'closed' }] } };
      if (method === 'DOM.describeNode' && params.nodeId === 4)
        return { node: { nodeName: 'BUTTON', backendNodeId: 74 } };
      if (method === 'DOM.getBoxModel')
        return { model: { content: [10, 20, 50, 20, 50, 40, 10, 40] } };
      if (method === 'DOM.getNodeForLocation') return { backendNodeId: hitBackendNodeId };
      throw new Error(`unexpected_cdp_method:${method}`);
    },
    async detach() {
      calls.push({ method: 'detach' });
    },
  };
  const page = {
    context: () => ({ newCDPSession: async () => session }),
    mouse: {
      async click(x, y) {
        calls.push({ method: 'click', x, y });
      },
    },
  };
  return { page, calls };
}

test('Data guest Done receives trusted pointer only when exact closed-shadow button owns hit', async () => {
  const exact = ownedPage(74);
  await clickPickerDone(exact.page);
  assert.deepEqual(
    exact.calls.filter((call) => call.method === 'click'),
    [{ method: 'click', x: 30, y: 30 }],
  );
  assert.equal(exact.calls.at(-1).method, 'detach');

  const covered = ownedPage(91);
  await assert.rejects(clickPickerDone(covered.page), /data_guest_done_hit_target_changed/);
  assert.equal(
    covered.calls.some((call) => call.method === 'click'),
    false,
  );
  assert.equal(covered.calls.at(-1).method, 'detach');
});
