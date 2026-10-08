import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyReloadSettingsFailure } from './settings-reload-boundary.mjs';

test('reload failure keeps the first click boundary and only safe pointer fields', () => {
  const error = new Error('private browser content must not reach evidence');
  error.driverFailure = {
    code: 'pointer_target_not_unique',
    sampleStage: 'visibility_filter',
    matchedTargetCount: 2,
    visibleMatchCount: 0,
    hitTarget: false,
    selectedPointAvailable: false,
    rawHtml: 'private browser content',
  };
  assert.deepEqual(classifyReloadSettingsFailure(error, 'before_click'), {
    step: 'before_click',
    category: 'pointer_target_not_unique',
    pointer: {
      sampleStage: 'visibility_filter',
      matchedTargetCount: 2,
      visibleMatchCount: 0,
      hitTarget: false,
      selectedPointAvailable: false,
    },
  });
});

test('reload failure distinguishes a missing guest state from a closed panel', () => {
  assert.deepEqual(
    classifyReloadSettingsFailure(
      new Error('guest_settings_not_observed:{"guest":false}'),
      'guest_wait_started',
    ),
    { step: 'guest_wait_started', category: 'guest_state_not_observed', pointer: null },
  );
  assert.deepEqual(classifyReloadSettingsFailure(new Error('Target closed'), 'before_click'), {
    step: 'before_click',
    category: 'panel_transport_closed',
    pointer: null,
  });
  assert.deepEqual(
    classifyReloadSettingsFailure(new Error('private browser content'), 'unexpected'),
    { step: 'unknown', category: 'other', pointer: null },
  );
});
