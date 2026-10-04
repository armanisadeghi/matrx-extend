#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
/**
 * Isolated, native-side-panel browser QA harness.
 *
 * It never attaches to a guessed or pre-existing CDP port.  Chrome is started
 * directly with a newly-created profile, and CDP is read from that profile's
 * DevToolsActivePort only after the existing owned-CDP guard has correlated
 * the profile with the launched Chrome-for-Testing process.  The harness does
 * not call Browser.close: cleanup terminates only its direct child process.
 *
 * Run after `pnpm build`:
 *   node tests/browser/native-sidepanel-qa-harness.mjs
 * If Playwright or Chrome-for-Testing is supplied by the host runtime, set
 * MATRX_PLAYWRIGHT_MODULE and MATRX_CHROME_PATH to their installed absolute paths.
 */
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireLocalDevReceipt } from '../../scripts/record-local-dev-build.mjs';
import { observeStartupGpu } from '../../scripts/startup-gpu-observation.mjs';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { markBrowserAgentTraffic } from './agent-traffic.mjs';
import { resolveBrowserRuntime } from './browser-runtime.mjs';
import { awaitNativeResourceHealth, runNativeResourceAction } from './native-resource-boundary.mjs';
import { serveOwnedFixture } from './owned-fixture-server.mjs';
import { startReloadLifetimeDiagnostic } from './reload-lifetime-diagnostic.mjs';

const require = createRequire(import.meta.url);
const { prepareOwnedProfile, connectOwnedCdp } = require('./vault-owned-cdp.cjs');

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const RELEASED_EXTENSION_DIR = join(REPO, '.output', 'chrome-mv3-dev');
const RELEASE_RECEIPT = join(REPO, '.output', 'release-receipt.json');
const EXPECTED_EXTENSION_ID = 'cihdmkcdjjckfhjpgoedmgfpoljebaml';
const WEB_ORIGIN = 'https://www.aimatrx.com';
const WAIT_MS = 100;
const ATTEMPTS = 150;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function requireReleaseReceipt(receipt) {
  if (
    !receipt ||
    typeof receipt.version !== 'string' ||
    !/^[a-f0-9]{64}$/.test(receipt.treeSha256 ?? '') ||
    typeof receipt.storeZip?.path !== 'string' ||
    !/^[a-f0-9]{64}$/.test(receipt.storeZip.sha256 ?? '')
  )
    throw new Error('native_sidepanel_release_receipt_refused');
  return receipt;
}

function resolveExpectedRelease({ receipt, extensionDir, expectedRelease, localDev = false }) {
  if (localDev) {
    if (!extensionDir) throw new Error('native_sidepanel_local_build_path_required');
    const dev = requireLocalDevReceipt(receipt, extensionDir);
    if (
      !expectedRelease ||
      expectedRelease.treeSha256 !== dev.treeSha256 ||
      expectedRelease.version !== dev.version
    )
      throw new Error('native_sidepanel_local_build_provenance_refused');
    return Object.freeze({
      kind: 'local_dev_unpacked',
      extensionDir: resolve(extensionDir),
      treeSha256: dev.treeSha256,
      version: dev.version,
    });
  }
  if (receipt?.kind === 'published_store_crx_unpacked') {
    if (
      !extensionDir ||
      !expectedRelease ||
      expectedRelease.treeSha256 !== receipt.treeSha256 ||
      expectedRelease.version !== receipt.version
    )
      throw new Error('native_sidepanel_store_crx_provenance_refused');
    return Object.freeze({
      kind: receipt.kind,
      extensionDir: resolve(extensionDir),
      treeSha256: receipt.treeSha256,
      version: receipt.version,
      crxPath: receipt.crxPath,
      crxSha256: receipt.crxSha256,
      extensionId: receipt.extensionId,
    });
  }
  const released = requireReleaseReceipt(receipt);
  if (extensionDir !== undefined) {
    if (
      !expectedRelease ||
      expectedRelease.treeSha256 !== released.treeSha256 ||
      expectedRelease.version !== released.version
    )
      throw new Error('native_sidepanel_override_provenance_refused');
  }
  return Object.freeze({
    extensionDir: resolve(extensionDir ?? RELEASED_EXTENSION_DIR),
    treeSha256: released.treeSha256,
    version: released.version,
    storeZipPath: released.storeZip.path,
    storeZipSha256: released.storeZip.sha256,
  });
}

async function verifyReleasedArtifact(expected) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(expected.extensionDir, 'manifest.json'), 'utf8'));
  } catch {
    throw new Error('native_sidepanel_release_manifest_refused');
  }
  if (manifest.version !== expected.version)
    throw new Error('native_sidepanel_release_version_refused');
  if (expected.kind === 'local_dev_unpacked' && !manifest.key)
    throw new Error('native_sidepanel_local_build_key_refused');
  if (hashReleaseTree(expected.extensionDir) !== expected.treeSha256)
    throw new Error('native_sidepanel_release_tree_refused');
  if (expected.kind === 'local_dev_unpacked') return;
  if (expected.kind === 'published_store_crx_unpacked') {
    if (
      !/^[a-f0-9]{64}$/.test(expected.crxSha256 ?? '') ||
      expected.extensionId !== 'hnfolienncfklkgmdjjmhhegglimlamg'
    )
      throw new Error('native_sidepanel_store_crx_receipt_refused');
    const crx = await readFile(expected.crxPath);
    if (sha256(crx) !== expected.crxSha256)
      throw new Error('native_sidepanel_store_crx_hash_refused');
    const key = Buffer.from(manifest.key ?? '', 'base64');
    const actualId = [...sha256(key).slice(0, 32)]
      .map((digit) => String.fromCharCode(97 + Number.parseInt(digit, 16)))
      .join('');
    if (actualId !== expected.extensionId)
      throw new Error('native_sidepanel_store_crx_identity_refused');
    return;
  }
  let zip;
  try {
    zip = await readFile(expected.storeZipPath);
  } catch {
    throw new Error('native_sidepanel_store_zip_missing');
  }
  if (sha256(zip) !== expected.storeZipSha256)
    throw new Error('native_sidepanel_store_zip_refused');
}

