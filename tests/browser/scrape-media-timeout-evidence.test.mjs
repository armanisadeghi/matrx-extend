import assert from 'node:assert/strict';
import test from 'node:test';
import { observeSelectedMedia, retainScrapeMediaFailure } from './scrape-media-observation.mjs';
import { waitForScrapeMedia } from './scrape-media-timeout-evidence.mjs';

const expected = [
  { src: 'http://localhost:49193/intake.svg' },
  { src: 'http://localhost:49193/appointment-card.svg' },
  { src: 'http://localhost:49193/clinic-icon.svg' },
];

function state(images, overrides = {}) {
  return {
    ready: true,
    title: 'Harbor Dental intake guide',
    resultText: 'Private page text must not enter diagnostic evidence',
    tabs: ['Article', 'Images', 'Video', 'Links', 'SEO', 'Schema'].map((label) => ({
      label,
      selected: label === 'Images',
    })),
    selected: 'Images',
    visible: true,
    media: { tabCount: '3', imageItems: images },
    ...overrides,
  };
}

const accept = (value) =>
  value?.selected === 'Images' &&
  value.visible &&
  value.media?.imageItems?.length === expected.length &&
  value.media.imageItems.every((image) => image.complete && image.naturalWidth > 0);

test('image timeout keeps the final allowlisted media boundary when one image is incomplete', async () => {
  const last = state([
    { src: expected[0].src, complete: true, naturalWidth: 640, naturalHeight: 480 },
    { src: expected[1].src, complete: false, naturalWidth: 0, naturalHeight: 0 },
    { src: expected[2].src, complete: true, naturalWidth: 32, naturalHeight: 32 },
  ]);
  await assert.rejects(
    waitForScrapeMedia('scrape_Images_loaded', async () => last, accept, expected, 'Images', 0),
    (error) => {
      assert.match(error.message, /^scrape_Images_loaded_not_observed:/);
      assert.deepEqual(error.scrapeMediaFailure, {
        kind: 'Images',
        selected: 'Images',
        visible: true,
        tabCount: 3,
        observedCount: 3,
        expectedCount: 3,
        items: [
          { index: 0, expectedIndex: 0, complete: true, naturalWidth: 640, naturalHeight: 480 },
          { index: 1, expectedIndex: 1, complete: false, naturalWidth: 0, naturalHeight: 0 },
          { index: 2, expectedIndex: 2, complete: true, naturalWidth: 32, naturalHeight: 32 },
        ],
      });
      assert.equal(JSON.stringify(error.scrapeMediaFailure).includes(last.resultText), false);
      assert.equal(JSON.stringify(error.scrapeMediaFailure).includes('localhost'), false);
      return true;
    },
  );
});

test('image timeout distinguishes a missing pane and missing image rows', async () => {
  const last = state([], {
    selected: 'Video',
    visible: false,
    media: { tabCount: null, imageItems: [] },
  });
  await assert.rejects(
    waitForScrapeMedia('scrape_Images_loaded', async () => last, accept, expected, 'Images', 0),
    (error) => {
      assert.deepEqual(error.scrapeMediaFailure, {
        kind: 'Images',
        selected: 'Video',
        visible: false,
        tabCount: null,
        observedCount: 0,
        expectedCount: 3,
        items: [],
      });
      return true;
    },
  );
});

test('video timeout retains row identity only as fixture indexes', async () => {
  const videos = [
    { href: 'http://localhost:49193/intake-walkthrough.mp4' },
    { href: 'http://localhost:49193/referral-walkthrough.mp4' },
  ];
  const last = state([], {
    selected: 'Video',
    media: {
      tabCount: '2',
      videoItems: [
        { href: videos[0].href, text: 'Private link text' },
        { href: 'http://localhost:49193/unexpected.mp4', text: 'Other private text' },
      ],
    },
  });
  await assert.rejects(
    waitForScrapeMedia(
      'scrape_Video_loaded',
      async () => last,
      () => false,
      videos,
      'Video',
      0,
    ),
    (error) => {
      assert.deepEqual(error.scrapeMediaFailure, {
        kind: 'Video',
        selected: 'Video',
        visible: true,
        tabCount: 2,
        observedCount: 2,
        expectedCount: 2,
        items: [
          { index: 0, expectedIndex: 0 },
          { index: 1, expectedIndex: null },
        ],
      });
      assert.equal(JSON.stringify(error.scrapeMediaFailure).includes('localhost'), false);
      assert.equal(JSON.stringify(error.scrapeMediaFailure).includes('Private'), false);
      return true;
    },
  );
});

test('native selectedMedia caller carries a safe image timeout into the receipt', async () => {
  const last = state([
    { src: expected[0].src, complete: true, naturalWidth: 640, naturalHeight: 480 },
    { src: expected[1].src, complete: false, naturalWidth: 0, naturalHeight: 0 },
    { src: expected[2].src, complete: true, naturalWidth: 32, naturalHeight: 32 },
  ]);
  const report = { stage: 'result_tabs', failure: null };
  const panel = {};
  let scrolled = false;
  try {
    await observeSelectedMedia({
      panel,
      label: 'Images',
      items: expected,
      name: 'scrape_Images_loaded',
      evaluate: async (receivedPanel, expression) => {
        assert.equal(receivedPanel, panel);
        assert.match(expression, /scrollIntoView/);
        scrolled = true;
      },
      scrapeState: async (receivedPanel) => {
        assert.equal(receivedPanel, panel);
        return last;
      },
      timeoutMs: 0,
    });
    assert.fail('selectedMedia unexpectedly accepted an incomplete image');
  } catch (error) {
    report.failure = { stage: report.stage, code: String(error.message).slice(0, 300) };
    retainScrapeMediaFailure(report, error);
  }
  assert.equal(scrolled, true);
  assert.equal(report.failure.stage, 'result_tabs');
  assert.match(report.failure.code, /^scrape_Images_loaded_not_observed:/);
  assert.equal(report.failure.code.includes('imageItems'), false);
  assert.ok(report.scrape_media_failure, 'scrape_media_failure_missing');
  assert.equal(report.scrape_media_failure.items[1].complete, false);
  assert.equal(report.scrape_media_failure.items[1].expectedIndex, 1);
  assert.equal(JSON.stringify(report.scrape_media_failure).includes(last.resultText), false);
});
