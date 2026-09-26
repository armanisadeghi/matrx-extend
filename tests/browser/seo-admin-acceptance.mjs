#!/usr/bin/env node
/** Admin SEO acceptance in the owned native panel. Root admits execution. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { click, evaluate, openSection, waitFor } from './settings-panel-driver.mjs';

const REPO = resolve(import.meta.dirname, '..', '..');
const OUTPUT = join(REPO, 'test-results', 'seo-admin-acceptance.json');
const EMAIL = 'admin@admin.com';
const WEB_ORIGIN = 'https://www.aimatrx.com';
const PAGES = ['https://example.org/', 'https://www.iana.org/domains/reserved'];
const ORGANIZATION = 'ZZZ APPROVAL-TAIL throwaway a2c8a05f — safe to delete';
let stage = 'owned_profile';
const report = {
  schema_version: 1,
  feature_id: 'EXT-F-1008',
  mode: 'admin',
  status: 'unverified',
  scope:
    'real admin sign-in and selected organization; public SEO audit, menu, and one saved history row',
  targets: [],
  limitations: [
    'Only one new public-page audit is saved in the selected campaign test organization; no prior row is changed or deleted.',
    'No clipboard content, provider recommendation, Chat, or member role is exercised.',
    'Title and heading presence are a bounded detail baseline; they do not prove every SEO field.',
    'Backend failure/retry, history empty/error/loading, two-snapshot comparison, and changed-page diff remain unverified.',
  ],
};
const target = (caseId, subtarget, evidence) =>
  report.targets.push({ case_id: `EXT-F-1008-${caseId}`, subtarget, status: 'pass', evidence });

// Same real-web/extension Settings route as isolated-admin-signin-acceptance.
// Read only the test-account variables when the form is ready. Never retain
// the secret in a receipt or raw exception.
async function signInOnRealWebPage(page) {
  const web = await page.context().newPage();
  try {
    stage = 'web_login';
    await web.goto(`${WEB_ORIGIN}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    assert.equal(new URL(web.url()).origin, WEB_ORIGIN);
    assert.equal(new URL(web.url()).pathname, '/login');
    const source = await readFile(join(homedir(), 'code', 'aidream', '.env'), 'utf8');
    const values = Object.fromEntries(
      source.split(/\r?\n/).flatMap((line) => {
        const match = /^\s*(AI_ADMIN_USERNAME|AI_ADMIN_PASSWORD)\s*=\s*(.*?)\s*$/.exec(line);
        if (!match) return [];
        const value = match[2].replace(/^("|')(.*)\1$/, '$2');
        return [[match[1], value]];
      }),
    );
    assert.equal(values.AI_ADMIN_USERNAME, EMAIL);
    assert.ok(values.AI_ADMIN_PASSWORD);
    await web.locator('input[name="email"]').fill(EMAIL);
    await web.locator('input[name="password"]').fill(values.AI_ADMIN_PASSWORD);
    await Promise.all([
      web.waitForURL((url) => url.origin === WEB_ORIGIN && url.pathname === '/dashboard', {
        timeout: 90_000,
      }),
      web.getByRole('button', { name: 'Sign in', exact: true }).click(),
    ]);
    return web;
  } catch {
    await web.close();
    throw new Error('real_web_login_unverified');
  }
}

async function adminSettings(panel) {
  return evaluate(
    panel,
    `(() => {
    const account = [...document.querySelectorAll('button[aria-expanded]')]
      .find((button) => button.textContent.trim() === 'Account');
    const section = account?.parentElement?.nextElementSibling;
    const row = (label) => [...(section?.querySelectorAll('span') ?? [])]
      .find((span) => span.textContent.trim() === label)?.parentElement?.textContent.trim() ?? null;
    return {
      email: row('Email') === 'Email${EMAIL}',
      role: row('Role')?.toLowerCase() === 'roleadmin',
      signOut: [...document.querySelectorAll('button')]
        .some((button) => button.textContent.trim() === 'Sign out'),
    };
  })()`,
  );
}

async function organizationState(panel) {
  return evaluate(
    panel,
    `(async () => {
    const label = ${JSON.stringify(ORGANIZATION)};
    const rows = [...document.querySelectorAll('span')]
      .filter((span) => span.textContent.trim() === 'Acting as');
    const controls = rows.flatMap((span) =>
      [...span.parentElement.parentElement.querySelectorAll('button[role="combobox"]')]);
    const options = [...document.querySelectorAll('[role="option"]')]
      .filter((option) => option.textContent.trim() === label);
    const stored = (await chrome.storage.local.get('matrx.org.active'))['matrx.org.active'];
    return {
      controlCount: controls.length,
      optionCount: options.length,
      displayed: controls.length === 1 && controls[0].textContent.trim() === label,
      stored: typeof stored?.id === 'string' && stored.id.length > 0 && stored.name === label,
    };
  })()`,
  );
}

async function seoState(panel) {
  return evaluate(
    panel,
    `(() => {
    const lists = [...document.querySelectorAll('[role="tablist"]')]
      .filter((node) => !node.closest('[role="tabpanel"]'));
    const tabs = lists.length === 1 ? [...lists[0].querySelectorAll('[role="tab"]')]
      .filter((node) => node.closest('[role="tablist"]') === lists[0] && node.title === 'SEO') : [];
    const tab = tabs.length === 1 ? tabs[0] : null;
    const pane = tab?.getAttribute('aria-controls')
      ? document.getElementById(tab.getAttribute('aria-controls')) : null;
    const linked = !!pane && pane.getAttribute('aria-labelledby') === tab.id
      && pane.getAttribute('data-state') === 'active'
      && tab.getAttribute('aria-selected') === 'true'
      && pane.getBoundingClientRect().height > 0;
    const group = [...(pane?.querySelectorAll('span') ?? [])]
      .find((node) => node.textContent.trim() === 'Title & description');
    const rows = group?.parentElement?.nextElementSibling?.firstElementChild;
    const titleRow = [...(rows?.children ?? [])]
      .find((node) => node.firstElementChild?.textContent.trim() === 'Title');
    const title = titleRow?.lastElementChild?.lastElementChild?.textContent.trim() ?? null;
    const headings = [...(pane?.querySelectorAll('span') ?? [])]
      .some((node) => node.textContent.trim() === 'Headings');
    const reAudit = [...(pane?.querySelectorAll('button') ?? [])]
      .some((node) => node.textContent.trim() === 'Re-audit' && !node.disabled);
    const copy = [...(pane?.querySelectorAll('button[title]') ?? [])]
      .filter((node) => node.title === 'Copy audit');
    const trigger = copy.length === 1 ? copy[0] : null;
    const menuId = trigger?.getAttribute('aria-controls');
    const openMenu = trigger?.getAttribute('aria-expanded') === 'true' && menuId
      ? document.getElementById(menuId) : null;
    const menuOwnedByCopy = !!openMenu && openMenu.getAttribute('data-state') === 'open'
      && trigger?.getAttribute('data-state') === 'open';
    const choices = [...(openMenu?.querySelectorAll('button') ?? [])]
      .map((node) => node.textContent.trim());
    const history = [...(pane?.querySelectorAll('button[title]') ?? [])]
      .filter((node) => node.title === 'Saved audits for this URL');
    const historyToggle = history.length === 1 ? history[0] : null;
    const historyHeading = [...(pane?.querySelectorAll('div') ?? [])]
      .find((node) => node.childElementCount === 0
        && node.textContent.trim() === 'Saved audits for this URL');
    const list = historyHeading?.parentElement;
    const historyRows = [...(list?.children ?? [])]
      .filter((node) => node.tagName === 'BUTTON');
    const savedSnapshot = [...(pane?.querySelectorAll('div') ?? [])]
      .some((node) => node.childElementCount === 0 && node.textContent.trim() === 'Saved snapshot');
    const liveButtons = [...(pane?.querySelectorAll('button') ?? [])]
      .filter((node) => node.textContent.trim() === 'Live');
    const saveButtons = [...(pane?.querySelectorAll('button') ?? [])]
      .filter((node) => node.textContent.trim() === 'Save');
    const savedButtons = [...(pane?.querySelectorAll('button') ?? [])]
      .filter((node) => node.textContent.trim() === 'Saved');
    return {
      documentTimeOrigin: performance.timeOrigin,
      linked, title, headings, reAudit, copyCount: copy.length,
      menuOpen: menuOwnedByCopy, choices,
      saveCount: saveButtons.length, savedCount: savedButtons.length,
      historyToggleCount: history.length,
      historyCount: historyToggle && /^\d+$/.test(historyToggle.textContent.trim())
        ? Number(historyToggle.textContent.trim()) : 0,
      historyOpen: !!historyHeading,
      historyRowCount: historyRows.length,
      newestHistoryLabel: historyRows[0]?.textContent.trim() ?? null,
      newestHistoryLabelUnique: historyRows.length > 0
        && historyRows.filter((node) => node.textContent.trim() === historyRows[0].textContent.trim()).length === 1,
      savedSnapshot, liveButtonCount: liveButtons.length,
      error: /Audit failed:|This page cannot be audited/.test(pane?.innerText ?? ''),
    };
  })()`,
  );
}

try {
  await runNativeSidepanelQa({
    exercisePanel: async ({ page, panel }) => {
      stage = 'guest_settings';
      await click(panel, 'title', 'Settings');
      await openSection(panel, 'Account');
      const web = await signInOnRealWebPage(page);
      try {
        stage = 'extension_signin';
        await click(panel, 'button', 'Sign in');
        await waitFor(
          'real_admin_identity',
          () => adminSettings(panel),
          (state) => state?.email && state.role && state.signOut,
          90_000,
        );
        await openSection(panel, 'Organization');
        stage = 'organization_selection';
        await waitFor(
          'organization_control',
          () => organizationState(panel),
          (state) => state?.controlCount === 1,
        );
        await click(panel, 'organization', 'Acting as');
        const offered = await organizationState(panel);
        assert.equal(offered.optionCount, 1, 'existing test organization must be offered');
        await click(panel, 'option', ORGANIZATION);
        await waitFor(
          'organization_selected_on_device',
          () => organizationState(panel),
          (state) => state?.displayed && state.stored,
        );
        const notice = await evaluate(
          panel,
          `(() => [...document.querySelectorAll('[role="alert"]')]
          .filter((el) => el.querySelector('.font-medium')?.textContent.trim() === 'Capture list unavailable'
            && el.querySelector('p')?.textContent.includes('no workspace is selected, so the request was never sent'))
          .flatMap((el) => [...el.querySelectorAll('button[aria-label="Dismiss"]')]).length)()`,
        );
        assert.ok(notice === 0 || notice === 1, 'at most one known no-workspace notice');
        if (notice === 1) await click(panel, 'capture-no-workspace-dismiss', 'Dismiss');
        target('T07', 'real_admin_and_explicit_organization_prerequisite', {
          adminIdentityVisible: true,
          organizationSelectedThroughSettings: true,
        });
      } finally {
        await web.close();
      }
      const titles = [];
      for (const [index, url] of PAGES.entries()) {
        stage = `public_page_${index}`;
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        assert.equal(page.url(), url);
        const publicPage = await page.evaluate(() => ({
          title: document.title,
          hasHeading: !!document.querySelector('h1, h2, h3, h4, h5, h6'),
        }));
        assert.ok(publicPage.title, 'public page supplies a real title');
        titles.push(publicPage.title);
        if (index === 0) await click(panel, 'title', 'SEO');
        const seo = await waitFor(
          `admin_seo_page_${index}`,
          () => seoState(panel),
          (state) =>
            state?.linked &&
            state.title === publicPage.title &&
            state.headings === publicPage.hasHeading &&
            state.reAudit &&
            !state.error,
          30_000,
        );
        assert.equal(seo.copyCount, 1, 'one Copy audit control in selected SEO pane');
        target('T09', `admin_public_page_${index}_title_and_heading_presence`, {
          titleMatchesPublicDom: true,
          headingPresenceMatchesPublicDom: true,
        });
      }
      assert.notEqual(titles[0], titles[1], 'public pages distinguish stale SEO audits');
      stage = 'admin_copy_menu';
      await click(panel, 'title', 'Copy audit');
      const menu = await waitFor(
        'admin_json_menu',
        () => seoState(panel),
        (state) =>
          state?.linked &&
          state.menuOpen &&
          state.choices.includes('Summary (text)') &&
          state.choices.includes('For AI agent') &&
          state.choices.some((choice) => choice.startsWith('JSON')),
      );
      target('T07', 'admin_menu_offers_json_without_copying', {
        textChoice: true,
        agentChoice: true,
        jsonChoice: true,
      });
      assert.ok(menu.menuOpen);

      // Close the popover without choosing a clipboard action. One Save creates
      // a new row for the current public URL in the selected test organization.
      stage = 'close_copy_menu';
      await click(panel, 'title', 'Copy audit');
      await waitFor(
        'copy_menu_closed',
        () => seoState(panel),
        (state) => state?.linked && !state.menuOpen,
      );
      const beforeSave = await seoState(panel);
      assert.equal(beforeSave.saveCount, 1, 'one Save button for current live audit');
      assert.equal(beforeSave.savedCount, 0, 'audit has not been saved by this run');
      stage = 'save_public_audit';
      await click(panel, 'button', 'Save');
      const afterSave = await waitFor(
        'save_returned_and_history_refreshed',
        () => seoState(panel),
        (state) =>
          state?.linked &&
          state.savedCount === 1 &&
          state.saveCount === 0 &&
          state.historyToggleCount === 1 &&
          state.historyCount >= beforeSave.historyCount + 1 &&
          !state.error,
        30_000,
      );
      target('T04', 'one_public_audit_saved_and_history_refreshed', {
        savedButtonVisible: true,
        historyCountIncreased: true,
      });

      stage = 'history_open';
      await click(panel, 'title', 'Saved audits for this URL');
      const open = await waitFor(
        'history_list_open',
        () => seoState(panel),
        (state) =>
          state?.linked &&
          state.historyOpen &&
          state.historyRowCount === afterSave.historyCount &&
          state.newestHistoryLabelUnique,
      );
      target('T05', 'history_opens_for_current_public_url', {
        rowCountMatchesBadge: true,
        newestRowHasUniqueVisibleLabel: true,
      });
      stage = 'history_close';
      await click(panel, 'title', 'Saved audits for this URL');
      await waitFor(
        'history_list_closed',
        () => seoState(panel),
        (state) => state?.linked && !state.historyOpen,
      );
      stage = 'history_reopen';
      await click(panel, 'title', 'Saved audits for this URL');
      await waitFor(
        'history_list_reopened',
        () => seoState(panel),
        (state) =>
          state?.linked &&
          state.historyOpen &&
          state.newestHistoryLabel === open.newestHistoryLabel,
      );
      stage = 'saved_snapshot_open';
      await click(panel, 'button', open.newestHistoryLabel);
      await waitFor(
        'saved_snapshot_visible',
        () => seoState(panel),
        (state) =>
          state?.linked &&
          state.savedSnapshot &&
          state.liveButtonCount === 1 &&
          !state.historyOpen &&
          state.title === titles[1],
      );
      stage = 'return_to_live';
      await click(panel, 'button', 'Live');
      await waitFor(
        'live_audit_restored',
        () => seoState(panel),
        (state) =>
          state?.linked &&
          !state.savedSnapshot &&
          state.liveButtonCount === 0 &&
          state.title === titles[1] &&
          state.reAudit,
      );
      target('T05', 'newest_saved_snapshot_and_live_return', {
        snapshotVisible: true,
        selectedSnapshotTitleMatchesPublicDom: true,
        liveAuditRestored: true,
      });

      stage = 'panel_reload';
      const beforeReload = await seoState(panel);
      await panel.send('Page.reload', { ignoreCache: false });
      const remounted = await waitFor(
        'admin_panel_document_reloaded',
        () => seoState(panel),
        (state) => state?.documentTimeOrigin > beforeReload.documentTimeOrigin,
        30_000,
      );
      if (!remounted.linked) await click(panel, 'title', 'SEO');
      const persisted = await waitFor(
        'saved_history_after_reload',
        () => seoState(panel),
        (state) =>
          state?.linked &&
          state.title === titles[1] &&
          state.reAudit &&
          state.historyToggleCount === 1 &&
          state.historyCount >= afterSave.historyCount &&
          !state.error,
        30_000,
      );
      stage = 'persisted_history_reopen';
      await click(panel, 'title', 'Saved audits for this URL');
      await waitFor(
        'persisted_history_list_visible',
        () => seoState(panel),
        (state) =>
          state?.linked &&
          state.historyOpen &&
          state.historyRowCount === persisted.historyCount &&
          state.newestHistoryLabel === open.newestHistoryLabel,
      );
      target('T05', 'saved_history_survives_panel_reload', {
        newDocumentObserved: true,
        currentPublicTitleMatches: true,
        newestSavedRowStillVisible: true,
      });
    },
  });
  report.status = 'partial';
  stage = 'complete';
  process.stdout.write('PARTIAL seo_admin_native_batch\n');
} catch {
  report.status = 'unverified';
  report.failure_stage = stage;
  process.exitCode = 1;
  process.stderr.write(`UNVERIFIED seo_admin_native_batch at ${stage}\n`);
}
await mkdir(join(REPO, 'test-results'), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
