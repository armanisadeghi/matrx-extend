#!/usr/bin/env node
/**
 * Real-use proof of the host composer extensions in package mode: the Google-files attachment
 * chip draws in the composer's attachment rail, and the Todos pill (seeded user todo) opens the
 * extension's TaskPanel for the open conversation. AI POSTs are aborted; none is sent.
 * Screenshots land in <out>/package-chat-composer-extensions/.
 *
 *   WXT_OUT_DIR=.output-x pnpm build && WXT_OUT_DIR=.output-x node tests/browser/package-chat-composer-extensions.mjs
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBrowserRuntime } from './browser-runtime.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const WORKSPACE = resolve(REPO, '..');
const OUT = process.env.WXT_OUT_DIR || '.output';
const EXTENSION_DIR = join(REPO, OUT, 'chrome-mv3');
const SHOTS = join(REPO, OUT, 'package-chat-side-panel');
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

const { chromium, executablePath } = await resolveBrowserRuntime();
const context = await chromium.launchPersistentContext('', {
  executablePath,
  headless: process.env.PACKAGE_CHAT_HEADED === '1' ? false : true,
  viewport: { width: 420, height: 900 },
  args: [
    '--headless=new',
    `--disable-extensions-except=${EXTENSION_DIR}`,
    `--load-extension=${EXTENSION_DIR}`,
  ],
});
// AI SPEND: abort every POST to the aidream server's run endpoints; capture bodies for assertions.
const blockedPosts = [];
await context.route('**/*', (route) => {
  const req = route.request();
  if (req.method() === 'POST' && /\/(ai|agent|agents|chat|execute|conversation)\b/.test(new URL(req.url()).pathname) && !/supabase|\/auth\/|\/rest\//.test(req.url())) {
    blockedPosts.push({ url: req.url(), body: req.postData() });
    return route.abort();
  }
  return route.continue();
});
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
try {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html?chat=package`);
  await page.evaluate(
    async ([accessToken, refreshToken, expiresIn, user, org]) => {
      // The panel restores a session only with the refresh token encrypted the way
      // src/lib/auth/crypto.ts does it (PBKDF2 over the runtime id → AES-GCM); an
      // access token alone reads as "Could not restore your saved sign-in".
      const enc = new TextEncoder();
      const base = await crypto.subtle.importKey(
        'raw',
        enc.encode('matrx-extend.refresh-token.v1'),
        { name: 'PBKDF2' },
        false,
        ['deriveKey'],
      );
      const key = await crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: enc.encode(chrome.runtime.id),
          iterations: 100_000,
          hash: 'SHA-256',
        },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt'],
      );
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(
        await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(refreshToken)),
      );
      const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
      await chrome.storage.local.set({
        'matrx.auth.accessToken': accessToken,
        'matrx.auth.refreshTokenEnc': b64(ct),
        'matrx.auth.refreshTokenIv': b64(iv),
        'matrx.auth.expiresAt': Date.now() + expiresIn * 1000,
        'matrx.user.profile': user,
        'matrx.org.active': org,
      });
    },
    [
      session.access_token,
      session.refresh_token,
      session.expires_in ?? 3600,
      session.user,
      { id: ORGANIZATION_ID, name: "Admin's Workspace" },
    ],
  );
  // A past conversation with a user todo seeded for it, so the Todos companion pill has content.
  const latest = await fetch(
    `${supabaseUrl}/rest/v1/message?select=conversation_id&role=eq.assistant&order=created_at.desc&limit=1`,
    { headers: { apikey: publishableKey, Authorization: `Bearer ${session.access_token}`, 'Accept-Profile': 'chat' } },
  )
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => []);
  const pastId = latest?.[0]?.conversation_id;
  check('a past conversation exists to open', Boolean(pastId));
  await page.evaluate(
    async (id) => {
      await chrome.storage.local.set({
        'matrx.lists.user_todos': {
          [id]: [
            { id: 'todo-1', conversation_id: id, title: 'Call the lab about the crown remake', done: false, created_at: new Date().toISOString() },
          ],
        },
      });
      await chrome.storage.session.set({ 'matrx-extend:chat-address': `/chat/${id}` });
    },
    pastId,
  );
  await page.reload();
  await page.locator('[data-package-chat]').waitFor({ timeout: 45_000 }).catch(() => undefined);
  await page.locator('[data-package-chat] textarea').first().waitFor({ timeout: 45_000 }).catch(() => undefined);
  await page.waitForTimeout(6000);

  // 1. The Google-files attachment chip draws inside the composer's rail (no new row).
  const filesChip = page.locator('[data-package-chat] [data-rail-entry]').filter({ hasText: /Files/ });
  check('Google files attachment chip is in the composer rail', (await filesChip.count()) > 0);
  const inRail = await filesChip.first().evaluate((el) => Boolean(el.parentElement?.className.includes('overflow-x-auto'))).catch(() => false);
  check('the chip sits in the rail row itself (scrolling chip strip), not a row of its own', inRail);
  // 2. The task-panel companion pill is there and opens the extension's TaskPanel for this conversation.
  const pill = page.getByRole('button', { name: 'Plan, tasks and todos' });
  check('Todos companion pill is in the rail', (await pill.count()) > 0);
  await page.screenshot({ path: join(SHOTS, '1-rail.png') });
  await pill.first().click().catch(() => undefined);
  const panelText = await page.getByText('Call the lab about the crown remake').count();
  check('task panel opens with this conversation\'s todo', panelText > 0);
  await page.screenshot({ path: join(SHOTS, '2-task-panel.png') });
  // 3. Opening the Files chip shows the extension\'s own picker (the chip is the extension component).
  await page.keyboard.press('Escape');
  await filesChip.first().click().catch(() => undefined);
  check('Files chip opens the Google files popover', (await page.getByText('Google files').count()) > 0);
  await page.screenshot({ path: join(SHOTS, '3-files-popover.png') });
  check('no AI request was sent', blockedPosts.length === 0, `${blockedPosts.length} blocked`);
  if (errors.length) console.log(`  page errors: ${errors.slice(0, 5).join(' | ')}`);
} finally {
  await context.close();
}
console.log(`  blocked POSTs: ${blockedPosts.length}`);
console.log(`  screenshots ${SHOTS.replace(WORKSPACE + '/', '')}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
