#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
/**
 * Real-browser walk of the Vault tab now that it is the shared @ai-matrx/vault
 * workspace. Owned disposable profile, admin@admin.com, role/label selectors.
 * Usage: MATRX_VAULT_WALK_RECEIPT=<local-dev receipt> MATRX_VAULT_WALK_SHOTS=<dir> node vault-package-panel-walk.mjs [step...]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { join, resolve } from 'node:path';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { signInSettings } from './settings-native-auth-driver.mjs';

const REPO = resolve(import.meta.dirname, '..', '..');
const RECEIPT =
  process.env.MATRX_VAULT_WALK_RECEIPT ?? join(REPO, 'test-results', 'vault-walk-receipt.json');
const SHOTS = process.env.MATRX_VAULT_WALK_SHOTS ?? join(REPO, 'test-results', 'vault-walk');
const WEB = 'https://www.aimatrx.com';
const log = (...a) => process.stderr.write(`${a.join(' ')}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ev = async (panel, expression) => {
  const r = await panel.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails)
    throw new Error(
      `eval: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`,
    );
  return r.result?.value;
};
const shot = async (panel, name) => {
  const s = await panel.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(SHOTS, `${name}.png`), Buffer.from(s.data, 'base64'));
  log('shot', name);
};
const text = (panel) => ev(panel, 'document.body.innerText');
/** Trusted click at the centre of the first visible element matching `label` (name = aria-label, title or text). */
const clickLabel = async (
  panel,
  label,
  {
    sub = false,
    sel = 'button,[role=button],[role=tab],[role=menuitem],[role=menuitemradio],[role=option],a,summary,[role=checkbox],[role=switch]',
    nth = 0,
  } = {},
) => {
  const pt = await ev(
    panel,
    `(() => {
    const L = ${JSON.stringify(label)}, sub = ${sub};
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.closest('[inert]'); };
    const nm = (e) => (e.getAttribute('aria-label') || e.getAttribute('title') || e.getAttribute('data-matrx-title') || e.textContent || '').trim();
    const els = [...document.querySelectorAll(${JSON.stringify(sel)})].filter(vis).filter((e) => sub ? nm(e).includes(L) : nm(e) === L);
    const el = els[${nth}];
    if (!el) return null; el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
  );
  if (!pt) return false;
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
    await panel.send('Input.dispatchMouseEvent', {
      type,
      x: pt.x,
      y: pt.y,
      button: 'left',
      clickCount: 1,
      buttons: type === 'mousePressed' ? 1 : 0,
    });
  return true;
};
const waitText = async (panel, re, ms = 20000) => {
  const end = Date.now() + ms;
  let t = '';
  while (Date.now() < end) {
    t = await text(panel).catch(() => '');
    if (re.test(t)) return t;
    await sleep(250);
  }
  throw new Error(`waitText ${re} not seen; last: ${t.slice(0, 600)}`);
};

export async function main(walk) {
  await mkdir(SHOTS, { recursive: true });
  await runNativeSidepanelQa({
    extensionDir: join(REPO, '.output', 'chrome-mv3'),
    expectedRelease: JSON.parse(await readFile(RECEIPT, 'utf8')),
    releaseReceiptPath: RECEIPT,
    localDevReceiptPath: RECEIPT,
    exercisePanel: async (ctx) => {
      const { page, panel } = ctx;
      const auth = await signInSettings({
        mode: 'admin',
        page,
        panel,
        repo: REPO,
        adminCredentialsFile: process.env.MATRX_PREPARE_ADMIN_CREDENTIALS_FILE,
      });
      log('signed in', JSON.stringify({ ok: auth.extension_signed_in }));
      await ctx.activatePanel();
      if (!(await clickLabel(panel, 'Vault'))) throw new Error('vault_tab_missing');
      await walk({
        ...ctx,
        ev: (e) => ev(panel, e),
        shot: (n) => shot(panel, n),
        text: () => text(panel),
        clickLabel: (l, o) => clickLabel(panel, l, o),
        waitText: (r, ms) => waitText(panel, r, ms),
        sleep,
        log,
      });
    },
  });
}

/** Focus the visible field named `label` (aria-label, placeholder or its <label>) and type into it. */
export async function typeInto(panel, label, value, { clear = true } = {}) {
  const ok = await ev(
    panel,
    `(() => {
    const L = ${JSON.stringify(label)};
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.closest('[inert]'); };
    const nm = (e) => e.getAttribute('aria-label') || e.placeholder || e.labels?.[0]?.textContent?.trim() || '';
    const el = [...document.querySelectorAll('input,textarea')].filter(vis).find((e) => nm(e) === L);
    if (!el) return false; el.scrollIntoView({ block: 'center' }); el.focus(); if (${clear}) el.select(); return true; })()`,
  );
  if (!ok) return false;
  await panel.send('Input.insertText', { text: value });
  return true;
}
const menuItems = (P) =>
  ev(
    P,
    `[...document.querySelectorAll('[role=menuitem],[role=menuitemradio],[role=menuitemcheckbox],[role=option]')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.textContent.trim().slice(0, 40)).join(' | ')`,
  );
const short = async (text) => (await text()).replace(/\n/g, ' / ').slice(0, 500);
export const fields = (panel) =>
  ev(
    panel,
    `[...document.querySelectorAll('input,textarea,select,[role=combobox]')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).map((e) => (e.tagName + ':' + (e.type || '') + ':' + (e.getAttribute('aria-label') || e.placeholder || e.labels?.[0]?.textContent?.trim() || e.textContent?.trim().slice(0, 30) || '?'))).join(' | ')`,
  );
export const buttons = (panel) =>
  ev(
    panel,
    `[...document.querySelectorAll('button,[role=menuitem],[role=tab],[role=option]')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.closest('[inert]'); }).map((e) => (e.getAttribute('aria-label') || e.getAttribute('title') || e.textContent.trim()).slice(0, 40)).filter(Boolean).join(' | ')`,
  );

/**
 * A private localhost site. /login = sign-in form (records what was posted), /signup = a
 * new-password form (autocomplete=new-password). Nothing leaves the process.
 */
export function startLoginSite() {
  const seen = { posts: [] };
  const server = http.createServer((req, res) => {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => {
        body += c;
      });
      req.on('end', () => {
        seen.posts.push(new URLSearchParams(body).get('username'));
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<!doctype html><title>Signed in</title><h1>Signed in</h1>');
      });
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    if (req.url?.startsWith('/signup'))
      res.end(`<!doctype html><title>Walk Signup</title><h1>Walk signup</h1>
