#!/usr/bin/env node
/** Owned-page, trusted-input guest Scrape acceptance; unresolved cells stay unverified. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { captureLifecycleEvidence } from './profile-reload-capture.mjs';
import { armBusyExpression, readBusyExpression } from './scrape-busy-observer.mjs';
import { scrapeLayoutFailure } from './scrape-layout-guard.mjs';
import { assertImageGroups, assertMediaPane } from './scrape-media-assertions.mjs';
import { intakeImage } from './scrape-media-fixture.mjs';
import {
  enterMediaField,
  observeVideoLinks,
  videoLinksVerdict,
} from './scrape-native-media-actions.mjs';
import { diagnosticCpuRate, runSupplementalCpuDiagnostic } from './scrape-page-cpu-diagnostic.mjs';
import { recordReloadMilestone } from './scrape-reload-milestones.mjs';
import { waitForReplacementScrapeTab } from './scrape-replacement-tab.mjs';
import { click, evaluate, waitFor } from './settings-panel-driver.mjs';

const REPO = resolve(import.meta.dirname, '../..');
const EXTENSION_DIR = process.env.MATRX_SCRAPE_EXTENSION_DIR;
const RECEIPT = process.env.MATRX_SCRAPE_RECEIPT;
const ARTIFACT_CHANNEL = process.env.MATRX_SCRAPE_ARTIFACT_CHANNEL;
const DIAGNOSTIC_RATE = diagnosticCpuRate(process.env.MATRX_SCRAPE_DIAGNOSTIC_CPU_RATE);
const OUTPUT = join(REPO, 'test-results', `scrape-guest-native-${randomUUID()}.json`);
const article = 'Harbor Dental intake guide';
const lazy = 'After the patient scrolls, the appointment preparation checklist appears.';
const walkthroughVideo = await readFile(
  join(REPO, 'tests/browser/fixtures/clinic-walkthrough.mp4'),
);
const mediumImage =
  '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#88bdb0"/></svg>';
const iconImage =
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="14" fill="#47707a"/></svg>';
const firstPage = `<!doctype html><html><head><title>${article}</title>
<meta name="description" content="Harbor Dental new patient appointments">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Dentist","name":"Harbor Dental"}</script></head>
<body><main><article><h1>${article}</h1>
<p>New patients can review appointment timing, forms, and arrival instructions before visiting our clinic.</p>
<img src="/intake.svg" alt="New patient intake desk" width="640" height="480">
<img src="/appointment-card.svg" alt="Appointment card" width="96" height="96">
<img src="/clinic-icon.svg" alt="Clinic icon" width="32" height="32">
<video src="/intake-walkthrough.mp4" preload="none"></video>
<video src="/referral-walkthrough.mp4" preload="none"></video>
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
  horizontal_geometry: [],
  reload_milestones: [],
  reload_lifecycle: null,
  driver_failure: null,
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
async function captureMediaFailure(panel, artifacts, phase, work) {
  try {
    return await work();
  } catch (error) {
    const observation = { phase, code: String(error?.message ?? error).slice(0, 300) };
    try {
      const state = await scrapeState(panel);
      observation.selected = state.selected;
      observation.visible = state.visible;
      observation.resultText = state.resultText?.slice(0, 1200) ?? null;
      observation.media = state.media;
    } catch (captureError) {
      observation.state_error = String(captureError?.message ?? captureError).slice(0, 200);
    }
    try {
      observation.screenshot = await screenshot(panel, artifacts, `scrape-${phase}-failure.png`);
    } catch (captureError) {
      observation.screenshot_error = String(captureError?.message ?? captureError).slice(0, 200);
    }
    report.media_failure_observation = observation;
    throw error;
  }
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

async function horizontalGeometry(panel, boundary) {
  const geometry = await evaluate(
    panel,
    `(() => {
    const rect = (node) => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width,
        scrollLeft: node.scrollLeft, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth };
    };
    const outer = document.querySelector('button[role="tab"][title="Scrape"]');
    const pane = outer?.getAttribute('aria-controls')
      ? document.getElementById(outer.getAttribute('aria-controls')) : null;
    const resultList = pane?.querySelector('[role="tablist"]');
    const selected = resultList?.querySelector('[role="tab"][aria-selected="true"]');
    const title = pane?.querySelector('.truncate.text-sm.font-medium');
    const capture = [...(pane?.querySelectorAll('button') ?? [])]
      .find((node) => (node.getAttribute('title') ?? node.getAttribute('data-matrx-title') ?? '')
        .startsWith('Capture the page exactly'));
    const ancestors = [];
    for (let node = selected?.parentElement; node && ancestors.length < 8; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) ancestors.push(rect(node));
    }
    return { viewportWidth: innerWidth, document: rect(document.documentElement), body: rect(document.body),
      outerTabs: rect(outer?.closest('[role="tablist"]')), scrapePane: rect(pane),
      resultTabs: rect(resultList), selectedTrigger: rect(selected), title: rect(title),
      captureRow: rect(capture?.parentElement), selectedScrollableAncestors: ancestors,
      triggers: [...(resultList?.querySelectorAll('[role="tab"]') ?? [])]
        .map((node) => ({ label: node.firstChild?.textContent?.trim(), rect: rect(node) })) };
  })()`,
  );
  return { boundary, at: new Date().toISOString(), geometry };
}

async function assertScrapeLayout(panel, boundary) {
  const measurement = await horizontalGeometry(panel, boundary);
  report.horizontal_geometry.push(measurement);
  const failure = scrapeLayoutFailure(measurement);
  assert.equal(failure, null, failure ?? undefined);
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
      media: visible ? {
        tabCount: selected[0]?.querySelector('span')?.textContent?.trim() ?? null,
        formOpen: content.querySelector('input[placeholder="https://…"]') !== null,
        imageToolbar: content.querySelector('span.uppercase')?.textContent?.trim() ?? null,
        imageToolbarRendered: content.querySelector('span.uppercase')?.innerText?.trim() ?? null,
        imageGroups: Object.fromEntries([['large','grid-cols-3'],['medium','grid-cols-5'],['icon','grid-cols-8']]
          .map(([tier,gridClass])=>[tier,[...content.querySelectorAll('div.grid')]
            .filter(node=>node.classList.contains(gridClass))
            .flatMap(node=>[...node.querySelectorAll('a > img')].map(img=>img.src))])),
        imageItems: [...content.querySelectorAll('a')].filter(a=>a.querySelector('img'))
          .map(a=>({href:a.href,src:a.querySelector('img')?.src??null,
            alt:a.querySelector('img')?.getAttribute('alt')??null,
            complete:a.querySelector('img')?.complete===true,
            naturalWidth:a.querySelector('img')?.naturalWidth??0,
            naturalHeight:a.querySelector('img')?.naturalHeight??0})),
        videoItems: [...content.querySelectorAll('a')]
          .filter(a=>a.parentElement?.querySelector('button[title="Remove video"]'))
          .map(a=>({href:a.href,text:a.textContent?.trim()??''})),
      } : null,
      error:buttons.some(n=>n.getAttribute('aria-label')==='Dismiss'),
      reload:buttons.some(n=>n.textContent.trim()==='Reload page'),
      retry:buttons.some(n=>n.textContent.trim()==='Try again'),
      saved:buttons.some(n=>n.textContent.trim()==='Saved')};
  })()`,
  );
}

async function selectedMedia(panel, label, items, name) {
  if (label === 'Images') {
    await evaluate(
      panel,
      `(() => {
      const outer=document.querySelector('button[role="tab"][title="Scrape"][data-state="active"]');
      const pane=outer&&document.getElementById(outer.getAttribute('aria-controls'));
      const tab=pane?.querySelector('[role="tablist"] [role="tab"][aria-selected="true"]');
      const content=tab&&document.getElementById(tab.getAttribute('aria-controls'));
      for(const image of content?.querySelectorAll('img')??[]) image.scrollIntoView({block:'center',behavior:'instant'});
    })()`,
    );
  }
  const state = await waitFor(
    name,
    () => scrapeState(panel),
    (s) => {
      const actual = label === 'Images' ? s?.media?.imageItems : s?.media?.videoItems;
      return (
        s?.selected === label &&
        s.visible &&
        actual?.length === items.length &&
        (label !== 'Images' || actual.every((item) => item.complete && item.naturalWidth > 0))
      );
    },
  );
  return assertMediaPane(state, { label, items });
}

async function mediaForm(panel) {
  return evaluate(
    panel,
    `(() => {
    const outer=document.querySelector('button[role="tab"][title="Scrape"][data-state="active"]');
    const pane=outer&&document.getElementById(outer.getAttribute('aria-controls'));
    const tab=pane?.querySelector('[role="tablist"] [role="tab"][aria-selected="true"]');
    const content=tab&&document.getElementById(tab.getAttribute('aria-controls'));
    return { inputs:[...(content?.querySelectorAll('input')??[])].map(n=>({placeholder:n.placeholder,value:n.value})),
      addButtons:[...(content?.querySelectorAll('button')??[])].filter(n=>n.textContent.trim()==='Add').length };
  })()`,
  );
}

async function exerciseMediaControls({
  panel,
  page,
  origin,
  phase,
  resourceAction,
  requireResourceHealth,
}) {
  const image = (path, alt) => ({ href: `${origin}${path}`, src: `${origin}${path}`, alt });
  const images = [
    image('/intake.svg', 'New patient intake desk'),
    image('/appointment-card.svg', 'Appointment card'),
    image('/clinic-icon.svg', 'Clinic icon'),
  ];
  const video = (path) => ({ href: `${origin}${path}`, text: `${origin}${path}` });
  const videos = [video('/intake-walkthrough.mp4'), video('/referral-walkthrough.mp4')];
  await resourceAction(() => click(panel, 'scrape-result-tab', 'Images'));
  const beforeImages = await selectedMedia(panel, 'Images', images, `${phase}_three_images`);
  assertImageGroups(
    await scrapeState(panel),
    {
      large: [images[0].src],
      medium: [images[1].src],
      icon: [images[2].src],
    },
    `${phase}_initial_image_groups`,
  );
  const removals = [];
  for (const [removed, survivors] of [
    [images[1], [images[0], images[2]]],
    [images[2], [images[0]]],
    [images[0], []],
  ]) {
    await requireResourceHealth();
    await resourceAction(() => click(panel, 'scrape-media-remove', removed.href));
    removals.push(
      await selectedMedia(
        panel,
        'Images',
        survivors,
        `${phase}_remove_${new URL(removed.href).pathname}`,
      ),
    );
    assertImageGroups(
      await scrapeState(panel),
      {
        large: survivors.filter((item) => item === images[0]).map((item) => item.src),
        medium: survivors.filter((item) => item === images[1]).map((item) => item.src),
        icon: survivors.filter((item) => item === images[2]).map((item) => item.src),
      },
      `${phase}_remove_${new URL(removed.href).pathname}`,
    );
  }
  await resourceAction(() => click(panel, 'scrape-media-add-row', 'Add image URL'));
  await resourceAction(() => click(panel, 'scrape-media-form-action', 'Add'));
  assert.deepEqual(
    (await mediaForm(panel)).inputs.map((i) => i.value),
    ['', ''],
    'blank_image_form_not_retained',
  );
  await selectedMedia(panel, 'Images', [], `${phase}_blank_image_rejected`);
  await enterMediaField({
    panel,
    field: 'src',
    value: `${origin}/followup-card.svg`,
    resourceAction,
    click,
  });
  await enterMediaField({ panel, field: 'alt', value: 'Follow-up card', resourceAction, click });
  await resourceAction(() => click(panel, 'scrape-media-form-action', 'Add'));
  const addedImage = await selectedMedia(
    panel,
    'Images',
    [image('/followup-card.svg', 'Follow-up card')],
    `${phase}_image_added`,
  );
  await enterMediaField({
    panel,
    field: 'src',
    value: `${origin}/appointment-card.svg`,
    resourceAction,
    click,
  });
  await resourceAction(() => click(panel, 'scrape-media-form-action', 'Cancel'));
  await resourceAction(() => click(panel, 'scrape-media-add-row', 'Add image URL'));
  assert.deepEqual(
    (await mediaForm(panel)).inputs.map((i) => i.value),
    ['', ''],
    'image_cancel_draft_retained',
  );
  await selectedMedia(
    panel,
    'Images',
    [image('/followup-card.svg', 'Follow-up card')],
    `${phase}_image_cancelled`,
  );
  await resourceAction(() => click(panel, 'scrape-result-tab', 'Video'));
  const beforeVideos = await selectedMedia(panel, 'Video', videos, `${phase}_two_videos`);
  const linkEvidence = await observeVideoLinks({
    page,
    panel,
    urls: videos.map((item) => item.href),
    resourceAction,
    click,
    evaluate,
  });
  await resourceAction(() => click(panel, 'scrape-media-remove', videos[0].href));
  const removedVideo = await selectedMedia(panel, 'Video', [videos[1]], `${phase}_video_removed`);
  await resourceAction(() => click(panel, 'scrape-media-add-row', 'Add video URL'));
  await resourceAction(() => click(panel, 'scrape-media-form-action', 'Add'));
  assert.deepEqual(
    (await mediaForm(panel)).inputs.map((i) => i.value),
    [''],
    'blank_video_form_not_retained',
  );
  await selectedMedia(panel, 'Video', [videos[1]], `${phase}_blank_video_rejected`);
  await enterMediaField({
    panel,
    field: 'src',
    value: `${origin}/consultation.mp4`,
    resourceAction,
    click,
  });
  await resourceAction(() => click(panel, 'scrape-media-form-action', 'Add'));
  const addedVideo = await selectedMedia(
    panel,
    'Video',
    [videos[1], video('/consultation.mp4')],
    `${phase}_video_added`,
  );
  await enterMediaField({
    panel,
    field: 'src',
    value: `${origin}/intake-walkthrough.mp4`,
    resourceAction,
    click,
  });
  await resourceAction(() => click(panel, 'scrape-media-form-action', 'Cancel'));
  await resourceAction(() => click(panel, 'scrape-media-add-row', 'Add video URL'));
  assert.deepEqual(
    (await mediaForm(panel)).inputs.map((i) => i.value),
    [''],
    'video_cancel_draft_retained',
  );
  await selectedMedia(
    panel,
    'Video',
    [videos[1], video('/consultation.mp4')],
    `${phase}_video_cancelled`,
  );
  return {
    phase,
    images: { before: beforeImages, removals, added: addedImage },
    videos: { before: beforeVideos, removed: removedVideo, added: addedVideo, links: linkEvidence },
  };
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
    ownedAssets: {
      '/intake.svg': { contentType: 'image/svg+xml', body: intakeImage },
      '/appointment-card.svg': { contentType: 'image/svg+xml', body: mediumImage },
      '/clinic-icon.svg': { contentType: 'image/svg+xml', body: iconImage },
      '/followup-card.svg': { contentType: 'image/svg+xml', body: mediumImage },
      '/intake-walkthrough.mp4': { contentType: 'video/mp4', body: walkthroughVideo },
      '/referral-walkthrough.mp4': { contentType: 'video/mp4', body: walkthroughVideo },
      '/consultation.mp4': { contentType: 'video/mp4', body: walkthroughVideo },
    },
    onStage: (value) => {
      report.native_stage = value;
    },
    exercisePanel: async ({
      page,
      panel,
      artifacts,
      reloadExtension,
      requireResourceHealth,
      resourceAction,
    }) => {
      await requireResourceHealth();
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
      await resourceAction(() => page.goto(`${origin}/intake`));
      assert.equal(await page.locator('#late p').count(), 0, 'lazy_content_must_start_absent');
      await resourceAction(() => click(panel, 'title', 'Scrape'));
      const empty = await waitFor(
        'scrape_initial_empty',
        () => scrapeState(panel),
        (s) => s?.ready && s.empty && s.fast.length === 1 && !s.fast[0].disabled,
      );
      await requireResourceHealth();
      mark('EXT-F-1007-T20', 'partial', { initial_empty: empty.empty, initial_url: page.url() }, [
        'Navigation and reload lifecycle remain to be exercised.',
      ]);

      report.stage = 'fast_capture';
      await requireResourceHealth();
      await armBusyObserver(panel, 'fast');
      await resourceAction(() =>
        click(panel, 'title', 'Capture the page exactly as it is right now'),
      );
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
      await requireResourceHealth();
      assert.equal(await page.locator('#late p').count(), 0, 'fast_capture_scrolled_fixture');
      const fastBusy = await busyObservation(panel);
      report.fast_busy_observation = fastBusy;
      report.fast_screenshot = await screenshot(panel, artifacts, 'scrape-fast-article.png');
      await assertScrapeLayout(panel, 'after_fast_capture');
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
            await requireResourceHealth();
            diagnostic.target = target;
            diagnostic.cleanup = cleanup;
            await armBusyObserver(panel, 'fast');
            await resourceAction(() =>
              click(panel, 'title', 'Capture the page exactly as it is right now'),
            );
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
            await requireResourceHealth();
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
      const mediaEvidence = {};
      for (const label of expectedTabs) {
        await requireResourceHealth();
        await resourceAction(() => click(panel, 'scrape-result-tab', label));
        const state = await waitFor(
          `scrape_${label}_tab`,
          () => scrapeState(panel),
          (s) => s?.selected === label && s.visible && typeof s.resultText === 'string',
        );
        await requireResourceHealth();
        viewed[label] = state.resultText.slice(0, 300);
        if (label === 'Images' || label === 'Video') {
          mediaEvidence[label.toLowerCase()] = await selectedMedia(
            panel,
            label,
            label === 'Images'
              ? [
                  {
                    href: `${origin}/intake.svg`,
                    src: `${origin}/intake.svg`,
                    alt: 'New patient intake desk',
                  },
                  {
                    href: `${origin}/appointment-card.svg`,
                    src: `${origin}/appointment-card.svg`,
                    alt: 'Appointment card',
                  },
                  {
                    href: `${origin}/clinic-icon.svg`,
                    src: `${origin}/clinic-icon.svg`,
                    alt: 'Clinic icon',
                  },
                ]
              : [
                  {
                    href: `${origin}/intake-walkthrough.mp4`,
                    text: `${origin}/intake-walkthrough.mp4`,
                  },
                  {
                    href: `${origin}/referral-walkthrough.mp4`,
                    text: `${origin}/referral-walkthrough.mp4`,
                  },
                ],
            `scrape_${label}_loaded`,
          );
        }
        await assertScrapeLayout(panel, `after_${label}_tab`);
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
            images: mediaEvidence.images,
            video: mediaEvidence.video,
            links: viewed.Links.includes('Patient forms'),
            seo: /SEO|Title|Description/i.test(viewed.SEO),
            schema: viewed.Schema.includes('Dentist'),
          },
        },
        ['Image and video empty states and reload lifecycle need full observation.'],
      );

      report.stage = 'warm_media_controls';
      const warmControls = await captureMediaFailure(panel, artifacts, 'warm-media', () =>
        exerciseMediaControls({
          panel,
          page,
          origin,
          phase: 'warm',
          resourceAction,
          requireResourceHealth,
        }),
      );
      report.media_controls = { warm: warmControls };
      mark('EXT-F-1007-T10', 'partial', { warm: warmControls.images }, [
        'Repeat controls after full extension reload.',
      ]);
      mark(
        'EXT-F-1007-T11',
        'partial',
        {
          warm: {
            blank_rejected: true,
            valid_added: warmControls.images.added,
            cancel_cleared: true,
          },
        },
        ['Repeat controls after full extension reload.'],
      );
      const warmLinks = videoLinksVerdict(warmControls.videos.links);
      mark(
        'EXT-F-1007-T12',
        warmLinks.status === 'failed' ? 'failed' : 'partial',
        { warm: warmControls.videos },
        [
          'Repeat controls after full extension reload; verify native link and clipboard outcomes.',
          ...warmLinks.remaining,
        ],
      );
      if (warmLinks.failures.length) report.cases.at(-1).failure = warmLinks.failures;

      report.stage = 'deep_capture';
      await requireResourceHealth();
      await resourceAction(() => click(panel, 'scrape-result-tab', 'Article'));
      await assertScrapeLayout(panel, 'after_return_to_Article');
      await armBusyObserver(panel, 'deep');
      await resourceAction(() =>
        click(
          panel,
          'title',
          'Scroll the page top→bottom to load lazy content (images, infinite-scroll items), then capture. Better for dynamic pages.',
        ),
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
      await requireResourceHealth();
      assert.equal(await page.locator('#late p').textContent(), lazy);
      const deepBusy = await busyObservation(panel);
      report.deep_busy_observation = deepBusy;
      report.deep_screenshot = await screenshot(panel, artifacts, 'scrape-deep-article.png');
      await assertScrapeLayout(panel, 'after_deep_capture');
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
      await requireResourceHealth();
      await resourceAction(() => page.goto(`${origin}/referrals`));
      const cleared = await waitFor(
        'scrape_new_document_empty',
        () => scrapeState(panel),
        (s) =>
          s?.empty && !s.resultText?.includes(lazy) && s.title === 'Harbor Dental referral hours',
      );
      await requireResourceHealth();
      assert.equal(cleared.saved, false, 'previous_page_saved_badge_retained');
      report.stage = 'empty_media_capture';
      await resourceAction(() =>
        click(panel, 'title', 'Capture the page exactly as it is right now'),
      );
      await waitFor(
        'scrape_referrals_result',
        () => scrapeState(panel),
        (s) =>
          s?.title === 'Harbor Dental referral hours' &&
          s.selected === 'Article' &&
          s.visible &&
          s.resultText?.includes('Referral coordinators answer weekday calls.'),
        30000,
      );
      for (const label of ['Images', 'Video']) {
        await requireResourceHealth();
        await resourceAction(() => click(panel, 'scrape-result-tab', label));
        const state = await waitFor(
          `scrape_empty_${label}_tab`,
          () => scrapeState(panel),
          (s) => s?.selected === label && s.visible && typeof s.resultText === 'string',
        );
        await requireResourceHealth();
        mediaEvidence[`${label.toLowerCase()}_empty`] = assertMediaPane(state, {
          label,
          items: [],
        });
      }
      const t08 = report.cases.find((c) => c.id === 'EXT-F-1007-T08');
      t08.evidence.matching_content.images_empty = mediaEvidence.images_empty;
      t08.evidence.matching_content.video_empty = mediaEvidence.video_empty;
      t08.remaining = ['Member/admin modes and full extension reload lifecycle remain unverified.'];
      const t20 = report.cases.find((c) => c.id === 'EXT-F-1007-T20');
      t20.evidence.navigation_url = page.url();
      t20.evidence.previous_content_cleared = true;
      t20.remaining = ['Full extension reload lifecycle remains unverified.'];

      report.stage = 'restricted_error';
      await requireResourceHealth();
      await resourceAction(() => page.goto('chrome://settings/'));
      const restricted = await waitFor(
        'scrape_restricted_ready',
        () => scrapeState(panel),
        (s) => s?.ready && s.fast.length === 1,
      );
      await requireResourceHealth();
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
        await resourceAction(() =>
          click(panel, 'title', 'Capture the page exactly as it is right now'),
        );
        const blocked = await waitFor(
          'scrape_restricted_error',
          () => scrapeState(panel),
          (s) => s?.error && !s.reload && !s.retry,
        );
        await requireResourceHealth();
        report.error_screenshot = await screenshot(panel, artifacts, 'scrape-restricted-error.png');
        assert.equal(blocked.empty, true);
        await resourceAction(() => click(panel, 'scrape-dismiss', 'Dismiss'));
        await waitFor(
          'scrape_error_dismissed',
          () => scrapeState(panel),
          (s) => s?.ready && !s.error,
        );
        await requireResourceHealth();
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
      await requireResourceHealth();
      await resourceAction(() => page.goto(`${origin}/`));
      const beforeReload = await waitFor(
        'scrape_owned_page_empty_before_reload',
        () => scrapeState(panel),
        (s) => s?.ready && s.empty && !s.saved && !s.resultText?.includes(lazy),
      );
      await requireResourceHealth();
      assert.equal(beforeReload.title, 'Research brief: product discovery');
      t20.evidence.reload_origin_url = page.url();
      t20.evidence.previous_content_cleared_before_reload = true;
      const replacement = await resourceAction(() => {
        recordReloadMilestone(report, 'reload_extension');
        return reloadExtension();
      });
      report.reload_lifecycle = {
        observed_at: new Date().toISOString(),
        management_reload_clicked: replacement.management_reload_clicked,
        old_targets_retired: replacement.old_targets_retired,
        worker_replaced: replacement.worker_replaced,
        panel_replaced: replacement.panel_replaced,
        retirement_evidence: captureLifecycleEvidence(replacement.retirement_evidence),
        context_boundary: replacement.context_boundary,
      };
      try {
        await requireResourceHealth();
        await resourceAction(() => page.goto(`${origin}/referrals`));
        report.reload_lifecycle.scrape_tab_boundary = await resourceAction(() =>
          waitForReplacementScrapeTab(replacement.panel),
        );
        recordReloadMilestone(report, 'open_scrape_in_replacement_panel');
        await resourceAction(() => click(replacement.panel, 'title', 'Scrape'));
        recordReloadMilestone(report, 'observe_replacement_scrape');
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
        await requireResourceHealth();
        assert.equal(after.saved, false);
        t20.evidence.reload_normal_page_url = page.url();
        t20.evidence.reload_title = after.title;
        t20.evidence.reload_capture_enabled = true;
        for (const id of ['EXT-F-1007-T01', 'EXT-F-1007-T02', 'EXT-F-1007-T08', 'EXT-F-1007-T20'])
          report.cases.find((c) => c.id === id).evidence.extension_reload_empty = true;
        report.cases.find((c) => c.id === 'EXT-F-1007-T20').status = 'passed';
        report.cases.find((c) => c.id === 'EXT-F-1007-T20').remaining = [];
        recordReloadMilestone(report, 'replacement_scrape_observed');
        report.stage = 'post_reload_capture';
        await resourceAction(() => page.goto(`${origin}/intake`));
        await waitFor(
          'scrape_post_reload_intake_empty',
          () => scrapeState(replacement.panel),
          (s) => s?.ready && s.empty && s.title === article,
        );
        await resourceAction(() =>
          click(replacement.panel, 'title', 'Capture the page exactly as it is right now'),
        );
        const recaptured = await waitFor(
          'scrape_post_reload_intake_captured',
          () => scrapeState(replacement.panel),
          (s) =>
            s?.title === article &&
            s.selected === 'Article' &&
            s.visible &&
            s.resultText?.includes(article) &&
            s.fast.length === 1 &&
            !s.fast[0].disabled,
          30000,
        );
        assert.deepEqual(
          recaptured.tabs.map((t) => t.label),
          expectedTabs,
        );
        const postReloadPanes = { article: recaptured.resultText.includes(article) };
        for (const [label, pattern] of [
          ['Links', /Patient forms/],
          ['SEO', /SEO|Title|Description/i],
          ['Schema', /Dentist/],
        ]) {
          await resourceAction(() => click(replacement.panel, 'scrape-result-tab', label));
          const state = await waitFor(
            `scrape_post_reload_${label}`,
            () => scrapeState(replacement.panel),
            (s) => s?.selected === label && s.visible && pattern.test(s.resultText ?? ''),
          );
          postReloadPanes[label.toLowerCase()] = pattern.test(state.resultText);
        }
        report.stage = 'post_reload_media_controls';
        const reloadControls = await captureMediaFailure(
          replacement.panel,
          artifacts,
          'reload-media',
          () =>
            exerciseMediaControls({
              panel: replacement.panel,
              page,
              origin,
              phase: 'reload',
              resourceAction,
              requireResourceHealth,
            }),
        );
        report.media_controls.reload = reloadControls;
        postReloadPanes.images = reloadControls.images.before;
        postReloadPanes.video = reloadControls.videos.before;
        report.post_reload_populated_panes = postReloadPanes;
        const t08 = report.cases.find((c) => c.id === 'EXT-F-1007-T08');
        t08.evidence.post_reload_populated_panes = postReloadPanes;
        t08.remaining = ['Member/admin modes and normal-width verification remain unverified.'];
        for (const [id, evidence] of [
          ['EXT-F-1007-T10', reloadControls.images],
          [
            'EXT-F-1007-T11',
            {
              blank_rejected: true,
              valid_added: reloadControls.images.added,
              cancel_cleared: true,
            },
          ],
          ['EXT-F-1007-T12', reloadControls.videos],
        ]) {
          const item = report.cases.find((c) => c.id === id);
          item.evidence.reload = evidence;
          const verdict =
            id === 'EXT-F-1007-T12'
              ? videoLinksVerdict(warmControls.videos.links, reloadControls.videos.links)
              : { status: 'passed', failures: [], remaining: [] };
          item.remaining = verdict.remaining;
          if (verdict.failures.length) item.failure = verdict.failures;
          item.status = verdict.status;
        }
      } finally {
        await replacement.panel.detach();
      }
      await requireResourceHealth();
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
      : report.cases.some((c) => c.status === 'failed')
        ? 'failed'
        : 'partial';
  if (report.original_busy_failure) {
    report.failure = { stage: 'fast_capture', code: report.original_busy_failure };
    process.exitCode = 1;
  }
  if (report.status === 'failed') process.exitCode = 1;
} catch (error) {
  report.status = 'unverified';
  report.failure = { stage: report.stage, code: String(error?.message ?? error).slice(0, 300) };
  if (error?.driverFailure) report.driver_failure = error.driverFailure;
  if (error?.lifecycleEvidence)
    report.reload_lifecycle_failure = captureLifecycleEvidence(error.lifecycleEvidence);
  if (error?.contextBoundary) report.reload_context_failure = error.contextBoundary;
  process.exitCode = 1;
}
await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${report.status.toUpperCase()} scrape_guest_native ${OUTPUT}\n`);
