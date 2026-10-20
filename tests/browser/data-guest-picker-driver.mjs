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
export async function pickerShadowNode(session, selector, onPhase = () => {}) {
  onPhase('get_document');
  const { root } = await session.send('DOM.getDocument', { depth: 1, pierce: true });
  onPhase('query_host');
  const { nodeId: hostId } = await session.send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: '#matrx-data-picker-host',
  });
  assert.ok(hostId, 'data_guest_picker_host_missing');
  onPhase('describe_host');
  const { node: host } = await session.send('DOM.describeNode', {
    nodeId: hostId,
    depth: 1,
    pierce: true,
  });
  const shadow = host.shadowRoots?.filter((node) => node.shadowRootType === 'closed');
  assert.equal(shadow?.length, 1, 'data_guest_picker_closed_shadow_missing');
  onPhase('query_button');
  const { nodeId } = await session.send('DOM.querySelector', {
    nodeId: shadow[0].nodeId,
    selector,
  });
  assert.ok(nodeId, 'data_guest_picker_shadow_target_missing');
  return nodeId;
}

function pickerErrorCategory(error) {
  const message = String(error?.message ?? '');
  if (/No node found at given location/i.test(message)) return 'no_node_at_location';
  if (
    /Could not find node with given id|Node is detached|Cannot find context with specified id/i.test(
      message,
    )
  )
    return 'stale_node_or_context';
  if (/Session closed|Target closed|WebSocket closed/i.test(message)) return 'target_unavailable';
  if (/Invalid parameters|Invalid params/i.test(message)) return 'invalid_parameters';
  if (/Method not found/i.test(message)) return 'unsupported_command';
  if (error?.name === 'ProtocolError') return 'protocol';
  if (error?.name === 'TimeoutError') return 'timeout';
  if (error?.name === 'AssertionError') return 'assertion';
  if (error?.name === 'TypeError') return 'type';
  return 'other';
}

function pickerErrorName(error) {
  const name = error?.name;
  return ['Error', 'ProtocolError', 'TimeoutError', 'AssertionError', 'TypeError'].includes(name)
    ? name
    : 'other';
}

export async function pickerText(session, selector) {
  const nodeId = await pickerShadowNode(session, selector);
  const { outerHTML } = await session.send('DOM.getOuterHTML', { nodeId });
  return outerHTML;
}

/** Read the rendered picked rows before Done removes the closed-shadow picker. */
export async function pickerSelectedCount(page) {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('DOM.enable');
    const nodeId = await pickerShadowNode(session, '#picked');
    const { nodeIds } = await session.send('DOM.querySelectorAll', {
      nodeId,
      selector: '.picked-item',
    });
    return nodeIds?.length ?? 0;
  } finally {
    await session.detach();
  }
}

/** One foreground differential on the same owned page before the strict Done hit test. */
export async function foregroundPickerDoneTarget(page) {
  const diagnostic = { phase: 'before', before: null, after: null, target_equal: null };
  let session;
  const sample = async () => {
    const state = await page.evaluate(() => ({
      visible: document.visibilityState === 'visible',
      focused: document.hasFocus(),
      viewport_width: innerWidth,
      viewport_height: innerHeight,
      visual_width: visualViewport?.width ?? null,
      visual_height: visualViewport?.height ?? null,
      visual_offset_x: visualViewport?.offsetLeft ?? null,
      visual_offset_y: visualViewport?.offsetTop ?? null,
      scroll_x: scrollX,
      scroll_y: scrollY,
    }));
    const nodeId = await pickerShadowNode(session, '#done');
    const { node } = await session.send('DOM.describeNode', { nodeId });
    assert.equal(node.nodeName, 'BUTTON', 'data_guest_done_not_button');
    assert.ok(
      Number.isSafeInteger(node.backendNodeId) && node.backendNodeId > 0,
      'data_guest_done_backend_node_missing',
    );
    const { model } = await session.send('DOM.getBoxModel', { nodeId });
    const [x1, y1, x2, y2, x3, y3, x4, y4] = model?.content ?? [];
    const x = (x1 + x2 + x3 + x4) / 4;
    const y = (y1 + y2 + y3 + y4) / 4;
    assert.ok(Number.isFinite(x) && Number.isFinite(y), 'data_guest_done_geometry_missing');
    return {
      state,
      box: {
        center_x: x,
        center_y: y,
        width: Math.hypot(x2 - x1, y2 - y1),
        height: Math.hypot(x4 - x1, y4 - y1),
      },
      backendNodeId: node.backendNodeId,
    };
  };
  let firstError = null;
  let backendNodeId = null;
  try {
    session = await page.context().newCDPSession(page);
    await session.send('DOM.enable');
    const before = await sample();
    diagnostic.before = { state: before.state, box: before.box };
    diagnostic.phase = 'bring_to_front';
    await page.bringToFront();
    diagnostic.phase = 'after';
    const after = await sample();
    diagnostic.after = { state: after.state, box: after.box };
    backendNodeId = after.backendNodeId;
    diagnostic.target_equal = after.backendNodeId === before.backendNodeId;
    assert.equal(
      after.backendNodeId,
      before.backendNodeId,
      'data_guest_done_target_changed_during_foreground',
    );
  } catch (error) {
    firstError = error;
    error.pickerForegroundDiagnostic = {
      ...diagnostic,
      exception_category: pickerErrorCategory(error),
      exception_name: pickerErrorName(error),
    };
  }
  if (session) {
    try {
      await session.detach();
    } catch (error) {
      if (!firstError) {
        firstError = error;
        error.pickerForegroundDiagnostic = {
          ...diagnostic,
          phase: 'detach',
          exception_category: pickerErrorCategory(error),
          exception_name: pickerErrorName(error),
        };
      }
    }
  }
  if (firstError) throw firstError;
  return { ...diagnostic, backendNodeId };
}

