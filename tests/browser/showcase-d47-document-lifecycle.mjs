#!/usr/bin/env node
/** Real signed-in saved Network replay with an owned HTTP document race. */
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { approvedAdminOrganizationName, signInSettings } from './settings-native-auth-driver.mjs';
import { click, evaluate, waitFor } from './settings-panel-driver.mjs';
import {
  assessD47StaleTrace,
  assessD47Trace,
  captureD47SaveClick,
  cleanupD47Probe,
  discoveryTerminal,
  sanitizeD47Failure,
  trustedD47PanelClick,
} from './showcase-d47-driver-evidence.mjs';
import {
  isD47StaleRefusal,
  readD47SavedResult,
  readD47SavedRunState,
  readD47StaleRefusal,
} from './showcase-d47-saved-result.mjs';
import {
  deriveD47TerminalBudget,
  terminalBudgetPaths,
  waitD47SavedTerminal,
} from './showcase-d47-terminal-budget.mjs';
import {
  installPassiveWorkerProbe,
  readPassiveWorkerProbe,
  removePassiveWorkerProbe,
} from './showcase-d47-worker-probe.mjs';
import { runShowcaseOrganizationCheckpoint } from './showcase-organization-checkpoint.mjs';

const repo = resolve(import.meta.dirname, '../..');
const responseOrder = process.env.MATRX_D47_RESPONSE_ORDER ?? 'current-first';
assert.ok(
  ['current-first', 'old-first', 'stale-only', 'manual-prior'].includes(responseOrder),
  'd47_response_order_invalid',
);
const output =
  process.env.MATRX_SHOWCASE_OUTPUT ?? join(tmpdir(), `showcase-d47-${randomUUID()}.json`);
const report = {
  schema_version: 1,
  case_id: 'EXT-F-1012-T57',
  defect_id: 'EXT-D-0047',
  status: 'unverified',
  stage: 'inputs',
  artifact: null,
  fixture: null,
  response_order: responseOrder,
  contexts: [],
  binding_events: [],
  saved_result: null,
  verdicts: {
    current_saved_replay: 'unverified',
    delayed_old_binding: 'unverified',
    cancellation: 'unverified',
    manual_prior_isolation: 'unverified',
  },
  failure_code: null,
  failure: null,
  diagnostics: null,
};
let fixture;
let probeWorker;
let probeInstallAttempted = false;
let activePanel;
let saveObservation = null;
let saveClickEvidence = null;
let patternsObservation = null;
let ownedRecipe = null;
let ownedHost = null;
const observationStarted = performance.now();
report.stage_observations = [];
const stage = (value) => {
  report.stage = value;
  report.stage_observations.push({
    stage: value,
    elapsed_ms: performance.now() - observationStarted,
  });
};
const control = async (origin, action) => {
  const response = await fetch(`${origin}/control/document-race/${action}`);
  const body = await response.text();
  return { status: response.status, body: body.startsWith('{') ? JSON.parse(body) : null };
};
const status = async (origin) => (await control(origin, 'status')).body;

