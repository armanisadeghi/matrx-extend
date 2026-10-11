import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import {
  captureSeoClickFailure,
  clickSeoReaudit,
  observeSeoReauditHit,
  safeSeoClickEvidence,
} from './guest-seo-click-diagnostic.mjs';

test('Re-audit hit sample distinguishes a database notice from a clear target', async () => {
  const window = new Window();
  try {
    window.document.body.innerHTML = `<button role="tab" title="SEO" aria-selected="true"
      aria-controls="seo-pane"></button><div id="seo-pane" role="tabpanel" data-state="active">
      <button>Re-audit</button></div><div role="alert"><div class="font-medium">
      Saved audits unavailable</div><p>the database refused the request because your account is not allowed</p><button aria-label="Dismiss"></button></div>`;
    const button = window.document.querySelector('#seo-pane button');
    const notice = window.document.querySelector('[role="alert"]');
    const rect = { x: 0, y: 0, left: 0, top: 0, right: 90, bottom: 30, width: 90, height: 30 };
    for (const element of window.document.querySelectorAll('*')) {
      element.getBoundingClientRect = () => rect;
      element.scrollIntoView = () => {};
    }
    let occluded = true;
    window.document.elementFromPoint = () => (occluded ? notice : button);
    const panel = {
      async send(_method, args) {
        return { result: { value: JSON.parse(JSON.stringify(window.eval(args.expression))) } };
      },
    };
    assert.deepEqual(await observeSeoReauditHit(panel), {
      active: true,
      target_count: 1,
      target_enabled: true,
      database_refused_notice_count: 1,
      hit_point_count: 0,
      notice_hit_point_count: 9,
      dismiss_visible: true,
    });
    occluded = false;
    notice.querySelector('button').style.display = 'none';
    assert.deepEqual(await observeSeoReauditHit(panel), {
      active: true,
      target_count: 1,
      target_enabled: true,
      database_refused_notice_count: 1,
      hit_point_count: 9,
      notice_hit_point_count: 0,
      dismiss_visible: false,
    });
  } finally {
    window.happyDOM.abort();
  }
});

test('native sibling notice hit snapshots survive the guarded progress sanitizer', () => {
  const sample = {
    active: true,
    target_count: 1,
    target_enabled: true,
    database_refused_notice_count: 1,
    dismiss_visible: true,
    hit_point_count: 9,
    notice_hit_point_count: 0,
    privatePageText: 'private account text',
  };
  const receipt = safeSeoClickEvidence({
    reaudit_hit_diagnostics: {
      narrow_warm_navigation: sample,
      normal_warm_navigation: sample,
      after_reload: { ...sample, database_refused_notice_count: 0 },
    },
  });
  assert.deepEqual(Object.keys(receipt.reaudit_hit_diagnostics), [
    'narrow_warm_navigation',
    'normal_warm_navigation',
    'after_reload',
  ]);
  assert.equal(receipt.reaudit_hit_diagnostics.narrow_warm_navigation.hit_point_count, 9);
  assert.equal(receipt.reaudit_hit_diagnostics.after_reload.database_refused_notice_count, 0);
  assert.doesNotMatch(JSON.stringify(receipt), /private account text/);
});

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
    /enter\('manual_reaudit_click'\);\s*await clickSeoReaudit\(panel, report, click, checkpoint\)/.test(
      source,
    ),
  );
});
