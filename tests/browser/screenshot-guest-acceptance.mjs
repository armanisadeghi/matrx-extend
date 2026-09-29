#!/usr/bin/env node
/** EXT-F-1009 guest gate only; the capture/gallery features are signed-in-only. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireLocalDevReceipt } from '../../scripts/record-local-dev-build.mjs';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { nativeRuntimeFailureCode } from './native-runtime-failure.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { click, evaluate, openSection, waitFor } from './settings-panel-driver.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUTPUT = join(REPO, 'test-results', `screenshot-guest-acceptance-${randomUUID()}.json`);
const EXTENSION_DIR = resolve(
  REPO,
  process.env.SCREENSHOT_GUEST_EXTENSION_DIR ?? '.output/chrome-mv3-dev',
);
const RELEASE_RECEIPT = join(REPO, '.output', 'release-receipt.json');
const DEV_BUILD_RECEIPT = process.env.SCREENSHOT_GUEST_DEV_BUILD_RECEIPT;
const RECEIPT = DEV_BUILD_RECEIPT ?? RELEASE_RECEIPT;
const MANIFEST = join(EXTENSION_DIR, 'manifest.json');
const ADMIN_ENV = join(homedir(), 'code', 'aidream', '.env');
const WEB_ORIGIN = 'https://www.aimatrx.com';
const ADMIN_EMAIL = 'admin@admin.com';
const GUEST_RELOAD = process.env.SCREENSHOT_GUEST_RELOAD === '1';
const ROLE_CHANGE = process.env.SCREENSHOT_ROLE_CHANGE === '1';
let stage = 'owned_profile';
const report = {
  schema: 1,
  feature: 'EXT-F-1009',
  mode: ROLE_CHANGE ? 'real_admin_to_guest_transition' : 'guest',
  status: 'unverified',
  scenario: { guestReloadRequested: GUEST_RELOAD, roleChangeRequested: ROLE_CHANGE },
  build: null,
  cases: [],
};

async function readBuildIdentity() {
  const [receipt, manifest] = await Promise.all([
    readFile(RECEIPT, 'utf8').then(JSON.parse),
    readFile(MANIFEST, 'utf8').then(JSON.parse),
  ]);
  if (DEV_BUILD_RECEIPT !== undefined) {
    const pkg = JSON.parse(await readFile(join(REPO, 'package.json'), 'utf8'));
    requireLocalDevReceipt(receipt, EXTENSION_DIR);
    if (
      !manifest.key ||
      manifest.version !== pkg.version ||
      manifest.version !== receipt.version ||
      hashReleaseTree(EXTENSION_DIR) !== receipt.treeSha256
    )
      throw new Error('screenshot_guest_development_build_identity_mismatch');
    return {
      kind: receipt.kind,
      publishState: receipt.publish_state,
      version: manifest.version,
      treeSha256: receipt.treeSha256,
    };
  }
  if (receipt.version !== manifest.version || !/^[a-f0-9]{64}$/.test(receipt.treeSha256 ?? ''))
    throw new Error('screenshot_guest_release_manifest_identity_mismatch');
  return { version: manifest.version, treeSha256: receipt.treeSha256 };
}

async function guestNavigation(panel, targetTitle = null, viewMarker = null) {
  return evaluate(
    panel,
    `(() => {
    const targetTitle=${JSON.stringify(targetTitle)},viewMarker=${JSON.stringify(viewMarker)};
    const lists=[...document.querySelectorAll('[role="tablist"]')].filter(n=>!n.closest('[role="tabpanel"]'));
    const list=lists.length===1?lists[0]:null;
    const tabs=list?[...list.querySelectorAll('[role="tab"]')].filter(n=>n.closest('[role="tablist"]')===list):[];
    const screenshotTabs=tabs.filter(n=>n.title==='Screenshots');
    const chatTabs=tabs.filter(n=>n.title==='Chat');
    const targetTabs=targetTitle===null?[]:tabs.filter(n=>n.title===targetTitle);
    const targetTab=targetTabs.length===1?targetTabs[0]:null;
    const panes=[...document.querySelectorAll('[role="tabpanel"]')].filter(n=>!n.parentElement?.closest('[role="tabpanel"]'));
    const active=panes.filter(n=>n.getAttribute('data-state')==='active');
    const pane=active.length===1?active[0]:null;
    const linkedPaneVisible=!!pane&&!!targetTab&&pane.id===targetTab.getAttribute('aria-controls')&&
      pane.getAttribute('aria-labelledby')===targetTab.id&&pane.getBoundingClientRect().height>0;
    return {listCount:lists.length,tabCount:tabs.length,screenshotTriggerCount:screenshotTabs.length,
      screenshotTriggerVisible:screenshotTabs.some(n=>{const r=n.getBoundingClientRect();return r.width>0&&r.height>0}),
      chatTriggerCount:chatTabs.length,
      chatTriggerVisible:chatTabs.some(n=>{const r=n.getBoundingClientRect();return r.width>0&&r.height>0}),
      screenshotContentMounted:[...document.querySelectorAll('button')].some(n=>['Visible','Full page'].includes(n.textContent.trim())),
      screenshotPaneCount:panes.filter(n=>n.id.toLowerCase().includes('screenshots')).length,
      activePaneCount:active.length,activePaneIsScreenshots:active.some(n=>n.id.toLowerCase().includes('screenshots')),
      targetTabCount:targetTabs.length,targetSelected:targetTab?.getAttribute('aria-selected')==='true',
      linkedPaneVisible,viewMarkerPresent:viewMarker===null?null:
        [...(pane?.querySelectorAll('span,h1,h2,button')??[])].some(n=>n.textContent.trim()===viewMarker),
      suspenseFallback:!!pane?.querySelector('svg.animate-spin')&&!pane?.innerText?.trim(),
      chatComponentMounted:!!pane?.querySelector('button[title="New chat"]'),
      chatPaneCount:panes.filter(n=>n.id.toLowerCase().includes('chat')).length,
      guestChatGuidancePresent:[...(pane?.querySelectorAll('span')??[])]
        .some(n=>n.textContent.trim()==='Sign in to choose an agent'),
      guestAvatarCount:document.querySelectorAll('button[title="Account"]').length,
      adminAvatarCount:document.querySelectorAll('button[title="admin@admin.com"]').length};
  })()`,
  );
}

function guestViewAccepted(value) {
  return (
    value?.listCount === 1 &&
    value.targetTabCount === 1 &&
    value.targetSelected &&
    value.activePaneCount === 1 &&
    value.linkedPaneVisible &&
    value.viewMarkerPresent !== false &&
    !value.suspenseFallback &&
    value.guestAvatarCount === 1 &&
    value.adminAvatarCount === 0 &&
    value.chatTriggerCount === 1 &&
    value.chatTriggerVisible &&
    !value.chatComponentMounted &&
    !value.guestChatGuidancePresent &&
    value.screenshotTriggerCount === 0 &&
    value.screenshotPaneCount === 0 &&
    !value.screenshotContentMounted
  );
}

async function selectedGuestView(panel, title, marker = null) {
  return waitFor(
    `guest_${title.toLowerCase()}_selected`,
    () => guestNavigation(panel, title, marker),
    (value) => guestViewAccepted(value),
  );
}

// Mirrors the real web-form and extension Account sign-in sequence in
// isolated-admin-signin-acceptance.mjs without importing its executable entrypoint.
async function signInAsAdmin(page, panel) {
  stage = 'role_change_account';
  await click(panel, 'title', 'Settings');
  await openSection(panel, 'Account');
  const web = await page.context().newPage();
  try {
    stage = 'role_change_web_login';
    await web.goto(`${WEB_ORIGIN}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const route = new URL(web.url());
    if (route.origin !== WEB_ORIGIN || route.pathname !== '/login')
      throw new Error('screenshot_guest_web_login_route_unverified');
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
    if (variables.AI_ADMIN_USERNAME !== ADMIN_EMAIL || !variables.AI_ADMIN_PASSWORD)
      throw new Error('screenshot_guest_admin_credentials_unavailable');
    await web.locator('input[name="email"]').fill(ADMIN_EMAIL);
    await web.locator('input[name="password"]').fill(variables.AI_ADMIN_PASSWORD);
    await Promise.all([
      web.waitForURL((url) => url.origin === WEB_ORIGIN && url.pathname === '/dashboard', {
        timeout: 90_000,
      }),
      web.getByRole('button', { name: 'Sign in', exact: true }).click(),
    ]);
    stage = 'role_change_extension_signin';
    await click(panel, 'button', 'Sign in');
    await waitFor(
      'screenshot_guest_admin_identity',
      () =>
        evaluate(
          panel,
          `(() => {
        const account=[...document.querySelectorAll('button[aria-expanded]')]
          .find(button=>button.textContent.trim()==='Account');
        const section=account?.parentElement?.nextElementSibling;
        const row=label=>[...(section?.querySelectorAll('span')??[])]
          .find(span=>span.textContent.trim()===label)?.parentElement?.textContent.trim()??null;
        return {emailMatch:row('Email')==='Email${ADMIN_EMAIL}',
          adminRole:row('Role')?.toLowerCase()==='roleadmin',
          avatarCount:document.querySelectorAll('button[title="admin@admin.com"]').length};
      })()`,
        ),
      (identity) => identity?.emailMatch && identity.adminRole && identity.avatarCount === 1,
      90_000,
    );
  } finally {
    await web.close();
  }
}

async function saveScreenshot(panel, artifacts, label) {
  const path = join(artifacts, `${label}-${randomUUID()}.png`);
  const image = await panel.send('Page.captureScreenshot', { format: 'png' });
  const handle = await open(path, 'wx', 0o600);
  try {
    await handle.writeFile(Buffer.from(image.data, 'base64'));
    await handle.sync();
  } finally {
    await handle.close();
  }
  return path;
}

async function setStoreAssetViewport(panel) {
  await panel.send('Emulation.setDeviceMetricsOverride', {
    width: 640,
    height: 400,
    deviceScaleFactor: 1,
    mobile: false,
  });
}

async function exercise({ page, panel, artifacts }) {
  try {
    await setStoreAssetViewport(panel);
    stage = 'guest_initial_navigation';
    const initial = await guestNavigation(panel);
    assert.equal(initial.listCount, 1);
    assert.equal(initial.screenshotTriggerCount, 0);
    assert.equal(initial.screenshotContentMounted, false);
    assert.equal(initial.screenshotPaneCount, 0);
    assert.equal(initial.chatTriggerCount, 1);
    assert.equal(initial.chatTriggerVisible, true);
    assert.equal(initial.chatComponentMounted, false);
    assert.equal(initial.guestChatGuidancePresent, false);
    assert.equal(initial.guestAvatarCount, 1);
    assert.equal(initial.adminAvatarCount, 0);
    report.cases.push({
      id: 'EXT-F-1009-T09',
      status: 'pass',
      expected:
        'Guest can see Chat, while Screenshots navigation and protected content stay hidden.',
      actual: initial,
      evidence: 'role-scoped navigation and content booleans',
    });
    report.screenshots = {
      before: await saveScreenshot(panel, artifacts, 'guest-chat-gate-before'),
      action: null,
      result: null,
    };

    stage = 'accessible_view_navigation';
    const scrape = await selectedGuestView(panel, 'Scrape');
    await click(panel, 'button', 'Capture');
    const capturedScrape = await waitFor(
      'guest_scrape_capture_complete',
      () =>
        evaluate(
          panel,
          `(() => [...document.querySelectorAll('button[role="tab"]')]
            .some(button => button.textContent.trim() === 'Article'))()`,
        ),
      (captured) => captured === true,
      30_000,
    );
    report.storeAssets = {
      scrape: await saveScreenshot(panel, artifacts, 'store-guest-scrape-article'),
      seo: null,
      settings: null,
    };
    await click(panel, 'title', 'Data');
    const data = await selectedGuestView(panel, 'Data', 'Structured data');
    report.screenshots.action = await saveScreenshot(panel, artifacts, 'guest-chat-gate-action');
    await click(panel, 'title', 'SEO');
    const seo = await selectedGuestView(panel, 'SEO', 'SEO audit');
    report.storeAssets.seo = await saveScreenshot(panel, artifacts, 'store-guest-seo-audit');
    await click(panel, 'title', 'Settings');
    const settings = await selectedGuestView(panel, 'Settings', 'Settings');
    await openSection(panel, 'Scrape');
    const autoCaptureOff = await waitFor(
      'guest_auto_capture_off',
      () =>
        evaluate(
          panel,
          `document.querySelector('[role="switch"][aria-label="Auto-scrape on load"]')
            ?.getAttribute('aria-checked')`,
        ),
      (checked) => checked === 'false',
    );
    await evaluate(
      panel,
      `document.querySelector('[role="switch"][aria-label="Auto-scrape on load"]')
        ?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })`,
    );
    await waitFor(
      'guest_auto_capture_visible',
      () =>
        evaluate(
          panel,
          `(() => {
            const element = document.querySelector('[role="switch"][aria-label="Auto-scrape on load"]');
            if (!element) return false;
            const rect = element.getBoundingClientRect();
            return rect.top >= 0 && rect.bottom <= innerHeight;
          })()`,
        ),
      (visible) => visible === true,
    );
    report.storeAssets.settings = await saveScreenshot(
      panel,
      artifacts,
      'store-guest-settings-auto-capture-off',
    );
    report.screenshots.result = await saveScreenshot(panel, artifacts, 'guest-chat-gate-result');
    report.cases.push({
      id: 'EXT-F-1009-T09',
      subcase: 'visible_navigation',
      status: 'pass',
      expected: 'Moving through guest tabs keeps Chat available and Screenshots hidden.',
      actual: { scrape, capturedScrape, data, seo, settings, autoCaptureOff },
      evidence:
        'selected public trigger, linked visible pane, mounted target marker, visible Chat, and Screenshots absence at each transition',
    });

    if (GUEST_RELOAD) {
      stage = 'guest_real_panel_reload';
      const previousLoader = (await panel.send('Page.getFrameTree'))?.frameTree?.frame?.loaderId;
      if (!previousLoader) throw new Error('screenshot_guest_loader_before_reload_unverified');
      await panel.send('Page.reload', { ignoreCache: false });
      await waitFor(
        'screenshot_guest_new_document',
        async () => (await panel.send('Page.getFrameTree'))?.frameTree?.frame?.loaderId,
        (loader) => Boolean(loader && loader !== previousLoader),
        30_000,
      );
      const reloaded = await selectedGuestView(panel, 'Scrape');
      report.cases.push({
        id: 'EXT-F-1009-T09',
        subcase: 'guest_real_reload',
        status: 'pass',
        expected:
          'Real guest panel reload returns to Scrape, with Chat available and Screenshots hidden.',
        actual: { newDocument: true, guestView: reloaded },
        evidence:
          'new loader identity; settled mounted Scrape pane; visible Chat and Screenshots trigger/pane/content absent',
      });
    } else {
      report.cases.push({
        id: 'EXT-F-1009-T09',
        subcase: 'guest_real_reload',
        status: 'unverified',
        expected: 'Guest denial after real panel reload.',
        actual: 'Optional guest reload was not requested.',
      });
    }

    if (ROLE_CHANGE) {
      await signInAsAdmin(page, panel);
      stage = 'admin_screenshots_selected';
      await click(panel, 'title', 'Screenshots');
      const selected = await waitFor(
        'admin_screenshots_selected',
        () => guestNavigation(panel, 'Screenshots', 'Screenshots'),
        (value) =>
          value?.targetTabCount === 1 &&
          value.targetSelected &&
          value.activePaneCount === 1 &&
          value.linkedPaneVisible &&
          value.viewMarkerPresent &&
          !value.suspenseFallback &&
          value.adminAvatarCount === 1,
      );
      stage = 'admin_screenshots_signout';
      await click(panel, 'title', ADMIN_EMAIL);
      await waitFor(
        'avatar_local_signout_ready',
        () =>
          evaluate(
            panel,
            `(() => {
          const popover=document.querySelector('[data-state="open"][role="dialog"]')??
            [...document.querySelectorAll('[data-state="open"]')]
              .find(node=>node.textContent?.includes('Desktop:'));
          return {menuOpen:!!popover,signOutCount:[...(popover?.querySelectorAll('button')??[])]
            .filter(button=>button.textContent.trim()==='Sign out').length};
        })()`,
          ),
        (value) => value?.menuOpen && value.signOutCount === 1,
      );
      await click(panel, 'button', 'Sign out');
      stage = 'guest_navigation_recovery_after_signout';
      const recovered = await selectedGuestView(panel, 'Scrape');
      report.cases.push({
        id: 'EXT-F-1009-T09',
        subcase: 'stale_selection_after_real_signout',
        status: 'pass',
        expected: 'Signing out from selected Screenshots returns to Scrape with Chat available.',
        actual: {
          adminScreenshotsSelected: selected.targetSelected && selected.linkedPaneVisible,
          guestRecovery: recovered,
        },
        evidence:
          'same owned profile; real avatar Sign out; settled mounted Scrape pane with visible Chat and Screenshots trigger/pane/content absent',
      });
    } else {
      report.cases.push({
        id: 'EXT-F-1009-T09',
        subcase: 'stale_selection_after_real_signout',
        status: 'unverified',
        expected: 'Admin-selected Screenshots then real sign-out and guest recovery.',
        actual: 'Optional real auth transition was not requested; no auth state was fabricated.',
      });
    }
    report.status = 'partial';
  } catch (error) {
    report.status = 'unverified';
    report.failure = { stage, driverFailure: safeFailure(error) };
    try {
      report.failure.privateScreenshot = await saveScreenshot(
        panel,
        artifacts,
        'guest-chat-gate-failure',
      );
    } catch {
      report.failure.privateScreenshot = false;
    }
    throw new Error('screenshot_guest_gate_stage_failed');
  }
}

function safeFailure(error) {
  const d = error?.driverFailure;
  return d && typeof d === 'object'
    ? {
        code: typeof d.code === 'string' ? d.code : 'unknown',
        sampleStage: typeof d.sampleStage === 'string' ? d.sampleStage : null,
        matchedTargetCount: Number.isInteger(d.matchedTargetCount) ? d.matchedTargetCount : null,
        visibleMatchCount: Number.isInteger(d.visibleMatchCount) ? d.visibleMatchCount : null,
      }
    : { code: 'stage_operation_failed' };
}

try {
  stage = 'build_identity_start';
  const buildAtStart = await readBuildIdentity();
  report.build = {
    version: buildAtStart.version,
    treeSha256: buildAtStart.treeSha256,
    before: buildAtStart,
    after: null,
    artifactTreeMatchedAfter: false,
  };
  stage = 'owned_profile';
  const run = await runNativeSidepanelQa({
    ...(DEV_BUILD_RECEIPT !== undefined && {
      extensionDir: EXTENSION_DIR,
      expectedRelease: buildAtStart,
      localDevReceiptPath: DEV_BUILD_RECEIPT,
    }),
    exercisePanel: exercise,
  });
  assert.equal(run.verified, true, 'owned profile and released artifact verified');
  stage = 'build_identity_end';
  const buildAtEnd = await readBuildIdentity();
  if (
    buildAtEnd.version !== buildAtStart.version ||
    buildAtEnd.treeSha256 !== buildAtStart.treeSha256 ||
    hashReleaseTree(EXTENSION_DIR) !== buildAtStart.treeSha256
  )
    throw new Error('screenshot_guest_release_changed_during_run');
  report.build.after = { ...buildAtEnd, extensionId: run.extensionId };
  report.build.artifactTreeMatchedAfter = true;
  report.profileOwned = run.verified === true;
} catch (error) {
  report.status = 'unverified';
  report.failure ??= {
    stage,
    driverFailure: { code: nativeRuntimeFailureCode(error) ?? 'owned_harness_failed' },
  };
}
await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${report.status.toUpperCase()} screenshot_guest_gate\n`);
if (report.status === 'unverified') process.exitCode = 1;
