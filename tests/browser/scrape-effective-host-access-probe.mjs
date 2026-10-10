import { evaluate } from './settings-panel-driver.mjs';

// Serialized into the panel. Withheld permissions can leave executeScript pending;
// only a settled permission rejection proves denial. Never dispatch after timeout.
function boundedHostAccessProbe(timeoutMs, expectedUrl) {
  return new Promise((resolve) => {
    let settled = false;
    let operation = 'api_check';
    const finish = (access, outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ access, operation, outcome });
    };
    const timer = setTimeout(() => finish('unknown', 'timed_out'), timeoutMs);
    Promise.resolve()
      .then(async () => {
        if (!chrome.scripting?.executeScript || !chrome.tabs?.query)
          return finish('unknown', 'api_missing');
        operation = 'tabs_query';
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (settled) return;
        if (!Number.isInteger(tab?.id)) return finish('unknown', 'tab_missing');
        if (expectedUrl !== null && tab.url !== expectedUrl)
          return finish('unknown', 'tab_mismatch');
        operation = 'execute_script';
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => true });
        finish('available', 'resolved');
      })
      .catch((error) => {
        const message = String(error?.message ?? '');
        // Chromium PermissionsData::CanRunOnPage returns exactly "Blocked" for
        // USER_RESTRICTED origins. Never interpret query failures as injection denial.
        const denied =
          operation === 'execute_script' &&
          (message === 'Blocked' || /permission|cannot access|not allowed|host/i.test(message));
        finish(denied ? 'denied' : 'unknown', 'rejected');
      });
  });
}

export async function probeEffectiveHostAccess(
  panel,
  commandTimeoutMs,
  { expectedUrl = null, onObservation = () => {} } = {},
) {
  if (!Number.isSafeInteger(commandTimeoutMs) || commandTimeoutMs < 2)
    throw new Error('scrape_recovery_probe_deadline_invalid');
  const timeoutMs = Math.floor(commandTimeoutMs / 2);
  const result = await evaluate(
    panel,
    `(${boundedHostAccessProbe.toString()})(${timeoutMs}, ${JSON.stringify(expectedUrl)})`,
  );
  const access = ['available', 'denied'].includes(result?.access) ? result.access : 'unknown';
  onObservation({
    phase: 'effective_host_access_probe',
    operation: ['api_check', 'tabs_query', 'execute_script'].includes(result?.operation)
      ? result.operation
      : 'unknown',
    outcome: [
      'timed_out',
      'api_missing',
      'tab_missing',
      'tab_mismatch',
      'resolved',
      'rejected',
    ].includes(result?.outcome)
      ? result.outcome
      : 'unknown',
    access,
  });
  return access;
}
