import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import {
  planNoticeViewports,
  restoreNativeNoticeViewport,
  setNoticeViewport,
} from './seo-notice-viewport.mjs';
import {
  captureReauditWaitFailure,
  reauditSettledOnCurrentPage,
  reauditTransitionWitness,
} from './seo-reaudit-transition-diagnostic.mjs';

// Exercise the actual browser driver's scope decisions; doubles replace browser IO only.
const source = readFileSync(new URL('./seo-guest-acceptance.mjs', import.meta.url), 'utf8');
const ast = ts.createSourceFile('driver.mjs', source, ts.ScriptTarget.Latest, true);
let callback;
function visit(node) {
  if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'exercisePanel')
    callback = node.initializer.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
const clearance = ast.statements
  .find((n) => ts.isFunctionDeclaration(n) && n.name?.text === 'requireVisibleNoticeClearance')
  .getText(ast);
const captured = JSON.parse(
  readFileSync(
    new URL(
      '../../docs/stabilization/evidence/seo-notice-occlusion/run38160708149/native-report.sanitized.json',
      import.meta.url,
    ),
    'utf8',
  ),
).reaudit_hit_diagnostics.before_click;

const reloadCapture = JSON.parse(
  readFileSync(
    new URL(
      '../../docs/stabilization/reports/seo-notice-reload-oracle-diagnosis-20261011.json',
      import.meta.url,
    ),
    'utf8',
  ),
).captured_observations.after_reload;

async function run(
  occluded = false,
  driver = callback,
  reloadNoticeCount = reloadCapture.database_refused_notice_count,
  reloadOccluded = false,
  reloadDismissVisible = true,
) {
  let viewportWidth = 360;
  let index = 0;
  let dismissed = false;
  let reloaded = false;
  const targets = [];
  const events = [];
  const observations = [];
  const hit = () => ({
    ...captured,
    database_refused_notice_count: reloaded ? reloadNoticeCount : dismissed ? 0 : 1,
    dismiss_visible: reloaded ? reloadNoticeCount > 0 && reloadDismissVisible : !dismissed,
    hit_point_count:
      (occluded && index === 0) ||
      (reloaded && (reloadOccluded === true || reloadOccluded === 'target'))
        ? 0
        : 9,
    notice_hit_point_count:
      (occluded && index === 0) ||
      (reloaded && (reloadOccluded === true || reloadOccluded === 'notice'))
        ? 9
        : 0,
  });
  const state = () => ({
    scopeValid: true,
    selected: true,
    linked: true,
    heading: true,
    headings: true,
    title: `source-${index}`,
    reAudit: true,
    auditButtonPresent: true,
    auditButtonDisabled: false,
    auditSpinner: false,
    error: false,
    mainTablists: 1,
    seoTabs: 1,
    documentTimeOrigin: reloaded ? 2 : 1,
    clickCandidateIsMainTab: true,
  });
  const context = {
    assert,
    SEO_CASE_SCOPE: 'notice',
    NOTICE_ONLY: true,
    CHECK_NOTICE: true,
    PAGES: ['https://example.org/', 'https://www.iana.org/domains/reserved'],
    report: {},
    advance: (name) => events.push(name),
    enter: (name) => events.push(name),
    checkpoint() {},
    target: (id, name, evidence) => {
      targets.push([id, name]);
      observations.push({ name, evidence });
    },
    unverifiedTarget() {},
    runForcedNoticeReload: async () => {
      events.push('forced-reload-io');
      return {};
    },
    runNativeSeoHistoryRecovery: async () => {
      events.push('refusal');
      return {};
    },
    evaluate: async (_panel, expression) =>
      expression === 'innerWidth' ? viewportWidth : { width: viewportWidth, height: 373 },
    planNoticeViewports,
    setNoticeViewport,
    restoreNativeNoticeViewport,
    pageEvidence: async () => ({ title: `source-${index}`, heading: true }),
    selectedSeo: async () => state(),
    seoContent: async () => state(),
    observe: async (_name, read) => read(),
    waitObserved: async (name, read, accept) => {
      const value = await read();
      assert.ok(accept(value), name);
      return value;
    },
    observeSeoReauditHit: async () => hit(),
    click: async (_panel, selector) => {
      if (selector === 'seo-database-refused-dismiss') dismissed = true;
    },
    captureReauditWaitFailure,
    reauditTransitionWitness,
    reauditSettledOnCurrentPage,
    clickSeoReaudit: async () => {
      events.push('trusted-reaudit');
      // Browser IO supplies committed observations; real oracle decisions above
      // are never replaced by a canned success in this scope orchestration test.
      context.report.reaudit_transition_diagnostic = {
        observer_available: true,
        dropped_samples: 0,
        samples: [
          { ...state(), stage: 'before_click', elapsed_ms: 1 },
          { ...state(), stage: 'click_event', elapsed_ms: 259, click_trusted: true },
          {
            ...state(),
            stage: 'dom_transition',
            elapsed_ms: 266,
            auditButtonDisabled: true,
            auditSpinner: true,
            reAudit: false,
          },
          { ...state(), stage: 'dom_transition', elapsed_ms: 326 },
        ],
      };
    },
    startSeoReauditTrace: async () => ({ sample: async () => {}, stop: async () => {} }),
    waitFor: async (_name, read, accept) => {
      const value = await read();
      assert.ok(accept(value));
      return value;
    },
    checkGuestCopyFormats: async () => assert.fail('unrelated clipboard work ran'),
    copyMenu: async () => assert.fail('unrelated copy menu ran'),
  };
  const exercise = vm.runInNewContext(`${clearance}; (${driver})`, context);
  await exercise({
    page: {
      goto: async (url) => {
        index = context.PAGES.indexOf(url);
      },
      url: () => context.PAGES[index],
    },
    panel: {
      send: async (method, params) => {
        if (method === 'Page.reload') reloaded = true;
        else if (method === 'Emulation.clearDeviceMetricsOverride') viewportWidth = 360;
        else if (method === 'Emulation.setDeviceMetricsOverride') viewportWidth = params.width;
        else assert.fail(method);
      },
    },
  });
  return { targets, events, observations };
}

