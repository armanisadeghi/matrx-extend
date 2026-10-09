/** Check measured browser behavior of the Save Source place picker. */
export function scrapeSaveLayoutFailure(receipt) {
  if (!receipt || receipt.candidateCount < 6) {
    return 'save_picker_measurement_missing';
  }
  if (receipt.modal === false || !receipt.focusStayedInside) return 'save_dialog_focus_escaped';
  const geometry = receipt.region;
  if (geometry && !(geometry.clientHeight > 0 && geometry.scrollHeight > geometry.clientHeight)) {
    return 'save_places_not_scrollable';
  }
  const wheelMoved =
    receipt.wheelMovedVisibleList ??
    (geometry ? geometry.afterWheel > geometry.beforeWheel : false);
  const keyboardMoved =
    receipt.keyboardMovedVisibleList ??
    (geometry ? geometry.afterPageDown > geometry.afterWheel : false);
  if (!wheelMoved) return 'save_places_wheel_did_not_scroll';
  if (!keyboardMoved) return 'save_places_keyboard_did_not_scroll';
  if (!receipt.belowFoldProjectReached || !receipt.selectedChipVisible) {
    return 'save_places_below_fold_project_unreachable';
  }
  return null;
}

/** Keep measurements CUA could not inspect explicit in the native receipt. */
export function scrapeSaveUnverifiedMeasurements(receipt) {
  const missing = [];
  if (receipt?.modal == null) missing.push('modal_dom');
  if (!receipt?.region) missing.push('scroll_geometry');
  return missing;
}
