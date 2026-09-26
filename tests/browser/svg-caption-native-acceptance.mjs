#!/usr/bin/env node
/**
 * EXT-D-0018 native acceptance. Root owns the guarded build and browser launch.
 * Break caught: an inline SVG survives capture while its figure caption or
 * adjacent HTML label disappears from the rendered Scrape article.
 * The page is an owned engineering fixture served as real HTML over localhost;
 * it is not evidence that an unrelated public production page works.
 */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { click, evaluate, waitFor } from './settings-panel-driver.mjs';

const REPO = resolve(import.meta.dirname, '..', '..');
const OUTPUT = join(REPO, 'test-results', 'svg-caption-native-acceptance.json');
const articleHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Harbor Dental quarterly operations review</title></head><body>
<main><article><h1>Harbor Dental quarterly operations review</h1>
<p>${'The practice tracked booked appointments and returning patients during the spring quarter. '.repeat(12)}</p>
<h2>Appointments booked</h2><p>The scheduling team compared the first three months before reviewing retention.</p>
<figure><svg role="img" aria-label="Appointments growth curve" width="260" height="140" viewBox="0 0 260 140"
  xmlns="http://www.w3.org/2000/svg"><title>Appointments growth curve</title>
  <path d="M15 115 L125 70 L245 20" fill="none" stroke="#2563eb" stroke-width="8"/></svg>
  <figcaption>Booked appointments rose from January through March.</figcaption>
  <span>Measured in completed bookings per month.</span></figure>
<p>${'The care team then examined whether patients returned for follow-up appointments. '.repeat(10)}</p>
<h2>Follow-up visits</h2><p>Returning patients matter independently of new bookings.</p>
<figure><svg role="img" aria-label="Follow-up visits bar chart" width="260" height="140" viewBox="0 0 260 140"
  xmlns="http://www.w3.org/2000/svg"><title>Follow-up visits bar chart</title>
  <rect x="15" y="70" width="60" height="60" fill="#0d9488"/>
  <rect x="100" y="40" width="60" height="90" fill="#0d9488"/>
  <rect x="185" y="15" width="60" height="115" fill="#0d9488"/></svg>
  <figcaption>Follow-up visits increased across the same quarter.</figcaption>
  <span>Measured in returning patients per month.</span></figure>
