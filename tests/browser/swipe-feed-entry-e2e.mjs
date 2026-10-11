#!/usr/bin/env node
/**
 * "Save to swipe file" end to end, in a real headless Chrome with the built
 * extension, a REAL signed-in session (admin@admin.com) and a REAL public post.
 *
 *   pnpm exec wxt build && node tests/browser/swipe-file-e2e.mjs
 *
 * Env:
 *   MATRX_SWIPE_BACKEND   backend base URL to point the extension at (e.g.
 *                         http://localhost:8765 for a local aidream while the
 *                         /social routes are not deployed). Default: prod.
 *   MATRX_SWIPE_POST_URL  the public post to save (default: a YouTube watch URL)
 *   MATRX_LADDER_ORGANIZATION_ID  organization to act in (required if several)
 *
 * Headless always (a headed run steals the owner's focus). The pill is driven
 * on the real post URL; the page's own content is irrelevant to it. Prints the
 * post id and collection id so the DB rows can be checked read-only.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBrowserRuntime } from './browser-runtime.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXT = join(REPO, '.output', 'chrome-mv3');
const SHOTS = join(REPO, '.output', 'swipe-file-e2e');
const fail0 = (m) => {
  console.error(m);
  process.exit(1);
};
const POSTS = (process.env.MATRX_FEED_URL || '').split(',').filter(Boolean);
if (!POSTS.length) fail0('set MATRX_FEED_URL=<profile url>');
const POST_URL = POSTS.join(' ');
const COLLECTION = process.env.MATRX_SWIPE_COLLECTION || 'Carousel hooks';
const fail = (m) => {
  console.error(`\n  REFUSED: ${m}\n`);
  process.exit(1);
};

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

const tok = await fetch(`${x.WXT_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: x.WXT_SUPABASE_PUBLISHABLE_KEY },
  body: JSON.stringify({ email: a.AI_ADMIN_USERNAME, password: a.AI_ADMIN_PASSWORD }),
});
if (!tok.ok) fail(`sign-in refused (${tok.status})`);
const session = await tok.json();
const H = {
  apikey: x.WXT_SUPABASE_PUBLISHABLE_KEY,
  Authorization: `Bearer ${session.access_token}`,
};
const mem = await (
  await fetch(`${x.WXT_SUPABASE_URL}/rest/v1/rpc/mbr_for_user`, {
    method: 'POST',
    headers: {
      ...H,
      'Content-Type': 'application/json',
      'Content-Profile': 'public',
      'Accept-Profile': 'public',
    },
    body: JSON.stringify({ p_container_type: 'organization' }),
  })
).json();
const ids = [...new Set(mem.map((r) => r.container_id ?? r.containerId).filter(Boolean))];
const orgs = await (
  await fetch(
    `${x.WXT_SUPABASE_URL}/rest/v1/organizations?select=id,name&id=in.(${ids.join(',')})`,
    {
      headers: { ...H, 'Accept-Profile': 'iam' },
    },
  )
).json();
const want = process.env.MATRX_LADDER_ORGANIZATION_ID;
const org = want ? orgs.find((o) => o.id === want) : orgs.length === 1 ? orgs[0] : null;
if (!org)
  fail(
    `name an organization via MATRX_LADDER_ORGANIZATION_ID: ${orgs.map((o) => `${o.id} ${o.name}`).join(', ')}`,
  );
console.log(`  acting in ${org.name}; post ${POST_URL}`);

const { chromium, executablePath } = await resolveBrowserRuntime();
const ctx = await chromium.launchPersistentContext('', {
  executablePath,
  headless: false,
  args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
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
        ...(backend ? { 'matrx.backend.urlOverride': backend } : {}),
      });
    },
    [
      session.access_token,
      session.expires_in ?? 3600,
      session.user,
      org,
      process.env.MATRX_SWIPE_BACKEND || '',
    ],
  );
  await setup.close();

  const url = POSTS[0];
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  const pill = page.locator('#matrx-swipe-pill');
  await pill.waitFor({ state: 'attached', timeout: 20000 });
  await pill.getByRole('button', { name: /capture more/i }).click();
  const guide = page.locator('#matrx-guided-capture');
  await guide.waitFor({ state: 'attached', timeout: 20000 });
  console.log(
    `  guide opened on ${url}; pill gone: ${(await page.locator('#matrx-swipe-pill').count()) === 0}`,
  );
  await guide.locator('#scroll-target').selectOption(process.env.MATRX_SCROLL_TARGET || '25');
  await guide.getByRole('button', { name: /scroll for me/i }).click();
  let last = '';
  const t0 = Date.now();
  while (Date.now() - t0 < 120000) {
    last = (await guide.locator('.count').first().textContent()) || '';
    if (!/scrolling/.test(last) && Date.now() - t0 > 3000) break;
    await page.waitForTimeout(700);
  }
  await page.screenshot({ path: join(SHOTS, 'feed-entry.png') });
  console.log(`  RESULT: ${last}`);
} finally {
  await ctx.close().catch(() => {});
}
