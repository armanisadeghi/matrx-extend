#!/usr/bin/env node
/**
 * EXT-D-0018 native acceptance. Root owns the guarded build and browser launch.
 * Break caught: an inline SVG survives capture while its figure caption or
 * adjacent HTML label disappears from the rendered Scrape article.
 * The page is an owned engineering fixture served as real HTML over localhost;
 * it is not evidence that an unrelated public production page works.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
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
const deepCaption = 'Follow-up visits increased after the revised April roster.';
const deepRevision = 'The revised April roster added follow-up capacity for returning patients.';
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
      recaptureEnabled: linked ? [...pane.querySelectorAll('button')]
        .filter(el => el.textContent.trim() === 'Re-capture').some(el => !el.disabled) : false,
      deepEnabled: linked ? [...pane.querySelectorAll('button')]
        .filter(el => el.textContent.trim() === 'Scroll & capture').some(el => !el.disabled) : false,
      busy: linked ? [...pane.querySelectorAll('button')].some(el => /Capturing|Scrolling/.test(el.textContent.trim())) : false,
      error: linked ? !!pane.querySelector('[role="alert"]') : false,
      errorCard: linked ? [...pane.querySelectorAll('button')]
        .filter(el => ['Try again', 'Reload page'].includes(el.textContent.trim()))
        .map(el => el.closest('.rounded-xl.border')?.innerText.slice(0, 240) ?? null).filter(Boolean)[0] ?? null : null,
      paneTail: linked ? pane.innerText.slice(-260) : null };
  })()`,
  );
}

async function renderedArticle(panel) {
  return evaluate(
    panel,
    `(() => {
    const mainLists = [...document.querySelectorAll('[role="tablist"]')]
      .filter(el => !el.closest('[role="tabpanel"]'));
    const scrapeTabs = mainLists.length === 1
      ? [...mainLists[0].querySelectorAll('[role="tab"]')]
        .filter(el => el.closest('[role="tablist"]') === mainLists[0] && el.title === 'Scrape') : [];
    const scrape = scrapeTabs.length === 1 ? scrapeTabs[0] : null;
    const pane = scrape && document.getElementById(scrape.getAttribute('aria-controls'));
    if (!pane) return { linked: false, scope: 'scrape_pane_missing', scrapeTabCount: scrapeTabs.length };
    if (scrape.getAttribute('aria-selected') !== 'true'
      || pane.getAttribute('data-state') !== 'active') return {
        linked: false, scope: 'scrape_inactive', scrapeSelected: scrape.getAttribute('aria-selected'),
        scrapeState: pane.getAttribute('data-state') };
    const articleTabs = [...pane.querySelectorAll('[role="tab"]')]
      .filter(el => el.textContent.trim() === 'Article');
    const articleTab = articleTabs.length === 1 ? articleTabs[0] : null;
    const article = articleTab && document.getElementById(articleTab.getAttribute('aria-controls'));
    if (!article || article.getAttribute('aria-labelledby') !== articleTab.id
      || article.getAttribute('data-state') !== 'active') return { linked: false,
        scope: 'article_inactive', articleTabCount: articleTabs.length,
        articleSelected: articleTab?.getAttribute('aria-selected') ?? null,
        articleState: article?.getAttribute('data-state') ?? null };
    const sequence = [];
    const walk = document.createTreeWalker(article, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
      const node = walk.currentNode;
      if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'IMG'
        && node.getAttribute('src')?.startsWith('data:image/svg+xml;base64,'))
        sequence.push({ kind: 'image', value: node.alt });
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim())
        sequence.push({ kind: 'text', value: node.textContent.trim() });
    }
    const text = article.innerText;
    return { linked: true, text, sequence,
      scope: 'article_active', articleTabCount: articleTabs.length,
      allImageCount: article.querySelectorAll('img').length,
      images: [...article.querySelectorAll('img')]
        .filter(el => el.getAttribute('src')?.startsWith('data:image/svg+xml;base64,'))
        .map(el => ({ alt: el.alt, src: el.getAttribute('src'),
          visible: el.getBoundingClientRect().width > 0,
          loaded: el.complete && el.naturalWidth > 0 && el.naturalHeight > 0,
          complete: el.complete, loading: el.loading,
          nearViewport: el.getBoundingClientRect().top < innerHeight && el.getBoundingClientRect().bottom > 0 })) };
  })()`,
  );
}

async function chartScrollState(panel, alt) {
  return evaluate(
    panel,
    `(() => {
    const mainLists = [...document.querySelectorAll('[role="tablist"]')]
      .filter(el => !el.closest('[role="tabpanel"]'));
    const scrape = mainLists.length === 1
      ? [...mainLists[0].querySelectorAll('[role="tab"]')]
        .find(el => el.closest('[role="tablist"]') === mainLists[0] && el.title === 'Scrape') : null;
    const pane = scrape && document.getElementById(scrape.getAttribute('aria-controls'));
    const articleTab = pane && [...pane.querySelectorAll('[role="tab"]')]
      .find(el => el.textContent.trim() === 'Article');
    const article = articleTab && document.getElementById(articleTab.getAttribute('aria-controls'));
    if (!article || article.getAttribute('data-state') !== 'active')
      return { scope: 'article_inactive' };
    const images = [...article.querySelectorAll('img')]
      .filter(el => el.getAttribute('src')?.startsWith('data:image/svg+xml;base64,')
        && el.alt === ${JSON.stringify(alt)});
    const image = images.length === 1 ? images[0] : null;
    if (!image) return { scope: 'image_missing', imageCount: images.length };
    let scroller = image.parentElement;
    while (scroller && !(scroller.scrollHeight > scroller.clientHeight
      && /^(auto|scroll)$/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
    if (!scroller) return { scope: 'scroller_missing' };
    const box = scroller.getBoundingClientRect(), target = image.getBoundingClientRect();
    const bounds = { left: Math.max(0, box.left), top: Math.max(0, box.top),
      right: Math.min(innerWidth, box.right), bottom: Math.min(innerHeight, box.bottom) };
    for (let ancestor = scroller.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor), clip = ancestor.getBoundingClientRect();
      if (/^(auto|scroll|hidden|clip)$/.test(style.overflowX)) {
        bounds.left = Math.max(bounds.left, clip.left + ancestor.clientLeft);
        bounds.right = Math.min(bounds.right, clip.left + ancestor.clientLeft + ancestor.clientWidth);
      }
      if (/^(auto|scroll|hidden|clip)$/.test(style.overflowY)) {
        bounds.top = Math.max(bounds.top, clip.top + ancestor.clientTop);
        bounds.bottom = Math.min(bounds.bottom, clip.top + ancestor.clientTop + ancestor.clientHeight);
      }
    }
    if (bounds.right <= bounds.left || bounds.bottom <= bounds.top)
      return { scope: 'scroller_clipped', bounds };
    const x = (bounds.left + bounds.right) / 2;
    const y = (bounds.top + bounds.bottom) / 2;
    const hit = document.elementFromPoint(x, y);
    const distance = target.top - (box.top + box.height / 2);
    return { scope: 'chart_scroller', imageCount: images.length, x, y,
      hitScroller: hit === scroller || scroller.contains(hit),
      scrollTop: scroller.scrollTop, maxScroll: scroller.scrollHeight - scroller.clientHeight,
      targetTop: target.top, scrollerTop: box.top, scrollerBottom: box.bottom,
      inScroller: target.top >= bounds.top && target.top < bounds.bottom,
      nearViewport: target.top >= 0 && target.top < innerHeight,
      loaded: image.complete && image.naturalWidth > 0 && image.naturalHeight > 0,
      deltaY: Math.sign(distance) * Math.min(Math.max(Math.abs(distance), 80), box.height * 0.8) };
  })()`,
  );
}

async function loadChartByNativeScroll(panel, alt, mode) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const state = await chartScrollState(panel, alt);
    report.scroll_observation = { chart: alt, attempt, ...state };
    assert.equal(state.scope, 'chart_scroller', `${mode}: chart scroll surface exists for ${alt}`);
    if (state.loaded && state.inScroller && state.nearViewport) return;
    assert.equal(state.hitScroller, true, `${mode}: wheel point belongs to article scroller`);
    if (state.inScroller && !state.loaded) {
      await waitFor(
        `${mode}_${alt}_image_load`,
        () => chartScrollState(panel, alt),
        (next) =>
          next?.scope === 'chart_scroller' &&
          next.imageCount === 1 &&
          next.inScroller &&
          next.nearViewport &&
          next.loaded,
        10000,
      );
      return;
    }
    await panel.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: state.x,
      y: state.y,
      deltaX: 0,
      deltaY: state.deltaY,
    });
    await waitFor(
      `${mode}_${alt}_wheel_progress`,
      () => chartScrollState(panel, alt),
      (next) =>
        next?.scope === 'chart_scroller' &&
        next.imageCount === 1 &&
        (next.scrollTop !== state.scrollTop || (next.inScroller && next.nearViewport)),
      3000,
    );
  }
  throw new Error(`${mode}_chart_scroll_exhausted:${alt}`);
}

function safeObservation(article, pane) {
  const svgImages =
    article?.images?.map((image, index) => {
      const svg = Buffer.from(image.src.split(',')[1] ?? '', 'base64').toString('utf8');
      const path = svg.match(/<path\b[^>]*>/)?.[0] ?? '';
      const bars = [...svg.matchAll(/<rect\b[^>]*>/g)].map(([tag]) => ({
        x: attributeOf(tag, 'x'),
        y: attributeOf(tag, 'y'),
        width: attributeOf(tag, 'width'),
        height: attributeOf(tag, 'height'),
      }));
      return {
        alt: image.alt,
        visible: image.visible,
        loaded: image.loaded,
        complete: image.complete,
        loading: image.loading,
        nearViewport: image.nearViewport,
        hasSvgRoot: /<svg\b/.test(svg),
        ...(index === 0 ? { pathD: attributeOf(path, 'd') } : { bars }),
        expectedGeometry:
          index === 0 ? /<path\b[^>]*d="M15 115 L125 70 L245 20"/.test(svg) : bars.length === 3,
      };
    }) ?? [];
  const orderStream = article?.linked
    ? article.sequence
        .map((node) => (node.kind === 'image' ? `\u0001${node.value}\u0002` : node.value))
        .join(' ')
    : '';
  const orderMarkers = article?.linked
    ? expectedSequence(report.active_mode ?? 'fast').map((item) => {
        const marker = item.kind === 'image' ? `\u0001${item.value}\u0002` : item.value;
        return { marker: item.value, offset: orderStream.indexOf(marker) };
      })
    : [];
  return {
    articleScope: article?.scope ?? 'read_failed',
    linked: article?.linked ?? false,
    articleTabCount: article?.articleTabCount ?? null,
    articleState: article?.articleState ?? null,
    scrapeSelected: pane?.selected ?? null,
    capture: pane?.capture ?? null,
    recapture: pane?.recapture ?? null,
    deep: pane?.deep ?? null,
    recaptureEnabled: pane?.recaptureEnabled ?? null,
    deepEnabled: pane?.deepEnabled ?? null,
    busy: pane?.busy ?? null,
    error: pane?.error ?? null,
    errorCard: pane?.errorCard ?? null,
    paneTail: pane?.paneTail ?? null,
    allImageCount: article?.allImageCount ?? null,
    svgImages,
    orderMarkers,
    textMarkers: article?.linked
      ? {
          heading: article.text.includes('Appointments booked'),
          firstCaption: article.text.includes(expected[0].caption),
          firstLabel: article.text.includes(expected[0].label),
          secondCaption: article.text.includes(expected[1].caption),
          secondLabel: article.text.includes(expected[1].label),
          deepCaption: article.text.includes(deepCaption),
          deepRevision: article.text.includes(deepRevision),
        }
      : null,
  };
}

async function captureFailureScreenshot(panel) {
  try {
    await panel.send('Page.enable');
    const { data } = await panel.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    if (typeof data !== 'string' || data.length < 100) throw new Error('png_missing');
    const path = join(dirname(OUTPUT), 'svg-caption-failure-panel.png');
    await writeFile(path, Buffer.from(data, 'base64'), { mode: 0o600 });
    report.failure_screenshot = path;
  } catch (error) {
    report.failure_screenshot_error = String(error?.message ?? 'unknown')
      .split(':')[0]
      .slice(0, 100);
  }
}

function attributeOf(tag, name) {
  return new RegExp(`\\b${name}="([^"]+)"`).exec(tag)?.[1] ?? null;
}

function expectedSequence(mode) {
  return [
    { kind: 'text', value: 'Appointments booked' },
    { kind: 'image', value: expected[0].image },
    { kind: 'text', value: expected[0].caption },
    { kind: 'text', value: expected[0].label },
    { kind: 'text', value: 'Follow-up visits' },
    { kind: 'image', value: expected[1].image },
    { kind: 'text', value: mode === 'deep' ? deepCaption : expected[1].caption },
    { kind: 'text', value: expected[1].label },
    ...(mode === 'deep' ? [{ kind: 'text', value: deepRevision }] : []),
    { kind: 'text', value: 'The operations team used both trends' },
  ];
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
    assert.equal(observed.images[index].loaded, true, `${mode}: graphic ${index + 1} loads`);
  }
  const firstSvg = Buffer.from(observed.images[0].src.split(',')[1], 'base64').toString('utf8');
  const secondSvg = Buffer.from(observed.images[1].src.split(',')[1], 'base64').toString('utf8');
  assert.match(firstSvg, /<svg\b/, `${mode}: first payload is SVG`);
  assert.match(secondSvg, /<svg\b/, `${mode}: second payload is SVG`);
  const path = firstSvg.match(/<path\b[^>]*>/)?.[0] ?? '';
  assert.equal(attributeOf(path, 'd'), 'M15 115 L125 70 L245 20', `${mode}: growth curve survives`);
  const bars = [...secondSvg.matchAll(/<rect\b[^>]*>/g)].map(([tag]) => ({
    x: attributeOf(tag, 'x'),
    y: attributeOf(tag, 'y'),
    width: attributeOf(tag, 'width'),
    height: attributeOf(tag, 'height'),
  }));
  assert.deepEqual(
    bars,
    [
      { x: '15', y: '70', width: '60', height: '60' },
      { x: '100', y: '40', width: '60', height: '90' },
      {
        x: '185',
        y: mode === 'deep' ? '10' : '15',
        width: '60',
        height: mode === 'deep' ? '120' : '115',
      },
    ],
    `${mode}: three real bars survive with the expected revision`,
  );

  const ordered = expectedSequence(mode);
  const stream = observed.sequence
    .map((node) => (node.kind === 'image' ? `\u0001${node.value}\u0002` : node.value))
    .join(' ');
  let offset = 0;
  for (const item of ordered) {
    const marker = item.kind === 'image' ? `\u0001${item.value}\u0002` : item.value;
    const next = stream.indexOf(marker, offset);
    assert.ok(next >= offset, `${mode}: missing or detached article node: ${item.value}`);
    offset = next + marker.length;
  }
  if (mode === 'deep')
    assert.equal(
      observed.text.includes(expected[1].caption),
      false,
      'deep: stale second caption was replaced',
    );
}

let server;
try {
  await mkdir(dirname(OUTPUT), { recursive: true, mode: 0o700 });
  const harness = await runNativeSidepanelQa({
    exercisePanel: async ({ page, panel }) => {
      try {
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
          report.active_mode = mode;
          if (mode === 'deep') {
            report.last_stage = 'deep_source_revision';
            const revised = await page.evaluate(
              ({ caption, revision }) => {
                const figures = document.querySelectorAll('article figure');
                const second = figures[1];
                const text = second?.querySelector('figcaption');
                const bar = second?.querySelector('rect[x="185"]');
                const tail = document.querySelector('article p:last-child');
                if (!text || !bar || !tail) return false;
                text.textContent = caption;
                bar.setAttribute('y', '10');
                bar.setAttribute('height', '120');
                const paragraph = document.createElement('p');
                paragraph.textContent = revision;
                tail.before(paragraph);
                return true;
              },
              { caption: deepCaption, revision: deepRevision },
            );
            assert.equal(revised, true, 'deep: article revision reached the real source DOM');
            report.last_stage = 'deep_source_revised';
          }
          const action = mode === 'fast' ? 'Capture' : 'Scroll & capture';
          report.last_stage = `${mode}_click`;
          await click(panel, 'button', action);
          report.last_stage = `${mode}_article_wait`;
          await waitFor(
            `${mode}_article_content_rendered`,
            async () => {
              const article = await renderedArticle(panel);
              const pane = await scrapePane(panel);
              report.last_observation = safeObservation(article, pane);
              return article;
            },
            (value) =>
              value?.linked &&
              value.images?.length === 2 &&
              (mode === 'fast' ||
                (value.text.includes(deepCaption) && value.text.includes(deepRevision))) &&
              expected.every(
                (item, index) =>
                  value.text.includes(
                    index === 1 && mode === 'deep' ? deepCaption : item.caption,
                  ) && value.text.includes(item.label),
              ),
            mode === 'deep' ? 60000 : 30000,
          );
          report.last_stage = `${mode}_native_chart_scroll`;
          for (const item of expected) await loadChartByNativeScroll(panel, item.image, mode);
          report.last_stage = `${mode}_loaded_article_wait`;
          const loadedArticle = await waitFor(
            `${mode}_loaded_article`,
            async () => {
              const article = await renderedArticle(panel);
              const pane = await scrapePane(panel);
              report.last_observation = safeObservation(article, pane);
              return article;
            },
            (value) =>
              value?.linked &&
              value.images?.length === 2 &&
              value.images.every((image) => image.loaded),
            10000,
          );
          report.last_stage = `${mode}_article_assertions`;
          assertArticle(loadedArticle, mode);
          report.last_stage = `${mode}_settled_state`;
          const settled = await scrapePane(panel);
          report.last_observation = safeObservation(loadedArticle, settled);
          assert.equal(settled.recapture, 1, `${mode}: capture completed`);
          assert.equal(settled.recaptureEnabled, true, `${mode}: Re-capture is usable`);
          assert.equal(settled.deep, 1, `${mode}: Scroll & capture is restored`);
          assert.equal(settled.deepEnabled, true, `${mode}: Scroll & capture is usable`);
          assert.equal(settled.busy, false, `${mode}: capture is idle`);
          assert.equal(settled.error, false, `${mode}: no visible capture error`);
          report.modes.push({
            mode,
            result: 'pass',
            svg_images: 2,
            captions: 2,
            html_labels: 2,
            ordered_article: true,
            svg_geometry_verified: true,
            ...(mode === 'deep' && { source_revision_observed: true }),
          });
          report.last_stage = `${mode}_rendered_article_confirmed`;
        }
      } catch (error) {
        await captureFailureScreenshot(panel);
        throw error;
      }
    },
  });
  report.extension_id = harness.extensionId;
  report.status = 'fixture_pass';
} catch (error) {
  report.status = 'unverified';
  report.failure_stage = report.last_stage;
  report.failure_code = error?.code ?? error?.name ?? 'unknown_error';
  const firstLine = String(error?.message ?? '').split('\n')[0];
  report.failure_detail = (
    error?.name === 'AssertionError' ? firstLine : firstLine.split(':')[0]
  ).slice(0, 220);
  process.exitCode = 1;
} finally {
  if (server?.listening) {
    server.closeAllConnections();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
  await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${report.status.toUpperCase()} svg_caption_native_acceptance\n`);
}
