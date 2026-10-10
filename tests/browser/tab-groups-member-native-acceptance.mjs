#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { verifyFrozenArtifactIdentity } from '../../scripts/frozen-artifact-identity.mjs';
import {
  allHandlersTriggerSelected,
  verifyTabGroupsCreateObservation,
} from '../../scripts/hosted-tab-groups-route.mjs';
import { requireLocalDevReceipt } from '../../scripts/record-local-dev-build.mjs';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { signInSettings } from './settings-native-auth-driver.mjs';

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
  schema_version: 1,
  case_id: 'EXT-F-4163-T01',
  status: 'unverified',
  scope: 'member Tools > Catalog manual runner; tab_groups create collapsed=true only',
  stage: 'inputs',
  artifact: null,
  authentication: null,
  fixture: { owned_tab_count: 0, same_window: null, cleanup_verified: false },
  manual_runner: { opened: false, all_handlers_selected: false, canonical_tool: false },
  create: null,
  readback: null,
  fixture_group_id: null,
  failure_code: null,
};

const selectors = {
  toolsTab: () => [...document.querySelectorAll('button[role="tab"][title="Tools"]')],
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

async function pointer(panel, selectorName) {
  const body = `(() => {
    const visible = (el) => { const r=el.getBoundingClientRect(),s=getComputedStyle(el); return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&!el.closest('[inert]'); };
    const candidates = (${selectors[selectorName].toString()})();
    const shown = candidates.filter(visible);
    if (candidates.length !== 1 || shown.length !== 1) return { matched:candidates.length, visible:shown.length, point:null, hit:false };
    shown[0].scrollIntoView({block:'center',inline:'center',behavior:'instant'});
    const r=shown[0].getBoundingClientRect(), x=r.x+r.width/2, y=r.y+r.height/2, hit=document.elementFromPoint(x,y);
    return { matched:1, visible:1, point:{x,y}, hit:Boolean(hit&&(hit===shown[0]||shown[0].contains(hit))) };
  })()`;
  const initial = await evaluate(panel, body);
  assert.equal(initial?.matched, 1, `tab_groups_${selectorName}_unique_match_required`);
  assert.equal(initial?.visible, 1, `tab_groups_${selectorName}_visible_required`);
  assert.equal(initial?.hit, true, `tab_groups_${selectorName}_hit_target_required`);
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: initial.point.x,
    y: initial.point.y,
  });
  const stable = await evaluate(panel, body);
  assert.equal(stable?.hit, true, `tab_groups_${selectorName}_stable_hit_required`);
  assert.ok(
    Math.abs(stable.point.x - initial.point.x) < 1 &&
      Math.abs(stable.point.y - initial.point.y) < 1,
    `tab_groups_${selectorName}_stable_target_required`,
  );
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: stable.point.x,
    y: stable.point.y,
    button: 'left',
    clickCount: 1,
  });
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: stable.point.x,
    y: stable.point.y,
    button: 'left',
    clickCount: 1,
  });
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
  await pointer(panel, 'surfaceFilter');
  await waitFor(
    'tab_groups_all_handlers_option_not_observed',
    () =>
      evaluate(
        panel,
        `(() => { const options=(${selectors.allHandlersOption.toString()})(); return {count:options.length,selected:options.length===1}; })()`,
      ),
    (options) => options?.count === 1 && options.selected,
  );
  await pointer(panel, 'allHandlersOption');
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
  for (const path of ['/tab-group-a', '/tab-group-b']) {
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

async function removeOwnedTabs(panel, ids, groupId) {
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
        return { remaining:remaining.length, removed:existing.length, groupRemaining:groups.some((group)=>group.id===${Number.isSafeInteger(groupId) ? groupId : -1}) };
      })()`,
    );
    return (
      result?.remaining === 0 && result.removed === ids.length && result.groupRemaining === false
    );
  } catch {
    return false;
  }
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
      try {
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
        report.fixture.same_window = fixture.tabs.every((tab) => tab.windowId === fixture.windowId);
        await waitFor(
          'tab_groups_owned_fixture_pages_not_ready',
          () =>
            evaluate(
              panel,
              `(async()=>Promise.all(${JSON.stringify(ids)}.map(async id=>{try{return (await chrome.tabs.get(id)).status==='complete'}catch{return false}})))()`,
            ),
          (state) => Array.isArray(state) && state.length === 2 && state.every(Boolean),
        );

        stage('tools_manual_runner');
        await resourceAction(() => pointer(panel, 'toolsTab'));
        await waitFor(
          'tab_groups_tools_catalog_not_ready',
          () =>
            evaluate(
              panel,
              `(() => { const pane=[...document.querySelectorAll('button[role="tab"][title="Tools"][data-state="active"]')]; return pane.length===1 && Boolean(document.querySelector('input[placeholder="Search by name or description…"]')); })()`,
            ),
          Boolean,
        );
        await resourceAction(() => selectAllHandlers(panel));
        await resourceAction(() => typeInto(panel, 'searchInput', 'tab_groups'));
        await waitFor(
          'tab_groups_search_result_not_ready',
          () => selectorCount(panel, 'tabGroupsRow'),
          (count) => count === 1,
        );
        await resourceAction(() => pointer(panel, 'tabGroupsRow'));
        await waitFor(
          'tab_groups_manual_form_not_ready',
          () => selectorCount(panel, 'tabGroupsTextarea'),
          (count) => count === 1,
        );
        report.manual_runner.opened = true;
        report.manual_runner.canonical_tool = true;
        const createArgs = { action: 'create', tab_ids: ids, title, color, collapsed: true };
        stage('tab_groups_create');
        const createResult = await resourceAction(() => enterTool(panel, 'tab_groups', createArgs));
        const groupId = Number.isSafeInteger(createResult?.group_id) ? createResult.group_id : null;
        report.fixture_group_id = groupId;
        report.create = {
          ok: createResult?.ok === true,
          group_id_observed: groupId !== null,
          collapsed_requested: true,
        };
        assert.equal(createResult?.ok, true, 'tab_groups_create_refused');
        assert.ok(groupId !== null, 'tab_groups_create_group_id_missing');
        const nativeGroup = await evaluate(
          panel,
          `(async()=>{ const group=await chrome.tabGroups.get(${groupId}); const tabs=await chrome.tabs.query({groupId:${groupId}}); return {group:{id:group.id,collapsed:group.collapsed,title:group.title,color:group.color,windowId:group.windowId},tabIds:tabs.map(tab=>tab.id)} })()`,
        );
        stage('tab_groups_get_tab_groups');
        await resourceAction(() => typeInto(panel, 'searchInput', 'get_tab_groups'));
        await waitFor(
          'get_tab_groups_manual_row_not_ready',
          () => selectorCount(panel, 'getTabGroupsRow'),
          (count) => count === 1,
        );
        await resourceAction(() => pointer(panel, 'getTabGroupsRow'));
        await waitFor(
          'get_tab_groups_manual_form_not_ready',
          () => selectorCount(panel, 'getTabGroupsTextarea'),
          (count) => count === 1,
        );
        const readback = await resourceAction(() => enterTool(panel, 'get_tab_groups', {}));
        const proof = verifyTabGroupsCreateObservation({
          createResult,
          chromeGroup: nativeGroup.group,
          chromeTabIds: nativeGroup.tabIds,
          readback,
          expectedTabIds: ids,
          expectedWindowId: fixture.windowId,
          expectedTitle: title,
          expectedColor: color,
        });
        report.create = { ...proof, collapsed_requested: true };
        report.readback = {
          list_count: Number.isSafeInteger(readback?.count) ? readback.count : null,
          group_match: proof.readback_matches,
        };
        assert.equal(proof.passed, true, 'tab_groups_create_collapsed_native_readback_mismatch');
        report.status = 'passed';
      } finally {
        stage('cleanup');
        report.fixture.cleanup_verified = await resourceAction(() =>
          removeOwnedTabs(panel, ids, report.fixture_group_id),
        );
        if (ids.length)
          assert.equal(
            report.fixture.cleanup_verified,
            true,
            'tab_groups_owned_tab_cleanup_unverified',
          );
      }
    },
  });
}

try {
  await main();
} catch (error) {
  const safe = new Set([
    'tab_groups_artifact_inputs_missing',
    'tab_groups_source_missing',
    'tab_groups_ci_run_missing',
    'tab_groups_ci_artifact_missing',
    'tab_groups_artifact_tree_mismatch',
    'tab_groups_member_identity_unverified',
    'tab_groups_create_refused',
    'tab_groups_create_group_id_missing',
    'tab_groups_create_collapsed_native_readback_mismatch',
    'tab_groups_owned_tab_cleanup_unverified',
  ]);
  report.failure_code = safe.has(error?.message) ? error.message : 'unclassified_failure';
  report.status = 'failed';
  process.exitCode = 1;
} finally {
  await mkdir(join(REPO, 'test-results'), { recursive: true, mode: 0o700 });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}
