import assert from 'node:assert/strict';
import { observeSeoReauditHit } from './guest-seo-click-diagnostic.mjs';
import { click, evaluate, waitFor } from './settings-panel-driver.mjs';

const REFUSAL = JSON.stringify({
  code: '42501',
  message: 'permission denied for table wbx_seo_audit',
  details: null,
  hint: null,
});

export function classifySeoHistoryRequest(request, pageUrl) {
  if (request?.method !== 'GET') return false;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }
  return (
    url.pathname === '/rest/v1/wbx_seo_audit' &&
    url.searchParams.get('url') === `eq.${pageUrl}` &&
    Object.entries(request.headers ?? {}).some(
      ([key, value]) => key.toLowerCase() === 'accept-profile' && value === 'extend',
    )
  );
}

export function requireSeoHistoryRecovery(failure, loading, recovered, requests) {
  assert.equal(requests.failed, 1, 'one real history request received the controlled refusal');
  assert.equal(requests.succeeded, 1, 'Retry history sent a second real request');
  assert.equal(failure?.linked, true, 'failure belongs to active SEO pane');
  assert.equal(failure.toggleCount, 1, 'History remains reachable on failure');
  assert.equal(failure.expanded, true, 'History opens on failure');
  assert.equal(failure.alert, true, 'failure message is rendered');
  assert.equal(failure.retryCount, 1, 'history-specific Retry is rendered');
  assert.equal(failure.empty, false, 'failure never masquerades as empty history');
  assert.equal(loading?.linked, true, 'retry loading belongs to active SEO pane');
  assert.equal(loading.loading, true, 'retry waits for the second response');
  assert.equal(loading.empty, false, 'retry does not invent empty history before response');
  assert.equal(recovered?.linked, true, 'recovery belongs to active SEO pane');
  assert.equal(recovered.toggleCount, 1, 'History remains reachable after retry');
  assert.equal(recovered.expanded, true, 'History remains open after retry');
  assert.equal(recovered.alert, false, 'successful read clears the failure');
  assert.equal(recovered.retryCount, 0, 'successful read clears Retry');
  assert.equal(recovered.empty, true, 'successful empty read renders the empty state');
  return { errorRendered: true, retryFreshRead: true, emptyRendered: true };
}

async function historyState(panel) {
  return evaluate(
    panel,
    `(() => {
    const tabs = [...document.querySelectorAll('button[role="tab"][title="SEO"]')]
      .filter((button) => !button.closest('[role="tabpanel"]'));
    const tab = tabs.length === 1 ? tabs[0] : null;
    const pane = tab && document.getElementById(tab.getAttribute('aria-controls') ?? '');
    const linked = tab?.getAttribute('aria-selected') === 'true' &&
      pane?.getAttribute('data-state') === 'active' &&
      pane?.getAttribute('aria-labelledby') === tab.id;
    const buttons = [...(pane?.querySelectorAll('button') ?? [])];
    const toggles = buttons.filter((button) =>
      button.getAttribute('aria-label') === 'Saved audits for this URL');
    const alerts = [...(pane?.querySelectorAll('[role="alert"]') ?? [])]
      .filter((node) => node.textContent.includes('Saved audits could not load. Try again.'));
    return { linked: linked === true, toggleCount: toggles.length,
      expanded: toggles[0]?.getAttribute('aria-expanded') === 'true',
      alert: alerts.length === 1,
      retryCount: buttons.filter((button) => button.textContent.trim() === 'Retry history').length,
      empty: [...(pane?.querySelectorAll('div') ?? [])].some((node) =>
        node.textContent.trim() === 'No saved audits for this URL.' &&
        !node.querySelector('div')),
      loading: (pane?.innerText ?? '').includes('Loading saved audits') };
  })()`,
  );
}

// Only the precise owned-page history GET is intercepted. The panel, Supabase
// query builder, fetch, React state, trusted clicks and rendered DOM stay real.
export async function runNativeSeoHistoryRecovery({
  panel,
  page,
  onStage = () => {},
  onHit = () => {},
}) {
  const pageUrl = new URL('/seo-metadata-article', page.url()).href;
  let failed = 0;
  let succeeded = 0;
  let interceptionFailure = false;
  let retryPending = false;
  let releaseSuccess;
  const successGate = new Promise((resolve) => {
    releaseSuccess = resolve;
  });
  const pending = new Set();
  const off = panel.on('Fetch.requestPaused', (event) => {
    const task = (async () => {
      const own = classifySeoHistoryRequest(event.request, pageUrl);
      if (!own) return panel.send('Fetch.continueRequest', { requestId: event.requestId });
      const first = failed === 0;
      if (!first) {
        retryPending = true;
        await successGate;
      }
      await panel.send('Fetch.fulfillRequest', {
        requestId: event.requestId,
        responseCode: first ? 403 : 200,
        responseHeaders: [
          { name: 'Content-Type', value: 'application/json' },
          { name: 'Access-Control-Allow-Origin', value: '*' },
        ],
        body: Buffer.from(first ? REFUSAL : '[]').toString('base64'),
      });
      if (first) failed += 1;
      else succeeded += 1;
    })();
    pending.add(task);
    void task
      .catch(() => {
        interceptionFailure = true;
      })
      .finally(() => pending.delete(task));
  });
  await panel.send('Fetch.enable', {
    patterns: [{ urlPattern: '*://*/rest/v1/wbx_seo_audit*', requestStage: 'Request' }],
  });
  try {
    onStage('history_fault_armed');
    const response = await page.goto(pageUrl, { waitUntil: 'load' });
    assert.equal(response?.status(), 200, 'owned SEO page loaded');
    await waitFor(
      'seo_main_tab_ready',
      () => evaluate(panel, `document.querySelectorAll('button[role="tab"][title="SEO"]').length`),
      (count) => count === 1,
    );
    const selected = await evaluate(
      panel,
      `document.querySelector('button[role="tab"][title="SEO"]')?.getAttribute('aria-selected') === 'true'`,
    );
    if (!selected) await click(panel, 'title', 'SEO');
    onStage('history_error_wait');
    await waitFor(
      'history_refusal_intercepted',
      async () => ({ failed, interceptionFailure }),
      (state) => state.failed === 1 || state.interceptionFailure,
      15000,
    );
    assert.equal(interceptionFailure, false, 'history CDP response was delivered');
    await click(panel, 'title', 'Saved audits for this URL');
    const failure = await waitFor(
      'history_error_rendered',
      () => historyState(panel),
      (state) => state?.linked && state.expanded && state.alert && state.retryCount === 1,
      15000,
    );
    onHit('history_refused', await observeSeoReauditHit(panel));
    onStage('history_retry_click');
    await click(panel, 'title', 'Read saved audits for this URL again.');
    const loading = await waitFor(
      'history_retry_waiting_for_response',
      () => historyState(panel),
      (state) => retryPending && state?.linked && state.loading && !state.empty,
      15000,
    );
    releaseSuccess();
    const recovered = await waitFor(
      'history_empty_after_retry',
      () => historyState(panel),
      (state) => state?.linked && state.expanded && state.empty && !state.alert && succeeded === 1,
      15000,
    );
    onHit('history_recovered', await observeSeoReauditHit(panel));
    assert.equal(interceptionFailure, false, 'history retry CDP response was delivered');
    return requireSeoHistoryRecovery(failure, loading, recovered, { failed, succeeded });
  } finally {
    releaseSuccess();
    try {
      await panel.send('Fetch.disable');
    } finally {
      off();
      await Promise.allSettled([...pending]);
    }
  }
}
