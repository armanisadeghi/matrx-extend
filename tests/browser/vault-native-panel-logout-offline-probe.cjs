'use strict';

const fs = require('node:fs/promises');
const syncFs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { prepareOwnedProfile, connectOwnedCdp } = require('./vault-owned-cdp.cjs');
const { observePanelResponse } = require('./vault-lifecycle-network-observation.cjs');
const playwrightRequire = createRequire('/Users/armanisadeghi/code/matrx-frontend/package.json');
const { chromium } = playwrightRequire('playwright');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

async function attachPanelSession(cdp, targetId) {
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: false });
  let nextId = 0;
  const pending = new Map();
  const listeners = new Set();
  const received = ({ sessionId: source, message }) => {
    if (source !== sessionId) return;
    let envelope; try { envelope = JSON.parse(message); } catch { return; }
    const waiter = pending.get(envelope.id);
    if (!waiter) {
      if (typeof envelope.method === 'string') for (const listener of listeners) listener(envelope.method, envelope.params ?? {});
      return;
    }
    pending.delete(envelope.id); clearTimeout(waiter.timer);
    envelope.error ? waiter.reject(new Error('native_panel_protocol_refused')) : waiter.resolve(envelope.result);
  };
  cdp.on('Target.receivedMessageFromTarget', received);
  return {
    onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    send(method, params = {}) { return new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('native_panel_protocol_timeout')); }, 10000);
      pending.set(id, { resolve, reject, timer });
      cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }).catch((error) => { clearTimeout(timer); pending.delete(id); reject(error); });
    }); },
    dispose() { cdp.off('Target.receivedMessageFromTarget', received); listeners.clear(); },
  };
}

(async () => {
  const manifestPath = process.env.MATRX_VAULT_CANARY_MANIFEST;
  const executablePath = process.env.MATRX_VAULT_CANARY_CHROME_EXECUTABLE;
  if (!path.isAbsolute(manifestPath || '') || !/Google Chrome for Testing\.app\/Contents\/MacOS\/Google Chrome for Testing$/.test(executablePath || ''))
    throw new Error('native_panel_offline_probe_configuration_missing');
  const manifestRaw = await fs.readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestRaw);
  const extension = path.join(path.dirname(manifestPath), manifest.extensionDirectory);
  if (manifest.schema !== 2 || !syncFs.statSync(extension).isDirectory()) throw new Error('native_panel_offline_probe_artifact_refused');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matrx-native-panel-logout-'));
  const profile = path.join(root, 'profile');
  await fs.mkdir(profile, { mode: 0o700 });
  let server; let context; let cdp; let panel; let stop;
  let succeeded = false;
  const proof = { kind: 'native_panel_logout_offline_probe', authenticationAttempted: false, vaultMutationRequests: 0, localPost204: false, rawRequestObserved: false, rawResponseObserved: false, cleanup: {} };
  try {
    let extensionId = null;
    server = http.createServer((request, response) => {
      if (request.url === '/probe' && request.method === 'POST') {
        proof.localPost204 = true;
        response.writeHead(204, { 'access-control-allow-origin': `chrome-extension://${extensionId}` }).end();
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(`<!doctype html><button id="open">Open native panel</button><script>document.querySelector('#open').addEventListener('click',()=>chrome.runtime.sendMessage(${JSON.stringify(extensionId)}, {channel:'FRONTEND_RPC',action:'openPanel',payload:{panelId:'capture'},requestId:'offline-native'},()=>{}));</script>`);
    });
    await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', (error) => error ? reject(error) : resolve()));
    const port = server.address().port;
    const preparedProfile = await prepareOwnedProfile(profile);
    context = await chromium.launchPersistentContext(profile, { headless: true, executablePath, args: ['--headless=new', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    cdp = await connectOwnedCdp({ preparedProfile, chromeExecutable: executablePath });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
    extensionId = await worker.evaluate(() => chrome.runtime.id);
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.locator('#open').click();
    const panelUrl = `chrome-extension://${extensionId}/sidepanel.html`;
    let target;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      target = (await cdp.send('Target.getTargets')).targetInfos.find((entry) => entry.type === 'page' && entry.url === panelUrl);
      if (target) break;
      await wait(100);
    }
    if (!target) throw new Error('native_panel_offline_probe_target_missing');
    panel = await attachPanelSession(cdp, target.targetId);
    await panel.send('Network.enable');
    const endpoint = `http://127.0.0.1:${port}/probe`;
    stop = observePanelResponse({
      panel,
      matchesRequest: (params) => params?.request?.url === endpoint && params?.request?.method === 'POST' && params?.documentURL === panelUrl,
      onResponse: ({ status }) => { proof.rawResponseObserved = status === 204; },
    });
    const onRequest = panel.onEvent((method, params) => {
      if (method === 'Network.requestWillBeSent' && params?.request?.url === endpoint && params?.request?.method === 'POST' && params?.documentURL === panelUrl) proof.rawRequestObserved = true;
    });
    const evaluated = await panel.send('Runtime.evaluate', { expression: `fetch(${JSON.stringify(endpoint)}, {method:'POST', body:''}).then(response => response.status)`, awaitPromise: true, returnByValue: true });
    onRequest();
    if (evaluated.result?.value !== 204 || !proof.localPost204 || !proof.rawRequestObserved || !proof.rawResponseObserved) throw new Error('native_panel_offline_probe_observation_failed');
    proof.artifact = { manifestSha256: sha256(manifestRaw), sourceCommit: manifest.sourceCommit, fileCount: manifest.extensionFiles.length };
    proof.ok = true;
    succeeded = true;
  } finally {
    stop?.(); panel?.dispose();
    try { if (context) await context.close(); proof.cleanup.browserClosed = true; } catch { proof.cleanup.browserClosed = false; }
    try { if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); proof.cleanup.serverClosed = true; } catch { proof.cleanup.serverClosed = false; }
    await fs.rm(root, { recursive: true, force: true });
    proof.cleanup.profileRemoved = !(await fs.lstat(profile).then(() => true, () => false));
    if (cdp) await cdp.detach().catch(() => {});
  }
  if (succeeded) process.stdout.write(`${JSON.stringify(proof)}\n`);
})().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
