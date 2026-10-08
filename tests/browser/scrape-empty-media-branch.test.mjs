import assert from 'node:assert/strict';
import { test } from 'node:test';
import { observeSelectedMedia } from './scrape-media-observation.mjs';
import { observeEmptyMediaPanes } from './scrape-tab-coverage.mjs';

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

async function exercise(states, phase) {
  let selected;
  let gatedClicks = 0;
  const evidence = await observeEmptyMediaPanes({
    panel: {},
    phase,
    requireResourceHealth: async () => {},
    resourceAction: async (action) => {
      gatedClicks += 1;
      return action();
    },
    click: async (_panel, kind, label) => {
      assert.equal(kind, 'scrape-result-tab');
      selected = label;
    },
    observeSelectedMedia: (options) => observeSelectedMedia({ ...options, timeoutMs: 0 }),
    evaluate: async () => null,
    scrapeState: async () => states[selected],
  });
  return { evidence, gatedClicks };
}

test('warm and reload empty-media branches validate both visible panes through the shared observer', async () => {
  for (const phase of ['warm', 'reload']) {
    const result = await exercise({ Images: pane('Images'), Video: pane('Video') }, phase);
    assert.deepEqual(result.evidence.images, {
      pane: 'Images',
      state: 'empty',
      count: 0,
      paths: [],
      alt: [],
      natural_sizes: [],
    });
    assert.deepEqual(result.evidence.video, {
      pane: 'Video',
      state: 'empty',
      count: 0,
      paths: [],
    });
    assert.equal(result.gatedClicks, 2);
  }
});

test('both phases reject populated or hidden empty-media panes', async () => {
  const image = {
    href: 'http://localhost/intake.svg',
    src: 'http://localhost/intake.svg',
    alt: 'Intake',
    complete: true,
    naturalWidth: 640,
    naturalHeight: 480,
  };
  const video = { href: 'http://localhost/intake.mp4', text: 'Intake' };
  for (const phase of ['warm', 'reload']) {
    for (const [label, rows] of [
      ['Images', [image]],
      ['Video', [video]],
    ]) {
      await assert.rejects(
        exercise(
          { Images: pane('Images'), Video: pane('Video'), [label]: pane(label, rows) },
          phase,
        ),
        /not_observed|tab_count_mismatch|rendered_media_mismatch/,
      );
    }
    await assert.rejects(
      exercise({ Images: { ...pane('Images'), visible: false }, Video: pane('Video') }, phase),
      /not_observed|pane_not_visible/,
    );
  }
});
