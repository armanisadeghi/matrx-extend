#!/usr/bin/env node
/** Real guest capture-permission denial and recovery on an owned HTTP page. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { probeEffectiveHostAccess } from './scrape-effective-host-access-probe.mjs';
import { assertGuestScrapeRecoveryEvidence } from './scrape-error-recovery-guest-oracle.mjs';
import {
  observeRecoveryPreflight,
  runAfterEffectiveHostDenial,
  waitForRecoveryOutcome,
  withRecoveryHostAccessCleanup,
} from './scrape-recovery-failure-diagnostic.mjs';
import { readSiteRestriction, setSiteRestriction } from './scrape-site-restriction.mjs';
import { click, evaluate, waitFor } from './settings-panel-driver.mjs';

const REPO = resolve(import.meta.dirname, '../..');
const extensionDir = process.env.MATRX_SCRAPE_EXTENSION_DIR;
const receiptPath = process.env.MATRX_SCRAPE_RECEIPT;
const outputPath = join(REPO, 'test-results', 'scrape-error-recovery-guest-native.json');
const marker = 'T14 deep retry restored the lazy clinic checklist.';
const pageHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>T14 recovery fixture</title></head>
<body><main><article><h1>T14 recovery fixture</h1><p>This owned page contains a real long-scroll capture fixture.</p>
${Array.from({ length: 18 }, (_, index) => `<p>Preparation step ${index + 1}: review the appointment documents.</p>`).join('')}
<div style="height:1600px"></div><section id="late"></section></article></main>
<script>addEventListener('scroll',()=>{if(scrollY>250&&!document.querySelector('#late p'))document.querySelector('#late').innerHTML='<h2>Lazy checklist</h2><p>${marker}</p>'})</script></body></html>`;

const report = {
  schema_version: 1,
  feature_id: 'EXT-F-1007',
  case_id: 'EXT-F-1007-T14',
  auth_mode: 'guest',
  status: 'unverified',
  stage: 'inputs',
  native_stage: null,
  artifact: null,
  observations: null,
  failure_code: null,
  failure_diagnostic: null,
  limits:
    'Non-default Chrome ExtensionsMenuAccessControl feature enabled in the isolated test profile; not default-Chrome or Store acceptance. Bounded guest host-permission denial, Try again, deep-mode preservation, and Dismiss only. Reload page remains unverified because the real second-no-receiver-after-injection condition is a runtime/manifest fault, while a genuine permission denial offers Try again only.',
};

function safeFailureCode(error) {
  const candidate = String(error?.message ?? 'scrape_recovery_native_error').split(/[:\n]/, 1)[0];
  return /^[a-z][a-z0-9_-]{1,100}$/.test(candidate) ? candidate : 'scrape_recovery_native_error';
}

async function writeReport() {
  await mkdir(join(REPO, 'test-results'), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

async function readHostAccess(detailsPage, extensionId) {
  return detailsPage.evaluate(async (id) => {
    const api = chrome.developerPrivate;
    if (!api?.getExtensionsInfo) throw new Error('scrape_recovery_chrome_site_access_api_missing');
    const info = await api.getExtensionsInfo({ includeDisabled: true, includeTerminated: true });
    const hostAccess = info.find((entry) => entry.id === id)?.permissions?.runtimeHostPermissions
      ?.hostAccess;
    if (!hostAccess) throw new Error('scrape_recovery_host_access_state_missing');
    return hostAccess;
  }, extensionId);
}

async function withSiteSettings(page, extensionId, action) {
  const details = await page.context().newPage();
  try {
    await details.goto(`chrome://extensions/?id=${extensionId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    return await action(details);
  } finally {
    await details.close().catch(() => {});
    await page.bringToFront().catch(() => {});
  }
}

async function getHostAccess(page, extensionId) {
  return withSiteSettings(page, extensionId, (details) => readHostAccess(details, extensionId));
}

async function recoveryState(panel) {
  return evaluate(
    panel,
    `(() => {
    const tab = [...document.querySelectorAll('button[role="tab"][title="Scrape"]')]
      .filter((node) => node.getAttribute('data-state') === 'active');
    const pane = tab.length === 1 ? document.getElementById(tab[0].getAttribute('aria-controls')) : null;
    const scrapePaneActive = Boolean(pane?.matches('[role="tabpanel"][data-state="active"]'));
    if (!scrapePaneActive) return { ready: false, scrapeTabActive: tab.length === 1, scrapePaneActive };
    const buttons = [...pane.querySelectorAll('button')];
    const articleTab = [...pane.querySelectorAll('[role="tablist"] [role="tab"]')]
      .find((node) => node.firstChild?.textContent?.trim() === 'Article');
    const article = articleTab ? document.getElementById(articleTab.getAttribute('aria-controls')) : null;
    const deepButton = buttons.find((node) => (node.getAttribute('title') ?? node.getAttribute('data-matrx-title') ?? '').startsWith('Scroll the page top'));
    const resultText = article?.getAttribute('data-state') === 'active' ? article.innerText : null;
    return {
      ready: true,
      scrapeTabActive: true,
      scrapePaneActive: true,
      error: buttons.some((node) => node.getAttribute('aria-label') === 'Dismiss'),
      permissionMessage: pane.textContent.includes('No permission for this page'),
      tryAgain: buttons.filter((node) => node.textContent.trim() === 'Try again').length,
      reloadPage: buttons.filter((node) => node.textContent.trim() === 'Reload page').length,
      deepTitles: buttons.filter((node) => (node.getAttribute('title') ?? node.getAttribute('data-matrx-title') ?? '').startsWith('Scroll the page top'))
        .map((node) => node.getAttribute('title') ?? node.getAttribute('data-matrx-title')),
      deepCaptureInProgress: Boolean(deepButton && /^Scrolling/.test(deepButton.textContent.trim())),
      deepScrollProgressPresent: Boolean(deepButton && /^Scrolling\\s+\\d+\\/\\d+/.test(deepButton.textContent.trim())),
      resultPresent: Boolean(resultText?.trim()),
      resultText,
      fixtureTitle: pane.querySelector('.truncate.text-sm.font-medium')?.textContent?.trim() ?? null,
    };
  })()`,
  );
}

async function run() {
  assert.equal(
    process.env.MATRX_SCRAPE_ARTIFACT_CHANNEL,
    'development',
    'scrape_recovery_development_artifact_required',
  );
  assert.equal(process.env.MATRX_SCRAPE_AUTH_MODE, 'guest', 'scrape_recovery_guest_auth_required');
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  assert.equal(receipt.kind, 'local_dev_unpacked', 'scrape_recovery_ci_receipt_required');
  assert.equal(
    hashReleaseTree(extensionDir),
    receipt.treeSha256,
    'scrape_recovery_artifact_tree_mismatch',
  );
  const manifest = JSON.parse(await readFile(join(extensionDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, receipt.version, 'scrape_recovery_artifact_version_mismatch');
  assert.match(process.env.MATRX_SCRAPE_CI_SOURCE_SHA ?? '', /^[a-f0-9]{40}$/);
  assert.match(process.env.MATRX_SCRAPE_CI_RUN_ID ?? '', /^[1-9][0-9]*$/);
  assert.match(process.env.MATRX_SCRAPE_CI_ARTIFACT_ID ?? '', /^[1-9][0-9]*$/);
  report.artifact = {
    kind: 'ci_development_test',
    source_sha: process.env.MATRX_SCRAPE_CI_SOURCE_SHA,
    run_id: Number(process.env.MATRX_SCRAPE_CI_RUN_ID),
    artifact_id: Number(process.env.MATRX_SCRAPE_CI_ARTIFACT_ID),
    version: receipt.version,
    tree_sha256: receipt.treeSha256,
  };

  try {
    await runNativeSidepanelQa({
      headed: true,
      enableUserSiteRestrictions: true,
      extensionDir,
      localDevReceiptPath: receiptPath,
      expectedRelease: receipt,
      artifactRoot: join(process.env.RUNNER_TEMP ?? '/tmp', 'guest-acceptance'),
      ownedPages: { '/capture-recovery': pageHtml },
      onStage: (stage) => {
        report.native_stage = stage;
      },
      exercisePanel: async ({
        page,
        panel,
        browserSession,
        requireResourceHealth,
        resourceAction,
        transportFailureClass,
      }) => {
        const commandLine = await browserSession.send('Browser.getBrowserCommandLine');
        assert.ok(
          commandLine.arguments?.includes('--enable-features=ExtensionsMenuAccessControl'),
          'scrape_recovery_site_restriction_feature_missing',
        );
        const extensionId = await evaluate(panel, 'chrome.runtime.id');
        assert.match(extensionId ?? '', /^[a-p]{32}$/, 'scrape_recovery_extension_id_missing');
        const url = new URL(page.url());
        url.pathname = '/capture-recovery';
        url.search = '';
        url.hash = '';
        await resourceAction(() => page.goto(url.href, { waitUntil: 'domcontentloaded' }));
        await resourceAction(() => click(panel, 'title', 'Scrape'));
        await waitFor(
          'scrape_recovery_panel_ready',
          () => recoveryState(panel),
          (state) => state?.ready,
        );

        report.observations = {
          case_id: 'EXT-F-1007-T14',
          auth_mode: 'guest',
          requested_mode: 'deep',
          browser_configuration: {
            enabled_feature: 'ExtensionsMenuAccessControl',
            flag_observed: true,
            default_chrome: false,
          },
          access_probes: [],
          denial: null,
          retry: null,
          dismiss: null,
          cleanup: null,
          reload_page: 'unverified',
        };
        const originalHostAccess = await resourceAction(() => getHostAccess(page, extensionId));
        assert.equal(
          originalHostAccess,
          'ON_ALL_SITES',
          'scrape_recovery_profile_not_initially_all_sites',
        );
        const originalSiteSetting = await resourceAction(() =>
          withSiteSettings(page, extensionId, (details) =>
            readSiteRestriction(details, url.origin),
          ),
        );
        assert.deepEqual(
          originalSiteSetting,
          { restricted: false, permitted: false },
          'scrape_recovery_fixture_site_not_neutral',
        );
        let siteMutationAttempted = false;
        const setRestriction = (restricted, expectedBefore) =>
          resourceAction(() =>
            withSiteSettings(page, extensionId, (details) =>
              setSiteRestriction(details, url.origin, restricted, expectedBefore, () => {
                siteMutationAttempted = true;
              }),
            ),
          );
        const restoreHostAccess = async () => {
          const restored = siteMutationAttempted
            ? await setRestriction(false, null)
            : originalSiteSetting;
          const hostAccess = await resourceAction(() => getHostAccess(page, extensionId));
          report.observations.cleanup = {
            original_host_access: originalHostAccess,
            host_access: hostAccess,
            original_site_restricted: originalSiteSetting.restricted,
            site_restricted: restored.restricted,
            site_permitted: restored.permitted,
            restored:
              hostAccess === originalHostAccess && !restored.restricted && !restored.permitted,
          };
        };
        const probe = (round) =>
          probeEffectiveHostAccess(panel, browserSession.timeoutMs, {
            expectedUrl: url.href,
            onObservation: (value) => {
              report.observations.access_probes.push({ round, ...value });
              if (value.access === 'unknown') report.failure_diagnostic = value;
            },
          });
        let restorationError;
        const exerciseDenialAndRecovery = async () => {
          const deny = await setRestriction(true, false);
          await resourceAction(() => page.reload({ waitUntil: 'domcontentloaded' }));
          await waitFor(
            'scrape_recovery_fixture_reloaded',
            () => page.url(),
            (value) => value === url.href,
          );
          const reloadType = await page.evaluate(
            () => performance.getEntriesByType('navigation')[0]?.type ?? null,
          );
          assert.equal(reloadType, 'reload', 'scrape_recovery_denied_page_reload_missing');
          await resourceAction(() => page.bringToFront());
          const preflight = (operation, read) =>
            observeRecoveryPreflight(
              {
                operation,
                originTransitionCompleted: false,
                transportFailureClass,
                onFailure: (value) => {
                  report.failure_diagnostic = value;
                },
              },
              read,
            );
          let state = await preflight('panel_readiness', () => recoveryState(panel));
          assert.equal(state.ready, true, 'scrape_recovery_panel_lost_after_fixture_reload');
          assert.equal(state.deepTitles.length, 1, 'scrape_recovery_deep_control_not_unique');
          const denialStart = await runAfterEffectiveHostDenial(
            () => preflight('effective_host_access', () => probe('denial')),
            () => resourceAction(() => click(panel, 'title', state.deepTitles[0])),
          );
          const effectiveAccess = denialStart.access;
          state = await waitForRecoveryOutcome({
            readState: () => recoveryState(panel),
            readObservedHostAccess: () => getHostAccess(page, extensionId),
            onFailure: (value) => {
              report.failure_diagnostic = value;
            },
          });
          if (!state.error)
            throw new Error(
              'scrape_recovery_fixture_permission_not_denied_active_tab_or_host_access',
            );
          if (state.tryAgain !== 1)
            throw new Error('scrape_recovery_permission_error_missing_try_again_control');
          assert.equal(state.reloadPage, 0, 'scrape_recovery_permission_error_offered_reload');
          assert.equal(
            state.resultText?.includes(marker) ?? false,
            false,
            'scrape_recovery_marker_present_before_retry',
          );
          report.observations.denial = {
            host_access: originalHostAccess,
            site_restricted: deny.restricted,
            effective_injection_access: effectiveAccess,
            page_reloaded_without_access: reloadType === 'reload',
            error_visible: state.error,
            permission_message_visible: state.permissionMessage,
            try_again_visible: state.tryAgain === 1,
            reload_visible: state.reloadPage === 1,
          };

          const grant = await setRestriction(false, true);
          assert.equal(
            await probe('retry'),
            'available',
            'scrape_recovery_retry_access_not_available',
          );
          await resourceAction(() => click(panel, 'button-text', 'Try again'));
          state = await waitFor(
            'scrape_recovery_deep_retry_result',
            () => recoveryState(panel),
            (value) => value?.ready && !value.error && value.resultText?.includes(marker),
          );
          report.observations.retry = {
            host_access: originalHostAccess,
            site_restricted: grant.restricted,
            clicked: true,
            error_cleared: !state.error,
            deep_only_marker_visible: state.resultText.includes(marker),
          };

          const secondDenial = await setRestriction(true, false);
          await resourceAction(() => page.reload({ waitUntil: 'domcontentloaded' }));
          await waitFor(
            'scrape_recovery_dismiss_fixture_ready',
            () => page.url(),
            (value) => value === url.href,
          );
          await resourceAction(() => page.bringToFront());
          state = await recoveryState(panel);
          assert.equal(
            state.deepTitles.length,
            1,
            'scrape_recovery_dismiss_deep_control_not_unique',
          );
          const dismissalStart = await runAfterEffectiveHostDenial(
            () => probe('dismiss'),
            () => resourceAction(() => click(panel, 'title', state.deepTitles[0])),
          );
          state = await waitFor(
            'scrape_recovery_dismiss_error',
            () => recoveryState(panel),
            (value) => value?.error && value.tryAgain === 1,
          );
          const dismissError = state;
          await resourceAction(() => click(panel, 'scrape-dismiss', 'Dismiss'));
          state = await waitFor(
            'scrape_recovery_dismiss_cleared',
            () => recoveryState(panel),
            (value) => value?.ready && !value.error,
          );
          report.observations.dismiss = {
            host_access: originalHostAccess,
            site_restricted: secondDenial.restricted,
            effective_injection_access: dismissalStart.access,
            error_visible: true,
            permission_message_visible: dismissError.permissionMessage,
            clicked: true,
            error_cleared: !state.error,
          };
          await requireResourceHealth();
        };
        const cleanupHostAccess = async () => {
          try {
            await restoreHostAccess();
          } catch (error) {
            report.observations.cleanup = {
              original_host_access: originalHostAccess,
              host_access: 'unknown',
              restored: false,
            };
            report.cleanup_failure_code = safeFailureCode(error);
            restorationError = error;
          }
        };
        await withRecoveryHostAccessCleanup(exerciseDenialAndRecovery, cleanupHostAccess);
        if (restorationError) throw restorationError;
      },
    });
    report.result = assertGuestScrapeRecoveryEvidence(report.observations);
    report.status = 'partial';
  } catch (error) {
    report.failure_code = safeFailureCode(error);
    report.status = 'unverified';
    throw error;
  } finally {
    await writeReport();
  }
}

run().catch((error) => {
  process.stderr.write(`SCRAPE_RECOVERY_NATIVE_FAILURE ${safeFailureCode(error)}\n`);
  process.exitCode = 1;
});
