import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createFirefoxSidebarAdapter, EXPECTED_RUNTIME } from './adapter.mjs';

const execFileAsync = promisify(execFile);
const harnessPath = fileURLToPath(import.meta.url);
const root = fileURLToPath(new URL('../../../.matrx/task1-active/firefox-sidebar-probe/authenticated-harness/', import.meta.url));
const adapterSourcePath = fileURLToPath(new URL('./adapter.mjs', import.meta.url));
const runId = randomUUID();
const runRoot = join(root, 'adapter-runs', runId);
const proofPath = join(runRoot, 'proof.json');
const firefox = '/Users/armanisadeghi/Library/Caches/matrx-vault-test/firefox-156.0/Firefox.app/Contents/MacOS/firefox';
const geckodriver = '/Users/armanisadeghi/Library/Caches/matrx-vault-test/firefox-156.0/geckodriver';
const xpi = join(root, '..', 'runs', '2026-09-20T21-01-15-432Z', 'extension.xpi');
const addonId = 'matrx-extend@aimatrx.com';
const forbiddenQueryCanary = 'forbidden_query_canary';

const proof = {
  schema: 1,
  runId,
  environment: 'offline_fresh_profile_no_auth_activity',
  resolvedSignedOutUiState: false,
  credentialsRead: false,
  authenticationAttempted: false,
  vaultActivityAttempted: false,
  nativeOsInputUsed: false,
  runtimeAttested: false,
  freshProfileAuthStorageEmpty: false,
  nativeSidebarControllerRoute: false,
  trustedSettingsTransition: false,
  trustedChatRestore: false,
  trustedPortalComboboxPress: false,
  trustedKeyboardComboboxSelection: false,
  unicodeTransportVerified: false,
  knownLocalhostRequestObserved: false,
  metadataOnlyObserver: false,
  observerDisposed: false,
  addonUninstalled: false,
  sessionDeleted: false,
  driverExited: false,
  firefoxExited: false,
  profileRemoved: false,
  localServerClosed: false,
  allOwnedPidsGone: false,
  ok: false,
};

async function exists(path) {
  try { await lstat(path); return true; }
  catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}
