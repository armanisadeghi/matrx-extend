#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { verifyFrozenArtifactIdentity } from '../../scripts/frozen-artifact-identity.mjs';
import { requireLocalDevReceipt } from '../../scripts/record-local-dev-build.mjs';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { captureFailure } from './profile-reload-capture.mjs';
import {
  FULL_EXTENSION_RECHECK_IDS,
  captureGuestPreferenceBaselines,
  enforceFullExtensionRechecks,
  initializeFullExtensionRechecks,
  rerunGuestSettingsAfterExtensionReload,
  snapshotPanelDocumentReload,
} from './settings-full-extension-rechecks.mjs';
import {
  GUEST_PREFERENCES,
  observeGuestNewChatDefault,
  observeGuestPreference,
  preferenceBaseline,
  preferenceMatches,
  runGuestPreferenceCase,
} from './settings-guest-preference-batch.mjs';
import {
  GUEST_PRIVACY_SWITCHES,
  runGuestPrivacySwitchCase,
} from './settings-guest-privacy-batch.mjs';
import {
  runGuestAutoScrapeCase,
  runGuestAutoScrapeModeCase,
  runGuestSectionsCase,
} from './settings-guest-scrape-controls.mjs';
import { runGuestAskAgainCase } from './settings-guest-unrecorded-cases.mjs';
import {
  activeTabPanelExpression,
  click,
  evaluate,
  guestSettingsChecks,
  guestSettingsState,
  openSection,
  waitFor,
  waitForReplacementSettingsTab,
} from './settings-panel-driver.mjs';
import {
  classifyReloadSettingsFailure,
  observeReloadSettingsPanel,
  observeSettingsReacquisition,
} from './settings-reload-boundary.mjs';

// Runs against a receipt-verified, disposable Chrome profile and its real native panel.
// UI actions use trusted CDP pointer/keyboard input; DOM and Chrome API reads are evidence only.
const REPO = resolve(import.meta.dirname, '..', '..');
const OUTPUT = join(REPO, 'test-results', 'settings-local-controls-acceptance.json');
const DEV_EXTENSION_DIR = process.env.SETTINGS_DEV_EXTENSION_DIR
  ? resolve(process.env.SETTINGS_DEV_EXTENSION_DIR)
  : join(REPO, '.output', 'chrome-mv3-dev');
const DEV_BUILD_RECEIPT = process.env.SETTINGS_DEV_BUILD_RECEIPT;
const EXTENSION_ID = 'cihdmkcdjjckfhjpgoedmgfpoljebaml';
const CASE_PORT = 65001;
const IDS = [
  'T04',
  'T10',
  'T13',
  'T16',
  'T19',
  'T22',
  'T28',
  'T31',
  'T34',
  'T37',
  'T40',
  'T46',
  'T63',
  'T64',
  'T67',
  'T70',
  'T73',
  'T76',
  'T92',
].map((id) => `EXT-F-1003-${id}`);
const report = {
  schema_version: 1,
  scope: 'real isolated Chrome-for-Testing native side panel; signed-out guest',
  build: { extensionId: EXTENSION_ID },
  preconditions: [
    'Owned disposable profile',
    'Extension receipt and tree hash verified',
    'Guest panel settled before interaction',
  ],
  cases: IDS.map((id) => ({
    id,
    role: 'guest',
    ...((id.endsWith('T92') || id.endsWith('T63')) && { scope: 'guest-negative-access-only' }),
    status: 'unverified',
    steps: [],
    criteria: [],
  })),
};
const byId = (suffix) => report.cases.find((c) => c.id.endsWith(suffix));
const criterion = (c, name, status, evidence) => c.criteria.push({ name, status, evidence });
initializeFullExtensionRechecks(report.cases);

async function startObservedDeadPort() {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method, path: request.url, observedAt: Date.now() });
    // This is an intentionally dead engine port. It records the real worker
    // probe without supplying a fabricated desktop health response.
    response
      .writeHead(503, { 'content-type': 'text/plain', 'cache-control': 'no-store' })
      .end('No desktop engine here');
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(CASE_PORT, '127.0.0.1', () => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('observed_port_address_missing');
  assert.equal(address.port, CASE_PORT, 'T46 fixture must observe the specified port 65001');
  return {
    port: address.port,
    requests,
    close: () => new Promise((resolveClose) => server.close(resolveClose)),
  };
}

async function settings(panel, onStep = () => {}) {
  onStep('settings_tab_wait_started');
  await waitForReplacementSettingsTab(panel);
  onStep('before_click');
  await click(panel, 'title', 'Settings');
  onStep('click_returned');
  onStep('guest_wait_started');
  await waitFor(
    'guest_settings',
    () =>
      evaluate(
        panel,
        `(() => {
    const text = document.body?.innerText ?? '';
    return { active: !!document.querySelector('button[title="Settings"][data-state="active"]'),
      guest: text.includes("You're using Matrx as a guest.") || text.includes('Sign in to choose') };
  })()`,
      ),
    (s) => s?.active && s.guest,
  );
}

