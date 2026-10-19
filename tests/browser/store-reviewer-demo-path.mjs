import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import {
  clickPickerCancel,
  clickPickerDone,
  clickPickerField,
} from './data-guest-picker-driver.mjs';
import { guestTransportModeForReceipt } from './guest-chat-transport-observer.mjs';
import {
  autoScrapePreferenceMatches,
  captureAutoScrapeBaseline,
} from './settings-auto-scrape-capture-baseline.mjs';
import { click, evaluate, openSection, waitFor } from './settings-panel-driver.mjs';

export const REVIEWER_DEMO_URL = 'https://www.aimatrx.com/matrx-extend-demo';

function safeReviewerFailureCode(error) {
  const code = /^([a-z][a-z0-9_]{0,79})(?::|$)/i.exec(String(error?.message ?? ''))?.[1];
  if (
    code &&
    new Set([
      'reviewer_auto_capture_switch_missing',
      'reviewer_fresh_auto_capture_not_off',
      'reviewer_scrape_ready_not_observed',
      'reviewer_auto_capture_occurred_before_click',
      'reviewer_article_capture_not_observed',
      'reviewer_links_capture_not_observed',
      'reviewer_schema_capture_not_observed',
      'reviewer_seo_ready_not_observed',
      'reviewer_demo_seo_audit_not_observed',
      'reviewer_data_picker_ready_not_observed',
      'reviewer_data_guest_explanation_missing',
      'reviewer_data_workflow_field_selected_not_observed',
      'reviewer_data_selector_missing',
      'reviewer_data_selector_did_not_identify_workflow_cell',
      'reviewer_data_draft_cleared_not_observed',
      'pointer_target_not_unique',
      'pointer_stable_hit_not_observed',
      'pointer_followup_evaluation_failed',
      'pointer_page_sample_failed',
      'panel_runtime_exception',
      'reviewer_failure_screenshot_wrong_page',
      'reviewer_failure_screenshot_unknown_check',
      'reviewer_failure_screenshot_pane_unavailable',
      'reviewer_failure_screenshot_target_unavailable',
      'reviewer_failure_screenshot_sensitive_input',
      'reviewer_demo_title_missing',
      'reviewer_demo_workflow_table_changed',
      'reviewer_demo_article_missing',
      'reviewer_demo_requires_exact_public_url',
      'reviewer_demo_public_link_changed',
      'reviewer_demo_schema_changed',
      'public_demo_navigation_failed',
      'reviewer_playwright_timeout',
      'reviewer_observation_failed',
    ]).has(code)
  )
    return code;
  if (error?.name === 'TimeoutError') return 'reviewer_playwright_timeout';
  return 'reviewer_observation_failed';
}

const REVIEWER_PANES = {
  fresh_auto_capture_off: 'Settings',
  capture_article: 'Scrape',
  capture_links: 'Scrape',
  capture_schema: 'Scrape',
  seo_audit: 'SEO',
  data_workflow_picker: 'Data',
};

const REVIEWER_TARGETS = {
  fresh_auto_capture_off: [
    'fresh_auto_capture_off_open',
    'settings_scrape_section',
    'settings_auto_capture_switch',
  ],
  capture_article: [
    'capture_article_open',
    'scrape_tab',
    'scrape_capture_button',
    'article_result',
  ],
  capture_links: ['capture_links_open', 'scrape_tab', 'links_result_tab', 'links_result'],
  capture_schema: ['capture_schema_open', 'scrape_tab', 'schema_result_tab', 'schema_result'],
  seo_audit: ['seo_audit_open', 'seo_tab', 'seo_audit_control', 'seo_audit_result'],
  data_workflow_picker: [
    'data_workflow_picker_open',
    'data_tab',
    'data_picker_button',
    'data_picker_host',
    'data_workflow_cell',
    'data_picker_done',
    'data_selected_field',
    'data_workflow_selector',
    'data_draft_cancel',
  ],
};

