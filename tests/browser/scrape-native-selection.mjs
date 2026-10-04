import assert from 'node:assert/strict';

export function scrapeNativeSelection(env) {
  const mode = env.MATRX_SCRAPE_AUTH_MODE ?? 'guest';
  const widthMode = env.MATRX_SCRAPE_WIDTH_MODE ?? 'narrow';
  assert.ok(['guest', 'member', 'admin'].includes(mode), 'scrape_auth_mode_invalid');
  assert.ok(['narrow', 'normal'].includes(widthMode), 'scrape_width_mode_invalid');
  const minimumPanelWidth = Number(env.MATRX_SCRAPE_MIN_PANEL_WIDTH_PX);
  if (widthMode === 'normal') {
    assert.ok(
      Number.isSafeInteger(minimumPanelWidth) && minimumPanelWidth > 360,
      'scrape_normal_minimum_width_required',
    );
  } else {
    assert.ok(!env.MATRX_SCRAPE_MIN_PANEL_WIDTH_PX, 'scrape_narrow_width_override_refused');
  }
  return { mode, widthMode, minimumPanelWidth: widthMode === 'normal' ? minimumPanelWidth : null };
}

export async function selectScrapePanelViewport(panel, selection, evaluate) {
  const before = await evaluate(panel, '({ width: innerWidth, height: innerHeight })');
  assert.ok(
    Number.isSafeInteger(before?.height) && before.height > 0,
    'scrape_panel_viewport_unobserved',
  );
  if (selection.widthMode === 'normal') {
    await panel.send('Emulation.setDeviceMetricsOverride', {
      width: selection.minimumPanelWidth,
      height: before.height,
      deviceScaleFactor: 0,
      mobile: false,
    });
  }
  const after = await evaluate(panel, 'innerWidth');
  return assertScrapePanelWidth(selection, after);
}

export function assertScrapePanelWidth(selection, observed) {
  assert.ok(Number.isFinite(observed) && observed > 0, 'scrape_panel_width_unobserved');
  if (selection.widthMode === 'normal')
    assert.ok(
      observed >= selection.minimumPanelWidth,
      `scrape_normal_panel_width_unmet:${observed}/${selection.minimumPanelWidth}`,
    );
  return {
    mode: selection.widthMode,
    mechanism:
      selection.widthMode === 'normal'
        ? 'owned_SIDE_PANEL_CDP_viewport_emulation'
        : 'native_default',
    observed_px: observed,
    minimum_px: selection.minimumPanelWidth,
  };
}
