#!/usr/bin/env node
/**
 * Real-use proof for the side panel's Chat tab on @ai-matrx/chat (W1/W2):
 * load the BUILT extension in headless Chromium, sign in as the admin account
 * (credentials from aidream/.env, never printed), and prove up to sending:
 * the package chat renders, the composer is ready, history loads, and a past
 * conversation opens. Screenshots land in .output/package-chat-side-panel/.
 *
 *   pnpm build && node tests/browser/package-chat-side-panel.mjs
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBrowserRuntime } from './browser-runtime.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const WORKSPACE = resolve(REPO, '..');
const EXTENSION_DIR = join(REPO, '.output', 'chrome-mv3');
const SHOTS = join(REPO, '.output', 'package-chat-side-panel');
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
  headless: false,
  viewport: { width: 420, height: 900 },
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
try {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html?chat=package`);
  await page.evaluate(
    async ([accessToken, expiresIn, user, org]) => {
      await chrome.storage.local.set({
        'matrx.auth.accessToken': accessToken,
        'matrx.auth.expiresAt': Date.now() + expiresIn * 1000,
        'matrx.user.profile': user,
        'matrx.org.active': org,
      });
    },
    [
      session.access_token,
      session.expires_in ?? 3600,
      session.user,
      { id: ORGANIZATION_ID, name: "Admin's Workspace" },
    ],
  );
  await page.reload();
  const root = page.locator('[data-package-chat]');
  await root.waitFor({ timeout: 45_000 }).catch(() => undefined);
  check('side panel renders the package chat', (await root.count()) > 0);
  const composer = page.locator('[data-package-chat] textarea').first();
  await composer.waitFor({ timeout: 45_000 }).catch(() => undefined);
  check('composer is ready', await composer.isEditable().catch(() => false));
  await page.screenshot({ path: join(SHOTS, '1-new-chat.png') });

  await page.getByRole('button', { name: 'Conversations' }).click();
  const row = page
    .locator(
      '[data-package-chat] [data-conversation-id], [data-package-chat] [role="option"], [data-package-chat] li button',
    )
    .first();
  await row.waitFor({ timeout: 45_000 }).catch(() => undefined);
  const rows = await row.count();
  check('history loads', rows > 0);
  const standIns = await page
    .locator('[data-package-chat] [data-chat-slot-fallback]')
    .evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('data-chat-slot-fallback')))]);
  check('no host-slot stand-ins in history', standIns.length === 0, standIns.join(', '));
  await page.screenshot({ path: join(SHOTS, '2-history.png') });
  if (rows > 0) {
    await row.click();
    await page.waitForTimeout(6000);
    const messages = await page
      .locator(
        '[data-package-chat] [data-message-id], [data-package-chat] [data-role="user"], [data-package-chat] [data-role="assistant"]',
      )
      .count();
    check('a past conversation opens', messages > 0, `${messages} message nodes`);
    await page.screenshot({ path: join(SHOTS, '3-conversation.png') });
  }
  // Open a past conversation through the panel's own address (independent of the history rows).
  const latest = await fetch(`${supabaseUrl}/rest/v1/message?select=conversation_id&role=eq.assistant&order=created_at.desc&limit=1`, {
    headers: { apikey: publishableKey, Authorization: `Bearer ${session.access_token}`, 'Accept-Profile': 'chat' },
  }).then((r) => (r.ok ? r.json() : [])).catch(() => []);
  const pastId = latest?.[0]?.conversation_id;
  if (pastId) {
    await page.evaluate(async (id) => chrome.storage.session.set({ 'matrx-extend:chat-address': `/chat/${id}` }), pastId);
    await page.reload();
    await page.locator('[data-package-chat]').waitFor({ timeout: 45_000 }).catch(() => undefined);
    await page.waitForTimeout(8000);
    const text = (await page.locator('[data-package-chat]').innerText().catch(() => '')).trim();
    check('a past conversation opens by address', text.length > 200, `${text.length} chars rendered`);
    const roomStandIns = await page.locator('[data-package-chat] [data-chat-slot-fallback]').evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('data-chat-slot-fallback')))]);
    check('no host-slot stand-ins in the conversation', roomStandIns.length === 0, roomStandIns.join(', '));
    await page.screenshot({ path: join(SHOTS, '4-conversation-by-address.png') });
  } else {
    check('a past conversation exists to open', false);
  }
  if (errors.length) console.log(`  page errors: ${errors.slice(0, 5).join(' | ')}`);
} finally {
  await context.close();
}
console.log(`  screenshots ${SHOTS.replace(WORKSPACE + '/', '')}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
