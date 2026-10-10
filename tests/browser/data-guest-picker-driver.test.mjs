import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clickPickerCancel,
  clickPickerDone,
  clickPickerField,
} from './data-guest-picker-driver.mjs';

test('Data guest field click uses a visible owned point when the picker covers its center', async () => {
  const previous = {
    document: globalThis.document,
    innerWidth: globalThis.innerWidth,
    innerHeight: globalThis.innerHeight,
  };
  const target = {
    getBoundingClientRect: () => ({
      left: 8,
      top: 24,
      right: 592,
      bottom: 64,
      width: 584,
      height: 40,
    }),
    contains: () => false,
  };
  const blocker = { contains: () => false };
  const clicks = [];
  let coverLeft = 260;
  globalThis.innerWidth = 600;
  globalThis.innerHeight = 500;
  globalThis.document = {
    querySelectorAll: () => [target],
    querySelector: (selector) => (selector === '#matrx-data-picker-host' ? blocker : null),
    elementFromPoint: (x) => (x >= coverLeft ? blocker : target),
  };
  const page = {
    locator: () => ({ nth: () => ({ scrollIntoViewIfNeeded: async () => {} }) }),
    evaluate: async (callback, args) => callback(args),
    mouse: { click: async (x, y) => clicks.push([x, y]) },
  };
  try {
    const picked = await clickPickerField(page, '.product-name');
    assert.deepEqual(clicks, [[154, 44]]);
    assert.equal(picked.center_hit, 'picker_overlay');
    assert.equal(picked.chosen_hit, 'field');
    coverLeft = 0;
    await assert.rejects(clickPickerField(page, '.product-name'), (error) => {
      assert.equal(error.pickerFieldDiagnostic?.center_hit, 'picker_overlay');
      assert.deepEqual(error.pickerFieldDiagnostic?.hit_kinds, Array(9).fill('picker_overlay'));
      return /data_guest_field_hit_target_missing/.test(error.message);
    });
    assert.deepEqual(clicks, [[154, 44]]);
    coverLeft = 600;
    await clickPickerField(page, '.product-name');
    assert.deepEqual(clicks, [
      [154, 44],
      [300, 44],
    ]);
  } finally {
    Object.assign(globalThis, previous);
  }
});

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

test('C16 Cancel targets the picker exit button and refuses a covered hit', async () => {
  const exact = ownedPage(74);
  await clickPickerCancel(exact.page);
  assert.ok(
    exact.calls.some(
      (call) => call.method === 'DOM.querySelector' && call.params.selector === '#cancel',
    ),
  );
  assert.deepEqual(
    exact.calls.filter((call) => call.method === 'click'),
    [{ method: 'click', x: 30, y: 30 }],
  );

  const covered = ownedPage(91);
  await assert.rejects(clickPickerCancel(covered.page), /data_guest_cancel_hit_target_changed/);
  assert.equal(
    covered.calls.some((call) => call.method === 'click'),
    false,
  );
});
