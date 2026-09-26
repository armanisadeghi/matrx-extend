#!/usr/bin/env node
/**
 * EXT-D-0023: a real failed highlight insert must stay visible after the
 * person selects a workspace. Root owns guarded native execution. This script
 * never saves a Source, deletes a row, or supplies identity/storage state.
 */
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { click, evaluate, openSection, waitFor } from './settings-panel-driver.mjs';

const REPO = resolve(import.meta.dirname, '..', '..');
const OUTPUT = join(REPO, 'test-results', 'notice-write-retention-acceptance.json');
const PRIVATE_CONFIG = join(REPO, 'test-results', 'd22-private-config.json');
const ADMIN_ENV = join(homedir(), 'code', 'aidream', '.env');
const WEB_ORIGIN = 'https://www.aimatrx.com';
const PUBLIC_FIXTURE = 'https://example.com/';
const EMAIL = 'admin@admin.com';

let stage = 'before_owned_profile';
let activePanel = null;
const report = {
  schema_version: 1,
  defect_id: 'EXT-D-0023',
  case_id: 'EXT-F-2010-T02',
  status: 'unverified',
  scope: 'fresh owned admin panel; one real no-workspace Highlights action; no Source Save',
  observations: {
    ownedReceiptVerified: false,
    adminSignedInThroughUi: false,
    noWorkspaceSelected: false,
    highlighterActiveOnPublicPage: false,
    highlightActionDispatchedByPointer: false,
    failedWriteNoticeBeforeSelection: false,
    approvedWorkspaceSelectedThroughUi: false,
    failedWriteNoticeRetained: false,
    lateNoticeAfterSelection: 'not_observed',
    highlightInsertRequests: 0,
    privateScreenshot: 'not_needed',
  },
};
function fail(code) {
  report.failureCode = code;
  throw new Error('notice_write_retention_unverified');
}

async function approvedOrganizationName() {
  const stat = await lstat(PRIVATE_CONFIG).catch(() => fail('private_config_unavailable'));
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) fail('private_config_not_private');
  const parsed = JSON.parse(await readFile(PRIVATE_CONFIG, 'utf8'));
  if (
    typeof parsed?.approved_organization_name !== 'string' ||
    !parsed.approved_organization_name.trim() ||
    parsed.approved_organization_name !== parsed.approved_organization_name.trim()
  )
    fail('approved_workspace_name_unavailable');
  return parsed.approved_organization_name;
}

