import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertCaptureExportUnchanged,
  assertCompleteTabCoverage,
  captureExportFingerprint,
  capturePaneSnapshot,
  verifyCaptureUnchanged,
} from './scrape-tab-coverage.mjs';

const labels = ['Article', 'Images', 'Video', 'Links', 'SEO', 'Schema'];
const state = (label, text) => ({
  selected: label,
  title: 'Harbor Dental intake guide',
  visible: true,
  resultText: text,
  tabs: labels.map((name) => ({ label: name, selected: name === label })),
  media: {
    tabCount: label === 'Images' ? '3' : null,
    imageItems: [],
    videoItems: [],
    linkItems: [],
  },
});
const initial = Object.fromEntries(
  labels.map((label) => [label, state(label, `${label} capture data`)]),
);
const baseline = Object.fromEntries(
  labels.map((label) => [label, capturePaneSnapshot(initial[label])]),
);

async function compare(states) {
  let selected;
  return verifyCaptureUnchanged({
    panel: {},
    baseline,
    labels,
    click: async (_panel, _kind, label) => {
      selected = label;
    },
    resourceAction: (action) => action(),
    requireResourceHealth: async () => {},
    scrapeState: async () => states[selected],
    waitFor: async (_name, read, ready) => {
      const value = await read();
      assert.ok(ready(value), 'selected pane not ready');
      return value;
    },
    phase: 'warm',
  });
}

test('pane revisits preserve the full captured text and identities', async () => {
  assert.deepEqual(await compare(initial), { panes_compared: labels, unchanged: true });
  for (const label of labels) {
    await assert.rejects(
      compare({ ...initial, [label]: state(label, `${label} replaced capture`) }),
      new RegExp(`scrape_warm_${label}_capture_changed`),
    );
  }
  await assert.rejects(
    compare({
      ...initial,
      Images: { ...initial.Images, media: { ...initial.Images.media, tabCount: '2' } },
    }),
    /scrape_warm_Images_capture_changed/,
  );
});

test('T08 coverage refuses absent reload empty panes or a skipped capture comparison', () => {
  const invariance = {
    panes_compared: labels,
    unchanged: true,
    export: { identity_unchanged: true, exported_payload_unchanged: true },
  };
  const empty = {
    images: { pane: 'Images', state: 'empty', count: 0 },
    video: { pane: 'Video', state: 'empty', count: 0 },
  };
  const warm = { invariance, empty };
  const reload = { invariance, empty };
  assert.equal(assertCompleteTabCoverage({ warm, reload }), true);
  for (const missing of [undefined, { images: empty.images }, { video: empty.video }]) {
    assert.throws(
      () => assertCompleteTabCoverage({ warm, reload: { invariance, empty: missing } }),
      /scrape_reload_.*empty/,
    );
  }
  assert.throws(
    () => assertCompleteTabCoverage({ warm, reload: { invariance: undefined, empty } }),
    /scrape_reload_capture_invariance_missing/,
  );
  assert.throws(
    () =>
      assertCompleteTabCoverage({
        warm,
        reload: {
          invariance: { panes_compared: labels, unchanged: true },
          empty,
        },
      }),
    /scrape_reload_export_identity_invariance_missing/,
  );
  assert.throws(
    () =>
      assertCompleteTabCoverage({
        warm,
        reload: { invariance: { ...invariance, panes_compared: labels.slice(1) }, empty },
      }),
    /scrape_reload_capture_panes_missing/,
  );
});

test('full capture export rejects hidden payload mutation even when rendered panes match', () => {
  const context = {
    mode: 'admin',
    url: 'http://localhost/intake',
    title: 'Harbor Dental intake guide',
  };
  const payload = {
    url: context.url,
    capturedAt: 1760000000123,
    article: { title: context.title, content_markdown: 'Visible article' },
    audio: [{ src: '/unrendered-audio.mp3' }],
  };
  const before = captureExportFingerprint(JSON.stringify(payload), context);
  const same = captureExportFingerprint(JSON.stringify(payload), context);
  assert.equal(assertCaptureExportUnchanged(before, same, 'warm').exported_payload_unchanged, true);
  const mutated = captureExportFingerprint(
    JSON.stringify({ ...payload, audio: [{ src: '/silently-changed-audio.mp3' }] }),
    context,
  );
  assert.throws(
    () => assertCaptureExportUnchanged(before, mutated, 'warm'),
    /scrape_warm_capture_payload_changed/,
  );
  const replaced = captureExportFingerprint(
    JSON.stringify({ ...payload, capturedAt: 1760000000999 }),
    context,
  );
  assert.throws(
    () => assertCaptureExportUnchanged(before, replaced, 'warm'),
    /scrape_warm_capture_identity_changed/,
  );
});

test('non-admin capture export requires source identity and compares complete copied bytes', () => {
  const context = {
    mode: 'guest',
    url: 'http://localhost/intake',
    title: 'Harbor Dental intake guide',
  };
  const exportText = `The following is a full Matrx scrape result for a webpage.\n\n- Source URL: ${context.url}\n- Title: ${context.title}\n- Captured: 2026-10-08T10:20:00.123Z\n\n\`\`\`markdown\n# ${context.title}\n## Images\n/intake.svg\n\`\`\``;
  const before = captureExportFingerprint(exportText, context);
  const after = captureExportFingerprint(
    exportText.replace('/intake.svg', '/changed.svg'),
    context,
  );
  assert.throws(
    () => assertCaptureExportUnchanged(before, after, 'reload'),
    /scrape_reload_capture_payload_changed/,
  );
  assert.throws(
    () => captureExportFingerprint(exportText.replace('- Captured: ', '- Missing: '), context),
    /scrape_capture_export_identity_missing/,
  );
});
