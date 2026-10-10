#!/usr/bin/env node
/** EXT-D-0147 diagnostic only. A measured run gives no product acceptance credit. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { verifyFrozenArtifactIdentity } from '../../scripts/frozen-artifact-identity.mjs';
import { requireLocalDevReceipt } from '../../scripts/record-local-dev-build.mjs';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { requireProductionBackendOrigin } from './member-logical-org-proof.mjs';
import { observeNativeAiDelegatedResult } from './native-ai-delegated-observer.mjs';
import {
  nativeAiAttribution,
  requireNativeAiProbeEvidence,
  safeRealmProbe,
} from './native-ai-probe-verdict.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { signInSettings } from './settings-native-auth-driver.mjs';
import { click, evaluate, toolsCatalogState, waitFor } from './settings-panel-driver.mjs';

const REPO = resolve(import.meta.dirname, '../..');
const OUTPUT = join(REPO, 'test-results', 'native-ai-member-probe.json');
const EXTENSION_DIR = process.env.MATRX_NATIVE_AI_EXTENSION_DIR;
const RECEIPT = process.env.MATRX_NATIVE_AI_RECEIPT;
const CONTROL_TEXT =
  'The Northline Furnishings order desk received three chairs on Tuesday. The desk checked the order and scheduled delivery for Friday.';
const report = {
  schema_version: 1,
  defect_id: 'EXT-D-0147',
  scope:
    'diagnostic: member native AI manual catalog versus delegated canonical ai; warm and full reload',
  status: 'unverified',
  product_acceptance_credit: false,
  stage: 'inputs',
  artifact: null,
  authentication: null,
  cycles: [],
  failure_code: null,
};

async function realmProbe(session) {
  const response = await session.send('Runtime.evaluate', {
    expression: `(async () => {
      const capabilities = {};
      for (const key of ['LanguageModel','Summarizer','Translator','LanguageDetector','Proofreader','Writer','Rewriter']) {
        const api = globalThis[key];
        let availability = 'unavailable';
        if (api) {
          if (typeof api.availability !== 'function') availability = 'method-missing';
          else {
            try {
              const result = key === 'Translator'
                ? await api.availability({sourceLanguage:'en',targetLanguage:'es'})
                : await api.availability();
              availability = typeof result === 'string' ? result : 'probe-error';
            } catch { availability = 'probe-error'; }
          }
        }
        capabilities[key] = {present: Boolean(api), availability};
      }
      return {
        is_document: typeof document !== 'undefined',
        user_activation_active: navigator.userActivation?.isActive === true,
        user_activation_has_been_active: navigator.userActivation?.hasBeenActive === true,
        capabilities,
      };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) throw new Error('native_ai_realm_evaluation_failed');
  const safe = safeRealmProbe(response.result?.value);
  assert.ok(safe, 'native_ai_realm_probe_missing');
  return safe;
}

async function attachLiveWorker(browserSession, extensionId) {
  const targets = (await browserSession.send('Target.getTargets')).targetInfos.filter(
    (target) =>
      target.type === 'service_worker' &&
      target.url.startsWith(`chrome-extension://${extensionId}/`),
  );
  assert.equal(targets.length, 1, 'native_ai_unique_worker_required');
  const { sessionId } = await browserSession.send('Target.attachToTarget', {
    targetId: targets[0].targetId,
    flatten: true,
  });
  return {
    async send(method, params = {}) {
      return browserSession.send(method, params, sessionId);
    },
    on(method, listener) {
      const scoped = (params, eventSessionId) => {
        if (eventSessionId === sessionId) listener(params);
      };
      browserSession.on(method, scoped);
      return () => browserSession.off(method, scoped);
    },
    async detach() {
      await browserSession.send('Target.detachFromTarget', { sessionId }).catch(() => {});
    },
  };
}

async function offscreenProbe(browserSession, extensionId) {
  const targets = (await browserSession.send('Target.getTargets')).targetInfos.filter(
    (target) => target.url === `chrome-extension://${extensionId}/offscreen.html`,
  );
  if (targets.length === 0) return { target_present: false, realm: null };
  assert.equal(targets.length, 1, 'native_ai_unique_offscreen_required');
  const { sessionId } = await browserSession.send('Target.attachToTarget', {
    targetId: targets[0].targetId,
    flatten: true,
  });
  try {
    return {
      target_present: true,
      realm: await realmProbe({
        send: (method, params) => browserSession.send(method, params, sessionId),
      }),
    };
  } finally {
    await browserSession.send('Target.detachFromTarget', { sessionId });
  }
}

async function pointer(panel, expression, label) {
  const sample = await evaluate(
    panel,
    `(() => {
    const candidates = ${expression};
    const visible = candidates.filter((el) => {
      const r=el.getBoundingClientRect(),s=getComputedStyle(el);
      return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&!el.closest('[inert]');
    });
    if(candidates.length!==1||visible.length!==1) return {count:candidates.length,visible:visible.length,hit:false};
    visible[0].scrollIntoView({block:'center',inline:'center',behavior:'instant'});
    const r=visible[0].getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
    const hit=document.elementFromPoint(x,y);
    return {count:1,visible:1,hit:Boolean(hit&&(hit===visible[0]||visible[0].contains(hit))),x,y};
  })()`,
  );
  assert.equal(sample?.count, 1, `native_ai_${label}_unique_required`);
  assert.equal(sample?.hit, true, `native_ai_${label}_hit_required`);
  await panel.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sample.x, y: sample.y });
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: sample.x,
    y: sample.y,
    button: 'left',
    clickCount: 1,
  });
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: sample.x,
    y: sample.y,
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

async function manualRun(panel, name, args) {
  await inputText(
    panel,
    `[...(${toolsPane}?.querySelectorAll('input[placeholder="Search by name or description…"]')??[])]`,
    name,
    'search',
  );
  await waitFor('native_ai_tool_row', () => evaluate(panel, `Boolean(${toolCard(name)})`), Boolean);
  await click(panel, 'tool-row', name);
  const card = toolCard(name);
  await waitFor(
    'native_ai_manual_form',
    () => evaluate(panel, `(${card})?.querySelectorAll('textarea').length??0`),
    (n) => n === 1,
  );
  await inputText(
    panel,
    `[...(${card}?.querySelectorAll('textarea')??[])]`,
    JSON.stringify(args),
    'arguments',
  );
  const visibleArgs = await evaluate(panel, `(${card})?.querySelector('textarea')?.value??null`);
  assert.equal(visibleArgs, JSON.stringify(args), 'native_ai_manual_arguments_not_visible');
  await pointer(
    panel,
    `[...(${card}?.querySelectorAll('button')??[])].filter((el)=>el.textContent.trim()==='Run'&&!el.disabled)`,
    'run',
  );
  const text = await waitFor(
    'native_ai_manual_result',
    () =>
      evaluate(
        panel,
        `(() => {
      const labels=[...(${card}?.querySelectorAll('div')??[])]
        .filter((el)=>el.children.length===0&&el.textContent.trim()==='output');
      return labels.length===1?labels[0].parentElement?.nextElementSibling?.querySelector('pre')?.textContent??null:null;
    })()`,
      ),
    (value) => typeof value === 'string' && value.length > 0,
  );
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('native_ai_manual_result_not_json');
  }
  return {
    observed: true,
    tool_name: name,
    any_available: parsed?.any_available === true,
    summarizer_available: parsed?.report?.summarizer === 'available',
    ok: parsed?.ok === true,
    unavailable: parsed?.ok === false && parsed?.availability === 'unavailable',
    availability: ['available', 'downloadable', 'downloading', 'unavailable'].includes(
      parsed?.availability,
    )
      ? parsed.availability
      : null,
  };
}

async function manualCycle(panel) {
  await click(panel, 'title', 'Tools');
  await waitFor(
    'native_ai_tools_catalog',
    () => toolsCatalogState(panel),
    (value) => value === 'catalog',
  );
  await pointer(
    panel,
    `[...(${toolsPane}?.querySelectorAll('button[role="combobox"]')??[])].filter((el)=>el.textContent.trim().startsWith('Agent surface ('))`,
    'surface_filter',
  );
  await pointer(
    panel,
    `[...document.querySelectorAll('[role="option"]')].filter((el)=>el.textContent.trim().startsWith('Internal delegates ('))`,
    'internal_delegates',
  );
  const availability = await manualRun(panel, 'ai_check_availability', {});
  const summarize = await manualRun(panel, 'ai_summarize', { text: CONTROL_TEXT });
  return { availability, summarize };
}

async function startControlledDelegationProbe(panel) {
  const installed = await evaluate(
    panel,
    `(() => {
    if (globalThis.__nativeAiControlledDelegation) return false;
    const calls=[];
    const listener=(message) => {
      if (message?.__matrx !== true || message.kind !== 'tool:timeline-event') return;
      const event=message.payload;
      if (event?.phase === 'started' && event.toolName === 'ai' &&
          event.args?.action === 'summarize' && event.args?.text === ${JSON.stringify(CONTROL_TEXT)} &&
          typeof event.callId === 'string') calls.push(event.callId);
    };
    chrome.runtime.onMessage.addListener(listener);
    globalThis.__nativeAiControlledDelegation={calls,stop:()=>chrome.runtime.onMessage.removeListener(listener)};
    return true;
  })()`,
  );
  assert.equal(installed, true, 'native_ai_controlled_delegation_listener_missing');
  return async () => {
    await evaluate(
      panel,
      `(() => {
      globalThis.__nativeAiControlledDelegation?.stop();
      delete globalThis.__nativeAiControlledDelegation;
      return true;
    })()`,
    );
  };
}

async function delegatedCycle(panel, worker) {
  await worker.send('Network.enable');
  const serverOrigin = await requireProductionBackendOrigin(panel);
  const observer = observeNativeAiDelegatedResult(worker, serverOrigin);
  let stopControlledProbe = async () => {};
  try {
    stopControlledProbe = await startControlledDelegationProbe(panel);
    await click(panel, 'title', 'Chat');
    await click(panel, 'title', 'New chat');
    const chat = `(() => {
      const tab=[...document.querySelectorAll('button[role="tab"][title="Chat"]')]
        .find((el)=>el.getAttribute('data-state')==='active');
      return tab?document.getElementById(tab.getAttribute('aria-controls')):null;
    })()`;
    await waitFor(
      'native_ai_chat_composer',
      () => evaluate(panel, `Boolean(${chat}?.querySelector('textarea'))`),
      Boolean,
      30000,
    );
    const baselineReplyCount = await evaluate(
      panel,
      `${chat}?.querySelectorAll('button[title="Copy reply"]').length??0`,
    );
    const prompt = `Use the canonical ai tool with action summarize on this exact text, then report whether the local tool succeeded: ${CONTROL_TEXT}`;
    await inputText(
      panel,
      `[...(${chat}?.querySelectorAll('textarea')??[])]`,
      prompt,
      'chat_composer',
    );
    await waitFor(
      'native_ai_chat_send_ready',
      () =>
        evaluate(panel, `Boolean(${chat}?.querySelector('button[title="Send"]:not([disabled])'))`),
      Boolean,
    );
    observer.arm();
    await click(panel, 'active-chat-send', 'Send');
    const calls = await waitFor(
      'native_ai_controlled_delegation',
      () => evaluate(panel, 'globalThis.__nativeAiControlledDelegation?.calls??[]'),
      (value) => Array.isArray(value) && value.length === 1,
      120000,
      (value) => ({ count: Array.isArray(value) ? value.length : 0 }),
    );
    observer.expectCallId(calls[0]);
    const observation = await waitFor(
      'native_ai_delegated_result',
      () => observer.read(),
      (value) => value.posted,
      120000,
      (value) => ({
        observed: value?.posted,
        canonical_ai_tool: value?.canonical_ai_tool,
        http_status: value?.http_status,
      }),
    );
    assert.equal(observation.posted, true, 'native_ai_delegated_post_not_accepted');
    assert.equal(observation.canonical_ai_tool, true, 'native_ai_canonical_delegation_missing');
    const completedReply = await waitFor(
      'native_ai_chat_continuation',
      () =>
        evaluate(
          panel,
          `(() => {
        const pane=${chat};
        return {
          streaming: Boolean(pane?.querySelector('button[title="Stop"]')),
          completed_reply_count: pane?.querySelectorAll('button[title="Copy reply"]').length??0,
        };
      })()`,
        ),
      (value) => value?.streaming === false && value.completed_reply_count > baselineReplyCount,
      90000,
      (value) => value,
    );
    return {
      ...observation,
      controlled_action_observed: true,
      completed_reply_observed: completedReply.completed_reply_count > baselineReplyCount,
    };
  } finally {
    await stopControlledProbe().catch(() => {});
    observer.stop();
  }
}

async function cycle(label, panel, native, extensionId) {
  report.stage = `${label}_realm_probe`;
  const worker = await attachLiveWorker(native.browserSession, extensionId);
  try {
    const realms = {
      panel: await realmProbe(panel),
      worker: await realmProbe(worker),
      offscreen: await offscreenProbe(native.browserSession, extensionId),
    };
    report.stage = `${label}_manual`;
    const manual = await native.resourceAction(() => manualCycle(panel));
    report.stage = `${label}_delegated`;
    const delegated = await native.resourceAction(() => delegatedCycle(panel, worker));
    const attribution = nativeAiAttribution(
      realms.panel,
      realms.worker,
      manual.summarize,
      delegated,
    );
    assert.notEqual(attribution, 'realm_probe_incomplete');
    return { label, realms, manual, delegated, attribution };
  } finally {
    await worker.detach();
  }
}

async function main() {
  assert.ok(EXTENSION_DIR && RECEIPT, 'native_ai_artifact_inputs_missing');
  assert.match(
    process.env.MATRX_NATIVE_AI_SOURCE_SHA ?? '',
    /^[a-f0-9]{40}$/,
    'native_ai_source_missing',
  );
  assert.match(
    process.env.MATRX_NATIVE_AI_CI_RUN_ID ?? '',
    /^[1-9][0-9]*$/,
    'native_ai_ci_run_missing',
  );
  assert.match(
    process.env.MATRX_NATIVE_AI_CI_ARTIFACT_ID ?? '',
    /^[1-9][0-9]*$/,
    'native_ai_ci_artifact_missing',
  );
  const receipt = JSON.parse(await readFile(RECEIPT, 'utf8'));
  const manifest = JSON.parse(await readFile(join(EXTENSION_DIR, 'manifest.json'), 'utf8'));
  requireLocalDevReceipt(receipt, EXTENSION_DIR);
  verifyFrozenArtifactIdentity({ extensionDir: EXTENSION_DIR, manifest, receipt });
  assert.equal(
    hashReleaseTree(EXTENSION_DIR),
    receipt.treeSha256,
    'native_ai_artifact_tree_mismatch',
  );
  report.artifact = {
    source_sha: process.env.MATRX_NATIVE_AI_SOURCE_SHA,
    ci_run_id: Number(process.env.MATRX_NATIVE_AI_CI_RUN_ID),
    ci_artifact_id: Number(process.env.MATRX_NATIVE_AI_CI_ARTIFACT_ID),
    tree_sha256: receipt.treeSha256,
    version: receipt.version,
  };
  await runNativeSidepanelQa({
    headed: true,
    extensionDir: EXTENSION_DIR,
    localDevReceiptPath: RECEIPT,
    expectedRelease: receipt,
    artifactRoot: join(process.env.RUNNER_TEMP ?? REPO, 'guest-acceptance'),
    onStage: (value) => {
      report.native_stage = value;
    },
    exercisePanel: async (native) => {
      let panel = native.panel;
      report.stage = 'member_auth';
      await native.requireResourceHealth();
      const identity = await native.resourceAction(() =>
        signInSettings({
          mode: 'member',
          page: native.page,
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
        member_signed_in: identity.web_signed_in === true && identity.extension_signed_in === true,
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
        'native_ai_member_identity_unverified',
      );
      await native.activatePanel();
      const extensionId = await evaluate(panel, 'location.host');
      assert.match(extensionId ?? '', /^[a-p]{32}$/, 'native_ai_extension_identity_missing');
      report.cycles.push(await cycle('warm', panel, native, extensionId));
      report.stage = 'full_extension_reload';
      const reload = await native.reloadExtension();
      assert.equal(reload.management_reload_clicked, true, 'native_ai_extension_reload_missing');
      assert.equal(reload.worker_replaced, true, 'native_ai_worker_not_replaced');
      assert.equal(reload.panel_replaced, true, 'native_ai_panel_not_replaced');
      report.reload = {
        management_reload_clicked: reload.management_reload_clicked,
        worker_replaced: reload.worker_replaced,
        panel_replaced: reload.panel_replaced,
      };
      panel = reload.panel;
      try {
        report.cycles.push(await cycle('post_reload', panel, native, extensionId));
      } finally {
        await panel.detach();
      }
      requireNativeAiProbeEvidence(report);
    },
  });
  report.status = requireNativeAiProbeEvidence(report);
}

try {
  await main();
} catch (error) {
  report.failure_code =
    typeof error?.message === 'string' && /^native_ai_/.test(error.message.split(':')[0])
      ? error.message.split(':')[0]
      : 'native_ai_probe_failed';
  process.exitCode = 1;
} finally {
  await mkdir(join(REPO, 'test-results'), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`NATIVE_AI_PROBE ${report.status} ${report.stage} ${report.failure_code ?? 'none'}`);
}
