import assert from 'node:assert/strict';
import test from 'node:test';
import { auditMissingCaseFailure } from './audit-key-native-case-diagnostics.mjs';

test('T27 card comparison failure has an exact fixed target and bounded observation', () => {
  const result = auditMissingCaseFailure('T27', 'compare_reloaded', {
    receipt_count: 2,
    visible_rows: 2,
    keyId: 'private-key-like-string',
  });
  assert.equal(result.failure_code, 'audit_t27_compare_reloaded_failed');
  assert.deepEqual(result.diagnostic.last_safe_observation, {
    selected_origin: null,
    receipt_count: 2,
    visible_rows: 2,
    dialog_visible: null,
    key_unchanged: null,
  });
});

test('T62 filter failure identifies the selected origin without copying page content', () => {
  const result = auditMissingCaseFailure('T62', 'compare_pilot', {
    selected_origin: 'pilot',
    visible_rows: 0,
    rawPage: 'secret receipt signature',
  });
  assert.equal(result.failure_code, 'audit_t62_compare_pilot_failed');
  assert.equal(result.diagnostic.last_safe_observation.selected_origin, 'pilot');
  assert.equal(result.diagnostic.last_safe_observation.visible_rows, 0);
});

test('T61 cancel failure identifies its boundary without copying an error or key', () => {
  const result = auditMissingCaseFailure('T61', 'compare_after_cancel', {
    dialog_visible: false,
    key_unchanged: false,
    error: 'secret-like text',
    keyId: 'private-key-like-string',
  });
  assert.equal(result.failure_code, 'audit_t61_compare_after_cancel_failed');
  assert.equal(result.diagnostic.last_safe_observation.key_unchanged, false);
  assert.doesNotMatch(JSON.stringify(result), /secret|private-key/);
});

test('unknown stages, steps and unbounded counts never become receipt codes or observations', () => {
  assert.equal(auditMissingCaseFailure('T27', 'unknown_secret'), null);
  assert.equal(auditMissingCaseFailure('secret_stage', 'compare_warm'), null);
  const result = auditMissingCaseFailure('T62', 'compare_all', {
    selected_origin: 'secret_origin',
    receipt_count: 1001,
    visible_rows: -1,
  });
  assert.deepEqual(result.diagnostic.last_safe_observation, {
    selected_origin: null,
    receipt_count: null,
    visible_rows: null,
    dialog_visible: null,
    key_unchanged: null,
  });
});
