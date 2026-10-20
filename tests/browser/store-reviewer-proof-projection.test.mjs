import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Reviewer preparing the public three-stage extension demo. Only browser I/O is
// doubled; the exported runner owns validation, sequencing and proof projection.
const sourceUrl = new URL('./store-reviewer-demo-path.mjs', import.meta.url);
const original = await readFile(sourceUrl, 'utf8');
const privateMarker = 'PRIVATE_PROJECTION_MARKER';
const publicUrl = 'https://www.aimatrx.com/matrx-extend-demo';
const title = `Matrx Extend Demo Page ${privateMarker}`;
const headline = 'A clear three-stage browser workflow';
let sequence = 0;
async function loadRunner(source, io) {
  const key = `__reviewerProjection${sequence++}`;
  globalThis[key] = io;
  const stub = (names) =>
    `data:text/javascript,${encodeURIComponent(
      names
        .map(
          (name) =>
            `export const ${name} = (...args) => globalThis[${JSON.stringify(key)}].${name}(...args);`,
        )
        .join('\n'),
    )}`;
  const rewritten = source.replace(/from '(\.\/[^']+)'/g, (_match, path) => {
    if (path === './settings-panel-driver.mjs')
      return `from '${stub(['click', 'evaluate', 'openSection', 'waitFor'])}'`;
    if (path === './data-guest-picker-driver.mjs')
      return `from '${stub(['clickPickerCancel', 'clickPickerDone', 'clickPickerField', 'foregroundPickerDoneTarget', 'pickerSelectedCount'])}'`;
    return `from '${new URL(path, sourceUrl).href}'`;
  });
  return {
    module: await import(`data:text/javascript,${encodeURIComponent(rewritten)}`),
    close: () => delete globalThis[key],
  };
}
function browserIO({ failAt = null } = {}) {
  let tab = 'Article';
  let captured = false;
  let picked = false;
  const visited = [];
  return {
    visited,
    async click(_panel, kind, value) {
      visited.push(value);
      if (value === failAt) throw new Error(`pointer_target_not_unique:${privateMarker}`);
      if (kind === 'scrape-result-tab') tab = value;
      if (value === 'Capture the page exactly as it is right now') captured = true;
      if (value === 'Cancel') picked = false;
    },
    async openSection() {},
    async clickPickerCancel() {},
    async clickPickerField() {},
    async pickerSelectedCount() {
      return 1;
    },
    async foregroundPickerDoneTarget() {
      return { phase: 'after', target_equal: true };
    },
    async clickPickerDone() {
      picked = true;
    },
    async waitFor(label, read, accept) {
      const value = await read();
      if (!accept(value)) throw new Error(`${label}_not_observed:${privateMarker}`);
      return value;
    },
    async evaluate(_panel, expression) {
      if (expression.includes('switchCount'))
        return { visible: false, stored: null, settingPresent: false, switchCount: 1 };
      if (expression.includes('captureButtons'))
        return {
          active: true,
          title: `${privateMarker}_ARTICLE`,
          empty: !captured,
          captureButtons: 1,
          selected: tab,
          contentVisible: true,
          text: `${headline} Capture Understand Use ${privateMarker} Article`,
          linkCount: 2,
          error: null,
        };
      if (expression.includes('auditAvailable'))
        return {
          active: true,
          title,
          headings: true,
          auditReady: true,
          auditAvailable: false,
          error: false,
        };
      if (expression.includes('pickerReady'))
        return {
          active: true,
          pickerReady: !picked,
          selected: picked ? [`field_1: #${privateMarker}`] : [],
          cancelReady: picked,
          guestExplanation: true,
        };
      throw new Error('unexpected_observation');
    },
  };
}
async function exercise(source = original, options = {}) {
  const io = browserIO(options);
  const loaded = await loadRunner(source, io);
  const receipt = {
    kind: 'native_store_zip_candidate_key_adapted',
    version: '0.2.557',
    publishState: 'pushed',
    sourceSha: 'b'.repeat(40),
    treeSha256: 'a'.repeat(64),
    storeTreeSha256: 'b'.repeat(64),
    storeZip: { sha256: 'c'.repeat(64) },
    artifactSelection: {
      source: 'release_receipt_store_zip',
      publisherSourceTreeSha256: 'd'.repeat(64),
      selectedZipSha256: 'c'.repeat(64),
      originalStoreTreeSha256: 'b'.repeat(64),
      runtimeTreeSha256: 'a'.repeat(64),
      modifiedPaths: ['manifest.json'],
    },
  };
  try {
    const proof = await loaded.module.runStoreReviewerDemoPath({
      page: {
        url: () => publicUrl,
        locator: () => ({ waitFor: async () => {} }),
        evaluate: async (_fn, selector) =>
          selector === undefined
            ? {
                url: publicUrl,
                title: options.badSource ? privateMarker : title,
                articleText: headline,
                stages: ['Capture', 'Understand', 'Use'],
                linkHref: 'https://www.aimatrx.com/privacy-policy/extension',
                linkText: privateMarker,
                schemaType: 'Article',
                schemaHeadline: headline,
              }
            : { count: 1, workflowRow: true, text: 'Capture' },
      },
      panel: {},
      receipt,
      runtimeTreeSha256: receipt.treeSha256,
      screenshot: async () => `https://private.invalid/${privateMarker}`,
    });
    return { proof, visited: io.visited };
  } finally {
    loaded.close();
  }
}
function requirePublicProof(proof) {
  assert.doesNotMatch(
    JSON.stringify(proof),
    /PRIVATE_PROJECTION_MARKER|private\.invalid|selected_field/,
  );
}

