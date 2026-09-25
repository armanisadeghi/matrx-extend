#!/usr/bin/env node
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
 */
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { prepareOwnedProfile, connectOwnedCdp } = require('./vault-owned-cdp.cjs');
const { chromium } = createRequire('/Users/armanisadeghi/code/matrx-frontend/package.json')('playwright');

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const EXTENSION_DIR = join(REPO, '.output', 'chrome-mv3');
const EXPECTED_EXTENSION_ID = 'cihdmkcdjjckfhjpgoedmgfpoljebaml';
const DEFAULT_CHROME = chromium.executablePath();
const WAIT_MS = 100;
const ATTEMPTS = 150;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

async function captureTarget(cdp, targetId, output) {
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  try {
    await cdp.send('Page.enable', {}, sessionId);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    if (typeof data !== 'string' || data.length < 100) throw new Error('native_sidepanel_png_missing');
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
    async detach() {
      await cdp.send('Target.detachFromTarget', { sessionId }).catch(() => {});
    },
  });
}

function stopOwnedChild(child) {
  if (!child?.pid || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {}
    }, 5000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    try {
      child.kill('SIGTERM');
    } catch {
      clearTimeout(timeout);
      resolve();
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
  extensionDir = EXTENSION_DIR,
  chromeExecutable = DEFAULT_CHROME,
  expectedExtensionId = EXPECTED_EXTENSION_ID,
  artifactRoot = join(REPO, 'test-results'),
  exercisePanel,
} = {}) {
  await readFile(join(extensionDir, 'manifest.json'), 'utf8');
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
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
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
    try {
      await waitForExpectedExtension(cdp, expectedExtensionId);
    } catch (error) {
      throw new Error(`${error.message}:${chromeStderr.join('').slice(-1000)}`);
    }
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
    playwrightBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${endpoint.port}`);
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

    const normalPng = join(artifacts, 'normal-target-after-open.png');
    const panelPng = join(artifacts, 'native-side-panel.png');
    await captureTarget(cdp, normalTarget.targetId, normalPng);
    await captureTarget(cdp, panelTarget.targetId, panelPng);
    if (exercisePanel) {
      const panel = await attachTargetSession(cdp, panelTarget.targetId);
      try {
        await exercisePanel(Object.freeze({ page, panel, panelTarget, artifacts }));
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
  } catch (error) {
    throw error;
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

export { requireExpectedExtension, requireOwnedCommandLine };
