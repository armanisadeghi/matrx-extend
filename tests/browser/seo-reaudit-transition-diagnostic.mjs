import { evaluate } from './settings-panel-driver.mjs';

const STAGES = new Set([
  'before_click',
  'click_event',
  'dom_transition',
  'after_release',
  'running_wait',
  'settle_wait',
  'finished',
]);
const OPERATIONS = new Set(['manual_reaudit_running_wait', 'manual_reaudit_settle_wait']);
const FLAGS = [
  'scopeValid',
  'auditButtonPresent',
  'auditButtonDisabled',
  'auditSpinner',
  'reAudit',
  'error',
];
const flag = (value) => (typeof value === 'boolean' ? value : null);
const count = (value) =>
  Number.isSafeInteger(value) && value >= 0 && value <= 1000000 ? value : null;
export function safeReauditState(value) {
  return Object.fromEntries(FLAGS.map((key) => [key, flag(value?.[key])]));
}

export function safeReauditTrace(trace) {
  return {
    observer_available: flag(trace?.observer_available),
    sample_count: count(trace?.sample_count),
    dropped_samples: count(trace?.dropped_samples),
    samples: (Array.isArray(trace?.samples) ? trace.samples : []).slice(-64).map((sample) => ({
      stage: STAGES.has(sample.stage) ? sample.stage : null,
      elapsed_ms: count(sample.elapsed_ms),
      click_trusted: flag(sample.click_trusted),
      ...safeReauditState(sample),
    })),
    ...(trace?.failure && {
      failure: {
        operation: OPERATIONS.has(trace.failure.operation) ? trace.failure.operation : null,
        code: trace.failure.code === 'wait_timeout' ? 'wait_timeout' : 'wait_failed',
        last_state: safeReauditState(trace.failure.last_state),
      },
    }),
  };
}

// A poll can miss a complete DOM commit cycle between pointer release and its
// first read. Only the preinstalled observer can witness that cycle; a final
// idle snapshot or an untrusted scripted click cannot substitute for it.
export function reauditTransitionWitness(trace, runningTimeoutMs, settleTimeoutMs) {
  const unavailable = { runningObserved: false, settledObserved: false };
  if (trace?.observer_available !== true) return unavailable;
  const samples = trace.samples ?? [];
  let baseline = false;
  let clickedAt = null;
  let runningAt = null;
  let settled = false;
  let previousTime = -1;
  for (const sample of samples) {
    const time = sample.elapsed_ms;
    if (!Number.isSafeInteger(time) || time < previousTime) return unavailable;
    previousTime = time;
    const scoped = sample.scopeValid === true && sample.auditButtonPresent === true;
    const idle =
      scoped &&
      sample.auditButtonDisabled === false &&
      sample.auditSpinner === false &&
      sample.reAudit === true &&
      sample.error === false;
    if (sample.stage === 'before_click' && idle) baseline = true;
    if (sample.stage === 'click_event') {
      if (!baseline || !idle || sample.click_trusted !== true || clickedAt !== null)
        return unavailable;
      clickedAt = time;
    }
    if (sample.stage !== 'dom_transition' || clickedAt === null) continue;
    if (
      runningAt === null &&
      scoped &&
      sample.auditButtonDisabled === true &&
      sample.auditSpinner === true &&
      sample.reAudit === false &&
      sample.error === false &&
      time - clickedAt <= runningTimeoutMs
    )
      runningAt = time;
    else if (runningAt !== null && idle && time - runningAt <= settleTimeoutMs) settled = true;
  }
  return { runningObserved: runningAt !== null, settledObserved: settled };
}

export function reauditSettledOnCurrentPage(trace, state, expectedTitle, pageUrlMatches) {
  return (
    reauditTransitionWitness(trace, 10000, 30000).settledObserved &&
    state?.scopeValid === true &&
    state.auditButtonPresent === true &&
    state.auditButtonDisabled === false &&
    state.auditSpinner === false &&
    state.reAudit === true &&
    state.error === false &&
    state.title === expectedTitle &&
    pageUrlMatches === true
  );
}

export function captureReauditWaitFailure(error, operation, lastState) {
  return {
    operation: OPERATIONS.has(operation) ? operation : null,
    code:
      OPERATIONS.has(operation) &&
      typeof error?.message === 'string' &&
      error.message.startsWith(`${operation}_not_observed:`)
        ? 'wait_timeout'
        : 'wait_failed',
    last_state: safeReauditState(lastState),
  };
}