test('exported runner projects successful source, article, SEO and selector observations', async () => {
  const { proof, visited } = await exercise();
  assert.equal(proof.status, 'pass');
  requirePublicProof(proof);
  assert.equal(Object.keys(proof.checks).length, 6);
  assert.equal(proof.checks.data_workflow_picker.workflow_row_matched, true);
  assert.equal(proof.checks.seo_audit.public_title_matches, true);
  assert.equal(proof.checks.capture_article.public_title_matches, false);
  assert.ok(visited.includes('Cancel'));
  requirePublicProof(proof);
});

test('exported runner retains first failing control and safe source when aggregate fails', async () => {
  const { proof } = await exercise(original, {
    failAt: 'Capture the page exactly as it is right now',
  });
  assert.equal(proof.status, 'fail');
  assert.equal(proof.source.status, 'pass');
  assert.equal(proof.checks.capture_article.failure_target, 'scrape_capture_button');
  assert.equal(proof.checks.capture_article.failure_code, 'pointer_target_not_unique');
  assert.equal(proof.checks.seo_audit.status, 'pass');
  requirePublicProof(proof);
});

test('exported runner refuses invalid source before any control observation', async () => {
  const { proof, visited } = await exercise(original, { badSource: true });
  assert.equal(proof.status, 'fail');
  assert.equal(proof.source.failure_target, 'public_demo_title');
  assert.equal(proof.checks.capture_article.status, 'unverified');
  assert.deepEqual(visited, []);
  requirePublicProof(proof);
});

test('raw-field egress mutation is caught at real runner serialization', async () => {
  const mutant = original.replace(
    'safe_dom: sourceSafe,',
    'title: source.title, safe_dom: sourceSafe,',
  );
  assert.notEqual(mutant, original);
  const { proof } = await exercise(mutant);
  assert.equal(proof.status, 'pass');
  assert.throws(() => requirePublicProof(proof), /PRIVATE_PROJECTION_MARKER/);
});

test('projection rejects unknown fields, wrong primitive types and screenshot callback paths', async () => {
  const { recordReviewerCheck, unverifiedReviewerDemoPath } = await import(
    './store-reviewer-demo-path.mjs'
  );
  const success = await recordReviewerCheck({
    name: 'capture_article',
    run: async () => ({
      public_heading_present: true,
      title: privateMarker,
      selected: privateMarker,
      link_count: privateMarker,
      error_present: privateMarker,
      unknown: true,
    }),
  });
  assert.deepEqual(success, { status: 'pass', public_heading_present: true });
  const failure = await recordReviewerCheck({
    name: 'capture_article',
    run: async () => {
      throw new Error(privateMarker);
    },
    observeSafe: async () => ({
      pane_active: true,
      title: privateMarker,
      capture_button_count: 2,
      stored_on: privateMarker,
    }),
    screenshot: async () => privateMarker,
  });
  assert.deepEqual(failure.safe_dom, { pane_active: true, capture_button_count: 2 });
  requirePublicProof(failure);
  requirePublicProof(unverifiedReviewerDemoPath(privateMarker, privateMarker, privateMarker));
});
