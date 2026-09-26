#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
/**
 * Isolated, native-side-panel browser QA harness.
 *
 * It never attaches to a guessed or pre-existing CDP port.  Chrome is started
 * directly with a newly-created profile, and CDP is read from that profile's
 * DevToolsActivePort only after the existing owned-CDP guard has correlated
 * the profile with the launched Chrome-for-Testing process.  The harness does
 * not call Browser.close: cleanup terminates only its direct child process.
 *
 * Run after `pnpm build`:
 *   node tests/browser/native-sidepanel-qa-harness.mjs
 * If Playwright or Chrome-for-Testing is supplied by the host runtime, set
 * MATRX_PLAYWRIGHT_MODULE and MATRX_CHROME_PATH to their installed absolute paths.
 */
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { resolveBrowserRuntime } from './browser-runtime.mjs';

const require = createRequire(import.meta.url);
const { prepareOwnedProfile, connectOwnedCdp } = require('./vault-owned-cdp.cjs');

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const RELEASED_EXTENSION_DIR = join(REPO, '.output', 'chrome-mv3-dev');
const RELEASE_RECEIPT = join(REPO, '.output', 'release-receipt.json');
const EXPECTED_EXTENSION_ID = 'cihdmkcdjjckfhjpgoedmgfpoljebaml';
const WAIT_MS = 100;
const ATTEMPTS = 150;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function requireReleaseReceipt(receipt) {
  if (
    !receipt ||
    typeof receipt.version !== 'string' ||
    !/^[a-f0-9]{64}$/.test(receipt.treeSha256 ?? '') ||
    typeof receipt.storeZip?.path !== 'string' ||
    !/^[a-f0-9]{64}$/.test(receipt.storeZip.sha256 ?? '')
  )
    throw new Error('native_sidepanel_release_receipt_refused');
  return receipt;
}

function resolveExpectedRelease({ receipt, extensionDir, expectedRelease }) {
  const released = requireReleaseReceipt(receipt);
  if (extensionDir !== undefined) {
    if (
      !expectedRelease ||
      expectedRelease.treeSha256 !== released.treeSha256 ||
      expectedRelease.version !== released.version
    )
      throw new Error('native_sidepanel_override_provenance_refused');
  }
  return Object.freeze({
    extensionDir: resolve(extensionDir ?? RELEASED_EXTENSION_DIR),
    treeSha256: released.treeSha256,
    version: released.version,
    storeZipPath: released.storeZip.path,
    storeZipSha256: released.storeZip.sha256,
  });
}

async function verifyReleasedArtifact(expected) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(expected.extensionDir, 'manifest.json'), 'utf8'));
  } catch {
    throw new Error('native_sidepanel_release_manifest_refused');
  }
  if (manifest.version !== expected.version)
    throw new Error('native_sidepanel_release_version_refused');
  if (hashReleaseTree(expected.extensionDir) !== expected.treeSha256)
    throw new Error('native_sidepanel_release_tree_refused');
  let zip;
  try {
    zip = await readFile(expected.storeZipPath);
  } catch {
    throw new Error('native_sidepanel_store_zip_missing');
  }
  if (sha256(zip) !== expected.storeZipSha256)
    throw new Error('native_sidepanel_store_zip_refused');
}

function requireOwnedCommandLine(commandLine, profile) {
  const args = commandLine?.arguments;
  if (!Array.isArray(args) || !args.includes(`--user-data-dir=${profile}`))
    throw new Error('native_sidepanel_foreign_browser_refused');
  if (!args.includes('--remote-debugging-port=0'))
    throw new Error('native_sidepanel_unowned_debugging_refused');
}

function requireExpectedExtension(targetInfos, extensionId) {
  const prefix = `chrome-extension://${extensionId}/`;
  const serviceWorker = targetInfos.find(
    (target) => target.type === 'service_worker' && target.url.startsWith(prefix),
  );
  if (!serviceWorker) throw new Error('native_sidepanel_expected_extension_missing');
  return serviceWorker;
}