// Durable evidence is an explicit projection, never an observation-object spread.
// Strings from the DOM stay local even when a check succeeds.
const EVIDENCE_BOOLEANS = new Set([
  'visible',
  'stored',
  'setting_present',
  'public_heading_present',
  'workflow_stages_present',
  'public_link_text_present',
  'public_schema_headline_present',
  'public_schema_type_present',
  'public_title_matches',
  'headings',
  'reaudit_ready',
  'workflow_row_matched',
  'draft_cleared',
  'pane_active',
  'content_visible',
  'empty',
  'selected_article',
  'selected_links',
  'selected_schema',
  'public_link_present',
  'public_stages_present',
  'error_present',
  'audit_ready',
  'audit_available',
  'headings_present',
  'picker_ready',
  'cancel_ready',
  'guest_explanation_present',
  'switch_on',
  'stored_on',
  'observation_available',
]);
const EVIDENCE_COUNTS = new Set([
  'link_count',
  'unique_selector_matches',
  'selected_count',
  'switch_count',
  'capture_button_count',
]);
function projectReviewerEvidence(value) {
  const result = {};
  for (const [key, entry] of Object.entries(value ?? {})) {
    if (EVIDENCE_BOOLEANS.has(key) && (typeof entry === 'boolean' || entry === null))
      result[key] = entry;
    else if (EVIDENCE_COUNTS.has(key) && Number.isSafeInteger(entry) && entry >= 0)
      result[key] = entry;
    else if (key === 'selected' && ['Article', 'Links', 'Schema'].includes(entry))
      result[key] = entry;
  }
  return result;
}

export async function recordReviewerCheck({ name, run, observeSafe, screenshot }) {
  assert.ok(REVIEWER_TARGETS[name], 'reviewer_unknown_check');
  let target = `${name}_open`;
  const markTarget = (id) => {
    assert.ok(REVIEWER_TARGETS[name].includes(id), 'reviewer_unknown_failure_target');
    target = id;
  };
  try {
    return { status: 'pass', ...projectReviewerEvidence(await run(markTarget)) };
  } catch (error) {
    const failure = {
      status: 'fail',
      failure_code: safeReviewerFailureCode(error),
      failure_target: target,
    };
    try {
      failure.safe_dom = projectReviewerEvidence(await observeSafe(name));
    } catch {
      failure.safe_dom = { observation_available: false };
    }
    try {
      await screenshot(`reviewer-${name}-failure.png`, name);
      failure.failure_screenshot = `reviewer-${name}-failure.png`;
    } catch (error) {
      failure.screenshot_status = safeReviewerFailureCode(error);
    }
    return failure;
  }
}