<p>${'The operations team used both trends to plan next quarter staffing. '.repeat(10)}</p>
</article></main></body></html>`;
const expected = [
  {
    image: 'Appointments growth curve',
    caption: 'Booked appointments rose from January through March.',
    label: 'Measured in completed bookings per month.',
  },
  {
    image: 'Follow-up visits bar chart',
    caption: 'Follow-up visits increased across the same quarter.',
    label: 'Measured in returning patients per month.',
  },
];
const report = {
  schema_version: 1,
  defect_id: 'EXT-D-0018',
  linked_case: 'EXT-F-1007-T28',
  status: 'unverified',
  fixture_kind: 'owned_localhost_real_html_article',
  public_production_proof: false,
  modes: [],
  last_stage: 'before_owned_profile',
};

function serveArticle() {
  const server = createServer((request, response) => {
    if (request.url !== '/article') {
      response.writeHead(404).end();
      return;
    }
    response
      .writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      })
      .end(articleHtml);
  });
  return server;
}

async function scrapePane(panel) {
  return evaluate(
    panel,
    `(() => {
    const lists = [...document.querySelectorAll('[role="tablist"]')]
      .filter(el => !el.closest('[role="tabpanel"]'));
    const tabs = lists.length === 1
      ? [...lists[0].querySelectorAll('[role="tab"]')]
        .filter(el => el.closest('[role="tablist"]') === lists[0] && el.title === 'Scrape') : [];
    const tab = tabs.length === 1 ? tabs[0] : null;
    const pane = tab && document.getElementById(tab.getAttribute('aria-controls'));
    const linked = !!pane && pane.getAttribute('aria-labelledby') === tab.id
      && pane.getAttribute('data-state') === 'active' && pane.getBoundingClientRect().height > 0;
    return { navLists: lists.length, scrapeTabs: tabs.length,
      selected: tab?.getAttribute('aria-selected') === 'true', linked,
      capture: linked ? [...pane.querySelectorAll('button')].filter(el => el.textContent.trim() === 'Capture').length : 0,
      recapture: linked ? [...pane.querySelectorAll('button')].filter(el => el.textContent.trim() === 'Re-capture').length : 0,
      deep: linked ? [...pane.querySelectorAll('button')].filter(el => el.textContent.trim() === 'Scroll & capture').length : 0,
      deepRunning: linked ? [...pane.querySelectorAll('button')].some(el => /^Scrolling/.test(el.textContent.trim())) : false,
      error: linked ? !!pane.querySelector('[role="alert"]') : false };
  })()`,
  );
}

async function renderedArticle(panel) {
  return evaluate(
    panel,
    `(() => {
    const mainLists = [...document.querySelectorAll('[role="tablist"]')]
      .filter(el => !el.closest('[role="tabpanel"]'));
    const scrape = mainLists.length === 1
      ? [...mainLists[0].querySelectorAll('[role="tab"]')].find(el => el.title === 'Scrape') : null;
    const pane = scrape && document.getElementById(scrape.getAttribute('aria-controls'));
    if (!pane || scrape.getAttribute('aria-selected') !== 'true'
      || pane.getAttribute('data-state') !== 'active') return { linked: false };
    const articleTab = [...pane.querySelectorAll('[role="tab"]')]
      .find(el => el.textContent.trim() === 'Article');
    const article = articleTab && document.getElementById(articleTab.getAttribute('aria-controls'));
    if (!article || article.getAttribute('aria-labelledby') !== articleTab.id
      || article.getAttribute('data-state') !== 'active') return { linked: false };
    const text = article.innerText;
    return { linked: true, text,
      images: [...article.querySelectorAll('img')]
        .filter(el => el.getAttribute('src')?.startsWith('data:image/svg+xml;base64,'))
        .map(el => ({ alt: el.alt, visible: el.getBoundingClientRect().width > 0 })) };
  })()`,
  );
}

function assertArticle(observed, mode) {
  assert.equal(observed.linked, true, `${mode}: linked Article tab is active`);
  assert.equal(observed.images.length, 2, `${mode}: both inline SVG images render`);
  for (const [index, item] of expected.entries()) {
    assert.equal(
      observed.images[index].alt,
      item.image,
      `${mode}: graphic ${index + 1} has its label`,
    );
    assert.equal(observed.images[index].visible, true, `${mode}: graphic ${index + 1} is visible`);
  }
  const ordered = [
    'Appointments booked',
    expected[0].caption,
    expected[0].label,
    'Follow-up visits',
    expected[1].caption,
    expected[1].label,
    'The operations team used both trends',
  ];
  let offset = -1;
  for (const item of ordered) {
    const next = observed.text.indexOf(item, offset + 1);
    assert.ok(next > offset, `${mode}: missing or out-of-order article text: ${item}`);
    offset = next;
  }
}

let server;
try {
  const harness = await runNativeSidepanelQa({
    exercisePanel: async ({ page, panel }) => {
      server = serveArticle();
      await new Promise((resolveListen, rejectListen) => {
        server.once('error', rejectListen);
        server.listen(0, '127.0.0.1', resolveListen);
      });
      const url = `http://127.0.0.1:${server.address().port}/article`;
      report.last_stage = 'localhost_article_navigation';
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      const source = await page.evaluate(() => ({
        title: document.title,
        figures: document.querySelectorAll('article figure').length,
        captions: document.querySelectorAll('article figcaption').length,
      }));
      assert.equal(source.title, 'Harbor Dental quarterly operations review');
      assert.equal(source.figures, 2);
      assert.equal(source.captions, 2);
      report.last_stage = 'source_article_confirmed';

      const beforeClick = await scrapePane(panel);
      assert.equal(beforeClick.navLists, 1);
      assert.equal(beforeClick.scrapeTabs, 1);
      await click(panel, 'title', 'Scrape');
      await waitFor(
        'scrape_view_ready',
        () => scrapePane(panel),
        (state) => state?.selected && state.linked && state.capture === 1 && state.deep === 1,
      );
      report.last_stage = 'scrape_view_ready';

      for (const mode of ['fast', 'deep']) {
        const action = mode === 'fast' ? 'Capture' : 'Scroll & capture';
        report.last_stage = `${mode}_click`;
        await click(panel, 'button', action);
        if (mode === 'deep') {
          await waitFor(
            'deep_capture_started',
            () => scrapePane(panel),
            (state) => state?.selected && state.deepRunning,
            10000,
          );
          report.last_stage = 'deep_capture_started';
          await waitFor(
            'deep_capture_settled',
            () => scrapePane(panel),
            (state) =>
              state?.selected && state.recapture === 1 && state.deep === 1 && !state.deepRunning,
            60000,
          );
          report.last_stage = 'deep_capture_settled';
        }
        const observed = await waitFor(
          `${mode}_article_rendered`,
          () => renderedArticle(panel),
          (value) =>
            value?.linked &&
            value.images?.length === 2 &&
            expected.every(
              (item) => value.text.includes(item.caption) && value.text.includes(item.label),
            ),
          mode === 'deep' ? 60000 : 30000,
        );
        assertArticle(observed, mode);
        const settled = await scrapePane(panel);
        assert.equal(settled.recapture, 1, `${mode}: capture completed`);
        assert.equal(settled.error, false, `${mode}: no visible capture error`);
        report.modes.push({
          mode,
          result: 'pass',
          svg_images: 2,
          captions: 2,
          html_labels: 2,
          ordered_article: true,
        });
        report.last_stage = `${mode}_rendered_article_confirmed`;
      }
    },
  });
  report.extension_id = harness.extensionId;
  report.status = 'fixture_pass';
} catch (error) {
  report.status = 'unverified';
  report.failure_stage = report.last_stage;
  report.failure_code = error?.code ?? error?.name ?? 'unknown_error';
  process.exitCode = 1;
} finally {
  if (server?.listening) {
    server.closeAllConnections();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
  await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${report.status.toUpperCase()} svg_caption_native_acceptance\n`);
}
