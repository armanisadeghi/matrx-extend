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
    else if (kind === 'port') candidates = [...document.querySelectorAll('input[placeholder="auto"]')];
    else if (kind === 'switch') candidates = [...document.querySelectorAll('[role="switch"][aria-label]')]
      .filter((el) => el.getAttribute('aria-label') === label);
    else if (kind === 'option') candidates = [...document.querySelectorAll('[role="option"]')]
      .filter((el) => el.textContent.trim() === label);
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
    const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    const hitTarget = hit === target || target.contains(hit);
    const scroller = [target, ...(() => {
      const ancestors = []; for (let el = target.parentElement; el; el = el.parentElement) ancestors.push(el);
      return ancestors;
    })()].find((el) => {
      const style = getComputedStyle(el);
      return /auto|scroll/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1;
    });
    const scrollRect = scroller?.getBoundingClientRect();
    const describe = (el) => el ? { tag: el.tagName, role: el.getAttribute('role'),
      className: String(el.className), pointerEvents: getComputedStyle(el).pointerEvents } : null;
    const scrollState = { top: scroller?.scrollTop ?? null,
      height: scroller?.clientHeight ?? null, contentHeight: scroller?.scrollHeight ?? null,
      rect: scrollRect ? { x: scrollRect.x, y: scrollRect.y,
        width: scrollRect.width, height: scrollRect.height } : null,
      hit: describe(hit), container: describe(scroller),
      bodyOverflow: getComputedStyle(document.body).overflow,
      bodyPointerEvents: getComputedStyle(document.body).pointerEvents,
      bodyScrollLocked: document.body.getAttribute('data-scroll-locked'),
      openListboxes: document.querySelectorAll('[role="listbox"]').length };
    let animating = false;
    for (let ancestor = target; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.getAnimations({ subtree: false }).some((animation) => animation.playState === 'running')) {
        animating = true;
        break;
      }
    }
    return { count: 1, x, y, hitTarget, animating,
      viewport: { width: innerWidth, height: innerHeight },
      scrollState, hitTag: hit?.tagName ?? null };
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
  assert.equal(
    stableSamples >= 2,
    true,
    `stable hit target for ${kind} ${label}: ${JSON.stringify(location)}`,
  );
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
}
