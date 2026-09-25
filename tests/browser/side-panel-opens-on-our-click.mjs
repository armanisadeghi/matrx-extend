#!/usr/bin/env node
/**
 * THE GUARD: our own built extension opens its side panel when a page of ours
 * clicks a button — in a real Chrome, over the real `externally_connectable`
 * bridge, through the real `handleFrontendRpc`.
 *
 * The unit guard (`tests/unit/frontend-bridge-panel-gesture.test.ts`) pins the
 * ORDERING rule with a fake Chrome. This one asks the actual browser, because
 * the rule it encodes is Chrome's, not ours, and a fake that agrees with us is
 * worth nothing if Chrome changes its mind. Between them: the law, and the
 * reality it is a model of.
 *
 * What it asserts, in one loaded extension:
 *   1. a REAL click on a page at an allowed origin, sending `openPanel` over
 *      the real bridge, comes back `opened: true` — Chrome did NOT refuse;
 *   2. `captureHandoff.pickUp` from the same kind of click reaches its own
 *      handler (it refuses for an unsigned-in browser, in plain English, which
 *      is the correct answer here) WITHOUT Chrome's gesture refusal appearing
 *      anywhere — the panel open is not what failed;
 *   3. the SAME click from `acquisition-frontier.localhost` — the per-session
 *      preview host convention matrx-frontend runs every agent's dev server
 *      on. Until 2026-09-19 the manifest allowed only the bare `localhost`, so
 *      `chrome.runtime.sendMessage` was undefined there and the web app could
 *      not see the extension at all. This is the line that proves Chrome
 *      really accepts `http://*.localhost/*`, rather than our reading of its
 *      match-pattern grammar;
 *   4. the control: the same `chrome.sidePanel.open()` with NO gesture is
 *      refused. Without this line the run could pass in a browser that had
 *      stopped enforcing gestures at all, and would be proving nothing.
 *
 * Pixel proof now lives in `native-sidepanel-qa-harness.mjs`: current Chrome
 * for Testing does create a native panel target under `--headless=new` when
 * launched in an owned disposable profile. This guard remains focused on the
 * gesture contract; its deliberately simpler Playwright launch is not the
 * native-panel isolation harness.
 *
 * Run:  pnpm build  &&  node tests/browser/side-panel-opens-on-our-click.mjs
 */
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const EXTENSION_DIR = join(REPO, '.output', 'chrome-mv3');
const PORT = Number(process.env.GUARD_PORT ?? 8902);

if (!existsSync(join(EXTENSION_DIR, 'manifest.json'))) {
  console.error(`No build at ${EXTENSION_DIR}. Run \`pnpm build\` first.`);
  process.exit(1);
}

const require_ = createRequire('/Users/armanisadeghi/code/matrx-frontend/package.json');
const { chromium } = require_('playwright');

// `http://localhost/*` is in the manifest's externally_connectable matches AND
// in src/lib/origin-allowlist.ts, so this page is exactly as trusted as the
// real web app is. Nothing here is loosened for the test.
const PAGE = `<!doctype html><meta charset="utf-8"><title>gesture guard</title>
<button id="openPanel">openPanel</button>
<button id="pickUp">pickUp</button>
<pre id="out"></pre>
<script>
  const EXT = new URLSearchParams(location.search).get('ext');
  function send(action, payload) {
    // SYNCHRONOUS inside the click handler — the gesture the extension needs.
    chrome.runtime.sendMessage(
      EXT,
      { channel: 'FRONTEND_RPC', action, payload, requestId: 'guard-' + action },
      (reply) => {
        document.getElementById('out').textContent = JSON.stringify(
          reply ?? { error: (chrome.runtime.lastError || {}).message },
        );
      },
    );
  }
  document.getElementById('openPanel').addEventListener('click', () => {
    document.getElementById('out').textContent = '';
    send('openPanel', { panelId: 'capture' });
  });
  document.getElementById('pickUp').addEventListener('click', () => {
    document.getElementById('out').textContent = '';
    send('captureHandoff.pickUp', { organizationId: '5dc930e9-bd65-44a1-8369-af773f6e1a5b' });
  });
</script>`;

const srv = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(PAGE);
});
await new Promise((r) => srv.listen(PORT, r));

