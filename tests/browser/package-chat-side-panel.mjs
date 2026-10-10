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
  headless: process.env.PACKAGE_CHAT_HEADED !== '1',
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
  if (
    req.method() === 'POST' &&
    /\/(ai|agent|agents|chat|execute|conversation)\b/.test(new URL(req.url()).pathname) &&
    !/supabase|\/auth\/|\/rest\//.test(req.url())
  ) {
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
  await page.reload();
  const root = page.locator('[data-package-chat]');
  await root.waitFor({ timeout: 45_000 }).catch(() => undefined);
  check('side panel renders the package chat', (await root.count()) > 0);
  const composer = page.locator('[data-package-chat] textarea').first();
  await composer.waitFor({ timeout: 45_000 }).catch(() => undefined);
  // The composer mounts read-only for ~1s while the chat boots; "ready" means editable, not attached.
  await page
    .waitForFunction(
      () => {
        const t = document.querySelector('[data-package-chat] textarea');
        return Boolean(t && !t.disabled && !t.readOnly);
      },
      undefined,
      { timeout: 45_000 },
    )
    .catch(() => undefined);
  check('composer is ready', await composer.isEditable().catch(() => false));
  const banner = await page.getByText(/Could not (restore|verify) your saved sign-in/).count();
  check('extension sign-in restored (no sign-in failure banner)', banner === 0);
  await page.screenshot({ path: join(SHOTS, '1-new-chat.png') });

  await page.getByRole('button', { name: 'Conversations' }).click();
  const row = page
    .locator(
      // A history row is design-system's ItemRow (`.item-row`); its first child is the open control.
      '[data-package-chat] .item-row > :first-child, [data-package-chat] [data-conversation-id], [data-package-chat] [role="option"]',
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
    // A cold panel loads the conversation bundle lazily; wait for the first message, not a fixed sleep.
    const messageNodes = page.locator(
      '[data-package-chat] [data-message-id], [data-package-chat] [data-role="user"], [data-package-chat] [data-role="assistant"]',
    );
    await messageNodes
      .first()
      .waitFor({ timeout: 45_000 })
      .catch(() => undefined);
    const messages = await messageNodes.count();
    check('a past conversation opens', messages > 0, `${messages} message nodes`);
    // Read-aloud comes from the package's own default (media tts); never pressed here (TTS costs money).
    const readAloud = page.locator(
      '[data-package-chat] [aria-label="Read aloud"], [data-package-chat] [aria-label="Resume"]',
    );
    await readAloud
      .first()
      .waitFor({ timeout: 15_000 })
      .catch(() => undefined);
    check('assistant messages offer read-aloud', (await readAloud.count()) > 0);
    await page.screenshot({ path: join(SHOTS, '3-conversation.png') });
  }
  // Open a past conversation through the panel's own address (independent of the history rows).
  const latest = await fetch(
    `${supabaseUrl}/rest/v1/message?select=conversation_id&role=eq.assistant&order=created_at.desc&limit=1`,
    {
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${session.access_token}`,
        'Accept-Profile': 'chat',
      },
    },
  )
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => []);
  const pastId = latest?.[0]?.conversation_id;
  if (pastId) {
    await page.evaluate(
      async (id) => chrome.storage.session.set({ 'matrx-extend:chat-address': `/chat/${id}` }),
      pastId,
    );
    await page.reload();
    await page
      .locator('[data-package-chat]')
      .waitFor({ timeout: 45_000 })
      .catch(() => undefined);
    // The newest assistant reply can be a one-liner, so wait for its message nodes rather than a length.
    await page
      .locator(
        '[data-package-chat] [data-message-id], [data-package-chat] [data-role="user"], [data-package-chat] [data-role="assistant"]',
      )
      .first()
      .waitFor({ timeout: 45_000 })
      .catch(() => undefined);
    await page.waitForTimeout(3000);
    const text = (
      await page
        .locator('[data-package-chat]')
        .innerText()
        .catch(() => '')
    ).trim();
    check(
      'a past conversation opens by address',
      text.length > 50,
      `${text.length} chars rendered`,
    );
    const roomStandIns = await page
      .locator('[data-package-chat] [data-chat-slot-fallback]')
      .evaluateAll((els) => [
        ...new Set(els.map((e) => e.getAttribute('data-chat-slot-fallback'))),
      ]);
    check(
      'no host-slot stand-ins in the conversation',
      roomStandIns.length === 0,
      roomStandIns.join(', '),
    );
    await page.screenshot({ path: join(SHOTS, '4-conversation-by-address.png') });
  } else {
    check('a past conversation exists to open', false);
  }
  // NEW CHAT RESOLVES THE EXTENSION'S MANDATE: send from a fresh chat; the run request is aborted
  // by the route above (zero AI spend) and its target is asserted from the captured request.
  await page.evaluate(async () =>
    chrome.storage.session.set({ 'matrx-extend:chat-address': '/chat' }),
  );
  await page.reload();
  const newComposer = page.locator('[data-package-chat] textarea').first();
  await newComposer.waitFor({ timeout: 45_000 }).catch(() => undefined);
  blockedPosts.length = 0;
  await newComposer.fill('ping');
  await newComposer.press('Enter');
  await page.waitForTimeout(8000);
  const run = blockedPosts.find((p) => /\/ai\/(mandates|agents)\//.test(p.url));
  check(
    'a new chat runs the extension mandate (captured request, not sent)',
    Boolean(run && /\/mandates\/extend\.browser_chat/.test(run.url)),
    run ? new URL(run.url).pathname : `no run request among ${blockedPosts.length} blocked POSTs`,
  );
  await page.screenshot({ path: join(SHOTS, '5-new-chat-send-blocked.png') });
  if (errors.length) console.log(`  page errors: ${errors.slice(0, 5).join(' | ')}`);
} finally {
  await context.close();
}
console.log(`  blocked POSTs: ${blockedPosts.length}`);
console.log(`  screenshots ${SHOTS.replace(WORKSPACE + '/', '')}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
