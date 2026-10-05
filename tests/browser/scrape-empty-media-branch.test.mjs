import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { observeSelectedMedia } from './scrape-media-observation.mjs';

const driver = await readFile(
  new URL('./scrape-guest-native-acceptance.mjs', import.meta.url),
  'utf8',
);
const start = driver.indexOf(
  "      for (const label of ['Images', 'Video']) {",
  driver.indexOf("report.stage = 'empty_media_capture'"),
);
const end = driver.indexOf('      const t08 =', start);
assert.ok(start >= 0 && end > start, 'empty media production branch missing');
const runBranch = new Function(
  'panel',
  'requireResourceHealth',
  'resourceAction',
  'click',
  'waitFor',
  'scrapeState',
  'mediaEvidence',
  'observeSelectedMedia',
  'evaluate',
  `return (async () => { ${driver.slice(start, end)} })();`,
);

const pane = (label, rows = []) => ({
  selected: label,
  visible: true,
  resultText: `Add ${label === 'Images' ? 'image' : 'video'} URL`,
  media: {
    tabCount: rows.length ? String(rows.length) : null,
    imageItems: label === 'Images' ? rows : [],
    videoItems: label === 'Video' ? rows : [],
  },
});

async function exercise(states) {
  let selected;
  let healthChecks = 0;
  let gatedClicks = 0;
  const evidence = {};
  await runBranch(
    {},
    async () => {
      healthChecks += 1;
    },
    async (action) => {
      gatedClicks += 1;
      return action();
    },
    async (_panel, kind, label) => {
      assert.equal(kind, 'scrape-result-tab');
      selected = label;
    },
    async (_name, read, ready) => {
      const state = await read();
      assert.ok(ready(state), 'empty media observer did not select the visible pane');
      return state;
    },
    async () => states[selected],
    evidence,
    (options) => observeSelectedMedia({ ...options, timeoutMs: 0 }),
    async () => null,
  );
  return { evidence, healthChecks, gatedClicks };
}

test('native empty-media branch validates both visible panes through the shared observer', async () => {
  const result = await exercise({ Images: pane('Images'), Video: pane('Video') });
  assert.deepEqual(result.evidence.images_empty, {
    pane: 'Images',
    state: 'empty',
    count: 0,
    paths: [],
    alt: [],
    natural_sizes: [],
  });
  assert.deepEqual(result.evidence.video_empty, {
    pane: 'Video',
    state: 'empty',
    count: 0,
    paths: [],
  });
  assert.equal(result.gatedClicks, 2);
  assert.ok(result.healthChecks >= 2);
});

test('native empty-media branch rejects populated or hidden panes for either label', async () => {
  const image = {
    href: 'http://localhost/intake.svg',
    src: 'http://localhost/intake.svg',
    alt: 'Intake',
    complete: true,
    naturalWidth: 640,
    naturalHeight: 480,
  };
  const video = { href: 'http://localhost/intake.mp4', text: 'Intake' };
  for (const [label, rows] of [
    ['Images', [image]],
    ['Video', [video]],
  ]) {
    await assert.rejects(
      exercise({ Images: pane('Images'), Video: pane('Video'), [label]: pane(label, rows) }),
      /not_observed|tab_count_mismatch|rendered_media_mismatch/,
    );
  }
  await assert.rejects(
    exercise({ Images: { ...pane('Images'), visible: false }, Video: pane('Video') }),
    /not_observed|pane_not_visible/,
  );
});
