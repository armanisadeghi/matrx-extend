import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { captureSeoClickFailure, clickSeoReaudit } from './guest-seo-click-diagnostic.mjs';

test('SEO click failure receipt retains pointer boundary without page content', () => {
  const error = new Error('private account text');
  error.driverFailure = {
    code: 'pointer_stable_hit_not_observed',
    sampleStage: 'hit_testing',
    matchedTargetCount: 2,
    visibleMatchCount: 1,
    hitTarget: false,
    stableSamples: 0,
    selectedPointAvailable: false,
    centerHitCategory: 'other_element',
    centerOccluder: { owning_panel: 'seo', known_notice: 'none', secret: 'private account text' },
    secret: 'private account text',
  };
  const receipt = captureSeoClickFailure(error, 'target_selected');
  assert.deepEqual(receipt, {
    phase: 'target_selected',
    source: 'pointer_driver',
    code: 'pointer_stable_hit_not_observed',
    sample_stage: 'hit_testing',
    matched_target_count: 2,
    visible_match_count: 1,
    hit_target: false,
    stable_samples: 0,
    selected_point_available: false,
    center_hit_category: 'other_element',
    center_occluder: { owning_panel: 'seo', known_notice: 'none' },
  });
  assert.doesNotMatch(JSON.stringify(receipt), /private account text/);
});

test('SEO click failure receipt distinguishes non-pointer failures', () => {
  assert.deepEqual(captureSeoClickFailure(new Error('private URL'), 'press_returned'), {
    phase: 'press_returned',
    source: 'other_exception',
  });
});

test('controlled manual Re-audit captures the exact failing pointer phase', async () => {
  const report = {};
  const failure = new Error('private account text');
  failure.driverFailure = { code: 'pointer_press_dispatch_failed', hitTarget: true };
  await assert.rejects(
    clickSeoReaudit(null, report, async (_panel, kind, label, onPhase) => {
      assert.equal(kind, 'button');
      assert.equal(label, 'Re-audit');
      onPhase('target_selected');
      onPhase('press_attempted');
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.equal(report.click_failure_diagnostic.phase, 'press_attempted');
  assert.equal(report.click_failure_diagnostic.code, 'pointer_press_dispatch_failed');
  const source = readFileSync(new URL('./seo-guest-acceptance.mjs', import.meta.url), 'utf8');
  assert.ok(
    /enter\('manual_reaudit_click'\);\s*await clickSeoReaudit\(panel, report, click\)/.test(source),
  );
});
