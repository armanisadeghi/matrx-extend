#!/usr/bin/env node
/**
 * Rung 3, for real: the extension reads a page OUR SERVERS CANNOT, in a browser
 * that is genuinely signed in, and the result lands as a Source.
 *
 * This is the run that `capture-ladder-e2e.mjs` could not do. That one proves
 * the queue is read; this one proves a capture travels the whole way:
 *
 *   a real login-walled page  (aimatrx.com/dashboard — the scraper gets
 *                              `login_wall`, the server browser gets it too)
 *        ↓  aidream POST /capture/handoffs
 *   a real row on media.capture_handoff
 *        ↓  the extension claims it and opens it in ITS OWN signed-in browser
 *   real text, read with the extension's normal capture primitives
 *        ↓  aidream POST /capture/handoffs/{id}/result → landing.py
 *   a media.library_item on a `web_capture` Library, provenance
 *   "captured by the expert's own browser"
 *
 * THE SIGN-IN IS REAL AND IT IS OURS. The browser signs into aimatrx.com
 * through the app's own login form with the admin account's own password. No
 * third-party site is ever signed into by this or any other harness — rung 4
 * exists precisely because a person does that themselves.
 *
 * HEADLESS, ALWAYS (see the sibling harness for why). `--keep-open` runs headed
 * on purpose for somebody who asked to watch.
 *
 * RUN (needs an aidream serving /capture — local is fine):
 *   pnpm build
 *   MATRX_LADDER_API=http://127.0.0.1:8077 node tests/browser/capture-ladder-capture.mjs
 */

import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const WORKSPACE = resolve(REPO, '..');
const EXTENSION_DIR = join(REPO, '.output', 'chrome-mv3');
const SHOTS = join(REPO, '.output', 'capture-ladder-e2e');

const KEEP_OPEN = process.argv.includes('--keep-open');
const API = process.env.MATRX_LADDER_API || 'http://127.0.0.1:8077';
const APP = process.env.MATRX_LADDER_APP || 'https://aimatrx.com';
const TARGET = process.env.MATRX_LADDER_TARGET || `${APP}/dashboard`;

const require_ = createRequire(join(WORKSPACE, 'matrx-frontend', 'package.json'));
const { chromium } = require_('playwright');

function fail(message) {
  console.error(`\n  REFUSED: ${message}\n`);
  process.exit(1);
}

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[match[1]] = value;
  }
  return out;
}

const env = {
  ...readEnvFile(join(REPO, '.env')),
  ...readEnvFile(join(REPO, '.env.development')),
};
const aidreamEnv = readEnvFile(join(WORKSPACE, 'aidream', '.env'));
const SUPABASE = env.WXT_SUPABASE_URL;
const ANON = env.WXT_SUPABASE_PUBLISHABLE_KEY;
const EMAIL = aidreamEnv.AI_ADMIN_USERNAME;
const PASSWORD = aidreamEnv.AI_ADMIN_PASSWORD;