function requireSpawnedProfileOwner(lockTarget, childPid) {
  const owner = /-(\d+)$/.exec(String(lockTarget ?? ''))?.[1];
  if (!owner || Number(owner) !== childPid)
    throw new Error('native_sidepanel_profile_owner_not_spawned_child');
}

function requireSidePanelContext(contexts, panelUrl) {
  const context = contexts?.find(
    (entry) =>
      entry?.contextType === 'SIDE_PANEL' && entry?.documentUrl === panelUrl && entry?.tabId === -1,
  );
  if (!context) throw new Error('native_sidepanel_runtime_context_missing');
  return context;
}

function isSettledGuestPanel(state) {
  return (
    state?.ready === true &&
    state?.guestBanner === true &&
    state?.signInControl === true &&
    state?.composer === true &&
    state?.visibleControls >= 3
  );
}

async function ownedEndpoint(profile) {
  const raw = await readFile(join(profile, 'DevToolsActivePort'), 'utf8');
  const [port, browserPath, ...rest] = raw.trimEnd().split(/\r?\n/);
  if (
    rest.length ||
    !/^[1-9][0-9]{0,4}$/.test(port) ||
    Number(port) > 65535 ||
    !/^\/devtools\/browser\/[A-Za-z0-9-]+$/.test(browserPath)
  )
    throw new Error('native_sidepanel_owned_endpoint_refused');
  return { port: Number(port), browserPath };
}

async function waitForPanelTarget(cdp, panelUrl) {
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const { targetInfos } = await cdp.send('Target.getTargets');
    const target = targetInfos.find((entry) => entry.type === 'page' && entry.url === panelUrl);
    if (target) return target;
    await wait(WAIT_MS);
  }
  throw new Error('native_sidepanel_target_missing');
}

async function waitForExpectedExtension(cdp, extensionId) {
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const { targetInfos } = await cdp.send('Target.getTargets');
    try {
      return requireExpectedExtension(targetInfos, extensionId);
    } catch (error) {
      if (!String(error?.message).includes('expected_extension_missing')) throw error;
    }
    await wait(WAIT_MS);
  }
  throw new Error('native_sidepanel_expected_extension_missing');
}

async function sidePanelContexts(cdp, serviceWorkerTargetId) {
  const worker = await attachTargetSession(cdp, serviceWorkerTargetId);
  try {
    const result = await worker.send('Runtime.evaluate', {
      expression: "chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] })",
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails || !Array.isArray(result.result?.value))
      throw new Error('native_sidepanel_runtime_context_query_failed');
    return result.result.value;
  } finally {
    await worker.detach();
  }
}

async function waitForSettledGuestPanel(cdp, targetId) {
  const panel = await attachTargetSession(cdp, targetId);
  const expression = `(() => {
    const visible = (element) => {
      const style = getComputedStyle(element); const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const text = document.body?.innerText ?? '';
    const controls = [...document.querySelectorAll('button, input, textarea, [contenteditable="true"]')]
      .filter(visible);
    return {
      ready: document.readyState === 'complete',
      guestBanner: /You're using Matrx as a guest\\./.test(text),
      signInControl: controls.some((element) => /^sign in$/i.test(element.textContent?.trim() ?? '')),
      composer: /How can I help you today\\?/.test(text),
      visibleControls: controls.length,
    };
  })()`;
  let previousFingerprint;
  try {
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      const result = await panel.send('Runtime.evaluate', { expression, returnByValue: true });
      const state = result.result?.value;
      const fingerprint = JSON.stringify(state);
      if (isSettledGuestPanel(state) && previousFingerprint === fingerprint) return panel;
      previousFingerprint = fingerprint;
      await wait(WAIT_MS * 2);
    }
  } catch (error) {
    await panel.detach();
    throw error;
  }
  await panel.detach();
  throw new Error('native_sidepanel_render_not_settled');
}

