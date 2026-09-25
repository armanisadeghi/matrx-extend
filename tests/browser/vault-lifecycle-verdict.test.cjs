const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assertRequestedLifecycleVerdicts } = require('./vault-lifecycle-verdict.cjs');

const passed = {
  panelCloseLifecycle: { disposition: 'passed' },
  workerRestartLifecycle: {
    disposition: 'passed',
    workerRealmReset: true,
    oldWorkerTargetGone: true,
    samePanelTargetAndDocument: true,
    uiCandidateClearedOnDisconnect: true,
    oldOfferStatus: 'stale',
    oldOfferCompletedBeforeExpiry: true,
    oldOfferFieldsUnchanged: true,
    freshUiGenerateUse: true,
  },
  windowSwitchLifecycle: {
    disposition: 'passed',
    transitionKind: 'switch_away_then_close_other_window',
    otherWindowFocusedBeforeOldUse: true,
    otherWindowFocusedThroughOldUse: true,
    uiCandidateClearedOnWindowSwitch: true,
    samePanelTargetAndDocument: true,
    oldOfferStatus: 'stale',
    oldOfferCompletedBeforeExpiry: true,
    oldOfferFieldsUnchanged: true,
    originalFocusedAfterClose: true,
    freshUiGenerateUse: true,
    ownedExtraWindowCleanup: 'verified_chrome_window_removed',
  },
};

const rejects = (expected, generator, modes) =>
  assert.throws(
    () => assertRequestedLifecycleVerdicts({ generator, ...modes }),
    new RegExp(expected),
  );

assert.doesNotThrow(() =>
  assertRequestedLifecycleVerdicts({
    panelCloseRequested: true,
    workerRestartRequested: true,
    windowSwitchRequested: true,
    generator: passed,
  }),
);

for (const disposition of [
  undefined,
  'not_tested_panel_destruction_unproven',
  'failed_old_offer_survived',
  'in_progress',
])
  rejects(
    'generator_panel_close_lifecycle_not_passed',
    { ...passed, panelCloseLifecycle: disposition === undefined ? undefined : { disposition } },
    { panelCloseRequested: true },
  );

for (const field of [
  'workerRealmReset',
  'oldWorkerTargetGone',
  'samePanelTargetAndDocument',
  'uiCandidateClearedOnDisconnect',
  'oldOfferCompletedBeforeExpiry',
  'oldOfferFieldsUnchanged',
  'freshUiGenerateUse',
]) {
  const lifecycle = { ...passed.workerRestartLifecycle };
  delete lifecycle[field];
  rejects(
    `generator_worker_restart_lifecycle_missing_${field}`,
    { ...passed, workerRestartLifecycle: lifecycle },
    { workerRestartRequested: true },
  );
  for (const invalid of [false, 1, 'true', {}])
    rejects(
      `generator_worker_restart_lifecycle_missing_${field}`,
      { ...passed, workerRestartLifecycle: { ...passed.workerRestartLifecycle, [field]: invalid } },
      { workerRestartRequested: true },
    );
}

rejects(
  'generator_worker_restart_lifecycle_old_offer_not_stale',
  {
    ...passed,
    workerRestartLifecycle: { ...passed.workerRestartLifecycle, oldOfferStatus: 'accepted' },
  },
  { workerRestartRequested: true },
);

const workerWithoutOldOfferStatus = { ...passed.workerRestartLifecycle };
delete workerWithoutOldOfferStatus.oldOfferStatus;
rejects(
  'generator_worker_restart_lifecycle_old_offer_not_stale',
  { ...passed, workerRestartLifecycle: workerWithoutOldOfferStatus },
  { workerRestartRequested: true },
);

for (const disposition of [
  undefined,
  'not_tested_worker_stop_not_observed',
  'failed_old_offer_survived',
  'in_progress',
])
  rejects(
    'generator_worker_restart_lifecycle_not_passed',
    { ...passed, workerRestartLifecycle: disposition === undefined ? undefined : { disposition } },
    { workerRestartRequested: true },
  );

for (const disposition of [
  'not_tested_second_normal_window_unavailable',
  'failed_owned_extra_window_cleanup_unverified',
  'in_progress',
])
  rejects(
    'generator_window_switch_lifecycle_not_passed',
    {
      ...passed,
      windowSwitchLifecycle: {
        disposition,
        ownedExtraWindowCleanup: 'verified_chrome_window_removed',
      },
    },
    { windowSwitchRequested: true },
  );

