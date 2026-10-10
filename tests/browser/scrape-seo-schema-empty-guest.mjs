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
        await resourceAction(() =>
          click(panel, 'title', 'Capture the page exactly as it is right now'),
        );
        const ready = await waitFor(
          'scrape_empty_capture_ready',
          () =>
            evaluate(
              panel,
              `(() => {
          const selected = [...document.querySelectorAll('[role="tablist"] [role="tab"]')].filter(node => node.getAttribute('aria-selected') === 'true');
          return { count: selected.length, article: selected[0]?.firstChild?.textContent?.trim() === 'Article', title: document.querySelector('.truncate.text-sm.font-medium')?.textContent?.trim() ?? null };
        })()`,
            ),
          (state) => state?.count === 1 && state.article && state.title === title,
        );
        assert.equal(ready.title, title, 'scrape_empty_capture_title_mismatch');
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
