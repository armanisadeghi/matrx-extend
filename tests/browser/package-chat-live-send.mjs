#!/usr/bin/env node
/**
 * LIVE-SEND proof (spends a few cents): real streamed answer from the Matrx Browser Agent on GPT OSS 20B
 * (test-model-selection `plumbing`), a message action, a browser device-tool call, the MV3 service worker
 * killed mid-stream, and panel close/reopen without a duplicate or changed message.
 * Real-use proof for the side panel's Chat tab on @ai-matrx/chat (W1/W2):
 * load the BUILT extension in headless Chromium, sign in as the admin account
 * (credentials from aidream/.env, never printed), and prove up to sending:
 * the package chat renders, the composer is ready, history loads, and a past
 * conversation opens. Screenshots land in .output/package-chat-side-panel/.
 *
 *   pnpm build && node tests/browser/package-chat-live-send.mjs
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBrowserRuntime } from './browser-runtime.mjs';
import { extensionOAuthClientId, seedExtensionSession } from './seed-extension-session.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const WORKSPACE = resolve(REPO, '..');
const OUT = process.env.WXT_OUT_DIR || '.output';
const EXTENSION_DIR = join(REPO, OUT, 'chrome-mv3');
const SHOTS = join(REPO, OUT, 'package-chat-live-send');
const ORGANIZATION_ID = '884d1ce8-7b49-4fba-a2f3-0f7dd7c83d4f';

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

const env = { ...readEnvFile(join(REPO, '.env')), ...readEnvFile(join(REPO, '.env.development')) };
const aidreamEnv = readEnvFile(join(WORKSPACE, 'aidream', '.env'));
const supabaseUrl = env.WXT_SUPABASE_URL;
const publishableKey = env.WXT_SUPABASE_PUBLISHABLE_KEY ?? env.WXT_SUPABASE_ANON_KEY;
const email = aidreamEnv.AI_ADMIN_USERNAME;
const password = aidreamEnv.AI_ADMIN_PASSWORD;
if (!supabaseUrl || !publishableKey || !email || !password) {
  console.error('REFUSED: missing WXT_SUPABASE_* or AI_ADMIN_* env');
  process.exit(1);
}
const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: publishableKey },
  body: JSON.stringify({ email, password }),
});
if (!res.ok) {
  console.error(`REFUSED: sign-in ${res.status}`);
  process.exit(1);
}
const session = await res.json();
mkdirSync(SHOTS, { recursive: true });

const MODEL_QUERY = process.env.LIVE_SEND_MODEL ?? 'GPT OSS 20B';
const { chromium, executablePath } = await resolveBrowserRuntime();
const context = await chromium.launchPersistentContext('', {
  executablePath,
  headless: process.env.PACKAGE_CHAT_HEADED !== '1',
  viewport: { width: 420, height: 900 },
  permissions: ['clipboard-read', 'clipboard-write'],
  args: [
    '--headless=new',
    `--disable-extensions-except=${EXTENSION_DIR}`,
    `--load-extension=${EXTENSION_DIR}`,
  ],
});
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const ASSISTANT = '[data-package-chat] [aria-label="Assistant answer"]';
const MESSAGES = '[data-package-chat] [data-message-id]';
async function messageIds(page) {
  return page
    .locator(MESSAGES)
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-message-id')));
}
async function lastAssistantText(page) {
  const n = await page.locator(ASSISTANT).count();
  return n
    ? (
        await page
          .locator(ASSISTANT)
          .nth(n - 1)
          .innerText()
      ).trim()
    : '';
}
/** Wait until the answer stopped changing for `quietMs` and the composer offers Send (not Stop). */
async function settle(page, quietMs = 5000, timeout = 120_000) {
  const end = Date.now() + timeout;
  let last = '';
  let since = Date.now();
  while (Date.now() < end) {
    const t = await page
      .locator('[data-package-chat]')
      .innerText()
      .catch(() => '');
    if (t !== last) {
      last = t;
      since = Date.now();
    } else if (Date.now() - since >= quietMs) return true;
    await page.waitForTimeout(500);
  }
  return false;
}
try {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
  const extensionId = new URL(worker.url()).host;
  const target = await context.newPage();
  await target.goto('https://example.com/');
  const page = await context.newPage();
  const runRequests = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/ai\/(mandates|agents)\//.test(r.url()))
      runRequests.push(r.url());
  });
  page.on('response', async (r) => {
    if (r.request().method() === 'POST' && /\/ai\//.test(r.url()) && r.status() >= 400)
      console.log(
        `  server refused ${r.status()} ${new URL(r.url()).pathname}: ${(await r.text().catch(() => '')).slice(0, 600)}`,
      );
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html?chat=package`);
  await seedExtensionSession(page, {
    session,
    clientId: extensionOAuthClientId(REPO),
    organization: { id: ORGANIZATION_ID, name: "Admin's Workspace" },
  });
  await page.evaluate(async () =>
    chrome.storage.session.set({ 'matrx-extend:chat-address': '/chat' }),
  );
  await page.reload();
  const composer = page.locator('[data-package-chat] textarea:not([readonly])').first();
  await composer.waitFor({ timeout: 45_000 });
  await page.waitForTimeout(2000);

  // Pick the cheapest tool-capable model for this chat (agent stays the dedicated Matrx Browser Agent).
  await page.getByRole('button', { name: /^Agent:/ }).click();
  await page.getByText(/^Model: /).click();
  await page.getByPlaceholder(/Search models/).fill(MODEL_QUERY);
  await page.waitForTimeout(1000);
  await page.getByText(MODEL_QUERY, { exact: true }).first().click();
  await page.getByRole('button', { name: 'Select model' }).click();
  await page.waitForTimeout(1500);
  if (
    (await page.getByText(/^Model: /).count()) > 0 ||
    (await page.getByText('CHOOSE YOUR CHAT AGENT').count()) > 0
  )
    await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);
  const chip = (
    await page
      .getByRole('button', { name: /^Agent:/ })
      .first()
      .innerText()
      .catch(() => '')
  ).trim();
  console.log(`  agent chip: ${chip}`);
  check(
    'chat runs the dedicated Matrx Browser Agent on the cheap model',
    /Matrx Browser Agent/.test(chip) && chip.includes(MODEL_QUERY),
    chip,
  );
  await page.screenshot({ path: join(SHOTS, '1-model-picked.png') });

  // 1. Real send: streamed answer + browser tool call + message action.
  await target.bringToFront();
  await composer.fill(
    'Use your browser tool to read the title of the active tab, then reply in one short sentence that includes the exact title.',
  );
  await page.bringToFront();
  const before = (await messageIds(page)).length;
  await composer.press('Enter');
  const t0 = Date.now();
  await page
    .locator(ASSISTANT)
    .first()
    .waitFor({ timeout: 90_000 })
    .catch(() => undefined);
  check(
    'answer starts streaming',
    (await page.locator(ASSISTANT).count()) > 0,
    `${Date.now() - t0}ms`,
  );
  check(
    'a run request went from the panel to the server',
    runRequests.length > 0,
    runRequests[0] ? new URL(runRequests[0]).pathname : 'none seen by the panel page',
  );
  const settled = await settle(page);
  const answer = await lastAssistantText(page);
  check(
    'answer completed and is non-empty',
    settled && answer.length > 3,
    `${answer.length} chars: ${answer.slice(0, 80).replace(/\n/g, ' ')}`,
  );
  const toolRows = await page.locator('[data-package-chat]').innerText();
  check(
    'browser device tool ran (answer carries the page title)',
    /Example Domain/i.test(toolRows),
  );
  await page.screenshot({ path: join(SHOTS, '2-answer.png') });
  await page.evaluate(() => navigator.clipboard.writeText('__sentinel__'));
  await page.locator('[data-package-chat] [aria-label^="Copy message"]').last().click();
  await page.waitForTimeout(800);
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  check(
    'message action: Copy puts the answer on the clipboard',
    clip !== '__sentinel__' &&
      clip.length > 3 &&
      /Example Domain/i.test(clip) === /Example Domain/i.test(answer),
    `${clip.length} chars`,
  );

  // 2. Kill the MV3 service worker mid-stream; the answer must still complete.
  await composer.fill('Count from 1 to 120, one number per line, nothing else.');
  const idsBefore2 = await messageIds(page);
  await composer.press('Enter');
  await page.waitForFunction((sel) => document.querySelectorAll(sel).length > 0, ASSISTANT);
  await page.waitForTimeout(1500);
  let killed = false;
  let detail = '';
  const bcdp = await context.browser().newBrowserCDPSession();
  const { targetInfos } = await bcdp.send('Target.getTargets');
  const sw = targetInfos.find((t) => t.type === 'service_worker' && t.url.includes(extensionId));
  if (sw) {
    const closed = new Promise((res) => context.serviceWorkers()[0]?.on('close', res));
    await bcdp
      .send('Target.closeTarget', { targetId: sw.targetId })
      .catch((e) => (detail = String(e)));
    killed = await Promise.race([
      closed.then(() => true),
      new Promise((r) => setTimeout(() => r(false), 5000)),
    ]);
  }
  if (!killed) {
    // fallback: ask the browser to stop all service workers
    const pcdp = await context.newCDPSession(page);
    await pcdp.send('ServiceWorker.enable').catch(() => undefined);
    await pcdp.send('ServiceWorker.stopAllWorkers').catch((e) => (detail += String(e)));
    await page.waitForTimeout(1500);
    killed =
      context.serviceWorkers().length === 0 ||
      !context.serviceWorkers().some((w) => w.url().includes(extensionId));
  }
  const midText = await lastAssistantText(page);
  check(
    'service worker was terminated mid-stream',
    killed,
    detail || `${midText.length} chars streamed at the kill`,
  );
  const done2 = await settle(page, 6000);
  const final2 = await lastAssistantText(page);
  const nums = (final2.match(/^\s*\d+\s*$/gm) || []).length;
  check(
    'answer still completes after the worker died',
    done2 && /\b120\b/.test(final2) && final2.length > midText.length,
    `${nums} lines, ended with ${final2.slice(-12).replace(/\n/g, ' ')}`,
  );
  await page.screenshot({ path: join(SHOTS, '3-after-worker-kill.png') });

  // 3. Close and reopen the panel: stored text equals streamed text, no duplicate assistant message.
  const idsStreamed = await messageIds(page);
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(`chrome-extension://${extensionId}/sidepanel.html?chat=package`);
  await reopened
    .locator(MESSAGES)
    .first()
    .waitFor({ timeout: 60_000 })
    .catch(() => undefined);
  await settle(reopened, 4000, 60_000);
  const idsReopened = await messageIds(reopened);
  const final2b = await lastAssistantText(reopened);
  check('reopened panel shows the same conversation', idsReopened.length > 0);
  check(
    'no duplicate or missing messages after reopen',
    JSON.stringify(idsReopened) === JSON.stringify(idsStreamed),
    `${idsStreamed.length} streamed vs ${idsReopened.length} stored; unique ${new Set(idsReopened).size}`,
  );
  check(
    'stored final text equals the streamed text',
    final2b === final2,
    `${final2b.length} vs ${final2.length} chars`,
  );
  await reopened.screenshot({ path: join(SHOTS, '4-reopened.png') });
  if (errors.length) console.log(`  page errors: ${errors.slice(0, 5).join(' | ')}`);
} finally {
  await context.close();
}
console.log(`  screenshots ${SHOTS.replace(WORKSPACE + '/', '')}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
