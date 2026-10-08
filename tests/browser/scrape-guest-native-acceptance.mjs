#!/usr/bin/env node
/** Owned-page, trusted-input Scrape acceptance; unresolved cells stay unverified. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import {
  classifyPanelTransition,
  startPanelTransitionRecorder,
  traceOrganizationPointers,
} from './panel-transition-recorder.mjs';
import { captureLifecycleEvidence } from './profile-reload-capture.mjs';
import { armBusyExpression, readBusyExpression } from './scrape-busy-observer.mjs';
import {
  retainCopyTargetContext,
  runGuestCopyMenus,
  runGuestScrollSync,
} from './scrape-guest-behavior-batch.mjs';
import { scrapeLayoutFailure } from './scrape-layout-guard.mjs';
import { assertImageGroups, assertLinkPane } from './scrape-media-assertions.mjs';
import { intakeImage } from './scrape-media-fixture.mjs';
import { observeSelectedMedia, retainScrapeMediaFailure } from './scrape-media-observation.mjs';
import {
  enterMediaField,
  observeScrapeLinks,
  observeVideoLinks,
  videoLinksVerdict,
} from './scrape-native-media-actions.mjs';
import { confirmScrapeRecapture } from './scrape-native-recapture.mjs';
import { scrapeNativeSelection, selectScrapePanelViewport } from './scrape-native-selection.mjs';
import { diagnosticCpuRate, runSupplementalCpuDiagnostic } from './scrape-page-cpu-diagnostic.mjs';
import { runPostReloadCaptureBoundary } from './scrape-post-reload-capture-boundary.mjs';
import { recordReloadMilestone } from './scrape-reload-milestones.mjs';
import {
  refuseDiagnosticAcceptance,
  reloadOpenEvidenceClass,
} from './scrape-reload-open-diagnostic.mjs';
import { waitForReplacementScrapeTab } from './scrape-replacement-tab.mjs';
import { observeScrapeRows } from './scrape-row-observer.mjs';
import {
  assertCaptureExportUnchanged,
  assertCompleteTabCoverage,
  capturePaneSnapshot,
  observeEmptyMediaPanes,
  readCaptureExport,
  verifyCaptureUnchanged,
} from './scrape-tab-coverage.mjs';
import {
  approvedAdminOrganizationName,
  panelIdentity,
  selectRequiredSettingsOrganization,
  signInSettings,
  verifyCurrentSettingsIdentity,
} from './settings-native-auth-driver.mjs';
import { click, evaluate, waitFor } from './settings-panel-driver.mjs';

const REPO = resolve(import.meta.dirname, '../..');
const EXTENSION_DIR = process.env.MATRX_SCRAPE_EXTENSION_DIR;
const RECEIPT = process.env.MATRX_SCRAPE_RECEIPT;
const ARTIFACT_CHANNEL = process.env.MATRX_SCRAPE_ARTIFACT_CHANNEL;
const DIAGNOSTIC_RATE = diagnosticCpuRate(process.env.MATRX_SCRAPE_DIAGNOSTIC_CPU_RATE);
const RECEIPT_SELF_TEST = process.env.MATRX_SCRAPE_RECEIPT_SELF_TEST === '1';
const RELOAD_OPEN_DIAGNOSTIC = process.env.MATRX_SCRAPE_RELOAD_OPEN_DIAGNOSTIC === '1';
const OUTPUT = RECEIPT_SELF_TEST
  ? process.env.MATRX_SCRAPE_RECEIPT_SELF_TEST_OUTPUT
  : join(REPO, 'test-results', `scrape-guest-native-${randomUUID()}.json`);
const article = 'Harbor Dental intake guide';
const lazy = 'After the patient scrolls, the appointment preparation checklist appears.';
const scrollableGuide = Array.from(
  { length: 24 },
  (_, index) =>
    `<p>Intake step ${index + 1}: confirm the appointment time and bring the forms to the clinic.</p>`,
).join('');
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
${scrollableGuide}
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
  reload_open_diagnostic: reloadOpenEvidenceClass(RELOAD_OPEN_DIAGNOSTIC),
  driver_failure: null,
  media_transitions: [],
  media_event_traces: [],
  authentication: null,
  panel_viewports: [],
  panel_visibility_timeline: [],
  browser_launch: null,
  panel_transition: null,
};
let selection;
let expectedIdentity;
const otherRoleNote = () =>
  `${['guest', 'member', 'admin'].filter((mode) => mode !== selection.mode).join('/')} modes remain unverified by this receipt.`;
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

async function authenticatedPanelForegroundDiagnostic({
  page,
  panel,
  browserSession,
  panelTarget,
  inspectPanelContext,
}) {
  // Keep the failed boundary observable without serializing any URLs, page text,
  // credentials, or target IDs from the authenticated browser.
  const observation = {
    owned_root_page: false,
    panel_visibility: null,
    panel_has_focus: null,
    original_panel_target_present: null,
    exact_panel_target_count: null,
    original_is_only_exact_panel_target: null,
    side_panel_context: null,
    diagnostic_timed_out: false,
    outstanding_probes_after_deadline: false,
  };
  let expired = false;
  // Reuse the owned CDP transport's configured command deadline. Its sends
  // settle or fail on that deadline; the harness closes the owned connection
  // and child after this acceptance throws.
  const timeoutMs = browserSession.timeoutMs;
  const probes = [
    (async () => {
      try {
        const url = new URL(page.url());
        observation.owned_root_page =
          ['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname === '/';
      } catch {
        // A closed page is itself distinguishable from a live owned fixture.
      }
    })(),
    (async () => {
      try {
        const state = await evaluate(
          panel,
          '({ visibility: document.visibilityState, hasFocus: document.hasFocus() })',
        );
        observation.panel_visibility = state?.visibility ?? null;
        observation.panel_has_focus = state?.hasFocus ?? null;
      } catch {
        // The original CDP session may have been retired after authentication.
      }
    })(),
    (async () => {
      try {
        const targets = (await browserSession.send('Target.getTargets')).targetInfos;
        const exact = targets.filter(
          (target) => target.type === 'page' && target.url === panelTarget.url,
        );
        observation.original_panel_target_present = targets.some(
          (target) => target.targetId === panelTarget.targetId,
        );
        observation.exact_panel_target_count = exact.length;
        observation.original_is_only_exact_panel_target =
          exact.length === 1 && exact[0].targetId === panelTarget.targetId;
      } catch {
        // Leave unknown fields null when target discovery itself fails.
      }
    })(),
    (async () => {
      try {
        // The harness uses chrome.runtime.getContexts from its exact owned worker
        // and reduces the result through its canonical context classifier.
        observation.side_panel_context = await inspectPanelContext();
      } catch {
        // A retired worker or unavailable context query remains unmeasured.
      }
    })(),
  ];
  let settledProbes = 0;
  const trackedProbes = probes.map((probe) =>
    probe.finally(() => {
      settledProbes += 1;
    }),
  );
  let timer;
  await Promise.race([
    Promise.allSettled(trackedProbes),
    new Promise((resolveTimeout) => {
      timer = setTimeout(() => {
        expired = true;
        resolveTimeout();
      }, timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
  return {
    ...observation,
    diagnostic_timed_out: expired,
    outstanding_probes_after_deadline: expired && settledProbes < probes.length,
  };
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
  } finally {
    try {
      report.media_event_traces.push({
        phase,
        ...(await mediaTransitionProbe(panel, { phase }, 'finish')),
      });
    } catch (error) {
      report.media_event_traces.push({
        phase,
        probeError: String(error?.message ?? error).slice(0, 120),
      });
    }
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
        ...(${observeScrapeRows.toString()})(content),
        linkToolbar: content.querySelector('span.uppercase')?.textContent?.trim()??null,
      } : null,
      error:buttons.some(n=>n.getAttribute('aria-label')==='Dismiss'),
      reload:buttons.some(n=>n.textContent.trim()==='Reload page'),
      retry:buttons.some(n=>n.textContent.trim()==='Try again'),
      saved:buttons.some(n=>n.textContent.trim()==='Saved')};
  })()`,
  );
}

// Capture only fixed fixture controls and identities around each native media action.
async function mediaTransitionProbe(panel, operation, action = 'snapshot') {
  return evaluate(
    panel,
    `(() => {
    const action=${JSON.stringify(action)}, operation=${JSON.stringify(operation)};
    const key='__matrxScrapeMediaTransitionProbe';
    const outer=document.querySelector('button[role="tab"][title="Scrape"][data-state="active"]');
    const pane=outer&&document.getElementById(outer.getAttribute('aria-controls'));
    const currentPane=()=>{const active=document.querySelector('button[role="tab"][title="Scrape"][data-state="active"]');
      return active&&document.getElementById(active.getAttribute('aria-controls'));};
    const tabs=()=>[...(currentPane()?.querySelectorAll('[role="tablist"] [role="tab"]')??[])];
    const tabLabel=(node)=>{
      const label=node?.firstChild?.textContent?.trim();
      return ['Article','Images','Video','Links','SEO','Schema'].includes(label)?label:null;
    };
    const selected=()=>tabLabel(tabs().find(node=>node.getAttribute('aria-selected')==='true'));
    const imagePaths=()=>{
      const tab=tabs().find(node=>tabLabel(node)==='Images');
      const content=tab&&document.getElementById(tab.getAttribute('aria-controls'));
      return content ? [...content.querySelectorAll('a:has(img)')].map(node=>{
        try { const path=new URL(node.href).pathname;
          return ['/intake.svg','/appointment-card.svg','/clinic-icon.svg','/followup-card.svg'].includes(path)?path:'other';
        } catch { return 'invalid'; }
      }) : null;
    };
    const state=()=>({selected:selected(),imagePaths:imagePaths(),
      imageCount:tabs().find(node=>tabLabel(node)==='Images')?.querySelector('span')?.textContent?.trim()??null,
      panePresent:Boolean(currentPane()?.isConnected)});
    if(action==='start') {
      const existing=window[key];
      if(existing) {existing.actionStart=existing.events.length; existing.droppedStart=existing.droppedEvents;
        existing.actionTabs=tabs(); existing.actionPane=currentPane(); return state();}
      const firstTabs=tabs(); const events=[]; let droppedEvents=0;
      let lastSelected=selected(), lastSameTabs=true;
      const record=(entry)=>{if(events.length<256) events.push({ms:Math.round(performance.now()),...entry});else droppedEvents++;};
      const pointer=(event)=>{
        const target=event.target instanceof Element?event.target:null;
        if(!currentPane()?.contains(target)) return;
        const tab=target?.closest('[role="tab"]');
        const button=target?.closest('button');
        const input=target?.closest('input');
        const anchor=target?.closest('a');
        const buttonTitle=button?.title;
        const buttonText=button?.textContent?.trim();
        let control=tab?'tab:'+tabLabel(tab):null;
        if(!control&&['Remove image','Remove video','Remove link','Copy video URL','Copy URL'].includes(buttonTitle)) control=buttonTitle;
        if(!control&&['Add image URL','Add video URL','Add link','Add','Cancel'].includes(buttonText)) control=buttonText;
        if(!control&&input) control=['https://…','anchor text (optional)','alt text (optional)'].includes(input.placeholder)?'field:'+input.placeholder:'other_field';
        if(!control&&anchor) {
          try { const path=new URL(anchor.href).pathname;
            control=['/intake-walkthrough.mp4','/referral-walkthrough.mp4','/consultation.mp4','/forms','/appointments','/referrals'].includes(path)?'open:'+path:'other_link';
          } catch { control='invalid_link'; }
        }
        if(!control) return;
        record({type:event.type,trusted:event.isTrusted,x:Math.round(event.clientX),y:Math.round(event.clientY),
          target:control,selected:selected()});
      };
      for(const type of ['pointerdown','pointerup','click']) document.addEventListener(type,pointer,true);
      const observer=new MutationObserver(()=>{
        const nextSelected=selected(), sameTabs=firstTabs.every(node=>node.isConnected);
        if(nextSelected!==lastSelected||sameTabs!==lastSameTabs)
          record({type:'tab_change',selected:nextSelected,sameTabs});
        lastSelected=nextSelected; lastSameTabs=sameTabs;
      });
      observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-selected','data-state']});
      window[key]={operation,events,firstTabs,firstPane:pane,actionStart:0,droppedStart:0,
        actionTabs:firstTabs,actionPane:pane,get droppedEvents(){return droppedEvents},stop:()=>{
        observer.disconnect(); for(const type of ['pointerdown','pointerup','click']) document.removeEventListener(type,pointer,true);
      }};
      return state();
    }
    if(action==='stop') {
      const probe=window[key]; const actionEvents=probe?.events.slice(probe.actionStart)??[];
      const eventsDropped=(probe?.droppedEvents??0)-(probe?.droppedStart??0)+Math.max(0,actionEvents.length-32);
      return {state:state(),events:actionEvents.slice(0,32),eventsDropped,truncated:eventsDropped>0,
        tabsConnected:probe?.actionTabs?.every(node=>node.isConnected)??null,
        paneConnected:probe?.actionPane?.isConnected??null};
    }
    if(action==='finish') {
      const probe=window[key]; probe?.stop?.(); delete window[key];
      return {events:probe?.events??[],eventsDropped:probe?.droppedEvents??0,truncated:(probe?.droppedEvents??0)>0,
        tabsConnected:probe?.firstTabs?.every(node=>node.isConnected)??null,
        paneConnected:probe?.firstPane?.isConnected??null,state:state()};
    }
    return state();
  })()`,
  );
}

const fixturePaths = new Set([
  '/intake.svg',
  '/appointment-card.svg',
  '/clinic-icon.svg',
  '/followup-card.svg',
  '/intake-walkthrough.mp4',
  '/referral-walkthrough.mp4',
  '/consultation.mp4',
  '/forms',
  '/appointments',
  '/referrals',
]);
function mediaIdentity(phase, kind, target) {
  const labels = new Set([
    'Article',
    'Images',
    'Video',
    'Links',
    'Add image URL',
    'Add video URL',
    'Add link',
    'Add',
    'Cancel',
    'src',
    'href',
    'text',
    'alt',
  ]);
  let label = labels.has(target) ? target : 'other';
  if (typeof target === 'string' && target.startsWith('http')) {
    try {
      const path = new URL(target).pathname;
      label = fixturePaths.has(path) ? path : 'other_path';
    } catch {
      label = 'invalid_path';
    }
  }
  return { phase, kind, target: label };
}
async function observedMediaAction(panel, operation, action) {
  const entry = { operation, pre: null, post: null, events: [], pointerFailure: null };
  report.media_transitions.push(entry);
  entry.pre = await mediaTransitionProbe(panel, operation, 'start');
  try {
    return await action();
  } catch (error) {
    entry.pointerFailure = error?.driverFailure ?? {
      code: String(error?.message ?? error).slice(0, 120),
    };
    throw error;
  } finally {
    try {
      const end = await mediaTransitionProbe(panel, operation, 'stop');
      entry.post = end.state;
      entry.events = end.events;
      entry.eventsDropped = end.eventsDropped;
      entry.truncated = end.truncated;
      entry.tabsConnected = end.tabsConnected;
      entry.paneConnected = end.paneConnected;
    } catch (error) {
      entry.probeError = String(error?.message ?? error).slice(0, 120);
    }
  }
}

async function observedMediaRemoval({
  panel,
  phase,
  kind,
  href,
  resourceAction,
  requireResourceHealth,
}) {
  await requireResourceHealth();
  return observedMediaAction(panel, mediaIdentity(phase, `remove_${kind}`, href), () =>
    resourceAction(() => click(panel, 'scrape-media-remove', href)),
  );
}

async function selectedMedia(panel, label, items, name, dependencies = {}) {
  return observeSelectedMedia({
    panel,
    label,
    items,
    name,
    evaluate: dependencies.evaluate ?? evaluate,
    scrapeState: dependencies.scrapeState ?? scrapeState,
    ...(dependencies.timeoutMs !== undefined && { timeoutMs: dependencies.timeoutMs }),
  });
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

async function selectedLinks(panel, items, name) {
  const state = await waitFor(
    name,
    () => scrapeState(panel),
    (s) => s?.selected === 'Links' && s.visible && s.media?.linkItems?.length === items.length,
  );
  return assertLinkPane(state, items, name);
}

async function exerciseLinkControls({
  panel,
  page,
  origin,
  phase,
  resourceAction,
  browserSession,
  panelUrl,
}) {
  const observeAction = (kind, target, action) =>
    observedMediaAction(panel, mediaIdentity(phase, kind, target), action);
  await mediaTransitionProbe(panel, { phase }, 'start');
  const link = (path, text) => ({ href: `${origin}${path}`, text });
  const initial = [link('/forms', 'Patient forms'), link('/appointments', 'Appointments')];
  await observeAction('scrape-result-tab', 'Links', () =>
    resourceAction(() => click(panel, 'scrape-result-tab', 'Links')),
  );
  const before = await selectedLinks(panel, initial, `${phase}_two_links`);
  const actions = await observeScrapeLinks({
    page,
    panel,
    urls: initial.map((item) => item.href),
    resourceAction,
    click,
    observeAction,
    evaluate,
    browserSession,
    panelUrl,
  });
  await observedMediaRemoval({
    panel,
    phase,
    kind: 'link',
    href: initial[0].href,
    resourceAction,
    requireResourceHealth: async () => {},
  });
  const removed = await selectedLinks(panel, [initial[1]], `${phase}_link_removed`);
  await observeAction('scrape-media-add-row', 'Add link', () =>
    resourceAction(() => click(panel, 'scrape-media-add-row', 'Add link')),
  );
  await observeAction('scrape-media-form-action', 'Add', () =>
    resourceAction(() => click(panel, 'scrape-media-form-action', 'Add')),
  );
  assert.deepEqual(
    (await mediaForm(panel)).inputs.map((input) => input.value),
    ['', ''],
    `${phase}_blank_link_form_not_retained`,
  );
  const blankRejected = await selectedLinks(panel, [initial[1]], `${phase}_blank_link_rejected`);
  await enterMediaField({
    panel,
    field: 'href',
    value: `${origin}/referrals`,
    resourceAction,
    click,
    observeAction,
  });
  await enterMediaField({
    panel,
    field: 'text',
    value: 'Referral hours',
    resourceAction,
    click,
    observeAction,
  });
  await observeAction('scrape-media-form-action', 'Add', () =>
    resourceAction(() => click(panel, 'scrape-media-form-action', 'Add')),
  );
  const survivors = [initial[1], link('/referrals', 'Referral hours')];
  const added = await selectedLinks(panel, survivors, `${phase}_link_added`);
  await enterMediaField({
    panel,
    field: 'href',
    value: `${origin}/forms`,
    resourceAction,
    click,
    observeAction,
  });
  await enterMediaField({
    panel,
    field: 'text',
    value: 'Discard this draft',
    resourceAction,
    click,
    observeAction,
  });
  await observeAction('scrape-media-form-action', 'Cancel', () =>
    resourceAction(() => click(panel, 'scrape-media-form-action', 'Cancel')),
  );
  await observeAction('scrape-media-add-row', 'Add link', () =>
    resourceAction(() => click(panel, 'scrape-media-add-row', 'Add link')),
  );
  assert.deepEqual(
    (await mediaForm(panel)).inputs.map((input) => input.value),
    ['', ''],
    `${phase}_cancelled_link_draft_retained`,
  );
  const cancelled = await selectedLinks(panel, survivors, `${phase}_link_cancelled`);
  return { phase, before, actions, removed, blankRejected, added, cancelled };
}

async function exerciseMediaControls({
  panel,
  page,
  origin,
  phase,
  resourceAction,
  requireResourceHealth,
  browserSession,
  panelUrl,
}) {
  const observeAction = (kind, target, action) =>
    observedMediaAction(panel, mediaIdentity(phase, kind, target), action);
  await mediaTransitionProbe(panel, { phase }, 'start');
  const image = (path, alt) => ({ href: `${origin}${path}`, src: `${origin}${path}`, alt });
  const images = [
    image('/intake.svg', 'New patient intake desk'),
    image('/appointment-card.svg', 'Appointment card'),
    image('/clinic-icon.svg', 'Clinic icon'),
  ];
  const video = (path) => ({ href: `${origin}${path}`, text: `${origin}${path}` });
  const videos = [video('/intake-walkthrough.mp4'), video('/referral-walkthrough.mp4')];
  await observeAction('scrape-result-tab', 'Images', () =>
    resourceAction(() => click(panel, 'scrape-result-tab', 'Images')),
  );
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
    await observedMediaRemoval({
      panel,
      phase,
      kind: 'image',
      href: removed.href,
      resourceAction,
      requireResourceHealth,
    });
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
  await observeAction('scrape-media-add-row', 'Add image URL', () =>
    resourceAction(() => click(panel, 'scrape-media-add-row', 'Add image URL')),
  );
  await observeAction('scrape-media-form-action', 'Add', () =>
    resourceAction(() => click(panel, 'scrape-media-form-action', 'Add')),
  );
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
    observeAction,
  });
  await enterMediaField({
    panel,
    field: 'alt',
    value: 'Follow-up card',
    resourceAction,
    click,
    observeAction,
  });
  await observeAction('scrape-media-form-action', 'Add', () =>
    resourceAction(() => click(panel, 'scrape-media-form-action', 'Add')),
  );
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
    observeAction,
  });
  await observeAction('scrape-media-form-action', 'Cancel', () =>
    resourceAction(() => click(panel, 'scrape-media-form-action', 'Cancel')),
  );
  await observeAction('scrape-media-add-row', 'Add image URL', () =>
    resourceAction(() => click(panel, 'scrape-media-add-row', 'Add image URL')),
  );
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
  await observeAction('scrape-result-tab', 'Video', () =>
    resourceAction(() => click(panel, 'scrape-result-tab', 'Video')),
  );
  const beforeVideos = await selectedMedia(panel, 'Video', videos, `${phase}_two_videos`);
  const linkEvidence = await observeVideoLinks({
    page,
    panel,
    urls: videos.map((item) => item.href),
    resourceAction,
    click,
    observeAction,
    evaluate,
    browserSession,
    panelUrl,
  });
  await observedMediaRemoval({
    panel,
    phase,
    kind: 'video',
    href: videos[0].href,
    resourceAction,
    requireResourceHealth,
  });
  const removedVideo = await selectedMedia(panel, 'Video', [videos[1]], `${phase}_video_removed`);
  await observeAction('scrape-media-add-row', 'Add video URL', () =>
    resourceAction(() => click(panel, 'scrape-media-add-row', 'Add video URL')),
  );
  await observeAction('scrape-media-form-action', 'Add', () =>
    resourceAction(() => click(panel, 'scrape-media-form-action', 'Add')),
  );
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
    observeAction,
  });
  await observeAction('scrape-media-form-action', 'Add', () =>
    resourceAction(() => click(panel, 'scrape-media-form-action', 'Add')),
  );
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
    observeAction,
  });
  await observeAction('scrape-media-form-action', 'Cancel', () =>
    resourceAction(() => click(panel, 'scrape-media-form-action', 'Cancel')),
  );
  await observeAction('scrape-media-add-row', 'Add video URL', () =>
    resourceAction(() => click(panel, 'scrape-media-add-row', 'Add video URL')),
  );
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
    videos: {
      before: beforeVideos,
      removed: removedVideo,
      added: addedVideo,
      links: linkEvidence,
    },
  };
}

try {
  if (RECEIPT_SELF_TEST) {
    assert.ok(OUTPUT, 'scrape_receipt_self_test_output_required');
    if (process.env.MATRX_SCRAPE_COPY_RECEIPT_SELF_TEST) {
      report.stage = 'guest_copy_after_navigation';
      report.diagnostic_self_test = true;
      const { exerciseCopyReceiptFailure } = await import('./scrape-copy-receipt-fixture.mjs');
      await exerciseCopyReceiptFailure(process.env.MATRX_SCRAPE_COPY_RECEIPT_SELF_TEST);
      throw new Error('scrape_copy_receipt_self_test_did_not_fail');
    }
    report.stage = 'result_tabs';
    report.diagnostic_self_test = true;
    const fixture = [
      { src: 'http://localhost/intake.svg' },
      { src: 'http://localhost/appointment-card.svg' },
      { src: 'http://localhost/clinic-icon.svg' },
    ];
    await selectedMedia({}, 'Images', fixture, 'scrape_Images_loaded', {
      evaluate: async () => null,
      scrapeState: async () => ({
        ready: true,
        title: 'Harbor Dental intake guide',
        resultText: 'Private page text must not enter diagnostic evidence',
        tabs: ['Article', 'Images', 'Video', 'Links', 'SEO', 'Schema'].map((label) => ({
          label,
          selected: label === 'Images',
        })),
        selected: 'Images',
        visible: true,
        media: {
          tabCount: '3',
          imageItems: fixture.map((item, index) => ({
            src: item.src,
            complete: index !== 1,
            naturalWidth: index === 1 ? 0 : 32,
            naturalHeight: index === 1 ? 0 : 32,
          })),
        },
      }),
      timeoutMs: 0,
    });
    throw new Error('scrape_receipt_self_test_did_not_timeout');
  }
  selection = scrapeNativeSelection(process.env);
  const requiredOrganizationName =
    selection.mode === 'admin'
      ? await approvedAdminOrganizationName(process.env.MATRX_APPROVED_ADMIN_ORGANIZATION_FILE)
      : undefined;
  report.mode = selection.mode;
  report.width_mode = selection.widthMode;
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
    headed: true,
    reloadOpenDiagnostic: RELOAD_OPEN_DIAGNOSTIC,
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
    onPanelVisibilityObservation: (value) => report.panel_visibility_timeline.push(value),
    onBrowserLaunchObservation: (value) => {
      report.browser_launch = value;
    },
    onStage: (value) => {
      report.native_stage = value;
    },
    exercisePanel: async ({
      page,
      panel,
      browserSession,
      reopenPanel,
      observePanelVisibility,
      observeAuthenticatedPanel,
      panelTarget,
      inspectPanelContext,
      artifacts,
      reloadExtension,
      requireResourceHealth,
      resourceAction,
    }) => {
      await requireResourceHealth();
      report.browser_version = (await browserSession.send('Browser.getVersion')).product;
      report.extension_runtime_id = await evaluate(panel, 'chrome.runtime.id');
      if (selection.mode !== 'guest') {
        await observePanelVisibility('before_authentication');
        const transition = await startPanelTransitionRecorder(panel, {
          requireAuthTrace: selection.mode === 'member',
        });
        let authentication;
        let selectedOrganization;
        try {
          report.stage = 'authentication';
          authentication = await resourceAction(() =>
            signInSettings({
              mode: selection.mode,
              page,
              panel: traceOrganizationPointers(panel, transition),
              repo: REPO,
              adminCredentialsFile: process.env.MATRX_PREPARE_ADMIN_CREDENTIALS_FILE,
              memberLinkFile: process.env.MATRX_REVIEWER_MAGIC_LINK_FILE,
              observeBoundary: observeAuthenticatedPanel,
              onTrace: (phase) => transition.mark?.(phase),
              onStage: (value) => {
                report.auth_stage = value;
              },
            }),
          );
          await observePanelVisibility('after_authentication');
          report.stage = 'organization_selection';
          await transition.mark?.('before_health');
          selectedOrganization = await resourceAction(async () => {
            await transition.mark?.('after_health');
            await transition.mark?.('organization_entry');
            return selectRequiredSettingsOrganization({
              panel: traceOrganizationPointers(panel, transition),
              mode: selection.mode,
              email: authentication.email,
              profileId: authentication.profileId,
              requiredOrganizationName,
              onBranch: (branch) => transition.mark?.(branch),
            });
          });
          await transition.mark?.('after_organization');
          await observePanelVisibility('after_organization_selection');
        } finally {
          report.panel_transition = transition.stop ? await transition.stop() : transition;
          report.panel_transition.interval = classifyPanelTransition(report.panel_transition);
        }
        expectedIdentity = {
          profileId: authentication.profileId,
          email: authentication.email,
          organizationId: selectedOrganization.organizationId,
          organizationName: selectedOrganization.organizationName,
        };
        report.authentication = {
          mode: authentication.mode,
          account_fingerprint: authentication.account_fingerprint,
          web_signed_in: authentication.web_signed_in,
          extension_signed_in: authentication.extension_signed_in,
          admin_role: authentication.admin_role,
          canonical_nonadmin_check: authentication.canonical_nonadmin_check,
          organization_selected: true,
          selected_organization_verified: true,
          rendered_identity: selectedOrganization.renderedIdentity,
        };
        assert.equal(authentication.mode, selection.mode, 'scrape_authenticated_mode_mismatch');
        await resourceAction(() => reopenPanel());
        try {
          await waitFor(
            'scrape_authenticated_panel_foreground',
            () => evaluate(panel, 'document.visibilityState === "visible"'),
            (visible) => visible === true,
          );
        } catch (error) {
          report.panel_foreground_diagnostic = await authenticatedPanelForegroundDiagnostic({
            page,
            panel,
            browserSession,
            panelTarget,
            inspectPanelContext,
          });
          throw error;
        }
        await requireResourceHealth();
      }
      report.panel_viewports.push({
        phase: 'warm',
        ...(await selectScrapePanelViewport(panel, selection, evaluate)),
      });
      report.stage = 'fixture_navigation';
      if (selection.mode === 'guest') {
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
      } else {
        const identity = await panelIdentity(panel);
        assert.equal(
          identity.profileId,
          expectedIdentity.profileId,
          'scrape_profile_identity_mismatch',
        );
        assert.equal(
          identity.organizationId,
          expectedIdentity.organizationId,
          'scrape_organization_identity_mismatch',
        );
        assert.equal(
          identity.organizationName,
          expectedIdentity.organizationName,
          'scrape_organization_name_mismatch',
        );
        assert.equal(identity.isAdmin, selection.mode === 'admin', 'scrape_role_mismatch');
      }
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
          'Full extension reload and post-reload capture not yet exercised.',
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
      const warmExportBefore = await readCaptureExport({
        panel,
        browserSession,
        panelUrl: panelTarget.url,
        mode: selection.mode,
        url: `${origin}/intake`,
        title: article,
        resourceAction,
        requireResourceHealth,
      });
      const viewed = {};
      const mediaEvidence = {};
      const warmPaneSnapshots = {};
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
        warmPaneSnapshots[label] = capturePaneSnapshot(state);
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
      const warmCaptureInvariance = await verifyCaptureUnchanged({
        panel,
        baseline: warmPaneSnapshots,
        labels: expectedTabs,
        click,
        resourceAction,
        requireResourceHealth,
        scrapeState,
        waitFor,
        phase: 'warm',
      });
      const warmExportAfter = await readCaptureExport({
        panel,
        browserSession,
        panelUrl: panelTarget.url,
        mode: selection.mode,
        url: `${origin}/intake`,
        title: article,
        resourceAction,
        requireResourceHealth,
      });
      warmCaptureInvariance.export = assertCaptureExportUnchanged(
        warmExportBefore,
        warmExportAfter,
        'warm',
      );
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
          browserSession,
          panelUrl: panelTarget.url,
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

      report.stage = 'warm_link_controls';
      const warmLinkControls = await captureMediaFailure(panel, artifacts, 'warm-links', () =>
        exerciseLinkControls({
          panel,
          page,
          origin,
          phase: 'warm',
          resourceAction,
          browserSession,
          panelUrl: panelTarget.url,
        }),
      );
      report.link_controls = { warm: warmLinkControls };
      const warmLinkVerdict = videoLinksVerdict(warmLinkControls.actions);
      mark(
        'EXT-F-1007-T13',
        warmLinkVerdict.status === 'failed' ? 'failed' : 'partial',
        { warm: warmLinkControls },
        [
          `Repeat controls after full extension reload; ${otherRoleNote()}`,
          ...warmLinkVerdict.remaining,
        ],
      );
      if (warmLinkVerdict.failures.length) report.cases.at(-1).failure = warmLinkVerdict.failures;

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
      await confirmScrapeRecapture({ panel, evaluate, waitFor, click, resourceAction });
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
        ['Deep failure retry mode and post-reload deep capture remain unverified.'],
      );
      if (selection.mode === 'guest') {
        report.stage = 'guest_scroll_sync';
        await requireResourceHealth();
        mark('EXT-F-1007-T07', 'unverified', {}, ['Native scroll exercise incomplete.']);
        const scroll = await runGuestScrollSync({ panel, page, resourceAction });
        const scrollCase = report.cases.find((c) => c.id === 'EXT-F-1007-T07');
        scrollCase.status = scroll.passed ? 'partial' : 'failed';
        scrollCase.evidence.warm = scroll;
        scrollCase.remaining = ['Repeat after full extension reload.'];
        if (!scroll.passed)
          scrollCase.evidence.warm_screenshot = await screenshot(
            panel,
            artifacts,
            'scrape-warm-scroll-mismatch.png',
          );
        // T09 is independent of T07. Continue only when the failed scroll
        // exercise left the owned intake capture and disabled control intact.
        if (!scroll.passed) {
          const restored = await scrapeState(panel);
          assert.ok(
            scroll.stopped?.off === true &&
              scroll.stopped?.on === false &&
              scroll.stopped.pageY === 0 &&
              page.url() === `${origin}/intake` &&
              restored?.selected === 'Article' &&
              restored?.resultText?.includes(lazy),
            'scrape_guest_scroll_recovery_not_proven',
          );
        }
        report.stage = 'guest_copy_menus';
        mark('EXT-F-1007-T09', 'unverified', {}, ['Native copy exercise incomplete.']);
        const copies = await runGuestCopyMenus({
          panel,
          browserSession,
          panelUrl: panelTarget.url,
          origin,
          fixtureKey: 'intake',
          resourceAction,
        });
        const copyCase = report.cases.find((c) => c.id === 'EXT-F-1007-T09');
        copyCase.status = 'partial';
        copyCase.evidence.warm = copies;
        copyCase.remaining = ['Repeat after full extension reload.'];
      }

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
      if (selection.mode === 'guest') {
        report.stage = 'guest_copy_after_navigation';
        await requireResourceHealth();
        report.cases.find((c) => c.id === 'EXT-F-1007-T09').evidence.after_navigation =
          await runGuestCopyMenus({
            panel,
            browserSession,
            panelUrl: panelTarget.url,
            origin,
            fixtureKey: 'referrals',
            resourceAction,
          });
      }
      const warmEmptyPanes = await observeEmptyMediaPanes({
        panel,
        phase: 'warm',
        click,
        resourceAction,
        requireResourceHealth,
        observeSelectedMedia,
        evaluate,
        scrapeState,
      });
      mediaEvidence.images_empty = warmEmptyPanes.images;
      mediaEvidence.video_empty = warmEmptyPanes.video;
      const t08 = report.cases.find((c) => c.id === 'EXT-F-1007-T08');
      t08.evidence.matching_content.images_empty = mediaEvidence.images_empty;
      t08.evidence.matching_content.video_empty = mediaEvidence.video_empty;
      t08.evidence.capture_invariance = { warm: warmCaptureInvariance };
      t08.remaining = [otherRoleNote(), 'Full extension reload lifecycle remains unverified.'];
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
        report.panel_viewports.push({
          phase: 'reload',
          ...(await selectScrapePanelViewport(replacement.panel, selection, evaluate)),
        });
        if (selection.mode !== 'guest') {
          report.stage = 'reload_authentication';
          await resourceAction(() => click(replacement.panel, 'title', 'Settings'));
          const rendered = await resourceAction(() =>
            verifyCurrentSettingsIdentity({
              panel: replacement.panel,
              mode: selection.mode,
              email: expectedIdentity.email,
              profileId: expectedIdentity.profileId,
              organizationId: expectedIdentity.organizationId,
              requireSelectedOrganization: true,
              requiredOrganizationName: expectedIdentity.organizationName,
            }),
          );
          assert.equal(
            Object.values(rendered).every(Boolean),
            true,
            'scrape_reloaded_identity_unverified',
          );
          const stored = await panelIdentity(replacement.panel);
          assert.equal(
            stored.profileId,
            expectedIdentity.profileId,
            'scrape_reloaded_profile_identity_mismatch',
          );
          assert.equal(
            stored.organizationId,
            expectedIdentity.organizationId,
            'scrape_reloaded_organization_mismatch',
          );
          assert.equal(
            stored.organizationName,
            expectedIdentity.organizationName,
            'scrape_reloaded_organization_name_mismatch',
          );
          report.reload_authentication = {
            mode: selection.mode,
            ...rendered,
            organization_selected: true,
            selected_organization_verified: true,
            profile_matches_warm: true,
            organization_matches_warm: true,
          };
        } else {
          const stored = await panelIdentity(replacement.panel);
          assert.equal(stored.accessTokenPresent, false, 'scrape_reloaded_guest_token_present');
          assert.equal(stored.profileId, null, 'scrape_reloaded_guest_profile_present');
          report.reload_authentication = { mode: 'guest', guest_storage_empty: true };
        }
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
        if (selection.mode === 'guest') {
          report.stage = 'guest_behavior_after_reload';
          await requireResourceHealth();
          const scroll = await runGuestScrollSync({
            panel: replacement.panel,
            page,
            resourceAction,
          });
          const scrollCase = report.cases.find((c) => c.id === 'EXT-F-1007-T07');
          scrollCase.evidence.reload = scroll;
          if (!scroll.passed)
            scrollCase.evidence.reload_screenshot = await screenshot(
              replacement.panel,
              artifacts,
              'scrape-reload-scroll-mismatch.png',
            );
          if (!scroll.passed) {
            const restored = await scrapeState(replacement.panel);
            assert.ok(
              scroll.stopped?.off === true &&
                scroll.stopped?.on === false &&
                scroll.stopped.pageY === 0 &&
                page.url() === `${origin}/intake` &&
                restored?.selected === 'Article' &&
                restored?.resultText?.includes(article),
              'scrape_guest_reload_scroll_recovery_not_proven',
            );
            scrollCase.status = 'failed';
          } else if (scrollCase.status !== 'failed') {
            scrollCase.status = 'passed';
            scrollCase.remaining = [];
          }
          const copies = await runGuestCopyMenus({
            panel: replacement.panel,
            browserSession,
            panelUrl: replacement.panelTarget?.url ?? panelTarget.url,
            origin,
            fixtureKey: 'intake',
            resourceAction,
          });
          const copyCase = report.cases.find((c) => c.id === 'EXT-F-1007-T09');
          copyCase.evidence.reload = copies;
          copyCase.status = 'passed';
          copyCase.remaining = [];
        }
        const t01 = report.cases.find((c) => c.id === 'EXT-F-1007-T01');
        t01.evidence.full_extension_reload_and_post_reload_fast_capture = true;
        t01.remaining = [
          otherRoleNote(),
          ...(selection.widthMode === 'normal'
            ? []
            : ['Normal-width verification remains unverified.']),
        ];
        const postReloadPanes = { article: recaptured.resultText.includes(article) };
        const reloadExportBefore = await readCaptureExport({
          panel: replacement.panel,
          browserSession,
          panelUrl: replacement.panelTarget?.url ?? panelTarget.url,
          mode: selection.mode,
          url: `${origin}/intake`,
          title: article,
          resourceAction,
          requireResourceHealth,
        });
        const reloadPaneSnapshots = { Article: capturePaneSnapshot(recaptured) };
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
          reloadPaneSnapshots[label] = capturePaneSnapshot(state);
        }
        for (const label of ['Images', 'Video']) {
          await requireResourceHealth();
          await resourceAction(() => click(replacement.panel, 'scrape-result-tab', label));
          const state = await waitFor(
            `scrape_post_reload_${label}_snapshot`,
            () => scrapeState(replacement.panel),
            (value) =>
              value?.selected === label && value.visible && typeof value.resultText === 'string',
          );
          reloadPaneSnapshots[label] = capturePaneSnapshot(state);
        }
        const reloadCaptureInvariance = await verifyCaptureUnchanged({
          panel: replacement.panel,
          baseline: reloadPaneSnapshots,
          labels: expectedTabs,
          click,
          resourceAction,
          requireResourceHealth,
          scrapeState,
          waitFor,
          phase: 'reload',
        });
        const reloadExportAfter = await readCaptureExport({
          panel: replacement.panel,
          browserSession,
          panelUrl: replacement.panelTarget?.url ?? panelTarget.url,
          mode: selection.mode,
          url: `${origin}/intake`,
          title: article,
          resourceAction,
          requireResourceHealth,
        });
        reloadCaptureInvariance.export = assertCaptureExportUnchanged(
          reloadExportBefore,
          reloadExportAfter,
          'reload',
        );
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
              browserSession,
              panelUrl: replacement.panelTarget?.url ?? panelTarget.url,
            }),
        );
        report.media_controls.reload = reloadControls;
        report.stage = 'post_reload_link_controls';
        const reloadLinkControls = await captureMediaFailure(
          replacement.panel,
          artifacts,
          'reload-links',
          () =>
            exerciseLinkControls({
              panel: replacement.panel,
              page,
              origin,
              phase: 'reload',
              resourceAction,
              browserSession,
              panelUrl: replacement.panelTarget?.url ?? panelTarget.url,
            }),
        );
        report.link_controls.reload = reloadLinkControls;
        postReloadPanes.images = reloadControls.images.before;
        postReloadPanes.video = reloadControls.videos.before;
        report.post_reload_populated_panes = postReloadPanes;
        const t08 = report.cases.find((c) => c.id === 'EXT-F-1007-T08');
        t08.evidence.post_reload_populated_panes = postReloadPanes;
        t08.evidence.capture_invariance.reload = reloadCaptureInvariance;
        t08.remaining = [
          otherRoleNote(),
          ...(selection.widthMode === 'normal'
            ? []
            : ['Normal-width verification remains unverified.']),
        ];
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
        const t13 = report.cases.find((c) => c.id === 'EXT-F-1007-T13');
        t13.evidence.reload = reloadLinkControls;
        const linkVerdict = videoLinksVerdict(warmLinkControls.actions, reloadLinkControls.actions);
        t13.status = linkVerdict.status === 'passed' ? 'partial' : linkVerdict.status;
        t13.remaining = [otherRoleNote(), ...linkVerdict.remaining];
        if (linkVerdict.failures.length) t13.failure = linkVerdict.failures;
        report.stage = 'post_reload_empty_media_capture';
        await requireResourceHealth();
        await resourceAction(() => page.goto(`${origin}/referrals`));
        await waitFor(
          'scrape_post_reload_referrals_empty',
          () => scrapeState(replacement.panel),
          (state) => state?.ready && state.empty && state.title === 'Harbor Dental referral hours',
        );
        // Keep the next failed boundary attributable without exporting page or account data.
        const captureBoundary = { pointer_phase: null, click_events: null, busy_observed: null };
        report.post_reload_capture_boundary = captureBoundary;
        await runPostReloadCaptureBoundary({
          panel: replacement.panel,
          evaluate,
          click,
          resourceAction,
          waitFor,
          scrapeState,
          boundary: captureBoundary,
        });
        const reloadEmptyPanes = await observeEmptyMediaPanes({
          panel: replacement.panel,
          phase: 'reload',
          click,
          resourceAction,
          requireResourceHealth,
          observeSelectedMedia,
          evaluate,
          scrapeState,
        });
        t08.evidence.post_reload_empty_panes = reloadEmptyPanes;
        assertCompleteTabCoverage({
          warm: { invariance: warmCaptureInvariance, empty: warmEmptyPanes },
          reload: { invariance: reloadCaptureInvariance, empty: reloadEmptyPanes },
        });
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
  if (report.cases.some((c) => c.id === 'EXT-F-1007-T07' && c.status === 'failed')) {
    report.failure = { stage: 'guest_scroll_sync', code: 'scrape_guest_scroll_sync_mismatch' };
  }
  if (report.status === 'failed') process.exitCode = 1;
  if (refuseDiagnosticAcceptance(report, RELOAD_OPEN_DIAGNOSTIC)) process.exitCode = 1;
} catch (error) {
  report.status = 'unverified';
  report.failure = { stage: report.stage, code: String(error?.message ?? error).slice(0, 300) };
  retainScrapeMediaFailure(report, error);
  if (error?.driverFailure) report.driver_failure = error.driverFailure;
  retainCopyTargetContext(report, error);
  if (error?.lifecycleEvidence)
    report.reload_lifecycle_failure = captureLifecycleEvidence(error.lifecycleEvidence);
  if (error?.contextBoundary) report.reload_context_failure = error.contextBoundary;
  process.exitCode = 1;
}
await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${report.status.toUpperCase()} scrape_${report.mode}_native ${OUTPUT}\n`);
