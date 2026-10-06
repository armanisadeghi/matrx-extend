export function listStateExpression() {
  return `(() => {
    const outer = [...document.querySelectorAll('button[role="tab"][title="Showcase (admin only)"][data-state="active"]')];
    const pane = outer.length === 1 ? document.getElementById(outer[0].getAttribute('aria-controls')) : null;
    const tab = [...(pane?.querySelectorAll('button[role="tab"]') ?? [])]
      .find(el => el.textContent.trim() === 'List Pattern' && el.getAttribute('data-state') === 'active');
    const content = tab ? document.getElementById(tab.getAttribute('aria-controls')) : null;
    const text = content?.innerText ?? '';
    return { ready: Boolean(content && content.getAttribute('data-state') === 'active'),
      start: [...(content?.querySelectorAll('button') ?? [])].some(el => el.textContent.trim() === 'Pick an example item' && !el.disabled),
      picking: text.includes('Picking on page…'),
      cancel: [...(content?.querySelectorAll('button') ?? [])].some(el => el.textContent.trim() === 'Cancel'),
      extract: [...(content?.querySelectorAll('button') ?? [])].some(el => el.textContent.trim() === 'Extract' && !el.disabled),
      selectedField: /(?:^|\\n)\\s*1 selected field\\s*(?:\\n|$)/i.test(text),
      rowCount: /(?:^|\\n)\\s*3 rows\\s*(?:\\n|$)/i.test(text),
      hasFirst: text.includes('Neon Nights'), hasSecond: text.includes('Desert Lanterns'),
      hasThird: text.includes('Silver Moon') };
  })()`;
}

async function observeCompletion({ page, readPanel, readRelays }) {
  const sample = {};
  try {
    sample.overlay = await page.evaluate(() => {
      const host = document.querySelector('#matrx-list-picker-host');
      const done = host?.shadowRoot?.querySelector('button#done');
      const rect = done?.getBoundingClientRect();
      const x = rect ? rect.left + rect.width / 2 : 0;
      const y = rect ? rect.top + rect.height / 2 : 0;
      const hit = host?.shadowRoot?.elementFromPoint(x, y);
      return {
        attached: Boolean(host),
        done_present: Boolean(done),
        done_disabled: done?.disabled ?? null,
        done_has_area: Boolean(rect && rect.width > 0 && rect.height > 0),
        done_center_in_viewport: Boolean(
          rect && x >= 0 && x < innerWidth && y >= 0 && y < innerHeight,
        ),
        done_center_hit: Boolean(done && hit && (done === hit || done.contains(hit))),
        picked_count: host?.shadowRoot?.querySelectorAll('.picked-item').length ?? 0,
      };
    });
  } catch {
    sample.overlay_unavailable = true;
  }
  try {
    const state = await readPanel();
    sample.panel = Object.fromEntries(
      [
        'ready',
        'start',
        'picking',
        'cancel',
        'extract',
        'selectedField',
        'rowCount',
        'hasFirst',
        'hasSecond',
        'hasThird',
      ]
        .filter((key) => typeof state?.[key] === 'boolean')
        .map((key) => [key, state[key]]),
    );
  } catch {
    sample.panel_unavailable = true;
  }
  try {
    const events = await readRelays();
    const current = events?.findLast(
      (event) => event.kind === 'data:list-picker-item-detected' && Number.isInteger(event.tab_id),
    );
    sample.relay = {
      observer_available: Array.isArray(events),
      current_detection_stamped: Boolean(current),
      result_raw:
        events?.some(
          (event) =>
            event.kind === 'data:list-picker-result' &&
            event.session_id === current?.session_id &&
            !Number.isInteger(event.tab_id),
        ) ?? false,
      result_stamped:
        events?.some(
          (event) =>
            event.kind === 'data:list-picker-result' &&
            event.session_id === current?.session_id &&
            event.tab_id === current?.tab_id &&
            event.document_id === current?.document_id,
        ) ?? false,
    };
  } catch {
    sample.relay_unavailable = true;
  }
  return sample;
}

// Capture before the native harness detaches the panel and closes its owned page.
// Every action retains its original Playwright/CDP behavior and propagates its error.
export async function runShowcaseCompletionBoundary(options) {
  const entry = {
    stage: options.name,
    status: 'running',
    before: await observeCompletion(options),
  };
  options.diagnostic.boundaries.push(entry);
  try {
    const result = await options.action();
    entry.status = 'passed';
    return result;
  } catch (error) {
    entry.status = 'failed';
    entry.failure_kind = error?.name === 'TimeoutError' ? 'timeout' : 'operation_failed';
    throw error;
  } finally {
    entry.after = await observeCompletion(options);
  }
}
