import assert from 'node:assert/strict';
import test from 'node:test';
import { waitFor } from './settings-panel-driver.mjs';
import {
  classifyReloadSettingsFailure,
  observeReloadSettingsPanel,
} from './settings-reload-boundary.mjs';

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

test('producer-wrapped CDP closure remains transport failure after guest wait', async () => {
  let produced;
  try {
    await waitFor(
      'guest_settings',
      async () => {
        throw new Error('Target closed while reading private browser content');
      },
      () => false,
      1,
    );
  } catch (error) {
    produced = error;
  }
  assert.equal(produced?.message.startsWith('guest_settings_not_observed:'), true);
  const classified = classifyReloadSettingsFailure(produced, 'guest_wait_started');
  assert.deepEqual(classified, {
    step: 'guest_wait_started',
    category: 'panel_transport_closed',
    pointer: null,
  });
  assert.equal(JSON.stringify(classified).includes('private browser content'), false);
});

test('replacement-panel probe admits only fixed typed fields into receipt', async () => {
  const valid = {
    runtimeIdMatches: true,
    documentReady: false,
    visible: true,
    settingsTabCount: 1,
    settingsActiveCount: 0,
    guestBannerPresent: false,
    guestOrganizationGuidancePresent: true,
  };
  const panel = (value) => ({ send: async () => ({ result: { value } }) });
  const contaminated = {
    ...valid,
    rawError: 'secret',
    url: 'https://private.test/path',
    body: 'private page body',
    credentials: 'private credential',
  };
  const accepted = await observeReloadSettingsPanel(panel(contaminated), 'owned-extension');
  assert.deepEqual(accepted, { sampled: true, ...valid });
  for (const secret of ['secret', 'private.test', 'private page body', 'private credential'])
    assert.equal(JSON.stringify(accepted).includes(secret), false);
  const opposite = await observeReloadSettingsPanel(
    panel({
      ...valid,
      documentReady: true,
      guestBannerPresent: true,
      guestOrganizationGuidancePresent: false,
    }),
    'owned-extension',
  );
  assert.equal(opposite.documentReady, true);
  assert.equal(opposite.guestBannerPresent, true);
  assert.equal(opposite.guestOrganizationGuidancePresent, false);
  for (const invalid of [
    { ...valid, guestBannerPresent: 'private credential' },
    { ...valid, visible: 'https://private.test/path' },
    { ...valid, settingsTabCount: 'private page body' },
    { ...valid, settingsActiveCount: -1 },
  ]) {
    const result = await observeReloadSettingsPanel(panel(invalid), 'owned-extension');
    assert.deepEqual(result, { sampled: false });
    assert.equal(JSON.stringify(result).includes('private'), false);
  }
});
