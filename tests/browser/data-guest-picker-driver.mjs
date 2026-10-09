import assert from 'node:assert/strict';

/** Resolve a button inside the picker's closed shadow root through Chrome's DOM domain. */
export async function pickerShadowNode(session, selector) {
  const { root } = await session.send('DOM.getDocument', { depth: 1, pierce: true });
  const { nodeId: hostId } = await session.send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: '#matrx-data-picker-host',
  });
  assert.ok(hostId, 'data_guest_picker_host_missing');
  const { node: host } = await session.send('DOM.describeNode', {
    nodeId: hostId,
    depth: 1,
    pierce: true,
  });
  const shadow = host.shadowRoots?.filter((node) => node.shadowRootType === 'closed');
  assert.equal(shadow?.length, 1, 'data_guest_picker_closed_shadow_missing');
  const { nodeId } = await session.send('DOM.querySelector', {
    nodeId: shadow[0].nodeId,
    selector,
  });
  assert.ok(nodeId, 'data_guest_picker_shadow_target_missing');
  return nodeId;
}

export async function pickerText(session, selector) {
  const nodeId = await pickerShadowNode(session, selector);
  const { outerHTML } = await session.send('DOM.getOuterHTML', { nodeId });
  return outerHTML;
}

/** A trusted pointer is sent only after the exact CDP hit target matches Done. */
export async function clickPickerDone(page) {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('DOM.enable');
    const nodeId = await pickerShadowNode(session, '#done');
    const { node } = await session.send('DOM.describeNode', { nodeId });
    assert.equal(node.nodeName, 'BUTTON', 'data_guest_done_not_button');
    const { model } = await session.send('DOM.getBoxModel', { nodeId });
    const [x1, y1, x2, y2, x3, y3, x4, y4] = model?.content ?? [];
    const x = (x1 + x2 + x3 + x4) / 4;
    const y = (y1 + y2 + y3 + y4) / 4;
    assert.ok(Number.isFinite(x) && Number.isFinite(y), 'data_guest_done_geometry_missing');
    const hit = await session.send('DOM.getNodeForLocation', {
      x: Math.round(x),
      y: Math.round(y),
      includeUserAgentShadowDOM: true,
      ignorePointerEventsNone: false,
    });
    assert.equal(hit.backendNodeId, node.backendNodeId, 'data_guest_done_hit_target_changed');
    await page.mouse.click(x, y);
  } finally {
    await session.detach();
  }
}
