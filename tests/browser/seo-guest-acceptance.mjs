#!/usr/bin/env node
/**
 * Guest SEO native-panel acceptance. Root owns release preflight and execution.
 * Break caught: navigation leaves the SEO view showing the previous page's title.
 * Two real public pages have distinct document titles; no response or auth is mocked.
 */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { click, evaluate, waitFor } from './settings-panel-driver.mjs';

const REPO = resolve(import.meta.dirname, '..', '..');
const OUTPUT = join(REPO, 'test-results', 'seo-guest-acceptance.json');
const PAGES = ['https://example.org/', 'https://www.iana.org/domains/reserved'];
const report = {
  schema_version: 1,
  feature_id: 'EXT-F-1008',
  mode: 'guest',
  status: 'unverified',
  scope: 'read-only warm-page actions in an owned native side panel',
  targets: [],
  deferred: [
    { case: 'T01', part: 'one audit per URL and slow-old-result race' },
    { case: 'T02', part: 'fresh capture and stale advice replacement after re-audit' },
    { case: 'T03', part: 'restricted and unreachable URLs' },
    { case: 'T04-T06,T08', part: 'database save, history, and diff flows' },
    { case: 'T07', part: 'clipboard contents and reload dimension' },
    { case: 'T09', part: 'remaining detail groups and outbound links' },
    { case: 'T10-T14', part: 'recommendations, Chat staging, and social snippet actions' },
    { case: 'all', part: 'reload, member, and admin modes' },
  ],
  last_safe_stage: 'before_owned_profile',
  last_safe_observable: null,
  current_operation: null,
};
const advance = (stage, observable = null) => {
  report.last_safe_stage = stage;
  report.last_safe_observable = observable;
  report.current_operation = null;
};
const enter = (operation) => {
  report.current_operation = operation;
};
async function observe(stage, read) {
  enter(stage);
  try {
    const value = await read();
    advance(stage, value);
    return value;
  } catch {
    throw new Error(`${stage}_observation_failed`);
  }
}
async function waitObserved(operation, read, accept, timeoutMs) {
  enter(operation);
  const result = await waitFor(
    operation,
    async () => {
      const value = await read();
      report.last_safe_stage = `${operation}_sample`;
      report.last_safe_observable = value;
      return value;
    },
    accept,
    timeoutMs,
  );
  advance(`${operation}_accepted`, result);
  return result;
}
const target = (caseId, subtarget, evidence) =>
  report.targets.push({ case_id: `EXT-F-1008-${caseId}`, subtarget, status: 'pass', evidence });

// One scoped relationship for all SEO observations. The outer tablist is the
// app navigation; mounted feature panels may contain their own nested tabs.
const SEO_SCOPE = `
  const lists = [...document.querySelectorAll('[role="tablist"]')]
    .filter((node) => !node.closest('[role="tabpanel"]'));
  const tabs = lists.length === 1
    ? [...lists[0].querySelectorAll('[role="tab"]')]
      .filter((node) => node.closest('[role="tablist"]') === lists[0]
        && node.title === 'SEO')
    : [];
  const tab = tabs.length === 1 ? tabs[0] : null;
  const controls = tab?.getAttribute('aria-controls');
  const pane = controls ? document.getElementById(controls) : null;
  const linked = !!pane && pane.id === controls
    && pane.getAttribute('aria-labelledby') === tab.id
    && pane.getAttribute('data-state') === 'active'
    && pane.getBoundingClientRect().height > 0;
`;

async function selectedSeo(panel) {
  return evaluate(
    panel,
    `(() => {
      ${SEO_SCOPE}
      const visible = (node) => {
        const style = getComputedStyle(node), rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden'
          && style.display !== 'none' && !node.closest('[inert]');
      };
      const clickCandidates = [...document.querySelectorAll('button[title]')]
        .filter((node) => node.title === 'SEO' && visible(node));
      const heading = [...(pane?.querySelectorAll('span') ?? [])]
        .some((node) => node.textContent.trim() === 'SEO audit');
      const text = pane?.innerText ?? '';
      return { mainTablists: lists.length, seoTabs: tabs.length,
        visibleSeoTitleButtons: clickCandidates.length,
        clickCandidateIsMainTab: clickCandidates.length === 1 && clickCandidates[0] === tab,
        selected: tab?.getAttribute('aria-selected') === 'true',
        linked,
        heading, fallback: !!pane?.querySelector('svg.animate-spin') && !text.trim(),
        auditButtonCount: [...(pane?.querySelectorAll('button') ?? [])]
          .filter((node) => /^(Audit this page|Re-audit)$/.test(node.textContent.trim())).length,
        auditError: /Audit failed:|This page cannot be audited/.test(text) };
    })()`,
  );
}

async function seoContent(panel) {
  return evaluate(
    panel,
    `(() => {
      ${SEO_SCOPE}
      if (!linked || tab?.getAttribute('aria-selected') !== 'true')
        return { scopeValid: false, title: null, headings: false, reAudit: false, error: false };
      const group = [...(pane?.querySelectorAll('span') ?? [])]
        .find((node) => node.textContent.trim() === 'Title & description');
      // SeoGroup places its SeoRow children inside the card's inner divider.
      // The card itself has only that divider as a child, not the Title row.
      const rows = group?.parentElement?.nextElementSibling?.firstElementChild;
      const titleRow = [...(rows?.children ?? [])]
        .find((node) => node.firstElementChild?.textContent.trim() === 'Title');
      const title = titleRow?.lastElementChild?.lastElementChild?.textContent.trim() ?? null;
      const headingGroup = [...(pane?.querySelectorAll('span') ?? [])]
        .find((node) => node.textContent.trim() === 'Headings');
      return { scopeValid: true, title, headings: !!headingGroup,
        reAudit: [...(pane?.querySelectorAll('button') ?? [])]
          .some((node) => node.textContent.trim() === 'Re-audit' && !node.disabled),
        error: [...(pane?.querySelectorAll('div') ?? [])]
          .some((node) => /^Audit failed:|^This page cannot be audited/.test(node.textContent.trim())) };
    })()`,
  );
}

