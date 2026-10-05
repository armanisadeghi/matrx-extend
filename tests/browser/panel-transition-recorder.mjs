// Passive, renderer-local timing for the bounded authenticated transition only.
// No page text, URL, identity, coordinates, or transport errors enter the receipt.
import { evaluate } from './settings-panel-driver.mjs';

const KEY = '__matrxPanelTransitionRecorder';
const PHASES = new Set([
  'before_health',
  'after_health',
  'organization_entry',
  'organization_select',
  'organization_skip',
  'pointer_before',
  'pointer_after',
  'after_organization',
]);

async function read(panel, expression) {
  try {
    return await evaluate(panel, expression);
  } catch {
    return null;
  }
}

export async function startPanelTransitionRecorder(panel) {
  const started = await read(
    panel,
    `(() => {
    const key = '${KEY}';
    if (window[key]) return false;
    const events = [];
    const sample = (kind) => events.push({ kind, ms: performance.now(),
      visibility: document.visibilityState === 'visible' ? 'visible' :
        document.visibilityState === 'hidden' ? 'hidden' : 'other' });
    const onVisibility = () => sample('visibilitychange');
    document.addEventListener('visibilitychange', onVisibility);
    window[key] = { events, onVisibility, sample };
    sample('start');
    return true;
  })()`,
  );
  if (started !== true) return { status: 'unavailable', events: [] };
  let stopped = false;
  let complete = true;
  return {
    async mark(phase) {
      if (stopped || !PHASES.has(phase)) return;
      const marked = await read(
        panel,
        `(() => {
        const recorder = window['${KEY}'];
        if (!recorder) return false;
        recorder.sample('${phase}');
        return true;
      })()`,
      );
      if (marked !== true) complete = false;
    },
    async stop() {
      if (stopped) return { status: 'unavailable', events: [] };
      stopped = true;
      const result = await read(
        panel,
        `(() => {
        const recorder = window['${KEY}'];
        if (!recorder) return null;
        recorder.sample('stop');
        document.removeEventListener('visibilitychange', recorder.onVisibility);
        delete window['${KEY}'];
        return recorder.events;
      })()`,
      );
      if (
        !complete ||
        !Array.isArray(result) ||
        result[0]?.kind !== 'start' ||
        result.at(-1)?.kind !== 'stop' ||
        !result.every(
          (event, index) =>
            typeof event?.kind === 'string' &&
            Number.isFinite(event.ms) &&
            ['visible', 'hidden', 'other'].includes(event.visibility) &&
            (index === 0 || event.ms >= result[index - 1].ms),
        )
      )
        return { status: 'unavailable', events: [] };
      return { status: 'measured', events: result };
    },
  };
}

export function traceOrganizationPointers(panel, recorder) {
  const send = async (...args) => {
    const dispatch = () => Reflect.apply(Reflect.get(panel, 'send', panel), panel, args);
    if (args[0] !== 'Input.dispatchMouseEvent') return dispatch();
    await recorder.mark?.('pointer_before');
    try {
      return await dispatch();
    } finally {
      await recorder.mark?.('pointer_after');
    }
  };
  // A connection can own a frozen send property. Proxying that object would make
  // replacement of send violate the Proxy get invariant.
  return new Proxy(Object.create(null), {
    get(_facade, key) {
      if (key === 'send') return send;
      const value = Reflect.get(panel, key, panel);
      return typeof value === 'function' ? value.bind(panel) : value;
    },
  });
}

export function classifyPanelTransition(result) {
  if (result?.status !== 'measured') return 'unmeasured';
  const events = result.events;
  const hidden = events.findIndex(
    (event) => event.kind === 'visibilitychange' && event.visibility === 'hidden',
  );
  if (hidden < 0)
    return events.some((event) => event.visibility === 'hidden') ? 'unmeasured' : 'no_hidden_event';
  const prior = events.slice(0, hidden).map((event) => event.kind);
  if (
    prior.includes('pointer_before') &&
    prior.lastIndexOf('pointer_before') > prior.lastIndexOf('pointer_after')
  )
    return 'during_pointer_dispatch';
  if (prior.includes('before_health') && !prior.includes('after_health'))
    return 'during_resource_wait';
  return 'outside_recorded_intervals';
}
