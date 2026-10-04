import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runProfileExecutionBoundary } from './profile-native-failure.mjs';
import { runProfileSaveFailureCase } from './profile-save-failure-case.mjs';

const ORIGIN = 'https://db.test.invalid';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORGANIZATION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ORIGINAL = 'Profile first save original';

function successfulUi({ failCleanupReconcile = false } = {}) {
  let listener = null;
  let persisted = ORIGINAL;
  let marker = ORIGINAL;
  let saves = 0;
  let reconciles = 0;
  const writes = [];
  const cleanupError = new Error('cleanup private@example.com');
  const ui = {
    preferred: ORIGINAL,
    dirty: false,
    saveEnabled: false,
    headerSaveDisabled: true,
    error: null,
    loading: false,
    back: true,
  };
  const panel = {
    on(name, callback) {
      assert.equal(name, 'Fetch.requestPaused');
      listener = callback;
      return () => {
        listener = null;
      };
    },
    async send(name) {
      assert.ok(
        ['Fetch.enable', 'Fetch.disable', 'Fetch.failRequest', 'Fetch.continueRequest'].includes(
          name,
        ),
      );
      return {};
    },
  };
  const journal = {
    async reconcile() {
      reconciles++;
      if (failCleanupReconcile && reconciles === 2) throw cleanupError;
      return { owned: { userId: USER_ID, organizationId: ORGANIZATION_ID, marker } };
    },
    async save(value, action) {
      writes.push(value);
      await action();
      marker = value;
    },
  };
  return {
    cleanupError,
    writes,
    options: {
      panel,
      origin: ORIGIN,
      email: 'member@example.com',
      original: ORIGINAL,
      journal,
      state: async () => ({ ...ui }),
      fillPreferred: async (_panel, value) => {
        ui.preferred = value;
        ui.dirty = true;
        ui.saveEnabled = true;
        ui.headerSaveDisabled = false;
      },
      clickProfileHeader: async (_panel, label) => {
        if (label !== 'Save') throw new Error('unexpected_header_action');
        saves++;
        if (saves === 1) {
          listener({
            requestId: 'faulted-write',
            request: {
              url: `${ORIGIN}/rest/v1/user_form_profile?on_conflict=user_id`,
              method: 'POST',
              headers: { 'Content-Profile': 'users' },
              postData: JSON.stringify({
                user_id: USER_ID,
                organization_id: ORGANIZATION_ID,
                preferred_name: ui.preferred,
              }),
            },
          });
          ui.error = 'Failed to fetch';
        } else {
          persisted = ui.preferred;
          ui.dirty = false;
          ui.saveEnabled = false;
          ui.headerSaveDisabled = true;
          ui.error = null;
        }
      },
      goBack: async () => {
        ui.back = false;
      },
      openProfile: async () => {
        ui.back = true;
        ui.preferred = persisted;
        ui.dirty = false;
      },
    },
  };
}

test('actual case and runner boundary retain primary plus safe restoration diagnostic', async () => {
  const primary = new Error('profile_primary_failure:private@example.com');
  const secondary = new Error('cleanup private@example.com');
  const report = { stage: 'profile' };
  const returned = await runProfileExecutionBoundary(
    report,
    () =>
      runProfileSaveFailureCase({
        panel: {},
        origin: ORIGIN,
        original: ORIGINAL,
        journal: {
          save() {},
          reconcile: async () => {
            throw secondary;
          },
        },
        state: async () => {
          throw primary;
        },
      }),
    { getOperation: () => 'case_save_failure_warm', readUiState: async () => null },
  );
  assert.equal(returned, primary);
  assert.equal(returned.profileRestorationError, secondary);
  assert.deepEqual(report.execution_failure.restoration, {
    code: 'profile_case_restoration_failed',
    stage: 'journal_reconcile',
  });
  assert.equal(report.execution_failure_code, 'profile_unclassified_failure');
  assert.equal(JSON.stringify(report).includes('private@example.com'), false);
});

test('actual case reports cleanup-only failure after successful retry', async () => {
  const fixture = successfulUi({ failCleanupReconcile: true });
  const report = { stage: 'profile' };
  const returned = await runProfileExecutionBoundary(
    report,
    () => runProfileSaveFailureCase(fixture.options),
    { getOperation: () => 'case_save_failure_warm', readUiState: async () => null },
  );
  assert.equal(returned.message, 'profile_case_restoration_failed');
  assert.equal(returned.cause, fixture.cleanupError);
  assert.deepEqual(report.execution_failure.restoration, {
    code: 'profile_case_restoration_failed',
    stage: 'journal_reconcile',
  });
  assert.equal(fixture.writes.length, 1);
  assert.equal(JSON.stringify(report).includes('private@example.com'), false);
});

test('actual case still returns provisional receipt after value restoration', async () => {
  const fixture = successfulUi();
  const receipt = await runProfileSaveFailureCase(fixture.options);
  assert.equal(receipt.status, 'provisional_until_runner_row_absence_verified');
  assert.equal(receipt.observed.retry_persisted_after_reopen, true);
  assert.equal(receipt.observed.owned_row_value_restored, true);
  assert.equal(receipt.original_absence_verified, false);
  assert.equal(fixture.writes.length, 2);
  assert.equal(fixture.writes[1], ORIGINAL);
});
