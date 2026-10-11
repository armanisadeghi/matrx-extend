import assert from 'node:assert/strict';
import { observeSeoReauditHit } from './guest-seo-click-diagnostic.mjs';
import { classifySeoHistoryRequest } from './seo-history-native-recovery.mjs';
import { click, evaluate, waitFor } from './settings-panel-driver.mjs';

function requireClear(sample, count) {
  assert.equal(sample?.active, true, 'reload SEO pane is active');
  assert.equal(sample.target_count, 1, 'reload has one Re-audit target');
  assert.equal(sample.target_enabled, true, 'reload Re-audit is enabled');
  assert.equal(sample.database_refused_notice_count, count, 'controlled reload notice count');
  assert.equal(sample.hit_point_count, 9, 'reload Re-audit owns all nine sampled points');
  assert.equal(sample.notice_hit_point_count, 0, 'reload notice owns no sampled point');
  if (count) assert.equal(sample.dismiss_visible, true, 'reload refusal has visible Dismiss');
}

// Refuse only the actual current-URL history GET. Never inject notice state or DOM.
export async function runForcedNoticeReload({
  panel,
  pageUrl,
  title,
  selectedSeo,
  seoContent,
  io = { click, evaluate, waitFor, hit: observeSeoReauditHit },
}) {
  assert.equal(await io.evaluate(panel, 'innerWidth'), 360, 'forced reload uses native 360px');
  const old = await io.hit(panel);
  if (old.database_refused_notice_count > 0)
    await io.click(panel, 'seo-database-refused-dismiss', 'Dismiss');
  requireClear(
    await io.waitFor(
      'forced_reload_clean_start',
      () => io.hit(panel),
      (s) => s.database_refused_notice_count === 0,
    ),
    0,
  );
  const before = await selectedSeo(panel);
  let refused = 0;
  let failure;
  const pending = new Set();
  const off = panel.on('Fetch.requestPaused', (event) => {
    const task = (async () => {
      if (!classifySeoHistoryRequest(event.request, pageUrl))
        return panel.send('Fetch.continueRequest', { requestId: event.requestId });
      await panel.send('Fetch.fulfillRequest', {
        requestId: event.requestId,
        responseCode: 403,
        responseHeaders: [
          { name: 'Content-Type', value: 'application/json' },
          { name: 'Access-Control-Allow-Origin', value: '*' },
        ],
        body: Buffer.from(
          JSON.stringify({
            code: '42501',
            message: 'permission denied for table wbx_seo_audit',
            details: null,
            hint: null,
          }),
        ).toString('base64'),
      });
      refused += 1;
    })();
    pending.add(task);
    void task
      .catch((error) => {
        failure = error;
      })
      .finally(() => pending.delete(task));
  });
  try {
    await panel.send('Fetch.enable', {
      patterns: [{ urlPattern: '*://*/rest/v1/wbx_seo_audit*', requestStage: 'Request' }],
    });
    await panel.send('Page.reload', { ignoreCache: false });
    const restored = await io.waitFor(
      'forced_reload_new_document',
      () => selectedSeo(panel),
      (s) =>
        s?.mainTablists === 1 &&
        s.seoTabs === 1 &&
        s.documentTimeOrigin > before.documentTimeOrigin,
      30000,
    );
    if (!restored.selected) await io.click(panel, 'title', 'SEO');
    const audit = await io.waitFor(
      'forced_reload_current_audit',
      () => seoContent(panel),
      (s) => s?.scopeValid && s.title === title && s.reAudit && !s.error,
      30000,
    );
    await io.waitFor(
      'forced_reload_actual_refusal',
      async () => ({ refused, failure }),
      (s) => s.refused > 0 || !!s.failure,
      15000,
    );
    assert.equal(failure, undefined, 'controlled response delivered');
    assert.ok(refused > 0, 'real current-URL history GET received refusal after reload');
    const visible = await io.waitFor(
      'forced_reload_visible_notice',
      () => io.hit(panel),
      (s) => s.database_refused_notice_count === 1,
    );
    requireClear(visible, 1);
    await io.evaluate(
      panel,
      `(() => {
      globalThis.__matrxSeoReloadDismiss = null;
      document.addEventListener('click', (event) => {
        const button = event.target?.closest?.('button');
        const alert = button?.closest('[role="alert"]');
        globalThis.__matrxSeoReloadDismiss = {
          trusted: event.isTrusted,
          correctButton: button?.getAttribute('aria-label') === 'Dismiss' &&
            (alert?.textContent ?? '').includes('the database refused the request because your account is not allowed'),
        };
      }, { capture: true, once: true });
    })()`,
    );
    await io.click(panel, 'seo-database-refused-dismiss', 'Dismiss');
    const dismissClick = await io.evaluate(panel, 'globalThis.__matrxSeoReloadDismiss');
    assert.equal(dismissClick?.trusted, true, 'second Dismiss received a trusted click');
    assert.equal(dismissClick?.correctButton, true, 'second click belongs to refusal Dismiss');
    const dismissed = await io.waitFor(
      'forced_reload_second_dismiss',
      () => io.hit(panel),
      (s) => s.database_refused_notice_count === 0,
    );
    requireClear(dismissed, 0);
    assert.equal(await io.evaluate(panel, 'innerWidth'), 360, 'native width retained');
    return {
      width: 360,
      source: 'native',
      refusedHistoryReads: refused,
      documentChanged: true,
      dismissClick,
      currentTitleMatched: audit.title === title,
      visible,
      dismissed,
    };
  } finally {
    await panel.send('Fetch.disable');
    off();
    await Promise.allSettled([...pending]);
  }
}