async function reloadSettings(panel) {
  try {
    await panel.send('Page.reload', { ignoreCache: true });
    await waitFor(
      'guest_panel_after_reload',
      () =>
        evaluate(
          panel,
          `(() => {
    const text = document.body?.innerText ?? '';
    return document.readyState === 'complete' && text.includes("You're using Matrx as a guest.");
  })()`,
        ),
      (v) => v === true,
    );
    await settings(panel);
  } catch (error) {
    error.reacquireDiagnostic = {
      beforeTargetObserved: false,
      ...(await observeSettingsReacquisition(panel, EXTENSION_ID)),
    };
    throw error;
  }
}

async function guestSections(panel) {
  return evaluate(
    panel,
    `(() => {
    const pane = ${activeTabPanelExpression('Settings')};
    const text = pane?.innerText ?? '';
    return { active: !!pane,
      sections: [...(pane?.querySelectorAll('button[aria-expanded]') ?? [])].map((b) => b.textContent.trim()),
      advancedText: text.includes('Advanced agent capabilities'),
      adminControls: ['Audit key', 'Permission gate'].filter((s) => text.includes(s)),
      permissionControlCount: pane?.querySelectorAll('[aria-label="DevTools Protocol permission"]').length ?? 0 };
  })()`,
  );
}

async function deepClean(panel) {
  return evaluate(
    panel,
    `(() => {
    const s = document.querySelector('[role="switch"][aria-label="Deep clean"]');
    const row = s?.parentElement?.parentElement;
    return { count: document.querySelectorAll('[role="switch"][aria-label="Deep clean"]').length,
      checked: s?.getAttribute('aria-checked') ?? null,
      hint: row?.textContent ?? null };
  })()`,
  );
}

async function port(panel) {
  return evaluate(
    panel,
    `(async () => {
    const input = document.querySelector('input[placeholder="auto"]');
    const local = await chrome.storage.local.get('matrxLocalEnginePortOverride');
    const row = input?.parentElement;
    return { value: input?.value ?? null,
      saved: local.matrxLocalEnginePortOverride ?? null,
      button: [...(row?.querySelectorAll('button') ?? [])].map((b) => b.textContent.trim()),
      override: row?.textContent.includes('override') ?? false,
      error: row?.nextElementSibling?.textContent.trim() ?? null };
  })()`,
  );
}