async function signIn() {
  const response = await fetch(`${SUPABASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!response.ok) fail(`sign-in refused (${response.status}).`);
  return response.json();
}

async function memberOrganizations(accessToken) {
  const rpc = await fetch(`${SUPABASE}/rest/v1/rpc/mbr_for_user`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON,
      Authorization: `Bearer ${accessToken}`,
      'Content-Profile': 'public',
      'Accept-Profile': 'public',
    },
    body: JSON.stringify({ p_container_type: 'organization' }),
  });
  if (!rpc.ok) fail(`membership lookup refused: ${rpc.status}`);
  const ids = [
    ...new Set(
      (await rpc.json()).map((r) => r.container_id ?? r.containerId).filter(Boolean),
    ),
  ];
  const orgs = await fetch(
    `${SUPABASE}/rest/v1/organizations?select=id,name,is_personal&id=in.(${ids.join(',')})`,
    { headers: { apikey: ANON, Authorization: `Bearer ${accessToken}`, 'Accept-Profile': 'iam' } },
  );
  return orgs.json();
}

async function api(path, { token, organizationId, method = 'GET', body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Organization-Id': organizationId,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { ok: response.ok, status: response.status, body: parsed };
}

async function main() {
  if (!existsSync(join(EXTENSION_DIR, 'manifest.json'))) {
    fail(`no built extension at ${EXTENSION_DIR} — run \`pnpm build\` first.`);
  }
  mkdirSync(SHOTS, { recursive: true });

  console.log('\n  rung 3, end to end\n  ' + '─'.repeat(58));
  const health = await fetch(`${API}/health/version`).catch(() => null);
  if (!health || !health.ok) {
    fail(
      `no aidream answering at ${API}. This run needs one serving /capture — ` +
        'a local `python run.py` is fine.',
    );
  }
  console.log(`  server      ${API} (${(await health.json()).git_sha.slice(0, 10)})`);

  const session = await signIn();
  const orgs = await memberOrganizations(session.access_token);
  const org = orgs.find((o) => o.is_personal !== true) ?? orgs[0];
  console.log(`  signed in   ${EMAIL} · organization ${org.name}`);

  const before = await api('/capture/handoffs', {
    token: session.access_token,
    organizationId: org.id,
  });
  if (!before.ok) fail(`GET /capture/handoffs answered ${before.status}`);
  const target = before.body.items.find((i) => i.url === TARGET && i.status === 'waiting');
  if (!target) {
    fail(
      `no waiting handoff for ${TARGET}. Queue it first with POST /capture/handoffs — ` +
        'this harness captures a real queued page, it does not invent one.',
    );
  }
  console.log(`  target      ${target.url}`);
  console.log(`              ${target.reason} · ${target.reason_note}`);

  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      ...(KEEP_OPEN ? [] : ['--headless=new']),
      `--disable-extensions-except=${EXTENSION_DIR}`,
      `--load-extension=${EXTENSION_DIR}`,
    ],
  });

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
    const extensionId = new URL(worker.url()).host;
    console.log(`  extension   ${extensionId}`);

    // ── The browser signs into OUR app, through its own form ────────────────
    const app = await context.newPage();
    await app.goto(`${APP}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await app.fill('input[name="email"]', EMAIL);
    await app.fill('input[name="password"]', PASSWORD);
    await Promise.all([
      app.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 90_000 }),
      app.getByRole('button', { name: /sign in/i }).first().click(),
    ]).catch(async () => {
      await app.screenshot({ path: join(SHOTS, '10-login-stuck.png'), fullPage: true });
      fail('the app login did not leave /login. Screenshot: 10-login-stuck.png');
    });
    console.log(`  app session ${new URL(app.url()).pathname} — signed in`);

    // Prove the target page really is readable HERE and not to our servers.
    await app.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await app.waitForTimeout(3000);
    const signedInChars = (await app.evaluate(() => document.body.innerText)).trim().length;
    await app.screenshot({ path: join(SHOTS, '11-target-signed-in.png'), fullPage: false });
    console.log(`  target page ${signedInChars} characters visible to this browser`);
    await app.close();

    // ── Point the extension at this aidream, and hand it the real session ───
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await panel.evaluate(
      async ([accessToken, expiresIn, user, orgRow, apiBase]) => {
        await chrome.storage.local.set({
          'matrx.auth.accessToken': accessToken,
          'matrx.auth.expiresAt': Date.now() + expiresIn * 1000,
          'matrx.user.profile': user,
          'matrx.org.active': { id: orgRow.id, name: orgRow.name },
          'matrx.backend.urlOverride': apiBase,
        });
      },
      [
        session.access_token,
        session.expires_in ?? 3600,
        session.user,
        { id: org.id, name: org.name },
        API,
      ],
    );
    await panel.reload();
    await panel.waitForTimeout(2500);

    const captureTab = panel.getByRole('tab', { name: /need your browser/i });
    if ((await captureTab.count()) === 0) fail('no Capture tab — is the session seeded?');
    await captureTab.first().click();
    await panel.waitForTimeout(2000);
    await panel.screenshot({ path: join(SHOTS, '12-before-run.png'), fullPage: true });

    const run = panel.getByRole('button', { name: /run these in my browser/i });
    if ((await run.count()) === 0) {
      fail('the Capture tab offers no "Run these in my browser" button.');
    }
    console.log('\n  pressing "Run these in my browser" …');
    await run.first().click();

    // ── Wait for the row to leave `waiting`, reading the SERVER, not the UI ──
    const deadline = Date.now() + 180_000;
    let final = null;
    while (Date.now() < deadline) {
      const now = await api('/capture/handoffs', {
        token: session.access_token,
        organizationId: org.id,
      });
      const row = (now.body.items || []).find((i) => i.id === target.id);
      if (!row) {
        // It left the waiting/needs_drive filter entirely — captured or failed.
        final = 'left-the-queue';
        break;
      }
      if (row.status !== 'waiting' && row.status !== 'claimed' && row.status !== 'capturing') {
        final = row;
        break;
      }
      await panel.waitForTimeout(3000);
    }
    await panel.screenshot({ path: join(SHOTS, '13-after-run.png'), fullPage: true });

    console.log(`\n  outcome     ${final === 'left-the-queue' ? 'row left the waiting queue' : final ? final.status : 'still waiting after 3 minutes'}`);
    console.log(`\n  screenshots ${SHOTS}`);
    console.log(
      '\n  Now check the row and its Library item in the database — this harness ' +
        'deliberately does NOT assert on its own UI for the landing.',
    );
    if (KEEP_OPEN) await new Promise(() => {});
  } finally {
    if (!KEEP_OPEN) await context.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