function requireOwnedCommandLine(commandLine, profile) {
  const args = commandLine?.arguments;
  if (!Array.isArray(args) || !args.includes(`--user-data-dir=${profile}`))
    throw new Error('native_sidepanel_foreign_browser_refused');
  if (!args.includes('--remote-debugging-port=0'))
    throw new Error('native_sidepanel_unowned_debugging_refused');
}

function requireExpectedExtension(targetInfos, extensionId) {
  const prefix = `chrome-extension://${extensionId}/`;
  const serviceWorker = targetInfos.find(
    (target) => target.type === 'service_worker' && target.url.startsWith(prefix),
  );
  if (!serviceWorker) throw new Error('native_sidepanel_expected_extension_missing');
  return serviceWorker;
}

function requireSpawnedProfileOwner(lockTarget, childPid) {
  const owner = /-(\d+)$/.exec(String(lockTarget ?? ''))?.[1];
  if (!owner || Number(owner) !== childPid)
    throw new Error('native_sidepanel_profile_owner_not_spawned_child');
}

function requireSidePanelContext(contexts, panelUrl) {
  const context = contexts?.find(
    (entry) =>
      entry?.contextType === 'SIDE_PANEL' && entry?.documentUrl === panelUrl && entry?.tabId === -1,
  );
  if (!context) throw new Error('native_sidepanel_runtime_context_missing');
  return context;
}

function panelContextDiagnostic(contexts, panelUrl) {
  const panel = new URL(panelUrl);
  const extensionPrefix = `${panel.protocol}//${panel.host}/`;
  return {
    contextCount: contexts.length,
    sidePanelCount: contexts.filter((entry) => entry?.contextType === 'SIDE_PANEL').length,
    expectedExtensionCount: contexts.filter(
      (entry) =>
        typeof entry?.documentUrl === 'string' && entry.documentUrl.startsWith(extensionPrefix),
    ).length,
    exactUrlCount: contexts.filter((entry) => entry?.documentUrl === panelUrl).length,
    globalTabCount: contexts.filter((entry) => entry?.tabId === -1).length,
    exactContextCount: contexts.filter(
      (entry) =>
        entry?.contextType === 'SIDE_PANEL' &&
        entry?.documentUrl === panelUrl &&
        entry?.tabId === -1,
    ).length,
    missingDocumentUrlCount: contexts.filter((entry) => entry?.documentUrl == null).length,
    emptyDocumentUrlCount: contexts.filter((entry) => entry?.documentUrl === '').length,
    otherExtensionUrlCount: contexts.filter(
      (entry) =>
        typeof entry?.documentUrl === 'string' &&
        entry.documentUrl.startsWith('chrome-extension://') &&
        !entry.documentUrl.startsWith(extensionPrefix),
    ).length,
    nonExtensionUrlCount: contexts.filter(
      (entry) =>
        typeof entry?.documentUrl === 'string' &&
        entry.documentUrl.length > 0 &&
        !entry.documentUrl.startsWith('chrome-extension://'),
    ).length,
  };
}

async function panelContextFailureDiagnostic({ contexts, panelUrl, readContexts, waitBetween }) {
  const initial = panelContextDiagnostic(contexts, panelUrl);
  let firstRead = true;
  try {
    const boundary = await observeSidePanelContext({
      readContexts: () => {
        if (firstRead) {
          firstRead = false;
          return contexts;
        }
        return readContexts();
      },
      panelUrl,
      attempts: 2,
      waitBetween,
    });
    return { ...initial, followUp: boundary.last, followUpQueryFailed: false };
  } catch {
    // This second read is diagnostic only; preserve the original exact-context failure.
    return { ...initial, followUp: null, followUpQueryFailed: true };
  }
}

async function observeSidePanelContext({
  readContexts,
  panelUrl,
  attempts = ATTEMPTS,
  waitBetween = () => wait(WAIT_MS),
}) {
  const started = Date.now();
  let first = null;
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let contexts;
    try {
      contexts = await readContexts();
    } catch (error) {
      error.contextBoundary = {
        first,
        last,
        attempts: attempt,
        exact_expected_appeared: false,
        query_failed: true,
      };
      throw error;
    }
    const expected = contexts.filter(
      (entry) =>
        entry?.contextType === 'SIDE_PANEL' &&
        entry?.documentUrl === panelUrl &&
        entry?.tabId === -1,
    );
    const observation = {
      side_panel_count: contexts.length,
      exact_expected_count: expected.length,
      elapsed_ms: Date.now() - started,
    };
    first ??= observation;
    last = observation;
    if (expected.length > 0)
      return { first, last, attempts: attempt, exact_expected_appeared: true };
    if (attempt < attempts) await waitBetween();
  }
  return { first, last, attempts, exact_expected_appeared: false };
}

function isSettledGuestPanel(state) {
  return (
    state?.ready === true &&
    state?.guestAccount === true &&
    state?.scrapeTrigger === true &&
    state?.chatTrigger === true &&
    state?.visibleControls >= 2
  );
}

