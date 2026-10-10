import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyEmptyPickerDismissal } from './data-guest-picker-cancel.mjs';

function fixture({
  selectedAfterCancel = 0,
  writeOnCancel = false,
  ignoreCancel = false,
  initialDisabled = false,
  initialMissing = false,
} = {}) {
  const state = {
    open: false,
    selectedFieldMarkers: 0,
    pickerButton: initialDisabled || initialMissing ? 0 : 1,
    pickerButtonPresent: initialMissing ? 0 : 1,
    pickerButtonDisabled: initialDisabled ? 1 : 0,
    cancelSelection: 0,
  };
  const actions = [];
  let listener = null;
  const session = {
    async send(method, params) {
      if (method === 'DOM.enable') return {};
      if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
      if (method === 'DOM.querySelector') {
        actions.push(params.selector);
        return { nodeId: params.selector === '#matrx-data-picker-host' ? 2 : 4 };
      }
      if (method === 'DOM.describeNode' && params.nodeId === 2)
        return { node: { shadowRoots: [{ nodeId: 3, shadowRootType: 'closed' }] } };
      if (method === 'DOM.describeNode' && params.nodeId === 4)
        return { node: { nodeName: 'BUTTON', backendNodeId: 74 } };
      if (method === 'DOM.getBoxModel')
        return { model: { content: [10, 20, 50, 20, 50, 40, 10, 40] } };
      if (method === 'DOM.getNodeForLocation') return { backendNodeId: 74 };
      throw new Error(`unexpected_cdp_method:${method}`);
    },
    async detach() {},
  };
  const page = {
    context: () => ({ newCDPSession: async () => session }),
    locator: () => ({
      waitFor: async ({ state: expected }) => {
        assert.equal(state.open, expected === 'attached', 'data_guest_picker_dismissal_missing');
      },
    }),
    mouse: {
      click: async () => {
        actions.push('trusted_click');
        if (ignoreCancel) return;
        state.open = false;
        state.selectedFieldMarkers = selectedAfterCancel;
        if (writeOnCancel)
          listener?.({ request: { method: 'POST', url: 'https://db.test/wbx_pattern' } });
      },
    },
  };
  const panel = {
    async send(method) {
      assert.equal(method, 'Network.enable');
    },
    on(event, callback) {
      assert.equal(event, 'Network.requestWillBeSent');
      listener = callback;
      return () => {
        listener = null;
      };
    },
  };
  return {
    page,
    panel,
    actions,
    readState: async () => ({ ...state }),
    openPicker: async () => {
      actions.push('open_picker');
      state.open = true;
      state.pickerButton = 0;
      state.pickerButtonPresent = 0;
    },
    waitForState: async (_label, read, predicate) => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const observed = await read();
        if (predicate(observed)) return observed;
        if (initialDisabled && attempt === 0) {
          state.pickerButton = 1;
          state.pickerButtonDisabled = 0;
        }
      }
      throw new Error(`${_label}_not_observed`);
    },
  };
}

test('C16 requires trusted Cancel, dismissed overlay, unchanged fields and no write', async () => {
  const exact = fixture();
  // The real panel exposes the picker action again after cancel.
  const readState = exact.readState;
  exact.readState = async () => {
    const observed = await readState();
    if (!observed.open && exact.actions.includes('trusted_click')) {
      observed.pickerButton = 1;
      observed.pickerButtonPresent = 1;
    }
    return observed;
  };
  await verifyEmptyPickerDismissal(exact);
  assert.deepEqual(exact.actions, [
    'open_picker',
    '#matrx-data-picker-host',
    '#cancel',
    'trusted_click',
  ]);

  for (const options of [
    { ignoreCancel: true, failure: /data_guest_picker_dismissal_missing/ },
    { selectedAfterCancel: 1, failure: /data_guest_cancel_selected_fields_changed/ },
    { writeOnCancel: true, failure: /data_guest_cancel_wrote_pattern/ },
  ]) {
    const broken = fixture(options);
    const originalRead = broken.readState;
    broken.readState = async () => {
      const observed = await originalRead();
      if (!observed.open && broken.actions.includes('trusted_click')) {
        observed.pickerButton = 1;
        observed.pickerButtonPresent = 1;
      }
      return observed;
    };
    await assert.rejects(verifyEmptyPickerDismissal(broken), options.failure);
  }
});

test('C16 waits for a transient disabled picker but never opens an absent control', async () => {
  const transient = fixture({ initialDisabled: true });
  const originalRead = transient.readState;
  transient.readState = async () => {
    const observed = await originalRead();
    if (!observed.open && transient.actions.includes('trusted_click')) {
      observed.pickerButton = 1;
      observed.pickerButtonPresent = 1;
    }
    return observed;
  };
  await verifyEmptyPickerDismissal(transient);
  assert.equal(transient.actions.includes('open_picker'), true);
  assert.equal(transient.actions.includes('trusted_click'), true);

  const absent = fixture({ initialMissing: true });
  await assert.rejects(
    verifyEmptyPickerDismissal(absent),
    /data_guest_cancel_baseline_picker_enabled_not_observed/,
  );
  assert.equal(absent.actions.includes('open_picker'), false);
});
