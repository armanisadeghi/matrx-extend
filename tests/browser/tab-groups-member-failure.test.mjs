import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tabGroupsFailureCode, withOwnedTabCleanup } from './tab-groups-member-failure.mjs';

test('manual runner failure keeps its first stage and step after successful cleanup', async () => {
  const report = { stage: 'tools_manual_runner', manual_runner_step: 'tools_tab_click' };
  let cleanupRan = false;
  await assert.rejects(
    withOwnedTabCleanup(
      report,
      async () => {
        throw new Error('raw panel exception with unsafe content');
      },
      async () => {
        cleanupRan = true;
      },
      async () => {
        report.manual_runner_observation = {
          availability: 'ready',
          tools_tab_matches: 1,
          tools_tab_active: 0,
        };
      },
    ),
    /raw panel exception/,
  );
  assert.equal(cleanupRan, true);
  assert.deepEqual(
    {
      stage: report.stage,
      failure_stage: report.failure_stage,
      failure_step: report.failure_step,
      failure_code: report.failure_code,
    },
    {
      stage: 'tools_manual_runner',
      failure_stage: 'tools_manual_runner',
      failure_step: 'tools_tab_click',
      failure_code: 'tab_groups_manual_tools_tab_click_failed',
    },
  );
  assert.equal(JSON.stringify(report).includes('unsafe content'), false);
  assert.equal(report.manual_runner_observation.tools_tab_active, 0);
});

test('cleanup error stays secondary to manual runner error', async () => {
  const report = { stage: 'tools_manual_runner', manual_runner_step: 'all_handlers_selected' };
  const primary = new Error('panel disconnected');
  await assert.rejects(
    withOwnedTabCleanup(
      report,
      async () => {
        throw primary;
      },
      async () => {
        throw new Error('tab_groups_owned_tab_cleanup_unverified');
      },
    ),
    (error) => error === primary,
  );
  assert.equal(report.failure_code, 'tab_groups_manual_all_handlers_selected_failed');
  assert.equal(report.cleanup_failure_code, 'tab_groups_owned_tab_cleanup_unverified');
  assert.equal(report.stage, 'tools_manual_runner');
});

test('cleanup becomes the primary failure only after a successful exercise', async () => {
  const report = {
    stage: 'tab_groups_get_tab_groups',
    manual_runner_step: 'tab_groups_form_ready',
  };
  await assert.rejects(
    withOwnedTabCleanup(
      report,
      async () => 'created',
      async () => {
        throw new Error('tab_groups_owned_tab_cleanup_unverified');
      },
    ),
    /tab_groups_owned_tab_cleanup_unverified/,
  );
  assert.equal(report.stage, 'cleanup');
  assert.equal(report.failure_code, undefined);
  assert.equal(report.cleanup_failure_code, 'tab_groups_owned_tab_cleanup_unverified');
  assert.equal(
    tabGroupsFailureCode(new Error('tab_groups_owned_tab_cleanup_unverified'), report),
    'tab_groups_owned_tab_cleanup_unverified',
  );
});

test('failed panel observation does not replace the original failure', async () => {
  const report = { stage: 'tools_manual_runner', manual_runner_step: 'catalog_ready' };
  const primary = new Error('panel renderer unavailable');
  await assert.rejects(
    withOwnedTabCleanup(
      report,
      async () => {
        throw primary;
      },
      async () => {},
      async () => {
        throw new Error('CDP transport lost');
      },
    ),
    (error) => error === primary,
  );
  assert.equal(report.failure_code, 'tab_groups_manual_catalog_ready_failed');
  assert.deepEqual(report.manual_runner_observation, { availability: 'unavailable' });
});

test('assertion detail keeps the allowlisted failure code without leaking actual values', () => {
  let failure;
  try {
    assert.equal(false, true, 'tab_groups_create_refused');
  } catch (error) {
    failure = error;
  }
  assert.equal(
    tabGroupsFailureCode(failure, { stage: 'tab_groups_create' }),
    'tab_groups_create_refused',
  );
  assert.equal(
    tabGroupsFailureCode(new Error('raw native details\nsecret'), {
      stage: 'tab_groups_update_false',
    }),
    'tab_groups_update_false_failed',
  );
  assert.equal(
    tabGroupsFailureCode(new Error('tab_groups_create_refused_secret'), { stage: 'inputs' }),
    'unclassified_failure',
  );
});
