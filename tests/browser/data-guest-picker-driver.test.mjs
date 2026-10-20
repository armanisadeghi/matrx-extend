import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clickPickerCancel,
  clickPickerClear,
  clickPickerDone,
  clickPickerField,
  foregroundPickerDoneTarget,
  hoverPickerField,
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

function foregroundPage({
  changedTarget = false,
  replacedAfterForeground = false,
  activationError = false,
  hitBackendNodeId = 74,
  movedBox = false,
} = {}) {
  const calls = [];
  const hitParams = [];
  let active = false;
  let sessions = 0;
  let boxReads = 0;
  const session = {
    async send(method, params) {
      calls.push(method);
      if (method === 'DOM.enable') return {};
      if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
      if (method === 'DOM.querySelector')
        return { nodeId: params.selector === '#matrx-data-picker-host' ? 2 : 4 };
      if (method === 'DOM.describeNode' && params.nodeId === 2)
        return { node: { shadowRoots: [{ nodeId: 3, shadowRootType: 'closed' }] } };
      if (method === 'DOM.describeNode' && params.nodeId === 4)
        return {
          node: {
            nodeName: 'BUTTON',
            backendNodeId:
              (active && changedTarget) || (sessions > 1 && replacedAfterForeground) ? 91 : 74,
          },
        };
      if (method === 'DOM.getBoxModel') {
        const left = movedBox ? [27, 100, 200][boxReads++] : 27;
        return {
          model: { content: [left, 59, left + 29.671875, 59, left + 29.671875, 74, left, 74] },
        };
      }
      if (method === 'DOM.getNodeForLocation') {
        hitParams.push(params);
        return { backendNodeId: replacedAfterForeground ? 91 : hitBackendNodeId };
      }
      throw new Error(`unexpected_cdp_method:${method}`);
    },
    async detach() {
      calls.push('detach');
    },
  };
  const page = {
    evaluate: async () => ({
      visible: active,
      focused: active,
      viewport_width: 366,
      viewport_height: 813,
      visual_width: 366,
      visual_height: 813,
      visual_offset_x: 0,
      visual_offset_y: 0,
      scroll_x: 0,
      scroll_y: 0,
    }),
    context: () => ({
      newCDPSession: async () => {
        sessions++;
        return session;
      },
    }),
    async bringToFront() {
      calls.push('bringToFront');
      if (activationError) throw new Error('target_unavailable');
      active = true;
    },
    mouse: {
      async click(x, y) {
        calls.push(['click', x, y]);
      },
    },
  };
  return { page, calls, hitParams };
}

test('Done foreground step remeasures the same closed-shadow target before strict CDP hit and trusted input', async () => {
  const { page, calls } = foregroundPage();
  const sample = await foregroundPickerDoneTarget(page);
  await clickPickerDone(page, sample.backendNodeId);
  assert.equal(sample.before.state.visible, false);
  assert.equal(sample.after.state.visible, true);
  assert.equal(sample.target_equal, true);
  assert.equal(sample.before.box.center_x, 41.8359375);
  assert.ok(calls.indexOf('bringToFront') > calls.indexOf('DOM.getBoxModel'));
  assert.ok(calls.lastIndexOf('DOM.getBoxModel') > calls.indexOf('bringToFront'));
  assert.ok(calls.indexOf('DOM.getNodeForLocation') > calls.indexOf('bringToFront'));
  assert.deepEqual(
    calls.filter((entry) => Array.isArray(entry)),
    [['click', 41.8359375, 66.5]],
  );
});

test('Done hit and trusted mouse use the third fresh box when the same target moves on activation and before click', async () => {
  const { page, calls, hitParams } = foregroundPage({ movedBox: true });
  const sample = await foregroundPickerDoneTarget(page);
  await clickPickerDone(page, sample.backendNodeId);
  assert.equal(sample.before.box.center_x, 41.8359375);
  assert.equal(sample.after.box.center_x, 114.8359375);
  assert.deepEqual(hitParams, [
    { x: 215, y: 67, includeUserAgentShadowDOM: true, ignorePointerEventsNone: false },
  ]);
  assert.deepEqual(
    calls.filter((entry) => Array.isArray(entry)),
    [['click', 214.8359375, 66.5]],
  );
});