async function realWebSignIn(page) {
  const web = await page.context().newPage();
  try {
    await web.goto(`${WEB_ORIGIN}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const login = new URL(web.url());
    if (login.origin !== WEB_ORIGIN || login.pathname !== '/login') fail('web_login_route');
    const variables = {};
    for (const line of (await readFile(ADMIN_ENV, 'utf8')).split(/\r?\n/)) {
      const found = /^\s*(AI_ADMIN_USERNAME|AI_ADMIN_PASSWORD)\s*=\s*(.*?)\s*$/.exec(line);
      if (!found) continue;
      let value = found[2];
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      )
        value = value.slice(1, -1);
      variables[found[1]] = value;
    }
    if (variables.AI_ADMIN_USERNAME !== EMAIL || !variables.AI_ADMIN_PASSWORD)
      fail('admin_credentials_unavailable');
    await web.locator('input[name="email"]').fill(EMAIL);
    await web.locator('input[name="password"]').fill(variables.AI_ADMIN_PASSWORD);
    await Promise.all([
      web.waitForURL((url) => url.origin === WEB_ORIGIN && url.pathname === '/dashboard', {
        timeout: 90_000,
      }),
      web.getByRole('button', { name: 'Sign in', exact: true }).click(),
    ]);
    return web;
  } catch {
    await web.close();
    fail('real_web_login_unverified');
  }
}

async function adminVisible(panel) {
  return evaluate(
    panel,
    `(() => {
      const account = [...document.querySelectorAll('button[aria-expanded]')]
        .find((button) => button.textContent.trim() === 'Account');
      const section = account?.parentElement?.nextElementSibling;
      const row = (label) => [...(section?.querySelectorAll('span') ?? [])]
        .find((span) => span.textContent.trim() === label)?.parentElement?.textContent.trim() ?? null;
      return row('Email') === 'Email${EMAIL}' && row('Role')?.toLowerCase() === 'roleadmin' &&
        [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === 'Sign out');
    })()`,
  );
}

async function workspaceState(panel, approvedName) {
  return evaluate(
    panel,
    `(async () => {
      const rows = [...document.querySelectorAll('span')]
        .filter((span) => span.textContent.trim() === 'Acting as');
      const controls = rows.flatMap((span) =>
        [...span.parentElement.parentElement.querySelectorAll('button[role="combobox"]')]);
      const stored = (await chrome.storage.local.get('matrx.org.active'))['matrx.org.active'];
      const dialogs = [...document.querySelectorAll('[role="dialog"]')]
        .filter((dialog) => dialog.textContent.includes('Which organization are you working in?'));
      return {
        controlCount: controls.length,
        displayedChoose: controls.length === 1 && controls[0].textContent.trim() === 'Choose…',
        displayedApproved: controls.length === 1 &&
          controls[0].textContent.trim() === ${JSON.stringify(approvedName)},
        storedPresent: typeof stored?.id === 'string',
        storedApproved: stored?.name === ${JSON.stringify(approvedName)},
        pickerCount: dialogs.length,
        approvedPickerChoices: dialogs.flatMap((dialog) =>
          [...dialog.querySelectorAll('[role="option"] span.truncate')])
          .filter((span) => span.textContent.trim() === ${JSON.stringify(approvedName)}).length,
      };
    })()`,
  );
}

async function failedHighlightNoticeCount(panel) {
  return evaluate(
    panel,
    `(() => [...document.querySelectorAll('[role="alert"]')]
      .filter((alert) => alert.querySelector('.font-medium')?.textContent.trim() === 'Highlight not saved' &&
        alert.querySelector('p')?.textContent.includes('no workspace is selected, so the request was never sent') &&
        alert.querySelector('p')?.textContent.includes('Nothing was saved.') &&
        alert.querySelector('p')?.textContent.includes('Pick a workspace from the account menu and try again.'))
      .length)()`,
  );
}

async function highlightPanelState(panel) {
  return evaluate(
    panel,
    `(() => {
      const tab = document.querySelector('button[role="tab"][title="Highlights"]');
      const pane = tab?.getAttribute('aria-controls')
        ? document.getElementById(tab.getAttribute('aria-controls')) : null;
      return {
        linked: tab?.getAttribute('aria-selected') === 'true' &&
          pane?.getAttribute('aria-labelledby') === tab.id && pane?.getAttribute('data-state') === 'active',
        start: [...(pane?.querySelectorAll('button') ?? [])]
          .filter((button) => button.textContent.trim() === 'Highlight this page' && !button.disabled).length,
        stop: [...(pane?.querySelectorAll('button') ?? [])]
          .filter((button) => button.textContent.trim() === 'Stop highlighting' && !button.disabled).length,
      };
    })()`,
  );
}

async function watchHighlightInserts(panel) {
  await panel.send('Network.enable');
  let requests = 0;
  const off = panel.on('Network.requestWillBeSent', ({ request }) => {
    try {
      const url = new URL(request?.url);
      if (request?.method === 'POST' && url.pathname.endsWith('/wbx_highlight')) requests += 1;
    } catch {
      // Never record URLs, headers or bodies from credential-bearing traffic.
    }
  });
  return { count: () => requests, stop: off };
}

async function privateFailureScreenshot(panel) {
  if (!panel) return 'unavailable';
  try {
    await mkdir(join(REPO, 'test-results'), { recursive: true, mode: 0o700 });
    const shot = await panel.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    await writeFile(
      join(REPO, 'test-results', `d23-write-retention-${randomUUID()}.png`),
      Buffer.from(shot.data, 'base64'),
      { flag: 'wx', mode: 0o600 },
    );
    return 'captured_private';
  } catch {
    return 'unavailable';
  }
}

try {
  await runNativeSidepanelQa({
    exercisePanel: async ({ page, panel }) => {
      activePanel = panel;
      try {
        const approvedName = await approvedOrganizationName();
        stage = 'real_admin_signin';
        await click(panel, 'title', 'Settings');
        await openSection(panel, 'Account');
        const web = await realWebSignIn(page);
        try {
          await click(panel, 'button', 'Sign in');
          await waitFor('admin_identity', () => adminVisible(panel), Boolean, 90_000);
          report.observations.adminSignedInThroughUi = true;
        } finally {
          await web.close();
        }

        stage = 'no_workspace_prerequisite';
        await openSection(panel, 'Organization');
        const initial = await waitFor(
          'unselected_workspace',
          () => workspaceState(panel, approvedName),
          (state) => state?.controlCount === 1 && state.displayedChoose && !state.storedPresent,
        );
        if (initial.storedPresent) fail('workspace_already_selected');
        report.observations.noWorkspaceSelected = true;

        stage = 'public_fixture_and_highlighter';
        await page.goto(PUBLIC_FIXTURE, { waitUntil: 'load', timeout: 60_000 });
        if (page.url() !== PUBLIC_FIXTURE) fail('public_fixture_redirected');
        await click(panel, 'title', 'Highlights');
        await waitFor(
          'highlight_start_control',
          () => highlightPanelState(panel),
          (state) => state?.linked && state.start === 1,
        );
        await click(panel, 'button', 'Highlight this page');
        await waitFor(
          'highlighter_active',
          () => highlightPanelState(panel),
          (state) => state?.linked && state.stop === 1,
        );
        await waitFor(
          'highlighter_injected_on_public_page',
          () => page.evaluate(() => Boolean(document.getElementById('matrx-highlighter-host'))),
          Boolean,
        );
        report.observations.highlighterActiveOnPublicPage = true;

        const inserts = await watchHighlightInserts(panel);
        try {
          stage = 'real_highlight_action';
          const heading = page.getByRole('heading', { name: 'Example Domain', exact: true });
          if ((await heading.count()) !== 1) fail('public_heading_not_unique');
          const box = await heading.boundingBox();
          if (!box || box.width < 30 || box.height < 10) fail('public_heading_not_drag_target');
          const centerY = box.y + box.height / 2;
          await page.mouse.move(box.x + 3, centerY);
          await page.mouse.down();
          let selectedEnough = false;
          try {
            await page.mouse.move(box.x + box.width - 3, centerY, { steps: 12 });
            selectedEnough = await page.evaluate(
              () => (window.getSelection()?.toString().trim().length ?? 0) >= 2,
            );
          } finally {
            await page.mouse.up();
          }
          if (!selectedEnough) fail('public_heading_text_not_selected');
          report.observations.highlightActionDispatchedByPointer = true;

          stage = 'wait_for_failed_write_before_selection';
          // requireRequestOrganizationId holds for up to 120 s. Selecting the
          // workspace before this exact notice would resume the insert, so the
          // runner never advances on the picker alone or an unrelated alert.
          await waitFor(
            'highlight_insert_failed_before_selection',
            () => failedHighlightNoticeCount(panel),
            (count) => count === 1,
            150_000,
          );
          if (inserts.count() !== 0) fail('highlight_insert_sent_without_workspace');
          report.observations.failedWriteNoticeBeforeSelection = true;
          report.observations.highlightInsertRequests = inserts.count();

          stage = 'approved_workspace_selection_after_failure';
          const offered = await waitFor(
            'approved_workspace_in_real_picker',
            () => workspaceState(panel, approvedName),
            (state) => state?.pickerCount === 1 && state.approvedPickerChoices === 1,
          );
          if (offered.storedPresent) fail('workspace_selected_before_write_failure');
          await click(panel, 'organization-picker-choice', approvedName);
          await waitFor(
            'approved_workspace_selected',
            () => workspaceState(panel, approvedName),
            (state) => state?.storedPresent && state.storedApproved && state.pickerCount === 0,
          );
          report.observations.approvedWorkspaceSelectedThroughUi = true;

          stage = 'failed_write_notice_retention';
          // Observe the completed transition, including naturally late notices.
          // This is a bounded absence check for an automatic insert retry.
          await new Promise((resolveWait) => setTimeout(resolveWait, 2_000));
          const retained = await failedHighlightNoticeCount(panel);
          report.observations.highlightInsertRequests = inserts.count();
          if (retained !== 1) fail('failed_write_notice_retired_without_retry');
          if (inserts.count() !== 0) fail('highlight_insert_retried_after_workspace_selection');
          report.observations.failedWriteNoticeRetained = true;
          report.status = 'bounded_pass';
        } finally {
          inserts.stop();
        }
      } catch (error) {
        report.observations.privateScreenshot = await privateFailureScreenshot(panel);
        throw error;
      }
    },
  });
  report.observations.ownedReceiptVerified = true;
} catch {
  report.status = 'unverified';
  report.failureStage = stage;
  report.failureCode ??= 'stage_failed';
  if (report.observations.privateScreenshot === 'not_needed')
    report.observations.privateScreenshot = await privateFailureScreenshot(activePanel);
  process.exitCode = 1;
}
await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${report.status.toUpperCase()} d23_notice_write_retention_native\n`);