async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}
async function openServer() {
  const state = { knownRequests: 0 };
  const server = createServer((request, response) => {
    if (request.url?.startsWith('/known-owned-request') && request.method === 'POST') {
      state.knownRequests += 1;
      request.resume();
      response.writeHead(204).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
    response.end('<!doctype html><title>Owned Firefox adapter probe</title><main>owned</main>');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string', 'local_server_address_missing');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    state,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}
async function openPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string', 'driver_port_missing');
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}
async function post(base, path, body) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok || data.value?.error)
    throw new Error(`webdriver_${String(data.value?.error ?? response.status).replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`);
  return data.value;
}
async function del(base, path) {
  const response = await fetch(`${base}${path}`, { method: 'DELETE' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.value?.error) throw new Error('webdriver_session_delete_failed');
  return data.value;
}
async function waitForDriver(base, driver) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (driver.exitCode !== null) throw new Error('geckodriver_exited_before_ready');
    try { if ((await fetch(`${base}/status`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('geckodriver_ready_timeout');
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
async function waitForPidsGone(pids) {
  const deadline = Date.now() + 15_000;
  while (true) {
    const gone = await Promise.all([...pids].map(pidGone));
    if (gone.every(Boolean)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

await mkdir(runRoot, { recursive: true, mode: 0o700 });
const [adapterSha256, harnessSha256, artifactXpiSha256, applicationIni, driverVersion] = await Promise.all([
  sha256(adapterSourcePath),
  sha256(harnessPath),
  sha256(xpi),
  readFile('/Users/armanisadeghi/Library/Caches/matrx-vault-test/firefox-156.0/Firefox.app/Contents/Resources/application.ini', 'utf8'),
  execFileAsync(geckodriver, ['--version']).then(result => result.stdout),
]);
proof.hashes = { adapterSha256, harnessSha256, artifactXpiSha256 };
const hostRuntime = {
  sourceRepository: applicationIni.match(/^SourceRepository=(.+)$/m)?.[1] ?? null,
  sourceStamp: applicationIni.match(/^SourceStamp=(.+)$/m)?.[1] ?? null,
  geckodriverVersion: driverVersion.match(/^geckodriver ([^ ]+)/)?.[1] ?? null,
};
assert.equal(applicationIni.match(/^Version=(.+)$/m)?.[1], EXPECTED_RUNTIME.firefoxVersion, 'firefox_application_version_mismatch');
assert.equal(applicationIni.match(/^BuildID=(.+)$/m)?.[1], EXPECTED_RUNTIME.buildId, 'firefox_application_build_mismatch');

const local = await openServer();
const port = await openPort();
const base = `http://127.0.0.1:${port}`;
const driver = spawn(geckodriver, ['--allow-system-access', '--port', String(port)], { stdio: 'ignore' });
const ownedPids = new Set([driver.pid]);
let sessionId;
let profile;
let observerStarted = false;
let addonInstalled = false;
let failure;
let adapter;

try {
  proof.phase = 'session_create';
  await waitForDriver(base, driver);
  const created = await post(base, '/session', { capabilities: { alwaysMatch: {
    browserName: 'firefox',
    'moz:firefoxOptions': {
      binary: firefox,
      args: ['-headless'],
      prefs: { 'network.manage-offline-status': false, 'network.offline': true },
    },
  } } });
  sessionId = created.sessionId;
  profile = created.capabilities?.['moz:profile'];
  assert.ok(typeof profile === 'string' && profile.length > 10, 'owned_profile_missing');
  assert.equal(created.capabilities?.browserVersion, EXPECTED_RUNTIME.firefoxVersion, 'webdriver_firefox_version_mismatch');
  for (const pid of await pidsContaining(profile)) ownedPids.add(pid);
  assert.equal(await post(base, `/session/${sessionId}/moz/context`, { context: 'chrome' }), null);
  const executeChromeSync = (script, args = []) => post(base, `/session/${sessionId}/execute/sync`, { script, args });
  const executeChromeAsync = (script, args = []) => post(base, `/session/${sessionId}/execute/async`, { script, args });
  const performKeyboardActions = async keys => {
    assert.ok(keys.length === 1 && ['\uE011', '\uE015', '\uE007'].includes(keys[0]), 'keyboard_action_sequence_not_reviewed');
    const actions = [];
    for (const value of keys) {
      actions.push({ type: 'keyDown', value }, { type: 'keyUp', value });
    }
    await post(base, `/session/${sessionId}/actions`, {
      actions: [{ type: 'key', id: 'matrx-keyboard', actions }],
    });
    await del(base, `/session/${sessionId}/actions`);
  };
  adapter = createFirefoxSidebarAdapter({ executeChromeSync, executeChromeAsync, performKeyboardActions, addonId });
  proof.runtime = await adapter.attestRuntime(hostRuntime);
  proof.runtimeAttested = true;

  proof.phase = 'addon_install';
  assert.equal(await post(base, `/session/${sessionId}/moz/addon/install`, { path: xpi, temporary: true }), addonId);
  addonInstalled = true;
  await new Promise(resolve => setTimeout(resolve, 350));
  const extensionBase = await executeChromeAsync(`
    const done = arguments[arguments.length - 1];
    const win = Services.wm.getMostRecentWindow('navigator:browser');
    const addonId = arguments[0];
    let attempts = 0;
    const ready = () => {
      const matches = [...win.SidebarController.sidebars.entries()].filter(([, item]) => item.extensionId === addonId);
      if (matches.length !== 1) {
        if (++attempts < 60) { win.setTimeout(ready, 100); return; }
        done(null); return;
      }
      const [sidebarId] = matches[0];
      win.SidebarController.show(sidebarId).then(() => {
        const inspect = () => {
          const panel = win.SidebarController.browser.contentDocument?.getElementById('webext-panels-browser');
          const spec = panel?.currentURI?.spec;
          if (spec?.endsWith('/sidepanel.html')) { done(spec.replace(/sidepanel\\.html$/, '')); return; }
          if (++attempts < 60) { win.setTimeout(inspect, 100); return; }
          done(null);
        };
        inspect();
      }, () => done(null));
    };
    ready();`, [addonId]);
  assert.ok(typeof extensionBase === 'string' && extensionBase.startsWith('moz-extension://'), 'native_sidebar_open_failed');
  proof.nativeSidebarControllerRoute = true;

  proof.phase = 'unicode_remote_transport';
  const unicodeArgument = '· é 😀';
  const unicodeOracle = [183, 32, 233, 32, 128512];
  const unicode = await adapter.evaluate((document, value) => ({
    literalCharCode: '·'.charCodeAt(0),
    literalCodePoint: '·'.codePointAt(0),
    argument: value,
    argumentCodePoints: [...value].map(character => character.codePointAt(0)),
    result: '· é 😀',
  }), [unicodeArgument]);
  proof.unicodeTransport = {
    literalCharCode: unicode?.literalCharCode ?? null,
    literalCodePoint: unicode?.literalCodePoint ?? null,
    argumentRoundTrip: unicode?.argument === unicodeArgument,
    argumentCodePointsMatch: JSON.stringify(unicode?.argumentCodePoints) === JSON.stringify(unicodeOracle),
    resultRoundTrip: unicode?.result === unicodeArgument,
  };
  assert.equal(unicode?.literalCharCode, 183, 'remote_unicode_literal_charcode_mismatch');
  assert.equal(unicode?.literalCodePoint, 183, 'remote_unicode_literal_codepoint_mismatch');
  assert.equal(unicode?.argument, unicodeArgument, 'remote_unicode_argument_roundtrip_mismatch');
  assert.deepEqual(unicode?.argumentCodePoints, unicodeOracle, 'remote_unicode_argument_codepoints_mismatch');
  assert.equal(unicode?.result, unicodeArgument, 'remote_unicode_result_roundtrip_mismatch');
  proof.unicodeTransportVerified = true;

  proof.phase = 'fresh_profile_auth_storage';
  assert.equal(await post(base, `/session/${sessionId}/moz/context`, { context: 'content' }), null);
  await post(base, `/session/${sessionId}/url`, { url: `${extensionBase}options.html` });
  const authStorageEmpty = await post(base, `/session/${sessionId}/execute/async`, { script: `
    const done = arguments[arguments.length - 1];
    const keys = ['matrx.user.profile', 'matrx.auth.accessToken', 'matrx.org.active'];
    const storage = globalThis.browser?.storage ?? globalThis.chrome?.storage;
    storage.local.get(keys).then(found => done(keys.every(key => !(key in found))), () => done(false));`, args: [] });
  assert.equal(authStorageEmpty, true, 'fresh_profile_auth_storage_not_empty');
  proof.freshProfileAuthStorageEmpty = true;
  assert.equal(await post(base, `/session/${sessionId}/moz/context`, { context: 'chrome' }), null);
  await executeChromeAsync(`
    const done = arguments[arguments.length - 1];
    const win = Services.wm.getMostRecentWindow('navigator:browser');
    const [sidebarId] = [...win.SidebarController.sidebars.entries()].find(([, item]) => item.extensionId === arguments[0]) ?? [];
    if (!sidebarId) { done(false); return; }
    win.SidebarController.show(sidebarId).then(done, () => done(false));`, [addonId]);

  proof.phase = 'trusted_sidebar_transition';
  await adapter.waitFor(document => {
    const settings = document.querySelector('button[title="Settings"]');
    const chat = document.querySelector('button[title="Chat"]');
    return !!settings && !!chat && settings.getAttribute('data-state') === 'inactive' && chat.getAttribute('data-state') === 'active';
  });
  const settingsClick = await adapter.trustedClick('button[title="Settings"]', {
    outcome: document => document.querySelector('button[title="Settings"]')?.getAttribute('data-state') === 'active'
      && document.querySelector('button[title="Chat"]')?.getAttribute('data-state') === 'inactive',
  });
  assert.deepEqual(settingsClick.events.map(event => [event.type, event.trusted]), [['mousedown', true], ['mouseup', true], ['click', true]]);
  proof.trustedSettingsTransition = true;
  const chatClick = await adapter.trustedClick('button[title="Chat"]', {
    outcome: document => document.querySelector('button[title="Settings"]')?.getAttribute('data-state') === 'inactive'
      && document.querySelector('button[title="Chat"]')?.getAttribute('data-state') === 'active',
  });
  assert.deepEqual(chatClick.events.map(event => [event.type, event.trusted]), [['mousedown', true], ['mouseup', true], ['click', true]]);
  proof.trustedChatRestore = true;

  proof.phase = 'stable_target_transient_overlay';
  const overlayTarget = await adapter.evaluate(document => {
    const button = document.createElement('button');
    button.id = 'matrx-probe-covered-button'; button.type = 'button';
    button.style.cssText = 'position:fixed;left:20px;top:20px;width:160px;height:40px;z-index:2147483646';
    button.textContent = 'Disposable covered action';
    button.addEventListener('click', event => { if (event.isTrusted) button.dataset.clicked = 'true'; });
    const cover = document.createElement('div'); cover.id = 'matrx-probe-cover';
    cover.style.cssText = 'position:fixed;left:0;top:0;width:220px;height:100px;z-index:2147483647';
    document.body.append(button, cover);
    document.defaultView.setTimeout(() => cover.remove(), 500);
    return '#matrx-probe-covered-button';
  });
  const uncoveredClick = await adapter.trustedClick(overlayTarget, {
    outcome: document => document.querySelector('#matrx-probe-covered-button')?.dataset.clicked === 'true',
    timeoutMs: 3000,
  });
  assert.ok(uncoveredClick.diagnostic.actionability.settleMs >= 300);
  assert.ok(uncoveredClick.events.every(event => event.trusted && ['exact', 'descendant'].includes(event.targetRelation)));
  proof.transientOverlayWaitedWithoutClickThrough = true;
  await adapter.evaluate(document => {
    document.querySelector('#matrx-probe-covered-button').dataset.clicked = 'false';
    const cover = document.createElement('div'); cover.id = 'matrx-probe-cover';
    cover.style.cssText = 'position:fixed;left:0;top:0;width:220px;height:100px;z-index:2147483647';
    document.body.append(cover);
  });
  await assert.rejects(() => adapter.trustedClick(overlayTarget, { timeoutMs: 750 }), /trusted_click_target_occluded/);
  assert.equal(await adapter.evaluate(document => document.querySelector('#matrx-probe-covered-button')?.dataset.clicked), 'false');
  proof.permanentOverlayRefusedWithoutClick = true;
  await adapter.evaluate(document => {
    document.querySelector('#matrx-probe-cover')?.remove();
    document.querySelector('#matrx-probe-covered-button')?.remove();
  });

  proof.phase = 'trusted_portal_combobox_press';
  const portalControl = await adapter.evaluate(document => {
    document.querySelector('[data-matrx-adapter-probe="trigger"]')?.remove();
    document.querySelector('[data-matrx-adapter-probe="portal"]')?.remove();
    document.querySelector('[data-matrx-adapter-probe="occluder"]')?.remove();
    document.querySelector('[data-matrx-adapter-probe="wrapper"]')?.remove();
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-matrx-adapter-probe', 'wrapper');
    wrapper.style.cssText = 'position:fixed;left:20px;top:20px;width:160px;height:40px;z-index:2147483646';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('data-matrx-adapter-probe', 'trigger');
    trigger.textContent = 'Disposable probe';
    trigger.style.cssText = 'width:160px;height:40px';
    trigger.addEventListener('mousedown', () => {
      const portal = document.createElement('div');
      portal.setAttribute('role', 'listbox');
      portal.setAttribute('data-matrx-adapter-probe', 'portal');
      portal.style.cssText = 'position:fixed;inset:0;z-index:2147483647';
      document.body.append(portal);
    }, { once: true });
    wrapper.append(trigger);
    document.body.append(wrapper);
    const occluder = document.createElement('div');
    occluder.setAttribute('data-matrx-adapter-probe', 'occluder');
    occluder.style.cssText = 'position:fixed;left:0;top:0;width:220px;height:100px;z-index:2147483647';
    document.body.append(occluder);
    const animation = wrapper.animate(
      [{ transform: 'translateY(60px)' }, { transform: 'translateY(0)' }],
      { duration: 180, easing: 'linear' },
    );
    animation.finished.then(() => occluder.remove());
    return '[data-matrx-adapter-probe="trigger"]';
  });
  const portalPress = await adapter.trustedPress(portalControl, {
    outcome: document => document.querySelector('[data-matrx-adapter-probe="portal"][role="listbox"]') !== null,
  });
  assert.deepEqual(portalPress.events.map(event => [event.type, event.trusted]), [['mousedown', true], ['mouseup', true], ['click', true]]);
  assert.ok(['exact', 'descendant'].includes(portalPress.events[0].targetRelation));
  assert.ok(portalPress.events.slice(1).every(event => event.targetRelation === 'outside'));
  assert.ok(portalPress.diagnostic.actionability.samples >= 3);
  assert.ok(portalPress.diagnostic.actionability.settleMs >= 150);
  assert.ok(['exact', 'descendant'].includes(portalPress.diagnostic.actionability.hitRelation));
  await adapter.evaluate(document => {
    document.querySelector('[data-matrx-adapter-probe="trigger"]')?.remove();
    document.querySelector('[data-matrx-adapter-probe="portal"]')?.remove();
    document.querySelector('[data-matrx-adapter-probe="occluder"]')?.remove();
    document.querySelector('[data-matrx-adapter-probe="wrapper"]')?.remove();
    return true;
  });
  proof.trustedPortalComboboxPress = true;

  proof.phase = 'trusted_keyboard_combobox_selection';
  await adapter.trustedClick('button[title="Settings"]', {
    outcome: document => document.querySelector('button[title="Settings"]')?.getAttribute('data-state') === 'active',
  });
  const appearance = await adapter.evaluate(document => {
    const buttons = [...document.querySelectorAll('button[aria-controls]')].filter(node => node.textContent.trim() === 'Appearance');
    if (buttons.length !== 1) return null;
    const id = buttons[0].getAttribute('aria-controls');
    const escaped = document.defaultView.CSS.escape(id);
    return { header: `button[aria-controls="${escaped}"]`, select: `#${escaped} [role="combobox"]`, expanded: buttons[0].getAttribute("aria-expanded") };
  });
  assert.ok(appearance, 'appearance_section_missing');
  if (appearance.expanded === "false") await adapter.trustedClick(appearance.header, {
    outcome: (document, selector) => document.querySelector(selector)?.getAttribute('aria-expanded') === 'true',
    outcomeArgs: [appearance.header],
  });
  await adapter.trustedPress(appearance.select, { outcome: document => !!document.querySelector('[role="listbox"]') });
  await adapter.waitFor(document => document.activeElement?.getAttribute('role') === 'option');
  proof.keyboardSelection = await adapter.trustedKeyboardSelectExact(appearance.select, 'Dark');
  assert.equal(proof.keyboardSelection.exactLabelSelected, true);
  assert.equal(proof.keyboardSelection.trustedOwnedEvents, true);
  assert.equal(proof.keyboardSelection.listenerStateRemoved, true);
  proof.trustedKeyboardComboboxSelection = true;

  proof.phase = 'metadata_observer';
  const started = await adapter.startNetworkObserver({ origins: [local.origin], maxEvents: 100 });
  observerStarted = true;
  assert.equal(started.captureContract, 'method_origin_path_status_owner_only_no_headers_query_body');
  assert.equal(await post(base, `/session/${sessionId}/moz/context`, { context: 'content' }), null);
  await post(base, `/session/${sessionId}/url`, { url: `${local.origin}/` });
  const status = await post(base, `/session/${sessionId}/execute/async`, { script: `
    const done = arguments[arguments.length - 1];
    fetch('/known-owned-request?${forbiddenQueryCanary}=1', { method: 'POST' }).then(response => done(response.status), () => done(null));`, args: [] });
  assert.equal(status, 204, 'owned_localhost_request_failed');
  assert.equal(await post(base, `/session/${sessionId}/moz/context`, { context: 'chrome' }), null);
  const observed = await adapter.readNetworkObserver();
  const known = observed.events.filter(event => event.pathname === '/known-owned-request' && event.method === 'POST');
  assert.ok(known.some(event => event.phase === 'request'), 'known_localhost_request_not_observed');
  assert.ok(known.some(event => event.phase === 'response' && event.status === 204), 'known_localhost_response_not_observed');
  assert.equal(JSON.stringify(observed).includes(forbiddenQueryCanary), false, 'network_observer_captured_query');
  assert.equal(local.state.knownRequests, 1, 'known_localhost_request_count_invalid');
  proof.networkObserver = {
    captureContract: observed.captureContract,
    ownerScope: observed.ownerScope,
    eventCount: observed.events.length,
    knownRequestPhases: known.map(event => ({ phase: event.phase, method: event.method, pathname: event.pathname, status: event.status, owner: event.owner })),
    dropped: observed.dropped,
    observerErrors: observed.observerErrors,
  };
  proof.knownLocalhostRequestObserved = true;
  proof.metadataOnlyObserver = true;
  const disposed = await adapter.disposeNetworkObserver();
  observerStarted = false;
  assert.equal(disposed.disposed, true);
  proof.observerDisposed = true;
  proof.phase = 'probe_complete';
} catch (error) {
  failure = error;
  const message = String(error?.message || '');
  proof.errorCode = /^[a-z0-9_]{1,100}$/.test(message) ? message : 'firefox_adapter_probe_failed';
} finally {
  proof.phaseBeforeCleanup = proof.phase;
  if (profile) for (const pid of await pidsContaining(profile).catch(() => [])) ownedPids.add(pid);
  if (observerStarted && adapter) {
    try { const result = await adapter.disposeNetworkObserver(); proof.observerDisposed = result.disposed === true; observerStarted = false; }
    catch { proof.observerDisposed = false; }
  }
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
    await new Promise(resolve => driver.once('exit', resolve));
  }
  proof.driverExited = driver.exitCode !== null;
  try { await local.close(); proof.localServerClosed = true; } catch { proof.localServerClosed = false; }
  if (profile) await rm(profile, { recursive: true, force: true });
  proof.profileRemoved = !profile || !(await exists(profile));
  proof.allOwnedPidsGone = await waitForPidsGone(ownedPids);
  proof.firefoxExited = !profile || (await pidsContaining(profile)).length === 0;
  const required = [
    'runtimeAttested', 'freshProfileAuthStorageEmpty', 'nativeSidebarControllerRoute', 'unicodeTransportVerified',
    'transientOverlayWaitedWithoutClickThrough', 'permanentOverlayRefusedWithoutClick',
    'trustedSettingsTransition', 'trustedChatRestore', 'trustedPortalComboboxPress', 'trustedKeyboardComboboxSelection', 'knownLocalhostRequestObserved',
    'metadataOnlyObserver', 'observerDisposed', 'addonUninstalled', 'sessionDeleted',
    'driverExited', 'firefoxExited', 'profileRemoved', 'localServerClosed', 'allOwnedPidsGone',
  ];
  proof.ok = !failure && required.every(key => proof[key] === true);
  proof.terminalPhase = proof.ok ? 'complete' : proof.phaseBeforeCleanup;
  if (!proof.ok && !proof.errorCode) proof.errorCode = 'firefox_adapter_probe_cleanup_incomplete';
  proof.ownedProcessCount = ownedPids.size;
  await writeFile(proofPath, `${JSON.stringify(proof, null, 2)}\n`, { mode: 0o600 });
}

console.log(proofPath);
if (failure) throw failure;
assert.equal(proof.ok, true, proof.errorCode);
