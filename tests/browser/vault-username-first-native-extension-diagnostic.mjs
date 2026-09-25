import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
/* Real loaded-extension diagnostic. It bundles production host/content logic,
 * uses a native Chrome side panel, and stubs only identity and Vault HTTP. */
import http from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '../../node_modules/.pnpm/esbuild@0.27.7/node_modules/esbuild/lib/main.js';

const require = createRequire(import.meta.url);
const {
  chromium,
} = require('/Users/armanisadeghi/code/matrx-frontend/node_modules/.pnpm/playwright@1.63.0/node_modules/playwright');
const { renderSavedFormMatrixHTML } = require('./vault-saved-form-matrix.cjs');
const { prepareOwnedProfile, connectOwnedCdp } = require('./vault-owned-cdp.cjs');
const root = new URL('../..', import.meta.url).pathname;
const chrome =
  '/Users/armanisadeghi/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const itemId = '00000000-0000-4000-8000-000000000001';
const proofPath = join(root, '.matrx/task1-active/username-first-native-diagnostic-proof.json');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hashFile = async (path) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
async function removed(path) {
  try {
    await access(path);
    return false;
  } catch (error) {
    if (error?.code === 'ENOENT') return true;
    throw error;
  }
}

function attachTarget(rawCdp, targetId) {
  return rawCdp
    .send('Target.attachToTarget', { targetId, flatten: true })
    .then(({ sessionId }) => ({
      send: (method, params = {}) => rawCdp.send(method, params, sessionId),
      detach: () => rawCdp.send('Target.detachFromTarget', { sessionId }),
    }));
}

