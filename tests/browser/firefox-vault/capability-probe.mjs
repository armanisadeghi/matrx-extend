import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { lstat, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const firefox = '/Users/armanisadeghi/Library/Caches/matrx-vault-test/firefox-156.0/Firefox.app/Contents/MacOS/firefox';
const geckodriver = '/Users/armanisadeghi/Library/Caches/matrx-vault-test/firefox-156.0/geckodriver';
const addonId = `matrx-capability-${randomUUID()}@aimatrx.test`;
const runId = randomUUID();
const outputRoot = new URL(`../../../.matrx/task1-active/firefox-sidebar-probe/capability-runs/${runId}/`, import.meta.url).pathname;
const proofPath = join(outputRoot, 'proof.json');
const proof = {
  schema: 1,
  runId,
  scope: 'Firefox 156 disposable WebExtension document and sidebar capability probe',
  credentialsRead: false,
  authenticationAttempted: false,
  vaultActivityAttempted: false,
  nativeOsInputUsed: false,
  userBrowserUsed: false,
  ok: false,
};
const sha256 = value => createHash('sha256').update(value).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const safeError = error => {
  const name = String(error?.name || 'Error').replace(/[^a-z0-9]+/gi, '_').toLowerCase().slice(0, 40);
  const message = String(error?.message || 'unknown').toLowerCase();
  const category = /documentids|unexpected|unknown.*propert|invalid.*target/.test(message)
    ? 'document_ids_rejected'
    : /permission|not allowed|denied/.test(message)
      ? 'permission_denied'
      : /no tab|invalid tab/.test(message)
        ? 'tab_missing'
        : 'other';
  return { name, category };
};
async function openPort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}
async function startFixture() {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
    if (request.url === '/child') response.end('<!doctype html><title>Child</title><main>child</main>');
    else response.end('<!doctype html><title>Top</title><main>top</main><iframe src="/child"></iframe>');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    url: `http://127.0.0.1:${address.port}/top`,
    originPattern: 'http://127.0.0.1/*',
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}
async function request(base, method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    ...(body !== undefined && { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.value?.error) throw new Error('webdriver_request_failed');
  return data.value;
}
const post = (base, path, body) => request(base, 'POST', path, body);
const get = (base, path) => request(base, 'GET', path);
const del = (base, path) => request(base, 'DELETE', path);
async function waitUntil(operation, code, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const value = await operation();
    if (value) return value;
    await delay(100);
  } while (Date.now() < deadline);
  throw new Error(code);
}
async function pidsContaining(fragment) {
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,command=']);
  return stdout.split('\n').flatMap(line => {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    return match && match[2].includes(fragment) ? [Number(match[1])] : [];
  });
}
async function pidGone(pid) {
  try { process.kill(pid, 0); return false; }
  catch (error) { if (error?.code === 'ESRCH') return true; throw error; }
}
async function exists(path) {
  try { await lstat(path); return true; }
  catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

await mkdir(outputRoot, { recursive: true, mode: 0o700 });
const workRoot = await mkdtemp(join(tmpdir(), 'matrx-firefox-capability-'));
const extensionRoot = join(workRoot, 'extension');
const xpi = join(workRoot, 'probe.xpi');
await mkdir(extensionRoot, { mode: 0o700 });
const fixture = await startFixture();
const manifest = {
  manifest_version: 3,
  name: 'Matrx disposable Firefox capability probe',
  version: '1.0.0',
  permissions: ['storage', 'tabs', 'scripting', 'webNavigation'],
  host_permissions: [fixture.originPattern],
  background: { scripts: ['background.js'] },
  content_scripts: [{ matches: [fixture.originPattern], js: ['content.js'], all_frames: true, run_at: 'document_idle' }],
  sidebar_action: { default_panel: 'sidebar.html', default_title: 'Capability probe' },
  browser_specific_settings: { gecko: { id: addonId, strict_min_version: '156.0' } },
};
const background = `
const senders = [];
let sessionProbe = null;
browser.runtime.onMessage.addListener((message, sender) => {
  if (message?.kind === 'sender-probe') {
    senders.push({
      frameId: sender.frameId,
      url: sender.url,
      documentId: sender.documentId,
      hasDocumentId: typeof sender.documentId === 'string' && sender.documentId.length > 0,
      tabId: sender.tab?.id ?? null,
    });
    return Promise.resolve({ ok: true });
  }
  if (message?.kind === 'session-probe') { sessionProbe = message.result; return Promise.resolve({ ok: true }); }
  if (message?.kind === 'get-senders') return Promise.resolve({ senders, sessionProbe });
  if (message?.kind === 'sidebar-ping') return Promise.resolve({ ok: true, frameUrl: location.href });
});`;
const content = `
browser.runtime.sendMessage({ kind: 'sender-probe' }).catch(() => undefined);
(async () => {
  const sessionPresent = !!browser.storage?.session;
  let contentReadable = false;
  try { await browser.storage.session.get('__matrx_probe_missing__'); contentReadable = true; } catch {}
  browser.runtime.sendMessage({ kind: 'session-probe', result: { sessionPresent, contentReadable } }).catch(() => undefined);
})();
browser.runtime.onMessage.addListener(message => message?.kind === 'sidebar-ping'
  ? Promise.resolve({ ok: true, hrefMatches: location.protocol === 'http:' })
  : undefined);`;
const sidebar = '<!doctype html><meta charset="utf-8"><title>Probe sidebar</title><script type="module" src="sidebar.js"></script><main>probe</main>';
const sidebarScript = `
const result = { queryActive: false, getTab: false, sendMessage: false, error: null };
try {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  result.queryActive = tabs.length === 1 && Number.isInteger(tabs[0].id);
  if (result.queryActive) {
    const tab = await browser.tabs.get(tabs[0].id);
    result.getTab = tab.id === tabs[0].id;
    const reply = await browser.tabs.sendMessage(tab.id, { kind: 'sidebar-ping' }, { frameId: 0 });
    result.sendMessage = reply?.ok === true && reply.hrefMatches === true;
  }
} catch (error) { result.error = { name: error?.name || 'Error' }; }
await browser.storage.local.set({ sidebarResult: result });`;
const probePage = '<!doctype html><meta charset="utf-8"><title>Probe controller</title><main>controller</main>';
await Promise.all([
  writeFile(join(extensionRoot, 'manifest.json'), JSON.stringify(manifest)),
  writeFile(join(extensionRoot, 'background.js'), background),
  writeFile(join(extensionRoot, 'content.js'), content),
  writeFile(join(extensionRoot, 'sidebar.html'), sidebar),
  writeFile(join(extensionRoot, 'sidebar.js'), sidebarScript),
  writeFile(join(extensionRoot, 'probe.html'), probePage),
]);
await execFileAsync('zip', ['-q', '-r', xpi, '.'], { cwd: extensionRoot });
proof.hashes = {
  manifestSha256: sha256(await readFile(join(extensionRoot, 'manifest.json'))),
  xpiSha256: sha256(await readFile(xpi)),
};

const driverPort = await openPort();
const base = `http://127.0.0.1:${driverPort}`;
const driver = spawn(geckodriver, ['--allow-system-access', '--port', String(driverPort)], { stdio: 'ignore' });
const ownedPids = new Set([driver.pid]);
let sessionId;
let profile;
let addonInstalled = false;
let failure;
try {
  await waitUntil(async () => {
    if (driver.exitCode !== null) throw new Error('geckodriver_exited');
    try { return (await fetch(`${base}/status`)).ok; } catch { return false; }
  }, 'geckodriver_timeout');
  const created = await post(base, '/session', { capabilities: { alwaysMatch: {
    browserName: 'firefox',
    'moz:firefoxOptions': { binary: firefox, args: ['-headless'] },
  } } });
  sessionId = created.sessionId;
  profile = created.capabilities?.['moz:profile'];
  assert.equal(created.capabilities?.browserVersion, '156.0');
  assert.ok(typeof profile === 'string' && profile.length > 10);
  for (const pid of await pidsContaining(profile)) ownedPids.add(pid);
  await post(base, `/session/${sessionId}/moz/context`, { context: 'chrome' });
  assert.equal(await post(base, `/session/${sessionId}/moz/addon/install`, { path: xpi, temporary: true }), addonId);
  addonInstalled = true;
  const executeChrome = (script, args = []) => post(base, `/session/${sessionId}/execute/sync`, { script, args });
  const extensionBase = await waitUntil(async () => executeChrome(`
    const policy = WebExtensionPolicy.getByID(arguments[0]);
    return policy ? policy.getURL('') : null;`, [addonId]), 'extension_policy_timeout');
  await post(base, `/session/${sessionId}/moz/context`, { context: 'content' });
  await post(base, `/session/${sessionId}/url`, { url: fixture.url });
  await waitUntil(async () => {
    const frames = await get(base, `/session/${sessionId}/window/handles`).catch(() => []);
    return frames.length > 0;
  }, 'fixture_window_timeout');
  await delay(500);
  await post(base, `/session/${sessionId}/moz/context`, { context: 'chrome' });
  const sidebarReady = await post(base, `/session/${sessionId}/execute/async`, { script: `
    const done = arguments[arguments.length - 1];
    const win = Services.wm.getMostRecentWindow('navigator:browser');
    const found = [...win.SidebarController.sidebars.entries()].find(([, item]) => item.extensionId === arguments[0]);
    if (!found) { done(false); return; }
    win.SidebarController.show(found[0]).then(() => {
      let attempts = 0;
      const inspect = () => {
        const panel = win.SidebarController.browser?.contentDocument?.getElementById('webext-panels-browser');
        if (panel?.currentURI?.spec?.endsWith('/sidebar.html')) { win.setTimeout(() => done(true), 500); return; }
        if (++attempts < 100) { win.setTimeout(inspect, 50); return; }
        done(false);
      };
      inspect();
    }, () => done(false));`, args: [addonId] });
  assert.equal(sidebarReady, true);
  await post(base, `/session/${sessionId}/moz/context`, { context: 'content' });
  const controllerHandle = (await post(base, `/session/${sessionId}/window/new`, { type: 'tab' })).handle;
  await post(base, `/session/${sessionId}/window`, { handle: controllerHandle });
  await post(base, `/session/${sessionId}/url`, { url: `${extensionBase}probe.html` });
  const result = await post(base, `/session/${sessionId}/execute/async`, { script: `
    const done = arguments[arguments.length - 1];
    (async () => {
      const tabs = await browser.tabs.query({});
      const tab = tabs.find(candidate => candidate.url === arguments[0]);
      if (!tab?.id) throw new Error('fixture_tab_missing');
      const senderState = await browser.runtime.sendMessage({ kind: 'get-senders' });
      const senders = senderState.senders;
      const topSender = senders.find(sender => sender.tabId === tab.id && sender.frameId === 0);
      const childSender = senders.find(sender => sender.tabId === tab.id && sender.frameId > 0);
      const allFrames = await browser.webNavigation.getAllFrames({ tabId: tab.id });
      const topFrame = await browser.webNavigation.getFrame({ tabId: tab.id, frameId: 0 });
      let executeDocumentIds = { accepted: false, resultDocumentIdPresent: false, exactDocumentMatched: false, error: null };
      try {
        const injected = await browser.scripting.executeScript({
          target: { tabId: tab.id, documentIds: [topSender?.documentId] },
          func: () => ({ href: location.href }),
        });
        executeDocumentIds.accepted = Array.isArray(injected) && injected.length === 1;
        executeDocumentIds.resultDocumentIdPresent = typeof injected?.[0]?.documentId === 'string';
        executeDocumentIds.exactDocumentMatched = injected?.[0]?.documentId === topSender?.documentId
          && injected?.[0]?.result?.href === arguments[0];
      } catch (error) {
        const message = String(error?.message || '').toLowerCase();
        executeDocumentIds.error = {
          name: String(error?.name || 'Error').replace(/[^a-z0-9]+/gi, '_').toLowerCase().slice(0, 40),
          category: /documentids|unexpected|unknown.*propert|invalid.*target/.test(message)
            ? 'document_ids_rejected'
            : /permission|not allowed|denied/.test(message) ? 'permission_denied' : 'other',
        };
      }
      const sidebarResult = await (async () => {
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const found = (await browser.storage.local.get('sidebarResult')).sidebarResult;
          if (found) return found;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        return null;
      })();
      return {
        tabId: tab.id,
        sender: {
          topPresent: !!topSender,
          childPresent: !!childSender,
          topDocumentIdPresent: topSender?.hasDocumentId === true,
          childDocumentIdPresent: childSender?.hasDocumentId === true,
          distinctDocumentIds: typeof topSender?.documentId === 'string' && typeof childSender?.documentId === 'string'
            && topSender.documentId !== childSender.documentId,
        },
        webNavigation: {
          getFrameReturned: !!topFrame,
          getFrameDocumentIdPresent: typeof topFrame?.documentId === 'string',
          getAllFramesCount: allFrames?.length ?? null,
          getAllFramesEveryDocumentId: Array.isArray(allFrames) && allFrames.length >= 2
            && allFrames.every(frame => typeof frame.documentId === 'string' && frame.documentId.length > 0),
          senderMatchesTopFrame: topFrame?.documentId === topSender?.documentId,
          senderIdsFoundInAllFrames: [topSender, childSender].every(sender => allFrames.some(frame => frame.frameId === sender?.frameId && frame.documentId === sender?.documentId)),
        },
        scripting: executeDocumentIds,
        sidebarTabs: sidebarResult,
        storageSession: {
          setAccessLevelType: typeof browser.storage?.session?.setAccessLevel,
          sessionPresent: senderState.sessionProbe?.sessionPresent === true,
          contentReadable: senderState.sessionProbe?.contentReadable === true,
        },
      };
    })().then(done, error => done({ fatal: { name: error?.name || 'Error' } }));`, args: [fixture.url] });
  assert.equal(result.fatal, undefined);
  proof.runtime = { firefoxVersion: created.capabilities.browserVersion };
  proof.sender = result.sender;
  proof.webNavigation = result.webNavigation;
  proof.scripting = result.scripting;
  proof.sidebarTabs = result.sidebarTabs;
  proof.storageSession = result.storageSession;
  proof.ok = result.sender.topDocumentIdPresent && result.sender.childDocumentIdPresent
    && result.webNavigation.getFrameDocumentIdPresent && result.webNavigation.getAllFramesEveryDocumentId
    && result.webNavigation.senderMatchesTopFrame && result.webNavigation.senderIdsFoundInAllFrames
    && result.scripting.accepted && result.scripting.exactDocumentMatched
    && result.sidebarTabs?.queryActive && result.sidebarTabs?.getTab && result.sidebarTabs?.sendMessage
    && result.storageSession?.sessionPresent === true;
} catch (error) {
  failure = error;
  proof.error = safeError(error);
} finally {
  if (profile) for (const pid of await pidsContaining(profile).catch(() => [])) ownedPids.add(pid);
  if (addonInstalled && sessionId) {
    try { await post(base, `/session/${sessionId}/moz/context`, { context: 'chrome' }); await post(base, `/session/${sessionId}/moz/addon/uninstall`, { id: addonId }); proof.addonUninstalled = true; }
    catch { proof.addonUninstalled = false; }
  }
  if (sessionId) {
    try { await del(base, `/session/${sessionId}`); proof.sessionDeleted = true; sessionId = undefined; }
    catch { proof.sessionDeleted = false; }
  }
  if (driver.exitCode === null) {
    driver.kill('SIGTERM');
    const deadline = Date.now() + 5_000;
    while (driver.exitCode === null && Date.now() < deadline) await delay(100);
    if (driver.exitCode === null) driver.kill('SIGKILL');
    while (driver.exitCode === null && Date.now() < deadline + 5_000) await delay(100);
  }
  proof.driverExited = driver.exitCode !== null;
  try { await fixture.close(); proof.fixtureServerClosed = true; } catch { proof.fixtureServerClosed = false; }
  if (profile) {
    const remaining = await pidsContaining(profile).catch(() => []);
    for (const pid of remaining) ownedPids.add(pid);
    for (const pid of remaining) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    await waitUntil(async () => (await Promise.all(remaining.map(pidGone))).every(Boolean), 'owned_firefox_cleanup_timeout').catch(() => false);
    await rm(profile, { recursive: true, force: true });
  }
  await rm(workRoot, { recursive: true, force: true });
  proof.profileRemoved = !profile || !(await exists(profile));
  proof.allOwnedPidsGone = (await Promise.all([...ownedPids].map(pidGone))).every(Boolean);
  proof.temporaryFilesRemoved = true;
  proof.ok = proof.ok && !failure && proof.addonUninstalled && proof.sessionDeleted && proof.driverExited
    && proof.fixtureServerClosed && proof.profileRemoved && proof.allOwnedPidsGone;
  await writeFile(proofPath, `${JSON.stringify(proof, null, 2)}\n`, { mode: 0o600 });
}

console.log(proofPath);
if (!proof.ok) process.exitCode = 1;
