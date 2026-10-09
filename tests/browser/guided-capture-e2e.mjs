#!/usr/bin/env node
/**
 * Guided capture end to end ("Take me there"), in a real headless Chrome with
 * the built extension, as admin@admin.com:
 *
 *   app tab: account page -> "Take me there"
 *   new tab: the platform page opens WITH the Matrx guide on it
 *   guide:   steps visible, progress counts items as they load, press Capture
 *   app tab: the job shows Done and links to what was saved
 *
 *   pnpm exec wxt build && node tests/browser/guided-capture-e2e.mjs
 *
 * Env:
 *   MATRX_GUIDED_APP      app origin from `pnpm preview:start` (default http://socguided.localhost:3001)
 *   MATRX_GUIDED_SESSION  dev-login session label (default socguided)
 *   MATRX_GUIDED_BACKEND  aidream the EXTENSION talks to (default http://localhost:8000);
 *                         the app's one call to /social/gated-captures is routed there too
 *                         while that door is not deployed.
 *   MATRX_GUIDED_BRAND    marketing brand id to open (default: first brand with a tracked account)
 *   MATRX_GUIDED_PROFILE  social profile id (default: first Instagram profile the account can see)
 *
 * Headless always. Never prints credentials.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBrowserRuntime } from './browser-runtime.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXT = join(REPO, '.output', 'chrome-mv3');
const SHOTS = join(REPO, '.output', 'guided-capture-e2e');
const SESSION = process.env.MATRX_GUIDED_SESSION || 'socguided';
const APP = process.env.MATRX_GUIDED_APP || `http://${SESSION}.localhost:3001`;
const BACKEND = process.env.MATRX_GUIDED_BACKEND || 'http://localhost:8000';
const fail = (m) => {
  console.error(`\n  REFUSED: ${m}\n`);
  process.exit(1);
};
const say = (m) => console.log(`  ${m}`);

function env(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const l of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/.exec(l);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}
const x = { ...env(join(REPO, '.env')), ...env(join(REPO, '.env.development')) };
const a = env(join(REPO, '..', 'aidream', '.env'));
if (!existsSync(join(EXT, 'manifest.json'))) fail('build first: pnpm exec wxt build');
mkdirSync(SHOTS, { recursive: true });

// ── identity: admin@admin.com ────────────────────────────────────────────────
const tok = await fetch(`${x.WXT_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: x.WXT_SUPABASE_PUBLISHABLE_KEY },
  body: JSON.stringify({ email: a.AI_ADMIN_USERNAME, password: a.AI_ADMIN_PASSWORD }),
});
if (!tok.ok) fail(`sign-in refused (${tok.status})`);
const session = await tok.json();
if (session.user?.email !== 'admin@admin.com') fail('not admin@admin.com');
const H = { apikey: x.WXT_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${session.access_token}` };
const rest = async (schema, q) =>
  (await fetch(`${x.WXT_SUPABASE_URL}/rest/v1/${q}`, { headers: { ...H, 'Accept-Profile': schema } })).json();

// ── what to open ──────────────────────────────────────────────────────────────
let brandId = process.env.MATRX_GUIDED_BRAND;
let profileId = process.env.MATRX_GUIDED_PROFILE;
let orgId;
if (!brandId) {
  const t = (await rest('social', 'tracked_account?select=brand_id,organization_id&brand_id=not.is.null&limit=1'))[0];
  if (!t) fail('no brand with a tracked account for this identity; set MATRX_GUIDED_BRAND');
  brandId = t.brand_id;
  orgId = t.organization_id;
}
if (!profileId) {
  const p = (await rest('social', 'social_profile?select=id,handle&platform=eq.instagram&limit=1'))[0];
  if (!p) fail('no Instagram profile visible; set MATRX_GUIDED_PROFILE');
  profileId = p.id;
}
const org = (await rest('iam', `organizations?select=id,name&id=eq.${orgId}`))[0];
if (!org) fail('organization not readable');
const ACCOUNT_URL = `${APP}/marketing/${brandId}/socials/instagram/${profileId}`;
say(`as admin@admin.com in ${org.name}; account page ${ACCOUNT_URL.replace(APP, '')}`);

// ── app sign-in: a single-use dev-login nonce for THIS session label ─────────
const loginOut = execFileSync('pnpm', ['dev-login', '/marketing'], {
  cwd: join(REPO, '..', 'matrx-frontend'),
  env: { ...process.env, MATRX_PREVIEW_SESSION: SESSION },
  encoding: 'utf8',
});
const loginUrl = /OPEN\s*:\s*(\S+)/.exec(loginOut)?.[1];
if (!loginUrl) fail('dev-login did not print a URL');

const { chromium, executablePath } = await resolveBrowserRuntime();
const ctx = await chromium.launchPersistentContext('', {
  executablePath,
  headless: false,
  args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
const results = [];
const step = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  say(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) throw new Error(`step failed: ${name}`);
};
try {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 30000 });
  const extId = new URL(sw.url()).host;
  const setup = await ctx.newPage();
  await setup.goto(`chrome-extension://${extId}/sidepanel.html`);
  await setup.evaluate(
    async ([t, exp, user, o, backend]) => {
      await chrome.storage.local.set({
        'matrx.auth.accessToken': t,
        'matrx.auth.expiresAt': Date.now() + exp * 1000,
        'matrx.user.profile': user,
        'matrx.org.active': { id: o.id, name: o.name },
        'matrx.backend.urlOverride': backend,
      });
    },
    [session.access_token, session.expires_in ?? 3600, session.user, org, BACKEND],
  );
  await setup.close();

  // The app's one call to the not-yet-deployed door goes to the local server
  // that has it (answered with CORS headers so the page may read it).
  await ctx.route('**/social/gated-captures', async (route) => {
    const req = route.request();
    const origin = req.headers().origin || APP;
    const cors = {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const res = await route.fetch({ url: `${BACKEND}/social/gated-captures` });
    await route.fulfill({ response: res, headers: { ...res.headers(), ...cors } });
  });

  const app = await ctx.newPage();
  // the shared dev server compiles routes on first hit; give it room
  await app.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await app.goto(ACCOUNT_URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
  const open = app.getByRole('button', { name: 'Take me there' });
  await open.waitFor({ timeout: 120000 });
  step('app: account page offers "Take me there"', true);
  await open.click();
  const dialog = app.getByRole('dialog');
  await dialog.getByText(/We'll open Instagram in a new tab/).waitFor({ timeout: 15000 });
  step('app: explainer before sending', true, (await dialog.locator('p').first().textContent()).slice(0, 90));
  await app.screenshot({ path: join(SHOTS, '1-explainer.png') });

  const pagePromise = ctx.waitForEvent('page', { timeout: 60000 });
  await dialog.getByRole('button', { name: 'Take me there' }).click();
  const target = await pagePromise;
  await target.waitForLoadState('domcontentloaded');
  step('extension opened the platform page in a new tab', /instagram\.com/.test(target.url()), target.url());

  const guide = target.locator('#matrx-guided-capture');
  await guide.waitFor({ state: 'attached', timeout: 45000 });
  const steps = await guide.locator('ol li').allTextContents();
  step('page: guide shows the steps', steps.length >= 3 && /Capture/.test(steps.at(-1) ?? ''), JSON.stringify(steps));
  // scroll so more items load; progress text updates by itself
  for (let i = 0; i < 4; i++) {
    await target.mouse.wheel(0, 900);
    await target.waitForTimeout(900);
  }
  say(`progress: ${await guide.locator('.count').first().textContent()}`);
  await target.screenshot({ path: join(SHOTS, '2-guide-on-page.png') });

  await guide.getByRole('button', { name: 'Capture' }).click();
  await guide.getByText(/^Captured|Matrx could not|nothing on this page|went wrong/i).first().waitFor({ timeout: 200000 });
  const outcome = (await guide.locator('.msg').first().textContent()) ?? '';
  await target.screenshot({ path: join(SHOTS, '3-after-capture.png') });
  step('page: capture filed', /^Captured/.test(outcome), outcome);

  await app.bringToFront();
  await dialog.getByText(/Done|Saved, not read yet/).first().waitFor({ timeout: 60000 });
  const link = dialog.getByRole('link', { name: 'See what was saved' });
  await link.waitFor({ timeout: 20000 });
  step('app: job shows Done with the saved results attached', true, await link.getAttribute('href'));
  await app.screenshot({ path: join(SHOTS, '4-app-done.png') });
} catch (e) {
  console.error(`\n  FAILED: ${e.message}`);
  for (const p of ctx.pages()) await p.screenshot({ path: join(SHOTS, `fail-${Date.now()}.png`) }).catch(() => {});
  process.exitCode = 1;
} finally {
  await ctx.close();
}
console.log(`\n  ${results.filter((r) => r.ok).length}/${results.length} steps passed; screenshots in ${SHOTS}`);