// Crop only a known control with fixed public text. A selected pane can retain
// arbitrary content from a previous tab, so it is never itself screenshot proof.
export async function captureReviewerPaneScreenshot({ page, panel, file, check }) {
  assert.equal(page.url(), REVIEWER_DEMO_URL, 'reviewer_failure_screenshot_wrong_page');
  const title = REVIEWER_PANES[check];
  assert.ok(title, 'reviewer_failure_screenshot_unknown_check');
  const clip = await evaluate(
    panel,
    `(() => {
    const tabs = [...document.querySelectorAll('button[role="tab"]')]
      .filter(tab => tab.title === ${JSON.stringify(title)} && tab.getAttribute('aria-selected') === 'true');
    const pane = tabs.length === 1 ? document.getElementById(tabs[0].getAttribute('aria-controls') ?? '') : null;
    if (!pane || pane.getAttribute('data-state') !== 'active') return {reason:'reviewer_failure_screenshot_pane_unavailable'};
    if ([...pane.querySelectorAll('input, textarea, [contenteditable="true"]')].some(control =>
      control.getAttribute('type') === 'password' ||
      (!control.matches('input[type="checkbox"], input[type="radio"], input[type="hidden"]') &&
        Boolean(control.value || control.textContent?.trim())))) return {reason:'reviewer_failure_screenshot_sensitive_input'};
    const buttons = [...pane.querySelectorAll('button')];
    const matches = buttons.filter(button => {
      const label = button.textContent?.trim() ?? '';
      if (${JSON.stringify(check)} === 'fresh_auto_capture_off')
        return button.getAttribute('role') === 'switch' && button.getAttribute('aria-label') === 'Auto-scrape on load' && !label;
      if (${JSON.stringify(check)} === 'capture_article')
        return (button.getAttribute('title') === 'Capture the page exactly as it is right now' || button.getAttribute('data-matrx-title') === 'Capture the page exactly as it is right now') && !label;
      if (${JSON.stringify(check)} === 'capture_links') return button.getAttribute('role') === 'tab' && label === 'Links';
      if (${JSON.stringify(check)} === 'capture_schema') return button.getAttribute('role') === 'tab' && label === 'Schema';
      if (${JSON.stringify(check)} === 'seo_audit') return label === 'Audit this page' || label === 'Re-audit';
      if (${JSON.stringify(check)} === 'data_workflow_picker') return label === 'Pick fields on this page' || label === 'Cancel';
      return false;
    });
    if (matches.length !== 1) return {reason:'reviewer_failure_screenshot_target_unavailable'};
    const rect = matches[0].getBoundingClientRect();
    const x = Math.max(0, Math.ceil(rect.left)), y = Math.max(0, Math.ceil(rect.top));
    const right = Math.min(document.documentElement.clientWidth, Math.floor(rect.right));
    const bottom = Math.min(document.documentElement.clientHeight, Math.floor(rect.bottom));
    const hit = document.elementFromPoint?.((x+right)/2, (y+bottom)/2);
    if (hit && hit !== matches[0] && !matches[0].contains(hit)) return {reason:'reviewer_failure_screenshot_target_unavailable'};
    return right > x && bottom > y ? {x, y, width:right-x, height:bottom-y, scale:1} : {reason:'reviewer_failure_screenshot_target_unavailable'};
  })()`,
  );
  assert.ok(clip && !clip.reason, clip?.reason ?? 'reviewer_failure_screenshot_target_unavailable');
  const result = await panel.send('Page.captureScreenshot', {
    format: 'png',
    clip,
    captureBeyondViewport: false,
  });
  const png = Buffer.from(result.data, 'base64');
  assert.equal(png.readUInt32BE(16), clip.width);
  assert.equal(png.readUInt32BE(20), clip.height);
  await writeFile(file, png, { mode: 0o600 });
  return file;
}

const REQUIRED_CHECKS = [
  'fresh_auto_capture_off',
  'capture_article',
  'capture_links',
  'capture_schema',
  'seo_audit',
  'data_workflow_picker',
];

export function isExactStoreReviewerCandidate(receipt) {
  return ['native_store_zip_candidate_key_adapted', 'published_store_crx_unpacked'].includes(
    receipt?.kind,
  );
}

export function storeReviewerAcceptanceStatus(receipt, reviewerDemo) {
  if (!isExactStoreReviewerCandidate(receipt)) return 'pass';
  if (reviewerDemo?.status !== 'pass') return 'unverified';
  try {
    assertReviewerDemoProof(reviewerDemo);
    return 'pass';
  } catch {
    return 'unverified';
  }
}

export function unverifiedReviewerDemoPath(
  failureCode,
  failureTarget = 'public_demo_navigation',
  publicUrlMatches = false,
) {
  const safeCode = safeReviewerFailureCode({ message: failureCode });
  const safeTarget = [
    'public_demo_navigation',
    'public_demo_article_visible',
    'public_demo_source_and_controls',
  ].includes(failureTarget)
    ? failureTarget
    : 'public_demo_navigation';
  return {
    status: 'fail',
    public_url: REVIEWER_DEMO_URL,
    failure_code: safeCode,
    source: {
      status: 'unverified',
      failure_target: safeTarget,
      safe_dom: {
        public_url_matches: publicUrlMatches === true,
        source_observation_available: false,
      },
      screenshot_status: 'public_source_unverified',
    },
    checks: Object.fromEntries(
      REQUIRED_CHECKS.map((name) => [name, { status: 'unverified', reason: safeCode }]),
    ),
  };
}

