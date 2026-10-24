#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  ADMIN_TAB_TITLES,
  DEBUG_MODE_STORAGE_KEY,
  parseDebugModePreference,
  requireAdminTabProjection,
} from './debug-mode-native-contract.mjs';
import {
  awaitNativeResourceHealth,
  guardNativeResourceSessionSend,
  runNativeResourceAction,
} from './native-resource-boundary.mjs';
import { attachTargetSession, runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { panelIdentity, signInSettings } from './settings-native-auth-driver.mjs';
import { click, evaluate, waitFor } from './settings-panel-driver.mjs';

const REPO = resolve(import.meta.dirname, '..', '..');
const extensionDir = process.env.MATRX_DEBUG_MODE_EXTENSION_DIR;
const receiptPath = process.env.MATRX_DEBUG_MODE_RECEIPT;
const outputDir = process.env.MATRX_DEBUG_MODE_OUTPUT_DIR;
const expectedSourceSha = process.env.MATRX_DEBUG_MODE_EXPECTED_SOURCE_SHA;
const expectedVersion = process.env.MATRX_DEBUG_MODE_EXPECTED_VERSION;
const releaseRunId = process.env.MATRX_DEBUG_MODE_RELEASE_RUN_ID;
const runId = process.env.GITHUB_RUN_ID;
const runAttempt = process.env.GITHUB_RUN_ATTEMPT;
assert.ok(extensionDir && receiptPath && outputDir, 'debug_mode_release_inputs_required');
assert.match(expectedSourceSha ?? '', /^[a-f0-9]{40}$/, 'debug_mode_release_source_required');
assert.match(expectedVersion ?? '', /^\d+\.\d+\.\d+$/, 'debug_mode_release_version_required');
assert.match(releaseRunId ?? '', /^[1-9][0-9]*$/, 'debug_mode_release_run_required');
assert.match(runId ?? '', /^[1-9][0-9]*$/, 'debug_mode_hosted_run_required');
assert.match(runAttempt ?? '', /^[1-9][0-9]*$/, 'debug_mode_hosted_attempt_required');

const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
assert.equal(receipt.publishState, 'pushed', 'debug_mode_published_release_required');
assert.equal(receipt.sourceSha, expectedSourceSha, 'debug_mode_release_source_mismatch');
assert.equal(receipt.version, expectedVersion, 'debug_mode_release_version_mismatch');
assert.equal(
  receipt.artifactSelection?.source,
  'release_receipt_local_zip',
  'debug_mode_release_local_zip_required',
);
assert.equal(
  receipt.artifactSelection?.adaptation,
  'none',
  'debug_mode_release_adaptation_refused',
);
assert.equal(receipt.artifactSelection?.runtimeExtensionDir, extensionDir);

const outputPrefix = join(outputDir, `debug-mode-native-${runId}-${runAttempt}`);
const outputPath = `${outputPrefix}.json`;
const report = {
  schema_version: 1,
  scope: 'exact published release artifact in a disposable native side panel',
  case: 'debug-mode-admin',
  status: 'unverified',
  release_run_id: releaseRunId,
  build: {
    source_sha: expectedSourceSha,
    version: expectedVersion,
    tree_sha256: receipt.treeSha256,
    local_zip_sha256: receipt.localZip?.sha256 ?? null,
  },
  observations: {},
  screenshots: [],
};

const requireHealth = () => awaitNativeResourceHealth({ repo: REPO });
const resourceAction = (action) => runNativeResourceAction(requireHealth, action);

async function preference(panel) {
  const stored = await resourceAction(() =>
    evaluate(
      panel,
      `(async () => chrome.storage.local.get(${JSON.stringify(DEBUG_MODE_STORAGE_KEY)}))()`,
    ),
  );
  const raw = stored?.[DEBUG_MODE_STORAGE_KEY];
  return {
    on: parseDebugModePreference(raw),
    key_present: typeof raw === 'string',
  };
}

async function tabSnapshot(panel) {
  const identity = await resourceAction(() => panelIdentity(panel));
  const rendered = await resourceAction(() =>
    evaluate(
      panel,
      `(() => {
        const visible = (element) => {
          const style = getComputedStyle(element), rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' &&
            style.display !== 'none' && !element.closest('[inert]');
        };
        const tabs = [...document.querySelectorAll('button[role="tab"][title]')]
          .filter(visible).map((tab) => tab.title);
        const active = [...document.querySelectorAll('button[role="tab"][data-state="active"][title]')]
          .filter(visible);
        return { tabs, active: active.length === 1 ? active[0].title : null,
          activeCount: active.length, viewportWidth: window.innerWidth };
      })()`,
    ),
  );
  const pref = await preference(panel);
  const visibleAdminTabTitles = rendered.tabs.filter((title) => ADMIN_TAB_TITLES.includes(title));
  const isVerifiedAdmin =
    identity.accessTokenPresent === true &&
    identity.profileId !== null &&
    identity.isAdmin === true;
  requireAdminTabProjection({
    isVerifiedAdmin,
    debugModeOn: pref.on,
    visibleAdminTabTitles,
  });
  return {
    isVerifiedAdmin,
    signedIn: identity.accessTokenPresent === true && identity.profileId !== null,
    debugModeOn: pref.on,
    preferenceKeyPresent: pref.key_present,
    adminTabs: visibleAdminTabTitles,
    activeTab: rendered.active,
    activeTabCount: rendered.activeCount,
    viewportWidth: rendered.viewportWidth,
  };
}

async function accountMenuSnapshot(panel) {
  return resourceAction(() =>
    evaluate(
      panel,
      `(() => {
        const triggers = [...document.querySelectorAll('button[aria-haspopup="dialog"]')]
          .filter((button) => button.title === 'Account' || button.title.includes('@'));
        const trigger = triggers.length === 1 ? triggers[0] : null;
        const content = trigger?.getAttribute('aria-controls')
          ? document.getElementById(trigger.getAttribute('aria-controls')) : null;
        const open = trigger?.getAttribute('data-state') === 'open' &&
          content?.getAttribute('data-state') === 'open';
        const buttons = open ? [...content.querySelectorAll('button')] : [];
        const debugItems = buttons.filter((button) =>
          [...button.querySelectorAll('span')].some((span) => span.textContent.trim() === 'Debug'));
        const debugItem = debugItems.length === 1 ? debugItems[0] : null;
        const debugState = debugItem?.textContent.includes('On') ? 'On' :
          debugItem?.textContent.includes('Off') ? 'Off' : null;
        const version = open ? [...content.querySelectorAll('div')]
          .find((node) => node.childElementCount === 0 &&
            /^Version \\d+\\.\\d+\\.\\d+$/.test(node.textContent.trim()))?.textContent.trim() ?? null : null;
        const avatarRect = trigger?.getBoundingClientRect();
        const menuRect = open ? content.getBoundingClientRect() : null;
        return {
          triggerCount: triggers.length,
          triggerVisible: Boolean(trigger && avatarRect.width > 0 && avatarRect.height > 0),
          triggerInsideViewport: Boolean(avatarRect && avatarRect.left >= 0 &&
            avatarRect.right <= window.innerWidth && avatarRect.top >= 0 &&
            avatarRect.bottom <= window.innerHeight),
          open,
          debugCount: debugItems.length,
          debugState,
          version,
          menuInsideViewport: Boolean(menuRect && menuRect.left >= 0 &&
            menuRect.right <= window.innerWidth && menuRect.top >= 0 &&
            menuRect.bottom <= window.innerHeight),
          viewportWidth: window.innerWidth,
        };
      })()`,
    ),
  );
}

async function openAccountMenu(panel) {
  await waitFor(
    'debug_mode_account_avatar_ready',
    () =>
      resourceAction(() =>
        evaluate(
          panel,
          `(() => [...document.querySelectorAll('button[aria-haspopup="dialog"]')]
            .filter((button) => (button.title === 'Account' || button.title.includes('@')) &&
              button.getBoundingClientRect().width > 0).length === 1)()`,
        ),
      ),
    (ready) => ready === true,
  );
  await clickAction(panel, 'account-avatar', 'Account');
  return waitFor(
    'debug_mode_account_menu_open',
    () => accountMenuSnapshot(panel),
    (menu) => menu?.open === true,
  );
}

const clickAction = (panel, kind, label) => resourceAction(() => click(panel, kind, label));

async function waitForSnapshot(panel, label, accept) {
  return waitFor(label, () => tabSnapshot(panel), accept);
}

async function captureStage(panel, name) {
  const { data } = await resourceAction(() =>
    panel.send('Page.captureScreenshot', { format: 'png' }),
  );
  assert.ok(typeof data === 'string' && data.length > 100, 'debug_mode_screenshot_missing');
  const path = `${outputPrefix}-${name}.png`;
  await writeFile(path, Buffer.from(data, 'base64'), { mode: 0o600, flag: 'wx' });
  report.screenshots.push({ stage: name, file: path.split('/').at(-1) });
}

async function sendSyntheticNotice(browserSession, expectedExtensionId) {
  const target = await waitFor(
    'debug_mode_extension_worker_ready',
    async () => resourceAction(() => browserSession.send('Target.getTargets')),
    (result) =>
      result?.targetInfos?.filter(
        (item) =>
          item.type === 'service_worker' &&
          item.url.startsWith(`chrome-extension://${expectedExtensionId}/`),
      ).length === 1,
    30_000,
    (result) => ({
      extensionWorkerCount:
        result?.targetInfos?.filter(
          (item) =>
            item.type === 'service_worker' &&
            item.url.startsWith(`chrome-extension://${expectedExtensionId}/`),
        ).length ?? 0,
    }),
  );
  const workerTarget = target.targetInfos.find(
    (item) =>
      item.type === 'service_worker' &&
      item.url.startsWith(`chrome-extension://${expectedExtensionId}/`),
  );
  const workerSession = await resourceAction(() =>
    attachTargetSession(browserSession, workerTarget.targetId),
  );
  const guardedWorker = guardNativeResourceSessionSend(workerSession, resourceAction);
  try {
    const sent = await guardedWorker.send('Runtime.evaluate', {
      expression: `chrome.runtime.sendMessage({
        __matrx: true,
        kind: 'db:failure-notice',
        payload: {
          id: 'debug-mode-acceptance-notice',
          ts: Date.now(),
          tone: 'info',
          title: 'Debug mode display fixture',
          message: 'Acceptance-only notice fixture; no account or record was changed.',
          detail: 'ACCEPTANCE_FIXTURE_DETAIL_VISIBLE_ONLY_WHEN_DEBUG_ON'
        }
      }).then(() => true)`,
      awaitPromise: true,
      returnByValue: true,
    });
    assert.equal(sent.result?.value, true, 'debug_mode_notice_dispatch_unverified');
  } finally {
    await resourceAction(() => workerSession.detachVerified());
  }
}

async function noticeSnapshot(panel) {
  return resourceAction(() =>
    evaluate(
      panel,
      `(() => {
        const card = [...document.querySelectorAll('[role="status"], [role="alert"]')]
          .find((node) => node.querySelector('.font-medium')?.textContent.trim() ===
            'Debug mode display fixture');
        const detail = [...(card?.querySelectorAll('p') ?? [])]
          .find((node) => node.textContent.trim() ===
            'ACCEPTANCE_FIXTURE_DETAIL_VISIBLE_ONLY_WHEN_DEBUG_ON');
        const style = detail ? getComputedStyle(detail) : null;
        const rect = detail?.getBoundingClientRect();
        return { visible: Boolean(card && card.getBoundingClientRect().width > 0),
          detailVisible: Boolean(detail && rect.width > 0 && rect.height > 0 &&
            style.visibility !== 'hidden' && style.display !== 'none' && !detail.closest('[inert]')) };
      })()`,
    ),
  );
}

let failure;
try {
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  await runNativeSidepanelQa({
    extensionDir,
    expectedRelease: receipt,
    releaseReceiptPath: receiptPath,
    artifactRoot: outputDir,
    resourceAction,
    exercisePanel: async ({ page, panel, browserSession, activatePanel }) => {
      const auth = await signInSettings({
        mode: 'admin',
        page,
        panel,
        repo: REPO,
        adminCredentialsFile: process.env.MATRX_PREPARE_ADMIN_CREDENTIALS_FILE,
        resourceAction,
      });
      assert.equal(auth.extension_signed_in, true, 'debug_mode_admin_signin_unverified');
      await resourceAction(() => activatePanel());

      const defaults = await waitForSnapshot(
        panel,
        'debug_mode_default_projection',
        (snapshot) => snapshot?.isVerifiedAdmin === true && snapshot.activeTabCount === 1,
      );
      assert.equal(defaults.preferenceKeyPresent, false, 'debug_mode_default_was_not_fresh');
      assert.equal(defaults.debugModeOn, false, 'debug_mode_default_not_off');
      assert.deepEqual(defaults.adminTabs, []);
      report.observations.default_admin_hidden = defaults;

      const offMenu = await openAccountMenu(panel);
      assert.equal(offMenu.debugCount, 1, 'debug_mode_admin_switch_missing');
      assert.equal(offMenu.debugState, 'Off', 'debug_mode_default_switch_not_off');
      await clickAction(panel, 'account-menu', 'DebugOff');
      const enabled = await waitForSnapshot(
        panel,
        'debug_mode_admin_projection_enabled',
        (snapshot) => snapshot?.debugModeOn === true && snapshot.adminTabs.length === 4,
      );
      assert.equal(enabled.isVerifiedAdmin, true);
      assert.deepEqual(enabled.adminTabs, ADMIN_TAB_TITLES);
      report.observations.admin_tabs_enabled_in_order = enabled.adminTabs;

      await resourceAction(() => panel.send('Page.reload', { ignoreCache: true }));
      const persisted = await waitForSnapshot(
        panel,
        'debug_mode_persisted_after_reload',
        (snapshot) =>
          snapshot?.isVerifiedAdmin === true &&
          snapshot.debugModeOn === true &&
          snapshot.adminTabs.length === 4 &&
          snapshot.activeTabCount === 1,
      );
      assert.deepEqual(persisted.adminTabs, ADMIN_TAB_TITLES);
      report.observations.persisted_after_reload = {
        isVerifiedAdmin: persisted.isVerifiedAdmin,
        debugModeOn: persisted.debugModeOn,
        adminTabs: persisted.adminTabs,
      };

      await resourceAction(() =>
        panel.send('Emulation.setDeviceMetricsOverride', {
          width: 360,
          height: 800,
          deviceScaleFactor: 1,
          mobile: false,
        }),
      );
      const narrowMenu = await openAccountMenu(panel);
      assert.equal(narrowMenu.debugCount, 1);
      assert.equal(narrowMenu.debugState, 'On');
      assert.equal(narrowMenu.version, `Version ${expectedVersion}`);
      assert.equal(narrowMenu.viewportWidth, 360);
      assert.equal(narrowMenu.triggerInsideViewport, true, 'debug_mode_avatar_clipped_narrow');
      assert.equal(narrowMenu.menuInsideViewport, true, 'debug_mode_version_menu_clipped_narrow');
      report.observations.narrow_avatar_version = {
        viewportWidth: narrowMenu.viewportWidth,
        avatarInsideViewport: narrowMenu.triggerInsideViewport,
        menuInsideViewport: narrowMenu.menuInsideViewport,
        versionMatchesArtifact: narrowMenu.version === `Version ${expectedVersion}`,
      };
      await captureStage(panel, 'admin-on-narrow');
      await clickAction(panel, 'account-avatar', 'Account');
      await resourceAction(() => panel.send('Emulation.clearDeviceMetricsOverride'));

      await sendSyntheticNotice(
        browserSession,
        receipt.extensionId ?? 'cihdmkcdjjckfhjpgoedmgfpoljebaml',
      );
      await waitFor(
        'debug_mode_notice_detail_visible',
        () => noticeSnapshot(panel),
        (notice) => notice?.visible === true && notice.detailVisible === true,
      );
      await captureStage(panel, 'notice-detail-on');

      await clickAction(panel, 'title', 'Debug (admin only)');
      const activeDebug = await waitForSnapshot(
        panel,
        'debug_mode_admin_tab_selected',
        (snapshot) => snapshot?.activeTab === 'Debug (admin only)',
      );
      assert.equal(activeDebug.isVerifiedAdmin, true);
      const onMenu = await openAccountMenu(panel);
      assert.equal(onMenu.debugState, 'On');
      await clickAction(panel, 'account-menu', 'DebugOn');
      const disabled = await waitForSnapshot(
        panel,
        'debug_mode_disabled_safe_fallback',
        (snapshot) =>
          snapshot?.debugModeOn === false &&
          snapshot.adminTabs.length === 0 &&
          snapshot.activeTab === 'Chat',
      );
      assert.equal(disabled.isVerifiedAdmin, true);
      const hiddenNotice = await waitFor(
        'debug_mode_notice_detail_hidden',
        () => noticeSnapshot(panel),
        (notice) => notice?.visible === true && notice.detailVisible === false,
      );
      report.observations.off_fallback_and_notice_gating = {
        activeTab: disabled.activeTab,
        adminTabs: disabled.adminTabs,
        preferenceKeyPresent: disabled.preferenceKeyPresent,
        debugModeOn: disabled.debugModeOn,
        noticeVisible: hiddenNotice.visible,
        noticeDetailHidden: !hiddenNotice.detailVisible,
      };
      await captureStage(panel, 'admin-off-fallback');

      const secondOffMenu = await accountMenuSnapshot(panel);
      assert.equal(secondOffMenu.open, true, 'debug_mode_switch_menu_not_open_after_toggle');
      assert.equal(secondOffMenu.debugState, 'Off');
      await clickAction(panel, 'account-menu', 'DebugOff');
      const reenabled = await waitForSnapshot(
        panel,
        'debug_mode_reenabled_before_signout',
        (snapshot) => snapshot?.debugModeOn === true && snapshot.adminTabs.length === 4,
      );
      assert.deepEqual(reenabled.adminTabs, ADMIN_TAB_TITLES);
      await clickAction(panel, 'account-menu', 'Sign out');
      const signedOut = await waitForSnapshot(
        panel,
        'debug_mode_signout_keeps_admin_gate',
        (snapshot) => snapshot?.signedIn === false && snapshot.activeTabCount === 1,
      );
      assert.equal(signedOut.debugModeOn, true, 'debug_mode_preference_unexpectedly_cleared');
      assert.equal(signedOut.isVerifiedAdmin, false);
      assert.deepEqual(signedOut.adminTabs, [], 'debug_mode_overrode_admin_identity_gate');
      report.observations.signed_out_admin_projection_hidden = signedOut;
      const signedOutNotice = await waitFor(
        'debug_mode_notice_detail_hidden_after_signout',
        () => noticeSnapshot(panel),
        (notice) => notice?.visible === true && notice.detailVisible === false,
      );
      report.observations.notice_detail_hidden_after_signout = {
        signedOut: true,
        debugModeOn: signedOut.debugModeOn,
        noticeVisible: signedOutNotice.visible,
        noticeDetailHidden: !signedOutNotice.detailVisible,
      };

      const signedOutMenu = await openAccountMenu(panel);
      assert.equal(signedOutMenu.debugCount, 0, 'debug_mode_switch_visible_without_verified_admin');
      await clickAction(panel, 'button-text', 'Dismiss');
    },
  });
  report.status = 'pass';
} catch (error) {
  failure = error;
  report.status = 'fail';
  report.failure = String(error?.message ?? error).split(':', 1)[0];
} finally {
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
    flag: 'wx',
  });
}
if (failure) throw failure;