async function captureTarget(cdp, targetId, output) {
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  try {
    await cdp.send('Page.enable', {}, sessionId);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    if (typeof data !== 'string' || data.length < 100)
      throw new Error('native_sidepanel_png_missing');
    await writeFile(output, Buffer.from(data, 'base64'), { mode: 0o600 });
  } finally {
    await cdp.send('Target.detachFromTarget', { sessionId }).catch(() => {});
  }
}

async function attachTargetSession(cdp, targetId) {
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  return Object.freeze({
    async send(method, params = {}) {
      return cdp.send(method, params, sessionId);
    },
    on(method, listener) {
      const scoped = (params, eventSessionId) => {
        if (eventSessionId === sessionId) listener(params);
      };
      cdp.on(method, scoped);
      return () => cdp.off(method, scoped);
    },
    async detach() {
      await cdp.send('Target.detachFromTarget', { sessionId }).catch(() => {});
    },
  });
}

function stopOwnedChild(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(killWait);
      resolve();
    };
    let killWait;
    const timeout = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {}
      // Node can miss an exit event if Chrome died between the initial check
      // and listener registration. Never strand disposal on that event.
      killWait = setTimeout(finish, 2000);
    }, 5000);
    child.once('exit', finish);
    if (child.exitCode !== null || child.signalCode !== null) return finish();
    try {
      child.kill('SIGTERM');
    } catch {
      finish();
    }
  });
}

function testPage(extensionId) {
  return `<!doctype html><meta charset="utf-8"><title>Native panel QA</title>
    <button id="open-panel">Open panel</button><pre id="result"></pre>
    <script>
      document.querySelector('#open-panel').addEventListener('click', () => {
        chrome.runtime.sendMessage(${JSON.stringify(extensionId)}, {
          channel: 'FRONTEND_RPC', action: 'openPanel', payload: { panelId: 'chat' },
          requestId: 'native-sidepanel-qa',
        }, (reply) => {
          document.querySelector('#result').textContent = JSON.stringify(
            reply ?? { error: chrome.runtime.lastError?.message ?? 'no reply' },
          );
        });
      });
    </script>`;
}

