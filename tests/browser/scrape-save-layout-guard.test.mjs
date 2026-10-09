import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  scrapeSaveLayoutFailure,
  scrapeSaveUnverifiedMeasurements,
} from './scrape-save-layout-guard.mjs';

const working = {
  modal: true,
  focusStayedInside: true,
  candidateCount: 43,
  region: {
    clientHeight: 192,
    scrollHeight: 1400,
    beforeWheel: 0,
    afterWheel: 260,
    afterPageDown: 430,
  },
  belowFoldProjectReached: true,
  selectedChipVisible: true,
};

test('native Save receipt requires a true modal and a reachable below-fold project', () => {
  assert.equal(scrapeSaveLayoutFailure(working), null);
  assert.equal(scrapeSaveLayoutFailure({ ...working, modal: false }), 'save_dialog_focus_escaped');
  assert.equal(
    scrapeSaveLayoutFailure({ ...working, focusStayedInside: false }),
    'save_dialog_focus_escaped',
  );
  assert.equal(
    scrapeSaveLayoutFailure({ ...working, region: { ...working.region, scrollHeight: 192 } }),
    'save_places_not_scrollable',
  );
  assert.equal(
    scrapeSaveLayoutFailure({ ...working, region: { ...working.region, afterWheel: 0 } }),
    'save_places_wheel_did_not_scroll',
  );
  assert.equal(
    scrapeSaveLayoutFailure({ ...working, region: { ...working.region, afterPageDown: 260 } }),
    'save_places_keyboard_did_not_scroll',
  );
  assert.equal(
    scrapeSaveLayoutFailure({ ...working, belowFoldProjectReached: false }),
    'save_places_below_fold_project_unreachable',
  );
  assert.equal(
    scrapeSaveLayoutFailure({ ...working, selectedChipVisible: false }),
    'save_places_below_fold_project_unreachable',
  );
  const cuaOnly = {
    ...working,
    modal: null,
    region: null,
    wheelMovedVisibleList: true,
    keyboardMovedVisibleList: true,
  };
  assert.equal(scrapeSaveLayoutFailure(cuaOnly), null);
  assert.deepEqual(scrapeSaveUnverifiedMeasurements(cuaOnly), ['modal_dom', 'scroll_geometry']);
});
