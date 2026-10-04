import assert from 'node:assert/strict';
import test from 'node:test';
import {
  captureContextBoundary,
  captureFailure,
  captureManagement,
} from './profile-reload-capture.mjs';

test('context boundary capture keeps only counts and elapsed time', () => {
  const captured = captureContextBoundary({
    first: {
      side_panel_count: 1,
      exact_expected_count: 0,
      elapsed_ms: 0,
      documentUrl: 'private URL',
    },
    last: {
      side_panel_count: 1,
      exact_expected_count: 1,
      elapsed_ms: 123,
      targetId: 'private target',
    },
    attempts: 2,
    exact_expected_appeared: true,
    stack: 'private stack',
  });
  assert.equal(captured.first.exact_expected_count, 0);
  assert.equal(captured.last.exact_expected_count, 1);
  assert.equal(captured.last.elapsed_ms, 123);
  assert.doesNotMatch(JSON.stringify(captured), /private/);
  const error = new Error('native_sidepanel_runtime_context_missing');
  error.contextBoundary = {
    first: { side_panel_count: 1, exact_expected_count: 0, elapsed_ms: 7 },
    last: { side_panel_count: 1, exact_expected_count: 1, elapsed_ms: 115 },
    attempts: 2,
    exact_expected_appeared: true,
  };
  const failure = captureFailure(error, () => 'none');
  assert.equal(failure.failure_code, 'native_sidepanel_runtime_context_missing');
  assert.equal(failure.context_boundary.first.exact_expected_count, 0);
  assert.equal(failure.context_boundary.last.exact_expected_count, 1);
});

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
