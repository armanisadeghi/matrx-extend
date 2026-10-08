#!/usr/bin/env node
/** Real admin Tools-card Records table_list, with a read-only, exact-request oracle. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import {
  assertRecordsVisibleCompletion,
  observeRecordsExecution,
  signInRecordsAdmin,
} from './records-readonly-native-proof.mjs';
import { approvedShowcaseOrganization } from './settings-native-auth-driver.mjs';
import { click, evaluate, waitFor } from './settings-panel-driver.mjs';
import {
  panelBearerHash,
  runShowcaseOrganizationCheckpoint,
} from './showcase-organization-checkpoint.mjs';

const REPO = resolve(import.meta.dirname, '../..');
const extensionDir = process.env.MATRX_SHOWCASE_EXTENSION_DIR;
const receiptPath = process.env.MATRX_SHOWCASE_RECEIPT;
const output =
  process.env.MATRX_SHOWCASE_OUTPUT ??
  join(tmpdir(), `records-readonly-native-${randomUUID()}.json`);
const report = {
  schema_version: 1,
  inventory_case: 'D91 / EXT-F-4130-C02',
  status: 'unverified',
  stage: 'inputs',
  native_stage: null,
  artifact: null,
  action: 'table_list',
  organization_diagnostic: null,
  request: null,
  result: null,
  failure_code: null,
};
const stage = (value) => {
  report.stage = value;
};

async function outputState(panel) {
  return evaluate(
    panel,
    `(() => {
    const row = [...document.querySelectorAll('button')].find(el => el.querySelector('span.font-mono')?.textContent.trim() === 'records');
    const card = row?.parentElement;
    const sections = [...(card?.querySelectorAll('div') ?? [])];
    const label = sections.find(el => el.textContent.trim() === 'output' && el.children.length === 0);
    const pre = label?.parentElement?.parentElement?.querySelector('pre');
    return { raw: pre?.textContent ?? null, visible: Boolean(pre && pre.getClientRects().length) };
  })()`,
  );
}

try {
  assert.ok(extensionDir && receiptPath, 'records_exact_artifact_inputs_required');
  for (const key of [
    'MATRX_SHOWCASE_CI_SOURCE_SHA',
    'MATRX_SHOWCASE_CI_RUN_ID',
    'MATRX_SHOWCASE_CI_ARTIFACT_ID',
  ]) {
    assert.match(
      process.env[key] ?? '',
      key.endsWith('SHA') ? /^[a-f0-9]{40}$/ : /^[1-9][0-9]*$/,
      `records_${key}_required`,
    );
  }
  const approved = await approvedShowcaseOrganization(
    process.env.MATRX_APPROVED_ADMIN_ORGANIZATION_FILE,
  );
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  assert.equal(receipt.kind, 'local_dev_unpacked');
  assert.equal(hashReleaseTree(extensionDir), receipt.treeSha256, 'records_artifact_tree_mismatch');
  const manifest = JSON.parse(await readFile(join(extensionDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, receipt.version, 'records_artifact_version_mismatch');
  report.artifact = {
    source_sha: process.env.MATRX_SHOWCASE_CI_SOURCE_SHA,
    run_id: Number(process.env.MATRX_SHOWCASE_CI_RUN_ID),
    artifact_id: Number(process.env.MATRX_SHOWCASE_CI_ARTIFACT_ID),
    tree_sha256: receipt.treeSha256,
    version: receipt.version,
  };
  await runNativeSidepanelQa({
    headed: true,
    extensionDir,
    localDevReceiptPath: receiptPath,
    expectedRelease: receipt,
    artifactRoot: join(process.env.RUNNER_TEMP ?? tmpdir(), 'guest-acceptance'),
    ownedPages: {
      '/records-readonly':
        '<!doctype html><title>Records read-only control</title><main>Records read-only control</main>',
    },
    onStage: (value) => {
      report.native_stage = value;
    },
    exercisePanel: async ({ page, panel, resourceAction }) => {
      stage('admin_signin');
      const auth = await resourceAction(() =>
        signInRecordsAdmin({
          page,
          panel,
          repo: REPO,
          adminCredentialsFile: process.env.MATRX_PREPARE_ADMIN_CREDENTIALS_FILE,
          onStage: (value) => {
            report.native_stage = value;
          },
        }),
      );
      assert.equal(auth.admin_role, true, 'records_admin_role_unverified');
      stage('approved_organization');
      await runShowcaseOrganizationCheckpoint({
        panel,
        auth,
        resourceAction,
        report,
        requiredOrganizationName: approved.name,
        requiredOrganizationId: approved.id,
      });
      stage('records_card');
      // The authenticated organization checkpoint opened this exact card to
      // fetch its schema. Its open state is a prerequisite, not a tool action.
      await waitFor(
        'records_card_ready',
        () =>
          evaluate(
            panel,
            `(() => [...document.querySelectorAll('button')].some(el => el.querySelector('span.font-mono')?.textContent.trim() === 'records'))()`,
          ),
        Boolean,
      );
      await waitFor(
        'records_schema_ready',
        () =>
          evaluate(
            panel,
            `(() => { const b=[...document.querySelectorAll('button')].find(el=>el.querySelector('span.font-mono')?.textContent.trim()==='records'); return Boolean(b?.parentElement?.querySelector('textarea') && [...b.parentElement.querySelectorAll('button')].some(x=>x.textContent.trim()==='Run' && !x.disabled)); })()`,
          ),
        Boolean,
      );
      const input = {
        action: 'table_list',
        args: { organization_id: approved.id, include_app_tables: true, limit: 50 },
      };
      stage('records_input_focus');
      assert.equal(
        await evaluate(
          panel,
          `(() => { const b=[...document.querySelectorAll('button')].find(el=>el.querySelector('span.font-mono')?.textContent.trim()==='records'); const t=b?.parentElement?.querySelector('textarea'); if (!t || !t.getClientRects().length) return false; t.focus(); return document.activeElement===t; })()`,
        ),
        true,
        'records_input_not_focused',
      );
      await panel.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'a',
        code: 'KeyA',
        modifiers: process.platform === 'darwin' ? 4 : 2,
        windowsVirtualKeyCode: 65,
        commands: ['selectAll'],
      });
      await panel.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'a',
        code: 'KeyA',
        modifiers: process.platform === 'darwin' ? 4 : 2,
        windowsVirtualKeyCode: 65,
      });
      stage('records_input_selection');
      assert.equal(
        await evaluate(
          panel,
          `(() => { const b=[...document.querySelectorAll('button')].find(el=>el.querySelector('span.font-mono')?.textContent.trim()==='records'); const t=b?.parentElement?.querySelector('textarea'); return Boolean(t && document.activeElement===t && t.selectionStart===0 && t.selectionEnd===t.value.length); })()`,
        ),
        true,
        'records_input_selection_missing',
      );
      stage('records_input_insert');
      await panel.send('Input.insertText', { text: JSON.stringify(input) });
      stage('records_input_visible');
      assert.equal(
        await evaluate(
          panel,
          `(() => { const b=[...document.querySelectorAll('button')].find(el=>el.querySelector('span.font-mono')?.textContent.trim()==='records'); return b?.parentElement?.querySelector('textarea')?.value === ${JSON.stringify(JSON.stringify(input))}; })()`,
        ),
        true,
        'records_input_not_visible',
      );
      stage('records_bearer_read');
      const bearerHash = await panelBearerHash(panel);
      assert.match(bearerHash ?? '', /^[0-9a-f]{64}$/, 'records_authenticated_token_unavailable');
      const observer = observeRecordsExecution(panel, approved.id, bearerHash);
      try {
        await observer.start();
        stage('records_run');
        await resourceAction(() => click(panel, 'button-text', 'Run'));
        await waitFor(
          'records_execution_finished',
          () => observer.entries(),
          (entries) => entries.length === 1 && entries[0].finished,
          45_000,
        );
        const [request] = observer.entries();
        assert.equal(request.method, 'POST');
        assert.equal(request.organizationMatches, true, 'records_execute_org_header_mismatch');
        assert.equal(request.bearerMatches, true, 'records_execute_principal_mismatch');
        assert.deepEqual(
          request.body,
          { tool_name: 'records', arguments: input },
          'records_include_app_tables_not_preserved',
        );
        assert.equal(request.status, 200, 'records_execute_http_failed');
        stage('records_completion');
        const completion = await observer.completion(request);
        report.request = {
          path: '/tools/test/execute',
          method: 'POST',
          organization_matches: true,
          authenticated_principal_matches: true,
          completion_observed: true,
          include_app_tables: true,
          status: request.status,
          finished: true,
        };
        stage('records_visible_result');
        const visible = await waitFor(
          'records_output_visible',
          () => outputState(panel),
          (value) => {
            if (!value?.visible || !value.raw) return false;
            try {
              return JSON.stringify(JSON.parse(value.raw)) === JSON.stringify(completion);
            } catch {
              return false;
            }
          },
          30_000,
        );
        const result = assertRecordsVisibleCompletion(visible, completion);
        assert.equal(result.success, true, 'records_tool_refused');
        assert.equal(result.output?.action, 'table_list', 'records_wrong_action_result');
        assert.ok(Array.isArray(result.output?.tables), 'records_tables_missing');
        assert.ok(result.output.tables.length > 0, 'records_live_table_fixture_missing');
        assert.ok(Array.isArray(result.output?.organizations_covered), 'records_coverage_missing');
        assert.ok(
          result.output.organizations_covered.includes(approved.id),
          'records_approved_org_not_covered',
        );
        assert.ok(
          result.output.tables.every(
            (table) => table.organization_id && typeof table.name === 'string',
          ),
          'records_table_identity_missing',
        );
        assert.ok(
          result.output.tables.some((table) => table.organization_id === approved.id),
          'records_approved_org_table_missing',
        );
        report.result = {
          visible: true,
          success: true,
          action: 'table_list',
          count: result.output.tables.length,
          approved_organization_covered: true,
        };
      } finally {
        observer.stop();
      }
    },
  });
  report.status = 'passed';
} catch {
  report.failure_code = `${report.stage}_failed`;
  process.stderr.write(
    `UNVERIFIED records_readonly_native stage=${report.stage} native_stage=${report.native_stage}\n`,
  );
  process.exitCode = 1;
} finally {
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}
