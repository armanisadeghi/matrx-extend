import assert from 'node:assert/strict';

export const DEBUG_MODE_STORAGE_KEY = 'matrx.store.debug-mode';
export const ADMIN_TAB_TITLES = [
  'Showcase (admin only)',
  'Pilot (admin only — sandboxed tab group)',
  'Token broker (admin only)',
  'Debug (admin only)',
];

export function parseDebugModePreference(storageValue) {
  if (storageValue === undefined || storageValue === null) return false;
  if (typeof storageValue !== 'string') throw new Error('debug_mode_storage_shape_invalid');
  let persisted;
  try {
    persisted = JSON.parse(storageValue);
  } catch {
    throw new Error('debug_mode_storage_json_invalid');
  }
  if (typeof persisted?.state?.on !== 'boolean')
    throw new Error('debug_mode_storage_preference_invalid');
  return persisted.state.on;
}

export function requireAdminTabProjection({ isVerifiedAdmin, debugModeOn, visibleAdminTabTitles }) {
  assert.equal(typeof isVerifiedAdmin, 'boolean', 'verified_admin_state_required');
  assert.equal(typeof debugModeOn, 'boolean', 'debug_preference_state_required');
  const expected = isVerifiedAdmin && debugModeOn ? ADMIN_TAB_TITLES : [];
  assert.deepEqual(visibleAdminTabTitles, expected, 'admin_tab_projection_mismatch');
  return expected.length > 0;
}