async function ownedEndpoint(profile) {
  const raw = await readFile(join(profile, 'DevToolsActivePort'), 'utf8');
  const [port, browserPath, ...rest] = raw.trimEnd().split(/\r?\n/);
  if (
    rest.length ||
    !/^[1-9][0-9]{0,4}$/.test(port) ||
    Number(port) > 65535 ||
    !/^\/devtools\/browser\/[A-Za-z0-9-]+$/.test(browserPath)
  )
    throw new Error('native_sidepanel_owned_endpoint_refused');
  return { port: Number(port), browserPath };
}

async function waitForPanelTarget(cdp, panelUrl) {
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const { targetInfos } = await cdp.send('Target.getTargets');
    const target = targetInfos.find((entry) => entry.type === 'page' && entry.url === panelUrl);
    if (target) return target;
    await wait(WAIT_MS);
  }
  throw new Error('native_sidepanel_target_missing');
}

async function waitForExpectedExtension(cdp, extensionId) {
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const { targetInfos } = await cdp.send('Target.getTargets');
    try {
      return requireExpectedExtension(targetInfos, extensionId);
    } catch (error) {
      if (!String(error?.message).includes('expected_extension_missing')) throw error;
    }
    await wait(WAIT_MS);
  }
  throw new Error('native_sidepanel_expected_extension_missing');
}

async function reloadManagementState(details, extensionId) {
  const state = await details.evaluate(async (id) => {
    const extensions = await chrome.developerPrivate.getExtensionsInfo({
      includeDisabled: true,
      includeTerminated: true,
    });
    const item = extensions.find((extension) => extension.id === id);
    return {
      state: item?.state ?? 'ABSENT',
      unsupported_developer_extension: item?.disableReasons?.unsupportedDeveloperExtension === true,
      runtime_error_count: item?.runtimeErrors?.length ?? 0,
      manifest_error_count: item?.manifestErrors?.length ?? 0,
    };
  }, extensionId);
  return {
    ...state,
    developer_mode: await details
      .locator('extensions-toolbar #devMode')
      .evaluate((toggle) => toggle.checked === true),
  };
}

function requireReloadEnabled(state) {
  if (
    state.developer_mode !== true ||
    state.state !== 'ENABLED' ||
    state.unsupported_developer_extension
  ) {
    const error = new Error('native_extension_reload_disabled');
    error.lifecycleEvidence = { management: state };
    throw error;
  }
}