async function pageEvidence(page) {
  await page.waitForFunction(() => document.readyState === 'complete' && !!document.title);
  return page.evaluate(() => ({
    title: document.title.trim(),
    heading: !!document.querySelector('h1'),
  }));
}

try {
  const harness = await runNativeSidepanelQa({
    exercisePanel: async ({ page, panel }) => {
      advance('owned_guest_panel_ready', { nativePanel: true });
      for (const [index, url] of PAGES.entries()) {
        enter(`public_page_${index}_navigation`);
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        advance(`public_page_${index}_loaded`, { reachedExpectedPage: page.url() === url });
        const observedPage = await observe(`public_page_${index}_inspected`, () =>
          pageEvidence(page),
        );
        assert.ok(observedPage.title, 'public page has a real title');
        advance(`public_page_${index}_ready`, { title: observedPage.title });
        if (index === 0) {
          const beforeClick = await observe('seo_click_preflight', () => selectedSeo(panel));
          assert.equal(
            beforeClick.clickCandidateIsMainTab,
            true,
            'SEO click candidate is the unique main navigation tab',
          );
          enter('seo_click');
          await click(panel, 'title', 'SEO');
          advance('seo_click_dispatched', { trustedInput: true });
          await observe('seo_post_click_observation', () => selectedSeo(panel));
        }
        await waitObserved(
          `seo_page_${index}_readiness_wait`,
          () => selectedSeo(panel),
          (state) => state?.selected && state.linked && state.heading && !state.fallback,
        );
        const content = await waitObserved(
          `seo_page_${index}_audit_wait`,
          () => seoContent(panel),
          (state) =>
            state?.scopeValid &&
            state.title === observedPage.title &&
            state.reAudit &&
            !state.error,
          30000,
        );
        assert.equal(
          content.headings,
          observedPage.heading,
          'SEO headings group agrees with the real page',
        );
        target('T09', `page_${index}_title_and_headings`, {
          publicTitle: observedPage.title,
          titleMatches: true,
          headingsPresenceMatches: true,
        });
        advance(`seo_page_${index}_matched`, { title: observedPage.title });
      }
      assert.notEqual(
        report.targets[0].evidence.publicTitle,
        report.targets[1].evidence.publicTitle,
        'public pages must distinguish stale audits',
      );
      target('T01', 'new_url_replaces_visible_title', { twoDistinctPublicTitles: true });

      await observe('manual_reaudit_preflight', () => seoContent(panel));
      enter('manual_reaudit_click');
      await click(panel, 'button', 'Re-audit');
      advance('manual_reaudit_click_dispatched', { trustedInput: true });
      await waitObserved(
        'manual_reaudit_running_wait',
        () => seoContent(panel),
        (state) => state?.scopeValid && state.reAudit === false,
      );
      await waitObserved(
        'manual_reaudit_settle_wait',
        () => seoContent(panel),
        (state) =>
          state?.scopeValid &&
          state.title === report.targets[1].evidence.publicTitle &&
          state.reAudit &&
          !state.error,
        30000,
      );
      target('T02', 'manual_button_returns_to_current_page', { currentTitlePreserved: true });
      advance('manual_reaudit_settled', { currentTitlePreserved: true });

      await observe('copy_menu_preflight', () => selectedSeo(panel));
      enter('copy_menu_click');
      await click(panel, 'title', 'Copy audit');
      advance('copy_menu_click_dispatched', { trustedInput: true });
      const menu = await waitObserved(
        'copy_menu_choices_wait',
        () =>
          evaluate(
            panel,
            `(() => {
          const popover = [...document.querySelectorAll('[data-state="open"]')]
            .find((node) => node.textContent?.includes('Summary (text)')
              && node.textContent?.includes('For AI agent'));
          const choices = [...(popover?.querySelectorAll('button') ?? [])]
            .map((node) => node.textContent.trim());
          return { open: !!popover, choices };
        })()`,
          ),
        (state) =>
          state?.open &&
          state.choices.includes('Summary (text)') &&
          state.choices.includes('For AI agent'),
      );
      assert.equal(menu.choices.includes('JSON'), false, 'guest JSON choice is hidden');
      target('T07', 'guest_menu_offers_text_and_ai_but_hides_json', {
        textChoice: true,
        agentChoice: true,
        jsonAbsent: true,
      });
      advance('guest_copy_menu_verified', {
        textChoice: true,
        agentChoice: true,
        jsonAbsent: true,
      });
    },
  });
  report.extension_id = harness.extensionId;
  report.status = 'partial';
} catch {
  report.status = 'unverified';
  report.failure_stage = report.current_operation ?? report.last_safe_stage;
  process.exitCode = 1;
}
await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${report.status.toUpperCase()} seo_guest_native_batch\n`);
