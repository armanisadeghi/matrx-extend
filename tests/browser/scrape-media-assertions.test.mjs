import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertMediaPane } from './scrape-media-assertions.mjs';

const image = {
  href: 'http://127.0.0.1:3150/intake.svg',
  src: 'http://127.0.0.1:3150/intake.svg',
  alt: 'New patient intake desk',
  complete: true,
  naturalWidth: 640,
  naturalHeight: 480,
};
const expectedImage = { href: image.href, src: image.src, alt: image.alt };
const video = {
  href: 'http://127.0.0.1:3150/intake-walkthrough.mp4',
  text: 'http://127.0.0.1:3150/intake-walkthrough.mp4',
};
const pane = (label, items) => ({
  selected: label,
  visible: true,
  resultText: `Add ${label === 'Images' ? 'image' : 'video'} URL`,
  media: {
    tabCount: items.length ? String(items.length) : null,
    imageItems: label === 'Images' ? items : [],
    videoItems: label === 'Video' ? items : [],
  },
});

test('active rendered Images and Video panes accept their distinct media', () => {
  assert.deepEqual(
    assertMediaPane(pane('Images', [image]), { label: 'Images', items: [expectedImage] }),
    {
      pane: 'Images',
      state: 'matching_content',
      count: 1,
      paths: ['/intake.svg'],
      alt: ['New patient intake desk'],
      natural_sizes: [[640, 480]],
    },
  );
  assert.deepEqual(assertMediaPane(pane('Video', [video]), { label: 'Video', items: [video] }), {
    pane: 'Video',
    state: 'matching_content',
    count: 1,
    paths: ['/intake-walkthrough.mp4'],
  });
});

test('wrong pane, absent media, and swapped media fail the native assertion', () => {
  assert.throws(
    () => assertMediaPane(pane('Video', [video]), { label: 'Images', items: [expectedImage] }),
    /wrong_selected_pane/,
  );
  assert.throws(
    () => assertMediaPane(pane('Images', []), { label: 'Images', items: [expectedImage] }),
    /tab_count_mismatch/,
  );
  const wrong = pane('Images', [image]);
  wrong.media.imageItems = [{ ...image, href: video.href }];
  assert.throws(
    () => assertMediaPane(wrong, { label: 'Images', items: [expectedImage] }),
    /rendered_media_mismatch/,
  );
});

test('failed or incomplete image load cannot pass matching Images pane', () => {
  for (const failed of [
    { ...image, complete: false },
    { ...image, naturalWidth: 0 },
    { ...image, naturalHeight: 0 },
  ]) {
    assert.throws(
      () => assertMediaPane(pane('Images', [failed]), { label: 'Images', items: [expectedImage] }),
      /image_incomplete|image_not_loaded/,
    );
  }
});

test('honest empty panes pass and nonempty content cannot masquerade as empty', () => {
  for (const label of ['Images', 'Video']) {
    assert.equal(assertMediaPane(pane(label, []), { label, items: [] }).state, 'empty');
  }
  assert.throws(
    () => assertMediaPane(pane('Video', [video]), { label: 'Video', items: [] }),
    /tab_count_mismatch/,
  );
  const falseEmpty = pane('Images', []);
  falseEmpty.media.imageItems = [image];
  assert.throws(
    () => assertMediaPane(falseEmpty, { label: 'Images', items: [] }),
    /rendered_media_mismatch/,
  );
});
