import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertCaptureExportUnchanged,
  assertCompleteTabCoverage,
  captureExportFingerprint,
  capturePaneSnapshot,
  observeEmptyArticlePane,
  observeEmptyLinksPane,
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
    links: {
      pane: 'Links',
      state: 'empty',
      count: 0,
      add_control_visible: true,
      export: { identity_unchanged: true, exported_payload_unchanged: true },
    },
    article: {
      pane: 'Article',
      state: 'empty',
      fallback_visible: true,
      pane_unchanged: true,
      export: { identity_unchanged: true, exported_payload_unchanged: true },
    },
  };
  const warm = { invariance, empty };
  const reload = { invariance, empty };
  assert.equal(assertCompleteTabCoverage({ warm, reload }), true);
  for (const missing of [
    undefined,
    { images: empty.images },
    { video: empty.video },
    { images: empty.images, video: empty.video },
  ]) {
    assert.throws(
      () => assertCompleteTabCoverage({ warm, reload: { invariance, empty: missing } }),
      /scrape_reload_.*empty/,
    );
  }
  assert.throws(
    () =>
      assertCompleteTabCoverage({
        warm,
        reload: { invariance, empty: { ...empty, article: undefined } },
      }),
    /scrape_reload_article_empty_pane_missing/,
  );
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

test('empty Article observation rejects missing fallback, pane mutation and export mutation', async () => {
  const run = async ({
    articleText = 'No clean article extracted.',
    changedPane = false,
    afterDigest = 'same',
  } = {}) => {
    let selected = 'Article';
    let reads = 0;
    let articleVisits = 0;
    return observeEmptyArticlePane({
      panel: {},
      phase: 'warm',
      title: 'Harbor Dental blank notice',
      click: async (_panel, kind, label) => {
        assert.equal(kind, 'scrape-result-tab');
        selected = label;
      },
      resourceAction: (action) => action(),
      requireResourceHealth: async () => {},
      scrapeState: async () => {
        if (selected === 'Article') articleVisits += 1;
        return {
          ...state(selected, selected === 'Article' ? articleText : 'SEO data'),
          title: 'Harbor Dental blank notice',
          resultText:
            selected === 'Article' && changedPane && articleVisits > 1
              ? `${articleText} changed`
              : selected === 'Article'
                ? articleText
                : 'SEO data',
        };
      },
      waitFor: async (_name, read, ready) => {
        const value = await read();
        assert.equal(ready(value), true);
        return value;
      },
      readExport: async () => ({
        identity: 'same',
        digest: ++reads === 1 ? 'same' : afterDigest,
        format: 'full_capture_ai_markdown',
        bytes: 200,
      }),
    });
  };
  const observed = await run();
  assert.equal(observed.fallback_visible, true);
  assert.equal(observed.export.exported_payload_unchanged, true);
  await assert.rejects(
    run({ articleText: 'Unexpected body' }),
    /scrape_warm_article_empty_missing/,
  );
  await assert.rejects(run({ changedPane: true }), /scrape_warm_empty_article_pane_changed/);
  await assert.rejects(
    run({ afterDigest: 'changed' }),
    /scrape_warm_empty_article_capture_payload_changed/,
  );
});

test('owned empty Links pane requires zero real rows, Add link and unchanged capture export', async () => {
  const run = async ({ rows = [], text = 'Add link', afterDigest = 'same' } = {}) => {
    let selected = null;
    let reads = 0;
    return observeEmptyLinksPane({
      panel: {},
      phase: 'warm',
      click: async (_panel, kind, label) => {
        assert.equal(kind, 'scrape-result-tab');
        selected = label;
      },
      resourceAction: (action) => action(),
      requireResourceHealth: async () => {},
      scrapeState: async () => ({
        selected,
        visible: true,
        resultText: text,
        media: { tabCount: rows.length ? String(rows.length) : null, linkItems: rows },
      }),
      waitFor: async (_name, read, ready) => {
        const value = await read();
        assert.equal(ready(value), true);
        return value;
      },
      readExport: async () => ({
        identity: 'same',
        digest: ++reads === 1 ? 'same' : afterDigest,
        format: 'full_capture_ai_markdown',
        bytes: 200,
      }),
    });
  };
  assert.deepEqual(await run(), {
    pane: 'Links',
    state: 'empty',
    count: 0,
    add_control_visible: true,
    export: {
      export_format: 'full_capture_ai_markdown',
      bytes_compared: 200,
      identity_unchanged: true,
      exported_payload_unchanged: true,
    },
  });
  await assert.rejects(
    run({ rows: [{ href: 'http://localhost/forms', text: 'Forms' }] }),
    /scrape_warm_links_not_empty/,
  );
  await assert.rejects(run({ text: '' }), /scrape_warm_add_link_missing/);
  await assert.rejects(
    run({ afterDigest: 'changed' }),
    /scrape_warm_empty_links_capture_payload_changed/,
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

test('native receipt error message never includes capture hashes, timestamps, or content', () => {
  const before = {
    digest: 'a'.repeat(64),
    identity: '2026-10-08T10:20:00.123Z',
    bytes: 120,
    format: 'full_capture_json',
  };
  const after = { ...before, digest: 'b'.repeat(64) };
  const replaced = { ...after, identity: '2026-10-08T10:20:00.999Z' };
  for (const [candidate, code] of [
    [after, 'scrape_warm_capture_payload_changed'],
    [replaced, 'scrape_warm_capture_identity_changed'],
  ]) {
    let message;
    try {
      assertCaptureExportUnchanged(before, candidate, 'warm');
    } catch (error) {
      message = String(error.message).slice(0, 300);
    }
    assert.equal(message, code);
    for (const secret of [
      before.digest,
      after.digest,
      before.identity,
      replaced.identity,
      'Private capture body',
    ]) {
      assert.equal(message.includes(secret), false);
    }
  }
});
