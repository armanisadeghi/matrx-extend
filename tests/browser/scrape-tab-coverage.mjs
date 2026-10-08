import assert from 'node:assert/strict';

export function capturePaneSnapshot(state) {
  assert.equal(state?.visible, true, 'scrape_capture_pane_hidden');
  assert.ok(typeof state.resultText === 'string', 'scrape_capture_pane_text_missing');
  return {
    selected: state.selected,
    title: state.title,
    text: state.resultText,
    tabs: state.tabs?.map(({ label, selected }) => ({ label, selected })),
    media: state.media && {
      tabCount: state.media.tabCount,
      imageItems: state.media.imageItems?.map(({ href, src, alt }) => ({ href, src, alt })),
      videoItems: state.media.videoItems,
      linkItems: state.media.linkItems,
    },
  };
}

export async function verifyCaptureUnchanged({
  panel,
  baseline,
  labels,
  click,
  resourceAction,
  requireResourceHealth,
  scrapeState,
  waitFor,
  phase,
}) {
  const observed = {};
  for (const label of labels) {
    await requireResourceHealth();
    await resourceAction(() => click(panel, 'scrape-result-tab', label));
    const state = await waitFor(
      `scrape_${phase}_${label}_invariance`,
      () => scrapeState(panel),
      (value) => value?.selected === label && value.visible && typeof value.resultText === 'string',
    );
    await requireResourceHealth();
    const snapshot = capturePaneSnapshot(state);
    assert.deepEqual(snapshot, baseline[label], `scrape_${phase}_${label}_capture_changed`);
    observed[label] = snapshot;
  }
  return { panes_compared: Object.keys(observed), unchanged: true };
}

export async function observeEmptyMediaPanes({
  panel,
  phase,
  click,
  resourceAction,
  requireResourceHealth,
  observeSelectedMedia,
  evaluate,
  scrapeState,
}) {
  const evidence = {};
  for (const label of ['Images', 'Video']) {
    await requireResourceHealth();
    await resourceAction(() => click(panel, 'scrape-result-tab', label));
    await requireResourceHealth();
    evidence[label.toLowerCase()] = await observeSelectedMedia({
      panel,
      label,
      items: [],
      name: `scrape_${phase}_empty_${label}_tab`,
      evaluate,
      scrapeState,
    });
  }
  return evidence;
}

export function assertCompleteTabCoverage({ warm, reload }) {
  for (const [phase, evidence] of Object.entries({ warm, reload })) {
    assert.equal(
      evidence?.invariance?.unchanged,
      true,
      `scrape_${phase}_capture_invariance_missing`,
    );
    assert.deepEqual(
      evidence.invariance.panes_compared,
      ['Article', 'Images', 'Video', 'Links', 'SEO', 'Schema'],
      `scrape_${phase}_capture_panes_missing`,
    );
    for (const label of ['images', 'video']) {
      assert.equal(
        evidence?.empty?.[label]?.pane,
        label === 'images' ? 'Images' : 'Video',
        `scrape_${phase}_${label}_empty_pane_missing`,
      );
      assert.equal(evidence.empty[label].state, 'empty', `scrape_${phase}_${label}_not_empty`);
      assert.equal(evidence.empty[label].count, 0, `scrape_${phase}_${label}_empty_count`);
    }
  }
  return true;
}