test('Done refuses replacement between the post-foreground sample and final hit', async () => {
  const { page, calls } = foregroundPage({ replacedAfterForeground: true });
  const sample = await foregroundPickerDoneTarget(page);
  await assert.rejects(
    clickPickerDone(page, sample.backendNodeId),
    /data_guest_done_target_changed_after_foreground/,
  );
  assert.equal(calls.includes('DOM.getNodeForLocation'), false);
  assert.equal(
    calls.some((entry) => Array.isArray(entry)),
    false,
  );
});

test('Done foreground step refuses a changed target or failed activation without input', async () => {
  for (const options of [{ changedTarget: true }, { activationError: true }]) {
    const { page, calls } = foregroundPage(options);
    await assert.rejects(foregroundPickerDoneTarget(page), (error) => {
      assert.equal(
        error.pickerForegroundDiagnostic.phase,
        options.changedTarget ? 'after' : 'bring_to_front',
      );
      return true;
    });
    assert.equal(
      calls.some((entry) => Array.isArray(entry)),
      false,
    );
    assert.equal(calls.includes('DOM.getNodeForLocation'), false);
  }
});

test('Done foreground step does not weaken nonmatching CDP hit refusal', async () => {
  const { page, calls } = foregroundPage({ hitBackendNodeId: 91 });
  await foregroundPickerDoneTarget(page);
  await assert.rejects(clickPickerDone(page), /data_guest_done_hit_target_changed/);
  assert.equal(
    calls.some((entry) => Array.isArray(entry)),
    false,
  );
});

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

test('Done helper preserves first failed phase and projects no raw protocol details', async () => {
  const privateValue = 'PRIVATE_DONE_PROTOCOL_791';
  for (const phase of [
    ['new_session', null],
    ['dom_enable', 'DOM.enable'],
    ['get_document', 'DOM.getDocument'],
    ['query_host', 'DOM.querySelector'],
    ['describe_host', 'DOM.describeNode'],
    ['query_button', 'DOM.querySelector'],
    ['describe_button', 'DOM.describeNode'],
    ['get_box_model', 'DOM.getBoxModel'],
    ['get_node_for_location', 'DOM.getNodeForLocation'],
    ['mouse_click', null],
    ['detach', null],
  ]) {
    const [expectedPhase, method] = phase;
    const fixture = ownedPage(74);
    const originalSession = fixture.page.context().newCDPSession;
    fixture.page.context = () => ({
      newCDPSession: async () => {
        if (expectedPhase === 'new_session')
          throw Object.assign(new Error(privateValue), { name: 'ProtocolError' });
        const session = await originalSession();
        const originalSend = session.send.bind(session);
        let queryCount = 0;
        let describeCount = 0;
        session.send = async (actual, params) => {
          if (actual === 'DOM.querySelector') queryCount++;
          if (actual === 'DOM.describeNode') describeCount++;
          if (
            actual === method &&
            (!['DOM.querySelector', 'DOM.describeNode'].includes(actual) ||
              (expectedPhase === 'query_host' && queryCount === 1) ||
              (expectedPhase === 'query_button' && queryCount === 2) ||
              (expectedPhase === 'describe_host' && describeCount === 1) ||
              (expectedPhase === 'describe_button' && describeCount === 2))
          )
            throw Object.assign(new Error(privateValue), { name: 'ProtocolError' });
          return originalSend(actual, params);
        };
        if (expectedPhase === 'detach')
          session.detach = async () => {
            throw Object.assign(new Error(privateValue), { name: 'ProtocolError' });
          };
        return session;
      },
    });
    if (expectedPhase === 'mouse_click')
      fixture.page.mouse.click = async () => {
        throw Object.assign(new Error(privateValue), { name: 'ProtocolError' });
      };
    await assert.rejects(clickPickerDone(fixture.page), (error) => {
      assert.equal(error.pickerButtonDiagnostic?.phase, expectedPhase);
      assert.equal(error.pickerButtonDiagnostic?.exception_category, 'protocol');
      assert.doesNotMatch(
        JSON.stringify(error.pickerButtonDiagnostic),
        /PRIVATE_DONE_PROTOCOL_791/,
      );
      return true;
    });
  }
});

