import assert from 'node:assert/strict';
import { evaluate, waitFor } from './settings-panel-driver.mjs';

export async function installFault(panel, mode) {
  const installed = await evaluate(
    panel,
    `(() => {
    if (window.__prepareFault) return false;
    const original = chrome.scripting.executeScript;
    const native = original.bind(chrome.scripting);
    const fault = { calls: 0, held: false, settled: false, release: null };
    const wrapper = (details) => {
      if (!details?.target?.documentIds || !details?.args?.[0] ||
          typeof details.args[0].scrollToBottom !== 'boolean') return native(details);
      fault.calls++;
      if (fault.calls !== 1) return native(details);
      if (${JSON.stringify(mode)} === 'reject')
        return Promise.reject(new Error('Controlled Prepare rejection'));
      return native(details).then((result) => new Promise((resolve, reject) => {
        fault.held = true;
        fault.release = () => {
          fault.held = false;
          if (${JSON.stringify(mode)} === 'hold_reject') reject(new Error('Controlled Prepare rejection'));
          else resolve(result);
        };
      })).finally(() => { fault.settled = true; });
    };
    chrome.scripting.executeScript = wrapper;
    if (chrome.scripting.executeScript !== wrapper) return false;
    window.__prepareFault = {
      state: () => ({ calls: fault.calls, held: fault.held, settled: fault.settled }),
      release: () => fault.release?.(),
      restore: () => { chrome.scripting.executeScript = original; },
    };
    return true;
  })()`,
  );
  assert.equal(installed, true, 'prepare_fault_boundary_unavailable');
}

export async function faultState(panel) {
  return evaluate(panel, '(() => window.__prepareFault?.state() ?? null)()');
}

export async function releaseFault(panel, readState, onStage = () => {}) {
  onStage('execute_release');
  await evaluate(panel, '(() => { window.__prepareFault?.release(); return true; })()');
  onStage('response_settlement');
  await waitFor(
    'prepare_response_settled',
    () => faultState(panel),
    (state) => state?.settled === true,
  );
  // A hidden native panel can pause animation frames. Observe after the actual
  // intercepted promise settled, using external polling so React can commit.
  // Two identical observations retain the late-result stability check.
  onStage('post_settlement_ui');
  let previous;
  await waitFor('prepare_post_settlement_ui_stable', readState, (state) => {
    const fingerprint = JSON.stringify(state);
    const stable = previous !== undefined && previous === fingerprint;
    previous = fingerprint;
    return stable;
  });
  await evaluate(
    panel,
    '(() => { window.__prepareFault?.restore(); delete window.__prepareFault; return true; })()',
  );
  onStage('complete');
}
