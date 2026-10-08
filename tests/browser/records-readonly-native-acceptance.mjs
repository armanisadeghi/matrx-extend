#!/usr/bin/env node
/** Real admin Tools-card Records reads, with independent table and search oracles. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import {
  assertRecordsVisibleCompletion,
  enterRecordsInput,
  observeRecordsExecution,
  signInRecordsAdmin,
} from './records-readonly-native-proof.mjs';
import {
  accountIdentity,
  approvedShowcaseOrganization,
  panelIdentity,
} from './settings-native-auth-driver.mjs';
import {
  click,
  evaluate,
  openSection,
  toolsCatalogState,
  waitFor,
} from './settings-panel-driver.mjs';
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
  metadata_search: null,
  invalid_input: null,
  reload: null,
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
      const tableListContract = await evaluate(
        panel,
        `(() => {
          const row = [...document.querySelectorAll('button')].find(el => el.querySelector('span.font-mono')?.textContent.trim() === 'records');
          const card = row?.parentElement;
          const label = [...(card?.querySelectorAll('div') ?? [])].find(el => el.textContent.trim() === 'server action contract' && el.children.length === 0);
          const pre = label?.parentElement?.parentElement?.querySelector('pre');
          if (!pre?.getClientRects().length) return null;
          try {
            const schema = JSON.parse(pre.textContent);
            const properties = schema.$variants?.table_list;
            return properties ? {
              canonical: properties.include_platform_tables?.type === 'boolean',
              legacy: Object.hasOwn(properties, 'include_app_tables'),
              action: schema.action?.enum?.includes('table_list') === true,
              limit: properties.limit?.type,
            } : null;
          } catch { return null; }
        })()`,
      );
      assert.deepEqual(
        tableListContract,
        { canonical: true, legacy: false, action: true, limit: 'integer' },
        'records_table_list_server_contract_drift',
      );
      const input = {
        action: 'table_list',
        args: { organization_id: approved.id, include_platform_tables: true, limit: 50 },
      };
      await enterRecordsInput(panel, evaluate, stage, input, process.platform);
      stage('records_bearer_read');
      const bearerHash = await panelBearerHash(panel);
      assert.match(bearerHash ?? '', /^[0-9a-f]{64}$/, 'records_authenticated_token_unavailable');
      const execute = async (argumentsInput, expectedBearerHash, label) => {
        const observer = observeRecordsExecution(panel, approved.id, expectedBearerHash);
        try {
          await observer.start();
          stage(`${label}_run`);
          await resourceAction(() => click(panel, 'button-text', 'Run'));
          const [request] = await waitFor(
            `${label}_execution_finished`,
            () => observer.entries(),
            (entries) => entries.length === 1 && entries[0].finished,
            45_000,
          );
          assert.equal(request.method, 'POST');
          assert.equal(request.organizationMatches, true, `${label}_org_header_mismatch`);
          assert.equal(request.bearerMatches, true, `${label}_principal_mismatch`);
          assert.deepEqual(
            request.body,
            { tool_name: 'records', arguments: argumentsInput },
            `${label}_input_mismatch`,
          );
          assert.equal(request.status, 200, `${label}_http_failed`);
          stage(`${label}_completion`);
          const completion = await observer.completion(request);
          const visible = await waitFor(
            `${label}_output_visible`,
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
          return assertRecordsVisibleCompletion(visible, completion);
        } finally {
          observer.stop();
        }
      };
      const assertPositive = (result, label) => {
        assert.equal(result.success, true, `${label}_tool_refused`);
        assert.equal(result.output?.action, 'table_list', `${label}_wrong_action`);
        assert.ok(
          Array.isArray(result.output?.tables) && result.output.tables.length > 0,
          `${label}_tables_missing`,
        );
        assert.ok(Array.isArray(result.output?.organizations_covered), `${label}_coverage_missing`);
        assert.ok(
          result.output.organizations_covered.includes(approved.id),
          `${label}_org_not_covered`,
        );
        assert.ok(
          result.output.tables.every(
            (table) => table.organization_id && typeof table.name === 'string',
          ),
          `${label}_table_identity_missing`,
        );
        assert.ok(
          result.output.tables.some((table) => table.organization_id === approved.id),
          `${label}_org_table_missing`,
        );
      };
      const result = await execute(input, bearerHash, 'records');
      assertPositive(result, 'records');
      report.request = {
        path: '/tools/test/execute',
        method: 'POST',
        organization_matches: true,
        authenticated_principal_matches: true,
        completion_observed: true,
        include_platform_tables: true,
        status: 200,
        finished: true,
      };
      report.result = {
        visible: true,
        success: true,
        action: 'table_list',
        count: result.output.tables.length,
        approved_organization_covered: true,
      };

      const invalidInput = {
        action: 'table_list',
        args: {
          organization_id: approved.id,
          include_platform_tables: true,
          limit: 'not-a-number',
        },
      };
      await enterRecordsInput(panel, evaluate, stage, invalidInput, process.platform);
      const invalidResult = await execute(invalidInput, bearerHash, 'records_invalid_limit');
      assert.equal(invalidResult.success, false, 'records_invalid_limit_false_success');
      assert.equal(
        invalidResult.error?.error_type,
        'invalid_arguments',
        'records_invalid_limit_wrong_error',
      );
      assert.match(
        invalidResult.error?.message ?? '',
        /limit/i,
        'records_invalid_limit_field_missing',
      );
      report.invalid_input = {
        finished: true,
        status: 200,
        completion_observed: true,
        visible: true,
        success: false,
        error_type: 'invalid_arguments',
        limit_named: true,
      };

      stage('records_panel_reload');
      await panel.send('Page.reload', { ignoreCache: true });
      await waitFor(
        'records_settings_after_reload',
        () =>
          evaluate(
            panel,
            `Boolean(document.querySelector('button[role="tab"][title="Settings"]'))`,
          ),
        Boolean,
      );
      await resourceAction(() => click(panel, 'title', 'Settings'));
      await resourceAction(() => openSection(panel, 'Account'));
      await resourceAction(() => openSection(panel, 'Organization'));
      const reloadedIdentity = await waitFor(
        'records_identity_after_reload',
        async () => ({
          ...(await accountIdentity(panel, auth.email)),
          ...(await panelIdentity(panel)),
        }),
        (value) =>
          value?.emailMatches &&
          value.adminRole &&
          value.signOutVisible &&
          value.accessTokenPresent &&
          value.isAdmin === true &&
          value.profileId === auth.profileId &&
          value.organizationSelected &&
          value.organizationLabel === approved.name &&
          (value.organizationId === null || value.organizationId === approved.id),
        30_000,
      );
      assert.ok(reloadedIdentity, 'records_reloaded_identity_missing');
      const reloadBearerHash = await panelBearerHash(panel);
      assert.equal(reloadBearerHash, bearerHash, 'records_reload_principal_changed');
      await resourceAction(() => click(panel, 'title', 'Tools'));
      await waitFor(
        'records_catalog_after_reload',
        () => toolsCatalogState(panel),
        (value) => value === 'catalog',
      );
      await resourceAction(() => click(panel, 'tool-row', 'records'));
      await waitFor(
        'records_schema_after_reload',
        () =>
          evaluate(
            panel,
            `(() => { const b=[...document.querySelectorAll('button')].find(el=>el.querySelector('span.font-mono')?.textContent.trim()==='records'); return Boolean(b?.parentElement?.querySelector('textarea') && [...b.parentElement.querySelectorAll('button')].some(x=>x.textContent.trim()==='Run' && !x.disabled)); })()`,
          ),
        Boolean,
      );
      await enterRecordsInput(panel, evaluate, stage, input, process.platform);
      const reloadResult = await execute(input, reloadBearerHash, 'records_reloaded');
      assertPositive(reloadResult, 'records_reloaded');
      report.reload = {
        full_panel_reload: true,
        admin_identity_matches: true,
        organization_matches: true,
        authenticated_principal_matches: true,
        finished: true,
        completion_observed: true,
        visible: true,
        success: true,
        count: reloadResult.output.tables.length,
      };

      // A separate, completed table_list call supplies the identity oracle. The
      // search must find that same Table; success or a nonempty match list alone
      // would accept an unrelated response.
      const searchTable = reloadResult.output.tables.find(
        (table) =>
          table.organization_id === approved.id &&
          typeof table.id === 'string' &&
          typeof table.name === 'string' &&
          table.name.trim().length > 0,
      );
      assert.ok(searchTable, 'records_metadata_oracle_table_missing');
      const searchInput = {
        action: 'metadata_search',
        args: { organization_id: approved.id, query: searchTable.name, limit: 50 },
      };
      await enterRecordsInput(panel, evaluate, stage, searchInput, process.platform);
      const searchResult = await execute(searchInput, reloadBearerHash, 'records_metadata_search');
      assert.equal(searchResult.success, true, 'records_metadata_search_tool_refused');
      assert.equal(searchResult.output?.action, 'metadata_search', 'records_metadata_wrong_action');
      assert.equal(searchResult.output?.query, searchTable.name, 'records_metadata_wrong_query');
      assert.ok(Array.isArray(searchResult.output?.matches), 'records_metadata_matches_missing');
      assert.equal(
        searchResult.output.count,
        searchResult.output.matches.length,
        'records_metadata_count_mismatch',
      );
      assert.ok(
        searchResult.output.organizations_covered?.includes(approved.id),
        'records_metadata_org_not_covered',
      );
      assert.ok(
        searchResult.output.matches.some(
          (match) =>
            match.kind === 'table' &&
            match.id === searchTable.id &&
            match.name === searchTable.name &&
            match.organization_id === approved.id,
        ),
        'records_metadata_oracle_match_missing',
      );
      report.metadata_search = {
        inventory_case: 'EXT-F-4130-C03',
        finished: true,
        status: 200,
        completion_observed: true,
        visible: true,
        success: true,
        action: 'metadata_search',
        independent_table_identity_matched: true,
        count: searchResult.output.count,
      };
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