// Runs in the owned panel. Observe DOM commits before pointer dispatch so a
// busy->idle transition between the release and first poll remains visible.
// Acceptance consumes ordered transitions plus a separate current-page check.
export function installReauditObserver() {
  const key = '__matrxSeoReauditTrace';
  globalThis[key]?.observer?.disconnect();
  if (globalThis[key]?.onClick)
    document.removeEventListener('click', globalThis[key].onClick, true);
  const started = performance.now();
  const trace = { observer_available: true, sample_count: 0, dropped_samples: 0, samples: [] };
  let previous = '';
  function sample(stage, clickTrusted = null) {
    const tabs = [...document.querySelectorAll('button[role="tab"][title="SEO"]')].filter(
      (node) => !node.closest('[role="tabpanel"]'),
    );
    const tab = tabs.length === 1 ? tabs[0] : null;
    const pane = tab && document.getElementById(tab.getAttribute('aria-controls') ?? '');
    const active =
      tab?.getAttribute('aria-selected') === 'true' &&
      pane?.getAttribute('data-state') === 'active';
    const button = active
      ? [...pane.querySelectorAll('button')].find((node) =>
          /^(Audit this page|Re-audit)$/.test(node.textContent.trim()),
        )
      : null;
    const state = {
      scopeValid: active === true,
      auditButtonPresent: !!button,
      auditButtonDisabled: button?.disabled ?? null,
      auditSpinner: !!button?.querySelector('svg.animate-spin'),
      reAudit: !!button && button.textContent.trim() === 'Re-audit' && !button.disabled,
      error:
        active === true &&
        [...pane.querySelectorAll('div')].some((node) =>
          /^Audit failed:|^This page cannot be audited/.test(node.textContent.trim()),
        ),
    };
    const signature = JSON.stringify(state);
    if (stage === 'dom_transition' && signature === previous) return;
    previous = signature;
    trace.sample_count++;
    trace.samples.push({
      stage,
      click_trusted: clickTrusted,
      elapsed_ms: Math.round(performance.now() - started),
      ...state,
    });
    // Retain the first 32 and newest 32 samples so early click/fast-cycle
    // evidence survives a timeout with many polls. Announce any truncation.
    if (trace.samples.length > 64) {
      trace.samples.splice(32, 1);
      trace.dropped_samples++;
    }
  }
  const observer = new MutationObserver(() => sample('dom_transition'));
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  const onClick = (event) => {
    const button = event.target?.closest?.('button');
    const pane = button?.closest('[role="tabpanel"]');
    if (
      pane?.getAttribute('data-state') === 'active' &&
      document
        .querySelector('button[role="tab"][title="SEO"][aria-selected="true"]')
        ?.getAttribute('aria-controls') === pane.id &&
      button.textContent.trim() === 'Re-audit'
    )
      sample('click_event', event.isTrusted === true);
  };
  document.addEventListener('click', onClick, true);
  globalThis[key] = { trace, sample, observer, onClick };
  sample('before_click');
  return trace;
}

export async function startSeoReauditTrace(panel, report, checkpoint = () => {}) {
  const save = async (stage, stop = false) => {
    try {
      const value = await evaluate(
        panel,
        `(() => {
        const holder = globalThis.__matrxSeoReauditTrace;
        if (!holder) return { observer_available: false };
        holder.sample(${JSON.stringify(stage)});
        ${stop ? 'holder.observer.disconnect(); document.removeEventListener("click", holder.onClick, true); delete globalThis.__matrxSeoReauditTrace;' : ''}
        return holder.trace;
      })()`,
      );
      const failure = report.reaudit_transition_diagnostic?.failure;
      report.reaudit_transition_diagnostic = safeReauditTrace({
        ...value,
        ...(failure && { failure }),
      });
    } catch {
      report.reaudit_transition_diagnostic ??= safeReauditTrace({ observer_available: false });
      report.reaudit_transition_diagnostic.observer_available = false;
    }
    checkpoint();
  };
  try {
    report.reaudit_transition_diagnostic = safeReauditTrace(
      await evaluate(panel, `(${installReauditObserver.toString()})()`),
    );
  } catch {
    report.reaudit_transition_diagnostic = safeReauditTrace({ observer_available: false });
  }
  checkpoint();
  return { sample: save, stop: () => save('finished', true) };
}
