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

async function run(
  occluded = false,
  driver = callback,
  freshReloadRefusal = true,
  reloadOccluded = 'none',
  reloadDismissVisible = true,
) {
  let viewportWidth = 360;
  let index = 0;
  let dismissed = false;
  let reloaded = false;
  const targets = [];
  const events = [];
  const hit = () => ({
    ...captured,
    database_refused_notice_count: dismissed ? 0 : 1,
    dismiss_visible: reloaded ? !dismissed && reloadDismissVisible : !dismissed,
    hit_point_count: (occluded && index === 0) || (reloaded && reloadOccluded === 'target') ? 0 : 9,
    notice_hit_point_count:
      (occluded && index === 0) || (reloaded && reloadOccluded === 'notice') ? 9 : 0,
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
    target: (id, name) => targets.push([id, name]),
    unverifiedTarget() {},
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
        if (method === 'Page.reload') {
          reloaded = true;
          // SeoView remounts and its fresh history read is refused again.
          if (freshReloadRefusal) {
            dismissed = false;
            events.push('fresh-history-refusal-after-reload');
          }
        } else if (method === 'Emulation.clearDeviceMetricsOverride') viewportWidth = 360;
        else if (method === 'Emulation.setDeviceMetricsOverride') viewportWidth = params.width;
        else assert.fail(method);
      },
    },
  });
  return { targets, events };
}

test('notice scope reaches all four bounded outcomes and restores viewport without clipboard work', async () => {
  const result = await run();
  assert.deepEqual(result.targets, [
    ['T02', 'notice_narrow_warm_navigation_reaudit_clearance'],
    ['T02', 'notice_wide_warm_navigation_reaudit_clearance'],
    ['T02', 'manual_button_returns_to_current_page'],
    ['T02', 'visible_notice_full_reload_clearance'],
  ]);
  for (const event of [
    'refusal',
    'notice_narrow_viewport_set',
    'notice_wide_viewport_set',
    'trusted-reaudit',
    'seo_panel_reload',
    'fresh-history-refusal-after-reload',
    'notice_native_viewport_restore',
    'notice_only_complete',
  ])
    assert.ok(result.events.includes(event), event);
});

test('notice scope fails when real sampled hit ownership belongs to the notice', async () => {
  await assert.rejects(run(true), /all nine Re-audit points/);
});

test('reload clearance requires the fresh refusal notice after the history retry', async () => {
  await assert.rejects(run(false, callback, false), /real refusal notice persists/);
});

test('reload independently rejects a lost Re-audit target', async () => {
  await assert.rejects(run(false, callback, true, 'target'), /all nine Re-audit points/);
});

test('reload independently rejects a fresh notice covering Re-audit', async () => {
  await assert.rejects(run(false, callback, true, 'notice'), /notice owns no Re-audit point/);
});

test('reload requires Dismiss on the fresh refusal notice', async () => {
  await assert.rejects(run(false, callback, true, 'none', false), /notice Dismiss is visible/);
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
