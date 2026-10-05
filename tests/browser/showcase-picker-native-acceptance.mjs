#!/usr/bin/env node
/** Native D42 ordinary-controls acceptance. Delayed Chrome delivery remains unverified. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { signInSettings } from './settings-native-auth-driver.mjs';
import { click, evaluate, waitFor } from './settings-panel-driver.mjs';
import { runShowcaseOrganizationCheckpoint } from './showcase-organization-checkpoint.mjs';
import { safeShowcaseOrganizationFailure } from './showcase-organization-diagnostic.mjs';

const REPO = resolve(import.meta.dirname, '../..');
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
};
const stage = (value) => {
  report.stage = value;
};
const passed = (id, evidence) => report.cases.push({ id, status: 'pass', evidence });

function listStateExpression() {
  return `(() => {
    const outer = [...document.querySelectorAll('button[role="tab"][title="Showcase (admin only)"][data-state="active"]')];
    const pane = outer.length === 1 ? document.getElementById(outer[0].getAttribute('aria-controls')) : null;
    const tab = [...(pane?.querySelectorAll('button[role="tab"]') ?? [])]
      .find(el => el.textContent.trim() === 'List Pattern' && el.getAttribute('data-state') === 'active');
    const content = tab ? document.getElementById(tab.getAttribute('aria-controls')) : null;
    const text = content?.innerText ?? '';
    return { ready: Boolean(content && content.getAttribute('data-state') === 'active'),
      start: [...(content?.querySelectorAll('button') ?? [])].some(el => el.textContent.trim() === 'Pick an example item' && !el.disabled),
      picking: text.includes('Picking on page…'),
      cancel: [...(content?.querySelectorAll('button') ?? [])].some(el => el.textContent.trim() === 'Cancel'),
      extract: [...(content?.querySelectorAll('button') ?? [])].some(el => el.textContent.trim() === 'Extract' && !el.disabled),
      selectedField: /1 selected field/.test(text),
      rowCount: /3 rows/.test(text),
      hasFirst: text.includes('Neon Nights'), hasSecond: text.includes('Desert Lanterns'),
      hasThird: text.includes('Silver Moon') };
  })()`;
}

async function panelState(panel) {
  return evaluate(panel, listStateExpression());
}
async function pickedOverlay(page) {
  return page.locator('#matrx-list-picker-host');
}
async function chooseScopeIfNeeded(page) {
  const choices = page.locator('#matrx-list-picker-host [data-scope-choice]');
  if (await choices.count()) {
    const labels = await choices.allTextContents();
    const index = labels.findIndex((label) => label.includes('3 cards'));
    assert.ok(index >= 0, 'showcase_three_card_scope_missing');
    await choices.nth(index).click();
  }
}

try {
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
      await runShowcaseOrganizationCheckpoint({ panel, auth, resourceAction, report });
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
      stage('cancel_A');
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
      passed('same_page_cancel_A_start_B', {
        page_unchanged: page.url().endsWith('/events'),
        one_overlay: true,
      });
      stage('select_B_card');
      await resourceAction(() => page.locator('#events article.event-card').first().click());
      await chooseScopeIfNeeded(page);
      await waitFor(
        'showcase_B_scope',
        async () => (await pickedOverlay(page)).locator('.badge').allTextContents(),
        (labels) => labels.some((label) => label.includes('3 items')),
      );
      stage('select_B_field');
      await resourceAction(() => page.locator('#events article.event-card h2').first().click());
      await waitFor(
        'showcase_B_field',
        async () => (await pickedOverlay(page)).locator('.picked-item').count(),
        (count) => count === 1,
      );
      stage('done_B');
      await resourceAction(() => page.locator('#matrx-list-picker-host button#done').click());
      await (await pickedOverlay(page)).waitFor({ state: 'detached' });
      await waitFor(
        'showcase_B_field_in_builder',
        () => panelState(panel),
        (value) => value?.selectedField && value.extract,
      );
      stage('extract_B');
      await resourceAction(() => click(panel, 'button-text', 'Extract'));
      await waitFor(
        'showcase_B_rows',
        () => panelState(panel),
        (value) => value?.rowCount && value.hasFirst && value.hasSecond && value.hasThird,
      );
      passed('B_card_field_done_extract', {
        fixture_rows: 3,
        titles_observed: true,
      });
      stage('cancel_after_extract');
      await resourceAction(() => click(panel, 'button-text', 'Pick more fields'));
      await (await pickedOverlay(page)).waitFor({ state: 'attached' });
      await resourceAction(() => click(panel, 'button-text', 'Cancel'));
      await (await pickedOverlay(page)).waitFor({ state: 'detached' });
      stage('normal_page_click');
      await resourceAction(() => page.locator('#ordinary').click());
      assert.equal(
        await page.locator('body').getAttribute('data-ordinary-clicks'),
        '1',
        'showcase_page_click_intercepted_after_done',
      );
      passed('ordinary_page_click_after_cancel', { click_count: 1 });
      await requireResourceHealth();
    },
  });
  assert.equal(native.verified, true, 'showcase_native_browser_unverified');
  report.loaded_extension = {
    expected_id_observed: native.extensionId === 'cihdmkcdjjckfhjpgoedmgfpoljebaml',
    side_panel_context: true,
  };
  assert.equal(
    report.loaded_extension.expected_id_observed,
    true,
    'showcase_loaded_identity_mismatch',
  );
  stage('complete');
  report.status = 'passed_bounded';
  process.stdout.write('PASS showcase_picker_native_bounded\n');
} catch (error) {
  report.status = 'unverified';
  report.failure_code =
    report.stage === 'organization'
      ? safeShowcaseOrganizationFailure(error)
      : `${report.stage}_failed`;
  process.stderr.write(
    `UNVERIFIED showcase_picker_native stage=${report.stage} native_stage=${report.native_stage}\n`,
  );
  process.exitCode = 1;
} finally {
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}
