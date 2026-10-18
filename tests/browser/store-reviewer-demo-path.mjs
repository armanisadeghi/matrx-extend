import assert from 'node:assert/strict';
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
  return code ?? 'reviewer_observation_failed';
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

export function unverifiedReviewerDemoPath(failureCode) {
  return {
    status: 'fail',
    public_url: REVIEWER_DEMO_URL,
    failure_code: failureCode,
    source: { status: 'unverified' },
    checks: Object.fromEntries(
      REQUIRED_CHECKS.map((name) => [name, { status: 'unverified', reason: failureCode }]),
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
  try {
    if (page.url() !== REVIEWER_DEMO_URL) await page.goto(REVIEWER_DEMO_URL);
    await waitForArticle();
    proof = await runDemo({ page, panel, receipt, runtimeTreeSha256, screenshot });
  } catch (error) {
    const failureCode = safeReviewerFailureCode(error);
    proof = unverifiedReviewerDemoPath(failureCode);
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
      source_sha: receipt.sourceSha ?? null,
      store_zip_sha256: receipt.storeZip?.sha256 ?? null,
    },
    source: null,
    checks: {},
  };
  const record = async (name, fn) => {
    try {
      proof.checks[name] = { status: 'pass', ...(await fn()) };
    } catch (error) {
      const code = safeReviewerFailureCode(error);
      proof.checks[name] = { status: 'fail', failure_code: code };
    }
  };
  if (page.url() !== REVIEWER_DEMO_URL) {
    proof.source = { status: 'fail', failure_code: 'reviewer_demo_requires_exact_public_url' };
  } else {
    try {
      const source = await demoSource(page);
      assert.equal(source.url, REVIEWER_DEMO_URL);
      assert.ok(source.title.startsWith('Matrx Extend Demo Page'), 'reviewer_demo_title_missing');
      assert.deepEqual(
        source.stages,
        ['Capture', 'Understand', 'Use'],
        'reviewer_demo_workflow_table_changed',
      );
      assert.ok(
        source.articleText.includes('A clear three-stage browser workflow'),
        'reviewer_demo_article_missing',
      );
      assert.equal(source.linkHref, 'https://www.aimatrx.com/privacy-policy/extension');
      assert.equal(source.schemaType, 'Article');
      assert.equal(source.schemaHeadline, 'A clear three-stage browser workflow');
      proof.source = {
        status: 'pass',
        title: source.title,
        stages: source.stages,
        linkHref: source.linkHref,
        linkText: source.linkText,
        schemaType: source.schemaType,
        schemaHeadline: source.schemaHeadline,
      };
    } catch (error) {
      proof.source = { status: 'fail', failure_code: safeReviewerFailureCode(error) };
    }
  }
  if (proof.source.status !== 'pass') {
    for (const name of REQUIRED_CHECKS)
      proof.checks[name] = { status: 'unverified', reason: 'public_demo_source_missing' };
    proof.status = 'fail';
    return proof;
  }
  const source = proof.source;
  await record('fresh_auto_capture_off', async () => {
    const off = await settingsOff(panel);
    assert.equal(off.switchCount, 1, 'reviewer_auto_capture_switch_missing');
    assert.equal(
      autoScrapePreferenceMatches(off, false),
      true,
      'reviewer_fresh_auto_capture_not_off',
    );
    await screenshot('reviewer-settings-off.png');
    return { visible: off.visible, stored: off.stored, setting_present: off.settingPresent };
  });

  await record('capture_article', async () => {
    await click(panel, 'title', 'Scrape');
    const before = await waitFor(
      'reviewer_scrape_ready',
      () => scrapeState(panel),
      (value) => value.active && value.captureButtons === 1,
    );
    assert.equal(before.empty, true, 'reviewer_auto_capture_occurred_before_click');
    await click(panel, 'title', 'Capture the page exactly as it is right now');
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
    await screenshot('reviewer-capture-article.png');
    return {
      selected: article.selected,
      title: article.title,
      public_heading_present: true,
      workflow_stages_present: true,
    };
  });
  await record('capture_links', async () => {
    await click(panel, 'title', 'Scrape');
    await click(panel, 'scrape-result-tab', 'Links');
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
    await screenshot('reviewer-capture-links.png');
    return {
      selected: links.selected,
      public_link_text_present: true,
      link_count: links.linkCount,
    };
  });
  await record('capture_schema', async () => {
    await click(panel, 'title', 'Scrape');
    await click(panel, 'scrape-result-tab', 'Schema');
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
    await screenshot('reviewer-capture-schema.png');
    return {
      selected: schema.selected,
      public_schema_headline_present: true,
      public_schema_type_present: true,
    };
  });
  await record('seo_audit', async () => {
    await click(panel, 'title', 'SEO');
    let seo = await waitFor(
      'reviewer_seo_ready',
      () => seoState(panel),
      (value) => value.active && (value.auditReady || value.auditAvailable) && !value.error,
      30000,
    );
    if (seo.auditAvailable && !seo.auditReady) await click(panel, 'button', 'Audit this page');
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
    await screenshot('reviewer-seo-audit.png');
    return { title: seo.title, headings: seo.headings, reaudit_ready: seo.auditReady };
  });
  await record('data_workflow_picker', async () => {
    let pickerOpened = false;
    try {
      await click(panel, 'title', 'Data');
      const data = await waitFor(
        'reviewer_data_picker_ready',
        () => dataState(panel),
        (value) => value.active && value.pickerReady && value.selected.length === 0,
      );
      assert.equal(data.guestExplanation, true, 'reviewer_data_guest_explanation_missing');
      await click(panel, 'data-picker-button', 'Pick fields on this page');
      pickerOpened = true;
      await page.locator('#matrx-data-picker-host').waitFor({ state: 'attached' });
      await clickPickerField(page, 'main article table tbody tr th[scope="row"]', 0);
      await clickPickerDone(page);
      pickerOpened = false;
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
      await screenshot('reviewer-data-workflow-picker.png');
      await click(panel, 'data-cancel-button', 'Cancel');
      await waitFor(
        'reviewer_data_draft_cleared',
        () => dataState(panel),
        (value) => value.active && value.pickerReady && value.selected.length === 0,
      );
      return {
        selected_field: selected.selected[0],
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