export function requireExactStoreReviewerReceipt(receipt, runtimeTreeSha256) {
  assert.ok(isExactStoreReviewerCandidate(receipt), 'reviewer_demo_requires_exact_store_payload');
  // Hosted artifact preparation verifies the original ZIP/CRX bytes. The native
  // harness verifies the selected release receipt and launched extension before
  // exercisePanel is called; this measured tree binds that verified input here.
  guestTransportModeForReceipt(receipt);
  assert.match(runtimeTreeSha256 ?? '', /^[a-f0-9]{64}$/, 'reviewer_runtime_tree_hash_missing');
  assert.equal(runtimeTreeSha256, receipt.treeSha256, 'reviewer_runtime_tree_hash_mismatch');
  if (receipt.kind === 'native_store_zip_candidate_key_adapted') {
    assert.equal(
      receipt.artifactSelection?.runtimeTreeSha256,
      runtimeTreeSha256,
      'reviewer_prepared_runtime_tree_mismatch',
    );
  }
  return receipt.kind;
}

export function assertReviewerDemoProof(proof) {
  assert.equal(proof?.public_url, REVIEWER_DEMO_URL, 'reviewer_demo_wrong_page');
  assert.equal(proof?.source?.status, 'pass', 'reviewer_demo_source_unverified');
  assert.deepEqual(
    proof?.source?.stages,
    ['Capture', 'Understand', 'Use'],
    'reviewer_demo_wrong_workflow',
  );
  for (const name of REQUIRED_CHECKS) {
    assert.equal(proof?.checks?.[name]?.status, 'pass', `reviewer_demo_${name}_unverified`);
  }
  assert.equal(
    proof?.checks?.data_workflow_picker?.workflow_row_matched,
    true,
    'reviewer_demo_data_workflow_not_matched',
  );
  return proof;
}

function activePaneExpression(title) {
  return `(() => { const tabs=[...document.querySelectorAll('button[role="tab"][title=${JSON.stringify(title)}][data-state="active"]')];
    const pane=tabs.length===1?document.getElementById(tabs[0].getAttribute('aria-controls')??''):null;
    return pane?.matches('[role="tabpanel"][data-state="active"]') && pane.getBoundingClientRect().height>0 ? pane : null; })()`;
}

async function demoSource(page) {
  return page.evaluate(() => {
    const article = document.querySelector('main article');
    const table = article?.querySelector('table');
    const stages = [...(table?.querySelectorAll('tbody tr th[scope="row"]') ?? [])].map((cell) =>
      cell.textContent.trim(),
    );
    const link = article?.querySelector('a[href="/privacy-policy/extension"]');
    const schema = [...document.querySelectorAll('script[type="application/ld+json"]')]
      .map((node) => {
        try {
          return JSON.parse(node.textContent);
        } catch {
          return null;
        }
      })
      .find((value) => value?.['@type'] === 'Article');
    return {
      url: location.href,
      title: document.title,
      articleText: article?.innerText ?? '',
      stages,
      linkHref: link?.href ?? null,
      linkText: link?.textContent?.trim() ?? null,
      schemaType: schema?.['@type'] ?? null,
      schemaHeadline: schema?.headline ?? null,
    };
  });
}

async function settingsOff(panel) {
  await click(panel, 'title', 'Settings');
  await openSection(panel, 'Scrape');
  return settingsOffSample(panel);
}

async function settingsOffSample(panel) {
  return evaluate(
    panel,
    `(async () => {
    const pane=${activePaneExpression('Settings')};
    const switches=[...(pane?.querySelectorAll('[role="switch"][aria-label="Auto-scrape on load"]')??[])];
    const baseline=await (${captureAutoScrapeBaseline.toString()})(chrome.storage.local);
    return { visible:switches.length===1?switches[0].getAttribute('aria-checked')==='true':null,
      stored:baseline.stored, settingPresent:baseline.settingPresent, switchCount:switches.length };
  })()`,
  );
}

async function scrapeState(panel) {
  return evaluate(
    panel,
    `(() => {
    const pane=${activePaneExpression('Scrape')};
    const tabs=[...(pane?.querySelectorAll('[role="tablist"] [role="tab"]')??[])];
    const selected=tabs.find((tab)=>tab.getAttribute('aria-selected')==='true');
    const content=selected?document.getElementById(selected.getAttribute('aria-controls')??''):null;
    return { active:Boolean(pane), title:pane?.querySelector('.truncate.text-sm.font-medium')?.textContent?.trim()??null,
      empty:pane?.textContent?.includes('Capture this page to extract content.')===true,
      captureButtons:[...(pane?.querySelectorAll('button')??[])].filter((button)=>
        (button.getAttribute('title')??button.getAttribute('data-matrx-title'))==='Capture the page exactly as it is right now').length,
      selected:selected?.firstChild?.textContent?.trim()??null,
      tabLabels:tabs.map((tab)=>tab.firstChild?.textContent?.trim()),
      contentVisible:content?.getAttribute('data-state')==='active' && content.getBoundingClientRect().height>0,
      text:content?.innerText??'',
      linkCount:content?.querySelectorAll('a[href]').length??0,
      error:pane?.querySelector('[role="alert"]')?.innerText??null };
  })()`,
  );
}

