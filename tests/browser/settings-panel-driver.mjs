import assert from 'node:assert/strict';

// DOM observation/viewport preparation plus trusted CDP input in the owned panel.
export async function evaluate(panel, expression) {
  const response = await panel.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) throw new Error('panel_runtime_exception');
  return response.result?.value;
}

export async function waitFor(label, read, accept, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  do {
    try {
      last = await read();
    } catch (error) {
      // A panel reload briefly destroys its JavaScript execution context.
      last = { transient: String(error?.message ?? error) };
    }
    if (accept(last)) return last;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  } while (Date.now() < deadline);
  throw new Error(`${label}_not_observed:${JSON.stringify(last)}`);
}

export async function openSection(panel, label) {
  const section = await waitFor(
    `${label}_section_ready`,
    () =>
      evaluate(
        panel,
        `(() => {
    const buttons = [...document.querySelectorAll('button[aria-expanded]')]
      .filter((el) => el.textContent.trim() === ${JSON.stringify(label)});
    return { count: buttons.length, expanded: buttons[0]?.getAttribute('aria-expanded') ?? null };
  })()`,
      ),
    (state) => state?.count === 1 && (state.expanded === 'true' || state.expanded === 'false'),
  );
  const expanded = section.expanded;
  if (expanded === 'false') await click(panel, 'section', label);
  await waitFor(
    `${label}_expanded`,
    () =>
      evaluate(
        panel,
        `(() =>
    [...document.querySelectorAll('button[aria-expanded]')]
      .find((el) => el.textContent.trim() === ${JSON.stringify(label)})
      ?.getAttribute('aria-expanded'))()`,
      ),
    (value) => value === 'true',
  );
}