async function reloadOwnedExtension({ cdp, browser, context, page, extensionId, oldPanelId }) {
  let details;
  let lifetime;
  const destroyedTargets = new Set();
  const createdWorkers = new Set();
  const workerUrlPrefix = `chrome-extension://${extensionId}/`;
  const timeline = [];
  let timelineDropped = 0;
  const knownTargets = new Map();
  let oldWorkerId = null;
  let replacementWorkerId = null;
  let preClickOldWorkerPresent = false;
  let lastOwned = [];
  let finalPredicate = false;
  let retirementEvidence;
  const record = (phase, data = {}) => {
    const entry = { at: new Date().toISOString(), phase, ...data };
    if (timeline.length < 80) timeline.push(entry);
    else timelineDropped += 1;
  };
  const describe = (target) => {
    if (!target?.url?.startsWith(workerUrlPrefix)) return null;
    const kind =
      target.type === 'service_worker'
        ? 'worker'
        : target.url === `${workerUrlPrefix}sidepanel.html`
          ? 'panel'
          : 'extension_other';
    const identity = {
      target_id: target.targetId,
      type: target.type,
      kind,
      attached: typeof target.attached === 'boolean' ? target.attached : null,
    };
    knownTargets.set(target.targetId, identity);
    return identity;
  };
  const snapshot = (phase, targets) => {
    const owned = targets.map(describe).filter(Boolean).slice(0, 16);
    lastOwned = owned;
    record(phase, { targets: owned });
  };
  const onDestroyed = ({ targetId }) => {
    destroyedTargets.add(targetId);
    const identity = knownTargets.get(targetId);
    if (identity) record('target_destroyed', { target: identity });
  };
  const onCreated = ({ targetInfo }) => {
    const identity = describe(targetInfo);
    if (identity) record('target_created', { target: identity });
    if (targetInfo?.type === 'service_worker' && targetInfo.url.startsWith(workerUrlPrefix))
      createdWorkers.add(targetInfo.targetId);
  };
  const onChanged = ({ targetInfo }) => {
    const identity = describe(targetInfo) ?? knownTargets.get(targetInfo?.targetId);
    if (identity) record('target_info_changed', { target: identity });
  };
  try {
    details = await context.newPage();
    await details.goto(`chrome://extensions/?id=${extensionId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    // Command-line unpacked loading works with Developer mode off, but Chrome
    // disables that same extension on reload. Set the native owned-profile UI.
    const developerMode = details.locator('extensions-toolbar #devMode');
    if (!(await developerMode.evaluate((toggle) => toggle.checked))) await developerMode.click();
    if (!(await developerMode.evaluate((toggle) => toggle.checked)))
      throw new Error('native_extension_developer_mode_unverified');
    const managementBefore = await reloadManagementState(details, extensionId);
    requireReloadEnabled(managementBefore);
    const reload = details.locator('extensions-detail-view #dev-reload-button');
    if ((await reload.count()) !== 1 || !(await reload.isVisible()))
      throw new Error('native_extension_management_reload_unavailable');
    lifetime = await startReloadLifetimeDiagnostic({ browser, context, page, extensionId });
    await cdp.send('Target.setDiscoverTargets', { discover: true });
    record('discovery_enabled');
    const before = (await cdp.send('Target.getTargets')).targetInfos;
    snapshot('initial_snapshot', before);
    const currentWorkers = before.filter(
      (target) => target.type === 'service_worker' && target.url.startsWith(workerUrlPrefix),
    );
    if (currentWorkers.length !== 1) throw new Error('native_extension_current_worker_unverified');
    oldWorkerId = currentWorkers[0].targetId;
    const panelUrl = `${workerUrlPrefix}sidepanel.html`;
    if (!before.some((target) => target.targetId === oldPanelId && target.url === panelUrl))
      throw new Error('native_extension_current_panel_unverified');
    cdp.on('Target.targetDestroyed', onDestroyed);
    cdp.on('Target.targetCreated', onCreated);
    cdp.on('Target.targetInfoChanged', onChanged);
    record('listeners_registered');
    const immediatelyBeforeReload = (await cdp.send('Target.getTargets')).targetInfos;
    snapshot('pre_click_snapshot', immediatelyBeforeReload);
    preClickOldWorkerPresent = immediatelyBeforeReload.some(
      (target) => target.targetId === oldWorkerId,
    );
    if (!preClickOldWorkerPresent) {
      const error = new Error('native_extension_old_worker_retired_before_reload');
      error.lifecycleEvidence = {
        timeline: {
          old_worker_id: oldWorkerId,
          old_panel_id: oldPanelId,
          replacement_worker_id: null,
          pre_click_old_worker_present: false,
          entries: timeline,
          dropped_entries: timelineDropped,
          final_snapshot: immediatelyBeforeReload.map(describe).filter(Boolean).slice(0, 16),
          final_predicate: false,
        },
      };
      throw error;
    }
    lifetime.correlateOld(oldWorkerId);
    record('click_started');
    await reload.click(); // Chrome's own extension-management UI, using trusted input.
    record('click_resolved');
    let replacementWorker;
    let lastSnapshot = '';
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      const { targetInfos } = await cdp.send('Target.getTargets');
      const owned = targetInfos.map(describe).filter(Boolean);
      lastOwned = owned.slice(0, 16);
      const signature = JSON.stringify(owned);
      if (signature !== lastSnapshot) {
        snapshot('poll_transition', targetInfos);
        lastSnapshot = signature;
      }
      const ids = new Set(targetInfos.map((target) => target.targetId));
      replacementWorker = targetInfos.find(
        (target) =>
          target.type === 'service_worker' &&
          target.url.startsWith(workerUrlPrefix) &&
          target.targetId !== oldWorkerId,
      );
      replacementWorkerId = replacementWorker?.targetId ?? null;
      retirementEvidence = {
        old_worker_destroyed_event: destroyedTargets.has(oldWorkerId),
        old_worker_execution_retired: lifetime.executionRetired(oldWorkerId, replacementWorkerId),
        old_worker_absent: !ids.has(oldWorkerId),
        old_panel_absent: !ids.has(oldPanelId),
        replacement_worker_present: Boolean(replacementWorker),
        replacement_worker_created_event: Boolean(
          replacementWorker && createdWorkers.has(replacementWorker.targetId),
        ),
        observed_worker_count: targetInfos.filter(
          (target) => target.type === 'service_worker' && target.url.startsWith(workerUrlPrefix),
        ).length,
      };
      const accepted = Boolean(
        retirementEvidence.old_worker_execution_retired &&
          retirementEvidence.observed_worker_count === 1 &&
          !ids.has(oldWorkerId) &&
          !ids.has(oldPanelId) &&
          replacementWorker &&
          createdWorkers.has(replacementWorker.targetId),
      );
      finalPredicate = accepted;
      retirementEvidence.timeline = {
        old_worker_id: oldWorkerId,
        old_panel_id: oldPanelId,
        replacement_worker_id: replacementWorkerId,
        pre_click_old_worker_present: preClickOldWorkerPresent,
        entries: timeline,
        dropped_entries: timelineDropped,
        final_snapshot: owned.slice(0, 16),
        final_predicate: accepted,
      };
      if (accepted) break;
      replacementWorker = undefined;
      await wait(WAIT_MS);
    }
    if (!replacementWorker) {
      await lifetime.probe(oldWorkerId, replacementWorkerId);
      const error = new Error('native_extension_worker_retirement_unverified');
      error.lifecycleEvidence = {
        ...retirementEvidence,
        management: await reloadManagementState(details, extensionId),
        reload_lifetime: lifetime.evidence,
      };
      throw error;
    }
    await page.bringToFront();
    await page.locator('#open-panel').click();
    let replacementPanel;
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      const { targetInfos } = await cdp.send('Target.getTargets');
      const owned = targetInfos.map(describe).filter(Boolean);
      lastOwned = owned.slice(0, 16);
      const signature = JSON.stringify(owned);
      if (signature !== lastSnapshot) {
        snapshot('poll_transition', targetInfos);
        lastSnapshot = signature;
      }
      replacementPanel = targetInfos.find(
        (target) =>
          target.type === 'page' && target.url === panelUrl && target.targetId !== oldPanelId,
      );
      if (replacementPanel) break;
      await wait(WAIT_MS);
    }
    if (!replacementPanel) throw new Error('native_extension_replacement_panel_unverified');
    const contextBoundary = await observeSidePanelContext({
      readContexts: () => sidePanelContexts(cdp, replacementWorker.targetId),
      panelUrl,
    });
    // Preserve the first sample as evidence, then use the bounded exact-match verdict.
    if (!contextBoundary.exact_expected_appeared) {
      const error = new Error('native_sidepanel_runtime_context_missing');
      error.contextBoundary = contextBoundary;
      error.lifecycleEvidence = retirementEvidence;
      throw error;
    }
    const managementAfter = await reloadManagementState(details, extensionId);
    requireReloadEnabled(managementAfter);
    retirementEvidence.timeline.final_snapshot = lastOwned;
    retirementEvidence.timeline.dropped_entries = timelineDropped;
    retirementEvidence.reload_lifetime = lifetime.evidence;
    return {
      management_before: managementBefore,
      management_after: managementAfter,
      panel: await attachTargetSession(cdp, replacementPanel.targetId),
      worker_replaced: replacementWorker.targetId !== oldWorkerId,
      panel_replaced: replacementPanel.targetId !== oldPanelId,
      old_targets_retired: true,
      retirement_evidence: retirementEvidence,
      context_boundary: contextBoundary,
      management_reload_clicked: true,
    };
  } catch (error) {
    if (error && typeof error === 'object') {
      error.lifecycleEvidence = {
        ...retirementEvidence,
        ...error.lifecycleEvidence,
        ...(lifetime && { reload_lifetime: lifetime.evidence }),
        timeline: {
          old_worker_id: oldWorkerId,
          old_panel_id: oldPanelId,
          replacement_worker_id: replacementWorkerId,
          pre_click_old_worker_present: preClickOldWorkerPresent,
          entries: timeline,
          dropped_entries: timelineDropped,
          final_snapshot: lastOwned,
          final_predicate: finalPredicate,
        },
      };
    }
    throw error;
  } finally {
    await lifetime?.close();
    cdp.off('Target.targetDestroyed', onDestroyed);
    cdp.off('Target.targetCreated', onCreated);
    cdp.off('Target.targetInfoChanged', onChanged);
    await details?.close().catch(() => {});
  }
}

async function acquireLiveExtensionPanel({ cdp, page, extensionId }) {
  const panelUrl = `chrome-extension://${extensionId}/sidepanel.html`;
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const { targetInfos } = await cdp.send('Target.getTargets');
    const target = targetInfos.find((item) => item.type === 'page' && item.url === panelUrl);
    if (target) {
      let panel;
      let verified = false;
      try {
        panel = await attachTargetSession(cdp, target.targetId);
        const identity = await panel.send('Runtime.evaluate', {
          expression: 'chrome.runtime.id',
          returnByValue: true,
        });
        if (identity.result?.value === extensionId) {
          verified = true;
          return panel;
        }
      } catch {
        // Reload can destroy this target between discovery and attachment.
      } finally {
        if (panel && !verified) await panel.detach();
      }
    } else if (attempt === 0) {
      await page.bringToFront();
      await page.locator('#open-panel').click();
    }
    await wait(WAIT_MS);
  }
  throw new Error('native_extension_live_panel_unavailable_for_cleanup');
}

async function sidePanelContexts(cdp, serviceWorkerTargetId) {
  const worker = await attachTargetSession(cdp, serviceWorkerTargetId);
  try {
    const result = await worker.send('Runtime.evaluate', {
      expression: "chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] })",
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails || !Array.isArray(result.result?.value))
      throw new Error('native_sidepanel_runtime_context_query_failed');
    return result.result.value;
  } finally {
    await worker.detach();
  }
}

async function waitForSettledGuestPanel(cdp, targetId) {
  const panel = await attachTargetSession(cdp, targetId);
  const expression = `(() => {
    const visible = (element) => {
      const style = getComputedStyle(element); const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const controls = [...document.querySelectorAll('button, input, textarea, [contenteditable="true"]')]
      .filter(visible);
    return {
      ready: document.readyState === 'complete',
      guestAccount: controls.some((element) => element.getAttribute('title') === 'Account'),
      scrapeTrigger: [...document.querySelectorAll('button[role="tab"]')]
        .some((element) => element.getAttribute('title') === 'Scrape' && visible(element)),
      chatTrigger: [...document.querySelectorAll('button[role="tab"]')]
        .some((element) => element.getAttribute('title') === 'Chat' && visible(element)),
      visibleControls: controls.length,
    };
  })()`;
  let previousFingerprint;
  try {
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      const result = await panel.send('Runtime.evaluate', { expression, returnByValue: true });
      const state = result.result?.value;
      const fingerprint = JSON.stringify(state);
      if (isSettledGuestPanel(state) && previousFingerprint === fingerprint) return panel;
      previousFingerprint = fingerprint;
      await wait(WAIT_MS * 2);
    }
  } catch (error) {
    await panel.detach();
    throw error;
  }
  await panel.detach();
  throw new Error(`native_sidepanel_render_not_settled:${previousFingerprint ?? 'no_state'}`);
}

async function captureTarget(cdp, targetId, output) {
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  try {
    await cdp.send('Page.enable', {}, sessionId);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    if (typeof data !== 'string' || data.length < 100)
      throw new Error('native_sidepanel_png_missing');
    await writeFile(output, Buffer.from(data, 'base64'), { mode: 0o600 });
  } finally {
    await cdp.send('Target.detachFromTarget', { sessionId }).catch(() => {});
  }
}

async function attachTargetSession(cdp, targetId) {
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  return Object.freeze({
    async send(method, params = {}) {
      return cdp.send(method, params, sessionId);
    },
    on(method, listener) {
      const scoped = (params, eventSessionId) => {
        if (eventSessionId === sessionId) listener(params);
      };
      cdp.on(method, scoped);
      return () => cdp.off(method, scoped);
    },
    async detach() {
      await cdp.send('Target.detachFromTarget', { sessionId }).catch(() => {});
    },
  });
}

function stopOwnedChild(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(killWait);
      child.off('exit', onExit);
      error ? reject(error) : resolve();
    };
    const onExit = () => finish();
    let killWait;
    const timeout = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {}
      killWait = setTimeout(() => {
        if (child.exitCode !== null || child.signalCode !== null) finish();
        else finish(new Error('native_owned_child_termination_unconfirmed'));
      }, 2000);
    }, 5000);
    child.once('exit', onExit);
    if (child.exitCode !== null || child.signalCode !== null) return finish();
    try {
      child.kill('SIGTERM');
    } catch {
      if (child.exitCode !== null || child.signalCode !== null) finish();
      else finish(new Error('native_owned_child_stop_failed'));
    }
  });
}