async function seoState(panel) {
  return evaluate(
    panel,
    `(() => {
    const pane=${activePaneExpression('SEO')};
    const group=[...(pane?.querySelectorAll('span')??[])].find((node)=>node.textContent.trim()==='Title & description');
    const rows=group?.parentElement?.nextElementSibling?.firstElementChild;
    const titleRow=[...(rows?.children??[])].find((node)=>node.firstElementChild?.textContent.trim()==='Title');
    const title=titleRow?.lastElementChild?.lastElementChild?.textContent.trim()??null;
    const buttons=[...(pane?.querySelectorAll('button')??[])];
    return { active:Boolean(pane), title, headings:[...(pane?.querySelectorAll('span')??[])].some((node)=>node.textContent.trim()==='Headings'),
      auditReady:buttons.some((node)=>node.textContent.trim()==='Re-audit'&&!node.disabled),
      auditAvailable:buttons.some((node)=>node.textContent.trim()==='Audit this page'&&!node.disabled),
      error:/Audit failed:|This page cannot be audited/.test(pane?.innerText??'') };
  })()`,
  );
}

async function dataState(panel) {
  return evaluate(
    panel,
    `(() => {
    const pane=${activePaneExpression('Data')};
    const buttons=[...(pane?.querySelectorAll('button')??[])];
    const selected=[...(pane?.querySelectorAll('span')??[])].filter((span)=>/^field_\\d+:$/.test(span.textContent.trim()))
      .map((span)=>span.parentElement?.textContent?.trim()??'');
    return { active:Boolean(pane), pickerReady:buttons.some((button)=>button.textContent.trim()==='Pick fields on this page'&&!button.disabled),
      selected, cancelReady:buttons.some((button)=>button.textContent.trim()==='Cancel'&&!button.disabled),
      guestExplanation:(pane?.textContent??'').includes('Field selection works as a guest.') };
  })()`,
  );
}

/** Owns the exact-candidate navigation seam; reviewer failure does not skip Chat. */
export async function runStoreReviewerPrelude({
  page,
  panel,
  receipt,
  runtimeTreeSha256,
  screenshot,
  onStage = () => {},
  runDemo = runStoreReviewerDemoPath,
  waitForArticle = () => page.locator('main article').waitFor({ state: 'visible' }),
}) {
  if (!isExactStoreReviewerCandidate(receipt)) return null;
  const ownedUrl = page.url();
  onStage('reviewer_public_demo');
  let proof;
  let preludeTarget = 'public_demo_navigation';
  try {
    if (page.url() !== REVIEWER_DEMO_URL) await page.goto(REVIEWER_DEMO_URL);
    preludeTarget = 'public_demo_article_visible';
    await waitForArticle();
    preludeTarget = 'public_demo_source_and_controls';
    proof = await runDemo({ page, panel, receipt, runtimeTreeSha256, screenshot });
  } catch (error) {
    const failureCode = safeReviewerFailureCode(error);
    proof = unverifiedReviewerDemoPath(
      failureCode,
      preludeTarget,
      page.url() === REVIEWER_DEMO_URL,
    );
  } finally {
    if (ownedUrl !== REVIEWER_DEMO_URL) {
      onStage('owned_article_restored');
      await page.goto(ownedUrl);
      await waitForArticle();
      assert.equal(page.url(), ownedUrl, 'reviewer_demo_owned_article_restore_failed');
    }
  }
  return proof;
}

