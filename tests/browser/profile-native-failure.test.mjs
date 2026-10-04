import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  captureProfileExecutionFailure,
  runProfileExecutionBoundary,
  runProfilePointer,
} from './profile-native-failure.mjs';

test('execution boundary captures the thrown pointer before restoration changes stage', async () => {
  const report = { stage: 'profile' };
  const error = new Error('unique visible pointer target:private@example.com');
  error.profilePointerCall = 'profile_menu_item';
  error.driverFailure = {
    code: 'pointer_target_not_unique',
    matchedTargetCount: 1,
    visibleMatchCount: 0,
  };
  let operation = 'warm_profile';
  const returned = await runProfileExecutionBoundary(
    report,
    async () => {
      report.stage = 'extension_reload';
      operation = 'open_profile_after_reload';
      throw error;
    },
    {
      getOperation: () => operation,
      readUiState: async () => ({
        active_settings_tab: true,
        active_chat_tab: false,
        active_tab_count: 1,
        account_button_count: 1,
        profile_button_count: 0,
        back_button_count: 0,
        menu_count: 1,
      }),
    },
  );
  report.stage = 'restore_original_absence';
  assert.equal(returned, error);
  assert.deepEqual(report.execution_failure, {
    stage: 'extension_reload',
    operation: 'open_profile_after_reload',
    pointer_call: 'profile_menu_item',
    code: 'pointer_target_not_unique',
    matched_target_count: 1,
    visible_match_count: 0,
    ui: {
      active_settings_tab: true,
      active_chat_tab: false,
      active_tab_count: 1,
      account_button_count: 1,
      profile_button_count: 0,
      back_button_count: 0,
      menu_count: 1,
    },
  });
  assert.equal(JSON.stringify(report).includes('private@example.com'), false);
});

test('successful execution leaves no failure evidence', async () => {
  const report = { stage: 'profile' };
  let executed = false;
  const returned = await runProfileExecutionBoundary(
    report,
    async () => {
      executed = true;
    },
    {
      getOperation: () => 'warm_profile',
      readUiState: async () => {
        throw new Error('should not sample');
      },
    },
  );
  assert.equal(executed, true);
  assert.equal(returned, null);
  assert.equal(Object.hasOwn(report, 'execution_failure'), false);
});

test('the failed trusted pointer call reaches the report with its operation', async () => {
  const report = { stage: 'extension_reload' };
  const pointerError = new Error('unique visible pointer target');
  pointerError.driverFailure = {
    code: 'pointer_target_not_unique',
    matchedTargetCount: 1,
    visibleMatchCount: 0,
  };
  try {
    await runProfilePointer(
      async () => {
        throw pointerError;
      },
      {},
      'title',
      'private@example.com',
      'account_menu',
    );
    assert.fail('pointer failure did not propagate');
  } catch (error) {
    await captureProfileExecutionFailure(report, error, {
      operation: 'open_profile_after_reload',
      readUiState: async () => ({ sample_unavailable: true }),
    });
  }
  assert.deepEqual(report.execution_failure, {
    stage: 'extension_reload',
    operation: 'open_profile_after_reload',
    pointer_call: 'account_menu',
    code: 'pointer_target_not_unique',
    matched_target_count: 1,
    visible_match_count: 0,
    ui: { sample_unavailable: true },
  });
  assert.equal(JSON.stringify(report).includes('private@example.com'), false);
});

test('records the failed reload pointer call and UI shape without private selector values', async () => {
  const report = { stage: 'extension_reload', cases: [] };
  const error = new Error('unique visible pointer target:private@example.com');
  error.profilePointerCall = 'account_menu';
  error.driverFailure = {
    code: 'pointer_target_not_unique',
    matchedTargetCount: 0,
    visibleMatchCount: 0,
    centerOccluder: { text: 'private@example.com' },
  };
  await captureProfileExecutionFailure(report, error, {
    operation: 'open_profile_after_reload',
    readUiState: async () => ({
      active_settings_tab: false,
      active_chat_tab: true,
      active_tab_count: 1,
      account_button_count: 0,
      profile_button_count: 0,
      back_button_count: 0,
      menu_count: 0,
      private: 'private@example.com',
    }),
  });
  assert.deepEqual(report.execution_failure, {
    stage: 'extension_reload',
    operation: 'open_profile_after_reload',
    pointer_call: 'account_menu',
    code: 'pointer_target_not_unique',
    matched_target_count: 0,
    visible_match_count: 0,
    ui: {
      active_settings_tab: false,
      active_chat_tab: true,
      active_tab_count: 1,
      account_button_count: 0,
      profile_button_count: 0,
      back_button_count: 0,
      menu_count: 0,
    },
  });
  assert.equal(JSON.stringify(report).includes('private@example.com'), false);
});

test('preserves a non-pointer failure stage without inventing pointer evidence', async () => {
  const report = { stage: 'profile' };
  await captureProfileExecutionFailure(report, new Error('profile_initial_load_failed'), {
    operation: 'warm_profile',
    readUiState: async () => {
      throw new Error('should not sample');
    },
  });
  assert.deepEqual(report.execution_failure, { stage: 'profile', operation: 'warm_profile' });
});