function testPage(extensionId) {
  return `<!doctype html><meta charset="utf-8"><title>Research brief: product discovery</title>
    <main><article><h1>Research brief: product discovery</h1><p>A short demo article for a real guest Scrape capture.</p><p>Capture the page, review its structure, and identify SEO improvements before sharing the result.</p></article></main>
    <button id="open-panel">Open panel</button><pre id="result"></pre>
    <script>
      document.querySelector('#open-panel').addEventListener('click', () => {
        chrome.runtime.sendMessage(${JSON.stringify(extensionId)}, {
          channel: 'FRONTEND_RPC', action: 'openPanel', payload: { panelId: 'chat' },
          requestId: 'native-sidepanel-qa',
        }, (reply) => {
          document.querySelector('#result').textContent = JSON.stringify(
            reply ?? { error: chrome.runtime.lastError?.message ?? 'no reply' },
          );
        });
      });
    </script>`;
}

function browserDiagnosticFlags(value) {
  // Never emit arbitrary Chromium output: even a bounded tail can start inside
  // a credential and lose the label needed by a text redactor.
  const text = String(value);
  return {
    hadStderr: text.length > 0,
    codeSignature: /code sign|codesign|signature|signed resource/i.test(text),
    dynamicLoader: /dyld|library not loaded|symbol not found/i.test(text),
    permissionDenied: /permission denied|operation not permitted/i.test(text),
    sandbox: /sandbox/i.test(text),
    crash: /fatal|crash|segmentation|illegal instruction/i.test(text),
    devtoolsListening: /DevTools listening on/i.test(text),
  };
}

