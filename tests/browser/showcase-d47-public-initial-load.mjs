#!/usr/bin/env node
/** Installed-extension public HN initial-load Network recipe; no synthetic page requests. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { approvedAdminOrganizationName, signInSettings } from './settings-native-auth-driver.mjs';
import { click, evaluate, waitFor } from './settings-panel-driver.mjs';
import {
  discoveryTerminal,
  sanitizeD47Failure,
  trustedD47PanelClick,
} from './showcase-d47-driver-evidence.mjs';
import { readD47SavedRunState } from './showcase-d47-saved-result.mjs';
import { deriveD47TerminalBudget, terminalBudgetPaths } from './showcase-d47-terminal-budget.mjs';
import { runShowcaseOrganizationCheckpoint } from './showcase-organization-checkpoint.mjs';

const repo = resolve(import.meta.dirname, '../..');
const pageUrl = 'https://hn.algolia.com/?q=OpenAI';
const siteHost = 'hn.algolia.com';
const output =
  process.env.MATRX_SHOWCASE_OUTPUT ?? join(tmpdir(), `showcase-d47-public-${randomUUID()}.json`);

// The only two acceptable terminal observations: actual exact-recipe rows, or
// the product's specific no-match remedy after its document-start capture.
export function classifyPublicReplay(observation) {
  if (
    observation?.exact_row !== true ||
    observation.running !== false ||
    observation.unavailable !== false
  )
    return 'unverified';
  if (observation.error && observation.last_run_exact) return 'unverified';
  if (observation.last_run_exact && observation.hits_rows && !observation.error)
    return 'captured_initial_request';
  if (
    !observation.last_run_exact &&
    !observation.hits_rows &&
    observation.no_match_guidance &&
    observation.error
  )
    return 'honest_retrigger_guidance';
  return 'unverified';
}

function panelObservation(doc, recipe, host) {
  const visible = (el) =>
    Boolean(el?.getClientRects().length) &&
    doc.defaultView.getComputedStyle(el).visibility === 'visible';
  const tab = [...doc.querySelectorAll('[role="tablist"] [role="tab"]')].find(
    (el) => el.textContent.trim() === 'Patterns',
  );
  const pane = tab ? doc.getElementById(tab.getAttribute('aria-controls') ?? '') : null;
  const active =
    tab?.getAttribute('data-state') === 'active' &&
    pane?.getAttribute('data-state') === 'active' &&
    visible(pane);
  const named = active
    ? [...pane.querySelectorAll('span.truncate.text-sm.font-medium')].filter(
        (el) => el.textContent.trim() === recipe && visible(el),
      )
    : [];
  const row = named.length === 1 ? named[0].closest('div.group') : null;
  const run = row
    ? [...row.querySelectorAll('button')].find(
        (button) =>
          (button.getAttribute('title') ?? button.getAttribute('data-matrx-title')) ===
            'Run pattern' && visible(button),
      )
    : null;
  const header = active
    ? [...pane.querySelectorAll('div')].find(
        (el) =>
          el.childElementCount === 0 &&
          el.textContent.trim().startsWith('Last run:') &&
          visible(el),
      )
    : null;
  const lastRunExact = header?.textContent.trim() === `Last run: ${recipe}`;
  const preview = lastRunExact ? header.nextElementSibling : null;
  const table =
    preview && visible(preview) ? [...preview.querySelectorAll('table')].filter(visible) : [];
  const headings =
    table.length === 1
      ? [...table[0].querySelectorAll('thead th')].map((th) => th.textContent.trim())
      : [];
  const rows = table.length === 1 ? [...table[0].querySelectorAll('tbody tr')].filter(visible) : [];
  const hitsIndex = headings.includes('hits')
    ? headings.indexOf('hits')
    : headings.indexOf('results');
  const hitsCell =
    hitsIndex >= 0 && rows.length === 1
      ? rows[0].querySelectorAll('td')[hitsIndex]?.textContent.trim()
      : '';
  const errors = active
    ? [...pane.querySelectorAll('.text-destructive')]
        .filter((el) => visible(el) && !el.closest('div.group'))
        .map((el) => el.textContent.trim())
        .filter(Boolean)
    : [];
  const noMatch =
    errors.length === 1 &&
    /No successful request matching/.test(errors[0]) &&
    /Document-start interception was armed before reload/.test(errors[0]) &&
    /Run again and interact with the page/.test(errors[0]);
  return {
    patterns_active: Boolean(active),
    host_matches: Boolean(active && pane.textContent.includes(`All saved patterns for ${host}`)),
    loading: Boolean(active && pane.querySelector('button[title="Refresh"] .animate-spin')),
    exact_row: Boolean(active && named.length === 1 && run),
    running: Boolean(run?.querySelector('.animate-spin')),
    unavailable: !run || (run.disabled && !run.querySelector('.animate-spin')),
    last_run_exact: Boolean(lastRunExact),
    hits_rows: Boolean(
      lastRunExact &&
        table.length === 1 &&
        rows.length === 1 &&
        hitsCell?.startsWith('[{') &&
        hitsCell.includes('"title"'),
    ),
    no_match_guidance: noMatch,
    error: errors.length > 0,
  };
}

const tab = (panel, name) => click(panel, 'title', name);
const allow = async (panel) => {
  await waitFor(
    'debugger_approval',
    () => evaluate(panel, 'document.body.innerText'),
    (text) => text?.includes('Allowing this uses Chrome debugger'),
  );
  await click(panel, 'button-text', 'Allow');
};

async function exactRecipeVisible(panel, recipe) {
  return evaluate(
    panel,
    `(() => (${panelObservation.toString()})(document, ${JSON.stringify(recipe)}, ${JSON.stringify(siteHost)}))()`,
  );
}

async function removeOwnedRecipe(panel, recipe) {
  await tab(panel, 'Showcase (admin only)');
  await trustedD47PanelClick(panel, {
    selector: '[role="tablist"] [role="tab"]',
    text: 'Patterns',
  });
  const before = await waitFor(
    'public_recipe_cleanup_list',
    () => exactRecipeVisible(panel, recipe),
    (state) => state?.exact_row === true,
  );
  assert.equal(before.exact_row, true, 'owned_recipe_cleanup_row_missing');
  await trustedD47PanelClick(panel, {
    selector: 'button[title], button[data-matrx-title]',
    patternName: recipe,
    expectedHost: siteHost,
    semanticTitle: 'Delete pattern',
  });
  await waitFor(
    'public_recipe_delete_confirmation',
    () =>
      evaluate(
        panel,
        `(() => [...document.querySelectorAll('[role="alertdialog"]')].filter(el => el.getAttribute('data-state') === 'open').map(el => el.querySelector('[data-slot="alert-dialog-title"]')?.textContent.trim()))()`,
      ),
    (titles) => titles?.length === 1 && titles[0] === `Delete the pattern "${recipe}"?`,
  );
  await trustedD47PanelClick(panel, {
    selector: '[role="alertdialog"] button',
    text: 'Delete pattern',
  });
  await waitFor(
    'public_recipe_removed',
    () => exactRecipeVisible(panel, recipe),
    (state) =>
      state?.patterns_active === true &&
      state?.host_matches === true &&
      state?.loading === false &&
      state?.error === false &&
      state?.exact_row === false,
  );
  return 'removed';
}

async function run() {
  const report = {
    schema_version: 1,
    case_id: 'EXT-F-1012-T57',
    defect_id: 'EXT-D-0047',
    status: 'unverified',
    stage: 'inputs',
    target: { host: siteHost, public: true, injected_fetch: false },
    artifact: null,
    capture: null,
    saved_result: null,
    owned_recipe: null,
    failure: null,
  };
  let ownedRecipe;
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
    assert.equal(
      JSON.parse(await readFile(join(extensionDir, 'manifest.json'), 'utf8')).version,
      receipt.version,
    );
    report.artifact = {
      source_sha: process.env.MATRX_SHOWCASE_CI_SOURCE_SHA,
      run_id: Number(process.env.MATRX_SHOWCASE_CI_RUN_ID),
      artifact_id: Number(process.env.MATRX_SHOWCASE_CI_ARTIFACT_ID),
      tree_sha256: receipt.treeSha256,
      version: receipt.version,
    };
    const sources = Object.fromEntries(
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
    const budget = deriveD47TerminalBudget(sources);
    report.terminal_budget = budget;
    report.stage = 'native';
    const native = await runNativeSidepanelQa({
      headed: true,
      extensionDir,
      localDevReceiptPath: receiptPath,
      expectedRelease: receipt,
      artifactRoot: join(process.env.RUNNER_TEMP ?? tmpdir(), 'guest-acceptance'),
      onStage: (stage) => {
        report.native_stage = stage;
      },
      exercisePanel: async ({
        page,
        panel,
        resourceAction,
        requireResourceHealth,
        reopenPanel,
      }) => {
        let primary;
        try {
          report.stage = 'signin';
          const auth = await resourceAction(() =>
            signInSettings({
              mode: 'admin',
              page,
              panel,
              repo,
              adminCredentialsFile: process.env.MATRX_PREPARE_ADMIN_CREDENTIALS_FILE,
              onStage: (stage) => {
                report.auth_stage = stage;
              },
            }),
          );
          assert.equal(auth.admin_role, true);
          report.stage = 'organization';
          await runShowcaseOrganizationCheckpoint({
            panel,
            auth,
            resourceAction,
            report,
            requiredOrganizationName,
          });
          await resourceAction(() => reopenPanel());
          report.stage = 'public_page';
          await resourceAction(() => page.goto(pageUrl));
          assert.equal(new URL(page.url()).host, siteHost, 'public_target_host_mismatch');
          await requireResourceHealth();
          report.stage = 'initial_capture';
          await tab(panel, 'Showcase (admin only)');
          await trustedD47PanelClick(panel, {
            selector: '[role="tablist"] [role="tab"]',
            text: 'Network',
          });
          await click(panel, 'button-text', 'Capture page load');
          await allow(panel);
          await waitFor(
            'public_capture_terminal',
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
            30000,
          );
          const candidates = await evaluate(
            panel,
            `(() => [...document.querySelectorAll('button.font-mono:has(span.flex-1)')].filter(el => el.textContent.includes('POST') && el.textContent.includes('200') && el.textContent.toLowerCase().includes('algolia') && el.textContent.includes('queries')).map(el => el.textContent.trim()))()`,
          );
          assert.equal(candidates.length, 1, 'public_initial_post_ambiguous');
          await trustedD47PanelClick(panel, {
            selector: 'button.font-mono:has(span.flex-1)',
            text: candidates[0],
          });
          const response = await evaluate(
            panel,
            `(() => {
            const input = document.querySelector('#network-replay-url-filter');
            const box = input?.closest('.space-y-2');
            const text = box?.innerText ?? '';
            const names = [...document.querySelectorAll('label')].filter(el => el.textContent.trim().startsWith('Treat ')).map(el => ({ name: el.textContent.trim(), checked: el.querySelector('input')?.checked }));
            return { post_200: text.includes('POST · 200'), query_endpoint: (input?.value ?? '').includes('/1/indexes/*/queries'), hits_preview: text.includes('hits') && document.body.innerText.includes('rows extracted'), credential_key_present: names.some(el => el.name.toLowerCase().includes('x-algolia-api-key')), credential_masked: (input?.value ?? '').includes('x-algolia-api-key=[credential]') };
          })()`,
          );
          report.capture = response;
          assert.equal(
            response.post_200 && response.query_endpoint && response.hits_preview,
            true,
            'public_initial_response_missing',
          );
          // An unknown query credential key must be marked before persistence.
          if (response.credential_key_present) {
            const credential = await evaluate(
              panel,
              `(() => { const el = document.querySelector('input[aria-label="Treat x-algolia-api-key as credential"]'); return { present: Boolean(el), checked: el?.checked ?? false }; })()`,
            );
            assert.equal(credential.present, true, 'public_credential_control_missing');
            if (!credential.checked)
              await trustedD47PanelClick(panel, {
                selector: 'input[aria-label="Treat x-algolia-api-key as credential"]',
              });
            const masked = await evaluate(
              panel,
              `(() => (document.querySelector('#network-replay-url-filter')?.value ?? '').includes('x-algolia-api-key=[credential]'))()`,
            );
            assert.equal(masked, true, 'public_credential_not_masked');
          }
          report.stage = 'save_recipe';
          await click(panel, 'button-text', 'Save pattern');
          ownedRecipe = `Codex D47 public HN ${randomUUID()}`;
          report.owned_recipe = {
            name: ownedRecipe,
            host: siteHost,
            creation: 'attempted',
            cleanup: 'unverified',
          };
          await click(panel, 'save-pattern-name', 'Save pattern');
          const modifier = process.platform === 'darwin' ? 4 : 2;
          await panel.send('Input.dispatchKeyEvent', {
            type: 'keyDown',
            key: 'a',
            code: 'KeyA',
            modifiers: modifier,
            windowsVirtualKeyCode: 65,
            commands: ['selectAll'],
          });
          await panel.send('Input.dispatchKeyEvent', {
            type: 'keyUp',
            key: 'a',
            code: 'KeyA',
            modifiers: modifier,
            windowsVirtualKeyCode: 65,
          });
          await panel.send('Input.insertText', { text: ownedRecipe });
          await waitFor(
            'public_name',
            () =>
              evaluate(
                panel,
                `(() => [...document.querySelectorAll('[data-radix-popper-content-wrapper] input')].some(el => el.value === ${JSON.stringify(ownedRecipe)}))()`,
              ),
            (value) => value === true,
          );
          await click(panel, 'button-text', 'Save');
          await waitFor(
            'public_saved',
            () =>
              evaluate(
                panel,
                `(() => ![...document.querySelectorAll('[data-radix-popper-content-wrapper]')].some(el => el.querySelector('input') && el.getBoundingClientRect().width > 0))()`,
              ),
            (value) => value === true,
          );
          await trustedD47PanelClick(panel, {
            selector: '[role="tablist"] [role="tab"]',
            text: 'Patterns',
          });
          await waitFor(
            'public_recipe_visible',
            () => exactRecipeVisible(panel, ownedRecipe),
            (state) => state?.exact_row === true,
          );
          report.owned_recipe.creation = 'observed_in_patterns';
          report.stage = 'saved_replay';
          await trustedD47PanelClick(panel, {
            selector: 'button[title], button[data-matrx-title]',
            patternName: ownedRecipe,
            expectedHost: siteHost,
            semanticTitle: 'Run pattern',
          });
          await allow(panel);
          report.stage = 'saved_terminal';
          const started = performance.now();
          const observations = [];
          const terminal = await waitFor(
            'public_saved_terminal',
            async () => {
              const state = await exactRecipeVisible(panel, ownedRecipe);
              const run = await evaluate(
                panel,
                `(() => (${readD47SavedRunState.toString()})(document, ${JSON.stringify(ownedRecipe)}))()`,
              );
              const combined = {
                ...state,
                running: run.running,
                unavailable: run.observation_unavailable,
              };
              const outcome = classifyPublicReplay(combined);
              observations.push({ elapsed_ms: performance.now() - started, ...combined, outcome });
              return { ...combined, outcome };
            },
            (state) => state?.outcome !== 'unverified',
            budget.timeout_ms,
          );
          report.saved_result = { ...terminal, sample_count: observations.length };
          report.status =
            terminal.outcome === 'captured_initial_request'
              ? 'observed_bounded'
              : 'honest_guidance_observed';
        } catch (error) {
          primary = error;
        } finally {
          if (ownedRecipe) {
            try {
              report.owned_recipe.cleanup = await removeOwnedRecipe(panel, ownedRecipe);
            } catch {
              report.owned_recipe.cleanup = 'unverified';
              if (!primary) primary = new Error('owned_recipe_cleanup_failed');
            }
          }
        }
        if (primary) throw primary;
      },
    });
    assert.equal(native.verified, true);
    assert.equal(report.owned_recipe?.cleanup, 'removed', 'owned_recipe_cleanup_unverified');
  } catch (error) {
    report.failure = sanitizeD47Failure(error, report.stage);
    report.status = 'unverified';
    process.exitCode = 1;
  } finally {
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.MATRX_D47_IMPORT_PREFLIGHT === '1')
    process.stdout.write('HOSTED_D47_PUBLIC_DRIVER_IMPORT_READY\n');
  else await run();
}
