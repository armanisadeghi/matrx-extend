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
  return {
    async mark(phase) {
      if (stopped || !PHASES.has(phase)) return;
      await read(
        panel,
        `(() => {
        const recorder = window['${KEY}'];
        if (!recorder) return false;
        recorder.sample('${phase}');
        return true;
      })()`,
      );
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
        !Array.isArray(result) ||
        !result.every(
          (event) =>
            typeof event?.kind === 'string' &&
            typeof event.ms === 'number' &&
            ['visible', 'hidden', 'other'].includes(event.visibility),
        )
      )
        return { status: 'unavailable', events: [] };
      return { status: 'measured', events: result };
    },
  };
}

export function traceOrganizationPointers(panel, recorder) {
  return new Proxy(panel, {
    get(target, key) {
      if (key !== 'send') return Reflect.get(target, key);
      return async (method, args) => {
        if (method !== 'Input.dispatchMouseEvent') return target.send(method, args);
        await recorder.mark?.('pointer_before');
        try {
          return await target.send(method, args);
        } finally {
          await recorder.mark?.('pointer_after');
        }
      };
    },
  });
}

export function classifyPanelTransition(result) {
  if (result?.status !== 'measured') return 'unmeasured';
  const events = result.events;
  const hidden = events.findIndex(
    (event) => event.kind === 'visibilitychange' && event.visibility === 'hidden',
  );
  if (hidden < 0) return 'no_hidden_event';
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
