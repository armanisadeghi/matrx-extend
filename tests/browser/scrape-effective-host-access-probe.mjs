import { evaluate } from './settings-panel-driver.mjs';

// This function is serialized into the extension panel. Chrome API promises can
// remain pending during host-access transitions; the observation must finish
// before the strict CDP deadline. A timeout is unknown, never proof of denial.
function boundedHostAccessProbe(timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish('unknown'), timeoutMs);
    Promise.resolve()
      .then(async () => {
        if (!chrome.scripting?.executeScript || !chrome.tabs?.query) return finish('unknown');
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        // A late query must not start a new Chrome operation after refusal/cleanup.
        if (settled) return;
        if (!Number.isInteger(tab?.id)) return finish('unknown');
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => true });
        finish('available');
      })
      .catch((error) => {
        const message = String(error?.message ?? '');
        finish(/permission|cannot access|not allowed|host/i.test(message) ? 'denied' : 'unknown');
      });
  });
}

export async function probeEffectiveHostAccess(panel, commandTimeoutMs) {
  if (!Number.isSafeInteger(commandTimeoutMs) || commandTimeoutMs < 2)
    throw new Error('scrape_recovery_probe_deadline_invalid');
  // Derive the in-page observation budget from the configured transport budget,
  // reserving the other half for dispatch/serialization; never extend CDP timeouts.
  const timeoutMs = Math.floor(commandTimeoutMs / 2);
  return evaluate(panel, `(${boundedHostAccessProbe.toString()})(${timeoutMs})`);
}