const ctx = await chromium.launchPersistentContext('', {
  headless: false,
  args: [
    '--headless=new',
    `--disable-extensions-except=${EXTENSION_DIR}`,
    `--load-extension=${EXTENSION_DIR}`,
  ],
  viewport: { width: 1280, height: 900 },
});

const failures = [];
const check = (ok, what, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${ok ? '' : `\n        ${detail}`}`);
  if (!ok) failures.push(what);
};

try {
  const worker =
    ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker', { timeout: 30000 }));
  const extId = new URL(worker.url()).host;
  const probe = await ctx.newPage();
  console.log('chrome:', await probe.evaluate(() => navigator.userAgent));
  console.log('extension:', extId, '\n');
  await probe.close();

  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/?ext=${extId}`);
  await page.waitForTimeout(500);

  async function clickAndRead(selector) {
    await page.evaluate(() => {
      document.getElementById('out').textContent = '';
    });
    await page.click(selector);
    await page
      .waitForFunction(() => document.getElementById('out').textContent.length > 0, {
        timeout: 15000,
      })
      .catch(() => {});
    return JSON.parse((await page.locator('#out').textContent()) || '{}');
  }

  const GESTURE_REFUSAL = 'user gesture';

  // 1 — openPanel
  const opened = await clickAndRead('#openPanel');
  check(
    opened?.ok === true && opened?.result?.opened === true,
    'a click on our page opens the side panel (openPanel)',
    JSON.stringify(opened),
  );

  // 2 — captureHandoff.pickUp: the panel open must not be what fails
  const picked = await clickAndRead('#pickUp');
  const pickedText = JSON.stringify(picked);
  check(
    !pickedText.includes(GESTURE_REFUSAL),
    'captureHandoff.pickUp never hits Chrome’s gesture refusal',
    pickedText,
  );
  // Nobody is signed in to this throwaway profile, so the honest answer is a
  // refusal with a sentence — not a panel claim, and not a code.
  check(
    picked?.ok === false
      ? /sign in|signed in/i.test(String(picked.error))
      : picked?.result?.panelOpened === true,
    'captureHandoff.pickUp answers honestly for this browser',
    pickedText,
  );

  // 3 — the per-session preview host. Chrome resolves any `*.localhost` label
  // to loopback itself, so this reaches the same server on the same port; what
  // differs is the ORIGIN Chrome judges against externally_connectable.
  const previewPage = await ctx.newPage();
  await previewPage.goto(`http://acquisition-frontier.localhost:${PORT}/?ext=${extId}`);
  await previewPage.waitForTimeout(500);
  const reachable = await previewPage.evaluate(
    () => typeof chrome !== 'undefined' && typeof chrome?.runtime?.sendMessage === 'function',
  );
  check(
    reachable,
    'the extension is reachable from a *.localhost preview host at all',
    'chrome.runtime.sendMessage is undefined there — the manifest does not admit the origin',
  );
  if (reachable) {
    await previewPage.click('#openPanel');
    await previewPage
      .waitForFunction(() => document.getElementById('out').textContent.length > 0, {
        timeout: 15000,
      })
      .catch(() => {});
    const fromPreview = JSON.parse((await previewPage.locator('#out').textContent()) || '{}');
    check(
      fromPreview?.ok === true && fromPreview?.result?.opened === true,
      'a click on a *.localhost preview host opens the side panel too',
      JSON.stringify(fromPreview),
    );
  }
  await previewPage.close().catch(() => {});

  // 4 — the control
  const noGesture = await worker.evaluate(async () => {
    const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    try {
      await chrome.sidePanel.open({ windowId: t.windowId });
      return { opened: true };
    } catch (e) {
      return { opened: false, reason: String(e.message || e) };
    }
  });
  check(
    noGesture.opened === false && String(noGesture.reason).includes(GESTURE_REFUSAL),
    'the SAME call with no gesture is still refused (the control)',
    JSON.stringify(noGesture),
  );
} finally {
  await ctx.close();
  srv.close();
}

if (failures.length) {
  console.error(`\n${failures.length} failed.`);
  process.exit(1);
}
console.log('\nThe panel opens on our own click, and only on a gesture.');