<form method="post" action="/signup"><label>Email <input id="e" name="email" autocomplete="email"></label>
<label>New password <input id="np" name="password" type="password" autocomplete="new-password"></label>
<button type="submit">Create account</button></form>`);
    else
      res.end(`<!doctype html><title>Walk Login</title><h1>Walk login</h1>
<form method="post" action="/login"><label>Username <input id="u" name="username" autocomplete="username"></label>
<label>Password <input id="p" name="password" type="password" autocomplete="current-password"></label>
<button type="submit">Sign in</button></form>`);
  });
  return new Promise((ok) =>
    server.listen(0, '127.0.0.1', () => {
      const origin = `http://127.0.0.1:${server.address().port}`;
      ok({ server, seen, origin, url: `${origin}/login`, signup: `${origin}/signup` });
    }),
  );
}

/** Learn the panel's own request headers (bearer + organization) from its next vault call. */
export async function hookPanelAuth(panel) {
  await ev(
    panel,
    `(() => { if (window.__walkHook) return true; window.__walkHook = true; const f = window.fetch;
    window.fetch = async (input, init) => { try { const u = String(input?.url ?? input);
      if (/server\.app\.matrxserver\.com/.test(u)) { const h = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        if (h.get('authorization') && h.get('x-organization-id')) window.__walkAuth = { a: h.get('authorization'), o: h.get('x-organization-id') }; } } catch {}
      const t0 = Date.now(); const r = await f(input, init);
      try { if (/browser-login[/]matches/.test(String(input?.url ?? input))) { let n = null; if (r.ok) n = (await r.clone().json()).count; (window.__walkMatches ||= []).push(r.status + ':' + n + ':' + (Date.now() - t0) + 'ms'); } } catch {}
      return r; }; return true; })()`,
  );
}
export async function panelAuthReady(panel, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await ev(panel, '!!window.__walkAuth')) return true;
    await clickLabel(panel, 'Check again');
    await sleep(2500);
  }
  return false;
}

