#!/usr/bin/env node
/** Admin SEO acceptance in the owned native panel. Root admits execution. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { click, evaluate, openSection, waitFor } from './settings-panel-driver.mjs';

const REPO = resolve(import.meta.dirname, '..', '..');
const OUTPUT = join(REPO, 'test-results', 'seo-admin-acceptance.json');
const ATTEMPT = join(REPO, 'test-results', 'seo-admin-save-attempt.json');
const EMAIL = 'admin@admin.com';
const WEB_ORIGIN = 'https://www.aimatrx.com';
const PAGES = ['https://example.org/', 'https://www.iana.org/domains/reserved'];
const SAVE_URL_SHA256 = createHash('sha256').update(PAGES[1]).digest('hex');
const ORGANIZATION = 'ZZZ APPROVAL-TAIL throwaway a2c8a05f — safe to delete';
let stage = 'owned_profile';
const report = {
  schema_version: 1,
  feature_id: 'EXT-F-1008',
  mode: 'admin',
  status: 'unverified',
  scope:
    'real admin sign-in and selected organization; one guarded public SEO Save and identified history row',
  targets: [],
  limitations: [
    'At most one new IANA public-page audit is saved in the selected test organization; a durable pre-click checkpoint prevents a second Save on rerun.',
    'No clipboard content, provider recommendation, Chat, or member role is exercised.',
    'Title and heading presence are a bounded detail baseline; they do not prove every SEO field.',
    'Save failure/retry, history empty/error/loading, two-snapshot comparison, and changed-page diff remain unverified.',
  ],
};
const target = (caseId, subtarget, evidence) =>
  report.targets.push({ case_id: `EXT-F-1008-${caseId}`, subtarget, status: 'pass', evidence });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function syncDirectory(path) {
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function saveAttempt(organizationId) {
  await mkdir(join(REPO, 'test-results'), { recursive: true });
  try {
    const existing = JSON.parse(await readFile(ATTEMPT, 'utf8'));
    assert.equal(existing.organization, ORGANIZATION, 'save checkpoint organization');
    assert.equal(existing.organizationId, organizationId, 'save checkpoint organization ID');
    assert.equal(existing.urlSha256, SAVE_URL_SHA256, 'save checkpoint URL');
    return { reserved: true, id: UUID.test(existing.id ?? '') ? existing.id : null };
  } catch (error) {
    if (error?.code !== 'ENOENT') throw new Error('save_attempt_checkpoint_requires_coordination');
  }
  // Persist test-results itself if mkdir just created it. If directory fsync
  // is unsupported, the Save click is never reached.
  await syncDirectory(REPO);
  const handle = await open(ATTEMPT, 'wx', 0o600);
  try {
    await handle.writeFile(
      `${JSON.stringify({ organization: ORGANIZATION, organizationId, urlSha256: SAVE_URL_SHA256, phase: 'reserved' })}\n`,
    );
    await handle.sync();
  } finally {
    await handle.close();
  }
  // File fsync alone does not guarantee this new directory entry survives.
  await syncDirectory(join(REPO, 'test-results'));
  return { reserved: false, id: null };
}

async function storeObservedSaveId(id, organizationId) {
  assert.match(id, UUID, 'real Save response ID');
  const temp = `${ATTEMPT}.tmp`;
  const handle = await open(temp, 'wx', 0o600);
  try {
    await handle.writeFile(
      `${JSON.stringify({ organization: ORGANIZATION, organizationId, urlSha256: SAVE_URL_SHA256, phase: 'save_id_observed', id })}\n`,
    );
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, ATTEMPT);
  await syncDirectory(join(REPO, 'test-results'));
}

// Observe the real PostgREST insert response without changing or replaying it.
// Only the response ID leaves CDP; raw URLs, headers, and audit signals do not.
async function watchRealSaveId(panel, organizationId) {
  await panel.send('Network.enable');
  const requests = new Map();
  const responses = new Map();
  let observedId = null;
  const isSeoEndpoint = (value) => {
    try {
      return new URL(value).pathname.endsWith('/wbx_seo_audit');
    } catch {
      return false;
    }
  };
  const offRequest = panel.on('Network.requestWillBeSent', ({ requestId, request }) => {
    if (request?.method !== 'POST' || !isSeoEndpoint(request.url)) return;
    try {
      const payload = JSON.parse(request.postData);
      if (payload.url === PAGES[1] && payload.organization_id === organizationId)
        requests.set(requestId, true);
    } catch {
      /* Missing or malformed post data cannot establish provenance. */
    }
  });
  const offResponse = panel.on('Network.responseReceived', ({ requestId, response }) => {
    if (requests.has(requestId)) responses.set(requestId, response?.status);
  });
  const offFinished = panel.on('Network.loadingFinished', ({ requestId }) => {
    if (!requests.has(requestId) || ![200, 201].includes(responses.get(requestId))) return;
    void panel
      .send('Network.getResponseBody', { requestId })
      .then(({ body, base64Encoded }) => {
        const raw = base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body;
        const parsed = JSON.parse(raw);
        const candidate = Array.isArray(parsed) ? parsed[0]?.id : parsed?.id;
        if (typeof candidate === 'string' && UUID.test(candidate)) observedId = candidate;
      })
      .catch(() => {});
  });
  return {
    read: () => (requests.size === 1 ? observedId : null),
    stop: () => {
      offRequest();
      offResponse();
      offFinished();
    },
  };
}

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
      organizationId: stored?.name === label && typeof stored.id === 'string' ? stored.id : null,
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
    const historyIdentities = historyRows.map((node) => ({
      id: node.getAttribute('data-audit-id'), label: node.textContent.trim(),
    }));
    const savedSnapshot = [...(pane?.querySelectorAll('div') ?? [])]
      .some((node) => node.childElementCount === 0 && node.textContent.trim() === 'Saved snapshot');
    const snapshotNodes = [...(pane?.querySelectorAll('div[data-audit-id]') ?? [])]
      .filter((node) => node.textContent.includes('Saved snapshot'));
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
      historyIdentities,
      newestHistoryLabel: historyRows[0]?.textContent.trim() ?? null,
      newestHistoryLabelUnique: historyRows.length > 0
        && historyRows.filter((node) => node.textContent.trim() === historyRows[0].textContent.trim()).length === 1,
      savedSnapshot, snapshotId: snapshotNodes.length === 1
        ? snapshotNodes[0].getAttribute('data-audit-id') : null,
      liveButtonCount: liveButtons.length,
      error: /Audit failed:|This page cannot be audited/.test(pane?.innerText ?? ''),
    };
  })()`,
  );
}

async function observedHistory(panel, saveId) {
  const state = await seoState(panel);
  report.last_safe_history_observation = {
    linked: state?.linked === true,
    historyToggleCount: state?.historyToggleCount ?? null,
    historyCount: state?.historyCount ?? null,
    historyOpen: state?.historyOpen === true,
    historyRowCount: state?.historyRowCount ?? null,
    savedRowIdPresent: state?.historyIdentities?.some((row) => row.id === saveId) === true,
    auditErrorVisible: state?.error === true,
  };
  return state;
}

try {
  await runNativeSidepanelQa({
    exercisePanel: async ({ page, panel }) => {
      let selectedOrganizationId = null;
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
        const chosen = await waitFor(
          'organization_selected_on_device',
          () => organizationState(panel),
          (state) => state?.displayed && state.stored,
        );
        selectedOrganizationId = chosen.organizationId;
        assert.ok(selectedOrganizationId, 'selected organization has actual on-device ID');
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

      // Close without copying. The checkpoint is written before the only
      // permitted Save click; any ambiguous attempt can only resume read-only.
      stage = 'close_copy_menu';
      await click(panel, 'title', 'Copy audit');
      await waitFor(
        'copy_menu_closed',
        () => seoState(panel),
        (state) => state?.linked && !state.menuOpen,
      );
      const attempt = await saveAttempt(selectedOrganizationId);
      let saveId = attempt.id;
      if (!attempt.reserved) {
        const beforeSave = await seoState(panel);
        assert.equal(beforeSave.saveCount, 1, 'one Save button for current live audit');
        stage = 'save_public_audit';
        const witness = await watchRealSaveId(panel, selectedOrganizationId);
        try {
          await click(panel, 'button', 'Save');
          saveId = await waitFor(
            'real_save_response_id',
            () => witness.read(),
            (id) => typeof id === 'string' && UUID.test(id),
            30_000,
          );
          await storeObservedSaveId(saveId, selectedOrganizationId);
        } finally {
          witness.stop();
        }
        await waitFor(
          'save_button_success',
          () => seoState(panel),
          (state) => state?.linked && state.savedCount === 1 && !state.error,
          30_000,
        );
        target('T04', 'one_public_audit_saved_with_real_response_id', {
          realInsertIdObserved: true,
          savedButtonVisible: true,
        });
      } else if (!saveId) {
        stage = 'ambiguous_prior_save';
        report.save_attempt = {
          status: 'unverified',
          reason: 'prior_save_outcome_ambiguous_no_second_write',
        };
        throw new Error('prior_save_outcome_ambiguous');
      } else {
        report.save_attempt = { status: 'read_only_resume', realInsertIdFromCheckpoint: true };
      }

      stage = 'history_toggle_wait';
      await waitFor(
        'saved_history_row_loaded',
        () => observedHistory(panel, saveId),
        (state) => state?.linked && state.historyToggleCount === 1,
      );
      stage = 'history_pointer_click';
      await click(panel, 'title', 'Saved audits for this URL');
      stage = 'history_list_wait';
      const open = await waitFor(
        'history_list_open',
        () => observedHistory(panel, saveId),
        (state) =>
          state?.linked &&
          state.historyOpen &&
          state.historyRowCount === state.historyCount &&
          state.historyIdentities.some((row) => row.id === saveId),
      );
      const savedRow = open.historyIdentities.find((row) => row.id === saveId);
      assert.ok(savedRow, 'real Save ID appears in current URL history');
      assert.equal(
        open.historyIdentities.filter((row) => row.label === savedRow.label).length,
        1,
        'saved row label resolves to one trusted pointer target',
      );
      target('T05', 'identified_saved_history_row_opens_for_current_url', {
        rowCountMatchesBadge: true,
        actualSaveIdMatchesHistoryRow: true,
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
          state.historyIdentities.some((row) => row.id === saveId),
      );
      stage = 'saved_snapshot_open';
      await click(panel, 'button', savedRow.label);
      await waitFor(
        'saved_snapshot_visible',
        () => seoState(panel),
        (state) =>
          state?.linked &&
          state.savedSnapshot &&
          state.snapshotId === saveId &&
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
      target('T05', 'identified_snapshot_and_live_return', {
        snapshotVisible: true,
        snapshotIdMatchesActualSaveResponse: true,
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
          !state.error,
        30_000,
      );
      stage = 'persisted_history_reopen';
      await click(panel, 'title', 'Saved audits for this URL');
      const reloadedHistory = await waitFor(
        'persisted_history_list_visible',
        () => seoState(panel),
        (state) =>
          state?.linked &&
          state.historyOpen &&
          state.historyRowCount === persisted.historyCount &&
          state.historyIdentities.some((row) => row.id === saveId),
      );
      const reloadedRow = reloadedHistory.historyIdentities.find((row) => row.id === saveId);
      assert.equal(
        reloadedHistory.historyIdentities.filter((row) => row.label === reloadedRow.label).length,
        1,
        'reloaded saved row remains a unique pointer target',
      );
      stage = 'persisted_snapshot_open';
      await click(panel, 'button', reloadedRow.label);
      await waitFor(
        'persisted_snapshot_identity',
        () => seoState(panel),
        (state) => state?.linked && state.savedSnapshot && state.snapshotId === saveId,
      );
      target('T05', 'identified_saved_history_survives_panel_reload', {
        newDocumentObserved: true,
        currentPublicTitleMatches: true,
        actualSaveIdStillInHistoryAndSnapshot: true,
      });
    },
  });
  report.status = 'partial';
  stage = 'complete';
  process.stdout.write('PARTIAL seo_admin_native_batch\n');
} catch (error) {
  report.status = 'unverified';
  report.failure_stage = stage;
  if (error?.driverFailure) report.pointer_diagnostic = error.driverFailure;
  const knownWait = /^(saved_history_row_loaded|history_list_open)_not_observed:/.exec(
    String(error?.message ?? ''),
  );
  if (knownWait) report.failure_wait = knownWait[1];
  process.exitCode = 1;
  process.stderr.write(`UNVERIFIED seo_admin_native_batch at ${stage}\n`);
}
await mkdir(join(REPO, 'test-results'), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
