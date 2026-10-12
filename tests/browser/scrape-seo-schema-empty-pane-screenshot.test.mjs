import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import { Window } from 'happy-dom';
import { captureSelectedPaneScreenshot } from './scrape-seo-schema-empty-guest.mjs';

const clip = { x: 12, y: 24, width: 320, height: 180, scale: 1 };
const tempRoot = new URL('../../test-results/', import.meta.url).pathname;

function fixture(
  selected,
  bounds = { left: 12, top: 24, right: 332, bottom: 204, width: 320, height: 180 },
) {
  const window = new Window();
  window.innerWidth = 800;
  window.innerHeight = 600;
  window.document.body.innerHTML = `
    <button role="tab" title="Scrape" data-state="active" aria-controls="scrape">Scrape</button>
    <div id="scrape" role="tabpanel" data-state="active">
      <div role="tablist">
        <button role="tab" aria-selected="${selected === 'SEO'}" aria-controls="seo">SEO</button>
        <button role="tab" aria-selected="${selected === 'Schema'}" aria-controls="schema">Schema</button>
      </div>
      <div id="seo" data-state="${selected === 'SEO' ? 'active' : 'inactive'}" style="visibility:visible;opacity:1"></div>
      <div id="schema" data-state="${selected === 'Schema' ? 'active' : 'inactive'}" style="visibility:visible;opacity:1"></div>
    </div>`;
  for (const id of ['seo', 'schema'])
    window.document.getElementById(id).getBoundingClientRect = () => bounds;
  return window;
}

function pngChunk(type, payload) {
  const chunk = Buffer.alloc(12 + payload.length);
  chunk.writeUInt32BE(payload.length, 0);
  chunk.write(type, 4);
  payload.copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, 8 + payload.length)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + payload.length);
  return chunk;
}

function png(width = 320, height = 180, blank = false) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const stride = width * 4;
  const scanlines = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    for (let x = 0; x < width; x++) {
      const offset = rowStart + 1 + x * 4;
      const color = !blank && x === 0 && y === 0 ? [22, 35, 48] : [212, 224, 236];
      scanlines.set([...color, 255], offset);
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]).toString('base64');
}

function evaluateFixture(window) {
  return async (_panel, expression) =>
    new Function(
      'document',
      'getComputedStyle',
      'innerWidth',
      'innerHeight',
      'devicePixelRatio',
      `return ${expression}`,
    )(
      window.document,
      window.getComputedStyle.bind(window),
      window.innerWidth,
      window.innerHeight,
      window.devicePixelRatio,
    );
}

function panelFor({ responseData = png() } = {}) {
  const calls = [];
  return {
    calls,
    async send(method, params) {
      calls.push({ method, params });
      if (method === 'Page.captureScreenshot') return { data: responseData };
      return {};
    },
  };
}

// Real use case: a dental practice reviewing SEO and structured metadata on its title-only
// appointment information page; each artifact must show the selected native result pane.
test('captures bounded SEO and Schema pane pixels under fixed artifact names', async () => {
  const artifacts = await mkdtemp(join(tempRoot, 'scrape-t08-pane-'));
  try {
    const expectedPng = Buffer.from(png(), 'base64');
    for (const [label, filename] of [
      ['SEO', 'scrape-t08-seo-pane.png'],
      ['Schema', 'scrape-t08-schema-pane.png'],
    ]) {
      const panel = panelFor();
      const window = fixture(label);
      const path = await captureSelectedPaneScreenshot({
        panel,
        label,
        artifacts,
        evaluateFn: evaluateFixture(window),
      });
      assert.equal(path, join(artifacts, filename));
      assert.deepEqual(panel.calls, [
        { method: 'Page.enable', params: undefined },
        {
          method: 'Page.captureScreenshot',
          params: {
            format: 'png',
            fromSurface: true,
            captureBeyondViewport: false,
            clip,
          },
        },
      ]);
      assert.deepEqual(await readFile(path), expectedPng);
      window.happyDOM.abort();
    }
  } finally {
    await rm(artifacts, { recursive: true, force: true });
  }
});

test('does not capture pixels when a different native pane is selected', async () => {
  const panel = panelFor();
  const window = fixture('Schema');
  await assert.rejects(
    captureSelectedPaneScreenshot({
      panel,
      label: 'SEO',
      artifacts: tempRoot,
      evaluateFn: evaluateFixture(window),
    }),
    /scrape_empty_screenshot_wrong_selected_pane/,
  );
  assert.equal(panel.calls.length, 0);
  window.happyDOM.abort();
});

test('fails when the selected pane screenshot is absent', async () => {
  const artifacts = await mkdtemp(join(tempRoot, 'scrape-t08-missing-png-'));
  const panel = panelFor({ responseData: '' });
  const window = fixture('Schema');
  await assert.rejects(
    captureSelectedPaneScreenshot({
      panel,
      label: 'Schema',
      artifacts,
      evaluateFn: evaluateFixture(window),
    }),
    /scrape_empty_pane_screenshot_missing/,
  );
  await rm(artifacts, { recursive: true, force: true });
  window.happyDOM.abort();
});

test('refuses a pane that extends beyond the native viewport instead of saving a partial crop', async () => {
  const panel = panelFor();
  const window = fixture('SEO', {
    left: 12,
    top: 24,
    right: 832,
    bottom: 204,
    width: 820,
    height: 180,
  });
  await assert.rejects(
    captureSelectedPaneScreenshot({
      panel,
      label: 'SEO',
      artifacts: tempRoot,
      evaluateFn: evaluateFixture(window),
    }),
    /scrape_empty_screenshot_pane_outside_viewport/,
  );
  assert.equal(panel.calls.length, 0);
  window.happyDOM.abort();
});

test('refuses a nonblank PNG whose dimensions do not match the requested pane clip', async () => {
  const artifacts = await mkdtemp(join(tempRoot, 'scrape-t08-mismatched-png-'));
  const panel = panelFor({ responseData: png(2, 1) });
  const window = fixture('Schema');
  await assert.rejects(
    captureSelectedPaneScreenshot({
      panel,
      label: 'Schema',
      artifacts,
      evaluateFn: evaluateFixture(window),
    }),
    /scrape_empty_pane_screenshot_width_mismatch/,
  );
  await rm(artifacts, { recursive: true, force: true });
  window.happyDOM.abort();
});

test('rejects a PNG with matching dimensions but blank pixels', async () => {
  const artifacts = await mkdtemp(join(tempRoot, 'scrape-t08-blank-png-'));
  const panel = panelFor({ responseData: png(320, 180, true) });
  const window = fixture('Schema');
  await assert.rejects(
    captureSelectedPaneScreenshot({
      panel,
      label: 'Schema',
      artifacts,
      evaluateFn: evaluateFixture(window),
    }),
    /scrape_empty_pane_screenshot_blank_pixels/,
  );
  await rm(artifacts, { recursive: true, force: true });
  window.happyDOM.abort();
});

test('rejects malformed screenshot bytes before writing an artifact', async () => {
  const artifacts = await mkdtemp(join(tempRoot, 'scrape-t08-malformed-png-'));
  const panel = panelFor({ responseData: Buffer.from('not a PNG').toString('base64') });
  const window = fixture('SEO');
  await assert.rejects(
    captureSelectedPaneScreenshot({
      panel,
      label: 'SEO',
      artifacts,
      evaluateFn: evaluateFixture(window),
    }),
    /scrape_empty_pane_screenshot_invalid_png_signature/,
  );
  await rm(artifacts, { recursive: true, force: true });
  window.happyDOM.abort();
});