export async function click(panel, kind, label) {
  const pointerSample = () =>
    evaluate(
      panel,
      `(() => {
    const kind = ${JSON.stringify(kind)}, label = ${JSON.stringify(label)};
    const visible = (el) => {
      const style = getComputedStyle(el), rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' &&
        style.display !== 'none' && !el.closest('[inert]');
    };
    let candidates;
    if (kind === 'title') candidates = [...document.querySelectorAll('button[title]')]
      .filter((el) => el.title === label);
    else if (kind === 'section') candidates = [...document.querySelectorAll('button[aria-expanded]')]
      .filter((el) => el.textContent.trim() === label);
    else if (kind === 'theme') candidates = [...document.querySelectorAll('span')]
      .filter((el) => el.textContent.trim() === 'Theme')
      .flatMap((el) => [...el.parentElement.parentElement.querySelectorAll('button[role="combobox"]')]);
    else if (kind === 'organization') candidates = [...document.querySelectorAll('span')]
      .filter((el) => el.textContent.trim() === 'Acting as')
      .flatMap((el) => [...el.parentElement.parentElement.querySelectorAll('button[role="combobox"]')]);
    else if (kind === 'capture-no-workspace-dismiss') candidates = [...document.querySelectorAll('[role="alert"]')]
      .filter((el) => el.querySelector('.font-medium')?.textContent.trim() === 'Capture list unavailable'
        && el.querySelector('p')?.textContent.includes('no workspace is selected, so the request was never sent'))
      .flatMap((el) => [...el.querySelectorAll('button[aria-label="Dismiss"]')]);
    else if (kind === 'port') candidates = [...document.querySelectorAll('input[placeholder="auto"]')];
    else if (kind === 'switch') candidates = [...document.querySelectorAll('[role="switch"][aria-label]')]
      .filter((el) => el.getAttribute('aria-label') === label);
    else if (kind === 'option') candidates = [...document.querySelectorAll('[role="option"]')]
      .filter((el) => el.textContent.trim() === label);
    else if (kind === 'organization-picker-choice') candidates = [...document.querySelectorAll('[role="dialog"]')]
      .filter((el) => el.textContent.includes('Which organization are you working in?'))
      .flatMap((el) => [...el.querySelectorAll('button[role="option"]')])
      .filter((el) => [...el.querySelectorAll('span.truncate')]
        .some((name) => name.textContent.trim() === label));
    else if (kind === 'dialog') candidates = [...document.querySelectorAll('[role="alertdialog"]')]
      .filter((el) => el.querySelector('[data-slot="alert-dialog-title"]')?.textContent.trim() === 'Clear local data?')
      .flatMap((el) => [...el.querySelectorAll('button')])
      .filter((el) => el.textContent.trim() === label);
    else candidates = [...document.querySelectorAll('button')]
      .filter((el) => el.textContent.trim() === label);
    candidates = candidates.filter(visible);
    if (candidates.length !== 1) return { count: candidates.length };
    const target = candidates[0];
    // Viewport preparation is not the acceptance action. Reposition on every
    // sample because an expanding section can invalidate a one-shot scroll.
    // Never click unless the real target subsequently passes hit-testing.
    target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const rect = target.getBoundingClientRect();
    // A viewport-visible center can still lie outside a nested overflow clip.
    // Intersect every clipping ancestor, then use only points that the browser
    // says actually hit this target. Never dismiss an overlay or invoke click().
    const bounds = { left: Math.max(0, rect.left), top: Math.max(0, rect.top),
      right: Math.min(innerWidth, rect.right), bottom: Math.min(innerHeight, rect.bottom) };
    let clippingAncestors = 0;
    for (let ancestor = target.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor), box = ancestor.getBoundingClientRect();
      const clips = (overflow) => /^(auto|scroll|hidden|clip)$/.test(overflow);
      if (clips(style.overflowX)) {
        bounds.left = Math.max(bounds.left, box.left + ancestor.clientLeft);
        bounds.right = Math.min(bounds.right, box.left + ancestor.clientLeft + ancestor.clientWidth);
      }
      if (clips(style.overflowY)) {
        clippingAncestors++;
        bounds.top = Math.max(bounds.top, box.top + ancestor.clientTop);
        bounds.bottom = Math.min(bounds.bottom, box.top + ancestor.clientTop + ancestor.clientHeight);
      }
    }
    const originalCenter = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    const centerHit = document.elementFromPoint(originalCenter.x, originalCenter.y);
    const hitsTarget = (hit) => Boolean(hit && (hit === target || target.contains(hit)));
    const points = [];
    if (bounds.right > bounds.left && bounds.bottom > bounds.top) {
      for (const fy of [0.5, 0.25, 0.75]) for (const fx of [0.5, 0.25, 0.75]) {
        points.push({ x: bounds.left + (bounds.right - bounds.left) * fx,
          y: bounds.top + (bounds.bottom - bounds.top) * fy });
      }
    }
    const selected = points.find((point) => hitsTarget(document.elementFromPoint(point.x, point.y)));
    const { x, y } = selected ?? originalCenter;
    const hitTarget = Boolean(selected) && !target.disabled;
    const hitCategory = (hit) => {
      if (!hit) return 'none';
      if (hitsTarget(hit)) return 'target';
      if (hit.closest('[role="alertdialog"], [role="dialog"]')) return 'dialog';
      if (hit.closest('[role="listbox"]')) return 'listbox';
      if (hit.closest('[data-slot="alert-dialog-overlay"], [data-slot="dialog-overlay"]')) return 'modal_overlay';
      if (hit.contains(target)) return 'target_ancestor';
      if (hit.closest('header, [role="tablist"]')) return 'header_or_tabs';
      return 'other_element';
    };
    // Fixed categories and geometry only: never element text, attributes,
    // class names, form values, URL, or screenshot contents.
    const pointerDiagnostic = {
      target_rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      clipped_rect: { x: bounds.left, y: bounds.top,
        width: Math.max(0, bounds.right - bounds.left), height: Math.max(0, bounds.bottom - bounds.top) },
      viewport: { width: innerWidth, height: innerHeight },
      clipping_ancestor_count: clippingAncestors,
      tested_point_count: points.length,
      center_hit_category: hitCategory(centerHit),
      selected_point_available: Boolean(selected),
      selected_point: selected ?? null,
      target_disabled: Boolean(target.disabled),
      target_pointer_events_none: getComputedStyle(target).pointerEvents === 'none',
    };
    let animating = false;
    for (let ancestor = target; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.getAnimations({ subtree: false }).some((animation) => animation.playState === 'running')) {
        animating = true;
        break;
      }
    }
    return { count: 1, x, y, hitTarget, animating,
      viewport: { width: innerWidth, height: innerHeight },
      pointerDiagnostic };
  })()`,
    );
  let location = await pointerSample();
  assert.equal(location?.count, 1, `unique visible ${kind} ${label}`);
  // Poll outside the page: a paused requestAnimationFrame must not strand
  // Runtime.evaluate(awaitPromise) or hide the last pointer diagnostic.
  const deadline = Date.now() + 3000;
  let previous;
  let stableSamples = 0;
  do {
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    try {
      location = await pointerSample();
    } catch (error) {
      throw new Error(
        `pointer_sample_failed for ${kind} ${label}: ${String(error?.message ?? error)}; last=${JSON.stringify(location)}`,
      );
    }
    stableSamples =
      location?.count === 1 &&
      location.hitTarget &&
      !location.animating &&
      previous !== undefined &&
      Math.abs(previous.x - location.x) < 0.25 &&
      Math.abs(previous.y - location.y) < 0.25
        ? stableSamples + 1
        : 0;
    location = { ...location, stableSamples };
    if (stableSamples >= 2) break;
    previous = location?.count === 1 ? { x: location.x, y: location.y } : undefined;
  } while (Date.now() < deadline);
  if (stableSamples < 2) {
    const error = new Error(`stable hit target for ${kind} ${label}`);
    error.pointerDiagnostic = location?.pointerDiagnostic ?? { sample_unavailable: true };
    throw error;
  }
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: location.x,
    y: location.y,
    button: 'left',
    clickCount: 1,
  });
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: location.x,
    y: location.y,
    button: 'left',
    clickCount: 1,
  });
  if (kind === 'port') {
    const focused = await evaluate(
      panel,
      `(() => {
      const input = document.querySelector('input[placeholder="auto"]');
      return input !== null && document.activeElement === input;
    })()`,
    );
    assert.equal(
      focused,
      true,
      `real mouse click focused port input: ${JSON.stringify({ location, focused })}`,
    );
  }
  return location.pointerDiagnostic;
}
