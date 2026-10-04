import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertScrapePanelWidth,
  scrapeNativeSelection,
  selectScrapePanelViewport,
} from './scrape-native-selection.mjs';

test('Scrape selection refuses unknown mode or unmeasured normal width before browser', () => {
  assert.deepEqual(scrapeNativeSelection({}), {
    mode: 'guest',
    widthMode: 'narrow',
    minimumPanelWidth: null,
  });
  for (const env of [
    { MATRX_SCRAPE_AUTH_MODE: 'administrator' },
    { MATRX_SCRAPE_WIDTH_MODE: 'wide' },
    { MATRX_SCRAPE_WIDTH_MODE: 'normal' },
    { MATRX_SCRAPE_WIDTH_MODE: 'normal', MATRX_SCRAPE_MIN_PANEL_WIDTH_PX: '360' },
    { MATRX_SCRAPE_WIDTH_MODE: 'normal', MATRX_SCRAPE_MIN_PANEL_WIDTH_PX: 'unknown' },
    { MATRX_SCRAPE_MIN_PANEL_WIDTH_PX: '480' },
  ])
    assert.throws(() => scrapeNativeSelection(env));
  assert.equal(
    scrapeNativeSelection({
      MATRX_SCRAPE_AUTH_MODE: 'member',
      MATRX_SCRAPE_WIDTH_MODE: 'normal',
      MATRX_SCRAPE_MIN_PANEL_WIDTH_PX: '480',
    }).mode,
    'member',
  );
  assert.equal(scrapeNativeSelection({ MATRX_SCRAPE_AUTH_MODE: 'admin' }).mode, 'admin');
});

test('normal Scrape viewport receipt requires observed SIDE_PANEL width after override', async () => {
  const selection = scrapeNativeSelection({
    MATRX_SCRAPE_WIDTH_MODE: 'normal',
    MATRX_SCRAPE_MIN_PANEL_WIDTH_PX: '480',
  });
  const calls = [];
  let observed = 360;
  const panel = {
    async send(command, args) {
      calls.push([command, args]);
      observed = args.width;
    },
  };
  const evaluate = async (_panel, expression) =>
    expression === 'innerWidth' ? observed : { width: observed, height: 768 };
  assert.deepEqual(await selectScrapePanelViewport(panel, selection, evaluate), {
    mode: 'normal',
    mechanism: 'owned_SIDE_PANEL_CDP_viewport_emulation',
    observed_px: 480,
    minimum_px: 480,
  });
  assert.equal(calls[0][0], 'Emulation.setDeviceMetricsOverride');
  assert.equal(calls[0][1].mobile, false);
  assert.throws(() => assertScrapePanelWidth(selection, 360), /scrape_normal_panel_width_unmet/);
  assert.throws(() => assertScrapePanelWidth(selection, null), /scrape_panel_width_unobserved/);
  const narrow = scrapeNativeSelection({});
  assert.equal(assertScrapePanelWidth(narrow, 360).mechanism, 'native_default');
});
