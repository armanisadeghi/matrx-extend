import assert from 'node:assert/strict';

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
    state.resultText?.includes(`Add ${label === 'Images' ? 'image' : 'video'} URL`),
    `scrape_${label}_pane_controls_missing`,
  );
  const actual = label === 'Images' ? media.imageItems : media.videoItems;
  const other = label === 'Images' ? media.videoItems : media.imageItems;
  assert.deepEqual(actual, items, `scrape_${label}_rendered_media_mismatch`);
  assert.deepEqual(other, [], `scrape_${label}_wrong_media_in_pane`);
  return {
    pane: label,
    state: items.length ? 'matching_content' : 'empty',
    count: actual.length,
    // A receipt needs the media identity, not the test server's ephemeral origin.
    paths: actual.map((item) => new URL(item.href).pathname),
    ...(label === 'Images' ? { alt: actual.map((item) => item.alt) } : {}),
  };
}
