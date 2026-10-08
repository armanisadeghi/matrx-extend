// Diagnostic-only observer for the replacement worker. Attaching CDP keeps the
// worker alive, and wrapping sidePanel.open may perturb Chrome's gesture path.
// Its evidence can localize a later failure but can never certify acceptance.
const REQUEST_ID = 'native-sidepanel-qa';
export function reloadOpenEvidenceClass(enabled) {
  return {
    enabled,
    evidence_class: enabled ? 'diagnostic_only' : 'acceptance_eligible',
    perturbation: enabled ? 'cdp_worker_attach_and_synchronous_open_wrapper' : 'none',
  };
}

export function refuseDiagnosticAcceptance(report, enabled) {
  if (!enabled) return false;
  report.status = 'unverified';
  report.failure ??= { stage: 'extension_reload', code: 'diagnostic_only_perturbed_worker' };
  return true;
}

const EMPTY = () => ({
  availability: 'unavailable',
  perturbation: 'cdp_worker_attach_and_synchronous_open_wrapper',
  ingress: false,
  open_invoked: false,
  open_settlement: 'unobserved',
  send_response: 'unobservable_without_instrumented_build',
});

const install = `(() => {
  const key = '__matrxReloadOpenDiagnostic';
  if (globalThis[key]) return false;
  const state = { ingress: false, open_invoked: false, open_settlement: 'unobserved' };
  const listener = (message) => {
    if (message?.channel === 'FRONTEND_RPC' && message?.action === 'openPanel' &&
        message?.requestId === '${REQUEST_ID}') state.ingress = true;
    return false;
  };
  const original = chrome.sidePanel.open;
  const wrapped = function (...args) {
    // The existing listener was registered first and calls open synchronously;
    // this listener observes ingress only after that invocation has returned.
    state.open_invoked = true;
    try {
      const result = original.apply(this, args);
      if (result && typeof result.then === 'function')
        result.then(() => { state.open_settlement = 'resolved'; },
          () => { state.open_settlement = 'rejected'; });
      return result;
    } catch (error) {
      state.open_settlement = 'threw';
      throw error;
    }
  };
  chrome.runtime.onMessageExternal.addListener(listener);
  chrome.sidePanel.open = wrapped;
  globalThis[key] = { state, listener, original, wrapped };
  return true;
})()`;

const sample = `(() => {
  const probe = globalThis.__matrxReloadOpenDiagnostic;
  if (!probe) return null;
  return { ingress: probe.state.ingress === true,
    open_invoked: probe.state.open_invoked === true,
    open_settlement: probe.state.open_settlement };
})()`;

const restore = `(() => {
  const key = '__matrxReloadOpenDiagnostic';
  const probe = globalThis[key];
  if (!probe) return false;
  chrome.runtime.onMessageExternal.removeListener(probe.listener);
  if (chrome.sidePanel.open === probe.wrapped) chrome.sidePanel.open = probe.original;
  delete globalThis[key];
  return true;
})()`;

export async function startScrapeReloadOpenDiagnostic(cdp, targetId) {
  const evidence = EMPTY();
  let sessionId;
  try {
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
    const result = await cdp.send(
      'Runtime.evaluate',
      { expression: install, returnByValue: true },
      sessionId,
    );
    if (result?.exceptionDetails || result?.result?.value !== true)
      throw new Error('install_failed');
    evidence.availability = 'ready';
  } catch {
    evidence.availability = 'unavailable';
  }
  return {
    evidence,
    async close() {
      if (sessionId) {
        try {
          const result = await cdp.send(
            'Runtime.evaluate',
            { expression: sample, returnByValue: true },
            sessionId,
          );
          const value = result?.result?.value;
          if (value && typeof value === 'object') {
            evidence.ingress = value.ingress === true;
            evidence.open_invoked = value.open_invoked === true;
            evidence.open_settlement = ['unobserved', 'resolved', 'rejected', 'threw'].includes(
              value.open_settlement,
            )
              ? value.open_settlement
              : 'unobserved';
          }
        } catch {
          evidence.availability = 'sample_failed';
        }
        try {
          await cdp.send(
            'Runtime.evaluate',
            { expression: restore, returnByValue: true },
            sessionId,
          );
        } catch {
          evidence.availability = 'cleanup_unconfirmed';
        }
        try {
          await cdp.send('Target.detachFromTarget', { sessionId });
        } catch {
          evidence.availability = 'cleanup_unconfirmed';
        }
      }
      return { ...evidence };
    },
  };
}

export async function maybeStartScrapeReloadOpenDiagnostic(cdp, targetId, enabled) {
  return enabled ? startScrapeReloadOpenDiagnostic(cdp, targetId) : null;
}