async function observeWorkerRediscover(worker) {
  const scripts = [];
  const pauses = [];
  const resumes = [];
  let saveStartedAt = null;
  const offScript = worker.on('Debugger.scriptParsed', (event) => {
    if (event.url.endsWith('/background.js')) scripts.push(event.scriptId);
  });
  const offPaused = worker.on('Debugger.paused', (event) => {
    pauses.push({
      reason: event.reason,
      hitBreakpoints: event.hitBreakpoints ?? [],
      callFrames:
        event.callFrames?.slice(0, 3).map((frame) => ({
          functionName: frame.functionName,
          url: frame.url,
          location: frame.location,
        })) ?? [],
      observedAt: Date.now(),
    });
    // Record settlement, not just the pause: a delayed resume rejection must
    // never race the acceptance verdict. The event emitter cannot await us.
    resumes.push(
      worker.send('Debugger.resume').then(
        () => null,
        (error) => String(error?.message ?? error),
      ),
    );
  });
  try {
    await worker.send('Debugger.enable');
    const scriptId = await waitFor(
      'owned_worker_background_script',
      () => scripts.at(-1) ?? null,
      (value) => typeof value === 'string',
    );
    const { scriptSource } = await worker.send('Debugger.getScriptSource', { scriptId });
    const matches = [
      ...scriptSource.matchAll(/\.DESKTOP_REDISCOVER\s*,\s*async\s*\(\)\s*=>\s*\{/g),
    ];
    assert.equal(
      matches.length,
      1,
      'released worker must contain exactly one desktop rediscovery handler',
    );
    const entryOffset = matches[0].index + matches[0][0].length;
    const completionMatch = scriptSource
      .slice(entryOffset, entryOffset + 400)
      .match(/[A-Za-z_$][\w$]*\([A-Za-z_$][\w$]*\.DESKTOP_AVAILABILITY\s*,/);
    assert.ok(
      completionMatch,
      'released worker handler must broadcast availability after its probe',
    );
    const completionOffset = entryOffset + completionMatch.index;
    const setAt = async (offset, label) => {
      const prefix = scriptSource.slice(0, offset);
      const lineNumber = prefix.split('\n').length - 1;
      const columnNumber = prefix.length - prefix.lastIndexOf('\n') - 1;
      const { breakpointId, actualLocation } = await worker.send('Debugger.setBreakpoint', {
        location: { scriptId, lineNumber, columnNumber },
      });
      assert.equal(typeof breakpointId, 'string', `${label} breakpoint must install`);
      assert.equal(
        actualLocation?.scriptId,
        scriptId,
        `${label} breakpoint must resolve in owned worker`,
      );
      assert.equal(
        actualLocation.lineNumber === lineNumber &&
          actualLocation.columnNumber >= columnNumber &&
          actualLocation.columnNumber < columnNumber + 32,
        true,
        `${label} breakpoint must resolve at intended handler statement`,
      );
      return breakpointId;
    };
    const entryBreakpoint = await setAt(entryOffset, 'rediscovery entry');
    const completionBreakpoint = await setAt(completionOffset, 'post-probe availability');
    return {
      armForSave() {
        assert.equal(saveStartedAt, null, 'rediscovery observer may cover only one Save');
        assert.equal(pauses.length, 0, 'no rediscovery may precede the trusted Save');
        saveStartedAt = Date.now();
      },
      async read() {
        const observed = [...pauses];
        const resumeResults = await Promise.all(resumes.slice(0, observed.length));
        return {
          saveStartedAt,
          pauses: observed,
          entryBreakpoint,
          completionBreakpoint,
          resumeError: resumeResults.find((error) => error !== null) ?? null,
        };
      },
      async close() {
        try {
          const resumeResults = await Promise.all(resumes);
          await worker.send('Debugger.disable');
          assert.deepEqual(
            resumeResults.filter((error) => error !== null),
            [],
            'every observed worker pause must resume successfully',
          );
        } finally {
          offPaused();
          offScript();
        }
      },
    };
  } catch (error) {
    offPaused();
    offScript();
    await worker.send('Debugger.disable').catch(() => {});
    throw error;
  }
}

async function portSelection(panel) {
  return evaluate(
    panel,
    `(() => {
    const input = document.querySelector('input[placeholder="auto"]');
    return input && { value: input.value, start: input.selectionStart,
      end: input.selectionEnd, focused: document.activeElement === input };
  })()`,
  );
}

async function replacePort(panel, value, beforeSave = () => {}) {
  await click(panel, 'port', 'Local engine port');
  const initial = await portSelection(panel);
  assert.equal(initial?.focused, true, 'real pointer must focus port input');
  if (initial.value) {
    // Chromium's CDP test requires the selectAll editing command for an
    // emulated Meta+A on macOS. Observe the result before any deletion.
    const modifiers = process.platform === 'darwin' ? 4 : 2;
    await panel.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'a',
      code: 'KeyA',
      modifiers,
      windowsVirtualKeyCode: 65,
      commands: ['selectAll'],
    });
    await panel.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'a',
      code: 'KeyA',
      modifiers,
      windowsVirtualKeyCode: 65,
    });
    const selection = await portSelection(panel);
    assert.equal(
      selection?.focused && selection.start === 0 && selection.end === initial.value.length,
      true,
      `trusted select-all did not cover port input: ${JSON.stringify(selection)}`,
    );
    await panel.send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key: 'Backspace',
      code: 'Backspace',
      windowsVirtualKeyCode: 8,
    });
    await panel.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Backspace',
      code: 'Backspace',
      windowsVirtualKeyCode: 8,
    });
    await waitFor(
      'port_input_cleared_by_keyboard',
      () => portSelection(panel),
      (s) => s?.value === '' && s.focused,
    );
  }
  if (value) await panel.send('Input.insertText', { text: value });
  await waitFor(
    'port_input',
    () => port(panel),
    (s) => s?.value === value,
  );
  const saveLabel = (await port(panel)).button.includes('Save') ? 'Save' : 'Set';
  beforeSave();
  await click(panel, 'button', saveLabel);
}

async function about(panel) {
  return evaluate(
    panel,
    `(() => {
    const value = (label) => {
      const span = [...document.querySelectorAll('span')].find((s) => s.textContent.trim() === label);
      return span?.parentElement?.lastElementChild?.textContent.trim() ?? null;
    };
    const text = document.body?.innerText ?? '';
    return { browser: value('Browser'), version: value('Installed version'),
      extensionId: value('Extension ID'), readiness: value('Browser APIs for saved logins'),
      expectedBrowser: navigator.userAgent.includes('Edg/') ? 'Microsoft Edge' :
        navigator.userAgent.includes('OPR/') ? 'Opera' : navigator.userAgent.includes('Chrome/') ? 'Chrome' : 'This browser',
      manifestVersion: chrome.runtime.getManifest().version, runtimeId: chrome.runtime.id,
      passwordApis: typeof chrome.runtime.sendMessage === 'function' &&
        typeof chrome.tabs?.get === 'function' && typeof chrome.scripting?.executeScript === 'function' &&
        typeof chrome.storage?.local?.get === 'function',
      updateApi: typeof chrome.runtime.requestUpdateCheck === 'function',
      hasUpdateButton: [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Check for extension update'),
      updateText: text.match(/Your browser did not find an update right now\.|Version [^\\n]+ is available\.|An update is available\.|Your browser limited update checks\.|Could not check right now\./)?.[0] ?? null,
      browserManaged: text.includes('Updates are managed by your browser. Open its Extensions page'),
      unavailableRemedy: text.includes('Reload or reinstall Matrx Extend in a supported browser') };
  })()`,
  );
}

