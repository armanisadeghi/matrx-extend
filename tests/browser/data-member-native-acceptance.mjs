#!/usr/bin/env node
/** Native member Data lifecycle and owned-row cleanup for EXT-F-2005-T03. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { withClipboardReadPermission } from './clipboard-observation.mjs';
import { verifyDataGuestArtifact } from './data-guest-artifact-contract.mjs';
import { clickPickerDone, clickPickerField, pickerText } from './data-guest-picker-driver.mjs';
import {
  buildDataPatternDeleteUrl,
  buildDataPatternLookupUrl,
  cleanupOwnedDataPattern,
  verifyDataPatternDeleteResult,
  verifyDataPatternLookupResult,
} from './data-member-pattern-cleanup.mjs';
import { observePatternWrites } from './data-member-save-observer.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { signInSettings } from './settings-native-auth-driver.mjs';
import {
  activeTabPanelExpression,
  click,
  dataPanelDiagnostic,
  dataPickerControlReady,
  evaluate,
  waitFor,
} from './settings-panel-driver.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const extensionDir = process.env.MATRX_DATA_EXTENSION_DIR;
const receiptPath = process.env.MATRX_DATA_RECEIPT;
const output = join('test-results', 'data-member-native-acceptance.json');
const runId = process.env.GITHUB_RUN_ID;
const runAttempt = process.env.GITHUB_RUN_ATTEMPT;
const patternName = `Northline Furnishings catalog member ${runId}-${runAttempt}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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
  case_id: 'EXT-F-2005-T03',
  auth_mode: 'member',
  status: 'unverified',
  stage: 'input',
  native_stage: null,
  artifact: null,
  authentication: null,
  observations: {},
  cleanup: null,
  failure_stage: null,
  limits:
    'Native member picker, save, run, clipboard, cancel and extension-reload behavior on the exact imported development artifact; no admin or Store claim.',
};

async function dataState(panel, name) {
  return evaluate(
    panel,
    `(() => {
      const root = ${activeTabPanelExpression('Data')};
      if (!root) return { active: false };
      const text = root.textContent ?? '';
      return {
        active: true,
        pickedTwo: text.includes('2 fields selected') && text.includes('field_1:') && text.includes('field_2:'),
        savePatternCount: [...root.querySelectorAll('button')].filter((button) => button.textContent.trim() === 'Save pattern').length,
        nameInputCount: root.querySelectorAll('input[placeholder="Pattern name…"]').length,
        nameMatches: root.querySelector('input[placeholder="Pattern name…"]')?.value === ${JSON.stringify(name)},
        savedPatternVisible: text.includes(${JSON.stringify(name)}),
      };
    })()`,
  );
}

async function extractionState(panel) {
  return evaluate(
    panel,
    `(() => {
      const root = ${activeTabPanelExpression('Data')};
      if (!root) return { active: false, sectionVisible: false, parseable: false, rows: null };
      const label = [...root.querySelectorAll('div')]
        .find((node) => node.firstElementChild?.textContent?.trim().startsWith('Extracted rows ('));
      const pre = label ? root.querySelector('pre') : null;
      let rows = null;
      try { if (pre) rows = JSON.parse(pre.textContent ?? ''); } catch { /* safe diagnostic below */ }
      const alerts = [...root.querySelectorAll('div')]
        .filter((node) => node.className.includes('text-destructive'));
      const info = [...root.querySelectorAll('div')]
        .filter((node) => node.className.includes('text-muted-foreground'));
      return {
        active: true,
        sectionVisible: Boolean(label),
        parseable: Array.isArray(rows),
        rows,
        errorVisible: alerts.length > 0,
        outcomeVisible: info.length > 0,
        running: [...root.querySelectorAll('button')].some((button) => button.title === 'Run pattern' && button.disabled),
      };
    })()`,
  );
}

async function copyRows(panel, browserSession, panelTarget, label) {
  await click(panel, 'title', 'Copy rows');
  await waitFor(
    'data_member_copy_rows_menu_open',
    () =>
      evaluate(
        panel,
        `(() => [...document.querySelectorAll('[data-radix-popper-content-wrapper]')]
          .some((node) => node.textContent?.includes('TSV (paste to spreadsheet)')
            && node.textContent?.includes('JSON') && node.textContent?.includes('For AI agent')))()`,
      ),
    (open) => open === true,
  );
  await click(panel, 'button-text', label);
  await waitFor(
    'data_member_copy_feedback',
    () => evaluate(panel, `!!document.querySelector('svg[aria-label="Copied"]')`),
    (copied) => copied === true,
  );
  await panel.send('Page.bringToFront');
  const permissionEvidence = {};
  const text = await withClipboardReadPermission({
    browserSession,
    panel,
    panelUrl: panelTarget.url,
    evidence: permissionEvidence,
    read: () => evaluate(panel, 'navigator.clipboard.readText()'),
  });
  assert.equal(
    permissionEvidence.clipboardObservationPermissionRestored,
    true,
    'data_member_clipboard_permission_not_restored',
  );
  assert.equal(typeof text, 'string', 'data_member_clipboard_readback_missing');
  return text;
}

async function lookupSavedPattern(panel, name, organizationId) {
  const supabaseUrl = new URL(process.env.WXT_SUPABASE_URL);
  const publishableKey = process.env.WXT_SUPABASE_PUBLISHABLE_KEY;
  assert.equal(
    supabaseUrl.origin,
    'https://db.matrxserver.com',
    'data_member_lookup_origin_refused',
  );
  assert.match(
    publishableKey ?? '',
    /^sb_publishable_[A-Za-z0-9_-]+$/,
    'data_member_lookup_key_refused',
  );
  return evaluate(
    panel,
    `(async () => {
      const stored = await chrome.storage.local.get(['matrx.auth.accessToken']);
      const token = stored['matrx.auth.accessToken'];
      if (typeof token !== 'string' || !token) return { status: 0, rows: null };
      const response = await fetch(${JSON.stringify(buildDataPatternLookupUrl(supabaseUrl.origin, name, organizationId))}, {
        headers: {
          apikey: ${JSON.stringify(publishableKey)},
          Authorization: 'Bearer ' + token,
          'X-Organization-Id': ${JSON.stringify(organizationId)},
          'Accept-Profile': 'extend',
        },
      });
      const rows = await response.json().catch(() => null);
      return { status: response.status, rows: Array.isArray(rows) ? rows : null };
    })()`,
  );
}

function safeFailureCode(error) {
  const message = String(error?.message ?? 'native_acceptance_error');
  const candidate = message.split(':', 1)[0];
  return /^[a-z][a-z0-9_-]{1,100}$/.test(candidate) ? candidate : 'native_acceptance_error';
}

async function deleteSavedPattern(panel, target) {
  const supabaseUrl = new URL(process.env.WXT_SUPABASE_URL);
  const publishableKey = process.env.WXT_SUPABASE_PUBLISHABLE_KEY;
  assert.equal(
    supabaseUrl.origin,
    'https://db.matrxserver.com',
    'data_member_cleanup_origin_refused',
  );
  assert.match(
    publishableKey ?? '',
    /^sb_publishable_[A-Za-z0-9_-]+$/,
    'data_member_cleanup_key_refused',
  );
  const result = await evaluate(
    panel,
    `(async () => {
      const stored = await chrome.storage.local.get(['matrx.auth.accessToken']);
      const token = stored['matrx.auth.accessToken'];
      if (typeof token !== 'string' || !token) return { status: 0, rowCount: null, rowIdMatches: false, organizationMatches: false };
      const response = await fetch(${JSON.stringify(buildDataPatternDeleteUrl(supabaseUrl.origin, target.patternId, target.organizationId))}, {
        method: 'DELETE',
        headers: {
          apikey: ${JSON.stringify(publishableKey)},
          Authorization: 'Bearer ' + token,
          'X-Organization-Id': ${JSON.stringify(target.organizationId)},
          'Accept-Profile': 'extend',
          'Content-Profile': 'extend',
          Prefer: 'return=representation',
        },
      });
      const rows = await response.json().catch(() => null);
      const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
      return {
        status: response.status,
        rowCount: Array.isArray(rows) ? rows.length : null,
        rowIdMatches: row?.id === ${JSON.stringify(target.patternId)},
        organizationMatches: row?.organization_id === ${JSON.stringify(target.organizationId)},
      };
    })()`,
  );
  return verifyDataPatternDeleteResult(result);
}

try {
  assert.ok(extensionDir && receiptPath, 'data_member_artifact_inputs_missing');
  assert.match(runId ?? '', /^[1-9][0-9]*$/, 'data_member_run_id_missing');
  assert.match(runAttempt ?? '', /^[1-9][0-9]*$/, 'data_member_run_attempt_missing');
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  const ciReceiptPath = process.env.MATRX_DATA_CI_RECEIPT;
  assert.ok(ciReceiptPath, 'data_member_ci_receipt_path_required');
  const ciReceipt = JSON.parse(await readFile(ciReceiptPath, 'utf8'));
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
    localDevReceiptPath: receiptPath,
    expectedRelease: receipt,
    artifactRoot: join(process.env.RUNNER_TEMP ?? tmpdir(), 'guest-acceptance'),
    ownedPages: { '/products': fixture },
    onStage: (value) => {
      report.native_stage = value;
    },
    exercisePanel: async (native) => {
      const { page, activatePanel, requireResourceHealth, resourceAction } = native;
      let { panel } = native;
      report.stage = 'member_auth';
      await requireResourceHealth();
      const identity = await signInSettings({
        mode: 'member',
        page,
        panel,
        repo: REPO,
        memberLinkFile: process.env.MATRX_REVIEWER_MAGIC_LINK_FILE,
        allowLadderOrganization: true,
        onStage: (value) => {
          report.auth_stage = value;
        },
      });
      report.authentication = {
        mode: 'member',
        web_signed_in: identity.web_signed_in === true,
        extension_signed_in: identity.extension_signed_in === true,
        non_admin_identity_verified: identity.admin_role === false,
        canonical_nonadmin_check_passed: identity.canonical_nonadmin_check?.returned_rows === 0,
        organization_selected: identity.organization_selected === true,
      };
      assert.deepEqual(
        report.authentication,
        {
          mode: 'member',
          web_signed_in: true,
          extension_signed_in: true,
          non_admin_identity_verified: true,
          canonical_nonadmin_check_passed: true,
          organization_selected: true,
        },
        'data_member_auth_identity_unverified',
      );
      assert.ok(
        ['load_ladder', 'device_choice'].includes(identity.organization_resolution),
        'data_member_organization_resolution_unverified',
      );
      report.authentication.organization_resolution = identity.organization_resolution;
      assert.match(
        identity.organizationId ?? '',
        UUID,
        'data_member_expected_organization_unverified',
      );
      report.authentication.selected_organization_id_verified = true;
      await activatePanel();
      await resourceAction(() => page.goto(`${new URL(page.url()).origin}/products`));
      assert.equal(
        await page.locator('.product-card').count(),
        3,
        'data_member_fixture_rows_missing',
      );

      report.stage = 'picker';
      await click(panel, 'title', 'Data');
      await waitFor(
        'data_member_picker_control_rendered',
        () => dataPanelDiagnostic(panel),
        dataPickerControlReady,
      );
      await click(panel, 'data-picker-button', 'Pick fields on this page');
      await page.locator('#matrx-data-picker-host').waitFor({ state: 'attached' });
      const first = await clickPickerField(page, '.product-card .product-name', 0);
      const second = await clickPickerField(page, '.product-card .product-price', 1);
      const cdp = await page.context().newCDPSession(page);
      try {
        await cdp.send('DOM.enable');
        const firstPreview = await pickerText(cdp, '.picked');
        assert.match(firstPreview, /Cedar chair/, 'data_member_first_preview_missing');
        assert.match(firstPreview, /\$429/, 'data_member_second_preview_missing');
      } finally {
        await cdp.detach();
      }
      await clickPickerDone(page);
      await page.locator('#matrx-data-picker-host').waitFor({ state: 'detached' });
      const selected = await waitFor(
        'data_member_fields_selected',
        () => dataState(panel, patternName),
        (state) =>
          state?.pickedTwo === true && state.savePatternCount === 1 && state.nameInputCount === 1,
      );
      assert.equal(selected.pickedTwo, true, 'data_member_two_fields_unselected');
      report.observations.picker_field_clicks_landed =
        first.chosen_hit === 'field' && second.chosen_hit === 'field';
      report.observations.two_distinct_previews = true;
      report.observations.save_pattern_visible = true;
      report.observations.pattern_name_visible = true;

      report.stage = 'save_pattern';
      await click(panel, 'data-pattern-name', 'Pattern name…');
      await panel.send('Input.insertText', { text: patternName });
      const named = await waitFor(
        'data_member_pattern_name_entered',
        () => dataState(panel, patternName),
        (state) => state?.nameMatches === true,
      );
      assert.equal(named.nameMatches, true, 'data_member_pattern_name_not_set');
      await panel.send('Network.enable');
      const observer = observePatternWrites(
        panel,
        new URL(process.env.WXT_SUPABASE_URL).origin,
        identity.organizationId,
        patternName,
      );
      let primaryError;
      let cleanupError;
      let saveAttempted = false;
      let verifiedTarget = null;
      try {
        saveAttempted = true;
        await click(panel, 'data-save-button', 'Save pattern');
        const writes = await waitFor(
          'data_member_pattern_write_succeeded',
          async () => observer.snapshot(),
          (state) =>
            state.length === 1 &&
            state[0].status === 201 &&
            !state[0].failed &&
            state[0].requestOrganizationPresent &&
            state[0].requestNameMatches,
        );
        const writeTarget = observer.writeTarget();
        assert.ok(writeTarget, 'data_member_write_target_unverified');
        const lookedUp = await waitFor(
          'data_member_pattern_row_observed',
          () => lookupSavedPattern(panel, patternName, writeTarget.organizationId),
          (result) => result?.status === 200 && result.rows?.length === 1,
          10_000,
          (result) => ({
            status: result?.status ?? null,
            row_count: Array.isArray(result?.rows) ? result.rows.length : null,
          }),
        );
        verifiedTarget = verifyDataPatternLookupResult(
          lookedUp,
          patternName,
          writeTarget.organizationId,
        );
        if (UUID.test(writeTarget.patternId ?? ''))
          assert.equal(
            writeTarget.patternId,
            verifiedTarget.patternId,
            'data_member_write_body_row_mismatch',
          );
        report.observations.pattern_write_requests = writes.length;
        report.observations.pattern_write_status = writes[0].status;
        report.observations.pattern_response_body_capture = writes[0].bodyCapture;
        report.observations.saved_row_lookup_verified = true;
        report.observations.request_body_organization_present =
          writes[0].requestOrganizationPresent;
        report.observations.request_body_organization_matched_selected =
          writes[0].requestOrganizationMatchesSelected;
        assert.equal(
          writes[0].requestOrganizationMatchesSelected,
          true,
          'data_member_save_request_organization_mismatch',
        );
        const saved = await waitFor(
          'data_member_pattern_refreshed',
          () => dataState(panel, patternName),
          (state) => state?.active === true && state.savedPatternVisible === true,
        );
        assert.equal(saved.savedPatternVisible, true, 'data_member_saved_row_not_refreshed');
        report.observations.saved_pattern_refreshed = true;

        // A manual-css pattern without a list root queries each field once
        // against the document, so the real product contract is one first-match row.
        const expectedRows = [{ field_1: 'Cedar chair', field_2: '$189' }];
        const runAndCopy = async (phase) => {
          await click(panel, 'title', 'Run pattern');
          const state = await waitFor(
            `data_member_saved_pattern_rows_${phase}`,
            () => extractionState(panel),
            (value) => value?.parseable === true && value.rows?.length === expectedRows.length,
            10000,
            (value) => ({
              active_data_panel: value?.active === true,
              extracted_rows_section_visible: value?.sectionVisible === true,
              extracted_rows_json_parseable: value?.parseable === true,
              extracted_row_count: Array.isArray(value?.rows) ? value.rows.length : null,
              error_visible: value?.errorVisible === true,
              outcome_visible: value?.outcomeVisible === true,
              run_button_disabled: value?.running === true,
            }),
          );
          const rows = state.rows;
          assert.deepEqual(rows, expectedRows, `data_member_saved_pattern_rows_mismatch_${phase}`);
          report.observations[`saved_pattern_run_${phase}`] = true;

          const tsv = await copyRows(
            panel,
            native.browserSession,
            native.panelTarget,
            'TSV (paste to spreadsheet)',
          );
          assert.equal(
            tsv,
            'field_1\tfield_2\nCedar chair\t$189',
            `data_member_tsv_copy_mismatch_${phase}`,
          );
          const json = await copyRows(panel, native.browserSession, native.panelTarget, 'JSON');
          assert.deepEqual(
            JSON.parse(json),
            expectedRows,
            `data_member_json_copy_mismatch_${phase}`,
          );
          const ai = await copyRows(
            panel,
            native.browserSession,
            native.panelTarget,
            'For AI agent',
          );
          assert.match(ai, /structured data extracted from a webpage using a saved pattern/);
          assert.match(ai, /Row count: 1/);
          assert.match(ai, /Cedar chair/);
          report.observations[`clipboard_${phase}`] = {
            tsv_matches_fixture: true,
            json_matches_fixture: true,
            ai_contains_all_fixture_rows: true,
            native_copy_feedback_observed: true,
            clipboard_readback: true,
            observation_permission_restored: true,
          };
        };

        await runAndCopy('before_reload');

        report.stage = 'cancel_unsaved_selection';
        await click(panel, 'data-picker-button', 'Pick fields on this page');
        await page.locator('#matrx-data-picker-host').waitFor({ state: 'attached' });
        await clickPickerField(page, '.product-card .product-name', 0);
        await clickPickerField(page, '.product-card .product-price', 1);
        await clickPickerDone(page);
        await page.locator('#matrx-data-picker-host').waitFor({ state: 'detached' });
        const selectedForCancel = await waitFor(
          'data_member_cancel_selection_ready',
          () => dataState(panel, patternName),
          (state) => state?.pickedTwo === true,
        );
        assert.equal(selectedForCancel.pickedTwo, true, 'data_member_cancel_selection_missing');
        await click(panel, 'button-text', 'Cancel');
        const cancelled = await waitFor(
          'data_member_cancel_cleared_selection',
          () => dataState(panel, patternName),
          (state) =>
            state?.pickedTwo === false &&
            state.savePatternCount === 0 &&
            state.nameInputCount === 0,
        );
        assert.equal(cancelled.pickedTwo, false, 'data_member_cancel_kept_unsaved_fields');
        report.observations.cancel_cleared_unsaved_selection = true;

        report.stage = 'extension_reload';
        const reload = await native.reloadExtension();
        assert.equal(
          reload?.management_reload_clicked,
          true,
          'data_member_extension_reload_missing',
        );
        assert.equal(reload?.old_targets_retired, true, 'data_member_old_panel_not_retired');
        assert.equal(reload?.worker_replaced, true, 'data_member_worker_not_replaced');
        assert.equal(reload?.panel_replaced, true, 'data_member_panel_not_replaced');
        await panel.detach();
        panel = await native.acquireLivePanel();
        await panel.send('Page.bringToFront');
        await click(panel, 'title', 'Data');
        await waitFor(
          'data_member_reloaded_data_tab_ready',
          () => dataState(panel, patternName),
          (state) => state?.active === true,
        );
        const reloaded = await waitFor(
          'data_member_saved_pattern_survived_reload',
          () => dataState(panel, patternName),
          (state) => state?.active === true && state.savedPatternVisible === true,
        );
        assert.equal(
          reloaded.savedPatternVisible,
          true,
          'data_member_saved_pattern_lost_on_reload',
        );
        report.observations.saved_pattern_survived_extension_reload = true;
        await runAndCopy('after_reload');
      } catch (error) {
        primaryError = error;
      } finally {
        const snapshot = observer.snapshot();
        const writeTarget = observer.writeTarget();
        report.observations.pattern_write_observation = snapshot;
        observer.stop();
        await panel.send('Network.disable').catch(() => {});
        if (saveAttempted) {
          try {
            const queryOwnedPattern = async (lookupName, lookupOrganizationId) => {
              let firstFailure;
              try {
                const result = await lookupSavedPattern(panel, lookupName, lookupOrganizationId);
                if (result?.status === 200 && Array.isArray(result.rows)) return result;
                firstFailure = new Error('data_member_cleanup_lookup_unavailable');
              } catch (error) {
                firstFailure = error;
              }
              try {
                panel = await native.acquireLivePanel();
                return await lookupSavedPattern(panel, lookupName, lookupOrganizationId);
              } catch {
                throw firstFailure;
              }
            };
            report.cleanup = await cleanupOwnedDataPattern({
              lookup: queryOwnedPattern,
              remove: (target) => deleteSavedPattern(panel, target),
              name: patternName,
              organizationId: identity.organizationId,
              successfulWriteObserved:
                snapshot.some((write) => write.status === 201) || verifiedTarget !== null,
              ...(writeTarget &&
                UUID.test(writeTarget.patternId ?? '') && {
                  expectedPatternId: writeTarget.patternId,
                }),
            });
          } catch (error) {
            cleanupError = error;
            report.cleanup = { verified: false, error: safeFailureCode(error) };
          }
        }
      }
      if (primaryError) throw primaryError;
      if (cleanupError) throw new Error('data_member_cleanup_failed');
      assert.equal(report.cleanup?.verified, true, 'data_member_cleanup_unverified');
      report.observations.member_save_succeeded = true;
    },
  });
  report.status = 'pass';
  report.stage = 'complete';
} catch (error) {
  report.status = 'fail';
  report.failure_stage = report.stage;
  report.error_code = safeFailureCode(error);
  process.exitCode = 1;
  process.stderr.write(`DATA_MEMBER_ACCEPTANCE_FAILED ${report.stage} ${report.error_code}\n`);
} finally {
  await mkdir('test-results', { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}
