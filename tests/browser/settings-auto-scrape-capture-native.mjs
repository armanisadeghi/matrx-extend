#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { requireLocalDevReceipt } from '../../scripts/record-local-dev-build.mjs';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import {
  autoScrapePreferenceIsConsistent,
  autoScrapePreferenceMatches,
  captureAutoScrapeBaseline,
  restoreAutoScrapeBaseline,
} from './settings-auto-scrape-capture-baseline.mjs';
import { assertCaptureOff, assertCaptureOn } from './settings-auto-scrape-capture-contract.mjs';
import { runGuestChoicesAcrossExtensionRestarts } from './settings-guest-extension-rechecks.mjs';
import {
  click,
  evaluate,
  openSection,
  waitFor,
  waitForReplacementSettingsTab,
} from './settings-panel-driver.mjs';
import {
  preserveFailureDuringCleanup,
  serializeGuestReloadFailure,
} from './settings-probe-cleanup.mjs';

const REPO = resolve(import.meta.dirname, '..', '..');
const OUTPUT = join(REPO, 'test-results/settings-auto-scrape-capture-native.json');
const EXTENSION_DIR = resolve(
  process.env.SETTINGS_DEV_EXTENSION_DIR ?? join(REPO, '.output/chrome-mv3-dev'),
);
const RECEIPT_PATH = process.env.SETTINGS_DEV_BUILD_RECEIPT;
const MARKER_ON = 'Harbor Dental intake hours October 2026';
const MARKER_OFF = 'Harbor Dental followup hours November 2026';
const PAGE_ON = '/harbor-dental-intake';
const PAGE_OFF = '/harbor-dental-followup';
const RELOAD_OFF_MS = 3000;
const observationExpression = `(async () => {
  const baseline = await (${captureAutoScrapeBaseline.toString()})(chrome.storage.local);
  const toggle = [...document.querySelectorAll('[role="switch"][aria-label="Auto-scrape on load"]')];
  return { ...baseline,
    visible: toggle.length === 1 ? toggle[0].getAttribute('aria-checked') === 'true' : null,
    calls: globalThis.__t40CaptureCalls ?? [] };
})()`;

async function settings(panel) {
  await waitForReplacementSettingsTab(panel);
  await click(panel, 'title', 'Settings');
  await openSection(panel, 'Scrape');
}

async function observe(panel) {
  return evaluate(panel, observationExpression);
}
async function setSwitch(panel, expected) {
  const before = await observe(panel);
  assert.ok(autoScrapePreferenceIsConsistent(before), 'auto_scrape_ui_storage_disagree');
  if (autoScrapePreferenceMatches(before, expected)) return before;
  if (before.visible !== expected) await click(panel, 'switch', 'Auto-scrape on load');
  return waitFor(
    `auto_scrape_${expected}_persisted`,
    () => observe(panel),
    (state) => autoScrapePreferenceMatches(state, expected),
  );
}
async function installTrafficObserver(panel, marker) {
  const state = await evaluate(
    panel,
    `(() => {
    if (globalThis.__t40CaptureOriginal) return { installed: false };
    const original = chrome.tabs.sendMessage.bind(chrome.tabs);
    globalThis.__t40CaptureOriginal = original;
    globalThis.__t40CaptureCalls = [];
    chrome.tabs.sendMessage = async (...args) => {
      const message = args[1];
      if (message?.kind !== 'scrape:capture-page') return original(...args);
      const event = { kind: message.kind, ok: false, url: null, markerPresent: false };
      globalThis.__t40CaptureCalls.push(event);
      try {
        const result = await original(...args);
        event.ok = Boolean(result && !result.__error);
        event.url = result?.url ?? null;
        event.markerPresent = JSON.stringify(result?.article ?? {}).includes(${JSON.stringify(marker)});
        return result;
      } catch (error) { event.error = String(error?.message ?? error); throw error; }
    };
    return { installed: true };
  })()`,
  );
  assert.equal(state?.installed, true, 'capture_traffic_observer_not_installed');
}
async function removeTrafficObserver(panel) {
  await evaluate(
    panel,
    `(() => {
    if (globalThis.__t40CaptureOriginal) chrome.tabs.sendMessage = globalThis.__t40CaptureOriginal;
    delete globalThis.__t40CaptureOriginal;
    delete globalThis.__t40CaptureCalls;
    return true;
  })()`,
  );
}

