import assert from 'node:assert/strict';
import test from 'node:test';
import { captureFailure, captureManagement } from './profile-reload-capture.mjs';

test('reload failure retains the fixed lifecycle class without private data', () => {
  const error = new Error('native_extension_worker_retirement_unverified: private URL');
  error.stack = 'private stack';
  error.lifecycleEvidence = {
    old_worker_destroyed_event: false,
    old_worker_absent: true,
    old_panel_absent: true,
    replacement_worker_present: false,
    replacement_worker_created_event: false,
    observed_worker_count: 1,
    targetId: 'private target',
    management: {
      state: 'ENABLED',
      developer_mode: true,
      unsupported_developer_extension: false,
      runtime_error_count: 2,
      manifest_error_count: 0,
      url: 'private URL',
    },
  };
  const result = captureFailure(error, () => 'none');
  assert.equal(result.failure_code, 'native_extension_worker_retirement_unverified');
  assert.deepEqual(result.retirement_evidence, {
    old_worker_destroyed_event: false,
    old_worker_absent: true,
    old_panel_absent: true,
    replacement_worker_present: false,
    replacement_worker_created_event: false,
    observed_worker_count: 1,
    management: {
      state: 'ENABLED',
      developer_mode: true,
      unsupported_developer_extension: false,
      runtime_error_count: 2,
      manifest_error_count: 0,
    },
  });
  assert.doesNotMatch(JSON.stringify(result), /private/);
});

test('unknown exception and malformed evidence become bounded classes', () => {
  const error = new Error('private URL');
  error.lifecycleEvidence = { observed_worker_count: -1, old_worker_absent: 'yes' };
  const result = captureFailure(error, () => 'private transport');
  assert.equal(result.failure_code, 'unclassified');
  assert.equal(result.transport_failure_class, 'other');
  assert.equal(result.retirement_evidence.observed_worker_count, null);
  assert.equal(result.retirement_evidence.old_worker_absent, null);
  assert.equal(captureManagement({ state: 'private' }).state, 'OTHER');
  assert.doesNotMatch(JSON.stringify(result), /private/);
});