const SAFE_STARTUP_FAILURES = new Set([
  'owned_cdp_configuration_refused',
  'owned_cdp_endpoint_refused',
  'owned_cdp_endpoint_timeout',
  'owned_cdp_owner_refused',
  'owned_cdp_process_inspection_failed',
  'owned_cdp_socket_construction_failed',
  'owned_cdp_open_timeout',
  'owned_cdp_open_failed',
  'owned_cdp_transport_failed',
]);

function safeStartupFailureCode(error) {
  const code = error instanceof Error ? error.message : '';
  return SAFE_STARTUP_FAILURES.has(code) ? code : 'unclassified';
}

function safeEndpointDiagnostic(error) {
  if (safeStartupFailureCode(error) !== 'owned_cdp_endpoint_refused') return null;
  const diagnostic = error.endpointDiagnostic;
  if (diagnostic?.boundary === 'read' && diagnostic.reason === 'read_failed')
    return { boundary: 'read', reason: 'read_failed' };
  if (diagnostic?.boundary !== 'record_validation') return null;
  const reasons = new Set([
    'record_shape',
    'port_range',
    'browser_path_missing',
    'browser_path_shape',
  ]);
  const shape = diagnostic.shape;
  if (
    !reasons.has(diagnostic.reason) ||
    !Number.isSafeInteger(shape?.lineCount) ||
    shape.lineCount < 0 ||
    typeof shape.hasTrailingNewline !== 'boolean' ||
    typeof shape.portTokenDigits !== 'boolean' ||
    typeof shape.browserPathShape !== 'boolean'
  )
    return null;
  return {
    boundary: 'record_validation',
    reason: diagnostic.reason,
    shape: {
      lineCount: shape.lineCount,
      hasTrailingNewline: shape.hasTrailingNewline,
      portTokenDigits: shape.portTokenDigits,
      browserPathShape: shape.browserPathShape,
    },
  };
}

function safeEndpointWaitDiagnostic(error) {
  if (safeStartupFailureCode(error) !== 'owned_cdp_endpoint_timeout') return null;
  const diagnostic = error.endpointWaitDiagnostic;
  if (
    !Number.isSafeInteger(diagnostic?.polls) ||
    diagnostic.polls < 0 ||
    !Number.isSafeInteger(diagnostic.elapsedMs) ||
    diagnostic.elapsedMs < 0 ||
    !Number.isSafeInteger(diagnostic.longestReadMs) ||
    diagnostic.longestReadMs < 0
  )
    return null;
  return {
    polls: diagnostic.polls,
    elapsedMs: diagnostic.elapsedMs,
    longestReadMs: diagnostic.longestReadMs,
  };
}

