import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  completeNativeAiManualStep,
  failNativeAiManualStep,
  markNativeAiManualStep,
} from './native-ai-probe-progress.mjs';

test('post-reload manual failure retains a bounded step code without thrown text', () => {
  const report = { stage: 'post_reload_manual', failure_code: null };
  markNativeAiManualStep(report, 'post_reload', 'availability_row');
  assert.equal(report.stage, 'post_reload_manual_availability_row');
  assert.equal(
    failNativeAiManualStep(report),
    'native_ai_post_reload_manual_availability_row_failed',
  );
  assert.deepEqual(report.manual_boundary, {
    cycle: 'post_reload',
    step: 'availability_row',
    outcome: 'failed',
  });
  assert.equal(failNativeAiManualStep(report), null);
  assert.doesNotMatch(JSON.stringify(report), /private|stack|message/);
});

test('completed warm manual stage cannot masquerade as a later failure', () => {
  const report = {};
  markNativeAiManualStep(report, 'warm', 'summarize_result');
  completeNativeAiManualStep(report);
  assert.equal(report.manual_boundary.outcome, 'complete');
  assert.equal(failNativeAiManualStep(report), null);
  assert.throws(
    () => markNativeAiManualStep(report, 'post_reload', 'private_throw_message'),
    /native_ai_manual_stage_invalid/,
  );
  assert.equal(report.stage, 'warm_manual_summarize_result');
});
