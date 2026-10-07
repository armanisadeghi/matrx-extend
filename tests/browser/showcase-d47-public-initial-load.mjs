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
import {
  assessPublicRacePreflight,
  createPublicRacePreflight,
  installPublicCaptureProbe,
} from './showcase-d47-public-race-preflight.mjs';
import { readD47SavedRunState } from './showcase-d47-saved-result.mjs';
import { deriveD47TerminalBudget, terminalBudgetPaths } from './showcase-d47-terminal-budget.mjs';
import { runShowcaseOrganizationCheckpoint } from './showcase-organization-checkpoint.mjs';

const repo = resolve(import.meta.dirname, '../..');
const pageUrl = 'https://hn.algolia.com/?q=OpenAI';
const siteHost = 'hn.algolia.com';
const output =
  process.env.MATRX_SHOWCASE_OUTPUT ?? join(tmpdir(), `showcase-d47-public-${randomUUID()}.json`);

export function publicTrustedClick(panel, target, report) {
  return trustedD47PanelClick(panel, target, (observation) => {
    report.click_observations.push({ stage: report.stage, ...observation });
  });
}

// The row labels are already shortened by NetworkTab. Keep them in memory only
// for the trusted click; the receipt gets counts and booleans, never row text.
export async function inspectPublicCaptureCandidates(panel, report) {
  const observed = await evaluate(
    panel,
    `(() => {
      const rows = [...document.querySelectorAll('button.font-mono:has(span.flex-1)')];
      const text = rows.map((row) => row.textContent.trim());
      const post200 = (value) => value.includes('POST') && value.includes('200');
      const host = (value) => value.toLowerCase().includes('algolia');
      const path = (value) => value.includes('queries');
      return {
        counts: {
          visible_rows: rows.length,
          post_200_rows: text.filter(post200).length,
          algolia_rows: text.filter(host).length,
          algolia_post_200_rows: text.filter((value) => post200(value) && host(value)).length,
          query_label_rows: text.filter(path).length,
          exact_candidates: text.filter((value) => post200(value) && host(value) && path(value)).length,
        },
        candidates: text.filter((value) => post200(value) && host(value)),
      };
    })()`,
  );
  report.capture_observations ??= {};
  report.capture_observations.list = observed.counts;
  return observed.candidates;
}

// HN's public bundle initializes application UJ5WYC0L7X. Its search client
// uses the DSN host with the three numbered Algolia fallback hosts.
const publicSearchHosts = [
  'uj5wyc0l7x-dsn.algolia.net',
  'uj5wyc0l7x-1.algolianet.com',
  'uj5wyc0l7x-2.algolianet.com',
  'uj5wyc0l7x-3.algolianet.com',
];

export async function readSelectedCapture(panel, candidate, report) {
  return waitFor(
    'public_capture_selection',
    async () => {
      const preview = await evaluate(
        panel,
        `(() => {
          const rows = [...document.querySelectorAll('button.font-mono:has(span.flex-1)')];
          const selected = rows.filter(row => row.classList.contains('ring-1'));
          const input = document.querySelector('#network-replay-url-filter');
          const box = input?.closest('.space-y-2');
          const fullUrl = box?.querySelector('.font-mono.break-all')?.textContent.trim() ?? '';
          let selectedUrl = null;
          try { selectedUrl = new URL(fullUrl); } catch {}
          const text = box?.innerText ?? '';
          const names = [...document.querySelectorAll('label')].map(el => el.textContent.trim());
          // NetworkTab renders ResultPreview immediately after the selected response box.
          // Its description is clipboard metadata, not visible text.
          const tables = [...(box?.nextElementSibling?.querySelectorAll('table') ?? [])];
          const headers = tables.length === 1 ? [...tables[0].querySelectorAll('thead th')].map(el => el.textContent.trim()) : [];
          const resultRows = tables.length === 1 ? [...tables[0].querySelectorAll('tbody tr')] : [];
          const cells = resultRows.length === 1 ? [...resultRows[0].querySelectorAll('td')] : [];
          const cell = name => cells[headers.indexOf(name)]?.textContent.trim() ?? '';
          let hits = null;
          try { hits = JSON.parse(cell('hits')); } catch {}
          const pathname = selectedUrl?.pathname ?? '';
          const paths = ['/1/indexes/Item_dev/query', '/1/indexes/Item_dev_sort_date/query'];
          const endpointShape = paths.includes(pathname) ? pathname
            : pathname === '/1/indexes/*/queries' ? 'multi_index_queries'
            : /^\\/1\\/indexes\\/[^/]+\\/query$/.test(pathname) ? 'other_single_index_query'
            : selectedUrl ? 'other_path' : 'invalid_url';
          return {
            selected_rows: selected.length,
            selected_row_matches: selected.length === 1 && selected[0].textContent.trim() === ${JSON.stringify(candidate)},
            preview_url_matches: Boolean(fullUrl) && fullUrl === input?.value,
            post_200: text.includes('POST · 200'),
            target_host: selectedUrl?.protocol === 'https:' && ${JSON.stringify(publicSearchHosts)}.includes(selectedUrl?.host),
            endpoint_shape: endpointShape,
            endpoint_path_segments: pathname.split('/').filter(Boolean).length,
            endpoint_has_query: Boolean(selectedUrl?.search),
            query_endpoint: paths.includes(pathname),
            response_tables: tables.length,
            response_rows: resultRows.length,
            intended_query: cell('query') === 'OpenAI',
            hits_preview: Array.isArray(hits) && hits.length > 0 && hits.every(hit => hit && typeof hit === 'object' && !Array.isArray(hit)),
            credential_key_present: names.some(name => name.toLowerCase().includes('x-algolia-api-key')),
            credential_masked: (input?.value ?? '').includes('x-algolia-api-key=[credential]'),
          };
        })()`,
      );
      report.capture_observations.last_preview = preview;
      return preview;
    },
    (preview) => preview.selected_row_matches && preview.preview_url_matches,
  );
}

