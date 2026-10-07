#!/usr/bin/env node
/** Native D42 picker acceptance; opt-in stale channels cross real Chrome runtime. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import {
  MEMBER_TEST_ORGANIZATION_NAME,
  approvedAdminOrganizationName,
  signInSettings,
} from './settings-native-auth-driver.mjs';
import { click, evaluate, waitFor } from './settings-panel-driver.mjs';
import {
  clickReachableShowcaseCard,
  clickReachableShowcaseTarget,
} from './showcase-card-driver.mjs';
import {
  cancelShowcaseRepick,
  listStateExpression,
  runShowcaseCompletionBoundary,
} from './showcase-completion-diagnostic.mjs';
import { runShowcaseOrganizationCheckpoint } from './showcase-organization-checkpoint.mjs';
import { safeShowcaseOrganizationFailure } from './showcase-organization-diagnostic.mjs';
import {
  createShowcaseSelectionDiagnostic,
  observeShowcaseSelection,
  safeShowcaseSelectionFailure,
  sampleShowcaseFieldSelection,
  sampleShowcaseSelection,
  stageShowcaseSelection,
} from './showcase-selection-diagnostic.mjs';
import {
  createShowcaseStaleDiagnostic,
  runShowcaseStaleDiagnosticStep,
} from './showcase-stale-diagnostic.mjs';
import {
  STALE_PICKER_KINDS,
  armShowcaseInstallBoundary,
  armShowcaseStaleBoundary,
  assertFreshShowcasePickerContext,
  observeShowcaseRelay,
  readShowcaseRelays,
  reinjectShowcasePicker,
} from './showcase-stale-runtime-boundary.mjs';

const REPO = resolve(import.meta.dirname, '../..');
const EXPECTED_DEV_EXTENSION_ID = 'cihdmkcdjjckfhjpgoedmgfpoljebaml';
const extensionDir = process.env.MATRX_SHOWCASE_EXTENSION_DIR;
const receiptPath = process.env.MATRX_SHOWCASE_RECEIPT;
const output =
  process.env.MATRX_SHOWCASE_OUTPUT ??
  join(tmpdir(), `showcase-picker-native-${randomUUID()}.json`);
const cards = [
  ['Neon Nights', 'Area15'],
  ['Desert Lanterns', 'Fremont Street'],
  ['Silver Moon', 'Arts District'],
];
const fixture = `<!doctype html><html><head><title>Las Vegas events</title></head><body>
<main><h1>Las Vegas events</h1><section id="events">${cards
  .map(
    ([title, venue]) =>
      `<article class="event-card"><h2>${title}</h2><p class="venue">${venue}</p></article>`,
  )
  .join('')}</section>
<button id="ordinary" onclick="document.body.dataset.ordinaryClicks=String(Number(document.body.dataset.ordinaryClicks||0)+1)">Open event guide</button>
<section id="archive"><article class="archive-card"><h2>Past Listing One</h2></article><article class="archive-card"><h2>Past Listing Two</h2></article></section>
</main></body></html>`;
const report = {
  schema_version: 1,
  defect_id: 'EXT-D-0042',
  status: 'unverified',
  stage: 'inputs',
  native_stage: null,
  artifact: null,
  cases: [],
  unverified_criteria: [
    'stale A ITEM_DETECTED, RESULT, and EXIT held and released after B starts',
    'delayed A cancellation injection after B starts',
    'deferred installation across replacement',
    'new content-script context reinjection and exact listener count',
    'nonadmin role gating',
  ],
  failure_code: null,
  organization_diagnostic: null,
  selection_diagnostic: null,
  stale_diagnostic: null,
  lifecycle_diagnostic: null,
  completion_diagnostic: { boundaries: [] },
};
let selectionPage = null;
const staleBoundary = process.env.MATRX_SHOWCASE_STALE_BOUNDARY === '1';
const stage = (value) => {
  report.stage = value;
};
const passed = (id, evidence) => report.cases.push({ id, status: 'pass', evidence });

async function panelState(panel) {
  return evaluate(panel, listStateExpression());
}
async function pickedOverlay(page) {
  return page.locator('#matrx-list-picker-host');
}
async function chooseScopeIfNeeded(page, count = 3) {
  const choices = page.locator('#matrx-list-picker-host [data-scope-choice]');
  if (await choices.count()) {
    const labels = await choices.allTextContents();
    const index = labels.findIndex((label) => label.includes(`${count} cards`));
    assert.ok(index >= 0, 'showcase_three_card_scope_missing');
    await choices.nth(index).click();
  }
}

async function configRoot(panel) {
  return evaluate(
    panel,
    `(() => {
    const active = document.querySelector('button[role="tab"][title="Showcase (admin only)"][data-state="active"]');
    const pane = active && document.getElementById(active.getAttribute('aria-controls'));
    const tab = [...(pane?.querySelectorAll('button[role="tab"]') ?? [])]
      .find(el => el.textContent.trim() === 'List Pattern' && el.getAttribute('data-state') === 'active');
    const content = tab && document.getElementById(tab.getAttribute('aria-controls'));
    const label = [...(content?.querySelectorAll('span') ?? [])].find(el => el.textContent.trim() === 'root:');
    return label?.nextElementSibling?.textContent?.trim() ?? null;
  })()`,
  );
}

async function runLifecyclePositive({
  page,
  panel,
  step,
  expectedSession = null,
  exactDetection = false,
}) {
  const before = await step(
    'lifecycle_B_detection',
    async () => (await readShowcaseRelays(panel)).length,
  );
  await step('lifecycle_B_start', async () => {
    assert.ok((await panelState(panel)).picking, 'showcase_lifecycle_B_not_picking');
    assert.equal(await configRoot(panel), null, 'showcase_lifecycle_A_root_staged');
    assert.equal(await page.locator('#matrx-list-picker-host').count(), 1);
  });
  await step('lifecycle_B_scope', () =>
    clickReachableShowcaseCard(page.locator('#events article.event-card').first()),
  );
  await step('lifecycle_B_scope', () => chooseScopeIfNeeded(page));
  await step('lifecycle_B_scope', () =>
    waitFor(
      'showcase_lifecycle_three_items',
      async () => (await pickedOverlay(page)).locator('.badge').allTextContents(),
      (labels) => labels.some((value) => value.includes('3 items')),
    ),
  );
  const relays = await step('lifecycle_B_detection', () =>
    waitFor(
      'showcase_lifecycle_detection_stamped',
      () => readShowcaseRelays(panel),
      (events) =>
        events
          ?.slice(before)
          .some(
            (event) =>
              event.kind === STALE_PICKER_KINDS.detected &&
              Number.isInteger(event.tab_id) &&
              typeof event.document_id === 'string' &&
              (!expectedSession || event.session_id === expectedSession),
          ),
    ),
  );
  const detected = relays.slice(before).find((event) => event.kind === STALE_PICKER_KINDS.detected);
  await step('lifecycle_B_detection', () => {
    assert.match(detected.session_id, /^[0-9a-f-]{36}$/i);
    if (expectedSession) assert.equal(detected.session_id, expectedSession);
  });
  await step('lifecycle_B_field', () =>
    clickReachableShowcaseTarget(page.locator('#events article.event-card h2').first(), 'field'),
  );
  await step('lifecycle_B_field', () =>
    waitFor(
      'showcase_lifecycle_field_picked',
      async () => (await pickedOverlay(page)).locator('.picked-item').count(),
      (count) => count === 1,
    ),
  );
  await step('lifecycle_B_done', () => page.locator('#matrx-list-picker-host button#done').click());
  await step('lifecycle_B_done', async () =>
    (await pickedOverlay(page)).waitFor({ state: 'detached' }),
  );
  await step('lifecycle_B_result', () =>
    waitFor(
      'showcase_lifecycle_result_stamped',
      () => readShowcaseRelays(panel),
      (events) =>
        events
          ?.slice(before)
          .some(
            (event) =>
              event.kind === STALE_PICKER_KINDS.result &&
              event.session_id === detected.session_id &&
              event.tab_id === detected.tab_id &&
              event.document_id === detected.document_id,
          ),
    ),
  );
  await step('lifecycle_B_extract', () => click(panel, 'button-text', 'Extract'));
  await step('lifecycle_B_extract', () =>
    waitFor(
      'showcase_lifecycle_three_rows',
      () => panelState(panel),
      (state) => state?.rowCount && state.hasFirst && state.hasSecond && state.hasThird,
    ),
  );
  const detectionCount = await step(
    'lifecycle_B_detection',
    async () =>
      (await readShowcaseRelays(panel))
        .slice(before)
        .filter((event) => event.kind === STALE_PICKER_KINDS.detected).length,
  );
  if (exactDetection)
    await step('lifecycle_B_detection', () =>
      assert.equal(detectionCount, 1, 'showcase_reinjection_duplicate_detection'),
    );
  return {
    session_id: detected.session_id,
    tab_id: detected.tab_id,
    document_id: detected.document_id,
    detection_count: detectionCount,
    rows: 3,
  };
}

async function runLifecycleCase({ kind, page, panel, boundary, resourceAction, report }) {
  const diagnostic = createShowcaseStaleDiagnostic(kind);
  report.lifecycle_diagnostic = diagnostic;
  const originalUrl = page.url();
  let installBoundary = null;
  const sample = async () => {
    const [state, overlay, relays, cancel, install] = await Promise.allSettled([
      panelState(panel),
      page.locator('#matrx-list-picker-host').count(),
      readShowcaseRelays(panel),
      boundary.cancelSnapshot(),
      installBoundary?.snapshot(),
    ]);
    return {
      ...(state.status === 'fulfilled' && {
        panel_start: state.value?.start === true,
        panel_picking: state.value?.picking === true,
        panel_extract: state.value?.extract === true,
        panel_three_rows: state.value?.rowCount === true,
      }),
      ...(overlay.status === 'fulfilled' && { overlay_count: overlay.value }),
      ...(relays.status === 'fulfilled' && { relay_count: relays.value.length }),
      ...(cancel.status === 'fulfilled' && {
        cancel_held: cancel.value.count === 1,
        cancel_count: cancel.value.count,
      }),
      ...(install.status === 'fulfilled' &&
        install.value && {
          install_held: install.value.held,
          install_count: install.value.observed.length,
        }),
    };
  };
  const step = (target, action) =>
    runShowcaseStaleDiagnosticStep(diagnostic, target, sample, () => resourceAction(action));
  await step('lifecycle_prepare', () => click(panel, 'button-text', 'Restart'));
  await step('lifecycle_prepare', () =>
    waitFor(
      'showcase_lifecycle_ready',
      () => panelState(panel),
      (state) => state?.start,
    ),
  );
  if (kind === 'install')
    installBoundary = await step('lifecycle_A_hold', () => armShowcaseInstallBoundary(panel));
  await step('lifecycle_A_start', () => click(panel, 'button-text', 'Pick an example item'));
  if (kind === 'cancel') {
    await step('lifecycle_A_start', async () =>
      (await pickedOverlay(page)).waitFor({ state: 'attached' }),
    );
    await step('lifecycle_A_hold', () => boundary.holdCancel());
  } else
    await step('lifecycle_A_hold', () =>
      waitFor(
        'showcase_A_install_held',
        () => installBoundary.snapshot(),
        (value) => value.held,
      ),
    );
  await step('lifecycle_A_cancel', () => click(panel, 'button-text', 'Cancel'));
  await step('lifecycle_A_cancel', () =>
    waitFor(
      'showcase_A_cancelled_in_panel',
      () => panelState(panel),
      (state) => state?.start,
    ),
  );
  const oldCancel =
    kind === 'cancel'
      ? await step('lifecycle_A_hold', () =>
          waitFor(
            'showcase_A_cancel_held',
            () => boundary.cancelSnapshot(),
            (value) => value.count === 1,
          ),
        )
      : null;
  await step('lifecycle_B_start', () => click(panel, 'button-text', 'Pick an example item'));
  if (kind === 'install') {
    await step('lifecycle_B_start', async () =>
      assert.equal(
        await page.locator('#matrx-list-picker-host').count(),
        0,
        'showcase_old_install_completed_early',
      ),
    );
    await step('lifecycle_A_release', async () =>
      assert.deepEqual(await installBoundary.release(), { released: true }),
    );
  }
  await step('lifecycle_B_start', async () =>
    (await pickedOverlay(page)).waitFor({ state: 'attached' }),
  );
  await step('lifecycle_B_start', () =>
    assert.equal(page.url(), originalUrl, 'showcase_lifecycle_page_changed'),
  );
  if (kind === 'cancel') {
    await step('lifecycle_A_release', async () =>
      assert.deepEqual(await boundary.releaseCancel(oldCancel.session_id), { released: true }),
    );
    await step('lifecycle_A_release', async () =>
      assert.equal(
        await page.locator('#matrx-list-picker-host').count(),
        1,
        'showcase_old_cancel_removed_B',
      ),
    );
  } else {
    await step('lifecycle_B_start', async () => {
      const installs = await installBoundary.snapshot();
      assert.equal(installs.observed.length, 2, 'showcase_replacement_install_missing');
      assert.equal(installs.starts.length, 1, 'showcase_obsolete_A_started');
      assert.deepEqual(
        installs.observed[1],
        installs.observed[0],
        'showcase_replacement_install_moved_document',
      );
      assert.equal(
        installs.starts[0].tab_id,
        installs.observed[0].tab_id,
        'showcase_replacement_start_moved_tab',
      );
      assert.equal(
        installs.starts[0].document_id,
        installs.observed[0].document_id,
        'showcase_replacement_start_moved_document',
      );
      await installBoundary.close();
    });
  }
  const current = await runLifecyclePositive({ page, panel, step });
  if (oldCancel)
    await step('lifecycle_B_detection', () =>
      assert.notEqual(current.session_id, oldCancel.session_id),
    );
  passed(`genuine_delayed_A_${kind}_B_extracted`, {
    ...(oldCancel && { A_session_id: oldCancel.session_id }),
    B_session_id: current.session_id,
    B_rows: 3,
    page_unchanged: true,
    ...(kind === 'install' && { obsolete_A_start_count: 0, install_count: 2 }),
  });
  report.lifecycle_diagnostic = null;
  return current;
}

async function runLifecycleReinjection({ page, panel, boundary, resourceAction, report }) {
  const diagnostic = createShowcaseStaleDiagnostic('reinject');
  report.lifecycle_diagnostic = diagnostic;
  let installBoundary = null;
  let startWorld = null;
  const sample = async () => {
    const [state, overlay, relays, install, listeners, context] = await Promise.allSettled([
      panelState(panel),
      page.locator('#matrx-list-picker-host').count(),
      readShowcaseRelays(panel),
      installBoundary?.snapshot(),
      boundary.listenerSnapshot(),
      boundary.comparePickerContext(),
    ]);
    return {
      ...(state.status === 'fulfilled' && {
        panel_start: state.value?.start === true,
        panel_picking: state.value?.picking === true,
        panel_three_rows: state.value?.rowCount === true,
      }),
      ...(overlay.status === 'fulfilled' && { overlay_count: overlay.value }),
      ...(relays.status === 'fulfilled' && { relay_count: relays.value.length }),
      ...(install.status === 'fulfilled' &&
        install.value && {
          install_count: install.value.observed.length,
        }),
      ...(listeners.status === 'fulfilled' &&
        listeners.value && {
          listener_click_count: listeners.value.click_count,
          listener_hover_count: listeners.value.hover_count,
        }),
      ...(context.status === 'fulfilled' &&
        context.value && {
          context_start_distinct: context.value.start_distinct,
          context_teardown_distinct: context.value.teardown_distinct,
        }),
      ...(startWorld && {
        context_start_world_matched: startWorld.same_world_as_observer,
        context_start_world_start_distinct: startWorld.start_distinct_in_start_world,
        context_start_world_teardown_distinct: startWorld.teardown_distinct_in_start_world,
      }),
    };
  };
  const step = (target, action) =>
    runShowcaseStaleDiagnosticStep(diagnostic, target, sample, () => resourceAction(action));
  await step('lifecycle_prepare', () => click(panel, 'button-text', 'Restart'));
  await step('lifecycle_prepare', () =>
    waitFor(
      'showcase_reinject_ready',
      () => panelState(panel),
      (state) => state?.start,
    ),
  );
  installBoundary = await step('lifecycle_prepare', () =>
    armShowcaseInstallBoundary(panel, { holdFirst: false }),
  );
  await step('lifecycle_prepare', () => boundary.armListenerCount());
  await step('lifecycle_B_start', () => click(panel, 'button-text', 'Pick an example item'));
  await step('lifecycle_B_start', async () =>
    (await pickedOverlay(page)).waitFor({ state: 'attached' }),
  );
  const before = await step('lifecycle_B_start', () => installBoundary.snapshot());
  await step('lifecycle_B_start', () =>
    assert.equal(before.starts.length, 1, 'showcase_reinject_initial_start_missing'),
  );
  await step('lifecycle_B_start', async () =>
    assert.deepEqual(
      await boundary.listenerSnapshot(),
      { click_count: 1, hover_count: 1 },
      'showcase_initial_listener_count_wrong',
    ),
  );
  await step('lifecycle_B_start', () => boundary.capturePickerContext());
  const session = before.starts[0];
  await step('lifecycle_B_start', () => assert.match(session.session_id, /^[0-9a-f-]{36}$/i));
  startWorld = await step('lifecycle_reinject', () =>
    reinjectShowcasePicker(panel, session.tab_id, session.document_id, session.session_id),
  );
  await step('lifecycle_reinject', async () => {
    assert.equal(startWorld.same_world_as_observer, true, 'showcase_reinject_changed_world');
    assert.equal(
      startWorld.start_distinct_in_start_world,
      true,
      'showcase_reinject_start_not_replaced',
    );
    assert.equal(
      startWorld.teardown_distinct_in_start_world,
      true,
      'showcase_reinject_teardown_not_replaced',
    );
    const after = await installBoundary.snapshot();
    assert.equal(after.observed.length, 2, 'showcase_reinject_second_context_missing');
    assert.equal(after.starts.length, 2, 'showcase_reinject_second_start_missing');
    assert.equal(
      after.starts[1].session_id,
      session.session_id,
      'showcase_reinject_changed_session',
    );
    assert.equal(
      await page.locator('#matrx-list-picker-host').count(),
      1,
      'showcase_reinject_multiple_overlays',
    );
    assertFreshShowcasePickerContext(await boundary.comparePickerContext());
    assert.deepEqual(
      await boundary.listenerSnapshot(),
      { click_count: 1, hover_count: 1 },
      'showcase_reinject_duplicate_listeners',
    );
  });
  const current = await runLifecyclePositive({
    page,
    panel,
    step,
    expectedSession: session.session_id,
    exactDetection: true,
  });
  await step('lifecycle_B_extract', async () =>
    assert.deepEqual(
      await boundary.listenerSnapshot(),
      { click_count: 0, hover_count: 0 },
      'showcase_reinject_listeners_remain_after_done',
    ),
  );
  const clickBefore = await step('lifecycle_page_click', async () =>
    Number((await page.locator('body').getAttribute('data-ordinary-clicks')) ?? 0),
  );
  await step('lifecycle_page_click', () => page.locator('#ordinary').click());
  const clickAfter = await step('lifecycle_page_click', async () =>
    Number((await page.locator('body').getAttribute('data-ordinary-clicks')) ?? 0),
  );
  await step('lifecycle_page_click', () =>
    assert.equal(clickAfter, clickBefore + 1, 'showcase_reinject_page_click_intercepted'),
  );
  await step('lifecycle_page_click', () => installBoundary.close());
  await step('lifecycle_page_click', () => boundary.closeListenerCount());
  passed('genuine_reinjection_single_detection_and_page_click', {
    session_id: session.session_id,
    installation_count: 2,
    detection_count: current.detection_count,
    B_rows: 3,
    ordinary_click_delta: 1,
    active_click_listeners_during_pick: 1,
    active_hover_listeners_during_pick: 1,
    active_listeners_after_done: 0,
  });
  report.lifecycle_diagnostic = null;
}

async function runMissingChannelCycle({ kind, page, panel, boundary, resourceAction, diagnostic }) {
  const label = kind === STALE_PICKER_KINDS.detected ? 'detected' : 'result';
  let oldSessionId = null;
  let currentSessionId = null;
  const sample = async () => {
    const [panelRead, rootRead, overlayRead, pickedRead, producerRead, relayRead] =
      await Promise.allSettled([
        panelState(panel),
        configRoot(panel),
        page.locator('#matrx-list-picker-host').count(),
        page.locator('#matrx-list-picker-host .picked-item').count(),
        boundary.snapshot(),
        readShowcaseRelays(panel),
      ]);
    const panelValue = panelRead.status === 'fulfilled' ? panelRead.value : null;
    const producer = producerRead.status === 'fulfilled' ? producerRead.value : null;
    const relays = relayRead.status === 'fulfilled' ? relayRead.value : null;
    return {
      ...(panelValue && {
        panel_start: panelValue.start === true,
        panel_picking: panelValue.picking === true,
        panel_cancel: panelValue.cancel === true,
        panel_extract: panelValue.extract === true,
        panel_selected_field: panelValue.selectedField === true,
        panel_three_rows: panelValue.rowCount === true,
      }),
      ...(rootRead.status === 'fulfilled' && { root_present: rootRead.value !== null }),
      ...(overlayRead.status === 'fulfilled' && { overlay_count: overlayRead.value }),
      ...(pickedRead.status === 'fulfilled' && { picked_field_count: pickedRead.value }),
      ...(producer && {
        held_count: producer.held.length,
        producer_count: producer.observed.length,
        A_held: producer.held.some(
          (event) => event.kind === kind && event.session_id === oldSessionId,
        ),
        B_detected: producer.observed.some(
          (event) =>
            event.kind === STALE_PICKER_KINDS.detected && event.session_id === currentSessionId,
        ),
      }),
      ...(Array.isArray(relays) && {
        relay_count: relays.length,
        A_stamped: relays.some(
          (event) =>
            event.kind === kind &&
            event.session_id === oldSessionId &&
            Number.isInteger(event.tab_id) &&
            typeof event.document_id === 'string',
        ),
        B_stamped: relays.some(
          (event) =>
            event.kind === STALE_PICKER_KINDS.detected &&
            event.session_id === currentSessionId &&
            Number.isInteger(event.tab_id),
        ),
        B_result_stamped: relays.some(
          (event) =>
            event.kind === STALE_PICKER_KINDS.result &&
            event.session_id === currentSessionId &&
            Number.isInteger(event.tab_id),
        ),
      }),
    };
  };
  const step = (target, action) =>
    runShowcaseStaleDiagnosticStep(diagnostic, target, sample, action);
  await step('restart_before_A', () =>
    resourceAction(() => click(panel, 'button-text', 'Restart')),
  );
  await step('restart_before_A', () =>
    waitFor(
      `showcase_${label}_ready`,
      () => panelState(panel),
      (state) => state?.start,
    ),
  );
  assert.equal(await configRoot(panel), null, `showcase_${label}_prior_config_remains`);
  await step('A_start', () => boundary.holdNext(kind));
  stage(`start_A_${label}`);
  await step('A_start', () =>
    resourceAction(() => click(panel, 'button-text', 'Pick an example item')),
  );
  await step('A_start', async () => (await pickedOverlay(page)).waitFor({ state: 'attached' }));
  await step('A_start', () =>
    waitFor(
      `showcase_A_${label}_picking`,
      () => panelState(panel),
      (state) => state?.picking,
    ),
  );
  await step('A_scope', () =>
    resourceAction(() =>
      clickReachableShowcaseCard(page.locator('#archive article.archive-card').first()),
    ),
  );
  await step('A_scope', () => chooseScopeIfNeeded(page, 2));
  await step('A_scope', () =>
    waitFor(
      `showcase_A_${label}_scope`,
      async () => (await pickedOverlay(page)).locator('.badge').allTextContents(),
      (labels) => labels.some((value) => value.includes('2 items')),
    ),
  );
  if (kind === STALE_PICKER_KINDS.result) {
    await step('A_field', () =>
      resourceAction(() =>
        clickReachableShowcaseTarget(
          page.locator('#archive article.archive-card h2').first(),
          'field',
        ),
      ),
    );
    await step('A_field', () =>
      waitFor(
        'showcase_A_result_field',
        async () => (await pickedOverlay(page)).locator('.picked-item').count(),
        (count) => count === 1,
      ),
    );
    await step('A_field', () =>
      resourceAction(() => page.locator('#matrx-list-picker-host button#done').click()),
    );
  }
  const captured = await step('A_capture', () =>
    waitFor(
      `showcase_A_${label}_captured`,
      () => boundary.snapshot(),
      (value) => value?.held?.length === 1 && value.held[0]?.kind === kind,
    ),
  );
  oldSessionId = captured.held[0].session_id;
  assert.match(oldSessionId, /^[0-9a-f-]{36}$/i, `showcase_A_${label}_session_missing`);
  const oldPattern = captured.held[0];
  assert.ok(
    oldPattern.list_root && oldPattern.item_selector,
    `showcase_A_${label}_pattern_missing`,
  );
  const oldItems = await page.evaluate(
    ({ root, item }) =>
      [...document.querySelector(root).querySelectorAll(item)].map((element) =>
        element.textContent.trim(),
      ),
    { root: oldPattern.list_root, item: oldPattern.item_selector },
  );
  assert.equal(oldItems.length, 2, `showcase_A_${label}_wrong_fixture_count`);
  assert.ok(
    oldItems.every((text) => text.startsWith('Past Listing')),
    `showcase_A_${label}_wrong_fixture`,
  );
  if (kind === STALE_PICKER_KINDS.result)
    await step('A_capture', () =>
      waitFor(
        `showcase_A_${label}_scope_staged`,
        () => configRoot(panel),
        (root) => root !== null,
      ),
    );
  stage(`cancel_A_${label}`);
  await step('A_cancel', () =>
    resourceAction(() =>
      click(panel, 'button-text', kind === STALE_PICKER_KINDS.detected ? 'Cancel' : 'Restart'),
    ),
  );
  await step('A_cancel', () =>
    waitFor(
      `showcase_A_${label}_cleared`,
      () => panelState(panel),
      (state) => state?.start,
    ),
  );
  await step('A_cancel', async () => (await pickedOverlay(page)).waitFor({ state: 'detached' }));
  assert.equal(await configRoot(panel), null, `showcase_A_${label}_config_not_cleared`);
  const observedBeforeB = (await boundary.snapshot()).observed.length;
  stage(`start_B_${label}`);
  await step('B_start', () =>
    resourceAction(() => click(panel, 'button-text', 'Pick an example item')),
  );
  await step('B_start', async () => (await pickedOverlay(page)).waitFor({ state: 'attached' }));
  await step('B_start', () =>
    waitFor(
      `showcase_B_${label}_picking`,
      () => panelState(panel),
      (state) => state?.picking,
    ),
  );
  assert.equal((await boundary.snapshot()).url, page.url(), `showcase_${label}_page_changed`);
  stage(`release_A_${label}`);
  assert.deepEqual(
    await step('A_release', () => resourceAction(() => boundary.release(kind, oldSessionId))),
    { released: true, ack: true },
    `showcase_A_${label}_not_delivered`,
  );
  const relays = await step('A_stamped', () =>
    waitFor(
      `showcase_A_${label}_stamped`,
      () => readShowcaseRelays(panel),
      (events) =>
        events?.some(
          (event) =>
            event.kind === kind &&
            event.session_id === oldSessionId &&
            Number.isInteger(event.tab_id) &&
            typeof event.document_id === 'string',
        ),
    ),
  );
  const oldRelay = relays.find(
    (event) =>
      event.kind === kind &&
      event.session_id === oldSessionId &&
      Number.isInteger(event.tab_id) &&
      typeof event.document_id === 'string',
  );
  assert.ok((await panelState(panel)).picking, `showcase_A_${label}_closed_B`);
  assert.equal(await configRoot(panel), null, `showcase_A_${label}_staged_B_config`);
  assert.equal(
    await page.locator('#matrx-list-picker-host').count(),
    1,
    `showcase_A_${label}_removed_B`,
  );
  stage(`select_B_${label}`);
  await step('B_scope', () =>
    resourceAction(() =>
      clickReachableShowcaseCard(page.locator('#events article.event-card').first()),
    ),
  );
  await step('B_scope', () => chooseScopeIfNeeded(page));
  await step('B_scope', () =>
    waitFor(
      `showcase_B_${label}_scope`,
      async () => (await pickedOverlay(page)).locator('.badge').allTextContents(),
      (labels) => labels.some((value) => value.includes('3 items')),
    ),
  );
  const currentRoot = await step('B_scope', () =>
    waitFor(
      `showcase_B_${label}_root`,
      () => configRoot(panel),
      (root) => root !== null,
    ),
  );
  assert.notEqual(currentRoot, oldPattern.list_root, `showcase_B_${label}_retained_A_root`);
  const produced = await step('B_detection', () =>
    waitFor(
      `showcase_B_${label}_detected`,
      () => boundary.snapshot(),
      (value) =>
        value?.observed
          ?.slice(observedBeforeB)
          .some(
            (event) =>
              event.kind === STALE_PICKER_KINDS.detected && event.session_id !== oldSessionId,
          ),
    ),
  );
  const current = produced.observed.findLast(
    (event, index) =>
      index >= observedBeforeB &&
      event.kind === STALE_PICKER_KINDS.detected &&
      event.session_id !== oldSessionId,
  );
  currentSessionId = current?.session_id ?? null;
  assert.match(current.session_id, /^[0-9a-f-]{36}$/i, `showcase_B_${label}_session_missing`);
  const currentRelays = await step('B_stamped', () =>
    waitFor(
      `showcase_B_${label}_stamped`,
      () => readShowcaseRelays(panel),
      (events) =>
        events?.some(
          (event) =>
            event.kind === STALE_PICKER_KINDS.detected &&
            event.session_id === current.session_id &&
            event.tab_id === oldRelay.tab_id &&
            event.document_id === oldRelay.document_id,
        ),
    ),
  );
  assert.ok(currentRelays, `showcase_B_${label}_relay_missing`);
  await step('B_field', () =>
    resourceAction(() =>
      clickReachableShowcaseTarget(page.locator('#events article.event-card h2').first(), 'field'),
    ),
  );
  await step('B_field', () =>
    waitFor(
      `showcase_B_${label}_field`,
      async () => (await pickedOverlay(page)).locator('.picked-item').count(),
      (count) => count === 1,
    ),
  );
  await step('B_done', () =>
    resourceAction(() => page.locator('#matrx-list-picker-host button#done').click()),
  );
  await step('B_done', async () => (await pickedOverlay(page)).waitFor({ state: 'detached' }));
  await step('B_builder', () =>
    waitFor(
      `showcase_B_${label}_builder`,
      () => panelState(panel),
      (state) => state?.selectedField && state.extract,
    ),
  );
  const currentResult = await step('B_result', () =>
    waitFor(
      `showcase_B_${label}_result_stamped`,
      () => readShowcaseRelays(panel),
      (events) =>
        events?.some(
          (event) =>
            event.kind === STALE_PICKER_KINDS.result &&
            event.session_id === current.session_id &&
            event.tab_id === oldRelay.tab_id &&
            event.document_id === oldRelay.document_id,
        ),
    ),
  );
  assert.ok(currentResult, `showcase_B_${label}_result_missing`);
  await step('B_extract', () => resourceAction(() => click(panel, 'button-text', 'Extract')));
  await step('B_extract', () =>
    waitFor(
      `showcase_B_${label}_rows`,
      () => panelState(panel),
      (state) => state?.rowCount && state.hasFirst && state.hasSecond && state.hasThird,
    ),
  );
  passed(`genuine_A_${label}_rejected_B_extracted`, {
    A_session_id: oldSessionId,
    B_session_id: current.session_id,
    same_tab_and_document: true,
    stale_relay_stamped: true,
    B_rows: 3,
  });
}

try {
  if (
    ['lifecycle_cancel_wait', 'lifecycle_install_wait', 'lifecycle_reinject_wait'].includes(
      process.env.MATRX_SHOWCASE_DIAGNOSTIC_PROBE,
    )
  ) {
    const channel = process.env.MATRX_SHOWCASE_DIAGNOSTIC_PROBE.split('_')[1];
    stage(`lifecycle_${channel}`);
    report.lifecycle_diagnostic = createShowcaseStaleDiagnostic(channel);
    await runShowcaseStaleDiagnosticStep(
      report.lifecycle_diagnostic,
      channel === 'reinject' ? 'lifecycle_reinject' : 'lifecycle_A_release',
      async () => ({
        panel_picking: true,
        overlay_count: 1,
        listener_click_count: 1,
        raw_page_text: 'private@example.invalid',
      }),
      () =>
        waitFor(
          `showcase_${channel}_held`,
          () => 'token=secret',
          () => false,
          1,
        ),
    );
  }
  if (
    ['stale_detected_wait', 'stale_result_wait'].includes(
      process.env.MATRX_SHOWCASE_DIAGNOSTIC_PROBE,
    )
  ) {
    const channel =
      process.env.MATRX_SHOWCASE_DIAGNOSTIC_PROBE === 'stale_detected_wait' ? 'detected' : 'result';
    stage(`release_A_${channel}`);
    report.stale_diagnostic = createShowcaseStaleDiagnostic(channel);
    await runShowcaseStaleDiagnosticStep(
      report.stale_diagnostic,
      'A_stamped',
      async () => ({ overlay_count: 1, held_count: 0, panel_picking: true, A_stamped: false }),
      () =>
        waitFor(
          `showcase_A_${channel}_stamped`,
          () => 'private@example.invalid?token=secret',
          () => false,
          1,
        ),
    );
  }
  if (
    ['card_click', 'scope_choice', 'field_click', 'field_wait'].includes(
      process.env.MATRX_SHOWCASE_DIAGNOSTIC_PROBE,
    )
  ) {
    const substage = process.env.MATRX_SHOWCASE_DIAGNOSTIC_PROBE;
    stage(substage.startsWith('field_') ? `select_B_${substage}` : 'select_B_card');
    report.selection_diagnostic = createShowcaseSelectionDiagnostic();
    stageShowcaseSelection(report.selection_diagnostic, substage);
    observeShowcaseSelection(report.selection_diagnostic, { card_count: 3, overlay_count: 1 });
    throw new Error('private@example.invalid');
  }
  // A lightweight CDP-boundary probe exercises the real organization helper and receipt writer.
  if (
    ['picker', 'picker_unknown', 'storage', 'unknown'].includes(
      process.env.MATRX_SHOWCASE_DIAGNOSTIC_PROBE,
    )
  ) {
    stage('organization');
    const probe = process.env.MATRX_SHOWCASE_DIAGNOSTIC_PROBE;
    if (probe === 'unknown')
      throw new Error('private@example.invalid https://private.invalid/token');
    const { organizationProbePanel, probeAuth, withFastProbeClock } = await import(
      './showcase-organization-probe.mjs'
    );
    await withFastProbeClock(() =>
      runShowcaseOrganizationCheckpoint({
        panel: organizationProbePanel(probe),
        auth: probeAuth,
        resourceAction: (action) => action(),
        report,
        requiredOrganizationName: MEMBER_TEST_ORGANIZATION_NAME,
      }),
    );
  }
  stage('inputs');
  assert.ok(extensionDir && receiptPath, 'showcase_exact_artifact_inputs_required');
  assert.match(
    process.env.MATRX_SHOWCASE_CI_SOURCE_SHA ?? '',
    /^[a-f0-9]{40}$/,
    'showcase_ci_source_required',
  );
  assert.match(
    process.env.MATRX_SHOWCASE_CI_RUN_ID ?? '',
    /^[1-9][0-9]*$/,
    'showcase_ci_run_required',
  );
  assert.match(
    process.env.MATRX_SHOWCASE_CI_ARTIFACT_ID ?? '',
    /^[1-9][0-9]*$/,
    'showcase_ci_artifact_required',
  );
  const requiredOrganizationName = await approvedAdminOrganizationName(
    process.env.MATRX_APPROVED_ADMIN_ORGANIZATION_FILE,
  );
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  assert.equal(receipt.kind, 'local_dev_unpacked', 'showcase_ci_development_receipt_required');
  assert.equal(hashReleaseTree(extensionDir), receipt.treeSha256, 'showcase_tree_mismatch');
  const manifest = JSON.parse(await readFile(join(extensionDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, receipt.version, 'showcase_version_mismatch');
  report.artifact = {
    source_sha: process.env.MATRX_SHOWCASE_CI_SOURCE_SHA,
    run_id: Number(process.env.MATRX_SHOWCASE_CI_RUN_ID),
    artifact_id: Number(process.env.MATRX_SHOWCASE_CI_ARTIFACT_ID),
    tree_sha256: receipt.treeSha256,
    version: receipt.version,
  };
  const native = await runNativeSidepanelQa({
    headed: true,
    extensionDir,
    localDevReceiptPath: receiptPath,
    expectedRelease: receipt,
    artifactRoot: join(process.env.RUNNER_TEMP ?? tmpdir(), 'guest-acceptance'),
    ownedPages: { '/events': fixture },
    onStage: (value) => {
      report.native_stage = value;
    },
    exercisePanel: async ({ page, panel, reopenPanel, requireResourceHealth, resourceAction }) => {
      selectionPage = page;
      await requireResourceHealth();
      stage('guest_gate');
      const guest = await evaluate(
        panel,
        `(() => ({
        scrape: [...document.querySelectorAll('button[role="tab"]')].some(el => el.title === 'Scrape'),
        showcase: [...document.querySelectorAll('button[role="tab"]')].some(el => el.title === 'Showcase (admin only)')
      }))()`,
      );
      assert.deepEqual(guest, { scrape: true, showcase: false }, 'showcase_guest_gate_failed');
      passed('guest_nonchat_control_and_showcase_gate', {
        scrape_visible: true,
        showcase_absent: true,
      });
      stage('admin_signin');
      const auth = await resourceAction(() =>
        signInSettings({
          mode: 'admin',
          page,
          panel,
          repo: REPO,
          adminCredentialsFile: process.env.MATRX_PREPARE_ADMIN_CREDENTIALS_FILE,
          onStage: (value) => {
            report.auth_stage = value;
          },
        }),
      );
      assert.equal(auth.admin_role, true, 'showcase_admin_role_unverified');
      stage('organization');
      await runShowcaseOrganizationCheckpoint({
        panel,
        auth,
        resourceAction,
        report,
        requiredOrganizationName,
      });
      passed('real_admin_signin_and_device_organization', { rendered: true });
      await resourceAction(() => reopenPanel());
      await waitFor(
        'showcase_panel_visible',
        () => evaluate(panel, 'document.visibilityState'),
        (value) => value === 'visible',
      );
      stage('fixture_navigation');
      await resourceAction(() => page.goto(`${new URL(page.url()).origin}/events`));
      await page.locator('#events article.event-card').first().waitFor({ state: 'visible' });
      assert.equal(await page.locator('#events article.event-card').count(), 3);
      stage('showcase_navigation');
      await resourceAction(() => click(panel, 'title', 'Showcase (admin only)'));
      await resourceAction(() => click(panel, 'button-text', 'List Pattern'));
      await waitFor(
        'showcase_list_ready',
        () => panelState(panel),
        (value) => value?.ready && value.start,
      );
      stage('start_A');
      await resourceAction(() => click(panel, 'button-text', 'Pick an example item'));
      await (await pickedOverlay(page)).waitFor({ state: 'attached' });
      await waitFor(
        'showcase_A_picking',
        () => panelState(panel),
        (value) => value?.picking && value.cancel,
      );
      const boundary = staleBoundary
        ? await resourceAction(() => armShowcaseStaleBoundary(page, EXPECTED_DEV_EXTENSION_ID))
        : null;
      if (boundary) {
        await resourceAction(() => observeShowcaseRelay(panel));
        await boundary.holdNext(STALE_PICKER_KINDS.exit);
      }
      stage('cancel_A');
      if (boundary) {
        await resourceAction(() => page.locator('#matrx-list-picker-host button#cancel').click());
        await waitFor(
          'showcase_A_exit_captured',
          () => boundary.snapshot(),
          (value) => value?.held?.length === 1 && value.held[0]?.kind === 'data:list-picker-exit',
        );
      }
      await resourceAction(() => click(panel, 'button-text', 'Cancel'));
      await waitFor(
        'showcase_A_cleared',
        () => panelState(panel),
        (value) => value?.start && !value.picking,
      );
      await (await pickedOverlay(page)).waitFor({ state: 'detached' });
      stage('start_B');
      await resourceAction(() => click(panel, 'button-text', 'Pick an example item'));
      await (await pickedOverlay(page)).waitFor({ state: 'attached' });
      assert.equal(await page.locator('#matrx-list-picker-host').count(), 1);
      await waitFor(
        'showcase_B_picking',
        () => panelState(panel),
        (value) => value?.picking && value.cancel,
      );
      let oldSessionId = null;
      if (boundary) {
        const held = await boundary.snapshot();
        assert.equal(held.url, page.url(), 'showcase_page_changed_across_sessions');
        assert.equal(held.held.length, 1, 'showcase_old_exit_capture_not_unique');
        oldSessionId = held.held[0].session_id;
        assert.match(oldSessionId, /^[0-9a-f-]{36}$/i, 'showcase_old_session_identity_missing');
        stage('release_old_A_exit');
        const release = await resourceAction(() =>
          boundary.release(STALE_PICKER_KINDS.exit, oldSessionId),
        );
        assert.deepEqual(release, { released: true, ack: true }, 'showcase_old_exit_not_delivered');
        const stamped = await waitFor(
          'showcase_A_stamped_relay',
          () => readShowcaseRelays(panel),
          (events) =>
            events?.some(
              (event) =>
                event.kind === 'data:list-picker-exit' &&
                event.session_id === oldSessionId &&
                Number.isInteger(event.tab_id) &&
                typeof event.document_id === 'string',
            ),
        );
        const oldRelay = stamped.find(
          (event) =>
            event.kind === 'data:list-picker-exit' &&
            event.session_id === oldSessionId &&
            Number.isInteger(event.tab_id) &&
            typeof event.document_id === 'string',
        );
        assert.ok(oldRelay, 'showcase_old_exit_relay_missing');
        const afterOld = await panelState(panel);
        assert.ok(afterOld.picking && afterOld.cancel, 'showcase_old_exit_closed_B');
        assert.equal(
          await page.locator('#matrx-list-picker-host').count(),
          1,
          'showcase_old_exit_removed_B_overlay',
        );
        passed('genuine_A_exit_relay_rejected_while_B_active', {
          old_session_id: oldSessionId,
          relay_tab_id: oldRelay.tab_id,
          relay_document_id: oldRelay.document_id,
          B_picking: true,
        });
      }
      passed('same_page_cancel_A_start_B', {
        page_unchanged: page.url().endsWith('/events'),
        one_overlay: true,
      });
      stage('select_B_card');
      report.selection_diagnostic = createShowcaseSelectionDiagnostic();
      await sampleShowcaseSelection(page, report.selection_diagnostic, 'before_click');
      await resourceAction(() =>
        clickReachableShowcaseCard(page.locator('#events article.event-card').first()),
      );
      stageShowcaseSelection(report.selection_diagnostic, 'scope_choice');
      await sampleShowcaseSelection(page, report.selection_diagnostic);
      await chooseScopeIfNeeded(page);
      stageShowcaseSelection(report.selection_diagnostic, 'scope_badge');
      await sampleShowcaseSelection(page, report.selection_diagnostic);
      await waitFor(
        'showcase_B_scope',
        async () => (await pickedOverlay(page)).locator('.badge').allTextContents(),
        (labels) => labels.some((label) => label.includes('3 items')),
      );
      if (boundary) {
        stageShowcaseSelection(report.selection_diagnostic, 'detection_relay');
        const producer = await waitFor(
          'showcase_B_detection_produced',
          () => boundary.snapshot(),
          (value) =>
            value?.observed?.some(
              (event) =>
                event.kind === 'data:list-picker-item-detected' &&
                event.session_id !== oldSessionId,
            ),
        );
        const current = producer.observed.find(
          (event) =>
            event.kind === 'data:list-picker-item-detected' && event.session_id !== oldSessionId,
        );
        assert.match(current.session_id, /^[0-9a-f-]{36}$/i, 'showcase_B_session_identity_missing');
        const relays = await waitFor(
          'showcase_B_stamped_relay',
          () => readShowcaseRelays(panel),
          (events) =>
            events?.some(
              (event) =>
                event.kind === 'data:list-picker-item-detected' &&
                event.session_id === current.session_id &&
                Number.isInteger(event.tab_id) &&
                typeof event.document_id === 'string',
            ),
        );
        const oldRelay = relays.find(
          (event) =>
            event.kind === 'data:list-picker-exit' &&
            event.session_id === oldSessionId &&
            Number.isInteger(event.tab_id),
        );
        const currentRelay = relays.find(
          (event) =>
            event.kind === 'data:list-picker-item-detected' &&
            event.session_id === current.session_id &&
            Number.isInteger(event.tab_id),
        );
        assert.equal(currentRelay.tab_id, oldRelay.tab_id, 'showcase_cross_tab_relay');
        assert.equal(
          currentRelay.document_id,
          oldRelay.document_id,
          'showcase_cross_document_relay',
        );
        passed('current_B_detection_relayed', {
          B_session_id: current.session_id,
          different_from_A: true,
          same_tab_and_document_as_A: true,
        });
      }
      stage('select_B_field_click');
      stageShowcaseSelection(report.selection_diagnostic, 'field_click');
      await sampleShowcaseFieldSelection(page, report.selection_diagnostic, 'field_before_click');
      await resourceAction(() =>
        clickReachableShowcaseTarget(
          page.locator('#events article.event-card h2').first(),
          'field',
        ),
      );
      await sampleShowcaseFieldSelection(page, report.selection_diagnostic, 'field_after_click');
      stage('select_B_field_wait');
      stageShowcaseSelection(report.selection_diagnostic, 'field_wait');
      await waitFor(
        'showcase_B_field',
        async () => (await pickedOverlay(page)).locator('.picked-item').count(),
        (count) => count === 1,
      );
      const completion = (name, action) => {
        stage(name);
        return runShowcaseCompletionBoundary({
          diagnostic: report.completion_diagnostic,
          name,
          action,
          page,
          readPanel: () => panelState(panel),
          readRelays: () => readShowcaseRelays(panel),
        });
      };
      await completion('done_B_click', () =>
        resourceAction(() => page.locator('#matrx-list-picker-host button#done').click()),
      );
      await completion('done_B_detach', async () =>
        (await pickedOverlay(page)).waitFor({ state: 'detached' }),
      );
      await completion('done_B_builder', () =>
        waitFor(
          'showcase_B_field_in_builder',
          () => panelState(panel),
          (value) => value?.selectedField && value.extract,
        ),
      );
      await completion('extract_B_click', () =>
        resourceAction(() => click(panel, 'button-text', 'Extract')),
      );
      await completion('extract_B_rows', () =>
        waitFor(
          'showcase_B_rows',
          () => panelState(panel),
          (value) => value?.rowCount && value.hasFirst && value.hasSecond && value.hasThird,
        ),
      );
      passed('B_card_field_done_extract', {
        fixture_rows: 3,
        titles_observed: true,
      });
      await completion('repick_click', () =>
        resourceAction(() => click(panel, 'button-text', 'Pick more fields')),
      );
      await completion('repick_attach', async () =>
        (await pickedOverlay(page)).waitFor({ state: 'attached' }),
      );
      await completion('cancel_click', () => resourceAction(() => cancelShowcaseRepick(page)));
      await completion('cancel_detach', async () =>
        (await pickedOverlay(page)).waitFor({ state: 'detached' }),
      );
      await completion('normal_page_click', () =>
        resourceAction(() => page.locator('#ordinary').click()),
      );
      stage('normal_page_click_count');
      assert.equal(
        await page.locator('body').getAttribute('data-ordinary-clicks'),
        '1',
        'showcase_page_click_intercepted_after_done',
      );
      passed('ordinary_page_click_after_cancel', { click_count: 1 });
      if (boundary) {
        report.stale_diagnostic = createShowcaseStaleDiagnostic('detected');
        await runMissingChannelCycle({
          kind: STALE_PICKER_KINDS.detected,
          page,
          panel,
          boundary,
          resourceAction,
          diagnostic: report.stale_diagnostic,
        });
        report.stale_diagnostic = createShowcaseStaleDiagnostic('result');
        await runMissingChannelCycle({
          kind: STALE_PICKER_KINDS.result,
          page,
          panel,
          boundary,
          resourceAction,
          diagnostic: report.stale_diagnostic,
        });
        report.stale_diagnostic = null;
        await runLifecycleCase({ kind: 'cancel', page, panel, boundary, resourceAction, report });
        await runLifecycleCase({ kind: 'install', page, panel, boundary, resourceAction, report });
        await runLifecycleReinjection({ page, panel, boundary, resourceAction, report });
      }
      await boundary?.close();
      await requireResourceHealth();
    },
  });
  assert.equal(native.verified, true, 'showcase_native_browser_unverified');
  report.loaded_extension = {
    expected_id_observed: native.extensionId === EXPECTED_DEV_EXTENSION_ID,
    side_panel_context: true,
  };
  assert.equal(
    report.loaded_extension.expected_id_observed,
    true,
    'showcase_loaded_identity_mismatch',
  );
  stage('complete');
  if (staleBoundary)
    report.unverified_criteria = report.unverified_criteria.filter(
      (criterion) =>
        !criterion.includes('stale A ITEM_DETECTED, RESULT, and EXIT') &&
        !criterion.includes('delayed A cancellation') &&
        !criterion.includes('deferred installation') &&
        !criterion.includes('new content-script context reinjection'),
    );
  report.status = 'passed_bounded';
  process.stdout.write('PASS showcase_picker_native_bounded\n');
} catch (error) {
  if (report.stage === 'select_B_card' && selectionPage && report.selection_diagnostic)
    await sampleShowcaseSelection(selectionPage, report.selection_diagnostic, 'after_failure');
  if (
    ['select_B_field_click', 'select_B_field_wait'].includes(report.stage) &&
    selectionPage &&
    report.selection_diagnostic
  )
    await sampleShowcaseFieldSelection(
      selectionPage,
      report.selection_diagnostic,
      'field_after_failure',
    );
  report.status = 'unverified';
  report.failure_code =
    report.stage === 'organization'
      ? safeShowcaseOrganizationFailure(error)
      : ['select_B_card', 'select_B_field_click', 'select_B_field_wait'].includes(report.stage) &&
          report.selection_diagnostic
        ? safeShowcaseSelectionFailure(report.selection_diagnostic, error)
        : `${report.stage}_failed`;
  process.stderr.write(
    `UNVERIFIED showcase_picker_native stage=${report.stage} native_stage=${report.native_stage}\n`,
  );
  process.exitCode = 1;
} finally {
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}
