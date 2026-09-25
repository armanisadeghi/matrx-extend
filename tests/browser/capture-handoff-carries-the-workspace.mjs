#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
/**
 * THE 2026-09-18 DEFECT, REPRODUCED AND THEN CLOSED, IN A REAL BROWSER.
 *
 * The owner was told "pages are waiting for your browser", opened the
 * extension, and the page was not there — because his waiting rows were spread
 * across three of his own organizations and the two surfaces resolve the active
 * one independently.
 *
 * This run does exactly that, on purpose:
 *   1. seeds the extension onto admin's Workspace (which does NOT hold the
 *      facebook row) and reads the Capture tab — the OLD failure;
 *   2. then presses the REAL button on the REAL web app, which hands the
 *      extension the workspace over the real FRONTEND_RPC bridge;
 *   3. and reads the Capture tab again.
 *
 * Nothing is mocked: real Supabase sign-in, real RLS, the built extension
 * loaded unpacked, the real Next dev server, the real live queue.
 */
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const EXTENSION_DIR = join(REPO, '.output', 'chrome-mv3');
const SHOTS = process.env.SHOTS;
const WEB = 'http://localhost:3007';
const FRONTEND_WT = process.env.FRONTEND_WT;
mkdirSync(SHOTS, { recursive: true });

// Seed the extension onto a workspace the WEB APP is not on, which is the
// whole condition under test. ZZZ G2 Activation Probe holds two rows of its
// own, so an empty tray cannot be mistaken for the fix working.
const WRONG_ORG = { id: '304cd2ed-a65e-4c52-8375-324e605d16bd', name: 'ZZZ G2 Activation Probe' };

const require_ = createRequire(join('/Users/armanisadeghi/code/matrx-frontend', 'package.json'));
const { chromium } = require_('playwright');

function env(file) {
  const out = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
const aid = env('/Users/armanisadeghi/code/aidream/.env');
// Same convention as tests/browser/capture-ladder-e2e.mjs: the extension's own
// .env names the project, aidream's .env holds the admin credentials.
const ext = env(join(REPO, '.env.production'));
const SUPA = ext.WXT_SUPABASE_URL;
const KEY = ext.WXT_SUPABASE_PUBLISHABLE_KEY;

const res = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', apikey: KEY },
  body: JSON.stringify({ email: aid.AI_ADMIN_USERNAME, password: aid.AI_ADMIN_PASSWORD }),
});
if (!res.ok) {
  console.error('sign-in failed', res.status);
  process.exit(1);
}
const session = await res.json();
console.log('signed in as', session.user?.email);

const ctx = await chromium.launchPersistentContext('', {
  headless: false,
  args: [
    '--headless=new',
    `--disable-extensions-except=${EXTENSION_DIR}`,
    `--load-extension=${EXTENSION_DIR}`,
  ],
  viewport: { width: 1280, height: 900 },
});

let [worker] = ctx.serviceWorkers();
if (!worker) worker = await ctx.waitForEvent('serviceworker', { timeout: 30000 });
const extId = new URL(worker.url()).host;
console.log('extension id', extId);

const panel = await ctx.newPage();
await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
await panel.evaluate(
  async ([t, exp, user, org]) => {
    await chrome.storage.local.set({
      'matrx.auth.accessToken': t,
      'matrx.auth.expiresAt': Date.now() + exp * 1000,
      'matrx.user.profile': user,
      'matrx.org.active': org,
    });
  },
  [session.access_token, session.expires_in ?? 3600, session.user, WRONG_ORG],
);
await panel.reload();
await panel.waitForTimeout(3000);

async function readCaptureTab(tag) {
  const tab = panel.getByRole('tab', { name: /need your browser/i });
  if (await tab.count()) {
    await tab.first().click();
    await panel.waitForTimeout(3500);
  }
  await panel.screenshot({ path: join(SHOTS, `extension-${tag}.png`), fullPage: true });
  const text = await panel.evaluate(() => document.body.innerText);
  console.log(
    `\n===== CAPTURE TAB [${tag}] =====\n${text.split('\n').filter(Boolean).slice(0, 25).join('\n')}\n=====`,
  );
  return text;
}

const before = await readCaptureTab('1-wrong-workspace');
console.log('BEFORE facebook listed?', /facebook/i.test(before));

// ── the real web app presses the real button ──
const nonce = execSync('openssl rand -hex 16').toString().trim();
writeFileSync(join(FRONTEND_WT, '.dev-login-nonce.localhost'), nonce + '\n');
const web = await ctx.newPage();
await web.goto(`${WEB}/api/dev-login?nonce=${nonce}&next=/capture/needs-you`, {
  waitUntil: 'domcontentloaded',
  timeout: 120000,
});
await web.waitForTimeout(9000);
await web.screenshot({ path: join(SHOTS, 'web-before-press.png') });
const webText = await web.evaluate(() => document.body.innerText);
console.log(
  '\nWEB SAYS:',
  webText
    .split('\n')
    .filter((l) => /waiting|Nothing needs|workspace/i.test(l))
    .slice(0, 6)
    .join(' | '),
);
const webHosts = webText.split('\n').filter((l) => /\.(com|org|net)$/.test(l.trim()));
console.log('WEB ROWS:', JSON.stringify(webHosts));

const btn = web.getByRole('button', { name: /Open in my browser/i }).first();
console.log('button present?', (await btn.count()) > 0);
if (await btn.count()) {
  await btn.click();
  await web.waitForTimeout(6000);
  await web.screenshot({ path: join(SHOTS, 'web-after-press.png') });
  const toastText = await web.evaluate(() => {
    const el =
      document.querySelector('[data-sonner-toast]') || document.querySelector('[role="status"]');
    return el ? el.textContent : null;
  });
  console.log('TOAST:', JSON.stringify(toastText));
}

await panel.reload();
await panel.waitForTimeout(4000);
const after = await readCaptureTab('2-after-handoff');
console.log('AFTER facebook listed?', /facebook/i.test(after));
console.log('AFTER still on the seeded wrong workspace?', after.includes('ZZZ G2'));
const stored = await panel.evaluate(
  async () => (await chrome.storage.local.get('matrx.org.active'))['matrx.org.active'],
);
console.log('extension active org now:', JSON.stringify(stored));

// The definitive answer to "does the panel actually open?" — ask the bridge
// directly and print what it reports, rather than inferring it from a toast.
const probe = await web.evaluate(async (extensionId) => {
  return await new Promise((resolve) => {
    chrome.runtime.sendMessage(
      extensionId,
      {
        channel: 'FRONTEND_RPC',
        action: 'captureHandoff.pickUp',
        requestId: crypto.randomUUID(),
        payload: { organizationId: '884d1ce8-7b49-4fba-a2f3-0f7dd7c83d4f' },
      },
      (r) =>
        resolve(chrome.runtime.lastError ? { lastError: chrome.runtime.lastError.message } : r),
    );
  });
}, extId);
console.log('PICKUP RPC RESULT:', JSON.stringify(probe));

await ctx.close();
