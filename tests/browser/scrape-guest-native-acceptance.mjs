#!/usr/bin/env node
/** Owned-page, trusted-input guest Scrape acceptance; unresolved cells stay unverified. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { armBusyExpression, readBusyExpression } from './scrape-busy-observer.mjs';
import { diagnosticCpuRate, runSupplementalCpuDiagnostic } from './scrape-page-cpu-diagnostic.mjs';
import { click, evaluate, waitFor } from './settings-panel-driver.mjs';

const REPO = resolve(import.meta.dirname, '../..');
const EXTENSION_DIR = process.env.MATRX_SCRAPE_EXTENSION_DIR;
const RECEIPT = process.env.MATRX_SCRAPE_RECEIPT;
const ARTIFACT_CHANNEL = process.env.MATRX_SCRAPE_ARTIFACT_CHANNEL;
const DIAGNOSTIC_RATE = diagnosticCpuRate(process.env.MATRX_SCRAPE_DIAGNOSTIC_CPU_RATE);
const OUTPUT = join(REPO, 'test-results', `scrape-guest-native-${randomUUID()}.json`);
const article = 'Harbor Dental intake guide';
const lazy = 'After the patient scrolls, the appointment preparation checklist appears.';
const firstPage = `<!doctype html><html><head><title>${article}</title>
<meta name="description" content="Harbor Dental new patient appointments">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Dentist","name":"Harbor Dental"}</script></head>
<body><main><article><h1>${article}</h1>
<p>New patients can review appointment timing, forms, and arrival instructions before visiting our clinic.</p>
<img src="/intake.png" alt="New patient intake desk" width="640" height="480">
<a href="/forms">Patient forms</a><a href="/appointments">Appointments</a>
<div style="height:1000px"></div><section id="late"></section><div style="height:800px"></div>
</article></main><script>
addEventListener('scroll',()=>{if(scrollY>200 && !document.querySelector('#late p'))
document.querySelector('#late').innerHTML='<h2>Preparation checklist</h2><p>${lazy}</p>';});
</script></body></html>`;
const secondPage =
  '<!doctype html><html><head><title>Harbor Dental referral hours</title></head><body><main><article><h1>Harbor Dental referral hours</h1><p>Referral coordinators answer weekday calls.</p></article></main></body></html>';
const report = {
  schema_version: 1,
  feature: 'EXT-F-1007',
  mode: 'guest',
  status: 'unverified',
  artifact: null,
  guest_account_observed: false,
  cases: [],
  stage: 'inputs',
  native_stage: null,
  failure: null,
  original_busy_failure: null,
  cpu_diagnostic: null,
};
const mark = (id, status, evidence, remaining = []) =>
  report.cases.push({ id, status, evidence, remaining });
async function screenshot(panel, artifacts, name) {
  await panel.send('Page.enable');
  const { data } = await panel.send('Page.captureScreenshot', { format: 'png' });
  assert.ok(typeof data === 'string' && data.length > 100, 'scrape_panel_screenshot_missing');
  const path = join(artifacts, name);
  await writeFile(path, Buffer.from(data, 'base64'), { mode: 0o600 });
  return path;
}
async function armBusyObserver(panel, mode) {
  const title =
    mode === 'fast'
      ? 'Capture the page exactly as it is right now'
      : 'Scroll the page top→bottom to load lazy content (images, infinite-scroll items), then capture. Better for dynamic pages.';
  await evaluate(panel, armBusyExpression(title));
}
async function busyObservation(panel) {
  return evaluate(panel, readBusyExpression);
}

async function scrapeState(panel) {
  return evaluate(
    panel,
    `(() => {
    const outer=[...document.querySelectorAll('button[role="tab"][title="Scrape"][data-state="active"]')];
    const pane=outer.length===1?document.getElementById(outer[0].getAttribute('aria-controls')):null;
    if (!pane?.matches('[role="tabpanel"][data-state="active"]')) return { ready:false };
    const buttons=[...pane.querySelectorAll('button')];
    const tabs=[...pane.querySelectorAll('[role="tablist"] [role="tab"]')];
    const selected=tabs.filter(n=>n.getAttribute('aria-selected')==='true');
    const content=selected.length===1?document.getElementById(selected[0].getAttribute('aria-controls')):null;
    const visible=content?.getAttribute('data-state')==='active' && content.getBoundingClientRect().height>0;
    return {ready:true, title:pane.querySelector('.truncate.text-sm.font-medium')?.textContent?.trim()??null,
      empty:pane.textContent.includes('Capture this page to extract content.'),
      fast:buttons.filter(n=>(n.getAttribute('title')??n.getAttribute('data-matrx-title'))==='Capture the page exactly as it is right now')
        .map(n=>({disabled:n.disabled,text:n.textContent.trim()})),
      deep:buttons.filter(n=>(n.getAttribute('title')??n.getAttribute('data-matrx-title')??'').startsWith('Scroll the page top'))
        .map(n=>({disabled:n.disabled,text:n.textContent.trim()})),
      tabs:tabs.map(n=>({label:n.firstChild?.textContent?.trim(),selected:n.getAttribute('aria-selected')==='true'})),
      selected: selected[0]?.firstChild?.textContent?.trim()??null, visible,
      resultText:visible?content.innerText:null,
      error:buttons.some(n=>n.getAttribute('aria-label')==='Dismiss'),
      reload:buttons.some(n=>n.textContent.trim()==='Reload page'),
      retry:buttons.some(n=>n.textContent.trim()==='Try again'),
      saved:buttons.some(n=>n.textContent.trim()==='Saved')};
  })()`,
  );
}

try {
  assert.ok(EXTENSION_DIR && RECEIPT, 'scrape_exact_artifact_inputs_required');
  assert.ok(['development', 'store'].includes(ARTIFACT_CHANNEL), 'scrape_channel_required');
  const receipt = JSON.parse(await readFile(RECEIPT, 'utf8'));
  if (ARTIFACT_CHANNEL === 'development') {
    assert.equal(receipt.kind, 'local_dev_unpacked', 'scrape_development_receipt_required');
    assert.match(process.env.MATRX_SCRAPE_CI_SOURCE_SHA ?? '', /^[a-f0-9]{40}$/);
    assert.match(process.env.MATRX_SCRAPE_CI_RUN_ID ?? '', /^[1-9][0-9]*$/);
    assert.match(process.env.MATRX_SCRAPE_CI_ARTIFACT_ID ?? '', /^[1-9][0-9]*$/);
  } else {
    assert.equal(receipt.kind, 'published_store_zip_adapted', 'scrape_store_receipt_required');
  }
  assert.equal(hashReleaseTree(EXTENSION_DIR), receipt.treeSha256, 'scrape_receipt_tree_mismatch');
  const manifest = JSON.parse(await readFile(join(EXTENSION_DIR, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, receipt.version, 'scrape_receipt_version_mismatch');
  report.artifact = {
    kind: ARTIFACT_CHANNEL === 'development' ? 'ci_development_test' : receipt.kind,
    channel: ARTIFACT_CHANNEL,
    version: receipt.version,
    source_sha:
      ARTIFACT_CHANNEL === 'development'
        ? process.env.MATRX_SCRAPE_CI_SOURCE_SHA
        : (receipt.sourceSha ?? null),
    tree_sha256: receipt.treeSha256,
    run_id:
      ARTIFACT_CHANNEL === 'development'
        ? Number(process.env.MATRX_SCRAPE_CI_RUN_ID)
        : (receipt.runId ?? null),
    artifact_id:
      ARTIFACT_CHANNEL === 'development'
        ? Number(process.env.MATRX_SCRAPE_CI_ARTIFACT_ID)
        : (receipt.artifactId ?? null),
  };
  await runNativeSidepanelQa({
    extensionDir: EXTENSION_DIR,
    ...(ARTIFACT_CHANNEL === 'development'
      ? { localDevReceiptPath: RECEIPT }
      : { releaseReceiptPath: RECEIPT }),
    expectedRelease: receipt,
    ownedPages: {
      '/intake': firstPage,
      '/referrals': secondPage,
      '/forms': secondPage,
      '/appointments': secondPage,
    },
    onStage: (value) => {
      report.native_stage = value;
    },
    exercisePanel: async ({ page, panel, artifacts, reloadExtension }) => {
      report.stage = 'fixture_navigation';
      const account = await evaluate(
        panel,
        `(() => ({guest:
        document.querySelectorAll('button[title="Account"]').length === 1 &&
        document.querySelectorAll('button[title="admin@admin.com"]').length === 0}))()`,
      );
      assert.equal(account?.guest, true, 'scrape_guest_account_not_observed');
      const auth = await evaluate(
        panel,
        `(async () => {
        const stored = await chrome.storage.local.get(['matrx.auth.accessToken', 'matrx.user.profile']);
        return { hasAccessToken: typeof stored['matrx.auth.accessToken'] === 'string',
          hasUserProfile: stored['matrx.user.profile'] != null };
      })()`,
      );
      assert.deepEqual(
        auth,
        { hasAccessToken: false, hasUserProfile: false },
        'scrape_guest_storage_not_empty',
      );
      report.guest_account_observed = true;
      report.guest_auth_storage = auth;
      const origin = new URL(page.url()).origin;
      await page.goto(`${origin}/intake`);
      assert.equal(await page.locator('#late p').count(), 0, 'lazy_content_must_start_absent');
      await click(panel, 'title', 'Scrape');
      const empty = await waitFor(
        'scrape_initial_empty',
        () => scrapeState(panel),
        (s) => s?.ready && s.empty && s.fast.length === 1 && !s.fast[0].disabled,
      );
      mark('EXT-F-1007-T20', 'partial', { initial_empty: empty.empty, initial_url: page.url() }, [
        'Navigation and reload lifecycle remain to be exercised.',
      ]);

      report.stage = 'fast_capture';
      await armBusyObserver(panel, 'fast');
      await click(panel, 'title', 'Capture the page exactly as it is right now');
      const fast = await waitFor(
        'scrape_fast_result',
        () => scrapeState(panel),
        (s) =>
          s?.title === article &&
          s.selected === 'Article' &&
          s.visible &&
          s.resultText?.includes(article) &&
          !s.resultText.includes(lazy) &&
          s.fast.length === 1 &&
          !s.fast[0].disabled,
        30000,
      );
      assert.equal(await page.locator('#late p').count(), 0, 'fast_capture_scrolled_fixture');
      const fastBusy = await busyObservation(panel);
      report.fast_busy_observation = fastBusy;
      report.fast_screenshot = await screenshot(panel, artifacts, 'scrape-fast-article.png');
      try {
        assert.equal(fastBusy.observed, true, 'scrape_fast_busy_not_observed');
        assert.match(fastBusy.text ?? '', /Capturing/, 'scrape_fast_busy_label_not_observed');
      } catch (error) {
        report.original_busy_failure = String(error?.message ?? error).slice(0, 300);
      }
      mark(
        'EXT-F-1007-T01',
        report.original_busy_failure ? 'unverified' : 'partial',
        {
          url: page.url(),
          busy_disabled: fastBusy.observed,
          article_title: fast.title,
          lazy_content_absent: true,
          result_tabs: fast.tabs.map((t) => t.label),
        },
        [
          ...(report.original_busy_failure ? [report.original_busy_failure] : []),
          'Warm/full reload lifecycle not yet exercised.',
        ],
      );
      if (DIAGNOSTIC_RATE !== null) {
        report.stage = 'supplemental_cpu_diagnostic';
        const diagnostic = {
          condition: 'owned_intake_page_cpu_throttled',
          rate: DIAGNOSTIC_RATE,
          original_case_promoted: false,
          artifact: report.artifact,
          status: 'unverified',
          target: null,
          busy_observation: null,
          full_result: null,
          no_scroll: null,
          cleanup: null,
          error: null,
        };
        report.cpu_diagnostic = diagnostic;
        await runSupplementalCpuDiagnostic({
          page,
          expectedUrl: `${origin}/intake`,
          rate: DIAGNOSTIC_RATE,
          diagnostic,
          capture: async ({ target, cleanup }) => {
            diagnostic.target = target;
            diagnostic.cleanup = cleanup;
            await armBusyObserver(panel, 'fast');
            await click(panel, 'title', 'Capture the page exactly as it is right now');
            const result = await waitFor(
              'scrape_diagnostic_fast_result',
              () => scrapeState(panel),
              (s) =>
                s?.title === article &&
                s.selected === 'Article' &&
                s.visible &&
                s.resultText?.includes(article) &&
                !s.resultText.includes(lazy) &&
                s.fast.length === 1 &&
                !s.fast[0].disabled,
              30000,
            );
            diagnostic.full_result = result;
            diagnostic.no_scroll = {
              lazy_element_count: await page.locator('#late p').count(),
              scroll_y: await page.evaluate(() => window.scrollY),
            };
            diagnostic.busy_observation = await busyObservation(panel);
            diagnostic.screenshot = await screenshot(
              panel,
              artifacts,
              'scrape-diagnostic-cpu-fast-article.png',
            );
            assert.equal(diagnostic.no_scroll.lazy_element_count, 0, 'scrape_diagnostic_scrolled');
            assert.equal(diagnostic.no_scroll.scroll_y, 0, 'scrape_diagnostic_scroll_y');
            assert.equal(
              diagnostic.busy_observation.observed,
              true,
              'scrape_diagnostic_busy_unobserved',
            );
            assert.match(
              diagnostic.busy_observation.text ?? '',
              /Capturing/,
              'scrape_diagnostic_busy_label',
            );
            return result;
          },
        });
      }
      report.stage = 'result_tabs';
      const expectedTabs = ['Article', 'Images', 'Video', 'Links', 'SEO', 'Schema'];
      assert.deepEqual(
        fast.tabs.map((t) => t.label),
        expectedTabs,
        'scrape_result_tab_roster',
      );
      const viewed = {};
      for (const label of expectedTabs) {
        await click(panel, 'scrape-result-tab', label);
        const state = await waitFor(
          `scrape_${label}_tab`,
          () => scrapeState(panel),
          (s) => s?.selected === label && s.visible && typeof s.resultText === 'string',
        );
        viewed[label] = state.resultText.slice(0, 300);
      }
      assert.match(viewed.Article, /Harbor Dental intake guide/);
      assert.match(viewed.Links, /Patient forms/);
      assert.match(viewed.SEO, /SEO|Title|Description/i);
      assert.match(viewed.Schema, /Dentist/);
      mark(
        'EXT-F-1007-T08',
        'partial',
        {
          tabs_selected: expectedTabs,
          matching_content: {
            article: viewed.Article.includes(article),
            links: viewed.Links.includes('Patient forms'),
            seo: /SEO|Title|Description/i.test(viewed.SEO),
            schema: viewed.Schema.includes('Dentist'),
          },
        },
        [
          'Image and video matching content or empty state and reload lifecycle need full observation.',
        ],
      );

      report.stage = 'deep_capture';
      await click(panel, 'scrape-result-tab', 'Article');
      await armBusyObserver(panel, 'deep');
      await click(
        panel,
        'title',
        'Scroll the page top→bottom to load lazy content (images, infinite-scroll items), then capture. Better for dynamic pages.',
      );
      const deep = await waitFor(
        'scrape_deep_result',
        () => scrapeState(panel),
        (s) =>
          s?.selected === 'Article' &&
          s.resultText?.includes(lazy) &&
          s.deep.length === 1 &&
          !s.deep[0].disabled,
        45000,
      );
      assert.equal(await page.locator('#late p').textContent(), lazy);
      const deepBusy = await busyObservation(panel);
      report.deep_busy_observation = deepBusy;
      report.deep_screenshot = await screenshot(panel, artifacts, 'scrape-deep-article.png');
      assert.equal(deepBusy.observed, true, 'scrape_deep_busy_not_observed');
      assert.match(deepBusy.text, /Scrolling/, 'scrape_deep_progress_not_observed');
      mark(
        'EXT-F-1007-T02',
        'partial',
        {
          url: page.url(),
          progress_text: deepBusy.text,
          lazy_content_in_browser: true,
          lazy_content_in_capture: deep.resultText.includes(lazy),
        },
        ['Deep failure retry mode and reload lifecycle remain unverified.'],
      );

      report.stage = 'navigation_empty';
      await page.goto(`${origin}/referrals`);
      const cleared = await waitFor(
        'scrape_new_document_empty',
        () => scrapeState(panel),
        (s) =>
          s?.empty && !s.resultText?.includes(lazy) && s.title === 'Harbor Dental referral hours',
      );
      assert.equal(cleared.saved, false, 'previous_page_saved_badge_retained');
      const t20 = report.cases.find((c) => c.id === 'EXT-F-1007-T20');
      t20.evidence.navigation_url = page.url();
      t20.evidence.previous_content_cleared = true;
      t20.remaining = ['Full extension reload lifecycle remains unverified.'];

      report.stage = 'restricted_error';
      await page.goto('chrome://settings/');
      const restricted = await waitFor(
        'scrape_restricted_ready',
        () => scrapeState(panel),
        (s) => s?.ready && s.fast.length === 1,
      );
      if (restricted.fast[0].disabled) {
        mark(
          'EXT-F-1007-T14',
          'unverified',
          { restricted_url: page.url(), capture_disabled: true, error_observed: restricted.error },
          [
            'Capture was disabled on the restricted page, so no error or recovery control was exercised.',
          ],
        );
      } else {
        await click(panel, 'title', 'Capture the page exactly as it is right now');
        const blocked = await waitFor(
          'scrape_restricted_error',
          () => scrapeState(panel),
          (s) => s?.error && !s.reload && !s.retry,
        );
        report.error_screenshot = await screenshot(panel, artifacts, 'scrape-restricted-error.png');
        assert.equal(blocked.empty, true);
        await click(panel, 'scrape-dismiss', 'Dismiss');
        await waitFor(
          'scrape_error_dismissed',
          () => scrapeState(panel),
          (s) => s?.ready && !s.error,
        );
        mark(
          'EXT-F-1007-T14',
          'partial',
          { restricted_url: page.url(), no_recovery_actions: true, dismissed: true },
          [
            'Recoverable Reload page and Try again, including deep retry mode, need a natural browser failure.',
          ],
        );
      }

      report.stage = 'extension_reload';
      await page.goto(`${origin}/`);
      const beforeReload = await waitFor(
        'scrape_owned_page_empty_before_reload',
        () => scrapeState(panel),
        (s) => s?.ready && s.empty && !s.saved && !s.resultText?.includes(lazy),
      );
      assert.equal(beforeReload.title, 'Research brief: product discovery');
      t20.evidence.reload_origin_url = page.url();
      t20.evidence.previous_content_cleared_before_reload = true;
      const replacement = await reloadExtension();
      try {
        await page.goto(`${origin}/referrals`);
        await click(replacement.panel, 'title', 'Scrape');
        const after = await waitFor(
          'scrape_reload_empty',
          () => scrapeState(replacement.panel),
          (s) =>
            s?.ready &&
            s.title === 'Harbor Dental referral hours' &&
            s.empty &&
            s.fast.length === 1 &&
            !s.fast[0].disabled &&
            !s.resultText?.includes(article) &&
            !s.resultText?.includes(lazy),
        );
        assert.equal(after.saved, false);
        t20.evidence.reload_normal_page_url = page.url();
        t20.evidence.reload_title = after.title;
        t20.evidence.reload_capture_enabled = true;
        for (const id of ['EXT-F-1007-T01', 'EXT-F-1007-T02', 'EXT-F-1007-T08', 'EXT-F-1007-T20'])
          report.cases.find((c) => c.id === id).evidence.extension_reload_empty = true;
        report.cases.find((c) => c.id === 'EXT-F-1007-T20').status = 'passed';
        report.cases.find((c) => c.id === 'EXT-F-1007-T20').remaining = [];
      } finally {
        await replacement.panel.detach();
      }
    },
  });
  assert.equal(
    hashReleaseTree(EXTENSION_DIR),
    report.artifact.tree_sha256,
    'scrape_artifact_changed_during_native_run',
  );
  report.status = report.original_busy_failure
    ? 'unverified'
    : report.cases.every((c) => c.status === 'passed')
      ? 'passed'
      : 'partial';
  if (report.original_busy_failure) {
    report.failure = { stage: 'fast_capture', code: report.original_busy_failure };
    process.exitCode = 1;
  }
} catch (error) {
  report.status = 'unverified';
  report.failure = { stage: report.stage, code: String(error?.message ?? error).slice(0, 300) };
  process.exitCode = 1;
}
await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${report.status.toUpperCase()} scrape_guest_native ${OUTPUT}\n`);
