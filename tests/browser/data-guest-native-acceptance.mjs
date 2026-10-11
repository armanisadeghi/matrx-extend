#!/usr/bin/env node
/** Owned guest Data picker and save-gate acceptance for EXT-F-2005-T01. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { verifyDataGuestArtifact } from './data-guest-artifact-contract.mjs';
import { verifyEmptyPickerDismissal } from './data-guest-picker-cancel.mjs';
import {
  clickPickerCancel,
  clickPickerClear,
  clickPickerDone,
  clickPickerField,
  hoverPickerField,
  pickerText,
} from './data-guest-picker-driver.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import {
  activeTabPanelExpression,
  click,
  dataPanelDiagnostic,
  dataPickerControlReady,
  evaluate,
  waitFor,
} from './settings-panel-driver.mjs';

const extensionDir = process.env.MATRX_DATA_EXTENSION_DIR;
const receiptPath = process.env.MATRX_DATA_RECEIPT;
const output = join('test-results', 'data-guest-native-acceptance.json');
const cards = [
  ['Cedar chair', '$189'],
  ['Walnut desk', '$429'],
  ['Linen lamp', '$74'],
];
const fixture = `<!doctype html><html><head><title>Northline Furnishings catalog</title></head><body>
<main><h1>Northline Furnishings catalog</h1><section id="products">${cards
  .map(
    ([name, price]) =>
      `<article class="product-card"><h2 class="product-name">${name}</h2><p class="product-price">${price}</p></article>`,
  )
  .join('')}</section></main></body></html>`;
const report = {
  schema_version: 1,
  case_id: 'EXT-F-2005-T01',
  status: 'unverified',
  stage: 'input',
  native_stage: null,
  artifact: null,
  observations: {},
  failure_stage: null,
  limits:
    'Guest native behavior on the selected imported artifact; no signed-in save or published Store claim.',
};

async function capturePickerDiagnostic(panel, artifacts) {
  const diagnostic = await dataPanelDiagnostic(panel);
  try {
    const screenshot = await panel.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(
      join(artifacts, 'data-picker-target-failure.png'),
      Buffer.from(screenshot.data, 'base64'),
      { mode: 0o600 },
    );
    diagnostic.screenshot = 'data-picker-target-failure.png';
  } catch {
    diagnostic.screenshot = 'capture_failed';
  }
  return diagnostic;
}

async function dataState(panel) {
  return evaluate(
    panel,
    `(() => {
      const root = ${activeTabPanelExpression('Data')};
      if (!root) return { active: false };
      const allButtons = [...root.querySelectorAll('button')];
      const buttons = allButtons.filter((button) => !button.disabled);
      const pickerButtons = allButtons.filter((button) =>
        button.textContent.trim() === 'Pick fields on this page');
      const text = root.textContent ?? '';
      return {
        active: true,
        pickedTwo: text.includes('2 fields selected') &&
          text.includes('field_1:') && text.includes('field_2:'),
        selectedFieldMarkers: (text.match(/field_\\d+:/g) ?? []).length,
        selectedFieldValues: [...root.querySelectorAll('span')]
          .filter((span) => /^field_\\d+:$/.test(span.textContent.trim()))
          .map((span) => span.parentElement?.textContent?.trim() ?? ''),
        pickerButton: buttons.filter((button) => button.textContent.trim() === 'Pick fields on this page').length,
        pickerButtonPresent: pickerButtons.length,
        pickerButtonDisabled: pickerButtons.filter((button) => button.disabled).length,
        cancelSelection: buttons.filter((button) => button.textContent.trim() === 'Cancel').length,
        signInToSave: buttons.filter((button) => button.textContent.trim() === 'Sign in to save').length,
        signInPending: [...root.querySelectorAll('button')].some((button) =>
          button.textContent.trim() === 'Sign in to save' && button.disabled),
        savePattern: buttons.filter((button) => button.textContent.trim() === 'Save pattern').length,
        nameInput: root.querySelectorAll('input[placeholder="Pattern name…"]').length,
        guestExplanation: text.includes('Field selection works as a guest.'),
      };
    })()`,
  );
}

try {
  assert.ok(extensionDir && receiptPath, 'data_guest_artifact_inputs_missing');
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  const ciReceiptPath = process.env.MATRX_DATA_CI_RECEIPT;
  const releaseArtifact = process.env.MATRX_DATA_ARTIFACT_MODE === 'release';
  if (!releaseArtifact) assert.ok(ciReceiptPath, 'data_guest_ci_receipt_path_required');
  const ciReceipt = ciReceiptPath ? JSON.parse(await readFile(ciReceiptPath, 'utf8')) : undefined;
  const manifest = JSON.parse(await readFile(join(extensionDir, 'manifest.json'), 'utf8'));
  report.artifact = verifyDataGuestArtifact({
    localReceipt: receipt,
    ciReceipt,
    env: process.env,
    treeSha256: hashReleaseTree(extensionDir),
    manifestVersion: manifest.version,
  });
  await runNativeSidepanelQa({
    headed: true,
    extensionDir,
    ...(releaseArtifact
      ? { releaseReceiptPath: receiptPath }
      : { localDevReceiptPath: receiptPath }),
    expectedRelease: receipt,
    artifactRoot: join(process.env.RUNNER_TEMP ?? tmpdir(), 'guest-acceptance'),
    ownedPages: { '/products': fixture },
    onStage: (value) => {
      report.native_stage = value;
    },
    exercisePanel: async ({ page, panel, artifacts, requireResourceHealth, resourceAction }) => {
      report.stage = 'guest_and_fixture';
      await requireResourceHealth();
      const guest = await evaluate(
        panel,
        `(async () => {
          const stored = await chrome.storage.local.get(['matrx.auth.accessToken','matrx.user.profile']);
          return { token: Boolean(stored['matrx.auth.accessToken']), profile: Boolean(stored['matrx.user.profile']) };
        })()`,
      );
      assert.deepEqual(guest, { token: false, profile: false }, 'data_guest_auth_state_wrong');
      await resourceAction(() => page.goto(`${new URL(page.url()).origin}/products`));
      assert.equal(
        await page.locator('.product-card').count(),
        3,
        'data_guest_fixture_rows_missing',
      );
      await click(panel, 'title', 'Data');
      await waitFor(
        'data_guest_active',
        () => dataState(panel),
        (state) => state.active,
      );
      report.stage = 'picker';
      report.observations.picker_cancel_without_selection = false;
      report.stage = 'picker_cancel';
      try {
        await verifyEmptyPickerDismissal({
          page,
          panel,
          readState: () => dataState(panel),
          openPicker: () => click(panel, 'data-picker-button', 'Pick fields on this page'),
          waitForState: waitFor,
        });
      } catch (error) {
        report.picker_diagnostic = await capturePickerDiagnostic(panel, artifacts);
        throw error;
      }
      report.observations.picker_cancel_without_selection = true;
      report.observations.picker_cancel_selected_fields_unchanged = true;
      report.observations.picker_cancel_pattern_writes = 0;
      report.stage = 'picker_controls_t07';
      const t07Before = await dataState(panel);
      assert.equal(t07Before.selectedFieldMarkers, 0, 'data_guest_t07_initial_fields_present');
      assert.deepEqual(t07Before.selectedFieldValues, [], 'data_guest_t07_initial_values_present');
      await panel.send('Network.enable');
      const t07Writes = [];
      const stopT07Network = panel.on('Network.requestWillBeSent', ({ request }) => {
        if (request?.method !== 'GET' && /\/wbx_pattern(?:\?|$)/.test(request?.url ?? ''))
          t07Writes.push(request.method);
      });
      try {
        await click(panel, 'data-picker-button', 'Pick fields on this page');
        await page.locator('#matrx-data-picker-host').waitFor({ state: 'attached' });
        const firstHover = await hoverPickerField(page, '.product-card .product-name');
        const secondHover = await hoverPickerField(page, '.product-card .product-price', 1);
        assert.notDeepEqual(
          firstHover.target,
          secondHover.target,
          'data_guest_t07_hover_did_not_track',
        );
        await clickPickerField(page, '.product-card .product-name');
        const t07Cdp = await page.context().newCDPSession(page);
        try {
          await t07Cdp.send('DOM.enable');
          const selected = await pickerText(t07Cdp, '#picked');
          assert.match(
            selected,
            /picked-item[^>]*>[^<]*Cedar chair/,
            'data_guest_t07_pick_missing',
          );
          await clickPickerDone(page);
          const c19Selected = await waitFor(
            'data_guest_t07_c19_selector_returned',
            () => dataState(panel),
            (state) => state.selectedFieldValues.length === 1,
          );
          const visibleSelector =
            c19Selected.selectedFieldValues[0]?.match(/^field_1:\s*(.+)$/)?.[1];
          assert.ok(visibleSelector, 'data_guest_t07_c19_selector_not_visible');
          const selectorTarget = await page.evaluate((selector) => {
            const matches = [...document.querySelectorAll(selector)];
            return {
              count: matches.length,
              text: matches[0]?.textContent?.trim() ?? null,
              isCedarChair: matches[0] === document.querySelector('.product-card .product-name'),
            };
          }, visibleSelector);
          assert.deepEqual(
            selectorTarget,
            { count: 1, text: 'Cedar chair', isCedarChair: true },
            'data_guest_t07_c19_selector_did_not_identify_clicked_element',
          );
          report.observations.c19_click_to_select = {
            preview: 'Cedar chair',
            visible_field: c19Selected.selectedFieldValues[0],
            selector_unique_matches: selectorTarget.count,
            selector_matched_clicked_element: selectorTarget.isCedarChair,
          };

          // Re-entering the picker clears the Data draft. Keep Clear's selected
          // entry check independent from the C19 Done/result handoff above.
          await click(panel, 'data-picker-button', 'Pick fields on this page');
          await page.locator('#matrx-data-picker-host').waitFor({ state: 'attached' });
          await clickPickerField(page, '.product-card .product-name');
          const clearSelection = await pickerText(t07Cdp, '#picked');
          assert.match(
            clearSelection,
            /picked-item[^>]*>[^<]*Cedar chair/,
            'data_guest_t07_clear_precondition_missing',
          );
          await clickPickerClear(page);
          const cleared = await pickerText(t07Cdp, '#picked');
          assert.doesNotMatch(cleared, /picked-item/, 'data_guest_t07_clear_kept_field');
          report.observations.t07_clear = { before: 'Cedar chair', after_entries: 0 };
        } finally {
          await t07Cdp.detach();
        }
        await clickPickerCancel(page);
        await page.locator('#matrx-data-picker-host').waitFor({ state: 'detached' });
        await waitFor(
          'data_guest_t07_picker_ready_again',
          () => dataState(panel),
          (state) => state.pickerButton === 1 && state.cancelSelection === 0,
        );
        await click(panel, 'data-picker-button', 'Pick fields on this page');
        await page.locator('#matrx-data-picker-host').waitFor({ state: 'attached' });
        await clickPickerField(page, '.product-card .product-price', 1);
        const selectedCdp = await page.context().newCDPSession(page);
        try {
          await selectedCdp.send('DOM.enable');
          assert.match(
            await pickerText(selectedCdp, '#picked'),
            /picked-item[^>]*>[^<]*\$429/,
            'data_guest_t07_cancel_precondition_missing',
          );
        } finally {
          await selectedCdp.detach();
        }
        await clickPickerCancel(page);
        await page.locator('#matrx-data-picker-host').waitFor({ state: 'detached' });
        const t07After = await waitFor(
          'data_guest_t07_cancel_restored',
          () => dataState(panel),
          (state) => state.pickerButton === 1 && state.cancelSelection === 0,
        );
        assert.deepEqual(
          {
            selectedFieldMarkers: t07After.selectedFieldMarkers,
            selectedFieldValues: t07After.selectedFieldValues,
            pickerButton: t07After.pickerButton,
            cancelSelection: t07After.cancelSelection,
            savePattern: t07After.savePattern,
            nameInput: t07After.nameInput,
          },
          {
            selectedFieldMarkers: t07Before.selectedFieldMarkers,
            selectedFieldValues: t07Before.selectedFieldValues,
            pickerButton: t07Before.pickerButton,
            cancelSelection: t07Before.cancelSelection,
            savePattern: t07Before.savePattern,
            nameInput: t07Before.nameInput,
          },
          'data_guest_t07_cancel_changed_data_state',
        );
        assert.deepEqual(t07Writes, [], 'data_guest_t07_pattern_write');
        report.observations.t07 = {
          hover: [firstHover, secondHover],
          selected_then_cancel: true,
          panel_state_restored: true,
          panel_before: {
            selected_fields: t07Before.selectedFieldValues,
            picker_button: t07Before.pickerButton,
            cancel_selection: t07Before.cancelSelection,
          },
          panel_after: {
            selected_fields: t07After.selectedFieldValues,
            picker_button: t07After.pickerButton,
            cancel_selection: t07After.cancelSelection,
          },
          pattern_write_requests: 0,
        };
      } finally {
        stopT07Network();
      }
      report.stage = 'picker';
      try {
        await waitFor(
          'data_guest_picker_control_rendered',
          () => dataPanelDiagnostic(panel),
          dataPickerControlReady,
        );
      } catch (error) {
        report.picker_diagnostic = await capturePickerDiagnostic(panel, artifacts);
        throw error;
      }
      try {
        await click(panel, 'data-picker-button', 'Pick fields on this page');
      } catch (error) {
        if (error?.driverFailure?.code === 'pointer_target_not_unique') {
          report.picker_diagnostic = await capturePickerDiagnostic(panel, artifacts);
        }
        throw error;
      }
      await page.locator('#matrx-data-picker-host').waitFor({ state: 'attached' });
      try {
        report.picker_step = 'first_field';
        report.picker_field_diagnostic = await clickPickerField(
          page,
          '.product-card .product-name',
        );
        report.picker_step = 'second_field';
        report.picker_second_field_diagnostic = await clickPickerField(
          page,
          '.product-card .product-price',
          1,
        );
      } catch (error) {
        if (error?.pickerFieldDiagnostic) {
          if (report.picker_step === 'second_field')
            report.picker_second_field_diagnostic = error.pickerFieldDiagnostic;
          else report.picker_field_diagnostic = error.pickerFieldDiagnostic;
        }
        try {
          await page.screenshot({ path: join(artifacts, 'data-picker-field-failure.png') });
          report.picker_field_screenshot = 'data-picker-field-failure.png';
        } catch {
          report.picker_field_screenshot = 'capture_failed';
        }
        throw error;
      }
      const cdp = await page.context().newCDPSession(page);
      try {
        await cdp.send('DOM.enable');
        const names = await pickerText(cdp, '.picked');
        assert.match(names, /Cedar chair/, 'data_guest_first_preview_missing');
        assert.match(names, /\$429/, 'data_guest_second_preview_missing');
      } finally {
        await cdp.detach();
      }
      await clickPickerDone(page);
      await page.locator('#matrx-data-picker-host').waitFor({ state: 'detached' });
      const selected = await waitFor(
        'data_guest_fields_selected',
        () => dataState(panel),
        (state) => state.pickedTwo,
      );
      assert.equal(selected.signInToSave, 1, 'data_guest_sign_in_save_missing');
      assert.equal(selected.savePattern, 0, 'data_guest_save_exposed');
      assert.equal(selected.nameInput, 0, 'data_guest_pattern_name_exposed');
      assert.equal(selected.guestExplanation, true, 'data_guest_save_boundary_missing');
      report.observations = {
        ...report.observations,
        guest: true,
        controlled_rows: 3,
        two_distinct_picker_previews: true,
        two_selected_fields: true,
        pattern_name_absent: true,
        save_pattern_absent: true,
        sign_in_to_save_present: true,
      };
      report.stage = 'sign_in_action';
      const writes = [];
      await panel.send('Network.enable');
      const stopNetwork = panel.on('Network.requestWillBeSent', ({ request }) => {
        if (request?.method !== 'GET' && /\/wbx_pattern(?:\?|$)/.test(request?.url ?? ''))
          writes.push(request.method);
      });
      try {
        await click(panel, 'button-text', 'Sign in to save');
        await waitFor(
          'data_guest_sign_in_action',
          () => dataState(panel),
          (state) => state.signInPending === true,
        );
        assert.deepEqual(writes, [], 'data_guest_pattern_write_before_auth');
      } finally {
        stopNetwork();
      }
      report.observations.sign_in_action_used = true;
      report.observations.pattern_write_requests_before_auth = 0;
    },
  });
  assert.equal(
    report.observations.picker_cancel_without_selection,
    true,
    'data_guest_picker_cancel_not_exercised',
  );
  assert.equal(
    report.observations.t07?.selected_then_cancel,
    true,
    'data_guest_t07_selected_cancel_not_exercised',
  );
  report.status = 'pass';
  report.stage = 'complete';
} catch (error) {
  report.status = 'fail';
  report.failure_stage = report.stage;
  process.exitCode = 1;
  const safeMessage = String(error?.message ?? error)
    .replace(/https?:\/\/\S+/g, '[url]')
    .slice(0, 300);
  if (error?.driverFailure) {
    const failure = error.driverFailure;
    report.driver_failure = {
      code: failure.code ?? null,
      sample_stage: failure.sampleStage ?? null,
      matched_target_count: failure.matchedTargetCount ?? null,
      visible_match_count: failure.visibleMatchCount ?? null,
      unique_visible_target: failure.uniqueVisibleTarget ?? null,
      hit_target: failure.hitTarget ?? null,
      animating: failure.animating ?? null,
      stable_samples: failure.stableSamples ?? null,
      position_stable: failure.positionStable ?? null,
      data_panel: failure.dataPanelDiagnostic ?? null,
    };
  }
  process.stderr.write(`DATA_GUEST_ACCEPTANCE_FAILED ${report.stage} ${safeMessage}\n`);
} finally {
  await mkdir('test-results', { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}
