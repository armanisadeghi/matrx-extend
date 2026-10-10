#!/usr/bin/env node
/** Native member Data picker, save and owned-row cleanup for EXT-F-2005-T01. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { verifyDataGuestArtifact } from './data-guest-artifact-contract.mjs';
import { clickPickerDone, clickPickerField, pickerText } from './data-guest-picker-driver.mjs';
import {
  buildDataPatternDeleteUrl,
  buildDataPatternLookupUrl,
  matchesSelectedMemberOrganization,
  parseDataPatternWriteBody,
  verifyDataPatternDeleteResult,
  verifyDataPatternLookupResult,
} from './data-member-pattern-cleanup.mjs';
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
  case_id: 'EXT-F-2005-T01',
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
    'Native member picker and pattern-save behavior on the exact imported development artifact; no admin, Store or guest claim.',
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

function observePatternWrites(panel, expectedOrganizationId) {
  const writes = new Map();
  const origin = new URL(process.env.WXT_SUPABASE_URL).origin;
  const offRequest = panel.on('Network.requestWillBeSent', ({ requestId, request }) => {
    try {
      const url = new URL(request.url);
      if (
        url.origin === origin &&
        url.pathname === '/rest/v1/wbx_pattern' &&
        request.method === 'POST'
      ) {
        const organizationId = Object.entries(request.headers ?? {}).find(
          ([name]) => name.toLowerCase() === 'x-organization-id',
        )?.[1];
        writes.set(requestId, {
          status: null,
          failed: false,
          patternId: null,
          bodyCapture: 'pending',
          organizationId,
        });
      }
    } catch {
      // Unrelated requests are ignored; raw URLs never leave this listener.
    }
  });
  const offResponse = panel.on('Network.responseReceived', ({ requestId, response }) => {
    const write = writes.get(requestId);
    if (write) write.status = response.status;
  });
  const offFailed = panel.on('Network.loadingFailed', ({ requestId }) => {
    const write = writes.get(requestId);
    if (write) write.failed = true;
  });
  const offFinished = panel.on('Network.loadingFinished', ({ requestId }) => {
    const write = writes.get(requestId);
    if (!write) return;
    void panel
      .send('Network.getResponseBody', { requestId })
      .then((body) => {
        const text = body.base64Encoded
          ? Buffer.from(body.body, 'base64').toString('utf8')
          : body.body;
        const parsed = parseDataPatternWriteBody(text);
        write.patternId = parsed.patternId;
        write.bodyCapture = parsed.capture;
      })
      .catch(() => {
        write.bodyCapture = 'body_unavailable';
      });
  });
  return {
    snapshot: () =>
      [...writes.values()].map(({ status, failed, patternId, bodyCapture, organizationId }) => ({
        status,
        failed,
        patternIdPresent: UUID.test(patternId ?? ''),
        bodyCapture,
        organizationContextPresent: UUID.test(organizationId ?? ''),
        organizationMatchesSelected: matchesSelectedMemberOrganization(
          organizationId,
          expectedOrganizationId,
        ),
      })),
    writeTarget: () => {
      const target = [...writes.values()].find(
        (write) => write.status === 201 && UUID.test(write.organizationId ?? ''),
      );
      return target ? { patternId: target.patternId, organizationId: target.organizationId } : null;
    },
    stop: () => {
      offRequest();
      offResponse();
      offFailed();
      offFinished();
    },
  };
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
    exercisePanel: async ({
      page,
      panel,
      activatePanel,
      requireResourceHealth,
      resourceAction,
    }) => {
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
      const observer = observePatternWrites(panel, identity.organizationId);
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
            state[0].organizationContextPresent,
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
        report.observations.organization_context_sent = writes[0].organizationContextPresent;
        report.observations.organization_context_matched_selected =
          writes[0].organizationMatchesSelected;
        assert.equal(
          writes[0].organizationMatchesSelected,
          true,
          'data_member_save_organization_mismatch',
        );
        const saved = await waitFor(
          'data_member_pattern_refreshed',
          () => dataState(panel, patternName),
          (state) => state?.active === true && state.savedPatternVisible === true,
        );
        assert.equal(saved.savedPatternVisible, true, 'data_member_saved_row_not_refreshed');
        report.observations.saved_pattern_refreshed = true;
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
            if (writeTarget) {
              const target =
                verifiedTarget ??
                verifyDataPatternLookupResult(
                  await lookupSavedPattern(panel, patternName, writeTarget.organizationId),
                  patternName,
                  writeTarget.organizationId,
                );
              report.cleanup = await deleteSavedPattern(panel, target);
            } else if (snapshot.some((write) => write.status === 201)) {
              cleanupError = new Error('data_member_cleanup_target_missing');
              report.cleanup = { verified: false, error: 'data_member_cleanup_target_missing' };
            } else report.cleanup = { verified: true, no_successful_write_observed: true };
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