/** A trusted pointer is sent only after the exact closed-shadow button owns the hit. */
async function clickPickerButton(page, buttonId, expectedBackendNodeId = null) {
  let session;
  let phase = 'new_session';
  let firstError = null;
  const diagnostic = { phase, hit_equal: null, mouse_click_resolved: false };
  const setPhase = (value) => {
    phase = value;
  };
  const fail = (error) => {
    error.pickerButtonDiagnostic = {
      ...diagnostic,
      phase,
      exception_category: pickerErrorCategory(error),
      exception_name: pickerErrorName(error),
      exception_code:
        Number.isSafeInteger(error?.code) && Math.abs(error.code) <= 32768 ? error.code : null,
    };
    return error;
  };
  try {
    session = await page.context().newCDPSession(page);
    phase = 'dom_enable';
    await session.send('DOM.enable');
    const nodeId = await pickerShadowNode(session, `#${buttonId}`, setPhase);
    phase = 'describe_button';
    const { node } = await session.send('DOM.describeNode', { nodeId });
    assert.equal(node.nodeName, 'BUTTON', `data_guest_${buttonId}_not_button`);
    if (expectedBackendNodeId !== null)
      assert.equal(
        node.backendNodeId,
        expectedBackendNodeId,
        `data_guest_${buttonId}_target_changed_after_foreground`,
      );
    phase = 'get_box_model';
    const { model } = await session.send('DOM.getBoxModel', { nodeId });
    const [x1, y1, x2, y2, x3, y3, x4, y4] = model?.content ?? [];
    const x = (x1 + x2 + x3 + x4) / 4;
    const y = (y1 + y2 + y3 + y4) / 4;
    diagnostic.box_center_x = x;
    diagnostic.box_center_y = y;
    diagnostic.box_width = Math.hypot(x2 - x1, y2 - y1);
    diagnostic.box_height = Math.hypot(x4 - x1, y4 - y1);
    assert.ok(Number.isFinite(x) && Number.isFinite(y), `data_guest_${buttonId}_geometry_missing`);
    // DOM.getBoxModel is viewport-relative, while Chromium's getNodeForLocation
    // interprets its input in document space. Keep the trusted mouse point in
    // viewport space; only the CDP hit probe receives the document offset.
    phase = 'get_hit_metrics';
    const [{ product }, { cssLayoutViewport: layout, cssVisualViewport: visual }] =
      await Promise.all([
        session.send('Browser.getVersion'),
        session.send('Page.getLayoutMetrics'),
      ]);
    diagnostic.browser_version = typeof product === 'string' ? product.slice(0, 80) : null;
    diagnostic.layout_viewport = layout
      ? {
          pageX: layout.pageX,
          pageY: layout.pageY,
          clientWidth: layout.clientWidth,
          clientHeight: layout.clientHeight,
        }
      : null;
    diagnostic.visual_viewport = visual
      ? {
          pageX: visual.pageX,
          pageY: visual.pageY,
          offsetX: visual.offsetX,
          offsetY: visual.offsetY,
          scale: visual.scale,
          zoom: visual.zoom,
          clientWidth: visual.clientWidth,
          clientHeight: visual.clientHeight,
        }
      : null;
    const supported =
      Number.isFinite(layout?.pageX) &&
      Number.isFinite(layout?.pageY) &&
      Number.isFinite(visual?.pageX) &&
      Number.isFinite(visual?.pageY) &&
      visual.scale === 1 &&
      visual.zoom === 1 &&
      visual.offsetX === 0 &&
      visual.offsetY === 0 &&
      visual.pageX === layout.pageX &&
      visual.pageY === layout.pageY;
    assert.ok(supported, `data_guest_${buttonId}_unsupported_viewport_geometry`);
    const hitX = Math.round(x + layout.pageX);
    const hitY = Math.round(y + layout.pageY);
    diagnostic.hit_document_x = hitX;
    diagnostic.hit_document_y = hitY;
    phase = 'get_node_for_location';
    const hit = await session.send('DOM.getNodeForLocation', {
      x: hitX,
      y: hitY,
      includeUserAgentShadowDOM: true,
      ignorePointerEventsNone: false,
    });
    diagnostic.hit_equal = hit.backendNodeId === node.backendNodeId;
    assert.equal(
      hit.backendNodeId,
      node.backendNodeId,
      `data_guest_${buttonId}_hit_target_changed`,
    );
    phase = 'mouse_click';
    await page.mouse.click(x, y);
    diagnostic.mouse_click_resolved = true;
  } catch (error) {
    firstError = fail(error);
  }
  if (session) {
    try {
      await session.detach();
    } catch (error) {
      if (!firstError) {
        phase = 'detach';
        firstError = fail(error);
      }
    }
  }
  if (firstError) throw firstError;
}

export async function clickPickerDone(page, expectedBackendNodeId = null) {
  await clickPickerButton(page, 'done', expectedBackendNodeId);
}

export async function clickPickerCancel(page) {
  await clickPickerButton(page, 'cancel');
}

export async function clickPickerClear(page) {
  await clickPickerButton(page, 'clear');
}