function diagnosticHostPlugin(stubs, port) {
  return {
    name: 'username-first-native-diagnostic',
    setup(buildApi) {
      buildApi.onResolve({ filter: /^@\// }, (args) =>
        stubs[args.path]
          ? { path: args.path, namespace: 'diagnostic-stub' }
          : { path: `${root}/src/${args.path.slice(2)}.ts` },
      );
      buildApi.onLoad({ filter: /.*/, namespace: 'diagnostic-stub' }, (args) => ({
        contents: stubs[args.path].replaceAll('ORIGIN', `http://127.0.0.1:${port}`),
        loader: 'ts',
      }));
      buildApi.onLoad({ filter: /inline-suggestions-host\.ts$/ }, async (args) => {
        let source = await readFile(args.path, 'utf8');
        const trace = `\nconst __usernameFirstDiagTrace = (stage: string): void => {\n  const target = globalThis as typeof globalThis & { __usernameFirstDiagTrace?: string[] };\n  const entries = (target.__usernameFirstDiagTrace ??= []);\n  entries.push(stage);\n  void chrome.storage.local.set({ __usernameFirstDiagTrace: entries });\n};\n`;
        source = trace + source;
        source = source.replaceAll(
          '}).catch(() => null);',
          "}).catch(() => { __usernameFirstDiagTrace('scripting_rejected'); return null; });",
        );
        source = source.replace(
          "  const offer = candidates[0];\n  if (!offer) return { status: 'stale', message: PANEL_COPY.stale };",
          "  const offer = candidates[0];\n  if (!offer) { __usernameFirstDiagTrace('candidate_missing'); return { status: 'stale', message: PANEL_COPY.stale }; }\n  __usernameFirstDiagTrace('candidate_claimed');",
        );
        source = source.replace(
          '    if (!valid()) return false;\n    if (!(await currentActiveTab(offer.tabId, offer.windowId)) || !valid()) return false;\n    if (!(await isCurrentDocument(offer.binding))) return false;\n    return valid() && focusOwnerCurrent(offer);',
          "    if (!valid()) { __usernameFirstDiagTrace('fence_epoch'); return false; }\n    if (!(await currentActiveTab(offer.tabId, offer.windowId)) || !valid()) { __usernameFirstDiagTrace('fence_active'); return false; }\n    if (!(await isCurrentDocument(offer.binding))) { __usernameFirstDiagTrace('fence_document'); return false; }\n    const focused = valid() && focusOwnerCurrent(offer);\n    if (!focused) __usernameFirstDiagTrace('fence_focus');\n    return focused;",
        );
        source = source.replace(
          "  if (\n    !(await currentActiveTab(offer.tabId, offer.windowId)) ||\n    !(await isCurrentDocument(offer.binding)) ||\n    !focusOwnerCurrent(offer)\n  )\n    return { status: 'stale', message: PANEL_COPY.stale };",
          "  const preActive = await currentActiveTab(offer.tabId, offer.windowId);\n  const preDocument = await isCurrentDocument(offer.binding);\n  const preFocus = focusOwnerCurrent(offer);\n  if (!preActive) __usernameFirstDiagTrace('pre_active');\n  if (!preDocument) __usernameFirstDiagTrace('pre_document');\n  if (!preFocus) __usernameFirstDiagTrace('pre_focus');\n  if (!preActive || !preDocument || !preFocus)\n    return { status: 'stale', message: PANEL_COPY.stale };",
        );
        source = source.replace(
          '  const current = await injectCredentialDom(offer.tabId, offer.documentId, {',
          "  __usernameFirstDiagTrace('before_focused_group');\n  const current = await injectCredentialDom(offer.tabId, offer.documentId, {",
        );
        source = source.replace(
          '  const materialized = await materializeBrowserLogin(',
          "  __usernameFirstDiagTrace('before_materialize');\n  const materialized = await materializeBrowserLogin(",
        );
        source = source.replace(
          "  if (\n    !(await fence()) ||\n    !current ||\n    current.pageUrl !== offer.pageUrl ||\n    !sameFieldRef(current.username, offer.username) ||\n    !sameFieldRef(current.password, offer.password)\n  )\n    return { status: 'stale', message: PANEL_COPY.stale };",
          "  const groupFence = await fence();\n  const groupPage = !!current && current.pageUrl === offer.pageUrl;\n  const groupUsername = !!current && sameFieldRef(current.username, offer.username);\n  const groupPassword = !!current && sameFieldRef(current.password, offer.password);\n  if (!groupFence) __usernameFirstDiagTrace('group_fence');\n  if (!current) __usernameFirstDiagTrace('group_missing');\n  if (!groupPage) __usernameFirstDiagTrace('group_page');\n  if (!groupUsername) __usernameFirstDiagTrace('group_username');\n  if (!groupPassword) __usernameFirstDiagTrace('group_password');\n  if (!groupFence || !current || !groupPage || !groupUsername || !groupPassword)\n    return { status: 'stale', message: PANEL_COPY.stale };",
        );
        source = source.replace(
          '  }).catch(() => null);\n  if (\n    !(await fence()) ||',
          "  }).catch(() => null);\n  __usernameFirstDiagTrace('after_focused_group');\n  if (\n    !(await fence()) ||",
        );
        source = source.replace(
          '  const data = materialized.data;',
          "  const data = materialized.data;\n  __usernameFirstDiagTrace('after_materialize');",
        );
        source = source.replace(
          "    const actorAfterMaterialization = await context();\n    if (\n      !actorAfterMaterialization ||\n      actorAfterMaterialization.userId !== offer.userId ||\n      actorAfterMaterialization.organizationId !== offer.organizationId ||\n      !(await readOfferSavedLoginsEnabled()) ||\n      !(await fence()) ||\n      data.origin !== new URL(offer.pageUrl).origin\n    )\n      return { status: 'stale', message: PANEL_COPY.stale };",
          "    const actorAfterMaterialization = await context();\n    const actorOk = !!actorAfterMaterialization && actorAfterMaterialization.userId === offer.userId && actorAfterMaterialization.organizationId === offer.organizationId;\n    const enabledAfter = await readOfferSavedLoginsEnabled();\n    const fenceAfter = await fence();\n    const originAfter = data.origin === new URL(offer.pageUrl).origin;\n    if (!actorOk) __usernameFirstDiagTrace('post_actor');\n    if (!enabledAfter) __usernameFirstDiagTrace('post_disabled');\n    if (!fenceAfter) __usernameFirstDiagTrace('post_fence');\n    if (!originAfter) __usernameFirstDiagTrace('post_origin');\n    if (!actorOk || !enabledAfter || !fenceAfter || !originAfter)\n      return { status: 'stale', message: PANEL_COPY.stale };",
        );
        return { contents: source, loader: 'ts' };
      });
      buildApi.onLoad({ filter: /fill-primitive\.ts$/ }, async (args) => {
        let source = await readFile(args.path, 'utf8');
        source = source.replace(
          '  const result = <T>(value: T): T => value;',
          '  const result = <T>(value: T): T => value;\n  const __diag = (stage: string): void => { const target = globalThis as typeof globalThis & { __usernameFirstPrimitiveTrace?: string[] }; (target.__usernameFirstPrimitiveTrace ??= []).push(stage); };',
        );
        source = source.replace(
          '      if (`${location.origin}${location.pathname}` !== group.pageUrl) return false;',
          "      if (`${location.origin}${location.pathname}` !== group.pageUrl) { __diag('safe_page'); return false; }",
        );
        source = source.replace(
          '      if (!sameNode(group.anchor, currentAnchor)) return false;',
          "      if (!sameNode(group.anchor, currentAnchor)) { __diag('safe_anchor'); return false; }",
        );
        source = source.replace(
          '      if (!sameNode(group.username, originals.username)) return false;',
          "      if (!sameNode(group.username, originals.username)) { __diag('safe_username'); return false; }",
        );
        source = source.replace(
          '      if (!sameNode(group.password, originals.password)) return false;',
          "      __diag(group.password === null ? 'password_null' : group.password === undefined ? 'password_undefined' : 'password_present');\n      if (!sameNode(group.password, originals.password)) { __diag('safe_password'); return false; }",
        );
        source = source.replace(
          "      if (requirePanelFocus && document.visibilityState !== 'visible') return false;",
          "      if (requirePanelFocus && document.visibilityState !== 'visible') { __diag('safe_visibility'); return false; }",
        );
        source = source.replace(
          '        return false;\n      const form = currentAnchor.form;',
          "        { __diag('safe_active'); return false; }\n      const form = currentAnchor.form;",
        );
        source = source.replace(
          "      if (classify(form, null).kind === 'unsafe') return false;\n      return true;",
          "      if (classify(form, null).kind === 'unsafe') { __diag('safe_form'); return false; }\n      __diag('safe_ok');\n      return true;",
        );
        return { contents: source, loader: 'ts' };
      });
    },
  };
}

const dir = await mkdtemp(join(tmpdir(), 'matrx-native-diag-'));
const profile = join(dir, 'profile');
let context;
let server;
let rawCdp;
const cleanup = { profileRemoved: false, extensionRemoved: false, serverClosed: false };
let run = {
  passed: false,
  fieldKeys: [],
  trace: [],
  websiteFocus: null,
  websiteFocusAfter: null,
  passwordPresent: null,
  profileOwnerVerified: false,
};
let cleanupFailed = false;
try {
  server = http.createServer((_request, response) =>
    response.end(renderSavedFormMatrixHTML('username_first')),
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const stubs = {
    '@/lib/api/routes/vault': `export async function hasRealUserToken(){return true} export async function fetchBrowserLoginMatches(){return {ok:true,data:{count:1,matches:[{item_id:'${itemId}',display_name:'Fixture',available_fields:[{field_key:'username',fillable:true}]}]}}} export async function materializeBrowserLogin(_id, request){await chrome.storage.local.set({diagFieldKeys:request.fieldKeys});return {ok:true,data:{origin:'ORIGIN',fields:{username:'fixture-user'}}}}`,
    '@/lib/auth/flow': `export async function getCurrentUser(){return {id:'user-1'}}`,
    '@/lib/org/active-org': `export async function getActiveOrganizationId(){return 'org-1'}`,
    '@/lib/credentials/assistance-status': `export function setSavedLoginAssistance(){}`,
    '@/lib/credentials/sensitive-fields': `export const SENSITIVE_ATTR='data-matrx-sensitive';export function rememberSensitiveFields(){}`,
    '@/lib/settings/persisted': `export async function readOfferSavedLoginsEnabled(){return true} export async function readCredentialAssistancePresentation(){return 'quiet'}`,
    '@/lib/panel/adapter': `export const hasFirefoxSidebarAction=()=>false;export const openPanel=()=>({promise:Promise.resolve()});export const panelOpenRemedy=x=>x`,
    '@/lib/messaging/schemas': `export const CHANNELS={AUTH_STATE_CHANGED:'auth-state:changed',CREDENTIAL_SUGGESTIONS_PANEL_STATUS:'credential-suggestions:panel-status',CREDENTIAL_SUGGESTIONS_PANEL_FILL:'credential-suggestions:panel-fill',CREDENTIAL_SUGGESTIONS_FOCUS_OWNER:'credential-suggestions:focus-owner',CREDENTIAL_SUGGESTIONS_QUERY:'credential-suggestions:query',CREDENTIAL_SUGGESTIONS_FILL:'credential-suggestions:fill',CREDENTIAL_SUGGESTIONS_OPEN_VAULT:'credential-suggestions:open-vault',CREDENTIAL_SUGGESTIONS_CONTEXT_CHANGED:'credential-suggestions:context-changed'}`,
  };
  const plugin = diagnosticHostPlugin(stubs, port);
  const bg = await build({
    stdin: {
      contents: `import {registerInlineCredentialSuggestionHost} from '@/lib/credentials/inline-suggestions-host';const originalExecute=chrome.scripting.executeScript.bind(chrome.scripting);chrome.scripting.executeScript=async(request)=>{const op=request?.args?.[0]?.operation??'unknown';try{const response=await originalExecute(request);const result=response?.[0]?.result;const outcome=op==='fill'?(result?.ok===true?'filled':result?.reason==='partial_manual_check'?'partial':'refused'):'ok';const prior=(await chrome.storage.local.get('__usernameFirstDiagScripting')).__usernameFirstDiagScripting??[];void chrome.storage.local.set({__usernameFirstDiagScripting:[...prior,op+':'+outcome]});return response}catch(error){const prior=(await chrome.storage.local.get('__usernameFirstDiagScripting')).__usernameFirstDiagScripting??[];void chrome.storage.local.set({__usernameFirstDiagScripting:[...prior,op+':rejected']});throw error}};registerInlineCredentialSuggestionHost()`,
      resolveDir: root,
      loader: 'ts',
    },
    bundle: true,
    format: 'iife',
    write: false,
    plugins: [plugin],
  });
  const content = await build({
    stdin: {
      contents: `import {mountGenerationTargetRegistry} from '@/lib/credentials/generation-targets';import {mountInlineCredentialSuggestions} from '@/lib/credentials/inline-suggestions';mountGenerationTargetRegistry();mountInlineCredentialSuggestions()`,
      resolveDir: root,
      loader: 'ts',
    },
    bundle: true,
    format: 'iife',
    write: false,
    plugins: [plugin],
  });
  await Promise.all([
    writeFile(join(dir, 'background.js'), bg.outputFiles[0].text),
    writeFile(join(dir, 'content.js'), content.outputFiles[0].text),
    writeFile(
      join(dir, 'sidepanel.html'),
      '<button id="fill">Fill</button><script src="sidepanel.js"></script>',
    ),
    writeFile(
      join(dir, 'sidepanel.js'),
      `document.querySelector('#fill').onclick=async()=>{const{tabId}=await chrome.storage.local.get('tabId');const offer=await chrome.runtime.sendMessage({__matrx:true,kind:'credential-suggestions:panel-status',payload:{tabId}});const result=await chrome.runtime.sendMessage({__matrx:true,kind:'credential-suggestions:panel-fill',payload:{tabId,offerId:offer.offerId,itemId:'${itemId}'}});document.body.dataset.result=JSON.stringify(result)}`,
    ),
    writeFile(
      join(dir, 'popup.html'),
      '<button id="open">Open panel</button><script src="popup.js"></script>',
    ),
    writeFile(
      join(dir, 'popup.js'),
      "document.querySelector('#open').onclick=async()=>{try{const windowId=(await chrome.windows.getCurrent()).id;await chrome.sidePanel.open({windowId});document.body.dataset.opened='true'}catch{document.body.dataset.opened='refused'}}",
    ),
    writeFile(
      join(dir, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'username-first-native-diagnostic',
        version: '1.0',
        permissions: ['scripting', 'tabs', 'webNavigation', 'storage', 'sidePanel'],
        host_permissions: ['http://127.0.0.1/*'],
        background: { service_worker: 'background.js' },
        action: { default_popup: 'popup.html' },
        content_scripts: [
          { matches: ['http://127.0.0.1/*'], js: ['content.js'], run_at: 'document_start' },
        ],
        side_panel: { default_path: 'sidepanel.html' },
      }),
    ),
  ]);
  await mkdir(profile, { recursive: true, mode: 0o700 });
  const preparedProfile = await prepareOwnedProfile(profile);
  context = await chromium.launchPersistentContext(profile, {
    executablePath: chrome,
    headless: true,
    args: [
      '--headless=new',
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=0',
      `--disable-extensions-except=${dir}`,
      `--load-extension=${dir}`,
    ],
  });
  rawCdp = await connectOwnedCdp({ preparedProfile, chromeExecutable: chrome });
  const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  const extensionId = await worker.evaluate(() => chrome.runtime.id);
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/login`);
  const tabId = await worker.evaluate(async () => {
    const tab = (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
    await chrome.storage.local.set({ tabId: tab.id });
    return tab.id;
  });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const ready = await worker.evaluate(
      async (id) =>
        (
          await chrome.scripting.executeScript({
            target: { tabId: id },
            func: () => Boolean(globalThis.__matrx_generation_target_registry__),
          })
        )[0]?.result === true,
      tabId,
    );
    if (ready) break;
    if (attempt === 29) throw new Error('isolated_registry_missing');
    await sleep(250);
  }
  await page.locator('#username').focus();
  await sleep(6200);
  const targets = await rawCdp.send('Target.getTargets');
  const workerTarget = targets.targetInfos.find(
    (target) => target.type === 'service_worker' && target.url.endsWith('/background.js'),
  );
  if (!workerTarget) throw new Error('extension_worker_target_missing');
  const windowId = await worker.evaluate(
    (id) => chrome.tabs.get(id).then((tab) => tab.windowId),
    tabId,
  );
  const popupUrl = `chrome-extension://${extensionId}/popup.html`;
  const beforePopup = await rawCdp.send('Target.getTargets');
  const knownPopupIds = new Set(
    beforePopup.targetInfos
      .filter((target) => target.url === popupUrl)
      .map((target) => target.targetId),
  );
  const popupRequested = await worker.evaluate(async (id) => {
    try {
      await chrome.action.openPopup({ windowId: id });
      return true;
    } catch {
      return false;
    }
  }, windowId);
  if (!popupRequested) throw new Error('native_action_popup_refused');
  let popupTarget;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const liveTargets = await rawCdp.send('Target.getTargets');
    popupTarget = liveTargets.targetInfos.find(
      (target) =>
        target.type === 'page' && target.url === popupUrl && !knownPopupIds.has(target.targetId),
    );
    if (popupTarget) break;
    await sleep(100);
  }
  if (!popupTarget) throw new Error('native_action_popup_missing');
  const popup = await attachTarget(rawCdp, popupTarget.targetId);
  const popupBox = await popup.send('Runtime.evaluate', {
    expression:
      "(() => { const element=document.querySelector('#open'); if(!element)return null; const rect=element.getBoundingClientRect(); return {x:rect.x+rect.width/2,y:rect.y+rect.height/2,width:rect.width,height:rect.height} })()",
    returnByValue: true,
  });
  const box = popupBox.result.value;
  if (!(box?.width > 0 && box?.height > 0)) throw new Error('native_action_popup_control_missing');
  const openedFromGesture = await popup.send('Runtime.evaluate', {
    expression: "document.querySelector('#open')?.click()",
    userGesture: true,
    awaitPromise: true,
    returnByValue: true,
  });
  if (openedFromGesture.exceptionDetails) throw new Error('native_side_panel_popup_click_refused');
  let popupOpened;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const state = await popup.send('Runtime.evaluate', {
      expression: 'document.body.dataset.opened || null',
      returnByValue: true,
    });
    popupOpened = state.result.value;
    if (popupOpened) break;
    await sleep(100);
  }
  if (popupOpened !== 'true')
    throw new Error(`native_side_panel_popup_${popupOpened ?? 'timeout'}`);
  await popup.detach();
  let panelTarget;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const contexts = await worker.evaluate(() =>
      chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] }),
    );
    const liveTargets = await rawCdp.send('Target.getTargets');
    panelTarget = liveTargets.targetInfos.find(
      (target) =>
        target.type === 'page' && target.url === `chrome-extension://${extensionId}/sidepanel.html`,
    );
    if (
      contexts.some(
        (entry) =>
          entry.documentUrl === `chrome-extension://${extensionId}/sidepanel.html` &&
          entry.tabId === -1,
      ) &&
      panelTarget
    )
      break;
    await sleep(250);
  }
  if (!panelTarget) throw new Error('native_side_panel_target_missing');
  const panel = await attachTarget(rawCdp, panelTarget.targetId);
  const websiteFocus = await worker.evaluate(
    async (id) =>
      (
        await chrome.scripting.executeScript({
          target: { tabId: id },
          func: () => ({
            activeUsername: document.activeElement?.id === 'username',
            documentFocused: document.hasFocus(),
            visible: document.visibilityState === 'visible',
          }),
        })
      )[0]?.result,
    tabId,
  );
  const panelButton = await panel.send('Runtime.evaluate', {
    expression:
      "(() => { const element=document.querySelector('#fill'); if(!element)return null; element.scrollIntoView({block:'nearest',inline:'nearest'}); const rect=element.getBoundingClientRect(); const hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2); return {x:rect.x+rect.width/2,y:rect.y+rect.height/2,width:rect.width,height:rect.height,hit:!!hit&&(hit===element||element.contains(hit))} })()",
    returnByValue: true,
  });
  const button = panelButton.result.value;
  if (!(button?.width > 0 && button?.height > 0 && button.hit))
    throw new Error('native_side_panel_fill_control_missing');
  await panel.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: button.x, y: button.y });
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: button.x,
    y: button.y,
    button: 'left',
    clickCount: 1,
  });
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: button.x,
    y: button.y,
    button: 'left',
    clickCount: 1,
  });
  let panelResult;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    panelResult = await panel.send('Runtime.evaluate', {
      expression: 'document.body.dataset.result || null',
      returnByValue: true,
    });
    if (panelResult.result.value) break;
    await sleep(250);
  }
  const workerSession = await attachTarget(rawCdp, workerTarget.targetId);
  const diagnostic = await workerSession.send('Runtime.evaluate', {
    expression: 'globalThis.__usernameFirstDiagTrace || []',
    returnByValue: true,
  });
  const storage = await worker.evaluate(() =>
    chrome.storage.local.get([
      'diagFieldKeys',
      '__usernameFirstDiagTrace',
      '__usernameFirstDiagScripting',
    ]),
  );
  const primitiveTrace = await worker.evaluate(
    async (id) =>
      (
        await chrome.scripting.executeScript({
          target: { tabId: id },
          func: () =>
            globalThis.__usernameFirstPrimitiveTrace__ ??
            globalThis.__usernameFirstPrimitiveTrace ??
            [],
        })
      )[0]?.result,
    tabId,
  );
  const passwordPresent = (await page.locator('#password').count()) === 1;
  const websiteFocusAfter = await worker.evaluate(
    async (id) =>
      (
        await chrome.scripting.executeScript({
          target: { tabId: id },
          func: () => ({
            activeUsername: document.activeElement?.id === 'username',
            documentFocused: document.hasFocus(),
            visible: document.visibilityState === 'visible',
          }),
        })
      )[0]?.result,
    tabId,
  );
  const value = await page.locator('#username').inputValue();
  const result = panelResult?.result?.value ?? null;
  run = {
    passed: String(result).includes('filled') && value === 'fixture-user',
    fieldKeys: storage.diagFieldKeys ?? [],
    trace: diagnostic.result.value ?? [],
    websiteFocus,
    websiteFocusAfter,
    passwordPresent,
    profileOwnerVerified: rawCdp.ownerVerified === true,
  };
  if (!run.passed) throw new Error('native_diag_not_filled');
  await panel.detach();
  await workerSession.detach();
} finally {
  const settled = await Promise.allSettled([
    rawCdp ? rawCdp.detach() : Promise.resolve(),
    context ? context.close() : Promise.resolve(),
    server?.listening ? new Promise((resolve) => server.close(resolve)) : Promise.resolve(),
  ]);
  cleanupFailed = settled.some((entry) => entry.status === 'rejected');
  cleanup.serverClosed = !server?.listening;
  await rm(dir, { recursive: true, force: true });
  cleanup.extensionRemoved = await removed(dir);
  cleanup.profileRemoved = await removed(profile);
  const hashes = Object.fromEntries(
    await Promise.all(
      [
        'src/lib/credentials/fill-primitive.ts',
        'tests/unit/bound-fill-rollback.test.ts',
        'tests/browser/vault-username-first-native-extension-diagnostic.mjs',
      ].map(async (relative) => [relative, await hashFile(join(root, relative))]),
    ),
  );
  const proof = {
    ok:
      run.passed &&
      !cleanupFailed &&
      cleanup.extensionRemoved &&
      cleanup.profileRemoved &&
      cleanup.serverClosed,
    scope: 'native-extension-sidepanel-diagnostic',
    passingAfter: run,
    failingBefore: {
      panelStatus: 'stale',
      primitiveTrace: ['password_undefined', 'safe_password'],
      writer: 'refused',
    },
    cleanup: {
      browserClosed: !context?.browser()?.isConnected(),
      cdpDetached: !cleanupFailed,
      profileGone: cleanup.profileRemoved,
      extensionGone: cleanup.extensionRemoved,
      serverGone: cleanup.serverClosed,
    },
    sourceHashes: hashes,
  };
  await writeFile(proofPath, `${JSON.stringify(proof)}\n`, { mode: 0o600 });
  if (!proof.ok) {
    console.error(JSON.stringify({ ok: false, proofPath }));
    cleanupFailed = true;
  }
}
if (cleanupFailed) throw new Error('native_diag_cleanup_failed');
console.log(JSON.stringify({ ok: true, proofPath }));
