#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { verifyFrozenArtifactIdentity } from '../../scripts/frozen-artifact-identity.mjs';
import { allHandlersTriggerSelected } from '../../scripts/hosted-tab-groups-route.mjs';
import { requireLocalDevReceipt } from '../../scripts/record-local-dev-build.mjs';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { signInSettings } from './settings-native-auth-driver.mjs';
import { tabGroupsFailureCode, withOwnedTabCleanup } from './tab-groups-member-failure.mjs';

import { pointerTarget, toolsTab } from './tab-groups-manual-runner.mjs';
import {
  runTabGroupsMemberScenarios,
  stableTabGroupSnapshot,
} from './tab-groups-member-scenarios.mjs';

const REPO = resolve(import.meta.dirname, '../..');
const extensionDir = process.env.MATRX_TAB_GROUPS_EXTENSION_DIR;
const receiptPath = process.env.MATRX_TAB_GROUPS_RECEIPT;
const output = join(REPO, 'test-results', 'tab-groups-member-native-acceptance.json');
const title = `Matrx D148 Northline catalog ${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
const color = 'cyan';
const stage = (value) => {
  report.stage = value;
};
const report = {
  schema_version: 2,
  case_id: 'EXT-F-4163-T01',
  status: 'unverified',
  scope:
    'member Tools > Catalog manual runner; tab_groups create true/false, update true/false, add/remove/list with Chrome and get_tab_groups readbacks',
  stage: 'inputs',
  artifact: null,
  authentication: null,
  fixture: { owned_tab_count: 0, same_window: null, cleanup_verified: false },
  manual_runner: { opened: false, all_handlers_selected: false, canonical_tool: false },
  create: null,
  readback: null,
  fixture_group_id: null,
  fixture_group_ids: [],
  branches: {},
  failure_code: null,
  failure_stage: null,
  failure_step: null,
  cleanup_failure_code: null,
  manual_runner_step: null,
  manual_runner_observation: null,
};

const manualStep = (value) => {
  report.manual_runner_step = value;
};

const selectors = {
  toolsTab,
  surfaceFilter: () =>
    [...document.querySelectorAll('button[role="combobox"]')].filter((el) =>
      el.textContent.trim().startsWith('Agent surface ('),
    ),
  allHandlersTrigger: () =>
    [...document.querySelectorAll('button[role="combobox"]')].filter((el) =>
      el.textContent.trim().startsWith('All handlers ('),
    ),
  allHandlersOption: () =>
    [...document.querySelectorAll('[role="option"]')].filter((el) =>
      el.textContent.trim().startsWith('All handlers ('),
    ),
  searchInput: () => [
    ...document.querySelectorAll('input[placeholder="Search by name or description…"]'),
  ],
  tabGroupsRow: () =>
    [...document.querySelectorAll('button')].filter(
      (el) => el.querySelector('span.font-mono')?.textContent.trim() === 'tab_groups',
    ),
  tabGroupsTextarea: () => {
    const row = [...document.querySelectorAll('button')].find(
      (el) => el.querySelector('span.font-mono')?.textContent.trim() === 'tab_groups',
    );
    return [...(row?.closest('.rounded-md.border.bg-card')?.querySelectorAll('textarea') ?? [])];
  },
  tabGroupsRun: () => {
    const row = [...document.querySelectorAll('button')].find(
      (el) => el.querySelector('span.font-mono')?.textContent.trim() === 'tab_groups',
    );
    return [
      ...(row?.closest('.rounded-md.border.bg-card')?.querySelectorAll('button') ?? []),
    ].filter((el) => el.textContent.trim() === 'Run' && !el.disabled);
  },
  tabGroupsResult: () => {
    const row = [...document.querySelectorAll('button')].find(
      (el) => el.querySelector('span.font-mono')?.textContent.trim() === 'tab_groups',
    );
    const labels = [
      ...(row?.closest('.rounded-md.border.bg-card')?.querySelectorAll('div') ?? []),
    ].filter((el) => el.children.length === 0 && el.textContent.trim() === 'output');
    const body = labels.length === 1 ? labels[0].parentElement?.nextElementSibling : null;
    return body?.querySelector('pre') ?? null;
  },
  getTabGroupsRow: () =>
    [...document.querySelectorAll('button')].filter(
      (el) => el.querySelector('span.font-mono')?.textContent.trim() === 'get_tab_groups',
    ),
  getTabGroupsTextarea: () => {
    const row = [...document.querySelectorAll('button')].find(
      (el) => el.querySelector('span.font-mono')?.textContent.trim() === 'get_tab_groups',
    );
    return [...(row?.closest('.rounded-md.border.bg-card')?.querySelectorAll('textarea') ?? [])];
  },
  getTabGroupsRun: () => {
    const row = [...document.querySelectorAll('button')].find(
      (el) => el.querySelector('span.font-mono')?.textContent.trim() === 'get_tab_groups',
    );
    return [
      ...(row?.closest('.rounded-md.border.bg-card')?.querySelectorAll('button') ?? []),
    ].filter((el) => el.textContent.trim() === 'Run' && !el.disabled);
  },
  getTabGroupsResult: () => {
    const row = [...document.querySelectorAll('button')].find(
      (el) => el.querySelector('span.font-mono')?.textContent.trim() === 'get_tab_groups',
    );
    const labels = [
      ...(row?.closest('.rounded-md.border.bg-card')?.querySelectorAll('div') ?? []),
    ].filter((el) => el.children.length === 0 && el.textContent.trim() === 'output');
    const body = labels.length === 1 ? labels[0].parentElement?.nextElementSibling : null;
    return body?.querySelector('pre') ?? null;
  },
};

async function evaluate(panel, expression) {
  const result = await panel.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error('tab_groups_panel_evaluation_failed');
  return result.result?.value;
}

async function waitFor(label, read, accept, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await read();
    if (accept(last)) return last;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(label);
}

async function selectorCount(panel, selectorName) {
  return evaluate(panel, `(() => (${selectors[selectorName].toString()})().length)()`);
}

async function observeManualRunner(panel) {
  return evaluate(
    panel,
    `(() => {
      const toolsTab = (${selectors.toolsTab.toString()})();
      return {
        availability: 'ready',
        tools_tab_matches: toolsTab.length,
        tools_tab_native_title_matches: document.querySelectorAll('button[role="tab"][title="Tools"]').length,
        tools_tab_preserved_title_matches: document.querySelectorAll('button[role="tab"][data-matrx-title="Tools"]').length,
        tools_tab_active: toolsTab.filter((el) => el.dataset.state === 'active').length,
        catalog_search_matches: (${selectors.searchInput.toString()})().length,
        surface_filter_matches: (${selectors.surfaceFilter.toString()})().length,
        all_handlers_option_matches: (${selectors.allHandlersOption.toString()})().length,
        all_handlers_trigger_matches: (${selectors.allHandlersTrigger.toString()})().length,
        tab_groups_row_matches: (${selectors.tabGroupsRow.toString()})().length,
        tab_groups_form_matches: (${selectors.tabGroupsTextarea.toString()})().length,
      };
    })()`,
  );
}

function pointer(panel, selectorName) {
  return pointerTarget(panel, selectorName, selectors[selectorName]);
}

async function typeInto(panel, selectorName, text) {
  await pointer(panel, selectorName);
  await panel.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'a',
    code: 'KeyA',
    modifiers: 4,
    windowsVirtualKeyCode: 65,
    commands: ['selectAll'],
  });
  await panel.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'a',
    code: 'KeyA',
    modifiers: 4,
    windowsVirtualKeyCode: 65,
  });
  await panel.send('Input.insertText', { text });
}

async function selectAllHandlers(panel) {
  manualStep('surface_filter_click');
  await pointer(panel, 'surfaceFilter');
  manualStep('all_handlers_option_ready');
  await waitFor(
    'tab_groups_all_handlers_option_not_observed',
    () =>
      evaluate(
        panel,
        `(() => { const options=(${selectors.allHandlersOption.toString()})(); return {count:options.length,selected:options.length===1}; })()`,
      ),
    (options) => options?.count === 1 && options.selected,
  );
  manualStep('all_handlers_option_click');
  await pointer(panel, 'allHandlersOption');
  manualStep('all_handlers_selected');
  const selected = await waitFor(
    'tab_groups_all_handlers_selection_not_observed',
    () =>
      evaluate(
        panel,
        `(() => { const triggers=(${selectors.allHandlersTrigger.toString()})(); return {count:triggers.length,selected:triggers.length===1&&triggers[0].textContent.trim().startsWith('All handlers (')}; })()`,
      ),
    allHandlersTriggerSelected,
  );
  report.manual_runner.all_handlers_selected = allHandlersTriggerSelected(selected);
}

async function enterTool(panel, toolName, args) {
  const textareaSelector =
    toolName === 'get_tab_groups' ? 'getTabGroupsTextarea' : 'tabGroupsTextarea';
  const runSelector = toolName === 'get_tab_groups' ? 'getTabGroupsRun' : 'tabGroupsRun';
  const resultSelector = toolName === 'get_tab_groups' ? 'getTabGroupsResult' : 'tabGroupsResult';
  await typeInto(panel, textareaSelector, JSON.stringify(args));
  const value = await evaluate(
    panel,
    `(() => (${selectors[textareaSelector].toString()})()[0]?.value ?? null)()`,
  );
  assert.equal(value, JSON.stringify(args), 'tab_groups_manual_arguments_not_visible');
  await pointer(panel, runSelector);
  const text = await waitFor(
    'tab_groups_manual_result_not_observed',
    () =>
      evaluate(panel, `(() => (${selectors[resultSelector].toString()})()?.textContent ?? null)()`),
    (result) => typeof result === 'string' && result.length > 0,
  );
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('tab_groups_manual_result_not_json');
  }
}

async function createOwnedTabs(panel, origin, onCreated) {
  const windowId = await evaluate(
    panel,
    '(async()=>{const w=await chrome.windows.getCurrent();return w.id})()',
  );
  assert.ok(Number.isSafeInteger(windowId), 'tab_groups_fixture_window_missing');
  const tabs = [];
  for (const path of [
    '/tab-group-a',
    '/tab-group-b',
    '/tab-group-c',
    '/tab-group-d',
    '/tab-group-e',
  ]) {
    const tab = await evaluate(
      panel,
      `(async()=>{const t=await chrome.tabs.create({windowId:${windowId},url:${JSON.stringify(`${origin}${path}`)},active:false});return {id:t.id,windowId:t.windowId}})()`,
    );
    tabs.push(tab);
    onCreated(tab.id);
  }
  assert.ok(
    tabs.every((tab) => Number.isSafeInteger(tab.id)),
    'tab_groups_owned_tab_id_missing',
  );
  assert.ok(
    tabs.every((tab) => tab.windowId === windowId),
    'tab_groups_fixture_window_mismatch',
  );
  return { windowId, tabs };
}

async function removeOwnedTabs(panel, ids, groupIds) {
  if (!ids.length) return false;
  try {
    const result = await evaluate(
      panel,
      `(async () => {
        const ids=${JSON.stringify(ids)};
        const live=[];
        for (const id of ids) { try { live.push(await chrome.tabs.get(id)); } catch {} }
        const grouped=live.filter((tab)=>Number.isSafeInteger(tab.groupId)&&tab.groupId>=0).map((tab)=>tab.id);
        if (grouped.length) await chrome.tabs.ungroup(grouped);
        const existing=live.map((tab)=>tab.id);
        if (existing.length) await chrome.tabs.remove(existing);
        const remaining=[];
        for (const id of ids) { try { await chrome.tabs.get(id); remaining.push(id); } catch {} }
        const groups=await chrome.tabGroups.query({});
        return { remaining:remaining.length, removed:existing.length, groupRemaining:groups.some((group)=>${JSON.stringify(groupIds)}.includes(group.id)) };
      })()`,
    );
    return (
      result?.remaining === 0 && result.removed === ids.length && result.groupRemaining === false
    );
  } catch {
    return false;
  }
}

async function observeChrome(panel) {
  return evaluate(
    panel,
    `(async () => {
    const [groups,tabs] = await Promise.all([chrome.tabGroups.query({}),chrome.tabs.query({})]);
    return {groups:groups.map(({id,windowId,title,color,collapsed})=>({id,windowId,title,color,collapsed})),
      tabs:tabs.map(({id,windowId,groupId,url})=>({id,windowId,groupId,url}))};
  })()`,
  );
}

async function runCanonicalTool(panel, name, args) {
  const row = name === 'get_tab_groups' ? 'getTabGroupsRow' : 'tabGroupsRow';
  const form = name === 'get_tab_groups' ? 'getTabGroupsTextarea' : 'tabGroupsTextarea';
  await typeInto(panel, 'searchInput', name);
  await waitFor(
    'tab_groups_manual_row_not_ready',
    () => selectorCount(panel, row),
    (count) => count === 1,
  );
  // Re-mount the detail before each invocation: previous output must never prove a new run.
  if (await selectorCount(panel, form)) {
    await pointer(panel, row);
    await waitFor(
      'tab_groups_manual_form_not_closed',
      () => selectorCount(panel, form),
      (count) => count === 0,
    );
  }
  await pointer(panel, row);
  await waitFor(
    'tab_groups_manual_form_not_ready',
    () => selectorCount(panel, form),
    (count) => count === 1,
  );
  assert.equal(
    await evaluate(
      panel,
      `(() => (${selectors[name === 'get_tab_groups' ? 'getTabGroupsResult' : 'tabGroupsResult'].toString()})()?.textContent ?? null)()`,
    ),
    null,
    'tab_groups_stale_manual_result',
  );
  return enterTool(panel, name, args);
}

async function main() {
  assert.ok(extensionDir && receiptPath, 'tab_groups_artifact_inputs_missing');
  assert.match(
    process.env.MATRX_TAB_GROUPS_SOURCE_SHA ?? '',
    /^[a-f0-9]{40}$/,
    'tab_groups_source_missing',
  );
  assert.match(
    process.env.MATRX_TAB_GROUPS_CI_RUN_ID ?? '',
    /^[1-9][0-9]*$/,
    'tab_groups_ci_run_missing',
  );
  assert.match(
    process.env.MATRX_TAB_GROUPS_CI_ARTIFACT_ID ?? '',
    /^[1-9][0-9]*$/,
    'tab_groups_ci_artifact_missing',
  );
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  const manifest = JSON.parse(await readFile(join(extensionDir, 'manifest.json'), 'utf8'));
  requireLocalDevReceipt(receipt, extensionDir);
  verifyFrozenArtifactIdentity({ extensionDir, manifest, receipt });
  assert.equal(
    hashReleaseTree(extensionDir),
    receipt.treeSha256,
    'tab_groups_artifact_tree_mismatch',
  );
  report.artifact = {
    source_sha: process.env.MATRX_TAB_GROUPS_SOURCE_SHA,
    ci_run_id: Number(process.env.MATRX_TAB_GROUPS_CI_RUN_ID),
    ci_artifact_id: Number(process.env.MATRX_TAB_GROUPS_CI_ARTIFACT_ID),
    version: receipt.version,
    tree_sha256: receipt.treeSha256,
  };
  await runNativeSidepanelQa({
    headed: true,
    extensionDir,
    localDevReceiptPath: receiptPath,
    expectedRelease: receipt,
    artifactRoot: join(process.env.RUNNER_TEMP ?? REPO, 'guest-acceptance'),
    ownedPages: {
      '/tab-group-a':
        '<!doctype html><title>Northline Furnishings order desk</title><main>Order desk A</main>',
      '/tab-group-b':
        '<!doctype html><title>Northline Furnishings delivery schedule</title><main>Delivery schedule B</main>',
      '/tab-group-c':
        '<!doctype html><title>Northline Furnishings inventory</title><main>Inventory</main>',
      '/tab-group-d':
        '<!doctype html><title>Northline Furnishings dispatch</title><main>Dispatch</main>',
      '/tab-group-e':
        '<!doctype html><title>Northline Furnishings returns</title><main>Returns</main>',
    },
    onStage: (value) => {
      report.native_stage = value;
    },
    exercisePanel: async ({
      page,
      panel,
      resourceAction,
      activatePanel,
      requireResourceHealth,
    }) => {
      const ids = [];
      let baseline = null;
      await withOwnedTabCleanup(
        report,
        async () => {
          stage('member_auth');
          await requireResourceHealth();
          const identity = await resourceAction(() =>
            signInSettings({
              mode: 'member',
              page,
              panel,
              repo: REPO,
              memberLinkFile: process.env.MATRX_REVIEWER_MAGIC_LINK_FILE,
              allowLadderOrganization: true,
              onStage: (value) => {
                report.stage = `auth_${value}`;
              },
            }),
          );
          report.authentication = {
            member_signed_in:
              identity.web_signed_in === true && identity.extension_signed_in === true,
            non_admin_identity: identity.admin_role === false,
            organization_selected: identity.organization_selected === true,
          };
          assert.deepEqual(
            report.authentication,
            {
              member_signed_in: true,
              non_admin_identity: true,
              organization_selected: true,
            },
            'tab_groups_member_identity_unverified',
          );
          await activatePanel();
          const window = await page.evaluate(() => location.origin);
          const fixture = await resourceAction(() =>
            createOwnedTabs(panel, window, (id) => {
              ids.push(id);
              report.fixture.owned_tab_count = ids.length;
            }),
          );
          report.fixture.owned_tab_count = ids.length;
          report.fixture.same_window = fixture.tabs.every(
            (tab) => tab.windowId === fixture.windowId,
          );
          await waitFor(
            'tab_groups_owned_fixture_pages_not_ready',
            () =>
              evaluate(
                panel,
                `(async()=>Promise.all(${JSON.stringify(ids)}.map(async id=>{try{return (await chrome.tabs.get(id)).status==='complete'}catch{return false}})))()`,
              ),
            (state) => Array.isArray(state) && state.length === 5 && state.every(Boolean),
          );

          stage('tools_manual_runner');
          manualStep('tools_tab_click');
          await resourceAction(() => pointer(panel, 'toolsTab'));
          manualStep('catalog_ready');
          await waitFor(
            'tab_groups_tools_catalog_not_ready',
            () =>
              evaluate(
                panel,
                `(() => { const pane=(${selectors.toolsTab.toString()})().filter(el=>el.dataset.state==='active'); return pane.length===1 && Boolean(document.querySelector('input[placeholder="Search by name or description…"]')); })()`,
              ),
            Boolean,
          );
          await resourceAction(() => selectAllHandlers(panel));
          manualStep('search_input');
          await resourceAction(() => typeInto(panel, 'searchInput', 'tab_groups'));
          manualStep('tab_groups_row_ready');
          await waitFor(
            'tab_groups_search_result_not_ready',
            () => selectorCount(panel, 'tabGroupsRow'),
            (count) => count === 1,
          );
          manualStep('tab_groups_row_click');
          await resourceAction(() => pointer(panel, 'tabGroupsRow'));
          manualStep('tab_groups_form_ready');
          await waitFor(
            'tab_groups_manual_form_not_ready',
            () => selectorCount(panel, 'tabGroupsTextarea'),
            (count) => count === 1,
          );
          report.manual_runner.opened = true;
          report.manual_runner.canonical_tool = true;
          await runTabGroupsMemberScenarios({
            report,
            ids,
            windowId: fixture.windowId,
            title,
            color,
            runTool: (name, args) => resourceAction(() => runCanonicalTool(panel, name, args)),
            observeChrome: () => resourceAction(() => observeChrome(panel)),
            onBaseline: (snapshot) => {
              baseline = snapshot;
            },
            onGroupCreated: (id) => {
              report.fixture_group_ids.push(id);
            },
          });
          report.status = 'passed';
        },
        async () => {
          report.fixture.cleanup_verified = await resourceAction(() =>
            removeOwnedTabs(panel, ids, report.fixture_group_ids),
          );
          if (baseline) {
            const afterCleanup = await resourceAction(() => observeChrome(panel));
            report.fixture.non_owned_cleanup_unchanged =
              JSON.stringify(stableTabGroupSnapshot(afterCleanup)) ===
              JSON.stringify(stableTabGroupSnapshot(baseline, ids));
            assert.equal(
              report.fixture.non_owned_cleanup_unchanged,
              true,
              'tab_groups_cleanup_non_owned_mutation',
            );
          }
          if (ids.length)
            assert.equal(
              report.fixture.cleanup_verified,
              true,
              'tab_groups_owned_tab_cleanup_unverified',
            );
        },
        async () => {
          if (report.stage === 'tools_manual_runner')
            report.manual_runner_observation = (await observeManualRunner(panel)) ?? {
              availability: 'unavailable',
            };
        },
      );
    },
  });
}

try {
  await main();
} catch (error) {
  report.failure_stage ??= report.stage;
  report.failure_step ??= report.stage === 'tools_manual_runner' ? report.manual_runner_step : null;
  report.failure_code ??= tabGroupsFailureCode(error, report);
  report.status = 'failed';
  process.exitCode = 1;
} finally {
  await mkdir(join(REPO, 'test-results'), { recursive: true, mode: 0o700 });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}
