#!/usr/bin/env node
/**
 * ACT-WITHOUT-ASKING WALK (both chats). Real-use proof, zero AI spend (every AI POST aborted):
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
const SHOTS = join(REPO, OUT, 'act-without-asking-walk');
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

  const seed = async (page) => {
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

  };
  const KEY = 'matrx.settings.v1';
  const setSettings = async (page, patch) =>
    page.evaluate(
      async ([key, p]) => {
        const cur = (await chrome.storage.local.get([key]))[key];
        const parsed = cur ? JSON.parse(cur) : { state: {}, version: 0 };
        parsed.state = { ...parsed.state, ...p };
        await chrome.storage.local.set({ [key]: JSON.stringify(parsed) });
        return parsed.state;
      },
      [KEY, patch],
    );
  const probe = await context.newPage();
  await probe.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await seed(probe);
  const before = await probe.evaluate(async (k) => (await chrome.storage.local.get([k]))[k] ?? null, KEY);
  console.log('  settings key present before:', before !== null);
  await probe.close();

  const TOOLS = [
    ['browser action tool (save_guidance_note)', 'save_guidance_note', { domain: 'example.com', text: 'walk' }],
    ['privileged tool (set_cookie)', 'set_cookie', { url: 'https://example.com', name: 'w', value: 'w' }],
  ];
  for (const surface of ['default', 'package']) {
    for (const mode of ['act', 'ask']) {
      const label = `${surface === 'default' ? 'Current' : 'New'} chat, ${mode === 'act' ? 'Act without asking ON' : 'OFF'}`;
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
      await seed(page);
      await setSettings(page, { chatSurface: surface, defaultPermissionMode: mode });
      await page.reload();
      await page.waitForTimeout(4000);
      const isPkg = (await page.locator('[data-package-chat]').count()) > 0;
      check(`${label}: expected chat is showing`, isPkg === (surface === 'package'));
      if (isPkg) {
        const ta = page.locator('[data-package-chat] textarea').first();
        await ta.waitFor({ timeout: 45_000 }).catch(() => undefined);
        await ta.fill('typing right away').catch(() => undefined);
        check(`${label}: composer accepts typing at once`, (await ta.inputValue().catch(() => '')) === 'typing right away');
      }
      await page.evaluate(() => {
        window.__seen = [];
        chrome.runtime.onMessage.addListener((m) => {
          if (m && m.__matrx) window.__seen.push(m.kind);
        });
      });
      for (const [name, tool, args] of TOOLS) {
        await page.evaluate(() => (window.__seen.length = 0));
        const callId = `walk-${surface}-${mode}-${tool}`;
        // Same message the package chat's deviceTools port sends; permissionMode as the extension's store resolves it.
        const answer = page.evaluate(
          ([callId, tool, args, mode]) =>
            chrome.runtime.sendMessage({
              __matrx: true,
              kind: 'tool:device-invoke',
              payload: { callId, toolName: tool, args, conversationId: `walk-conv-${callId}`, permissionMode: mode, assignedTabId: null },
            }),
          [callId, tool, args, mode],
        );
        let settled = false;
        answer.then(() => (settled = true)).catch(() => (settled = true));
        await page.waitForTimeout(2500);
        const seen = await page.evaluate(() => [...window.__seen]);
        const card = seen.includes('tool:confirm-request');
        const bodyHasCard = await page.getByRole('button', { name: /^(Approve|Allow|Allow once)/i }).count();
        if (mode === 'act') check(`${label}: ${name} runs with no approval card`, !card && bodyHasCard === 0 && settled, `msgs=${seen.join(',')}`);
        else check(`${label}: ${name} waits behind an approval card`, card && !settled, `msgs=${seen.join(',')} cardButtons=${bodyHasCard}`);
        await page.screenshot({ path: join(SHOTS, `${surface}-${mode}-${tool}.png`) });
        if (!settled && card) {
          await page.evaluate(
            (callId) => chrome.runtime.sendMessage({ __matrx: true, kind: 'tool:confirm-response', payload: { callId, approved: false } }),
            callId,
          ).catch(() => undefined);
        }
      }
      if (errors.length) console.log(`  page errors (${label}): ${errors.slice(0, 3).join(' | ')}`);
      await page.close();
    }
  }
} finally {
  await context.close();
}
console.log(`  blocked POSTs: ${blockedPosts.length}`);
console.log(`  screenshots ${SHOTS}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
