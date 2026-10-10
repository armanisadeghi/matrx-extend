#!/usr/bin/env node
/** EXT-D-0150: real native WebMCP, exact CI artifact, owned localhost page. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { verifyImportedNativeEvidence } from '../../scripts/current-test-artifact.mjs';
import { verifyFrozenArtifactIdentity } from '../../scripts/frozen-artifact-identity.mjs';
import { requireLocalDevReceipt } from '../../scripts/record-local-dev-build.mjs';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { signInSettings } from './settings-native-auth-driver.mjs';
import { click, evaluate, toolsCatalogState, waitFor } from './settings-panel-driver.mjs';
import {
  requireWebmcpBrowserPreflight,
  requireWebmcpNativeCases,
} from './webmcp-native-verdict.mjs';
import { webmcpOwnedFixture } from './webmcp-owned-fixture.mjs';

const REPO = resolve(import.meta.dirname, '../..');
const OUTPUT = join(REPO, 'test-results', 'webmcp-native-acceptance.json');
const EXTENSION_DIR = process.env.MATRX_WEBMCP_EXTENSION_DIR;
const RECEIPT = process.env.MATRX_WEBMCP_RECEIPT;
const CHROME_PATH = process.env.MATRX_CHROME_PATH;
const runId = randomUUID();
const fixtureName = `harbor_dental_intake_count_${runId.replaceAll('-', '_')}`;
const nonce = randomUUID();
const report = {
  schema_version: 1,
  defect_id: 'EXT-D-0150',
  status: 'unverified',
  product_acceptance_credit: false,
  stage: 'inputs',
  artifact: null,
  browser: null,
  cases: null,
  failure_code: null,
};

const toolsPane = `(() => {
  const tab=[...document.querySelectorAll('button[role="tab"][title="Tools"]')]
    .find((el)=>el.getAttribute('data-state')==='active');
  return tab?document.getElementById(tab.getAttribute('aria-controls')):null;
})()`;
const toolCard = (name) => `(() => {
  const pane=${toolsPane};
  const row=[...(pane?.querySelectorAll('button')??[])]
    .find((el)=>el.querySelector('span.font-mono')?.textContent.trim()===${JSON.stringify(name)});
  return row?.closest('.rounded-md.border.bg-card')??null;
})()`;

async function pointer(panel, expression, label) {
  const target = await evaluate(
    panel,
    `(() => {
    const matched=${expression};
    const visible=matched.filter((el)=>{
      const r=el.getBoundingClientRect(),s=getComputedStyle(el);
      return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&!el.closest('[inert]');
    });
    if(matched.length!==1||visible.length!==1) return {count:matched.length,visible:visible.length,hit:false};
    visible[0].scrollIntoView({block:'center',inline:'center',behavior:'instant'});
    const r=visible[0].getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
    const hit=document.elementFromPoint(x,y);
    return {count:1,visible:1,hit:Boolean(hit&&(hit===visible[0]||visible[0].contains(hit))),x,y};
  })()`,
  );
  assert.equal(target?.count, 1, `webmcp_${label}_unique_required`);
  assert.equal(target?.hit, true, `webmcp_${label}_hit_required`);
  await panel.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y });
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: target.x,
    y: target.y,
    button: 'left',
    clickCount: 1,
  });
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: target.x,
    y: target.y,
    button: 'left',
    clickCount: 1,
  });
}

async function inputText(panel, expression, value, label) {
  await pointer(panel, expression, label);
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
  await panel.send('Input.insertText', { text: value });
}

async function manualRun(panel, name, args) {
  await inputText(
    panel,
    `[...(${toolsPane}?.querySelectorAll('input[placeholder="Search by name or description…"]')??[])]`,
    name,
    'search',
  );
  await waitFor('webmcp_tool_row', () => evaluate(panel, `Boolean(${toolCard(name)})`), Boolean);
  const card = toolCard(name);
  const open = await evaluate(panel, `(${card})?.querySelectorAll('textarea').length??0`);
  if (open !== 1) await click(panel, 'tool-row', name);
  await waitFor(
    'webmcp_manual_form',
    () => evaluate(panel, `(${card})?.querySelectorAll('textarea').length??0`),
    (count) => count === 1,
  );
  await inputText(
    panel,
    `[...(${card}?.querySelectorAll('textarea')??[])]`,
    JSON.stringify(args),
    'arguments',
  );
  assert.equal(
    await evaluate(panel, `(${card})?.querySelector('textarea')?.value??null`),
    JSON.stringify(args),
    'webmcp_manual_arguments_not_visible',
  );
  const readOutput = `(() => {
      const labels=[...(${card}?.querySelectorAll('div')??[])]
        .filter((el)=>el.children.length===0&&el.textContent.trim()==='output');
      return labels.length===1?labels[0].parentElement?.nextElementSibling?.querySelector('pre')?.textContent??null:null;
    })()`;
  const before = await evaluate(panel, readOutput);
  await pointer(
    panel,
    `[...(${card}?.querySelectorAll('button')??[])].filter((el)=>el.textContent.trim()==='Run'&&!el.disabled)`,
    'run',
  );
  const output = await waitFor(
    'webmcp_manual_result',
    () => evaluate(panel, readOutput),
    (value) => typeof value === 'string' && value.length > 0 && value !== before,
  );
  try {
    return JSON.parse(output);
  } catch {
    throw new Error('webmcp_manual_result_not_json');
  }
}

async function main() {
  assert.ok(EXTENSION_DIR && RECEIPT && CHROME_PATH, 'webmcp_exact_artifact_and_chrome_required');
  assert.match(
    process.env.MATRX_WEBMCP_SOURCE_SHA ?? '',
    /^[a-f0-9]{40}$/,
    'webmcp_source_required',
  );
  assert.match(process.env.MATRX_WEBMCP_CI_RUN_ID ?? '', /^[1-9][0-9]*$/, 'webmcp_ci_run_required');
  assert.match(
    process.env.MATRX_WEBMCP_CI_ARTIFACT_ID ?? '',
    /^[1-9][0-9]*$/,
    'webmcp_ci_artifact_required',
  );
  const receipt = JSON.parse(await readFile(RECEIPT, 'utf8'));
  const manifest = JSON.parse(await readFile(join(EXTENSION_DIR, 'manifest.json'), 'utf8'));
  requireLocalDevReceipt(receipt, EXTENSION_DIR);
  const imported = await verifyImportedNativeEvidence(EXTENSION_DIR, RECEIPT);
  assert.equal(imported.sourceSha, process.env.MATRX_WEBMCP_SOURCE_SHA, 'webmcp_source_mismatch');
  assert.equal(
    imported.runId,
    Number(process.env.MATRX_WEBMCP_CI_RUN_ID),
    'webmcp_ci_run_mismatch',
  );
  assert.equal(
    imported.artifactId,
    Number(process.env.MATRX_WEBMCP_CI_ARTIFACT_ID),
    'webmcp_ci_artifact_mismatch',
  );
  verifyFrozenArtifactIdentity({ extensionDir: EXTENSION_DIR, manifest, receipt });
  assert.equal(hashReleaseTree(EXTENSION_DIR), receipt.treeSha256, 'webmcp_artifact_tree_mismatch');
  report.artifact = {
    source_sha: process.env.MATRX_WEBMCP_SOURCE_SHA,
    ci_run_id: Number(process.env.MATRX_WEBMCP_CI_RUN_ID),
    ci_artifact_id: Number(process.env.MATRX_WEBMCP_CI_ARTIFACT_ID),
    tree_sha256: receipt.treeSha256,
    version: receipt.version,
  };
  await runNativeSidepanelQa({
    headed: true,
    chromeExecutable: CHROME_PATH,
    enableWebMcpTesting: true,
    extensionDir: EXTENSION_DIR,
    localDevReceiptPath: RECEIPT,
    expectedRelease: receipt,
    artifactRoot: join(process.env.RUNNER_TEMP ?? REPO, 'webmcp-native'),
    ownedPages: { '/webmcp-fixture/': webmcpOwnedFixture(runId) },
    onStage: (stage) => {
      report.stage = `harness_${stage}`;
    },
    exercisePanel: async (native) => {
      await native.requireResourceHealth();
      const version = await native.browserSession.send('Browser.getVersion');
      const major = Number(version.product?.match(/\/(\d+)/)?.[1]);
      const commandLine = await native.browserSession.send('Browser.getBrowserCommandLine');
      const testingFlag =
        commandLine.arguments?.includes('--enable-features=WebMCPTesting') === true;
      report.browser = {
        major: Number.isSafeInteger(major) ? major : null,
        testing_flag: testingFlag,
      };
      requireWebmcpBrowserPreflight(major, testingFlag);
      report.stage = 'admin_auth';
      const identity = await native.resourceAction(() =>
        signInSettings({
          mode: 'admin',
          page: native.page,
          panel: native.panel,
          repo: REPO,
          adminCredentialsFile: process.env.MATRX_PREPARE_ADMIN_CREDENTIALS_FILE,
        }),
      );
      assert.equal(identity.admin_role, true, 'webmcp_admin_identity_required');
      report.stage = 'fixture_navigation';
      await native.resourceAction(() =>
        native.page.goto(new URL('/webmcp-fixture/', native.page.url()).href),
      );
      const api = await native.page.evaluate(async () => {
        await window.__webmcpOwned?.ready;
        const mc = document.modelContext;
        return {
          document_model_context: Boolean(mc),
          get_tools: typeof mc?.getTools === 'function',
          execute_tool: typeof mc?.executeTool === 'function',
          register_tool: typeof mc?.registerTool === 'function',
        };
      });
      report.cases = {
        api,
        fixture: null,
        discovery: null,
        invocation: null,
        negative: null,
        extension_registration: null,
      };
      assert.equal(api.document_model_context, true, 'webmcp_native_api_missing');
      assert.equal(
        api.get_tools && api.execute_tool && api.register_tool,
        true,
        'webmcp_native_methods_missing',
      );
      report.stage = 'fixture_native_registration';
      await native.page.waitForFunction(
        async () => {
          const tools = await document.modelContext.getTools();
          return tools.filter((tool) => tool.name === 'matrx.list_open_tabs').length === 1;
        },
        null,
        { timeout: 10000 },
      );
      const catalog = await native.page.evaluate(async (name) => {
        const tools = await document.modelContext.getTools();
        return {
          count: tools.length,
          fixtureCount: tools.filter((tool) => tool.name === name).length,
          extensionCount: tools.filter((tool) => tool.name === 'matrx.list_open_tabs').length,
        };
      }, fixtureName);
      report.cases.fixture = { registered_once: catalog.fixtureCount === 1 };
      assert.equal(
        report.cases.fixture.registered_once,
        true,
        'webmcp_fixture_registration_missing',
      );
      await native.activatePanel();
      await click(native.panel, 'title', 'Tools');
      await waitFor(
        'webmcp_tools_catalog',
        () => toolsCatalogState(native.panel),
        (v) => v === 'catalog',
      );
      await pointer(
        native.panel,
        `[...(${toolsPane}?.querySelectorAll('button[role="combobox"]')??[])].filter((el)=>el.textContent.trim().startsWith('Agent surface ('))`,
        'surface_filter',
      );
      await pointer(
        native.panel,
        `[...document.querySelectorAll('[role="option"]')].filter((el)=>el.textContent.trim().startsWith('Internal delegates ('))`,
        'internal_delegates',
      );
      report.stage = 'manual_discovery';
      const check = await native.resourceAction(() =>
        manualRun(native.panel, 'webmcp_check_availability', {}),
      );
      const listed = await native.resourceAction(() =>
        manualRun(native.panel, 'webmcp_list_page_tools', {}),
      );
      report.cases.discovery = {
        available: check?.available === true,
        count_matches_native:
          check?.tool_count === catalog.count && listed?.count === catalog.count,
        fixture_present: listed?.tools?.filter((tool) => tool.name === fixtureName).length === 1,
      };
      report.stage = 'manual_invocation';
      const called = await native.resourceAction(() =>
        manualRun(native.panel, 'webmcp_call_page_tool', {
          name: fixtureName,
          arguments: { nonce },
        }),
      );
      const count = await native.page.locator('#intake-count').textContent();
      report.cases.invocation = {
        nonce_matches:
          called?.ok === true &&
          called?.result?.nonce === nonce &&
          called?.result?.marker === `harbor-dental-intake-${runId}`,
        count_one: called?.result?.count === 1 && count === '1',
      };
      report.stage = 'unknown_name_negative';
      const unknown = await native.resourceAction(() =>
        manualRun(native.panel, 'webmcp_call_page_tool', {
          name: `missing_intake_${runId.replaceAll('-', '_')}`,
          arguments: { nonce },
        }),
      );
      report.cases.negative = {
        unknown_refused:
          unknown?.ok === false &&
          typeof unknown.reason === 'string' &&
          unknown.reason.includes('not found on page'),
        count_unchanged: (await native.page.locator('#intake-count').textContent()) === '1',
      };
      report.stage = 'extension_native_registration';
      const extension = await native.page.evaluate(async () => {
        const tools = await document.modelContext.getTools();
        const matches = tools.filter((tool) => tool.name === 'matrx.list_open_tabs');
        if (matches.length !== 1) return { discovered_once: false, read_invoked: false };
        try {
          const result = await document.modelContext.executeTool(matches[0], {
            all_windows: false,
            url: new URL('/webmcp-fixture/*', location.href).href,
          });
          return {
            discovered_once: true,
            read_invoked:
              result?.count === 1 &&
              Array.isArray(result?.tabs) &&
              result.tabs.length === 1 &&
              result.tabs[0]?.url === location.href,
          };
        } catch {
          return { discovered_once: true, read_invoked: false };
        }
      });
      report.cases.extension_registration = extension;
      report.status = requireWebmcpNativeCases(report.cases);
    },
  });
}

try {
  await main();
} catch (error) {
  report.failure_code =
    typeof error?.message === 'string' && /^webmcp_[a-z_]+/.test(error.message)
      ? error.message.split(':')[0]
      : 'webmcp_native_acceptance_failed';
  process.exitCode = 1;
} finally {
  await mkdir(join(REPO, 'test-results'), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}
