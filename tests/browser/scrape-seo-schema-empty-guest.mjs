#!/usr/bin/env node
/** Bounded guest T08 check for truthful no-signal SEO and empty Schema panes. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { scrapeNativeSelection, selectScrapePanelViewport } from './scrape-native-selection.mjs';
import {
  captureStateExpression,
  isCaptureReady,
  tabStateExpression,
} from './scrape-seo-schema-empty-observation.mjs';
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
const paneScreenshotNames = Object.freeze({
  SEO: 'scrape-t08-seo-pane.png',
  Schema: 'scrape-t08-schema-pane.png',
});
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
  pane_screenshots: null,
  panel_viewport: null,
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
  const selection = scrapeNativeSelection(process.env);
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

  report.imported_artifact = JSON.parse(
    await readFile(process.env.MATRX_SCRAPE_CI_RECEIPT, 'utf8'),
  );
  report.build = { before: { treeSha256: hashReleaseTree(extensionDir) }, after: null };
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
        artifacts,
        requireResourceHealth,
        resourceAction,
      }) => {
        panelRef = panel;
        requireResourceHealthRef = requireResourceHealth;
        resourceActionRef = resourceAction;
        await requireResourceHealth();
        report.native_target = {
          target_id: panelTarget?.targetId,
          type: panelTarget?.type,
          url: panelTarget?.url,
        };
        report.browser_version = (await browserSession.send('Browser.getVersion')).product;
        report.stage = 'panel_viewport';
        report.panel_viewport = await resourceAction(() =>
          selectScrapePanelViewport(panel, selection, evaluate),
        );
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
        const stateExpression = captureStateExpression(title);
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
            (state) => isCaptureReady(state, diagnostic.before, diagnostic.immediate_events),
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
        const seoScreenshot = await captureSelectedPaneScreenshot({
          panel,
          label: 'SEO',
          artifacts,
        });
        exports.push(await readExport());
        const schema = await observePane('Schema');
        const schemaScreenshot = await captureSelectedPaneScreenshot({
          panel,
          label: 'Schema',
          artifacts,
        });
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
        report.pane_screenshots = { SEO: seoScreenshot, Schema: schemaScreenshot };
        await requireResourceHealth();
        report.status = 'pass';
        report.stage = 'complete';
      },
    });
  } catch (error) {
    report.status = 'fail';
    report.failure_code = safeFailureCode(error);
  } finally {
    report.build.after = { treeSha256: hashReleaseTree(extensionDir) };
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

export async function captureSelectedPaneScreenshot({
  panel,
  label,
  artifacts,
  evaluateFn = evaluate,
}) {
  const filename = paneScreenshotNames[label];
  assert.ok(filename, 'scrape_empty_unknown_screenshot_pane');
  const target = await evaluateFn(
    panel,
    `(() => {
    const outer = [...document.querySelectorAll('button[role="tab"][title="Scrape"][data-state="active"]')];
    const scrape = outer.length === 1 ? document.getElementById(outer[0].getAttribute('aria-controls')) : null;
    const tabs = [...(scrape?.querySelectorAll('[role="tablist"] [role="tab"]') ?? [])];
    const selected = tabs.filter(tab => tab.getAttribute('aria-selected') === 'true');
    const tab = selected.length === 1 ? selected[0] : null;
    const pane = tab ? document.getElementById(tab.getAttribute('aria-controls') ?? '') : null;
    const rect = pane?.getBoundingClientRect();
    const style = pane ? getComputedStyle(pane) : null;
    const left = rect?.left ?? 0, top = rect?.top ?? 0;
    const right = rect?.right ?? 0, bottom = rect?.bottom ?? 0;
    return {
      correct_surface: outer.length === 1 && Boolean(scrape && scrape.contains(tab) && scrape.contains(pane)),
      selected: tab?.firstChild?.textContent?.trim() ?? null,
      visible: Boolean(pane?.dataset.state === 'active' && rect?.width > 0 && rect?.height > 0 && style?.display !== 'none' && style?.visibility === 'visible' && Number(style?.opacity || 1) > 0),
      fully_inside_viewport: Boolean(rect && left >= 0 && top >= 0 && right <= innerWidth && bottom <= innerHeight),
      device_scale_factor: devicePixelRatio,
      clip: { x: left, y: top, width: right - left, height: bottom - top, scale: 1 },
    };
  })()`,
  );
  assert.equal(target?.correct_surface, true, 'scrape_empty_screenshot_not_native_scrape_pane');
  assert.equal(target?.selected, label, 'scrape_empty_screenshot_wrong_selected_pane');
  assert.equal(target?.visible, true, 'scrape_empty_screenshot_pane_not_visible');
  assert.equal(
    target?.fully_inside_viewport,
    true,
    'scrape_empty_screenshot_pane_outside_viewport',
  );
  assert.ok(
    Number.isFinite(target?.device_scale_factor) && target.device_scale_factor > 0,
    'scrape_empty_screenshot_device_scale_unobserved',
  );
  assert.ok(target.clip.width > 0 && target.clip.height > 0, 'scrape_empty_screenshot_clip_empty');
  await panel.send('Page.enable');
  const { data } = await panel.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
    clip: target.clip,
  });
  assert.ok(typeof data === 'string' && data.length > 0, 'scrape_empty_pane_screenshot_missing');
  assertVisiblePng(data, {
    width: Math.round(target.clip.width * target.clip.scale * target.device_scale_factor),
    height: Math.round(target.clip.height * target.clip.scale * target.device_scale_factor),
  });
  const path = join(artifacts, filename);
  await writeFile(path, Buffer.from(data, 'base64'), { mode: 0o600 });
  return path;
}

function assertVisiblePng(base64, expectedDimensions) {
  const bytes = Buffer.from(base64, 'base64');
  assert.equal(bytes.toString('base64'), base64, 'scrape_empty_pane_screenshot_invalid_base64');
  assert.deepEqual(
    bytes.subarray(0, 8),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    'scrape_empty_pane_screenshot_invalid_png_signature',
  );
  const idat = [];
  let width;
  let height;
  let bitDepth;
  let colorType;
  let interlace;
  let ended = false;
  const crc32 = (buffer) => {
    let crc = 0xffffffff;
    for (const byte of buffer) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  for (let offset = 8; offset < bytes.length; ) {
    assert.ok(offset + 12 <= bytes.length, 'scrape_empty_pane_screenshot_truncated_png');
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    assert.ok(end <= bytes.length, 'scrape_empty_pane_screenshot_truncated_png');
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const chunkData = bytes.subarray(offset + 8, offset + 8 + length);
    assert.equal(
      bytes.readUInt32BE(offset + 8 + length),
      crc32(bytes.subarray(offset + 4, offset + 8 + length)),
      'scrape_empty_pane_screenshot_bad_png_crc',
    );
    if (type === 'IHDR') {
      assert.equal(length, 13, 'scrape_empty_pane_screenshot_bad_png_header');
      width = chunkData.readUInt32BE(0);
      height = chunkData.readUInt32BE(4);
      bitDepth = chunkData[8];
      colorType = chunkData[9];
      assert.equal(chunkData[10], 0, 'scrape_empty_pane_screenshot_unsupported_png_compression');
      assert.equal(chunkData[11], 0, 'scrape_empty_pane_screenshot_unsupported_png_filter');
      interlace = chunkData[12];
    } else if (type === 'IDAT') idat.push(chunkData);
    else if (type === 'IEND') {
      assert.equal(length, 0, 'scrape_empty_pane_screenshot_bad_png_end');
      ended = true;
      assert.equal(end, bytes.length, 'scrape_empty_pane_screenshot_png_trailing_data');
      break;
    }
    offset = end;
  }
  assert.ok(
    ended &&
      width > 0 &&
      height > 0 &&
      width <= 4096 &&
      height <= 4096 &&
      width * height <= 16_000_000,
    'scrape_empty_pane_screenshot_bad_png_dimensions',
  );
  assert.equal(width, expectedDimensions.width, 'scrape_empty_pane_screenshot_width_mismatch');
  assert.equal(height, expectedDimensions.height, 'scrape_empty_pane_screenshot_height_mismatch');
  assert.equal(bitDepth, 8, 'scrape_empty_pane_screenshot_unsupported_png_bit_depth');
  assert.ok(
    colorType === 2 || colorType === 6,
    'scrape_empty_pane_screenshot_unsupported_png_color_type',
  );
  assert.equal(interlace, 0, 'scrape_empty_pane_screenshot_unsupported_png_interlace');
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const decoded = inflateSync(Buffer.concat(idat));
  assert.equal(
    decoded.length,
    height * (stride + 1),
    'scrape_empty_pane_screenshot_bad_png_pixels',
  );
  const pixels = Buffer.alloc(height * stride);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = decoded[y * (stride + 1)];
    assert.ok(filter <= 4, 'scrape_empty_pane_screenshot_bad_png_filter');
    for (let x = 0; x < stride; x++) {
      const raw = decoded[y * (stride + 1) + x + 1];
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const above = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upperLeft = y > 0 && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      const predictor =
        filter === 1
          ? left
          : filter === 2
            ? above
            : filter === 3
              ? Math.floor((left + above) / 2)
              : filter === 4
                ? paeth(left, above, upperLeft)
                : 0;
      pixels[y * stride + x] = (raw + predictor) & 255;
    }
  }
  const colors = new Set();
  for (let pixel = 0; pixel < width * height; pixel++) {
    const offset = pixel * channels;
    if (channels === 4 && pixels[offset + 3] === 0) continue;
    colors.add(`${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]}`);
    if (colors.size > 1) return;
  }
  assert.fail('scrape_empty_pane_screenshot_blank_pixels');
}

let panelRef;
let requireResourceHealthRef;
let resourceActionRef;
const reportResourceCheck = () => requireResourceHealthRef();
const resourceActionCall = (action) => resourceActionRef(action);

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(async (error) => {
    report.status = 'fail';
    report.failure_code = safeFailureCode(error);
    await writeReport();
    process.exitCode = 1;
  });
}