export async function runNativeSidepanelQa({
  extensionDir,
  expectedRelease,
  releaseReceiptPath = RELEASE_RECEIPT,
  chromeExecutable,
  expectedExtensionId = EXPECTED_EXTENSION_ID,
  artifactRoot = join(REPO, 'test-results'),
  exercisePanel,
} = {}) {
  let receipt;
  try {
    receipt = JSON.parse(await readFile(releaseReceiptPath, 'utf8'));
  } catch {
    throw new Error('native_sidepanel_release_receipt_missing');
  }
  const expected = resolveExpectedRelease({ receipt, extensionDir, expectedRelease });
  await verifyReleasedArtifact(expected);
  const browserRuntime = await resolveBrowserRuntime({ chromeExecutable });
  chromeExecutable = browserRuntime.executablePath;
  const verifiedExtensionDir = expected.extensionDir;
  const root = await mkdtemp(join(tmpdir(), 'matrx-native-sidepanel-qa-'));
  const profile = join(root, 'profile');
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const artifacts = await mkdtemp(join(artifactRoot, 'native-sidepanel-qa-'));
  await mkdir(profile, { mode: 0o700 });
  const preparedProfile = await prepareOwnedProfile(profile);
  let child;
  let cdp;
  let playwrightBrowser;
  let server;
  let serverPort;
  let verified = false;
  let launchError;
  try {
    child = spawn(
      chromeExecutable,
      [
        '--headless=new',
        '--enable-automation',
        '--no-first-run',
        '--no-default-browser-check',
        '--remote-debugging-address=127.0.0.1',
        '--remote-debugging-port=0',
        `--user-data-dir=${profile}`,
        `--disable-extensions-except=${verifiedExtensionDir}`,
        `--load-extension=${verifiedExtensionDir}`,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    const chromeStderr = [];
    child.stderr.on('data', (chunk) => chromeStderr.push(String(chunk)));
    child.once('error', (error) => {
      launchError = error;
    });

    cdp = await connectOwnedCdp({ preparedProfile, chromeExecutable });
    if (launchError) throw launchError;
    const endpoint = await ownedEndpoint(profile);
    const commandLine = await cdp.send('Browser.getBrowserCommandLine');
    requireOwnedCommandLine(commandLine, profile);
    let extensionWorker;
    try {
      extensionWorker = await waitForExpectedExtension(cdp, expectedExtensionId);
    } catch (error) {
      throw new Error(`${error.message}:${chromeStderr.join('').slice(-1000)}`);
    }
    requireSpawnedProfileOwner(await readlink(join(profile, 'SingletonLock')), child.pid);
    verified = true;

    server = createServer((_request, response) => {
      response
        .writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        .end(testPage(expectedExtensionId));
    });
    await new Promise((resolve, reject) =>
      server.listen(0, '127.0.0.1', (error) => (error ? reject(error) : resolve())),
    );
    serverPort = server.address().port;

    // This attach is derived exclusively from this profile's DevToolsActivePort,
    // after the process/profile/extension checks above. It is never a shared port.
    playwrightBrowser = await browserRuntime.chromium.connectOverCDP(
      `http://127.0.0.1:${endpoint.port}`,
    );
    const context = playwrightBrowser.contexts()[0];
    const page = await context.newPage();
    await page.goto(`http://localhost:${serverPort}/`);
    await page.locator('#open-panel').click(); // Real trusted Chromium input.
    await page.locator('#result').waitFor({ state: 'visible' });
    const reply = JSON.parse((await page.locator('#result').textContent()) || '{}');
    if (reply?.ok !== true || reply?.result?.opened !== true)
      throw new Error(`native_sidepanel_open_refused:${JSON.stringify(reply)}`);

    const normalTarget = (await cdp.send('Target.getTargets')).targetInfos.find(
      (entry) => entry.type === 'page' && entry.url === page.url(),
    );
    if (!normalTarget) throw new Error('native_sidepanel_normal_target_missing');
    const panelUrl = `chrome-extension://${expectedExtensionId}/sidepanel.html`;
    const panelTarget = await waitForPanelTarget(cdp, panelUrl);
    if (panelTarget.targetId === normalTarget.targetId)
      throw new Error('native_sidepanel_target_not_distinct');
    requireSidePanelContext(await sidePanelContexts(cdp, extensionWorker.targetId), panelUrl);
    const readyPanel = await waitForSettledGuestPanel(cdp, panelTarget.targetId);

    const normalPng = join(artifacts, 'normal-target-after-open.png');
    const panelPng = join(artifacts, 'native-side-panel.png');
    await captureTarget(cdp, normalTarget.targetId, normalPng);
    await captureTarget(cdp, panelTarget.targetId, panelPng);
    await readyPanel.detach();
    if (exercisePanel) {
      const panel = await attachTargetSession(cdp, panelTarget.targetId);
      try {
        await exercisePanel(
          Object.freeze({
            page,
            panel,
            panelTarget,
            artifacts,
            attachWorker: () => attachTargetSession(cdp, extensionWorker.targetId),
          }),
        );
      } finally {
        await panel.detach();
      }
    }
    return Object.freeze({
      artifacts,
      normalPng,
      panelPng,
      extensionId: expectedExtensionId,
      panelTargetId: panelTarget.targetId,
      verified,
    });
  } finally {
    // Browser.close is intentionally absent, including for Playwright's CDP
    // connection. Only the exact ChildProcess this harness spawned is ended.
    await cdp?.detach().catch(() => {});
    await new Promise((resolve) => server?.close(resolve) ?? resolve());
    await stopOwnedChild(child);
    await rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runNativeSidepanelQa()
    .then((result) => console.log(`PASS native panel screenshot: ${result.panelPng}`))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

export {
  isSettledGuestPanel,
  requireReleaseReceipt,
  requireExpectedExtension,
  requireOwnedCommandLine,
  requireSidePanelContext,
  requireSpawnedProfileOwner,
  resolveExpectedRelease,
  verifyReleasedArtifact,
};