async function observeGuestIdentityAndOrganization(panel) {
  let organizationRequests = 0;
  const off = panel.on('Network.requestWillBeSent', ({ request }) => {
    try {
      const path = new URL(request?.url).pathname;
      if (
        path === '/rest/v1/rpc/mbr_for_user' ||
        path === '/rest/v1/organizations' ||
        path === '/rest/v1/user_preferences'
      )
        organizationRequests++;
    } catch {
      // Unknown traffic is not copied into a receipt.
    }
  });
  try {
    await panel.send('Network.enable');
    await openSection(panel, 'Account');
    await openSection(panel, 'Organization');
    await new Promise((resolveWait) => setTimeout(resolveWait, 300));
    const state = await guestSettingsState(panel);
    return { state, organizationRequests };
  } finally {
    off();
    await panel.send('Network.disable').catch(() => {});
  }
}

function recordGuestPhase(phase, observation) {
  const checks = guestSettingsChecks(observation.state, observation.organizationRequests);
  const cases = [
    ['T73', 'account', 'Account unavailable, no Name/role, Sign in footer'],
    ['T76', 'organization', 'archive filter absent and no organization read or choice'],
    ['T92', 'archivedManagement', 'no archived membership or restoration action'],
  ];
  for (const [suffix, check, name] of cases) {
    const c = byId(suffix);
    c.steps.push({
      phase,
      action: 'Inspect native guest Settings Account and Organization',
      observation: { ...observation.state, organizationRequests: observation.organizationRequests },
    });
    criterion(c, `${phase}: ${name}`, checks[check] ? 'pass' : 'fail', {
      signedOut: checks.signedOut,
      checkPassed: checks[check],
      organizationRequests: observation.organizationRequests,
    });
  }
}

async function recordGuestAdvancedDenial(phase, panel, observation) {
  const c = byId('T63');
  const state = await guestSections(panel);
  const signedOut = guestSettingsChecks(
    observation.state,
    observation.organizationRequests,
  ).signedOut;
  const passed =
    signedOut &&
    state.active &&
    !state.sections.includes('Advanced agent capabilities') &&
    !state.advancedText &&
    state.adminControls.length === 0 &&
    state.permissionControlCount === 0;
  c.steps.push({
    phase,
    action: 'Inspect guest Settings admin section and actions',
    observation: { signedOut, ...state },
  });
  criterion(
    c,
    `${phase}: guest admin section, optional controls and audit actions absent`,
    passed ? 'pass' : 'fail',
    { signedOut, ...state },
  );
}

async function runCase(c, fn) {
  try {
    await fn();
  } catch (error) {
    c.error = String(error?.message ?? error);
    if (error?.reacquireDiagnostic) c.reacquireDiagnostic = error.reacquireDiagnostic;
    criterion(c, 'runner completed the case', 'fail', c.error);
  }
  c.status = c.criteria.some((x) => x.status === 'fail')
    ? 'fail'
    : c.criteria.length && c.criteria.every((x) => x.status === 'pass')
      ? 'pass'
      : 'unverified';
}