export async function runNativeSidepanelQa({
  headed = false,
  extensionDir,
  expectedRelease,
  localDevReceiptPath,
  releaseReceiptPath = RELEASE_RECEIPT,
  chromeExecutable,
  expectedExtensionId = EXPECTED_EXTENSION_ID,
  artifactRoot = join(REPO, 'test-results'),
  publicDemoUrl,
  ownedPages,
  ownedAssets,
  exercisePanel,
  onStage = () => {},
  onStartupGpuObservation,
} = {}) {
  onStage('receipt');
  let receipt;
  try {
    receipt = JSON.parse(await readFile(localDevReceiptPath ?? releaseReceiptPath, 'utf8'));
  } catch {
    throw new Error(
      localDevReceiptPath
        ? 'native_sidepanel_local_build_receipt_missing'
        : 'native_sidepanel_release_receipt_missing',
    );
  }
  const expected = resolveExpectedRelease({
    receipt,
    extensionDir,
    expectedRelease,
    localDev: localDevReceiptPath !== undefined,
  });
  onStage('artifact_verify');
  await verifyReleasedArtifact(expected);
  onStage('browser_runtime');
  const browserRuntime = await resolveBrowserRuntime({ chromeExecutable });
  chromeExecutable = browserRuntime.executablePath;
  const verifiedExtensionDir = expected.extensionDir;
  const root = await mkdtemp(join(tmpdir(), 'matrx-native-sidepanel-qa-'));
  const profile = join(root, 'profile');
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const artifacts = await mkdtemp(join(artifactRoot, 'native-sidepanel-qa-'));
  await mkdir(profile, { mode: 0o700 });
  onStage('profile_prepare');
  const preparedProfile = await prepareOwnedProfile(profile);
  let child;
  let cdp;
  let playwrightBrowser;
  let server;
  let serverPort;
  let verified = false;
  let launchError;
  let startupStartedAt;
  let gpuObservation;
  try {
    onStage('browser_spawn');
    startupStartedAt = performance.now();
    child = spawn(
      chromeExecutable,
      [
        ...(!headed ? ['--headless=new'] : []),
        '--enable-automation',
        '--no-first-run',
        '--no-default-browser-check',
        '--use-mock-keychain',
        '--remote-debugging-address=127.0.0.1',
        '--remote-debugging-port=0',
        `--user-data-dir=${profile}`,
        `--disable-extensions-except=${verifiedExtensionDir}`,
        `--load-extension=${verifiedExtensionDir}`,
        // Avoid loading an unused New Tab page during owned-profile startup.
        'about:blank',
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let chromeStderr = '';
    let spawnObserved = false;
    child.once('spawn', () => {
      spawnObserved = true;
    });
    child.stderr.on('data', (chunk) => {
      chromeStderr = (chromeStderr + String(chunk)).slice(-2000);
    });
    child.once('error', (error) => {
      launchError = error;
    });

    try {
      onStage('cdp_connect');
      cdp = await connectOwnedCdp({ preparedProfile, chromeExecutable });
      if (launchError) throw launchError;
    } catch (error) {
      const endpointDiagnostic = safeEndpointDiagnostic(error);
      const endpointWaitDiagnostic = safeEndpointWaitDiagnostic(error);
      const startupDiagnostic = {
        failureCode: safeStartupFailureCode(error),
        elapsedMs: Math.max(0, Math.round(performance.now() - startupStartedAt)),
        exitCode: child.exitCode,
        signalCode: child.signalCode,
        launchFailed: Boolean(launchError),
        spawnObserved,
        stderrFlags: browserDiagnosticFlags(chromeStderr),
        ...(endpointDiagnostic && { endpointDiagnostic }),
        ...(endpointWaitDiagnostic && { endpointWaitDiagnostic }),
      };
      // Guest result summaries truncate errors; preserve bounded startup evidence
      // in the runner log before forwarding the unchanged failure.
      process.stderr.write(`BROWSER_STARTUP_FAILURE ${JSON.stringify(startupDiagnostic)}\n`);
      throw error;
    }
    onStage('endpoint_read');
    const endpoint = await ownedEndpoint(profile);
    onStage('command_line_query');
    const commandLine = await cdp.send('Browser.getBrowserCommandLine');
    onStage('command_line_verify');
    requireOwnedCommandLine(commandLine, profile);
    let extensionWorker;
    try {
      onStage('extension_worker');
      extensionWorker = await waitForExpectedExtension(cdp, expectedExtensionId);
    } catch (error) {
      process.stderr.write(
        `BROWSER_EXTENSION_FAILURE ${JSON.stringify(browserDiagnosticFlags(chromeStderr))}\n`,
      );
      throw error;
    }
    onStage('spawn_owner');
    requireSpawnedProfileOwner(await readlink(join(profile, 'SingletonLock')), child.pid);
    verified = true;

    if (onStartupGpuObservation) gpuObservation = observeStartupGpu(cdp, onStartupGpuObservation);

    onStage('local_server');
    server = createServer((request, response) => {
      serveOwnedFixture(request, response, {
        ownedPages,
        ownedAssets,
        rootPage: testPage(expectedExtensionId),
      });
    });
    await new Promise((resolve, reject) =>
      server.listen(0, '127.0.0.1', (error) => (error ? reject(error) : resolve())),
    );
    serverPort = server.address().port;

    // This attach is derived exclusively from this profile's DevToolsActivePort,
    // after the process/profile/extension checks above. It is never a shared port.
    onStage('playwright_connect');
    playwrightBrowser = await browserRuntime.chromium.connectOverCDP(
      `http://127.0.0.1:${endpoint.port}`,
    );
    onStage('page_create');
    const context = playwrightBrowser.contexts()[0];
    // Every drive of our app/server from this owned browser is ours, not a visitor's.
    await markBrowserAgentTraffic(context, 'native-sidepanel-qa-harness', WEB_ORIGIN);
    await markBrowserAgentTraffic(
      context,
      'native-sidepanel-qa-harness',
      'https://server.app.matrxserver.com',
    );
    const page = await context.newPage();
    onStage('local_page_navigation');
    await page.goto(`http://localhost:${serverPort}/`);
    onStage('panel_open');
    await page.locator('#open-panel').click(); // Real trusted Chromium input.
    await page.locator('#result').waitFor({ state: 'visible' });
    onStage('panel_reply');
    const reply = JSON.parse((await page.locator('#result').textContent()) || '{}');
    if (reply?.ok !== true || reply?.result?.opened !== true)
      throw new Error(`native_sidepanel_open_refused:${JSON.stringify(reply)}`);

    const normalTarget = (await cdp.send('Target.getTargets')).targetInfos.find(
      (entry) => entry.type === 'page' && entry.url === page.url(),
    );
    if (!normalTarget) throw new Error('native_sidepanel_normal_target_missing');
    const panelUrl = `chrome-extension://${expectedExtensionId}/sidepanel.html`;
    onStage('panel_target');
    const panelTarget = await waitForPanelTarget(cdp, panelUrl);
    if (panelTarget.targetId === normalTarget.targetId)
      throw new Error('native_sidepanel_target_not_distinct');
    onStage('panel_context');
    const contexts = await sidePanelContexts(cdp, extensionWorker.targetId);
    try {
      requireSidePanelContext(contexts, panelUrl);
    } catch (error) {
      process.stderr.write(
        `BROWSER_PANEL_CONTEXT_FAILURE ${JSON.stringify(await panelContextFailureDiagnostic({ contexts, panelUrl, readContexts: () => sidePanelContexts(cdp, extensionWorker.targetId) }))}\n`,
      );
      throw error;
    }
    onStage('panel_settle');
    const readyPanel = await waitForSettledGuestPanel(cdp, panelTarget.targetId);

    if (publicDemoUrl) {
      if (publicDemoUrl !== 'https://www.aimatrx.com/matrx-extend-demo')
        throw new Error('native_sidepanel_public_demo_url_refused');
      onStage('demo_navigation');
      await page.goto(publicDemoUrl);
      await page.locator('main article').waitFor({ state: 'visible' });
    }

    const normalPng = join(artifacts, 'normal-target-after-open.png');
    const panelPng = join(artifacts, 'native-side-panel.png');
    onStage('screenshot');
    await captureTarget(cdp, normalTarget.targetId, normalPng);
    await captureTarget(cdp, panelTarget.targetId, panelPng);
    await readyPanel.detach();
    onStage('exercise_panel');
    if (exercisePanel) {
      const panel = await attachTargetSession(cdp, panelTarget.targetId);
      try {
        await exercisePanel(
          Object.freeze({
            page,
            panel,
            browserSession: cdp,
            activatePanel: () =>
              cdp.send('Target.activateTarget', { targetId: panelTarget.targetId }),
            transportFailureClass: () => cdp.failureClass,
            panelTarget,
            artifacts,
            requireResourceHealth: () => awaitNativeResourceHealth({ repo: REPO }),
            resourceAction: (action) =>
              runNativeResourceAction(() => awaitNativeResourceHealth({ repo: REPO }), action),
            attachWorker: () => attachTargetSession(cdp, extensionWorker.targetId),
            attachOffscreen: async () => {
              const offscreenUrl = `chrome-extension://${expectedExtensionId}/offscreen.html`;
              const targets = (await cdp.send('Target.getTargets')).targetInfos.filter(
                (target) => target.url === offscreenUrl,
              );
              if (targets.length !== 1)
                throw new Error('native_sidepanel_offscreen_target_missing');
              return attachTargetSession(cdp, targets[0].targetId);
            },
            reloadExtension: () =>
              reloadOwnedExtension({
                cdp,
                browser: playwrightBrowser,
                context,
                page,
                extensionId: expectedExtensionId,
                oldPanelId: panelTarget.targetId,
              }),
            acquireLivePanel: () =>
              acquireLiveExtensionPanel({ cdp, page, extensionId: expectedExtensionId }),
          }),
        );
      } finally {
        await panel.detach();
      }
    }
    return Object.freeze({
      artifacts,
      normalPng,
      panelPng,
      extensionId: expectedExtensionId,
      panelTargetId: panelTarget.targetId,
      verified,
    });
  } finally {
    // Browser.close is intentionally absent, including for Playwright's CDP
    // connection. Only the exact ChildProcess this harness spawned is ended.
    await cdp?.detach().catch(() => {});
    await gpuObservation;
    await new Promise((resolve) => server?.close(resolve) ?? resolve());
    await stopOwnedChild(child);
    await rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runNativeSidepanelQa()
    .then((result) => console.log(`PASS native panel screenshot: ${result.panelPng}`))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

export {
  reloadOwnedExtension,
  isSettledGuestPanel,
  requireReleaseReceipt,
  requireExpectedExtension,
  requireOwnedCommandLine,
  requireSidePanelContext,
  observeSidePanelContext,
  requireSpawnedProfileOwner,
  resolveExpectedRelease,
  verifyReleasedArtifact,
  stopOwnedChild,
  safeStartupFailureCode,
  safeEndpointDiagnostic,
  safeEndpointWaitDiagnostic,
  panelContextDiagnostic,
  panelContextFailureDiagnostic,
};