test('notice scope reaches all five bounded outcomes and restores viewport without clipboard work', async () => {
  const result = await run();
  assert.deepEqual(result.targets, [
    ['T02', 'notice_narrow_warm_navigation_reaudit_clearance'],
    ['T02', 'notice_wide_warm_navigation_reaudit_clearance'],
    ['T02', 'manual_button_returns_to_current_page'],
    ['T02', 'notice_reload_reaudit_clearance'],
    ['T02', 'visible_notice_full_reload_second_dismiss_at_native_360px'],
  ]);
  for (const event of [
    'refusal',
    'notice_narrow_viewport_set',
    'notice_wide_viewport_set',
    'trusted-reaudit',
    'seo_panel_reload',
    'notice_native_viewport_restore',
    'notice_only_complete',
  ])
    assert.ok(result.events.includes(event), event);
});

test('notice scope fails when real sampled hit ownership belongs to the notice', async () => {
  await assert.rejects(run(true), /all nine Re-audit points/);
});

test('notice guard rejects an empty driver instead of accepting skipped work', async () => {
  assert.notDeepEqual((await run(false, 'async () => {}')).targets, (await run()).targets);
});

test('mutation checks reject discarded clearance and accidentally restored clipboard work', async () => {
  const unchecked = callback.replace('requireVisibleNoticeClearance(hit, stage);', '');
  assert.notEqual(unchecked, callback);
  // The occluded input now passes, demonstrating that the negative case detects this mutation.
  await assert.rejects(
    async () => assert.rejects(run(true, unchecked), /all nine Re-audit points/),
    /Missing expected rejection/,
  );
  const clipboard = callback.replace(
    'if (!NOTICE_ONLY)\n          await checkGuestCopyFormats(',
    'await checkGuestCopyFormats(',
  );
  assert.notEqual(clipboard, callback);
  await assert.rejects(run(false, clipboard), /unrelated clipboard work ran/);
});

// The captured hosted attempt2 saw a visible refusal after Dismiss/reload.
// Rejecting that count invents durable suppression absent from the notice contract.
test('reload accepts either no notice or a subsequent refusal while controls remain reachable', async () => {
  for (const count of [0, 1]) {
    const result = await run(false, callback, count);
    const reload = result.observations.find(
      ({ name }) => name === 'notice_reload_reaudit_clearance',
    );
    assert.deepEqual(JSON.parse(JSON.stringify(reload.evidence)), {
      noticeCount: count,
      dismissVisible: count > 0,
      targetHitPoints: 9,
      noticeHitPoints: 0,
      currentTitleMatched: true,
    });
  }
});

test('reload rejects actual notice obstruction even when earlier width checks passed', async () => {
  await assert.rejects(
    run(false, callback, 1, true),
    /notice owns no Re-audit point after panel reload/,
  );
});

for (const [field, mutation, message] of [
  ['notice_hit_point_count', 'notice', /notice owns no Re-audit point after panel reload/],
  ['hit_point_count', 'target', /Re-audit remains target-owned after panel reload/],
]) {
  test(`reload independently rejects invalid ${field} and catches its skipped assertion`, async () => {
    await assert.rejects(run(false, callback, 1, mutation), message);
    const unchecked = callback.replace(
      new RegExp(`assert\\.equal\\(\\s*afterReloadHit\\?\\.${field},[\\s\\S]*?\\);`),
      '',
    );
    assert.notEqual(unchecked, callback);
    await assert.rejects(
      async () => assert.rejects(run(false, unchecked, 1, mutation), message),
      /Missing expected rejection/,
    );
  });
}

test('visible reload refusal requires Dismiss and catches a skipped dismissal check', async () => {
  await assert.rejects(
    run(false, callback, 1, false, false),
    /visible reload refusal remains dismissible/,
  );
  const unchecked = callback.replace(
    /assert\.equal\(\s*afterReloadHit\.dismiss_visible,[\s\S]*?\);/,
    '',
  );
  assert.notEqual(unchecked, callback);
  await assert.rejects(
    async () => assert.rejects(run(false, unchecked, 1, false, false)),
    /Missing expected rejection/,
  );
});
