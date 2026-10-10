import assert from 'node:assert/strict';
import { clickPickerCancel } from './data-guest-picker-driver.mjs';

/** Exercise the empty picker exit before any field is selected. */
export async function verifyEmptyPickerDismissal({
  page,
  panel,
  readState,
  openPicker,
  waitForState,
}) {
  const before = await waitForState(
    'data_guest_cancel_baseline_picker_enabled',
    readState,
    (state) => state?.pickerButtonPresent === 1 && state.pickerButton === 1,
  );
  assert.equal(before.selectedFieldMarkers, 0, 'data_guest_cancel_baseline_has_fields');
  assert.equal(before.pickerButton, 1, 'data_guest_cancel_baseline_picker_not_enabled');
  await panel.send('Network.enable');
  const writes = [];
  const stopNetwork = panel.on('Network.requestWillBeSent', ({ request }) => {
    if (request?.method !== 'GET' && /\/wbx_pattern(?:\?|$)/.test(request?.url ?? ''))
      writes.push(request.method);
  });
  try {
    await openPicker();
    await page.locator('#matrx-data-picker-host').waitFor({ state: 'attached' });
    await clickPickerCancel(page);
    await page.locator('#matrx-data-picker-host').waitFor({ state: 'detached' });
    const after = await waitForState(
      'data_guest_picker_cancelled_without_fields',
      readState,
      (state) => state.pickerButton === 1 && state.cancelSelection === 0,
    );
    assert.equal(after.selectedFieldMarkers, 0, 'data_guest_cancel_selected_fields_changed');
    assert.deepEqual(writes, [], 'data_guest_cancel_wrote_pattern');
  } finally {
    stopNetwork();
  }
}