test('Done hit lookup classifies fixed CDP failures without retaining browser messages', async () => {
  const cases = [
    ['No node found at given location', 'no_node_at_location'],
    ['Could not find node with given id', 'stale_node_or_context'],
    ['Session closed', 'target_unavailable'],
    ['Invalid parameters', 'invalid_parameters'],
    ['Method not found', 'unsupported_command'],
    ['PRIVATE_BROWSER_TEXT_791', 'other'],
  ];
  for (const [message, expected] of cases) {
    const fixture = ownedPage(74);
    const session = await fixture.page.context().newCDPSession();
    const original = session.send.bind(session);
    session.send = async (method, params) => {
      if (method === 'DOM.getNodeForLocation')
        throw Object.assign(new Error(message), { code: -32000 });
      return original(method, params);
    };
    await assert.rejects(clickPickerDone(fixture.page), (error) => {
      assert.equal(error.pickerButtonDiagnostic?.phase, 'get_node_for_location');
      assert.equal(error.pickerButtonDiagnostic?.exception_category, expected);
      assert.equal(error.pickerButtonDiagnostic?.exception_name, 'Error');
      assert.equal(error.pickerButtonDiagnostic?.exception_code, -32000);
      assert.doesNotMatch(JSON.stringify(error.pickerButtonDiagnostic), /PRIVATE_BROWSER_TEXT_791/);
      return true;
    });
    assert.equal(
      fixture.calls.some((call) => call.method === 'click'),
      false,
    );
    assert.equal(fixture.calls.at(-1).method, 'detach');
  }
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

test('T07 Clear targets the exact closed-shadow button and refuses a covered hit', async () => {
  const exact = ownedPage(74);
  await clickPickerClear(exact.page);
  assert.ok(
    exact.calls.some(
      (call) => call.method === 'DOM.querySelector' && call.params.selector === '#clear',
    ),
  );
  assert.equal(exact.calls.filter((call) => call.method === 'click').length, 1);

  const covered = ownedPage(91);
  await assert.rejects(clickPickerClear(covered.page), /data_guest_clear_hit_target_changed/);
  assert.equal(
    covered.calls.some((call) => call.method === 'click'),
    false,
  );
});

test('T07 hover oracle rejects a hidden or misplaced real highlight', async () => {
  const previous = {
    document: globalThis.document,
    innerWidth: globalThis.innerWidth,
    innerHeight: globalThis.innerHeight,
  };
  const rect = { left: 8, top: 24, right: 108, bottom: 64, width: 100, height: 40 };
  const target = { getBoundingClientRect: () => rect, contains: () => false };
  globalThis.innerWidth = 600;
  globalThis.innerHeight = 500;
  globalThis.document = {
    querySelectorAll: () => [target],
    querySelector: () => null,
    elementFromPoint: () => target,
  };
  let highlight = 'display: block; top: 24px; left: 8px; width: 100px; height: 40px;';
  const page = {
    locator: () => ({ nth: () => ({ scrollIntoViewIfNeeded: async () => {} }) }),
    evaluate: async (callback, args) => callback(args),
    mouse: { move: async () => {} },
    context: () => ({
      newCDPSession: async () => ({
        async send(method, params) {
          if (method === 'DOM.enable') return {};
          if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
          if (method === 'DOM.querySelector')
            return { nodeId: params.selector === '#matrx-data-picker-host' ? 2 : 4 };
          if (method === 'DOM.describeNode')
            return { node: { shadowRoots: [{ nodeId: 3, shadowRootType: 'closed' }] } };
          if (method === 'DOM.getOuterHTML')
            return { outerHTML: `<div id="hl" style="${highlight}"></div>` };
          throw new Error(`unexpected_cdp_method:${method}`);
        },
        async detach() {},
      }),
    }),
  };
  try {
    assert.equal((await hoverPickerField(page, '.product-name')).highlight_visible, true);
    highlight = 'display: none; top: 24px; left: 8px; width: 100px; height: 40px;';
    await assert.rejects(hoverPickerField(page, '.product-name'), /data_guest_hover_not_visible/);
    highlight = 'display: block; top: 24px; left: 35px; width: 100px; height: 40px;';
    await assert.rejects(hoverPickerField(page, '.product-name'), /data_guest_hover_left_wrong/);
  } finally {
    Object.assign(globalThis, previous);
  }
});