let observedPort;
try {
  const packageJson = JSON.parse(await readFile(join(REPO, 'package.json'), 'utf8'));
  let receipt;
  if (DEV_BUILD_RECEIPT !== undefined) {
    assert.ok(DEV_BUILD_RECEIPT, 'SETTINGS_DEV_BUILD_RECEIPT must name a receipt');
    const manifest = JSON.parse(await readFile(join(DEV_EXTENSION_DIR, 'manifest.json'), 'utf8'));
    receipt = JSON.parse(await readFile(DEV_BUILD_RECEIPT, 'utf8'));
    requireLocalDevReceipt(receipt, DEV_EXTENSION_DIR);
    verifyFrozenArtifactIdentity({ extensionDir: DEV_EXTENSION_DIR, manifest, receipt });
    assert.ok(manifest.key, 'development manifest must carry its stable key');
    report.build = {
      ...report.build,
      kind: receipt.kind,
      publishState: receipt.publish_state,
      version: receipt.version,
      treeSha256: receipt.treeSha256,
    };
  } else {
    receipt = JSON.parse(await readFile(join(REPO, '.output', 'release-receipt.json'), 'utf8'));
    assert.equal(receipt.version, packageJson.version, 'receipt version must match package');
    assert.match(receipt.sourceSha, /^[a-f0-9]{40}$/);
    execFileSync('git', ['merge-base', '--is-ancestor', receipt.sourceSha, 'HEAD'], { cwd: REPO });
    execFileSync(
      'git',
      ['diff', '--quiet', receipt.sourceSha, '--', 'src/features/settings/SettingsView.tsx'],
      { cwd: REPO },
    );
    report.build = {
      ...report.build,
      version: receipt.version,
      sourceSha: receipt.sourceSha,
      treeSha256: receipt.treeSha256,
    };
  }
  observedPort = await startObservedDeadPort();
  const result = await runNativeSidepanelQa({
    ...(DEV_BUILD_RECEIPT !== undefined && {
      extensionDir: DEV_EXTENSION_DIR,
      expectedRelease: { version: receipt.version, treeSha256: receipt.treeSha256 },
      localDevReceiptPath: DEV_BUILD_RECEIPT,
    }),
    exercisePanel: async ({ panel, attachWorker, reloadExtension, transportFailureClass }) => {
      await settings(panel);
      for (const preference of GUEST_PREFERENCES) {
        await runCase(byId(preference.caseId), async () => {
          const c = byId(preference.caseId);
          await runGuestPreferenceCase(
            panel,
            reloadSettings,
            preference,
            (name, observation, passed) => {
              c.steps.push({
                phase: name.includes('reload') ? 'reload' : 'warm',
                action: name,
                observation,
              });
              criterion(c, name, passed ? 'pass' : 'fail', observation);
            },
            async ({ value, label }) => {
              if (preference.caseId !== 'T10') return;
              const chat = await observeGuestNewChatDefault(panel, value, label);
              c.steps.push({
                phase: 'consumer',
                action: 'Start a new chat and observe its inherited default mode',
                observation: chat,
              });
              criterion(
                c,
                `new chat inherits ${label}`,
                chat.modeLabel === label && chat.modeIcon === value ? 'pass' : 'fail',
                chat,
              );
              await settings(panel);
              await openSection(panel, preference.section);
            },
          );
        });
      }
      for (const preference of GUEST_PRIVACY_SWITCHES) {
        await runCase(byId(preference.caseId), async () => {
          const c = byId(preference.caseId);
          await runGuestPrivacySwitchCase(
            panel,
            reloadSettings,
            preference,
            (phase, name, observation, status) => {
              c.steps.push({ phase, action: name, observation });
              criterion(c, name, status, observation);
            },
          );
          criterion(
            c,
            'preference changes its downstream browser behavior',
            'unverified',
            'This bounded batch checks the real Settings switch and persistence; the site or agent consumer is not exercised.',
          );
        });
      }
      await runCase(byId('T64'), async () => {
        const c = byId('T64');
        await runGuestAskAgainCase(panel, reloadSettings, (name, observation, passed) => {
          c.steps.push({
            phase: name.includes('reload') ? 'reload' : 'warm',
            action: name,
            observation,
          });
          criterion(c, name, passed ? 'pass' : 'fail', observation);
        });
      });
      await runCase(byId('T22'), async () => {
        const c = byId('T22');
        for (const phase of ['warm', 'reload']) {
          if (phase === 'reload') await reloadSettings(panel);
          const state = await guestSections(panel);
          c.steps.push({
            phase,
            action: 'Inspect guest Settings section list and admin controls',
            observation: state,
          });
          criterion(
            c,
            `${phase} admin section and controls absent`,
            !state.sections.includes('Advanced agent capabilities') &&
              !state.advancedText &&
              state.adminControls.length === 0
              ? 'pass'
              : 'fail',
            state,
          );
        }
      });
      for (const [suffix, run] of [
        ['T28', runGuestSectionsCase],
        ['T40', runGuestAutoScrapeCase],
        ['T67', runGuestAutoScrapeModeCase],
      ]) {
        await runCase(byId(suffix), async () => {
          const c = byId(suffix);
          await run(panel, reloadSettings, (phase, action, observation, passed) => {
            c.steps.push({ phase, action, observation });
            criterion(c, action, passed ? 'pass' : 'fail', observation);
          });
          if (suffix === 'T40')
            criterion(
              c,
              'background capture follows the persisted switch',
              'unverified',
              'This batch observes the native Settings control; a page-load capture is not exercised.',
            );
        });
      }
      for (const suffix of FULL_EXTENSION_RECHECK_IDS) snapshotPanelDocumentReload(byId(suffix));
      await runCase(byId('T37'), async () => {
        const c = byId('T37');
        await openSection(panel, 'Scrape');
        const before = await deepClean(panel);
        c.steps.push({
          phase: 'warm',
          action: 'Observe initial Deep clean preference',
          observation: before,
        });
        criterion(
          c,
          'visible coming-soon hint',
          before.count === 1 && /coming soon/i.test(before.hint ?? '') ? 'pass' : 'fail',
          before,
        );
        assert.match(before.checked ?? '', /^(true|false)$/);
        try {
          await click(panel, 'switch', 'Deep clean');
          const toggled = await waitFor(
            'deep_clean_toggled',
            () => deepClean(panel),
            (s) => s?.checked !== before.checked,
          );
          c.steps.push({ phase: 'warm', action: 'Toggle Deep clean', observation: toggled });
          criterion(c, 'toggle changes state', 'pass', toggled);
          await reloadSettings(panel);
          await openSection(panel, 'Scrape');
          const reloaded = await deepClean(panel);
          c.steps.push({
            phase: 'reload',
            action: 'Inspect persisted state',
            observation: reloaded,
          });
          criterion(
            c,
            'state and coming-soon hint persist after reload',
            reloaded.checked === toggled.checked && /coming soon/i.test(reloaded.hint ?? '')
              ? 'pass'
              : 'fail',
            reloaded,
          );
        } finally {
          const current = await deepClean(panel);
          if (current?.checked !== before.checked) await click(panel, 'switch', 'Deep clean');
          const restored = await waitFor(
            'deep_clean_restored',
            () => deepClean(panel),
            (s) => s?.checked === before.checked,
          );
          c.steps.push({
            phase: 'cleanup',
            action: 'Restore original preference',
            observation: restored,
          });
        }
      });
      await runCase(byId('T46'), async () => {
        const c = byId('T46');
        await openSection(panel, 'Desktop bridge');
        const initial = await port(panel);
        c.steps.push({
          phase: 'warm',
          action: 'Record original engine port state',
          observation: initial,
        });
        assert.equal(initial.saved, null, 'fresh disposable profile must have no override');
        let worker;
        let rediscoverWatch;
        try {
          worker = await attachWorker();
          rediscoverWatch = await observeWorkerRediscover(worker);
          const beforeProbeCount = observedPort.requests.length;
          assert.equal(
            beforeProbeCount,
            0,
            'isolated override port must not be probed before save',
          );
          await replacePort(panel, String(observedPort.port), () => rediscoverWatch.armForSave());
          const saved = await waitFor(
            'valid_port_saved',
            () => port(panel),
            (s) => s?.saved === observedPort.port && s.override,
          );
          c.steps.push({ phase: 'warm', action: 'Save valid port', observation: saved });
          criterion(c, 'valid port saved', 'pass', saved);
          const handler = await waitFor(
            'worker_rediscovery_handler',
            () => rediscoverWatch.read(),
            (state) => state.pauses.length >= 2 || state.resumeError !== null,
          );
          assert.equal(handler.resumeError, null, 'owned worker debugger must resume');
          // This owned guest panel has one manual rediscovery action in this
          // interval. Bootstrap/alarm probes never enter this handler. Requiring
          // exactly entry -> completion rejects pre-Save, extra or mixed calls.
          assert.equal(typeof handler.saveStartedAt, 'number');
          assert.equal(
            handler.pauses.length,
            2,
            'one Save must have exactly one rediscovery entry and completion',
          );
          assert.deepEqual(
            handler.pauses.map((pause) => pause.hitBreakpoints),
            [[handler.entryBreakpoint], [handler.completionBreakpoint]],
            'the same single rediscovery invocation must enter then finish its probe',
          );
          assert.ok(
            handler.pauses.every((pause) => pause.observedAt >= handler.saveStartedAt),
            'rediscovery observations must follow the trusted Save boundary',
          );
          await rediscoverWatch.close();
          rediscoverWatch = null;
          c.steps.push({
            phase: 'warm',
            action: 'Observe worker rediscovery enter and reach post-probe broadcast after Save',
            observation: {
              ...handler,
              port: observedPort.port,
              healthRequests: observedPort.requests.slice(beforeProbeCount),
            },
          });
          criterion(c, 'saved port triggers desktop worker rediscovery', 'pass', handler);
          await reloadSettings(panel);
          await openSection(panel, 'Desktop bridge');
          const reloaded = await port(panel);
          c.steps.push({
            phase: 'reload',
            action: 'Inspect valid override after reload',
            observation: reloaded,
          });
          criterion(
            c,
            'valid override persists after reload',
            reloaded.saved === observedPort.port && reloaded.value === String(observedPort.port)
              ? 'pass'
              : 'fail',
            reloaded,
          );
          // Both inclusive endpoints must survive an actual Save and reopened
          // Settings panel. A display-only change cannot satisfy the storage read.
          for (const boundary of [1, 65535]) {
            await replacePort(panel, String(boundary));
            const accepted = await waitFor(
              `boundary_${boundary}_saved`,
              () => port(panel),
              (s) => s?.saved === boundary && s.value === String(boundary) && s.override,
            );
            c.steps.push({
              phase: 'warm',
              action: `Save inclusive boundary port ${boundary}`,
              observation: accepted,
            });
            await reloadSettings(panel);
            await openSection(panel, 'Desktop bridge');
            const persisted = await port(panel);
            c.steps.push({
              phase: 'reload',
              action: `Read inclusive boundary port ${boundary} after reload`,
              observation: persisted,
            });
            criterion(
              c,
              `boundary port ${boundary} saves and persists after reload`,
              persisted.saved === boundary &&
                persisted.value === String(boundary) &&
                persisted.override
                ? 'pass'
                : 'fail',
              { accepted, persisted },
            );
          }
          await replacePort(panel, '65536');
          const invalid = await waitFor(
            'invalid_port_error',
            () => port(panel),
            (s) => /Port must be 1–65535/.test(s?.error ?? ''),
          );
          c.steps.push({ phase: 'warm', action: 'Submit invalid range', observation: invalid });
          criterion(
            c,
            'invalid range shows error and retains saved port',
            invalid.saved === 65535 && invalid.value === '65536' ? 'pass' : 'fail',
            invalid,
          );
          await replacePort(panel, '');
          const cleared = await waitFor(
            'port_override_cleared',
            () => port(panel),
            (s) => s?.saved === null && !s.override,
          );
          c.steps.push({
            phase: 'warm',
            action: 'Clear override without leaving the invalid-error view',
            observation: cleared,
          });
          criterion(
            c,
            'blank clears override and stale error',
            cleared.error ? 'fail' : 'pass',
            cleared,
          );
          await reloadSettings(panel);
          await openSection(panel, 'Desktop bridge');
          const empty = await port(panel);
          c.steps.push({
            phase: 'reload',
            action: 'Inspect cleared override after reload',
            observation: empty,
          });
          criterion(
            c,
            'cleared override persists after reload',
            empty.saved === null && empty.value === '' ? 'pass' : 'fail',
            empty,
          );
        } finally {
          // Attempt every cleanup even if debugger teardown fails. The harness
          // also disposes the owned browser/profile after this case.
          const cleanupErrors = [];
          for (const cleanup of [
            async () => {
              await rediscoverWatch?.close();
            },
            async () => {
              await worker?.detach();
            },
            async () => {
              if ((await port(panel))?.saved !== null) {
                await replacePort(panel, '');
                const cleared = await waitFor(
                  'port_cleanup',
                  () => port(panel),
                  (s) => s?.saved === null,
                );
                c.steps.push({
                  phase: 'cleanup',
                  action: 'Clear disposable override',
                  observation: cleared,
                });
              }
            },
          ]) {
            try {
              await cleanup();
            } catch (error) {
              cleanupErrors.push(String(error?.message ?? error));
            }
          }
          if (cleanupErrors.length) {
            criterion(
              c,
              'all disposable override and debugger cleanup completed',
              'fail',
              cleanupErrors,
            );
          }
        }
      });
      await runCase(byId('T70'), async () => {
        const c = byId('T70');
        await openSection(panel, 'About');
        const warm = await about(panel);
        c.steps.push({
          phase: 'warm',
          action: 'Inspect About identity, API readiness, and update affordance',
          observation: warm,
        });
        criterion(
          c,
          'identity matches running browser, manifest, receipt and runtime ID',
          warm.browser === warm.expectedBrowser &&
            warm.version === warm.manifestVersion &&
            warm.version === report.build.version &&
            warm.extensionId === warm.runtimeId &&
            warm.extensionId === EXTENSION_ID
            ? 'pass'
            : 'fail',
          warm,
        );
        criterion(
          c,
          'password-flow API readiness label and remedy',
          warm.passwordApis
            ? ['Ready', 'Available'].includes(warm.readiness)
              ? 'pass'
              : 'fail'
            : warm.readiness === 'Unavailable' && warm.unavailableRemedy
              ? 'pass'
              : 'fail',
          warm,
        );
        criterion(
          c,
          'password-flow API unavailable branch',
          'unverified',
          'No browser API was removed or mocked.',
        );
        if (warm.updateApi && warm.hasUpdateButton) {
          await click(panel, 'button', 'Check for extension update');
          const checked = await waitFor(
            'update_check_result',
            () => about(panel),
            (s) => s?.updateText !== null,
            15000,
          );
          c.steps.push({
            phase: 'warm',
            action: 'Request real browser update check',
            observation: checked,
          });
          criterion(
            c,
            'observed browser update result shown accurately',
            checked.updateText ? 'pass' : 'fail',
            checked,
          );
          criterion(
            c,
            'no-update outcome',
            /did not find an update/.test(checked.updateText ?? '') ? 'pass' : 'unverified',
            checked,
          );
        } else {
          criterion(
            c,
            'browser-managed update instructions',
            warm.browserManaged ? 'pass' : 'fail',
            warm,
          );
          criterion(
            c,
            'real no-update outcome',
            'unverified',
            'requestUpdateCheck unavailable in this installed browser.',
          );
        }
        for (const branch of [
          'update available',
          'throttled',
          'update error',
          'update API unavailable',
        ])
          criterion(
            c,
            `${branch} branch`,
            'unverified',
            'No browser API or update result was fabricated.',
          );
        await reloadSettings(panel);
        await openSection(panel, 'About');
        const reloaded = await about(panel);
        c.steps.push({
          phase: 'reload',
          action: 'Inspect current identity and API readiness',
          observation: reloaded,
        });
        criterion(
          c,
          'identity and API readiness remain current after reload',
          reloaded.version === report.build.version &&
            reloaded.extensionId === EXTENSION_ID &&
            reloaded.passwordApis === warm.passwordApis &&
            reloaded.readiness === warm.readiness
            ? 'pass'
            : 'fail',
          reloaded,
        );
      });
      let guestStage = 'warm_observation';
      try {
        const warmGuest = await observeGuestIdentityAndOrganization(panel);
        recordGuestPhase('warm', warmGuest);
        await recordGuestAdvancedDenial('warm', panel, warmGuest);
        const preExtensionBaselines = await captureGuestPreferenceBaselines({
          panel,
          preferences: GUEST_PREFERENCES,
          settings,
          openSection,
          observePreference: observeGuestPreference,
          preferenceBaseline,
        });
        guestStage = 'extension_reload';
        const replacement = await reloadExtension();
        report.guestExtensionReload = {
          managementReloadClicked: replacement.management_reload_clicked === true,
          oldTargetsRetired: replacement.old_targets_retired === true,
          workerReplaced: replacement.worker_replaced === true,
          panelReplaced: replacement.panel_replaced === true,
        };
        assert.ok(
          Object.values(report.guestExtensionReload).every(Boolean),
          'owned extension reload lifecycle incomplete',
        );
        guestStage = 'reload_settings';
        let reloadStep = 'before_click';
        try {
          await settings(replacement.panel, (step) => {
            reloadStep = step;
          });
          report.guestReloadBoundary = {
            status: 'settings_opened',
            panel: await observeReloadSettingsPanel(replacement.panel, EXTENSION_ID),
          };
        } catch (error) {
          report.guestReloadBoundary = {
            status: 'settings_open_failed',
            failure: classifyReloadSettingsFailure(error, reloadStep),
            panel: await observeReloadSettingsPanel(replacement.panel, EXTENSION_ID),
          };
          throw error;
        }
        guestStage = 'reload_observation';
        const reloadedGuest = await observeGuestIdentityAndOrganization(replacement.panel);
        recordGuestPhase('reload', reloadedGuest);
        await recordGuestAdvancedDenial('reload', replacement.panel, reloadedGuest);
        await rerunGuestSettingsAfterExtensionReload({
          panel: replacement.panel,
          cases: report.cases,
          preferences: GUEST_PREFERENCES,
          reloadSettings,
          settings,
          openSection,
          observeNewChatDefault: observeGuestNewChatDefault,
          observePreference: observeGuestPreference,
          preferenceBaseline,
          preExtensionBaselines,
          runSectionsCase: runGuestSectionsCase,
          runAutoScrapeCase: runGuestAutoScrapeCase,
          reloadExtension,
          acquireLivePanel,
          preferenceMatches,
        });
      } catch (error) {
        report.guestStageFailed = guestStage;
        if (guestStage === 'extension_reload' || error?.lifecycleEvidence || error?.contextBoundary)
          report.guestExtensionReloadFailure = captureFailure(error, transportFailureClass);
        for (const suffix of ['T63', 'T73', 'T76', 'T92']) {
          const c = byId(suffix);
          criterion(c, `${guestStage}: native observation complete`, 'unverified', {
            stage: guestStage,
            lastSafeObservation: c.steps.at(-1)?.observation ?? null,
          });
        }
      }
      criterion(
        byId('T63'),
        'ordinary member denial',
        'unverified',
        'This guest runner has no ordinary-member principal.',
      );
      for (const suffix of ['T63', 'T73', 'T76', 'T92']) {
        const c = byId(suffix);
        c.status = c.criteria.some((item) => item.status === 'fail')
          ? 'fail'
          : c.criteria.length === (suffix === 'T63' ? 3 : 2) &&
              c.criteria.every((item) => item.status === 'pass')
            ? 'pass'
            : 'unverified';
      }
    },
  });
  assert.equal(result.verified, true);
  if (DEV_BUILD_RECEIPT !== undefined) {
    const after = JSON.parse(await readFile(DEV_BUILD_RECEIPT, 'utf8'));
    requireLocalDevReceipt(after, DEV_EXTENSION_DIR);
    assert.equal(after.version, receipt.version, 'development version changed during run');
    assert.equal(after.treeSha256, receipt.treeSha256, 'development receipt changed during run');
    assert.equal(
      hashReleaseTree(DEV_EXTENSION_DIR),
      receipt.treeSha256,
      'development tree changed during run',
    );
  }
  report.build.verified = true;
  report.artifacts = result.artifacts;
} catch (error) {
  report.setup_error = String(error?.message ?? error);
  for (const c of report.cases)
    if (c.criteria.length === 0) criterion(c, 'setup completed', 'unverified', report.setup_error);
} finally {
  await observedPort?.close();
  enforceFullExtensionRechecks(report.cases);
  for (const c of report.cases) {
    c.build = report.build;
    c.preconditions = report.preconditions;
    c.evidence = report.artifacts ?? null;
  }
  report.status = report.cases.some((c) => c.status === 'fail')
    ? 'fail'
    : report.cases.every((c) => c.status === 'pass')
      ? 'pass'
      : 'unverified';
  await mkdir(join(REPO, 'test-results'), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(`${report.status.toUpperCase()} settings-local-controls: ${OUTPUT}`);
  if (report.setup_error) console.error(report.setup_error);
  if (report.status === 'fail' || report.setup_error) process.exitCode = 1;
}