/** The vault's own HTTP API, called from the panel with the headers the panel itself sent. */
export const vaultApi = (panel, method, path, body) =>
  ev(
    panel,
    `(async () => {
    const au = window.__walkAuth; if (!au) return { status: 0, json: null, text: 'no_panel_auth_captured' };
    const r = await fetch('https://server.app.matrxserver.com/vault' + ${JSON.stringify(path)}, {
      method: ${JSON.stringify(method)},
      headers: { authorization: au.a, 'x-organization-id': au.o, 'content-type': 'application/json' },
      ...(${JSON.stringify(body ?? null)} ? { body: ${JSON.stringify(JSON.stringify(body ?? null))} } : {}) });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
    return { status: r.status, json: j, text: j ? '' : t.slice(0, 200) }; })()`,
  );

/** GET /items, retried: the server's answers are intermittently 5xx under load. */
export async function listItems(panel) {
  let last = null;
  for (let i = 0; i < 8; i++) {
    last = await vaultApi(panel, 'GET', '/items');
    if (last.status === 200) return last.json.items;
    await sleep(2500);
  }
  throw new Error(`list_items_${last?.status}`);
}

/** Every item of ours whose name starts "ZZ walk" or whose website is on `origin`; DELETE each; return how many remain. */
export async function cleanupWalkItems(panel, origin, lg = () => {}) {
  const mine = async () => {
    const items = await listItems(panel);
    return items.filter(
      (i) =>
        /^ZZ walk/.test(i.display_name ?? i.name ?? '') ||
        (origin && JSON.stringify(i).includes(origin.replace('http://', ''))),
    );
  };
  for (const it of await mine()) {
    const d = await vaultApi(panel, 'DELETE', `/items/${it.id}`);
    lg('CLEAN_DELETE', it.display_name ?? it.name, d.status);
  }
  return (await mine()).length;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const site = await startLoginSite();
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok: !!ok, detail });
    log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`);
  };
  const step = async (name, fn) => {
    try {
      return await fn();
    } catch (e) {
      check(`step:${name}`, false, String(e.message).slice(0, 300));
    }
  };
  const tag = `ZZ walk ${Math.random().toString(36).slice(2, 8)}`;
  const user1 = `walk-user-${Math.random().toString(36).slice(2, 6)}`;
  const secret1 = `Wk-${crypto.randomUUID()}`;
  const user2 = `walk-two-${Math.random().toString(36).slice(2, 6)}`;
  const secret2 = `Wk2-${crypto.randomUUID()}`;
  try {
    await main(async (c) => {
      const { page, shot, text, log: lg } = c;
      const P = c.panel;
      const buttonsNow = () => buttons(P);
      const dialogs = () =>
        ev(
          P,
          `[...document.querySelectorAll('[role=dialog],[role=alertdialog]')].map((d) => d.innerText.slice(0, 200)).join(' || ')`,
        );
      await c.waitText(/All items/, 90000).catch(() => {});
      await page.goto(site.url);
      await page.bringToFront().catch(() => {});
      await c.waitText(/This site/, 90000);
      await sleep(1500);
      await hookPanelAuth(P);
      check('captured panel auth headers', await panelAuthReady(P));
      // Anything left by an earlier run is removed first so counts are exact.
      lg('PRECLEAN_REMAINING', await cleanupWalkItems(P, site.origin, lg));
      await shot('01-page-view');
      try {
        await step('turn-on-filling', async () => {
          const needs = /Turn on filling/.test(await text());
          if (!needs) return lg('FILLING_ALREADY_ON');
          const pw = JSON.parse(
            await readFile(process.env.MATRX_PREPARE_ADMIN_CREDENTIALS_FILE, 'utf8'),
          ).password;
          const label = (await fields(P))
            .split(' | ')
            .find((f) => /password/i.test(f))
            ?.split(':')
            .slice(2)
            .join(':');
          await typeInto(P, label, pw);
          await clickLabel(P, 'Turn on');
          await waitText(P, /^(?![\s\S]*Turn on filling)[\s\S]*$/, 40000);
          await shot('02-filling-on');
        });

        await step('create-login', async () => {
          await clickLabel(P, 'Save a login');
          await sleep(2000);
          await clickLabel(P, 'Website login', { sub: true });
          await sleep(2000);
          await typeInto(P, 'Name', tag);
          await typeInto(P, 'Username or email', user1);
          await typeInto(P, 'Password', secret1);
          const web = await ev(
            P,
            `[...document.querySelectorAll('input')].filter((e) => e.getAttribute('aria-label') === 'Website' || e.placeholder === 'Website').map((e) => e.value).join()`,
          );
          if (!web) await typeInto(P, 'Website', site.url);
          await clickLabel(P, 'Save');
          await waitText(P, new RegExp(tag), 30000);
          await shot('03-login-saved');
          const items = await listItems(P);
          const it = items.find((i) => (i.display_name ?? i.name) === tag);
          check('created item exists in vault', !!it, `name=${tag}`);
          // the item must be switched on for browser fill (default on; this walk never flips it)
          await clickLabel(P, 'Back');
          await sleep(1500);
        });

        // ---------- PROOF 1: FILL ----------
        await step('fill', async () => {
          await page.goto(site.url);
          await page.bringToFront().catch(() => {});
          await clickLabel(P, 'Check again');
          const fillBtn = new RegExp(`Fill ${tag}`);
          // A page check in flight must never offer a pressable Fill.
          let sawChecking = false;
          let fillWhileChecking = false;
          let ready = false;
          const end = Date.now() + 180000;
          while (Date.now() < end && !ready) {
            await page.click('#u').catch(() => {});
            await sleep(1500);
            if (/couldn’t be checked/.test(await text())) await clickLabel(P, 'Retry');
            const t = await text();
            const b = await buttonsNow();
            lg(
              'FILL_POLL',
              t.replace(/\n/g, ' / ').slice(-160),
              '|',
              b.split(' | ').slice(-6).join(' | '),
            );
            if (/Checking this page|Checking saved logins/.test(t)) {
              sawChecking = true;
              if (fillBtn.test(b)) fillWhileChecking = true;
            }
            ready = fillBtn.test(b) && !/Checking this page/.test(t);
          }
          check('fill offered after page check settled', ready);
          check(
            'Fill never pressable while "Checking this page"',
            !fillWhileChecking,
            `sawChecking=${sawChecking}`,
          );
          check(
            'saved login listed under This site',
            /This site[\s\S]*ZZ walk/.test(await text()) || ready,
          );
          await shot('04-fill-offer');
          check('pressed Fill', await clickLabel(P, `Fill ${tag}`, { sub: true }));
          let got = { u: '', p: '' };
          for (let i = 0; i < 20; i++) {
            await sleep(750);
            got = await page.evaluate(() => ({
              u: document.getElementById('u')?.value ?? '',
              p: document.getElementById('p')?.value ?? '',
            }));
            if (got.u && got.p) break;
          }
          await shot('05-after-fill');
          check(
            'username field filled and equals saved value',
            got.u !== '' && got.u === user1,
            `len=${got.u.length}`,
          );
          check(
            'password field filled and equals saved value',
            got.p !== '' && got.p === secret1,
            `len=${got.p.length}`,
          );
          lg('PANEL_SAID', (await text()).replace(/\n/g, ' / ').slice(0, 300));
        });

        // ---------- PROOF 3: GENERATOR FILL PAGE ----------
        await step('generator-fill-page', async () => {
          await page.goto(site.signup);
          await page.bringToFront().catch(() => {});
          await clickLabel(P, 'Check again');
          await sleep(3000);
          await page.click('#np').catch(() => {});
          await waitText(P, /New password/, 30000);
          check('opened Generate', await clickLabel(P, 'Generate'));
          await sleep(2500);
          await shot('06-generator-open');
          check('pressed Fill page', await clickLabel(P, 'Fill page'));
          let v = '';
          for (let i = 0; i < 20 && !v; i++) {
            await sleep(750);
            v = await page.evaluate(() => document.getElementById('np')?.value ?? '');
          }
          await shot('07-generator-filled');
          check('new-password field filled by generator', v.length >= 12, `len=${v.length}`);
          lg('PANEL_SAID', (await text()).replace(/\n/g, ' / ').slice(0, 300));
        });

        // ---------- PROOF 2: SAVE-THIS-LOGIN ----------
        await step('capture', async () => {
          await page.goto(site.url);
          await page.bringToFront().catch(() => {});
          await sleep(2000);
          let offered = false;
          for (let attempt = 1; attempt <= 3 && !offered; attempt++) {
            if (attempt > 1) {
              await page.goto(site.url);
              await page.bringToFront().catch(() => {});
              await sleep(2000);
            }
            await page.fill('#u', user2);
            await page.fill('#p', secret2);
            await Promise.all([
              page.waitForLoadState('domcontentloaded').catch(() => {}),
              page.click('button[type=submit]'),
            ]);
            await page.bringToFront().catch(() => {});
            for (let i = 0; i < 60 && !offered; i++) {
              await sleep(1000);
              offered = /Save this login\?/.test(await text());
            }
            lg('CAPTURE_ATTEMPT', attempt, offered);
          }
          check('site received the submit', site.seen.posts.includes(user2));
          await shot('08-save-offer');
          check(
            'panel offers to save this login',
            offered,
            (await text()).replace(/\n/g, ' / ').slice(0, 200),
          );
          check('offer names the new username', new RegExp(user2).test(await text()));
          const beforeIds = new Set((await listItems(P)).map((i) => i.id));
          const before = beforeIds.size;
          const labels = await buttonsNow();
          const accept = /Save as new/.test(labels) ? 'Save as new' : 'Save';
          check('accepted offer', await clickLabel(P, accept));
          await waitText(P, /Saved to your vault/, 40000).catch(() => {});
          await shot('09-after-save');
          const after = await listItems(P);
          const fresh = after.filter((i) => !beforeIds.has(i.id));
          check(
            'new item exists in vault',
            after.length === before + 1 && fresh.length === 1,
            `before=${before} after=${after.length}`,
          );
          const detail = fresh[0] ? (await vaultApi(P, 'GET', `/items/${fresh[0].id}`)).json : null;
          lg('DETAIL_KEYS', Object.keys(detail ?? {}).join());
          lg(
            'DETAIL_FIELDS',
            JSON.stringify(
              (detail?.fields ?? []).map((f) => ({
                k: f.key,
                h: f.handling,
                v:
                  f.handling === 'sealed' || f.key === 'password'
                    ? undefined
                    : (f.value ?? f.display_value ?? f.preview),
              })),
            ),
          );
          const blob = JSON.stringify(detail ?? {});
          check(
            'new item has the right website',
            blob.includes(`${site.origin.replace('http://', '')}`),
            '',
          );
          const revealed = [];
          for (const f of detail?.fields ?? []) {
            const key = f.field_key ?? f.key;
            if (!key) continue;
            const rv = await vaultApi(P, 'POST', `/items/${fresh[0].id}/reveal`, {
              field_key: key,
            });
            revealed.push(rv.status === 200 ? rv.json?.value : `status:${rv.status}`);
          }
          check(
            'new item has the right username',
            revealed.includes(user2),
            `fields=${(detail?.fields ?? []).length}`,
          );
          check('new item has the right password', revealed.includes(secret2));
          lg('NEW_ITEM_NAME', fresh[0]?.display_name ?? fresh[0]?.name);
          // offered back on that page
          await page.goto(site.url);
          await page.bringToFront().catch(() => {});
          await clickLabel(P, 'Check again');
          const re = new RegExp(
            `Fill ${(fresh[0]?.display_name ?? fresh[0]?.name ?? 'x').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
          );
          let back = false;
          for (let i = 0; i < 40 && !back; i++) {
            await page.click('#u').catch(() => {});
            await sleep(1500);
            if (/couldn’t be checked/.test(await text())) await clickLabel(P, 'Retry');
            back = re.test(await buttonsNow()) && !/Checking this page/.test(await text());
          }
          await shot('10-offered-back');
          check('new login offered back on that page (Fill button)', back);
        });
      } finally {
        const calls = (await ev(P, 'window.__walkMatches')) ?? [];
        lg('MATCH_CALLS_500', `${calls.filter((c) => c.startsWith('500')).length}/${calls.length}`);
        const remaining = await cleanupWalkItems(P, site.origin, lg).catch(
          (e) => `err:${e.message}`,
        );
        check(
          'cleanup: ZZ walk / walk-site items remaining = 0',
          remaining === 0,
          String(remaining),
        );
      }
    });
  } finally {
    // Cleanup runs inside a fresh browser session only if the main walk could not; the in-walk finalizer below handles the normal path.
    site.server.close();
    // Browser-free final sweep (password sign-in): the count printed here is the cleanup proof.
    const sweep = spawnSync('node', [join(import.meta.dirname, 'vault-walk-cleanup.mjs')], {
      encoding: 'utf8',
      env: process.env,
    });
    log('FINAL_SWEEP', (sweep.stdout || sweep.stderr || '').trim().slice(0, 200));
    check(
      'final sweep: ZZ walk items remaining = 0',
      sweep.status === 0 && /"remainingAfterLastPass":0/.test(sweep.stdout),
    );
    await writeFile(join(SHOTS, 'results.json'), JSON.stringify({ tag, results }, null, 2)).catch(
      () => {},
    );
  }
  process.exitCode = results.some((r) => !r.ok) ? 1 : 0;
}
