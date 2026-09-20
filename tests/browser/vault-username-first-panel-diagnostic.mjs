/* Isolated CFT diagnostic for production host/DOM logic. Chrome runtime, panel
 * transport, API, and auth boundaries are stubbed; this is not extension-panel proof. */
import http from 'node:http';
import { createRequire } from 'node:module';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '../../node_modules/.pnpm/esbuild@0.27.7/node_modules/esbuild/lib/main.js';

const require = createRequire(import.meta.url);
const { chromium } = require('/Users/armanisadeghi/code/matrx-frontend/node_modules/.pnpm/playwright@1.63.0/node_modules/playwright');
const { renderSavedFormMatrixHTML } = require('./vault-saved-form-matrix.cjs');
const root = new URL('../..', import.meta.url).pathname;
const stubs = {
  '@/lib/api/routes/vault': `
    export async function hasRealUserToken(){ return true }
    export async function fetchBrowserLoginMatches(){ return {ok:true,data:{count:1,matches:[{item_id:'00000000-0000-4000-8000-000000000001',display_name:'Fixture',available_fields:[{field_key:'username',fillable:true}]}]}} }
    export async function materializeBrowserLogin(_id, request){ globalThis.__panelDiag.materialize=request; return {ok:true,data:{origin:location.origin,fields:{username:'fixture-user'}}} }
  `,
  '@/lib/auth/flow': `export async function getCurrentUser(){ return {id:'user-1'} }`,
  '@/lib/credentials/assistance-status': `export function setSavedLoginAssistance(){}`,
  '@/lib/credentials/sensitive-fields': `export const SENSITIVE_ATTR='data-matrx-sensitive'; export function rememberSensitiveFields(){}`,
  '@/lib/messaging/schemas': `export const CHANNELS={AUTH_STATE_CHANGED:'auth-state:changed',CREDENTIAL_SUGGESTIONS_PANEL_STATUS:'credential-suggestions:panel-status',CREDENTIAL_SUGGESTIONS_PANEL_FILL:'credential-suggestions:panel-fill',CREDENTIAL_SUGGESTIONS_FOCUS_OWNER:'credential-suggestions:focus-owner',CREDENTIAL_SUGGESTIONS_QUERY:'credential-suggestions:query',CREDENTIAL_SUGGESTIONS_FILL:'credential-suggestions:fill',CREDENTIAL_SUGGESTIONS_OPEN_VAULT:'credential-suggestions:open-vault',CREDENTIAL_SUGGESTIONS_CONTEXT_CHANGED:'credential-suggestions:context-changed'}`,
  '@/lib/org/active-org': `export async function getActiveOrganizationId(){ return 'org-1' }`,
  '@/lib/panel/adapter': `export const hasFirefoxSidebarAction=()=>false; export const openPanel=()=>({promise:Promise.resolve()}); export const panelOpenRemedy=(x)=>x`,
  '@/lib/settings/persisted': `export async function readOfferSavedLoginsEnabled(){ return true }`,
};
const wrapper = `
  import { registerInlineCredentialSuggestionHost } from '@/lib/credentials/inline-suggestions-host';
  import { mountGenerationTargetRegistry } from '@/lib/credentials/generation-targets';
  globalThis.__panelDiag={materialize:null,boot(){mountGenerationTargetRegistry();registerInlineCredentialSuggestionHost()}};
`;
const bundle = await build({
  stdin: { contents: wrapper, resolveDir: root, sourcefile: 'username-first-panel-entry.ts', loader: 'ts' },
  bundle: true, format: 'iife', write: false,
  plugins: [{ name: 'diagnostic-stubs', setup(plugin) {
    plugin.onResolve({ filter: /^@\// }, (args) => stubs[args.path]
      ? { path: args.path, namespace: 'stub' }
      : { path: `${root}/src/${args.path.slice(2)}.ts` });
    plugin.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: stubs[args.path], loader: 'ts' }));
  }}],
});
const server = http.createServer((_request, response) => response.end(renderSavedFormMatrixHTML('username_first')));
const chromePath = '/Users/armanisadeghi/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
let profile = null;
let context = null;
let result;
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  profile = await mkdtemp(join(tmpdir(), 'matrx-username-first-panel-'));
  context = await chromium.launchPersistentContext(profile, { executablePath: chromePath, headless: true });
  const page = await context.newPage();
  await page.goto(`${origin}/login`);
  await page.evaluate(() => {
    const listeners = [];
    const invoke = (message, sender) => new Promise((resolve) => {
      for (const listener of listeners) if (listener(message, sender, resolve)) return;
      resolve(undefined);
    });
    globalThis.__panelInvoke = invoke;
    globalThis.chrome = {
      runtime: { id: 'fixture-extension', getManifest: () => ({ version: 'fixture' }), getURL: (path) => `chrome-extension://fixture-extension/${path}`, onMessage: { addListener: (listener) => listeners.push(listener) } },
      scripting: { executeScript: async ({ func, args }) => [{ result: func(...(args ?? [])) }] },
      tabs: { get: async () => ({ id: 7, windowId: 1, active: true }), sendMessage: async () => undefined, onRemoved: { addListener() {} }, onUpdated: { addListener() {} }, onActivated: { addListener() {} } },
      webNavigation: { getFrame: async () => ({ documentId: 'doc-1', url: location.href, parentFrameId: -1 }) },
      permissions: { contains: async () => true }, storage: { onChanged: { addListener() {} } },
    };
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  result = await page.evaluate(async () => {
    globalThis.__panelDiag.boot();
    const sender = { tab: { id: 7 }, frameId: 0, documentId: 'doc-1' };
    await globalThis.__panelInvoke({ __matrx: true, kind: 'credential-suggestions:focus-owner', payload: { stamp: 1, sequence: 1 } }, sender);
    const input = document.querySelector('#username'); input.focus();
    const id = globalThis.__matrx_generation_target_registry__.registerInput(input);
    await new Promise((resolve) => setTimeout(resolve, 6200));
    const query = await globalThis.__panelInvoke({ __matrx: true, kind: 'credential-suggestions:query', payload: { field: { kind: 'registered_input', id } }, }, sender);
    const fill = await globalThis.__panelInvoke({ __matrx: true, kind: 'credential-suggestions:panel-fill', payload: { tabId: 7, offerId: query.offerId, itemId: '00000000-0000-4000-8000-000000000001' } }, { id: 'fixture-extension', url: 'chrome-extension://fixture-extension/sidepanel.html' });
    return { query: query?.status ?? null, fill: fill?.status ?? null, value: input.value, fieldKeys: globalThis.__panelDiag.materialize?.fieldKeys ?? null, visible: document.visibilityState, focused: document.hasFocus(), active: document.activeElement === input };
  });
  if (JSON.stringify(result) !== JSON.stringify({ query: 'ready', fill: 'filled', value: 'fixture-user', fieldKeys: ['username'], visible: 'visible', focused: true, active: true }))
    throw new Error(`username_first_panel_diagnostic_failed:${JSON.stringify(result)}`);
} finally {
  if (context) await context.close();
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  if (profile) await rm(profile, { recursive: true, force: true });
}
let profileRemoved = false;
try { await access(profile); } catch { profileRemoved = true; }
if (!profileRemoved) throw new Error('username_first_panel_profile_cleanup_failed');
process.stdout.write(`${JSON.stringify({ ok: true, scope: 'production-host-dom-diagnostic', auth: 'stubbed', vault: 'none', profileRemoved, serverClosed: !server.listening, ...result })}\n`);
