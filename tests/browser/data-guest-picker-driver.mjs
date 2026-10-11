import assert from 'node:assert/strict';

/** Keep the click trusted while refusing points owned by the picker's overlay. */
async function pickerFieldPoint(page, selector, index = 0) {
  await page.locator(selector).nth(index).scrollIntoViewIfNeeded();
  const sample = await page.evaluate(
    ({ selector: targetSelector, index: targetIndex }) => {
      const matches = document.querySelectorAll(targetSelector);
      const target = matches[targetIndex];
      const pickerHost = document.querySelector('#matrx-data-picker-host');
      const rect = target?.getBoundingClientRect();
      const viewport = { width: innerWidth, height: innerHeight };
      const bounds = rect && {
        left: Math.max(0, rect.left),
        top: Math.max(0, rect.top),
        right: Math.min(innerWidth, rect.right),
        bottom: Math.min(innerHeight, rect.bottom),
      };
      const fractions = [0.5, 0.25, 0.75];
      const points =
        bounds && bounds.right > bounds.left && bounds.bottom > bounds.top
          ? fractions.flatMap((fy) =>
              fractions.map((fx) => {
                const x = bounds.left + (bounds.right - bounds.left) * fx;
                const y = bounds.top + (bounds.bottom - bounds.top) * fy;
                const hit = document.elementFromPoint(x, y);
                return {
                  x,
                  y,
                  kind:
                    hit && (hit === target || target.contains(hit))
                      ? 'field'
                      : hit && pickerHost && (hit === pickerHost || pickerHost.contains(hit))
                        ? 'picker_overlay'
                        : hit
                          ? 'other_blocker'
                          : 'none',
                };
              }),
            )
          : [];
      return {
        target_count: matches.length,
        target_rect: rect
          ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
          : null,
        viewport,
        center_hit: points[0]?.kind ?? 'missing',
        hit_kinds: points.map((point) => point.kind),
        chosen: points.find((point) => point.kind === 'field') ?? null,
      };
    },
    { selector, index },
  );
  const diagnostic = {
    target_count: sample.target_count,
    target_rect: sample.target_rect,
    viewport: sample.viewport,
    center_hit: sample.center_hit,
    hit_kinds: sample.hit_kinds,
    chosen_hit: sample.chosen ? 'field' : null,
  };
  if (!sample.chosen) {
    const error = new Error('data_guest_field_hit_target_missing');
    error.pickerFieldDiagnostic = diagnostic;
    throw error;
  }
  return { point: sample.chosen, diagnostic };
}

export async function clickPickerField(page, selector, index = 0) {
  const { point, diagnostic } = await pickerFieldPoint(page, selector, index);
  await page.mouse.click(point.x, point.y);
  return diagnostic;
}

/** Move a real pointer and read the closed-shadow highlight drawn by the extension. */
export async function hoverPickerField(page, selector, index = 0) {
  const { point, diagnostic } = await pickerFieldPoint(page, selector, index);
  const before = await page.evaluate(
    ({ selector: targetSelector, index: targetIndex }) => {
      const rect = document.querySelectorAll(targetSelector)[targetIndex].getBoundingClientRect();
      return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
    },
    { selector, index },
  );
  await page.mouse.move(point.x, point.y);
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('DOM.enable');
    const html = await pickerText(session, '#hl');
    const style = html.match(/style="([^"]*)"/)?.[1] ?? '';
    assert.match(style, /(?:^|;)\s*display:\s*block\s*(?:;|$)/, 'data_guest_hover_not_visible');
    for (const key of ['top', 'left', 'width', 'height']) {
      const value = Number(style.match(new RegExp(`(?:^|;)\\s*${key}:\\s*(-?[\\d.]+)px`))?.[1]);
      assert.ok(Number.isFinite(value), `data_guest_hover_${key}_missing`);
      assert.ok(Math.abs(value - before[key]) <= 1, `data_guest_hover_${key}_wrong`);
    }
    return { target: before, pointer: diagnostic.chosen_hit, highlight_visible: true };
  } finally {
    await session.detach();
  }
}

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

/** A trusted pointer is sent only after the exact closed-shadow button owns the hit. */
async function clickPickerButton(page, buttonId) {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('DOM.enable');
    const nodeId = await pickerShadowNode(session, `#${buttonId}`);
    const { node } = await session.send('DOM.describeNode', { nodeId });
    assert.equal(node.nodeName, 'BUTTON', `data_guest_${buttonId}_not_button`);
    const { model } = await session.send('DOM.getBoxModel', { nodeId });
    const [x1, y1, x2, y2, x3, y3, x4, y4] = model?.content ?? [];
    const x = (x1 + x2 + x3 + x4) / 4;
    const y = (y1 + y2 + y3 + y4) / 4;
    assert.ok(Number.isFinite(x) && Number.isFinite(y), `data_guest_${buttonId}_geometry_missing`);
    const hit = await session.send('DOM.getNodeForLocation', {
      x: Math.round(x),
      y: Math.round(y),
      includeUserAgentShadowDOM: true,
      ignorePointerEventsNone: false,
    });
    assert.equal(
      hit.backendNodeId,
      node.backendNodeId,
      `data_guest_${buttonId}_hit_target_changed`,
    );
    await page.mouse.click(x, y);
  } finally {
    await session.detach();
  }
}

export async function clickPickerDone(page) {
  await clickPickerButton(page, 'done');
}

export async function clickPickerCancel(page) {
  await clickPickerButton(page, 'cancel');
}

export async function clickPickerClear(page) {
  await clickPickerButton(page, 'clear');
}