/** Native reviewer controls on the live demo; each outcome remains independent of Chat. */
export async function runStoreReviewerDemoPath({
  page,
  panel,
  receipt,
  runtimeTreeSha256,
  screenshot,
}) {
  requireExactStoreReviewerReceipt(receipt, runtimeTreeSha256);
  const proof = {
    status: 'unverified',
    public_url: REVIEWER_DEMO_URL,
    artifact: {
      receipt_kind: receipt.kind,
      runtime_tree_sha256: runtimeTreeSha256,
      source_sha: /^[a-f0-9]{40}$/.test(receipt.sourceSha ?? '') ? receipt.sourceSha : null,
      store_zip_sha256: /^[a-f0-9]{64}$/.test(receipt.storeZip?.sha256 ?? '')
        ? receipt.storeZip.sha256
        : null,
    },
    source: null,
    checks: {},
  };
  let source;
  const safeSample = async (name) => {
    if (name === 'fresh_auto_capture_off') {
      const value = await settingsOffSample(panel);
      return {
        switch_count: value.switchCount,
        switch_on: value.visible,
        setting_present: value.settingPresent,
        stored_on: value.stored,
      };
    }
    if (name.startsWith('capture_')) {
      const value = await scrapeState(panel);
      return {
        pane_active: value.active,
        capture_button_count: value.captureButtons,
        content_visible: value.contentVisible,
        empty: value.empty,
        selected_article: value.selected === 'Article',
        selected_links: value.selected === 'Links',
        selected_schema: value.selected === 'Schema',
        public_heading_present: value.text.includes('A clear three-stage browser workflow'),
        public_link_present: value.text.includes('Matrx Extend privacy policy'),
        public_stages_present: ['Capture', 'Understand', 'Use'].every((term) =>
          value.text.includes(term),
        ),
        link_count: value.linkCount,
        error_present: Boolean(value.error),
      };
    }
    if (name === 'seo_audit') {
      const value = await seoState(panel);
      return {
        pane_active: value.active,
        audit_ready: value.auditReady,
        audit_available: value.auditAvailable,
        headings_present: value.headings,
        public_title_matches: value.title === source.title,
        error_present: value.error,
      };
    }
    const value = await dataState(panel);
    return {
      pane_active: value.active,
      picker_ready: value.pickerReady,
      selected_count: value.selected.length,
      cancel_ready: value.cancelReady,
      guest_explanation_present: value.guestExplanation,
    };
  };
  const record = async (name, fn) => {
    proof.checks[name] = await recordReviewerCheck({
      name,
      run: fn,
      observeSafe: safeSample,
      screenshot,
    });
  };
  if (page.url() !== REVIEWER_DEMO_URL) {
    proof.source = {
      status: 'fail',
      failure_code: 'reviewer_demo_requires_exact_public_url',
      failure_target: 'public_demo_url',
      safe_dom: { public_url_matches: false, source_observation_available: false },
      screenshot_status: 'public_source_unverified',
    };
  } else {
    let sourceTarget = 'public_demo_source_read';
    let sourceSafe = { public_url_matches: true, source_observation_available: false };
    try {
      source = await demoSource(page);
      sourceSafe = {
        public_url_matches: source.url === REVIEWER_DEMO_URL,
        source_observation_available: true,
        title_matches: source.title.startsWith('Matrx Extend Demo Page'),
        workflow_matches:
          JSON.stringify(source.stages) === JSON.stringify(['Capture', 'Understand', 'Use']),
        article_marker_present: source.articleText.includes('A clear three-stage browser workflow'),
        public_link_matches: source.linkHref === 'https://www.aimatrx.com/privacy-policy/extension',
        article_schema_matches:
          source.schemaType === 'Article' &&
          source.schemaHeadline === 'A clear three-stage browser workflow',
      };
      sourceTarget = 'public_demo_url';
      assert.equal(source.url, REVIEWER_DEMO_URL);
      sourceTarget = 'public_demo_title';
      assert.ok(source.title.startsWith('Matrx Extend Demo Page'), 'reviewer_demo_title_missing');
      sourceTarget = 'public_demo_workflow';
      assert.deepEqual(
        source.stages,
        ['Capture', 'Understand', 'Use'],
        'reviewer_demo_workflow_table_changed',
      );
      sourceTarget = 'public_demo_article_marker';
      assert.ok(
        source.articleText.includes('A clear three-stage browser workflow'),
        'reviewer_demo_article_missing',
      );
      sourceTarget = 'public_demo_link';
      assert.equal(
        source.linkHref,
        'https://www.aimatrx.com/privacy-policy/extension',
        'reviewer_demo_public_link_changed',
      );
      sourceTarget = 'public_demo_schema';
      assert.equal(source.schemaType, 'Article', 'reviewer_demo_schema_changed');
      assert.equal(
        source.schemaHeadline,
        'A clear three-stage browser workflow',
        'reviewer_demo_schema_changed',
      );
      proof.source = {
        status: 'pass',
        safe_dom: sourceSafe,
        stages: ['Capture', 'Understand', 'Use'],
        linkHref: 'https://www.aimatrx.com/privacy-policy/extension',
        schemaType: 'Article',
        schemaHeadline: 'A clear three-stage browser workflow',
      };
    } catch (error) {
      proof.source = {
        status: 'fail',
        failure_code: safeReviewerFailureCode(error),
        failure_target: sourceTarget,
        safe_dom: sourceSafe,
        screenshot_status: 'public_source_unverified',
      };
    }
  }
  if (proof.source.status !== 'pass') {
    for (const name of REQUIRED_CHECKS)
      proof.checks[name] = { status: 'unverified', reason: 'public_demo_source_missing' };
    proof.status = 'fail';
    return proof;
  }
  await record('fresh_auto_capture_off', async (mark) => {
    mark('settings_scrape_section');
    const off = await settingsOff(panel);
    mark('settings_auto_capture_switch');
    assert.equal(off.switchCount, 1, 'reviewer_auto_capture_switch_missing');
    assert.equal(
      autoScrapePreferenceMatches(off, false),
      true,
      'reviewer_fresh_auto_capture_not_off',
    );
    await screenshot('reviewer-settings-off.png', 'fresh_auto_capture_off');
    return { visible: off.visible, stored: off.stored, setting_present: off.settingPresent };
  });

  await record('capture_article', async (mark) => {
    mark('scrape_tab');
    await click(panel, 'title', 'Scrape');
    mark('scrape_capture_button');
    const before = await waitFor(
      'reviewer_scrape_ready',
      () => scrapeState(panel),
      (value) => value.active && value.captureButtons === 1,
    );
    assert.equal(before.empty, true, 'reviewer_auto_capture_occurred_before_click');
    await click(panel, 'title', 'Capture the page exactly as it is right now');
    mark('article_result');
    const article = await waitFor(
      'reviewer_article_capture',
      () => scrapeState(panel),
      (value) =>
        value.active &&
        value.contentVisible &&
        value.selected === 'Article' &&
        value.text.includes(source.schemaHeadline) &&
        value.text.includes('Capture') &&
        value.text.includes('Understand') &&
        value.text.includes('Use') &&
        !value.error,
      30000,
    );
    await screenshot('reviewer-capture-article.png', 'capture_article');
    return {
      selected: article.selected,
      public_title_matches: article.title === source.title,
      public_heading_present: true,
      workflow_stages_present: true,
    };
  });
  await record('capture_links', async (mark) => {
    mark('scrape_tab');
    await click(panel, 'title', 'Scrape');
    mark('links_result_tab');
    await click(panel, 'scrape-result-tab', 'Links');
    mark('links_result');
    const links = await waitFor(
      'reviewer_links_capture',
      () => scrapeState(panel),
      (value) =>
        value.active &&
        value.contentVisible &&
        value.selected === 'Links' &&
        value.text.includes(source.linkText) &&
        value.linkCount > 0 &&
        !value.error,
    );
    await screenshot('reviewer-capture-links.png', 'capture_links');
    return {
      selected: links.selected,
      public_link_text_present: true,
      link_count: links.linkCount,
    };
  });
  await record('capture_schema', async (mark) => {
    mark('scrape_tab');
    await click(panel, 'title', 'Scrape');
    mark('schema_result_tab');
    await click(panel, 'scrape-result-tab', 'Schema');
    mark('schema_result');
    const schema = await waitFor(
      'reviewer_schema_capture',
      () => scrapeState(panel),
      (value) =>
        value.active &&
        value.contentVisible &&
        value.selected === 'Schema' &&
        value.text.includes(source.schemaHeadline) &&
        value.text.includes('Article') &&
        !value.error,
    );
    await screenshot('reviewer-capture-schema.png', 'capture_schema');
    return {
      selected: schema.selected,
      public_schema_headline_present: true,
      public_schema_type_present: true,
    };
  });
  await record('seo_audit', async (mark) => {
    mark('seo_tab');
    await click(panel, 'title', 'SEO');
    mark('seo_audit_control');
    let seo = await waitFor(
      'reviewer_seo_ready',
      () => seoState(panel),
      (value) => value.active && (value.auditReady || value.auditAvailable) && !value.error,
      30000,
    );
    if (seo.auditAvailable && !seo.auditReady) await click(panel, 'button', 'Audit this page');
    mark('seo_audit_result');
    seo = await waitFor(
      'reviewer_demo_seo_audit',
      () => seoState(panel),
      (value) =>
        value.active &&
        value.auditReady &&
        value.headings &&
        value.title === source.title &&
        !value.error,
      30000,
    );
    await screenshot('reviewer-seo-audit.png', 'seo_audit');
    return {
      public_title_matches: seo.title === source.title,
      headings: seo.headings,
      reaudit_ready: seo.auditReady,
    };
  });
  await record('data_workflow_picker', async (mark) => {
    let pickerOpened = false;
    try {
      mark('data_tab');
      await click(panel, 'title', 'Data');
      mark('data_picker_button');
      const data = await waitFor(
        'reviewer_data_picker_ready',
        () => dataState(panel),
        (value) => value.active && value.pickerReady && value.selected.length === 0,
      );
      assert.equal(data.guestExplanation, true, 'reviewer_data_guest_explanation_missing');
      await click(panel, 'data-picker-button', 'Pick fields on this page');
      pickerOpened = true;
      mark('data_picker_host');
      await page.locator('#matrx-data-picker-host').waitFor({ state: 'attached' });
      mark('data_workflow_cell');
      await clickPickerField(page, 'main article table tbody tr th[scope="row"]', 0);
      mark('data_picker_done');
      await clickPickerDone(page);
      pickerOpened = false;
      mark('data_selected_field');
      const selected = await waitFor(
        'reviewer_data_workflow_field_selected',
        () => dataState(panel),
        (value) =>
          value.active &&
          value.selected.length === 1 &&
          value.cancelReady &&
          /^field_1:\s*.+/.test(value.selected[0]),
      );
      const selector = selected.selected[0].match(/^field_1:\s*(.+)$/)?.[1];
      assert.ok(selector, 'reviewer_data_selector_missing');
      mark('data_workflow_selector');
      const target = await page.evaluate((value) => {
        const matches = [...document.querySelectorAll(value)];
        return {
          count: matches.length,
          workflowRow:
            matches.length === 1 &&
            matches[0] === document.querySelector('main article table tbody tr th[scope="row"]'),
          text: matches[0]?.textContent?.trim() ?? null,
        };
      }, selector);
      assert.deepEqual(
        target,
        { count: 1, workflowRow: true, text: 'Capture' },
        'reviewer_data_selector_did_not_identify_workflow_cell',
      );
      await screenshot('reviewer-data-workflow-picker.png', 'data_workflow_picker');
      mark('data_draft_cancel');
      await click(panel, 'data-cancel-button', 'Cancel');
      await waitFor(
        'reviewer_data_draft_cleared',
        () => dataState(panel),
        (value) => value.active && value.pickerReady && value.selected.length === 0,
      );
      return {
        selected_count: selected.selected.length,
        unique_selector_matches: target.count,
        workflow_row_matched: target.workflowRow,
        draft_cleared: true,
      };
    } finally {
      if (pickerOpened) await clickPickerCancel(page).catch(() => {});
      const state = await dataState(panel).catch(() => null);
      if (state?.cancelReady) await click(panel, 'data-cancel-button', 'Cancel').catch(() => {});
    }
  });
  try {
    assertReviewerDemoProof(proof);
    proof.status = 'pass';
  } catch {
    proof.status = 'fail';
  }
  return proof;
}
