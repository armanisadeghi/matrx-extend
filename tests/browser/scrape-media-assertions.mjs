import assert from 'node:assert/strict';

// Native Scrape labels use CSS text-transform, so innerText is a visual diagnostic;
// textContent is the authored label whose counts the view controls.
export function assertImageGroups(state, expected, boundary) {
  assert.equal(state?.selected, 'Images', `${boundary}_wrong_pane`);
  assert.equal(state?.visible, true, `${boundary}_pane_hidden`);
  assert.deepEqual(state?.media?.imageGroups, expected, `${boundary}_image_group_membership`);
  const { large, medium, icon } = expected;
  const parts = [`${large.length} image${large.length === 1 ? '' : 's'}`];
  if (medium.length) parts.push(`${medium.length} small`);
  if (icon.length) parts.push(`${icon.length} icon${icon.length === 1 ? '' : 's'}`);
  assert.equal(
    state.media.imageToolbar,
    large.length + medium.length + icon.length ? parts.join(' · ') : null,
    `${boundary}_image_toolbar_count`,
  );
}

// The native driver supplies only links rendered inside the selected, visible Scrape result pane.
export function assertMediaPane(state, { label, items }) {
  assert.ok(label === 'Images' || label === 'Video', 'scrape_media_kind_invalid');
  assert.equal(state?.selected, label, `scrape_${label}_wrong_selected_pane`);
  assert.equal(state?.visible, true, `scrape_${label}_pane_not_visible`);
  const media = state?.media;
  assert.ok(media, `scrape_${label}_pane_media_missing`);
  assert.equal(
    media.tabCount,
    items.length ? String(items.length) : null,
    `scrape_${label}_tab_count_mismatch`,
  );
  assert.ok(
    state.resultText?.includes(`Add ${label === 'Images' ? 'image' : 'video'} URL`) ||
      media.formOpen === true,
    `scrape_${label}_pane_controls_missing`,
  );
  const actual = label === 'Images' ? media.imageItems : media.videoItems;
  const other = label === 'Images' ? media.videoItems : media.imageItems;
  assert.deepEqual(
    label === 'Images' ? actual.map(({ href, src, alt }) => ({ href, src, alt })) : actual,
    items,
    `scrape_${label}_rendered_media_mismatch`,
  );
  assert.deepEqual(other, [], `scrape_${label}_wrong_media_in_pane`);
  if (label === 'Images') {
    for (const image of actual) {
      assert.equal(image.complete, true, 'scrape_Images_image_incomplete');
      assert.ok(
        image.naturalWidth > 0 && image.naturalHeight > 0,
        'scrape_Images_image_not_loaded',
      );
    }
  }
  return {
    pane: label,
    state: items.length ? 'matching_content' : 'empty',
    count: actual.length,
    // A receipt needs the media identity, not the test server's ephemeral origin.
    paths: actual.map((item) => new URL(item.href).pathname),
    ...(label === 'Images'
      ? {
          alt: actual.map((item) => item.alt),
          natural_sizes: actual.map((item) => [item.naturalWidth, item.naturalHeight]),
        }
      : {}),
  };
}
