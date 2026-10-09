#!/usr/bin/env node
/** Owned guest Data picker and save-gate acceptance for EXT-F-2005-T01. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { verifyDataGuestArtifact } from './data-guest-artifact-contract.mjs';
import { clickPickerDone, pickerText } from './data-guest-picker-driver.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { activeTabPanelExpression, click, evaluate, waitFor } from './settings-panel-driver.mjs';

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
    'Guest native behavior on exact imported development artifact; no signed-in save or Store claim.',
};

async function dataState(panel) {
  return evaluate(
    panel,
    `(() => {
      const root = ${activeTabPanelExpression('Data')};
      if (!root) return { active: false };
      const buttons = [...root.querySelectorAll('button')].filter((button) => !button.disabled);
      const text = root.textContent ?? '';
      return {
        active: true,
        pickedTwo: text.includes('2 fields selected') &&
          text.includes('field_1:') && text.includes('field_2:'),
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
  assert.ok(ciReceiptPath, 'data_guest_ci_receipt_path_required');
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
    exercisePanel: async ({ page, panel, requireResourceHealth, resourceAction }) => {
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
      await click(panel, 'button-text', 'Pick fields on this page');
      await page.locator('#matrx-data-picker-host').waitFor({ state: 'attached' });
      await page.locator('.product-card .product-name').first().click();
      await page.locator('.product-card .product-price').nth(1).click();
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
  report.status = 'pass';
  report.stage = 'complete';
} catch (error) {
  report.status = 'fail';
  report.failure_stage = report.stage;
  process.exitCode = 1;
  const safeMessage = String(error?.message ?? error)
    .replace(/https?:\/\/\S+/g, '[url]')
    .slice(0, 300);
  process.stderr.write(`DATA_GUEST_ACCEPTANCE_FAILED ${report.stage} ${safeMessage}\n`);
} finally {
  await mkdir('test-results', { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}
