'use strict';

// This deliberately does not use Playwright to launch Chrome. Playwright's
// launch defaults change MV3 reload behaviour: after chrome.runtime.reload(),
// its worker facade disappears and extension-page navigation is blocked even
// though Chrome itself can reload the unpacked extension. This probe owns the
// browser process and checks the browser's actual CDP targets instead.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { prepareOwnedProfile, connectOwnedCdp } = require('./vault-owned-cdp.cjs');

const REPO = path.resolve(__dirname, '../..');
const EXTENSION = path.join(REPO, '.output/chrome-mv3');
const CHROME_FOR_TESTING =
  process.env.MATRX_VAULT_CANARY_CHROME_EXECUTABLE ||
  '/Users/armanisadeghi/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(description, predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await wait(100);
  }
  throw new Error(`reload_owned_cdp_${description}_timeout`);
}

async function targetByUrl(cdp, url) {
  const targets = await cdp.send('Target.getTargets');
  return (
    targets.targetInfos.find((target) => target.type === 'service_worker' && target.url === url) ||
    null
  );
}

async function evaluate(cdp, targetId, expression, { allowContextInvalidation = false } = {}) {
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  try {
    const result = await cdp.send(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true },
      sessionId,
    );
    // Reload intentionally destroys this execution context before CDP can
    // always return a normal result. The replacement-target assertions below
    // are the evidence that decides whether that reload actually succeeded.
    if (result.exceptionDetails && !allowContextInvalidation)
      throw new Error('reload_owned_cdp_evaluate_refused');
    return result.result.value;
  } finally {
    await cdp.send('Target.detachFromTarget', { sessionId }).catch(() => {});
  }
}

test(
  'owned Chrome reload retains a working Matrx extension target and popup',
  { timeout: 30_000 },
  async (t) => {
    await fs.access(CHROME_FOR_TESTING);
    await fs.access(path.join(EXTENSION, 'manifest.json'));
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'matrx-extension-reload-owned-cdp-'));
    const extensionManifest = JSON.parse(
      await fs.readFile(path.join(EXTENSION, 'manifest.json'), 'utf8'),
    );
    const expectedName = extensionManifest.name;
    const expectedBackground = extensionManifest.background?.service_worker;
    assert.equal(typeof expectedBackground, 'string', 'reload_owned_cdp_background_missing');
    const preparedProfile = await prepareOwnedProfile(profile);
    const browser = spawn(
      CHROME_FOR_TESTING,
      [
        '--headless=new',
        `--user-data-dir=${profile}`,
        '--remote-debugging-address=127.0.0.1',
        '--remote-debugging-port=0',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-sync',
        `--disable-extensions-except=${EXTENSION}`,
        `--load-extension=${EXTENSION}`,
        'about:blank',
      ],
      { stdio: 'ignore' },
    );
    let cdp;
    try {
      t.after(async () => {
        browser.kill('SIGTERM');
        await new Promise((resolve) => browser.once('close', resolve));
        await fs.rm(profile, { recursive: true, force: true });
      });
      cdp = await connectOwnedCdp({
        preparedProfile,
        chromeExecutable: CHROME_FOR_TESTING,
        timeoutMs: 10_000,
      });
      const workerUrl = await waitFor('initial_worker', () =>
        targetByUrl(
          cdp,
          `chrome-extension://cihdmkcdjjckfhjpgoedmgfpoljebaml/${expectedBackground}`,
        ),
      );
      await evaluate(cdp, workerUrl.targetId, 'chrome.runtime.reload()', {
        allowContextInvalidation: true,
      });
      const reloadedWorker = await waitFor('reloaded_worker', () =>
        targetByUrl(cdp, workerUrl.url),
      );
      const recoveredManifest = await waitFor('post_reload_manifest', async () => {
        try {
          const name = await evaluate(
            cdp,
            reloadedWorker.targetId,
            'chrome.runtime.getManifest().name',
          );
          return name === expectedName ? name : null;
        } catch {
          return null;
        }
      });
      assert.equal(recoveredManifest, expectedName);

      const popup = await cdp.send('Target.createTarget', {
        url: workerUrl.url.replace(expectedBackground, 'popup.html'),
      });
      const popupReady = await waitFor('popup_ready', async () => {
        const state = await evaluate(
          cdp,
          popup.targetId,
          '({ ready: document.readyState, title: document.title, body: document.body?.innerText || "" })',
        );
        return state?.ready === 'complete' &&
          state.title === 'Matrx' &&
          state.body.includes('Sign in')
          ? state
          : null;
      });
      assert.equal(popupReady.title, 'Matrx');
    } finally {
      await cdp?.detach().catch(() => {});
    }
  },
);