export async function selectPublicCaptureResponse(panel, report) {
  const candidates = await inspectPublicCaptureCandidates(panel, report);
  report.capture_observations.previews = [];
  const matches = [];
  for (const candidate of candidates) {
    await publicTrustedClick(
      panel,
      { selector: 'button.font-mono:has(span.flex-1)', text: candidate },
      report,
    );
    const preview = await readSelectedCapture(panel, candidate, report);
    report.capture_observations.previews.push(preview);
    if (preview.post_200 && preview.target_host && preview.query_endpoint)
      matches.push({ candidate, preview });
  }
  report.capture_observations.matched_previews = matches.length;
  assert.equal(matches.length, 1, 'public_initial_post_ambiguous');
  const match = matches[0];
  if (candidates.at(-1) !== match.candidate)
    await publicTrustedClick(
      panel,
      { selector: 'button.font-mono:has(span.flex-1)', text: match.candidate },
      report,
    );
  const finalPreview = await readSelectedCapture(panel, match.candidate, report);
  report.capture = finalPreview;
  report.capture_observations.preview = finalPreview;
  assert.ok(
    finalPreview.post_200 && finalPreview.target_host && finalPreview.query_endpoint,
    'public_initial_selection_mismatch',
  );
  assert.equal(finalPreview.intended_query, true, 'public_initial_query_mismatch');
  assert.equal(finalPreview.hits_preview, true, 'public_initial_response_missing');
  return finalPreview;
}

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