async function startFixture() {
  const child = spawn(process.execPath, [join(repo, 'tests/fixtures/showcase-replay/serve.mjs')], {
    env: { ...process.env, SHOWCASE_FIXTURE_PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  const origin = await new Promise((resolveOrigin, reject) => {
    const timer = setTimeout(() => reject(new Error('fixture_start_timeout')), 10000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const match = /Showcase fixture: (http:\/\/127\.0\.0\.1:\d+)\//.exec(stdout);
      if (match) {
        clearTimeout(timer);
        resolveOrigin(match[1]);
      }
    });
    child.once('exit', () => {
      clearTimeout(timer);
      reject(new Error('fixture_exited_before_ready'));
    });
    child.once('error', reject);
  });
  return { child, origin };
}

async function stopFixture() {
  if (!fixture || fixture.child.exitCode !== null || fixture.child.signalCode !== null) return;
  await new Promise((resolveStop) => {
    fixture.child.once('exit', resolveStop);
    fixture.child.kill('SIGTERM');
  });
}

const panelText = (panel) => evaluate(panel, 'document.body.innerText');
async function readSaveObservation(panel, recipe) {
  return evaluate(
    panel,
    `(() => {
      const content = [...document.querySelectorAll('[data-radix-popper-content-wrapper]')]
        .find(wrapper => wrapper.getBoundingClientRect().width > 0 &&
          wrapper.getBoundingClientRect().height > 0 &&
          getComputedStyle(wrapper).visibility === 'visible' &&
          wrapper.querySelector('input') &&
          [...wrapper.querySelectorAll('button')].some(button => button.textContent.trim() === 'Save'));
      const saveButton = [...(content?.querySelectorAll('button') ?? [])]
        .find(button => button.textContent.trim() === 'Save');
      const error = content?.querySelector('.text-destructive')?.textContent.trim() ?? '';
      const input = content?.querySelector('input');
      return {
        popover_visible: Boolean(content),
        name_matches: input ? input.value === ${JSON.stringify(recipe)} : null,
        name_focused: input ? document.activeElement === input : null,
        save_button_present: Boolean(saveButton),
        save_button_disabled: saveButton?.disabled ?? null,
        saving_indicator: Boolean(saveButton?.querySelector('.animate-spin')),
        saved_summary_visible: Boolean(content?.textContent.includes('Pattern saved')),
        error_present: Boolean(error),
        error_kind: !error ? null :
          /page changed|previous page|capture it again/i.test(error) ? 'page_identity' :
          /organization|organisation/i.test(error) ? 'organization' :
          /append|row/i.test(error) ? 'append' :
          /save pattern|failed to save/i.test(error) ? 'save' : 'other'
      };
    })()`,
  );
}
async function readPatternsObservation(panel, recipe, host) {
  return evaluate(
    panel,
    `(() => {
      const tab = [...document.querySelectorAll('[role="tablist"] [role="tab"]')]
        .find(el => el.textContent.trim() === 'Patterns');
      const pane = tab ? document.getElementById(tab.getAttribute('aria-controls') ?? '') : null;
      const active = tab?.getAttribute('data-state') === 'active' &&
        pane?.getAttribute('data-state') === 'active';
      const names = [...(active ? pane.querySelectorAll('span.truncate.text-sm.font-medium') : [])];
      const error = active ? pane.querySelector('.text-destructive')?.textContent.trim() ?? '' : '';
      return {
        active: Boolean(active),
        host_matches: active ? pane.textContent.includes('All saved patterns for ' + ${JSON.stringify(host)}) : null,
        exact_row_visible: names.some(name => name.textContent.trim() === ${JSON.stringify(recipe)}),
        row_count: names.length,
        loading: active ? Boolean(pane.querySelector('button[title="Refresh"] .animate-spin')) : null,
        empty_state: active ? pane.textContent.includes('No saved patterns for this host yet.') : null,
        error_present: Boolean(error),
        error_kind: !error ? null :
          /could not load saved patterns/i.test(error) ? 'load' :
          /database|permission|unauthorized|not authenticated/i.test(error) ? 'database_or_auth' : 'other'
      };
    })()`,
  );
}
async function removeOwnedRecipe(panel, recipe, host) {
  const cleanupClick = (target) =>
    trustedD47PanelClick(panel, target, (observation) => {
      report.cleanup_target_observation = { stage: report.stage, ...observation };
    });
  await tab(panel, 'Showcase (admin only)');
  await cleanupClick({ selector: '[role="tablist"] [role="tab"]', text: 'Patterns' });
  const before = await waitFor(
    'owned_recipe_cleanup_list',
    () => readPatternsObservation(panel, recipe, host),
    (state) =>
      state?.active === true &&
      state?.host_matches === true &&
      state?.loading === false &&
      state?.error_present === false,
  );
  if (!before.exact_row_visible) return 'absent';
  await cleanupClick({
    selector: 'button[title], button[data-matrx-title]',
    patternName: recipe,
    expectedHost: host,
    semanticTitle: 'Delete pattern',
  });
  await waitFor(
    'owned_recipe_delete_confirmation',
    () =>
      evaluate(
        panel,
        `(() => [...document.querySelectorAll('[role="alertdialog"]')]
      .filter(dialog => dialog.getAttribute('data-state') === 'open')
      .map(dialog => dialog.querySelector('[data-slot="alert-dialog-title"]')?.textContent.trim())
    )()`,
      ),
    (titles) => titles?.length === 1 && titles[0] === `Delete the pattern "${recipe}"?`,
  );
  await cleanupClick({ selector: '[role="alertdialog"] button', text: 'Delete pattern' });
  await waitFor(
    'owned_recipe_removed',
    () => readPatternsObservation(panel, recipe, host),
    (state) =>
      state?.active === true &&
      state?.host_matches === true &&
      state?.loading === false &&
      state?.error_present === false &&
      state?.exact_row_visible === false,
  );
  return 'removed';
}
async function withD47Cleanup(panel, exercise) {
  let primaryFailure = null;
  try {
    await exercise();
  } catch (error) {
    primaryFailure = error;
  } finally {
    report.probe_cleanup = await cleanupD47Probe(
      probeWorker,
      probeInstallAttempted,
      removePassiveWorkerProbe,
    );
    probeInstallAttempted = false;
    probeWorker = null;
    if (report.probe_cleanup && !primaryFailure)
      primaryFailure = new Error('worker_probe_cleanup_failed');
    if (ownedRecipe && ownedHost) {
      try {
        report.owned_recipe.cleanup = await removeOwnedRecipe(panel, ownedRecipe, ownedHost);
        if (report.owned_recipe.cleanup === 'absent') {
          report.owned_recipe.cleanup = 'unverified';
          if (!primaryFailure) primaryFailure = new Error('owned_recipe_absence_unconfirmed');
        }
      } catch {
        report.owned_recipe.cleanup = 'unverified';
        if (!primaryFailure) primaryFailure = new Error('owned_recipe_cleanup_failed');
      }
    }
  }
  if (primaryFailure) throw primaryFailure;
}
async function trustedPanelClick(
  panel,
  selector,
  text = null,
  patternName = null,
  expectedHost = null,
  semanticTitle = null,
) {
  return trustedD47PanelClick(
    panel,
    { selector, text, patternName, expectedHost, semanticTitle },
    (observation) => {
      report.target_observation = { stage: report.stage, ...observation };
    },
  );
}

async function captureLiveFailure(exercise) {
  try {
    return await exercise();
  } catch (error) {
    report.live_failure_boundary = { stage: report.stage, probe: 'not_installed' };
    if (probeInstallAttempted && probeWorker) {
      try {
        const observed = await readPassiveWorkerProbe(probeWorker);
        report.contexts = observed.filter((event) => event.kind !== 'binding');
        report.binding_events = observed.filter((event) => event.kind === 'binding');
        report.live_failure_boundary.probe = 'captured_before_detach';
      } catch {
        report.live_failure_boundary.probe = 'unavailable_before_detach';
      }
    }
    throw error;
  }
}

const allow = async (panel) => {
  await waitFor(
    'debugger_approval',
    () => panelText(panel),
    (text) => text?.includes('Allowing this uses Chrome debugger'),
  );
  await click(panel, 'button-text', 'Allow');
};
const tab = async (panel, name) => {
  await click(panel, 'title', name);
};

if (process.env.MATRX_D47_IMPORT_PREFLIGHT === '1') {
  process.stdout.write('HOSTED_D47_DRIVER_IMPORT_READY\n');
  process.exit(0);
}

try {
  const extensionDir = process.env.MATRX_SHOWCASE_EXTENSION_DIR;
  const receiptPath = process.env.MATRX_SHOWCASE_RECEIPT;
  assert.ok(extensionDir && receiptPath, 'exact_artifact_required');
  assert.match(process.env.MATRX_SHOWCASE_CI_SOURCE_SHA ?? '', /^[a-f0-9]{40}$/);
  assert.match(process.env.MATRX_SHOWCASE_CI_RUN_ID ?? '', /^[1-9][0-9]*$/);
  assert.match(process.env.MATRX_SHOWCASE_CI_ARTIFACT_ID ?? '', /^[1-9][0-9]*$/);
  const requiredOrganizationName = await approvedAdminOrganizationName(
    process.env.MATRX_APPROVED_ADMIN_ORGANIZATION_FILE,
  );
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  assert.equal(receipt.kind, 'local_dev_unpacked');
  assert.equal(hashReleaseTree(extensionDir), receipt.treeSha256);
  const manifest = JSON.parse(await readFile(join(extensionDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, receipt.version);
  report.artifact = {
    source_sha: process.env.MATRX_SHOWCASE_CI_SOURCE_SHA,
    run_id: Number(process.env.MATRX_SHOWCASE_CI_RUN_ID),
    artifact_id: Number(process.env.MATRX_SHOWCASE_CI_ARTIFACT_ID),
    tree_sha256: receipt.treeSha256,
    version: receipt.version,
  };
  const artifactSources = Object.fromEntries(
    await Promise.all(
      Object.entries(terminalBudgetPaths).map(async ([key, path]) => {
        const { stdout } = await promisify(execFile)(
          'git',
          ['show', `${report.artifact.source_sha}:${path}`],
          { cwd: repo },
        );
        return [key, stdout];
      }),
    ),
  );
  const terminalBudget = deriveD47TerminalBudget(artifactSources);
  report.terminal_budget = { ...terminalBudget, anchor: 'after_current_http_response' };
  fixture = await startFixture();
  stage('native');
  const native = await runNativeSidepanelQa({
    headed: true,
    extensionDir,
    localDevReceiptPath: receiptPath,
    expectedRelease: receipt,
    artifactRoot: join(process.env.RUNNER_TEMP ?? tmpdir(), 'guest-acceptance'),
    onStage: (value) => {
      report.native_stage = value;
    },
    exercisePanel: async ({
      page,
      panel,
      resourceAction,
      requireResourceHealth,
      reopenPanel,
      attachWorker,
    }) =>
      withD47Cleanup(panel, () =>
        captureLiveFailure(async () => {
          const origin = fixture.origin;
          activePanel = panel;
          stage('signin');
          const auth = await resourceAction(() =>
            signInSettings({
              mode: 'admin',
              page,
              panel,
              repo,
              adminCredentialsFile: process.env.MATRX_PREPARE_ADMIN_CREDENTIALS_FILE,
              onStage: (value) => {
                report.auth_stage = value;
              },
            }),
          );
          assert.equal(auth.admin_role, true);
          stage('organization');
          await runShowcaseOrganizationCheckpoint({
            panel,
            auth,
            resourceAction,
            report,
            requiredOrganizationName,
          });
          await resourceAction(() => reopenPanel());
          await resourceAction(() => page.goto(`${origin}/document-race/`));
          await waitFor(
            'fixture_seed',
            () => page.locator('#phase').textContent(),
            (value) => value === 'seed',
          );
          await requireResourceHealth();
          stage('capture_seed');
          await tab(panel, 'Showcase (admin only)');
          await trustedPanelClick(panel, '[role="tablist"] [role="tab"]', 'Network');
          await click(panel, 'button-text', 'Capture page load');
          await allow(panel);
          await waitFor(
            'seed_response',
            () => panelText(panel),
            (value) =>
              value?.includes('/api/document-race') && value?.includes('response captured'),
          );
          await waitFor(
            'seed_discovery_terminal',
            () =>
              evaluate(
                panel,
                `(() => ({
          discovering: Boolean(document.querySelector('[role="status"]')?.textContent.includes('Capturing page load') || document.body.innerText.includes('● page load —')),
          responses: document.body.innerText.includes('responses captured · stopped') || document.body.innerText.includes('response captured · stopped'),
          error: Boolean(document.querySelector('.text-destructive'))
        }))()`,
              ),
            discoveryTerminal,
            30_000,
          );
          stage('select_seed_response');
          await trustedPanelClick(panel, 'button.font-mono:has(span.flex-1)');
          await waitFor(
            'seed_save_ready',
            () =>
              evaluate(
                panel,
                `(() => [...document.querySelectorAll('button')].some(x => x.textContent.trim() === 'Save pattern' && !x.disabled))()`,
              ),
            (ready) => ready === true,
          );
          stage('save_recipe');
          await click(panel, 'button-text', 'Save pattern');
          const recipe = `Codex D47 document race ${randomUUID()}`;
          ownedRecipe = recipe;
          ownedHost = new URL(origin).host;
          report.owned_recipe = {
            name: recipe,
            host: ownedHost,
            created_after_utc: new Date().toISOString(),
            creation: 'attempted',
            cleanup: 'unverified',
          };
          // The popover is the only visible name field in this flow.
          const inputs = await evaluate(
            panel,
            `(() => [...document.querySelectorAll('[data-radix-popper-content-wrapper] input')].map(x => ({ placeholder: x.placeholder })))()`,
          );
          assert.equal(inputs.length, 1, 'save_name_input_ambiguous');
          saveObservation = { focus: null, before_click: null, last: null };
          await click(panel, 'save-pattern-name', 'Save pattern');
          await waitFor(
            'save_name_focus',
            async () => {
              saveObservation.focus = await readSaveObservation(panel, recipe);
              return saveObservation.focus;
            },
            (state) => state?.name_focused === true,
          );
          const selectAllModifier = process.platform === 'darwin' ? 4 : 2;
          await panel.send('Input.dispatchKeyEvent', {
            type: 'keyDown',
            key: 'a',
            code: 'KeyA',
            modifiers: selectAllModifier,
            windowsVirtualKeyCode: 65,
            commands: ['selectAll'],
          });
          await panel.send('Input.dispatchKeyEvent', {
            type: 'keyUp',
            key: 'a',
            code: 'KeyA',
            modifiers: selectAllModifier,
            windowsVirtualKeyCode: 65,
          });
          // Trusted typing through CDP; React observes the normal input sequence.
          await panel.send('Input.insertText', { text: recipe });
          await waitFor(
            'save_name',
            async () => {
              saveObservation.before_click = await readSaveObservation(panel, recipe);
              return saveObservation.before_click;
            },
            (state) => state?.name_matches === true,
          );
          assert.equal(saveObservation.before_click.name_matches, true, 'save_name_not_entered');
          assert.equal(
            saveObservation.before_click.save_button_disabled,
            false,
            'save_button_disabled',
          );
          saveClickEvidence = {};
          report.save_click = saveClickEvidence;
          await captureD47SaveClick(
            panel,
            () => readSaveObservation(panel, recipe),
            saveClickEvidence,
          );
          const saveState = await waitFor(
            'recipe_save_terminal',
            async () => {
              const state = await readSaveObservation(panel, recipe);
              saveObservation.last = state;
              return state;
            },
            (state) =>
              state?.error_present === false &&
              (state.saved_summary_visible === true || state.popover_visible === false),
          );
          saveObservation.terminal = saveState.saved_summary_visible ? 'summary' : 'popover_closed';
          stage('verify_persisted_recipe');
          await waitFor(
            'save_popover_closed',
            () => readSaveObservation(panel, recipe),
            (state) => state?.popover_visible === false,
          );
          await trustedPanelClick(panel, '[role="tablist"] [role="tab"]', 'Patterns');
          const fixtureHost = new URL(origin).host;
          await waitFor(
            'patterns_active',
            async () => {
              patternsObservation = await readPatternsObservation(panel, recipe, fixtureHost);
              return patternsObservation;
            },
            (state) => state?.active === true,
          );
          await waitFor(
            'saved_recipe_visible',
            async () => {
              patternsObservation = await readPatternsObservation(panel, recipe, fixtureHost);
              return patternsObservation;
            },
            (state) => state?.exact_row_visible === true && state?.host_matches === true,
          );
          report.owned_recipe.creation = 'observed_in_patterns';
          stage('arm_old_document');
          await control(origin, `arm?response_order=${responseOrder}`);
          await resourceAction(() => page.reload());
          await waitFor(
            'old_pending',
            () => status(origin),
            (value) => value?.old_pending === true && value.target_requests === 1,
          );
          if (responseOrder === 'manual-prior') {
            stage('manual_prior_capture');
            await trustedPanelClick(panel, '[role="tablist"] [role="tab"]', 'Network');
            await waitFor(
              'manual_capture_start_ready',
              () =>
                evaluate(
                  panel,
                  `(() => {
                const tab = [...document.querySelectorAll('[role="tablist"] [role="tab"]')]
                  .find(x => x.textContent.trim() === 'Network');
                const pane = tab ? document.getElementById(tab.getAttribute('aria-controls') ?? '') : null;
                const button = [...(pane?.querySelectorAll('button') ?? [])]
                  .find(x => x.textContent.trim() === 'Start capture');
                return tab?.getAttribute('data-state') === 'active' && Boolean(button && !button.disabled);
              })()`,
                ),
              (value) => value === true,
            );
            await click(panel, 'button-text', 'Start capture');
            await waitFor(
              'manual_capture_recording',
              () => panelText(panel),
              (value) => value?.includes('● recording — 0 responses captured'),
            );
            await resourceAction(() => page.locator('#manual-prior-request').click());
            await waitFor(
              'manual_prior_http',
              () => status(origin),
              (value) =>
                value?.manual_prior_finished === true &&
                value.old_pending === true &&
                value.target_requests === 1,
            );
            await waitFor(
              'manual_prior_page_result',
              () => page.locator('#manual-prior-result').textContent(),
              (value) => value === 'Moonlit Transit',
            );
            report.manual_prior = await waitFor(
              'manual_prior_network_list',
              () =>
                evaluate(
                  panel,
                  `(() => {
                const tab = [...document.querySelectorAll('[role="tablist"] [role="tab"]')]
                  .find(x => x.textContent.trim() === 'Network');
                const pane = tab ? document.getElementById(tab.getAttribute('aria-controls') ?? '') : null;
                const active = tab?.getAttribute('data-state') === 'active' && pane?.getAttribute('data-state') === 'active';
                const rows = active ? [...pane.querySelectorAll('button.font-mono:has(span.flex-1)')] : [];
                return {
                  active: Boolean(active),
                  exact_request_rows: rows.filter(row => row.textContent.includes('/api/document-race') && row.textContent.includes('GET')).length,
                  recording: Boolean(active && pane.textContent.includes('● recording — 1 response captured'))
                };
              })()`,
                ),
              (value) =>
                value?.active === true &&
                value.exact_request_rows === 1 &&
                value.recording === true,
            );
            await resourceAction(() => page.locator('#manual-pending-request').click());
            report.manual_prior.pending_before_replay = await waitFor(
              'manual_origin_pending',
              () => status(origin),
              (value) =>
                value?.manual_pending === true &&
                value.old_pending === true &&
                value.target_requests === 1,
            );
            await click(panel, 'button-text', 'Stop');
            await trustedPanelClick(panel, '[role="tablist"] [role="tab"]', 'Patterns');
            await waitFor(
              'manual_return_to_patterns',
              () => readPatternsObservation(panel, recipe, fixtureHost),
              (value) => value?.active === true && value.exact_row_visible === true,
            );
            report.manual_prior.old_pending_after_ui = (await status(origin)).old_pending === true;
            assert.equal(
              report.manual_prior.old_pending_after_ui,
              true,
              'old_request_lost_during_manual_capture',
            );
          }
          stage('old_context_identity');
          const pageCdp = await page.context().newCDPSession(page);
          const oldContexts = [];
          pageCdp.on('Runtime.executionContextCreated', ({ context }) => {
            if (context.auxData?.isDefault && context.uniqueId)
              oldContexts.push({
                unique_id: context.uniqueId,
                frame_id: context.auxData.frameId ?? null,
              });
          });
          await pageCdp.send('Runtime.enable');
          await waitFor(
            'old_page_context',
            () => oldContexts,
            (value) => value.length === 1 && Boolean(value[0].frame_id),
          );
          const oldPageContext = oldContexts[0];
          report.old_context_pre_run = {
            unique_id: oldPageContext.unique_id,
            frame_id: oldPageContext.frame_id,
          };
          await pageCdp.detach();
          const worker = await attachWorker();
          probeWorker = worker;
          stage('worker_observer');
          await installPassiveWorkerProbe(worker, origin, () => {
            probeInstallAttempted = true;
          });
          stage('saved_replay');
          // The earlier row observation predates page.reload and its document identity reset.
          patternsObservation = await readPatternsObservation(panel, recipe, fixtureHost);
          await trustedPanelClick(
            panel,
            'button[title], button[data-matrx-title]',
            null,
            recipe,
            fixtureHost,
            'Run pattern',
          );
          stage('saved_approval');
          await allow(panel);
          if (responseOrder === 'stale-only') {
            stage('current_probe_http');
            report.fixture = {
              before_release: await waitFor(
                'current_probe_finished',
                () => status(origin),
                (value) =>
                  value?.current_probe_finished === true &&
                  value.target_requests === 1 &&
                  value.old_pending === true &&
                  value.response_finish_order.length === 0,
              ),
            };
            stage('release_old_http');
            const release = await control(origin, 'release-old');
            report.fixture.release_http_status = release.status;
            report.fixture.after_release = await status(origin);
            assert.equal(release.status, 200, 'old_pending_release_failed');
            assert.equal(report.fixture.after_release.old_release_prestate, 'pending');
            assert.equal(report.fixture.after_release.old_release_outcome, 'server_finished');
            assert.equal(report.fixture.after_release.old_response_finished, true);
            assert.deepEqual(report.fixture.after_release.response_finish_order, ['old']);
            assert.equal(
              report.fixture.after_release.target_requests,
              1,
              'current_target_unexpected',
            );
            stage('stale_only_terminal_refusal');
            report.refusal_observation = { sample_count: 0, first: null, last: null };
            const refusal = await waitFor(
              'stale_only_refusal',
              async () => {
                const value = await evaluate(
                  panel,
                  `(() => { const readD47SavedResult = ${readD47SavedResult.toString()};
                    const readD47SavedRunState = ${readD47SavedRunState.toString()};
                    return (${readD47StaleRefusal.toString()})(document, ${JSON.stringify(recipe)});
                  })()`,
                );
                const safe = {
                  refusal: value?.refusal === true,
                  error_count: value?.error_count ?? null,
                  running: value?.running === true,
                  observation_unavailable: value?.observation_unavailable !== false,
                  current_row: value?.current_row === true,
                  old_row: value?.old_row === true,
                  header_status: value?.header_status ?? 'unavailable',
                  preview_status: value?.preview_status ?? 'unavailable',
                };
                report.refusal_observation.sample_count++;
                report.refusal_observation.first ??= safe;
                report.refusal_observation.last = safe;
                return safe;
              },
              isD47StaleRefusal,
              terminalBudget.timeout_ms,
            );
            report.refusal_observation.terminal = refusal;
            const staleTrace = await readPassiveWorkerProbe(worker);
            assert.ok(Array.isArray(staleTrace), 'worker_probe_lost');
            report.stale_trace_assessment = assessD47StaleTrace(staleTrace, {
              origin,
              oldPageContext,
              expectedBodySha256: createHash('sha256').update('{"warmup":true}').digest('hex'),
            });
            assert.equal(
              report.stale_trace_assessment.ok,
              true,
              report.stale_trace_assessment.reason,
            );
            stage('enable_fresh_recovery');
            const enabled = await control(origin, 'recover');
            assert.equal(enabled.status, 200, 'recovery_enable_failed');
            assert.equal(enabled.body?.recovery_enabled, true);
            assert.equal(enabled.body?.target_requests, 1);
            stage('fresh_saved_replay');
            await trustedPanelClick(
              panel,
              'button[title], button[data-matrx-title]',
              null,
              recipe,
              fixtureHost,
              'Run pattern',
            );
            stage('fresh_saved_approval');
            await allow(panel);
            stage('fresh_current_http');
            report.fixture.after_recovery = await waitFor(
              'fresh_current_response',
              () => status(origin),
              (value) =>
                value?.recovery_target_finished === true &&
                value.target_requests === 2 &&
                value.response_finish_order.length === 1 &&
                value.response_finish_order[0] === 'old',
            );
            stage('fresh_saved_terminal');
            report.terminal_observation = { sample_count: 0, first: null, last: null };
            await waitD47SavedTerminal({
              budget: terminalBudget,
              read: () =>
                evaluate(
                  panel,
                  `(() => ({
                ...(${readD47SavedResult.toString()})(document, ${JSON.stringify(recipe)}),
                ...(${readD47SavedRunState.toString()})(document, ${JSON.stringify(recipe)})
              }))()`,
                ),
              record: (value) => {
                report.terminal_observation.sample_count++;
                report.terminal_observation.first ??= value;
                report.terminal_observation.last = value;
              },
            });
            report.saved_result = {
              page_phase_current: (await page.locator('#phase').textContent()) === 'current',
              page_result_current:
                (await page.locator('#result').textContent()) === 'Canyon Frequency',
              panel_current: (await panelText(panel))?.includes('Canyon Frequency') ?? false,
              panel_old: (await panelText(panel))?.includes('Moonlit Transit') ?? false,
            };
            assert.equal(
              report.saved_result.page_phase_current,
              true,
              'current_page_phase_missing',
            );
            assert.equal(
              report.saved_result.page_result_current,
              true,
              'current_page_result_missing',
            );
            assert.equal(report.saved_result.panel_old, false, 'old_row_visible');
            const observed = await readPassiveWorkerProbe(worker);
            assert.ok(Array.isArray(observed), 'worker_probe_lost');
            report.contexts = observed.filter((event) => event.kind !== 'binding');
            report.binding_events = observed.filter((event) => event.kind === 'binding');
            report.trace_assessment = assessD47Trace(observed, {
              origin,
              oldPageContext,
              expectedBodySha256: createHash('sha256')
                .update(
                  JSON.stringify({
                    events: [{ eventName: 'Canyon Frequency' }],
                    document: 'current',
                  }),
                )
                .digest('hex'),
            });
            assert.equal(report.trace_assessment.ok, true, report.trace_assessment.reason);
            report.verdicts.current_saved_replay = 'pass';
            report.verdicts.stale_only_refusal = 'pass';
            report.verdicts.fresh_recovery = 'pass';
            report.verdicts.delayed_old_binding = 'architecturally_excluded_observed';
            return;
          }
          stage('current_http');
          await waitFor(
            responseOrder === 'old-first' ? 'current_request_pending' : 'current_response',
            () => status(origin),
            (value) =>
              value?.target_requests === 2 &&
              value.response_order === responseOrder &&
              (responseOrder === 'old-first'
                ? value.current_pending === true &&
                  value.current_response_sent === false &&
                  value.old_pending === true &&
                  value.response_finish_order.length === 0
                : value.current_response_finished === true &&
                  value.response_finish_order[0] === 'current'),
          );
          report.fixture = { before_release: await status(origin) };
          stage('release_old_http');
          const release = await control(origin, 'release-old');
          report.fixture.release_http_status = release.status;
          report.fixture.after_release = await status(origin);
          report.fixture.observed_response_finish_order =
            report.fixture.after_release.response_finish_order;
          if (responseOrder === 'old-first') {
            assert.equal(release.status, 200, 'old_pending_release_failed');
            assert.equal(report.fixture.after_release.old_release_prestate, 'pending');
            assert.deepEqual(report.fixture.after_release.response_finish_order, ['old']);
            assert.equal(report.fixture.after_release.current_pending, true);
            const currentRelease = await control(origin, 'release-current');
            assert.equal(currentRelease.status, 200, 'current_pending_release_failed');
            report.fixture.after_current_release = await status(origin);
            assert.deepEqual(report.fixture.after_current_release.response_finish_order, [
              'old',
              'current',
            ]);
            report.fixture.observed_response_finish_order =
              report.fixture.after_current_release.response_finish_order;
          } else if (report.fixture.after_release.old_response_finished) {
            assert.deepEqual(report.fixture.after_release.response_finish_order, [
              'current',
              'old',
            ]);
          } else {
            assert.deepEqual(report.fixture.after_release.response_finish_order, ['current']);
          }
          assert.equal(
            report.fixture.before_release.old_pending ||
              report.fixture.before_release.old_response_aborted,
            true,
            'old_request_lifecycle_missing',
          );
          assert.equal(
            (report.fixture.after_current_release ?? report.fixture.after_release)
              .current_response_sent,
            true,
            'current_http_response_missing',
          );
          assert.equal(
            report.fixture.after_release.old_response_finished ||
              (['current-first', 'manual-prior'].includes(responseOrder) &&
                report.fixture.after_release.old_response_aborted),
            true,
            'old_http_terminal_missing',
          );
          assert.equal(
            release.status,
            report.fixture.after_release.old_response_finished ? 200 : 409,
            'old_release_status_mismatch',
          );
          if (responseOrder === 'manual-prior') {
            report.manual_prior.current_trace_before_release = await waitFor(
              'current_binding_before_manual_release',
              async () =>
                assessD47Trace(await readPassiveWorkerProbe(worker), {
                  origin,
                  oldPageContext,
                  expectedBodySha256: createHash('sha256')
                    .update(
                      JSON.stringify({
                        events: [{ eventName: 'Canyon Frequency' }],
                        document: 'current',
                      }),
                    )
                    .digest('hex'),
                }),
              (value) => value?.ok === true,
            );
            stage('release_manual_origin');
            const manualRelease = await control(origin, 'release-manual');
            report.manual_prior.release_http_status = manualRelease.status;
            report.manual_prior.after_release = await status(origin);
            assert.equal(
              report.manual_prior.after_release.manual_pending_finished ||
                report.manual_prior.after_release.manual_pending_aborted,
              true,
              'manual_request_lifecycle_missing',
            );
            assert.equal(
              manualRelease.status,
              report.manual_prior.after_release.manual_pending_finished ? 200 : 409,
              'manual_release_status_mismatch',
            );
          }
          stage('saved_terminal_result');
          report.terminal_observation = {
            sample_count: 0,
            first: null,
            last: null,
            started_at_elapsed_ms: performance.now() - observationStarted,
          };
          await waitD47SavedTerminal({
            budget: terminalBudget,
            read: async () =>
              evaluate(
                panel,
                `(() => {
            const saved = (${readD47SavedResult.toString()})(document, ${JSON.stringify(recipe)});
            const run = (${readD47SavedRunState.toString()})(document, ${JSON.stringify(recipe)});
            return {
              ...saved,
              ...run
            };
          })()`,
              ),
            record: (observation) => {
              report.terminal_observation.sample_count++;
              report.terminal_observation.first ??= observation;
              report.terminal_observation.last = observation;
            },
          });
          report.saved_result = {
            page_phase_current: (await page.locator('#phase').textContent()) === 'current',
            page_result_current:
              (await page.locator('#result').textContent()) === 'Canyon Frequency',
            panel_current: (await panelText(panel))?.includes('Canyon Frequency') ?? false,
            panel_old: (await panelText(panel))?.includes('Moonlit Transit') ?? false,
          };
          assert.equal(report.saved_result.page_phase_current, true, 'current_page_phase_missing');
          assert.equal(
            report.saved_result.page_result_current,
            true,
            'current_page_result_missing',
          );
          if (responseOrder !== 'manual-prior')
            assert.equal(report.saved_result.panel_old, false, 'old_row_visible');
          stage('binding_evidence');
          const observed = await readPassiveWorkerProbe(worker);
          assert.ok(Array.isArray(observed), 'worker_probe_lost');
          report.contexts = observed.filter((event) => event.kind !== 'binding');
          report.binding_events = observed.filter((event) => event.kind === 'binding');
          const expectedBodySha256 = createHash('sha256')
            .update(
              JSON.stringify({ events: [{ eventName: 'Canyon Frequency' }], document: 'current' }),
            )
            .digest('hex');
          report.trace_assessment = assessD47Trace(observed, {
            origin,
            oldPageContext,
            expectedBodySha256,
          });
          assert.equal(report.trace_assessment.ok, true, report.trace_assessment.reason);
          report.current_packet_before_commit =
            report.trace_assessment.current_packet_before_commit;
          report.verdicts.current_saved_replay = report.saved_result.panel_current
            ? 'pass'
            : 'unverified';
          report.verdicts.delayed_old_binding = 'architecturally_excluded_observed';
          if (responseOrder === 'manual-prior') {
            assert.equal(report.manual_prior?.exact_request_rows, 1, 'manual_list_request_missing');
            assert.equal(
              report.terminal_observation.last?.current_row,
              true,
              'current_saved_row_missing',
            );
            assert.equal(
              report.terminal_observation.last?.old_row,
              false,
              'manual_prior_contaminated_saved_result',
            );
            report.verdicts.manual_prior_isolation = 'observed_bounded';
          }
        }),
      ),
  });
  assert.equal(native.verified, true);
  report.status = 'observed_bounded';
} catch (error) {
  report.failure_code = `${report.stage}_failed`;
  report.failure = sanitizeD47Failure(error, report.stage);
  report.diagnostics = {
    fixture: report.fixture
      ? {
          before_release: report.fixture.before_release,
          after_release: report.fixture.after_release,
        }
      : null,
    saved_result: report.saved_result,
    trace_assessment: report.trace_assessment ?? null,
    save_observation: saveObservation,
    save_click: saveClickEvidence,
    patterns_observation: patternsObservation,
    native_stage: report.native_stage ?? null,
    auth_stage: report.auth_stage ?? null,
  };
  try {
    if (probeInstallAttempted && probeWorker) {
      const observed = await readPassiveWorkerProbe(probeWorker);
      report.diagnostics.probe = {
        event_count: observed?.length ?? 0,
        last_kinds: observed?.slice(-8).map((event) => event.kind) ?? [],
      };
    }
  } catch {
    report.diagnostics.probe = { state: 'unavailable' };
  }
  try {
    if (activePanel)
      report.diagnostics.panel = await evaluate(
        activePanel,
        `(() => ({ has_save: [...document.querySelectorAll('button')].some(x => x.textContent.trim() === 'Save pattern'), discovering: document.body.innerText.includes('● page load —'), has_recipe_result: document.body.innerText.includes('Last run:'), has_current: document.body.innerText.includes('Canyon Frequency') }))()`,
      );
  } catch {
    report.diagnostics.panel = { state: 'unavailable' };
  }
  process.stderr.write(`UNVERIFIED showcase_d47 stage=${report.stage}\n`);
  process.exitCode = 1;
} finally {
  if (probeWorker)
    report.probe_cleanup = await cleanupD47Probe(
      probeWorker,
      probeInstallAttempted,
      removePassiveWorkerProbe,
    );
  await stopFixture();
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}
