#!/usr/bin/env node
/** Real admin Tools-card Records reads, with independent table and search oracles. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { withRecordsPositiveFixture } from './records-positive-fixture.mjs';
import {
  assertRecordsVisibleCompletion,
  enterRecordsInput,
  observeRecordsExecution,
  recordsCompletionShape,
  recordsVisibleShape,
  retainRecordsFailure,
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
  negative_reads: [],
  positive_reads: [],
  fixture_cleanup: null,
  invalid_input: null,
  reload: null,
  failure_code: null,
  failure_phase: null,
  failure_classification: null,
  card_diagnostic: null,
  completion_diagnostics: [],
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
      const cardDiagnostic = {
        phase: 'card_ready',
        failure: null,
        card_ready: null,
        schema_ready: null,
        contract: null,
      };
      report.card_diagnostic = cardDiagnostic;
      // The authenticated organization checkpoint opened this exact card to
      // fetch its schema. Its open state is a prerequisite, not a tool action.
      try {
        await waitFor(
          'records_card_ready',
          async () => {
            const ready = await evaluate(
              panel,
              `(() => [...document.querySelectorAll('button')].some(el => el.querySelector('span.font-mono')?.textContent.trim() === 'records'))()`,
            );
            cardDiagnostic.card_ready = ready === true;
            return ready;
          },
          (value) => value === true,
          10000,
          () => ({ card_ready: cardDiagnostic.card_ready }),
        );
      } catch {
        cardDiagnostic.failure = 'card_not_ready';
        throw new Error('records_card_not_ready');
      }
      cardDiagnostic.phase = 'schema_ready';
      try {
        await waitFor(
          'records_schema_ready',
          async () => {
            const ready = await evaluate(
              panel,
              `(() => { const b=[...document.querySelectorAll('button')].find(el=>el.querySelector('span.font-mono')?.textContent.trim()==='records'); return Boolean(b?.parentElement?.querySelector('textarea') && [...b.parentElement.querySelectorAll('button')].some(x=>x.textContent.trim()==='Run' && !x.disabled)); })()`,
            );
            cardDiagnostic.schema_ready = ready === true;
            return ready;
          },
          (value) => value === true,
          10000,
          () => ({ schema_ready: cardDiagnostic.schema_ready }),
        );
      } catch {
        cardDiagnostic.failure = 'schema_not_ready';
        throw new Error('records_schema_not_ready');
      }
      cardDiagnostic.phase = 'contract_observation';
      let tableListContract;
      try {
        tableListContract = await evaluate(
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
      } catch {
        cardDiagnostic.failure = 'contract_observation_failed';
        throw new Error('records_contract_observation_failed');
      }
      cardDiagnostic.contract = {
        present: tableListContract !== null && typeof tableListContract === 'object',
        canonical_boolean: tableListContract?.canonical === true,
        retired_field_present: tableListContract?.legacy === true,
        action_available: tableListContract?.action === true,
        limit_integer: tableListContract?.limit === 'integer',
      };
      if (!cardDiagnostic.contract.present) cardDiagnostic.failure = 'contract_unavailable';
      else if (
        !cardDiagnostic.contract.canonical_boolean ||
        cardDiagnostic.contract.retired_field_present ||
        !cardDiagnostic.contract.action_available ||
        !cardDiagnostic.contract.limit_integer
      )
        cardDiagnostic.failure = 'contract_drift';
      assert.deepEqual(
        tableListContract,
        { canonical: true, legacy: false, action: true, limit: 'integer' },
        'records_table_list_server_contract_drift',
      );
      cardDiagnostic.phase = 'complete';
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
        const diagnostic = {
          action: argumentsInput.action,
          phase: 'request',
          failure: null,
          http_status: null,
          completion: null,
          visible: null,
        };
        report.completion_diagnostics.push(diagnostic);
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
          diagnostic.http_status = Number.isInteger(request.status) ? request.status : null;
          if (request.status !== 200) diagnostic.failure = 'http_rejected';
          assert.equal(request.status, 200, `${label}_http_failed`);
          stage(`${label}_completion`);
          diagnostic.phase = 'completion_parse';
          let completion;
          try {
            completion = await observer.completion(request);
          } catch {
            diagnostic.failure = 'completion_parse_failed';
            throw new Error(`${label}_completion_parse_failed`);
          }
          diagnostic.completion = recordsCompletionShape(completion);
          diagnostic.phase = 'visible_output_wait';
          const visible = await waitFor(
            `${label}_output_visible`,
            async () => {
              const current = await outputState(panel);
              diagnostic.visible = recordsVisibleShape(current, completion);
              return current;
            },
            (value) => {
              return (
                recordsVisibleShape(value, completion).visible &&
                recordsVisibleShape(value, completion).equals_completion
              );
            },
            30_000,
            () => diagnostic.visible,
          );
          diagnostic.phase = 'visible_output_equality';
          diagnostic.visible = recordsVisibleShape(visible, completion);
          if (!diagnostic.visible.equals_completion) diagnostic.failure = 'visible_output_mismatch';
          const result = assertRecordsVisibleCompletion(visible, completion);
          diagnostic.phase = 'complete';
          if (label.startsWith('records_invalid_')) {
            if (result.success !== false) diagnostic.failure = 'tool_result_invalid';
          } else if (result.success === false) diagnostic.failure = 'tool_refusal';
          else if (result.success !== true) diagnostic.failure = 'tool_result_invalid';
          return result;
        } catch (error) {
          if (!diagnostic.failure) {
            diagnostic.failure =
              diagnostic.phase === 'visible_output_wait'
                ? diagnostic.visible?.visible && diagnostic.visible?.json
                  ? 'visible_output_mismatch'
                  : 'visible_output_missing'
                : diagnostic.phase === 'visible_output_equality'
                  ? 'visible_output_mismatch'
                  : 'request_failed';
          }
          throw error;
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

      // These cases exercise only the malformed-input boundary. Positive
      // record reads need disposable row/table IDs and are not credited here.
      stage('records_negative_read_contract');
      const negativeContract = await evaluate(
        panel,
        `(() => {
          const row = [...document.querySelectorAll('button')].find(el => el.querySelector('span.font-mono')?.textContent.trim() === 'records');
          const card = row?.parentElement;
          const label = [...(card?.querySelectorAll('div') ?? [])].find(el => el.textContent.trim() === 'server action contract' && el.children.length === 0);
          const pre = label?.parentElement?.parentElement?.querySelector('pre');
          if (!pre?.getClientRects().length) return null;
          try {
            const schema = JSON.parse(pre.textContent);
            return [
              ['metadata_search', 'query'],
              ['record_read', 'record_id'],
              ['record_aggregate', 'table_id'],
            ].map(([action, field]) => ({
              action_available: schema.action?.enum?.includes(action) === true,
              field_available: Object.hasOwn(schema.$variants?.[action] ?? {}, field),
            }));
          } catch { return null; }
        })()`,
      );
      assert.deepEqual(
        negativeContract,
        Array.from({ length: 3 }, () => ({ action_available: true, field_available: true })),
        'records_negative_read_contract_drift',
      );
      for (const { caseId, action, args, field } of [
        {
          caseId: 'EXT-F-4130-C03',
          action: 'metadata_search',
          args: { organization_id: approved.id, query: null },
          field: 'query',
        },
        {
          caseId: 'EXT-F-4130-C04',
          action: 'record_read',
          args: { record_id: 'not-a-uuid' },
          field: 'record_id',
        },
        {
          caseId: 'EXT-F-4130-C05',
          action: 'record_aggregate',
          args: { table_id: 'not-a-uuid', measure: 'count' },
          field: 'table_id',
        },
      ]) {
        const invalidRead = { action, args };
        await enterRecordsInput(panel, evaluate, stage, invalidRead, process.platform);
        const label = `records_invalid_${action}`;
        const refused = await execute(invalidRead, reloadBearerHash, label);
        assert.equal(refused.success, false, `${label}_false_success`);
        assert.equal(refused.error?.error_type, 'invalid_arguments', `${label}_wrong_error_class`);
        assert.match(
          refused.error?.message ?? '',
          new RegExp(field, 'i'),
          `${label}_field_missing`,
        );
        report.negative_reads.push({
          inventory_case: caseId,
          action,
          finished: true,
          status: 200,
          completion_observed: true,
          visible: true,
          refused: true,
          field_named: true,
          error_class: refused.error.error_type,
          positive_read_verified: false,
        });
      }
      stage('records_positive_fixture');
      const fixture = await withRecordsPositiveFixture({
        panel,
        evaluate,
        orgId: approved.id,
        bearerHash: reloadBearerHash,
        journalPath: `${output}.fixture-journal.json`,
        onStage: stage,
        exercise: async ({ tableId, rowId, rowName }) => {
          for (const [caseId, action, args] of [
            ['EXT-F-4130-C04', 'record_read', { record_id: rowId }],
            [
              'EXT-F-4130-C05',
              'record_aggregate',
              { table_id: tableId, measure: 'count', match: { name: rowName } },
            ],
          ]) {
            const read = { action, args };
            await enterRecordsInput(panel, evaluate, stage, read, process.platform);
            const result = await execute(read, reloadBearerHash, `records_positive_${action}`);
            assert.equal(result.success, true, `records_positive_${action}_refused`);
            assert.equal(result.output?.action, action, `records_positive_${action}_wrong_action`);
            if (action === 'record_read') {
              assert.equal(result.output.record?.id, rowId, 'records_positive_read_wrong_row');
              assert.equal(
                result.output.record?.table_id,
                tableId,
                'records_positive_read_wrong_table',
              );
              assert.equal(
                result.output.record?.organization_id,
                approved.id,
                'records_positive_read_wrong_org',
              );
              assert.equal(
                result.output.record?.values?.name,
                rowName,
                'records_positive_read_wrong_value',
              );
              assert.ok(
                result.output.triples?.some(
                  (triple) =>
                    triple.field === 'name' &&
                    triple.record_id === rowId &&
                    typeof triple.field_id === 'string' &&
                    Number.isInteger(triple.value_version),
                ),
                'records_positive_read_triples_missing',
              );
              assert.equal(result.output.withheld, undefined, 'records_positive_read_withheld');
            } else {
              assert.equal(
                result.output.table_id,
                tableId,
                'records_positive_aggregate_wrong_table',
              );
              assert.equal(
                result.output.measure,
                'count',
                'records_positive_aggregate_wrong_measure',
              );
              assert.equal(
                result.output.buckets?.length,
                1,
                'records_positive_aggregate_bucket_count',
              );
              assert.equal(
                result.output.buckets[0].row_count,
                1,
                'records_positive_aggregate_wrong_rows',
              );
              assert.equal(
                result.output.buckets[0].measure?.count,
                1,
                'records_positive_aggregate_wrong_count',
              );
            }
            report.positive_reads.push({
              inventory_case: caseId,
              action,
              finished: true,
              status: 200,
              completion_observed: true,
              visible: true,
              owned_fixture_matched: true,
            });
          }
        },
      });
      assert.equal(fixture.archived_verified, true, 'records_fixture_cleanup_unverified');
      report.fixture_cleanup = {
        archived_verified: true,
        same_principal: true,
        table_invisible: true,
      };
    },
  });
  report.status = 'passed';
} catch {
  report.failure_code = `${report.stage}_failed`;
  retainRecordsFailure(report);
  process.stderr.write(
    `UNVERIFIED records_readonly_native stage=${report.stage} native_stage=${report.native_stage}\n`,
  );
  process.exitCode = 1;
} finally {
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}
