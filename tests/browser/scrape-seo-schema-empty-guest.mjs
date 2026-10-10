#!/usr/bin/env node
/** Bounded guest T08 check for truthful no-signal SEO and empty Schema panes. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { tabStateExpression } from './scrape-seo-schema-empty-observation.mjs';
import { assertGuestSeoSchemaEmptyObservation } from './scrape-seo-schema-empty-oracle.mjs';
import { readCaptureExport } from './scrape-tab-coverage.mjs';
import { click, evaluate, waitFor } from './settings-panel-driver.mjs';

const REPO = resolve(import.meta.dirname, '../..');
const extensionDir = process.env.MATRX_SCRAPE_EXTENSION_DIR;
const receiptPath = process.env.MATRX_SCRAPE_RECEIPT;
const title = 'Harbor Dental appointment information';
const fixturePath = '/seo-schema-empty';
const fixtureHtml = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body></body></html>`;
const outputPath = join(REPO, 'test-results', 'scrape-seo-schema-empty-guest-native.json');
const report = {
  schema_version: 1,
  feature_id: 'EXT-F-1007',
  case_id: 'EXT-F-1007-T08',
  subtarget: 'guest_no_signal_seo_and_empty_schema_panes',
  auth_mode: 'guest',
  status: 'unverified',
  stage: 'preflight',
  native_stage: null,
  artifact: null,
  observations: null,
  capture_diagnostic: null,
  failure_code: null,
  limits:
    'One owned localhost guest page; only T08 no-signal SEO and empty Schema panes. No broader T08, role, width, Store, or current-main claim.',
};

function safeFailureCode(error) {
  const code = String(error?.message ?? 'scrape_empty_seo_schema_failed').split(/[:\n]/, 1)[0];
  return /^[a-z][a-z0-9_-]{1,100}$/.test(code) ? code : 'scrape_empty_seo_schema_failed';
}

async function writeReport() {
  await mkdir(join(REPO, 'test-results'), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

async function run() {
  assert.equal(process.env.MATRX_SCRAPE_SCOPE, 'seo-schema-empty', 'scrape_empty_scope_required');
  assert.equal(
    process.env.MATRX_SCRAPE_ARTIFACT_CHANNEL,
    'development',
    'scrape_empty_development_artifact_required',
  );
  assert.equal(process.env.MATRX_SCRAPE_AUTH_MODE, 'guest', 'scrape_empty_guest_required');
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  assert.equal(receipt.kind, 'local_dev_unpacked', 'scrape_empty_ci_receipt_required');
  assert.equal(
    hashReleaseTree(extensionDir),
    receipt.treeSha256,
    'scrape_empty_artifact_tree_mismatch',
  );
  const manifest = JSON.parse(await readFile(join(extensionDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, receipt.version, 'scrape_empty_artifact_version_mismatch');
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
      extensionDir,
      localDevReceiptPath: receiptPath,
      expectedRelease: receipt,
      artifactRoot: join(process.env.RUNNER_TEMP ?? '/tmp', 'guest-acceptance'),
      ownedPages: { [fixturePath]: fixtureHtml },
      onStage: (stage) => {
        report.native_stage = stage;
      },
      exercisePanel: async ({
        page,
        panel,
        browserSession,
        panelTarget,
        requireResourceHealth,
        resourceAction,
      }) => {
        panelRef = panel;
        requireResourceHealthRef = requireResourceHealth;
        resourceActionRef = resourceAction;
        await requireResourceHealth();
        report.browser_version = (await browserSession.send('Browser.getVersion')).product;
        const origin = new URL(page.url()).origin;
        const fixtureUrl = `${origin}${fixturePath}`;
        report.stage = 'owned_fixture';
        await resourceAction(() => page.goto(fixtureUrl, { waitUntil: 'domcontentloaded' }));
        assert.equal(page.url(), fixtureUrl, 'scrape_empty_fixture_url_mismatch');
        assert.equal(
          await page.locator('body').textContent(),
          '',
          'scrape_empty_fixture_body_not_empty',
        );
        assert.equal(
          await page.locator('html').getAttribute('lang'),
          null,
          'scrape_empty_fixture_language_present',
        );
        assert.equal(
          await page.locator('meta[name="description"]').count(),
          0,
          'scrape_empty_fixture_description_present',
        );
        assert.equal(
          await page
            .locator(
              'link[rel="canonical"],meta[property^="og:"],meta[name^="twitter:"],link[rel="alternate"][hreflang],script[type="application/ld+json"],h1,h2,h3,h4,h5,h6,a,img',
            )
            .count(),
          0,
          'scrape_empty_fixture_signal_present',
        );
        report.stage = 'capture';
        await resourceAction(() => click(panel, 'title', 'Scrape'));
        await waitFor(
          'scrape_empty_panel_ready',
          () =>
            evaluate(
              panel,
              `(() => ({
          active: document.querySelector('button[role="tab"][title="Scrape"][data-state="active"]') !== null,
          capture: [...document.querySelectorAll('button[title],button[data-matrx-title]')].some(node => (node.title || node.dataset.matrxTitle) === 'Capture the page exactly as it is right now'),
        }))()`,
            ),
          (state) => state?.active && state.capture,
        );
        const diagnostic = {
          before: null,
          immediate: null,
          immediate_events: null,
          timeout: null,
          pointer_target: null,
          pointer_phase: null,
          pointer_failure: null,
          events: null,
        };
        report.capture_diagnostic = diagnostic;
        const stateExpression = `(() => {
          const outer = [...document.querySelectorAll('button[role="tab"]')].filter(node =>
            (node.title || node.dataset.matrxTitle) === 'Scrape' && node.dataset.state === 'active');
          const controls = outer.length === 1 ? outer[0].getAttribute('aria-controls') : null;
          const pane = controls ? document.getElementById(controls) : null;
          const selected = [...document.querySelectorAll('[role="tablist"] [role="tab"]')]
            .filter(node => node.getAttribute('aria-selected') === 'true');
          const result = selected.length === 1 ? selected[0] : null;
          const resultPane = result ? document.getElementById(result.getAttribute('aria-controls') ?? '') : null;
          const captureButtons = [...document.querySelectorAll('button[title],button[data-matrx-title]')]
            .filter(node => (node.title || node.dataset.matrxTitle) === 'Capture the page exactly as it is right now');
          return {
            capture_match_count: captureButtons.length,
            capture_inside_scrape: captureButtons.length === 1 && Boolean(pane?.contains(captureButtons[0])),
            chat_active: [...document.querySelectorAll('button[role="tab"]')].some(node =>
              (node.title || node.dataset.matrxTitle) === 'Chat' && node.dataset.state === 'active'),
            active_scrape_count: outer.length, scrape_controls_present: Boolean(controls),
            scrape_pane_found: Boolean(pane), scrape_pane_active: pane?.dataset.state === 'active',
            selected_count: selected.length, article: result?.firstChild?.textContent?.trim() === 'Article',
            selected_inside_scrape: Boolean(pane && result && pane.contains(result)),
            result_controls_present: Boolean(result?.getAttribute('aria-controls')),
            result_pane_found: Boolean(resultPane), result_pane_active: resultPane?.dataset.state === 'active',
            title_matches: document.querySelector('.truncate.text-sm.font-medium')?.textContent?.trim() === ${JSON.stringify(title)},
          };
        })()`;
        const probeKey = '__matrxT08CaptureInput';
        const readProbe = `(() => {
          const probe = globalThis[${JSON.stringify(probeKey)}];
          return probe ? probe.events : null;
        })()`;
        let ready;
        try {
          diagnostic.before = await evaluate(panel, stateExpression);
          await evaluate(
            panel,
            `(() => {
            const events = { pointerdown: 0, pointerup: 0, click: 0, trusted_click: 0, capture_click: 0, trusted_capture_click: 0,
              last_target_is_capture: null, last_target_inside_scrape: null };
            const listener = event => {
              const target = event.target instanceof Element ? event.target.closest('button') : null;
              const capture = (target?.title || target?.dataset.matrxTitle) === 'Capture the page exactly as it is right now';
              events[event.type] += 1;
              if (event.type === 'click' && event.isTrusted) events.trusted_click += 1;
              if (event.type === 'click' && capture) {
                events.capture_click += 1;
                if (event.isTrusted) events.trusted_capture_click += 1;
              }
              events.last_target_is_capture = capture;
              const pane = target?.closest('[role="tabpanel"]');
              events.last_target_inside_scrape = Boolean(pane && [...document.querySelectorAll('button[role="tab"]')].some(tab =>
                (tab.title || tab.dataset.matrxTitle) === 'Scrape' && tab.dataset.state === 'active' &&
                tab.getAttribute('aria-controls') === pane.id));
            };
            for (const type of ['pointerdown', 'pointerup', 'click']) document.addEventListener(type, listener, true);
            globalThis[${JSON.stringify(probeKey)}] = { events, listener };
          })()`,
          );
          diagnostic.pointer_target = await resourceAction(() =>
            click(panel, 'title', 'Capture the page exactly as it is right now', (phase) => {
              diagnostic.pointer_phase = phase;
            }),
          );
          diagnostic.immediate = await evaluate(panel, stateExpression);
          diagnostic.immediate_events = await evaluate(panel, readProbe);
          ready = await waitFor(
            'scrape_empty_capture_ready',
            () => evaluate(panel, stateExpression),
            (state) => state?.selected_count === 1 && state.article && state.title_matches,
          );
        } catch (error) {
          diagnostic.pointer_failure = error.driverFailure ?? null;
          diagnostic.timeout = await evaluate(panel, stateExpression).catch(() => null);
          throw error;
        } finally {
          diagnostic.events = await evaluate(panel, readProbe).catch(() => null);
          await evaluate(
            panel,
            `(() => {
            const probe = globalThis[${JSON.stringify(probeKey)}];
            if (probe) for (const type of ['pointerdown', 'pointerup', 'click']) document.removeEventListener(type, probe.listener, true);
            delete globalThis[${JSON.stringify(probeKey)}];
          })()`,
          ).catch(() => {});
        }
        assert.equal(ready.title_matches, true, 'scrape_empty_capture_title_mismatch');
        const panelUrl = panelTarget?.url ?? '';
        const readExport = () =>
          readCaptureExport({
            panel,
            browserSession,
            panelUrl,
            mode: 'guest',
            url: fixtureUrl,
            title,
            resourceAction,
            requireResourceHealth,
          });
        report.stage = 'capture_export_baseline';
        const exports = [await readExport()];
        const seo = await observePane('SEO');
        exports.push(await readExport());
        const schema = await observePane('Schema');
        exports.push(await readExport());
        const verdict = assertGuestSeoSchemaEmptyObservation({
          expectedTitle: title,
          seo,
          schema,
          exports,
        });
        report.observations = {
          case_id: 'EXT-F-1007-T08',
          subtarget: 'guest_no_signal_seo_and_empty_schema_panes',
          fixture:
            'owned localhost; title only; no body, SEO metadata, links, images, headings or JSON-LD',
          seo: {
            visible: seo.visible,
            selected: seo.selected,
            title_matches: seo.titleValue === title,
            description_dash: seo.descriptionValue === '—',
            groups: seo.groups,
          },
          schema: {
            visible: schema.visible,
            selected: schema.selected,
            json_valid: schema.jsonValid,
            metadata_title_matches: schema.metadataTitle === title,
            description_absent: schema.descriptionAbsent,
            canonical_absent: schema.canonicalAbsent,
            og_count: schema.ogCount,
            twitter_count: schema.twitterCount,
            schema_types_count: schema.schemaTypesCount,
            ld_json_count: schema.ldJsonCount,
          },
          export_checks: exports.slice(1).map((entry, index) => ({
            after_pane: index === 0 ? 'SEO' : 'Schema',
            identity_unchanged: entry.identity === exports[0].identity,
            digest_unchanged: entry.digest === exports[0].digest,
          })),
          verdict,
        };
        await requireResourceHealth();
        report.status = 'pass';
        report.stage = 'complete';
      },
    });
  } catch (error) {
    report.status = 'fail';
    report.failure_code = safeFailureCode(error);
  } finally {
    await writeReport();
  }
  if (report.status !== 'pass') process.exitCode = 1;
  else process.stdout.write(`SCRAPE_T08_EMPTY_SEO_SCHEMA ${outputPath}\n`);
}

async function observePane(label) {
  await reportResourceCheck();
  await resourceActionCall(() => click(panelRef, 'scrape-result-tab', label));
  return waitFor(
    `scrape_empty_${label.toLowerCase()}_pane`,
    () => evaluate(panelRef, tabStateExpression(label)),
    (state) => state?.visible && state.selected === label,
  );
}

let panelRef;
let requireResourceHealthRef;
let resourceActionRef;
const reportResourceCheck = () => requireResourceHealthRef();
const resourceActionCall = (action) => resourceActionRef(action);

run().catch(async (error) => {
  report.status = 'fail';
  report.failure_code = safeFailureCode(error);
  await writeReport();
  process.exitCode = 1;
});
