import assert from 'node:assert/strict';

export function assertCaptureOn(observation, marker) {
  assert.equal(observation?.stored, true, 'auto_scrape_on_storage_missing');
  assert.equal(observation?.visible, true, 'auto_scrape_on_ui_missing');
  assert.equal(observation?.calls?.length, 1, 'auto_scrape_on_requires_one_real_capture_call');
  const call = observation.calls[0];
  assert.equal(call.kind, 'scrape:capture-page', 'auto_scrape_on_wrong_message');
  assert.equal(call.ok, true, 'auto_scrape_on_capture_failed');
  assert.equal(call.url, observation.pageUrl, 'auto_scrape_on_wrong_page');
  assert.equal(call.markerPresent, true, `auto_scrape_on_marker_missing:${marker}`);
}

export function assertCaptureOff(observation) {
  assert.equal(observation?.stored, false, 'auto_scrape_off_storage_missing');
  assert.equal(observation?.visible, false, 'auto_scrape_off_ui_missing');
  assert.equal(observation?.pageLoaded, true, 'auto_scrape_off_page_not_loaded');
  assert.equal(observation?.windowCompleted, true, 'auto_scrape_off_window_incomplete');
  assert.deepEqual(observation.calls, [], 'auto_scrape_off_emitted_capture_call');
}