const report = {
  schema_version: 1,
  case_id: 'EXT-F-1003-T40',
  role: 'guest',
  scope: 'real hosted native side panel and owned unique-marker page',
  status: 'unverified',
  criteria: [],
  build: null,
};
function record(name, status, evidence) {
  report.criteria.push({ name, status, evidence });
}
try {
  assert.ok(RECEIPT_PATH, 'settings_dev_receipt_required');
  const receipt = JSON.parse(await readFile(RECEIPT_PATH, 'utf8'));
  requireLocalDevReceipt(receipt, EXTENSION_DIR);
  report.build = {
    sourceSha: receipt.sourceSha,
    version: receipt.version,
    treeSha256: receipt.treeSha256,
    developmentRunId: receipt.runId,
    developmentArtifactId: receipt.artifactId,
  };
  const result = await runNativeSidepanelQa({
    extensionDir: EXTENSION_DIR,
    expectedRelease: { version: receipt.version, treeSha256: receipt.treeSha256 },
    localDevReceiptPath: RECEIPT_PATH,
    ownedPages: {
      [PAGE_ON]: `<html><title>Harbor Dental intake</title><article><h1>${MARKER_ON}</h1><p>Appointments begin at eight in the morning.</p></article></html>`,
      [PAGE_OFF]: `<html><title>Harbor Dental followup</title><article><h1>${MARKER_OFF}</h1><p>Appointments begin at nine in the morning.</p></article></html>`,
    },
    exercisePanel: async ({
      page,
      panel,
      reloadExtension,
      acquireLivePanel,
      transportFailureClass,
    }) => {
      let activePanel = panel;
      await settings(activePanel);
      const baseline = await observe(activePanel);
      assert.equal(baseline.visible, false, 'auto_scrape_original_off_baseline_required');
      assert.ok(
        baseline.stored === false ||
          (baseline.stored === null && baseline.settingPresent === false),
        'auto_scrape_original_off_storage_required',
      );
      let observerInstalled = false;
      await preserveFailureDuringCleanup(
        async () => {
          await installTrafficObserver(activePanel, MARKER_ON);
          observerInstalled = true;
          await page.goto(new URL(PAGE_ON, page.url()).href);
          await page.waitForLoadState('load');
          await setSwitch(activePanel, true);
          const on = await waitFor(
            'auto_scrape_on_capture_result',
            async () => ({
              ...(await observe(activePanel)),
              pageUrl: page.url(),
            }),
            (state) => state.calls.length > 0 && state.calls.every((call) => call.ok && call.url),
            12000,
          );
          assertCaptureOn(on, MARKER_ON);
          record('ON emits one real capture with the page marker', 'pass', on);
          await setSwitch(activePanel, false);
          await evaluate(activePanel, 'globalThis.__t40CaptureCalls = []; true');
          await page.goto(new URL(PAGE_OFF, page.url()).href);
          await page.waitForLoadState('load');
          const offStart = Date.now();
          await waitFor(
            'auto_scrape_off_observation_window',
            () => Date.now() - offStart,
            (elapsed) => elapsed >= 3000,
            4000,
          );
          const off = {
            ...(await observe(activePanel)),
            pageLoaded: true,
            windowCompleted: true,
            pageUrl: page.url(),
          };
          assertCaptureOff(off);
          record('OFF emits no capture after the loaded page settles', 'pass', off);

          activePanel = await runGuestChoicesAcrossExtensionRestarts({
            panel: activePanel,
            section: 'Scrape',
            controlLabel: 'Auto-scrape on load',
            controlKind: 'switch',
            choices: [
              [false, 'Off'],
              [true, 'On'],
            ],
            baseline: { value: false, label: 'Off' },
            settings,
            openSection,
            read: observe,
            matches: autoScrapePreferenceMatches,
            reloadExtension,
            acquireLivePanel,
            transportFailureClass,
            safeStages: ['extension_reload', 'restore_panel', 'restore_extension_reload'],
            onPanelChanged: (target) => {
              activePanel = target;
            },
            record,
            afterReload: async ({ panel: target, value }) => {
              const marker = value ? MARKER_ON : MARKER_OFF;
              const path = value ? PAGE_ON : PAGE_OFF;
              await installTrafficObserver(target, marker);
              await evaluate(target, 'globalThis.__t40CaptureCalls = []; true');
              await page.goto(new URL(path, page.url()).href);
              await page.waitForLoadState('load');
              if (value) {
                const reloadedOn = await waitFor(
                  'auto_scrape_reloaded_on_capture_result',
                  async () => ({
                    ...(await observe(target)),
                    pageUrl: page.url(),
                  }),
                  (state) =>
                    state.calls.length > 0 && state.calls.every((call) => call.ok && call.url),
                  12000,
                );
                assertCaptureOn(reloadedOn, MARKER_ON);
                record(
                  'ON survives full extension reload and emits one real capture',
                  'pass',
                  reloadedOn,
                );
              } else {
                const offStart = Date.now();
                await waitFor(
                  'auto_scrape_reloaded_off_observation_window',
                  () => Date.now() - offStart,
                  (elapsed) => elapsed >= RELOAD_OFF_MS,
                  RELOAD_OFF_MS + 1000,
                );
                const reloadedOff = {
                  ...(await observe(target)),
                  pageLoaded: true,
                  windowCompleted: true,
                  pageUrl: page.url(),
                };
                assertCaptureOff(reloadedOff);
                record(
                  'OFF survives full extension reload with zero capture calls',
                  'pass',
                  reloadedOff,
                );
              }
            },
          });
        },
        async () => {
          let cleanupFailed = false;
          try {
            await setSwitch(activePanel, false);
            await evaluate(
              activePanel,
              `(${restoreAutoScrapeBaseline.toString()})(chrome.storage.local, ${JSON.stringify(baseline)})`,
            );
            const restored = await observe(activePanel);
            assert.equal(restored.visible, false, 'auto_scrape_restore_ui_failed');
            assert.equal(restored.stored, baseline.stored, 'auto_scrape_restore_storage_failed');
            assert.equal(
              restored.storagePresent,
              baseline.storagePresent,
              'auto_scrape_restore_key_presence_failed',
            );
            assert.equal(
              restored.settingPresent,
              baseline.settingPresent,
              'auto_scrape_restore_field_presence_failed',
            );
            record('Original OFF baseline restored in UI and chrome.storage', 'pass', {
              visible: restored.visible,
              stored: restored.stored,
            });
          } catch {
            cleanupFailed = true;
          }
          if (observerInstalled) {
            try {
              await removeTrafficObserver(activePanel);
            } catch {
              cleanupFailed = true;
            }
          }
          if (cleanupFailed) throw new Error('settings_probe_cleanup_failed');
        },
      );
    },
  });
  assert.equal(result.verified, true);
  assert.equal(hashReleaseTree(EXTENSION_DIR), receipt.treeSha256, 'frozen_artifact_changed');
  report.artifacts = result.artifacts;
  report.status = 'pass';
} catch (error) {
  const reloadFailure = serializeGuestReloadFailure(error);
  if (reloadFailure) {
    report.error = reloadFailure.category;
    report.reload_failure = reloadFailure;
    record('native capture probe completed', 'fail', report.reload_failure);
  } else {
    report.error = String(error?.message ?? error);
    record('native capture probe completed', 'fail', report.error);
  }
  report.status = 'fail';
  process.exitCode = 1;
} finally {
  await mkdir(join(REPO, 'test-results'), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(`${report.status.toUpperCase()} settings-auto-scrape-capture: ${OUTPUT}`);
}