rejects(
  'generator_window_switch_lifecycle_not_passed',
  {
    ...passed,
    windowSwitchLifecycle: {
      disposition: undefined,
      ownedExtraWindowCleanup: 'verified_chrome_window_removed',
    },
  },
  { windowSwitchRequested: true },
);

rejects(
  'generator_window_switch_lifecycle_not_passed',
  { ...passed, windowSwitchLifecycle: undefined },
  { windowSwitchRequested: true },
);

for (const cleanup of [
  undefined,
  'failed_chrome_window_removal_verification',
  'not_created_or_unidentified',
])
  rejects(
    'generator_window_switch_cleanup_not_verified',
    {
      ...passed,
      windowSwitchLifecycle: { ...passed.windowSwitchLifecycle, ownedExtraWindowCleanup: cleanup },
    },
    { windowSwitchRequested: true },
  );

for (const field of [
  'otherWindowFocusedBeforeOldUse',
  'otherWindowFocusedThroughOldUse',
  'uiCandidateClearedOnWindowSwitch',
  'samePanelTargetAndDocument',
  'oldOfferCompletedBeforeExpiry',
  'oldOfferFieldsUnchanged',
  'originalFocusedAfterClose',
  'freshUiGenerateUse',
]) {
  const lifecycle = { ...passed.windowSwitchLifecycle };
  delete lifecycle[field];
  rejects(
    `generator_window_switch_lifecycle_missing_${field}`,
    { ...passed, windowSwitchLifecycle: lifecycle },
    { windowSwitchRequested: true },
  );
  for (const invalid of [false, 1, 'true', {}])
    rejects(
      `generator_window_switch_lifecycle_missing_${field}`,
      { ...passed, windowSwitchLifecycle: { ...passed.windowSwitchLifecycle, [field]: invalid } },
      { windowSwitchRequested: true },
    );
}

rejects(
  'generator_window_switch_lifecycle_transition_kind_invalid',
  {
    ...passed,
    windowSwitchLifecycle: {
      ...passed.windowSwitchLifecycle,
      transitionKind: 'two_open_window_return_focus',
    },
  },
  { windowSwitchRequested: true },
);

const windowWithoutTransitionKind = { ...passed.windowSwitchLifecycle };
delete windowWithoutTransitionKind.transitionKind;
rejects(
  'generator_window_switch_lifecycle_transition_kind_invalid',
  { ...passed, windowSwitchLifecycle: windowWithoutTransitionKind },
  { windowSwitchRequested: true },
);

rejects(
  'generator_window_switch_lifecycle_old_offer_not_stale',
  {
    ...passed,
    windowSwitchLifecycle: { ...passed.windowSwitchLifecycle, oldOfferStatus: 'accepted' },
  },
  { windowSwitchRequested: true },
);

const windowWithoutOldOfferStatus = { ...passed.windowSwitchLifecycle };
delete windowWithoutOldOfferStatus.oldOfferStatus;
rejects(
  'generator_window_switch_lifecycle_old_offer_not_stale',
  { ...passed, windowSwitchLifecycle: windowWithoutOldOfferStatus },
  { windowSwitchRequested: true },
);

assert.doesNotThrow(() =>
  assertRequestedLifecycleVerdicts({
    workerRestartRequested: false,
    windowSwitchRequested: false,
    generator: {},
  }),
);

// Mutation proof without touching the live helper: a truthiness gate would
// accept non-boolean evidence that the strict gate refuses above.
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-lifecycle-truthiness-'));
try {
  const helperSource = fs.readFileSync(path.join(__dirname, 'vault-lifecycle-verdict.cjs'), 'utf8');
  const weakenedSource = helperSource.replace('if (value !== true)', 'if (!value)');
  assert.notEqual(weakenedSource, helperSource, 'truthiness_mutation_not_applied');
  const weakenedHelper = path.join(temporaryRoot, 'vault-lifecycle-verdict.cjs');
  fs.writeFileSync(weakenedHelper, weakenedSource);
  const { assertRequestedLifecycleVerdicts: weakenedGate } = require(weakenedHelper);
  assert.doesNotThrow(() =>
    weakenedGate({
      workerRestartRequested: true,
      generator: {
        workerRestartLifecycle: {
          ...passed.workerRestartLifecycle,
          workerRealmReset: 'truthy-not-boolean',
        },
      },
    }),
  );
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

process.stdout.write('PASS: requested lifecycle verdicts cannot fail open\n');
