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
};
const advance = (stage, observable = null) => {
  report.last_safe_stage = stage;
  report.last_safe_observable = observable;
};
const target = (caseId, subtarget, evidence) =>
  report.targets.push({ case_id: `EXT-F-1008-${caseId}`, subtarget, status: 'pass', evidence });

async function selectedSeo(panel) {
  return evaluate(
    panel,
    `(() => {
      const tab = [...document.querySelectorAll('[role="tab"]')]
        .find((node) => node.title === 'SEO');
      const pane = document.querySelector('[role="tabpanel"][data-state="active"]');
      const heading = [...(pane?.querySelectorAll('span') ?? [])]
        .some((node) => node.textContent.trim() === 'SEO audit');
      return { selected: tab?.getAttribute('aria-selected') === 'true',
        linked: !!pane && pane.id === tab?.getAttribute('aria-controls')
          && pane.getAttribute('aria-labelledby') === tab?.id,
        heading };
    })()`,
  );
}

async function seoContent(panel) {
  return evaluate(
    panel,
    `(() => {
      const pane = document.querySelector('[role="tabpanel"][data-state="active"]');
      const group = [...(pane?.querySelectorAll('span') ?? [])]
        .find((node) => node.textContent.trim() === 'Title & description');
      const rows = group?.parentElement?.nextElementSibling;
      const titleRow = [...(rows?.children ?? [])]
        .find((node) => node.firstElementChild?.textContent.trim() === 'Title');
      const title = titleRow?.lastElementChild?.lastElementChild?.textContent.trim() ?? null;
      const headingGroup = [...(pane?.querySelectorAll('span') ?? [])]
        .find((node) => node.textContent.trim() === 'Headings');
      return { title, headings: !!headingGroup,
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
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        const observedPage = await pageEvidence(page);
        assert.ok(observedPage.title, 'public page has a real title');
        advance(`public_page_${index}_ready`, { title: observedPage.title });
        if (index === 0) await click(panel, 'title', 'SEO');
        await waitFor(
          'SEO selected and linked',
          () => selectedSeo(panel),
          (state) => state?.selected && state.linked && state.heading,
        );
        const content = await waitFor(
          `SEO audit reflects public page ${index}`,
          () => seoContent(panel),
          (state) => state?.title === observedPage.title && state.reAudit && !state.error,
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

      await click(panel, 'button', 'Re-audit');
      await waitFor(
        're-audit enters running state',
        () => seoContent(panel),
        (state) => state?.reAudit === false,
      );
      await waitFor(
        're-audit settles on second page',
        () => seoContent(panel),
        (state) =>
          state?.title === report.targets[1].evidence.publicTitle && state.reAudit && !state.error,
        30000,
      );
      target('T02', 'manual_button_returns_to_current_page', { currentTitlePreserved: true });
      advance('manual_reaudit_settled', { currentTitlePreserved: true });

      await click(panel, 'title', 'Copy audit');
      const menu = await waitFor(
        'guest copy choices visible',
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
  report.failure_stage = report.last_safe_stage;
  process.exitCode = 1;
}
await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${report.status.toUpperCase()} seo_guest_native_batch\n`);