async function removeOwnedRecipe(panel, recipe, report) {
  await tab(panel, 'Showcase (admin only)');
  await publicTrustedClick(
    panel,
    {
      selector: '[role="tablist"] [role="tab"]',
      text: 'Patterns',
    },
    report,
  );
  const before = await waitFor(
    'public_recipe_cleanup_list',
    () => exactRecipeVisible(panel, recipe),
    (state) => state?.exact_row === true,
  );
  assert.equal(before.exact_row, true, 'owned_recipe_cleanup_row_missing');
  await publicTrustedClick(
    panel,
    {
      selector: 'button[title], button[data-matrx-title]',
      patternName: recipe,
      expectedHost: siteHost,
      semanticTitle: 'Delete pattern',
    },
    report,
  );
  await waitFor(
    'public_recipe_delete_confirmation',
    () =>
      evaluate(
        panel,
        `(() => [...document.querySelectorAll('[role="alertdialog"]')].filter(el => el.getAttribute('data-state') === 'open').map(el => el.querySelector('[data-slot="alert-dialog-title"]')?.textContent.trim()))()`,
      ),
    (titles) => titles?.length === 1 && titles[0] === `Delete the pattern "${recipe}"?`,
  );
  await publicTrustedClick(
    panel,
    {
      selector: '[role="alertdialog"] button',
      text: 'Delete pattern',
    },
    report,
  );
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
    capture_observations: {},
    saved_result: null,
    owned_recipe: null,
    click_observations: [],
    failure: null,
  };
  let ownedRecipe;
  const racePreflight = process.env.MATRX_D47_PUBLIC_RACE_PREFLIGHT === '1';
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
        attachWorker,
      }) => {
        let primary;
        let interception;
        let captureProbe;
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
          await publicTrustedClick(
            panel,
            {
              selector: '[role="tablist"] [role="tab"]',
              text: 'Network',
            },
            report,
          );
          await click(panel, 'button-text', 'Capture page load');
          await allow(panel);
          await waitFor(
            'public_capture_terminal',
            async () => {
              const state = await evaluate(
                panel,
                `(() => ({
            discovering: Boolean(document.querySelector('[role="status"]')?.textContent.includes('Capturing page load') || document.body.innerText.includes('● page load —')),
            responses: document.body.innerText.includes('responses captured · stopped') || document.body.innerText.includes('response captured · stopped'),
            error: Boolean(document.querySelector('.text-destructive'))
          }))()`,
              );
              report.capture_observations.terminal = state;
              return state;
            },
            discoveryTerminal,
            30000,
          );
          const response = await selectPublicCaptureResponse(panel, report);
          // An unknown query credential key must be marked before persistence.
          if (response.credential_key_present) {
            const credential = await evaluate(
              panel,
              `(() => { const el = document.querySelector('input[aria-label="Treat x-algolia-api-key as credential"]'); return { present: Boolean(el), checked: el?.checked ?? false }; })()`,
            );
            assert.equal(credential.present, true, 'public_credential_control_missing');
            if (!credential.checked)
              await publicTrustedClick(
                panel,
                {
                  selector: 'input[aria-label="Treat x-algolia-api-key as credential"]',
                },
                report,
              );
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
          await publicTrustedClick(
            panel,
            {
              selector: '[role="tablist"] [role="tab"]',
              text: 'Patterns',
            },
            report,
          );
          await waitFor(
            'public_recipe_visible',
            () => exactRecipeVisible(panel, ownedRecipe),
            (state) => state?.exact_row === true,
          );
          report.owned_recipe.creation = 'observed_in_patterns';
          report.stage = 'saved_replay';
          if (racePreflight) {
            report.stage = 'public_race_interception_setup';
            interception = await createPublicRacePreflight(page, report, response.endpoint_shape);
            captureProbe = await installPublicCaptureProbe(await attachWorker(), page.url());
            // This ordinary public page load starts the prior document's real
            // Algolia request before the saved replay owns a new navigation.
            report.stage = 'public_race_prior_document_load';
            await resourceAction(() => page.reload({ waitUntil: 'commit' }));
            await interception.oldPaused();
            assert.equal(new URL(page.url()).host, siteHost, 'public_race_old_host_mismatch');
            const beforeRun = await exactRecipeVisible(panel, ownedRecipe);
            interception.facts.old_paused_before_replay =
              beforeRun.exact_row === true &&
              beforeRun.running === false &&
              interception.facts.paused[0]?.lifecycle === 'pending';
            assert.equal(
              interception.facts.old_paused_before_replay,
              true,
              'public_race_old_not_prior_to_replay',
            );
          }
          report.stage = 'saved_replay';
          await publicTrustedClick(
            panel,
            {
              selector: 'button[title], button[data-matrx-title]',
              patternName: ownedRecipe,
              expectedHost: siteHost,
              semanticTitle: 'Run pattern',
            },
            report,
          );
          await allow(panel);
          if (racePreflight) {
            report.stage = 'public_race_current_paused';
            await interception.currentPaused();
            interception.facts.extension_capture_at_current_pause = await captureProbe.attest();
            report.stage = 'public_race_release';
            await interception.releaseInOrder();
            await requireResourceHealth();
            const current = interception.facts.paused[1];
            const currentContext = interception.facts.contexts.find(
              (context) => context.loader_id === current.loader_id,
            );
            const binding = await waitFor(
              'public_current_binding_packet',
              () => captureProbe.packets(),
              (packets) =>
                packets.some(
                  (packet) =>
                    packet.context_unique_id === currentContext?.unique_id &&
                    packet.url_sha256 === current.url_sha256 &&
                    packet.request_body_key === `sha256:${current.body_sha256}` &&
                    packet.response_sha256 === current.response_sha256 &&
                    packet.request_sequence >= 1,
                ),
              budget.timeout_ms,
            );
            interception.facts.current_binding_matches_response = binding.some(
              (packet) =>
                packet.context_unique_id === currentContext?.unique_id &&
                packet.url_sha256 === current.url_sha256 &&
                packet.request_body_key === `sha256:${current.body_sha256}` &&
                packet.response_sha256 === current.response_sha256 &&
                packet.request_sequence >= 1,
            );
            report.stage = 'saved_terminal';
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
                return { ...combined, outcome: classifyPublicReplay(combined) };
              },
              (state) => state?.outcome !== 'unverified',
              budget.timeout_ms,
            );
            report.saved_result = terminal;
            interception.facts.terminal_outcome = terminal.outcome;
            report.status =
              terminal.outcome === 'captured_initial_request'
                ? 'observed_bounded'
                : 'honest_guidance_observed';
          } else {
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
                observations.push({
                  elapsed_ms: performance.now() - started,
                  ...combined,
                  outcome,
                });
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
          }
        } catch (error) {
          primary = error;
        } finally {
          if (captureProbe) {
            try {
              await captureProbe.cleanup();
              interception.facts.capture_probe_cleanup = 'removed_detached';
            } catch {
              interception.facts.capture_probe_cleanup = 'unverified';
              primary ??= new Error('public_capture_probe_cleanup_failed');
            }
          }
          if (interception) {
            try {
              await interception.cleanup();
              report.public_race_preflight.verdict = assessPublicRacePreflight(interception.facts);
              if (
                racePreflight &&
                ![
                  'prior_document_released_current_verified',
                  'prior_document_cancelled_current_verified',
                ].includes(report.public_race_preflight.verdict)
              )
                primary ??= new Error('public_race_preflight_unverified');
            } catch {
              primary ??= new Error('public_race_interception_cleanup_failed');
            }
          }
          if (ownedRecipe) {
            try {
              report.owned_recipe.cleanup = await removeOwnedRecipe(panel, ownedRecipe, report);
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
