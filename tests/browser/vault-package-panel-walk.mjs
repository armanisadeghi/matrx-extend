#!/usr/bin/env node
/**
 * Real-browser walk of the Vault tab now that it is the shared @ai-matrx/vault
 * workspace. Owned disposable profile, admin@admin.com, role/label selectors.
 * Usage: MATRX_VAULT_WALK_RECEIPT=<local-dev receipt> MATRX_VAULT_WALK_SHOTS=<dir> node vault-package-panel-walk.mjs [step...]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { join, resolve } from 'node:path';
import { attachTargetSession, runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
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

/** A private localhost login page; records what was submitted (no secrets leave the process). */
export function startLoginSite() {
  const seen = { posts: 0 };
  const server = http.createServer((req, res) => {
    if (req.method === 'POST') {
      seen.posts += 1;
      req.resume();
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><title>Signed in</title><h1>Signed in</h1>');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><title>Walk Login</title><h1>Walk login</h1>
<form method="post" action="/login"><label>Username <input id="u" name="username" autocomplete="username"></label>
<label>Password <input id="p" name="password" type="password" autocomplete="current-password"></label>
<button type="submit">Sign in</button></form>`);
  });
  return new Promise((ok) =>
    server.listen(0, '127.0.0.1', () =>
      ok({ server, seen, url: `http://127.0.0.1:${server.address().port}/login` }),
    ),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const site = await startLoginSite();
  const step = async (name, fn) => {
    try {
      return await fn();
    } catch (e) {
      log(`STEP ${name} FAILED: ${String(e.message).slice(0, 400)}`);
    }
  };
  try {
    await main(async (c) => {
      const { page, shot, text, log: lg } = c;
      const P = c.panel;
      await page.goto(site.url);
      await page.bringToFront().catch(() => {});
      await ev(
        P,
        `(() => { const f = window.fetch; window.__net = []; window.fetch = async (input, init) => { const u = String(input?.url ?? input); const r = await f(input, init);
        if (/browser-login/.test(u)) { let b = ''; try { b = (await r.clone().text()).slice(0, 300); } catch {} window.__net.push((init?.method || 'GET') + ' ' + u.replace(/^.*matrxserver.com/, '').replace(/[?].*/, '') + ' ' + r.status + ' ' + b.replace(/"(item_id|id)":"[^"]*"/g, '"$1":"…"')); }
        return r; }; return true; })()`,
      );
      const t0 = Date.now();
      await c.waitText(/All items/, 90000);
      lg('VAULT_READY_MS', Date.now() - t0);
      await sleep(1500);
      await shot('02-page-view-no-items');
      lg('TEXT', (await text()).replace(/\n/g, ' / ').slice(0, 700));
      lg('BUTTONS', await buttons(P));
      await step('turn-on-filling', async () => {
        const pw = JSON.parse(
          await readFile(process.env.MATRX_PREPARE_ADMIN_CREDENTIALS_FILE, 'utf8'),
        ).password;
        lg('PWFIELDS', await fields(P));
        const pwLabel = (await fields(P))
          .split(' | ')
          .find((f) => /password/i.test(f))
          ?.split(':')
          .slice(2)
          .join(':');
        lg('TYPED', pwLabel, await typeInto(P, pwLabel, pw));
        lg('TURNON', await clickLabel(P, 'Turn on'));
        await sleep(5000);
        await shot('03-after-turn-on');
        lg('TEXT', (await text()).replace(/\n/g, ' / ').slice(0, 500));
      });
      await step('save-a-login', async () => {
        lg('CLICK', await clickLabel(P, 'Save a login'));
        await sleep(2500);
        await shot('04-save-a-login');
        lg('FIELDS', await fields(P));
        lg('BUTTONS', (await buttons(P)).split(' | ').slice(24).join(' | '));
        lg('TEXT', (await text()).replace(/\n/g, ' / ').slice(0, 600));
        await clickLabel(P, 'Website login', { sub: true });
        await sleep(2000);
      });
      const tag = `ZZ walk ${Math.random().toString(36).slice(2, 8)}`;
      const secret = `Wk-${crypto.randomUUID()}`;
      await step('create-item', async () => {
        await typeInto(P, 'Name', tag);
        await typeInto(P, 'Username or email', 'walk-user');
        await typeInto(P, 'Password', secret);
        const web = await ev(
          P,
          `[...document.querySelectorAll('input')].filter((e) => e.getAttribute('aria-label') === 'Website' || e.placeholder === 'Website').map((e) => e.value).join()`,
        );
        lg('WEBSITE_PREFILLED', web);
        if (!web) await typeInto(P, 'Website', site.url);
        await shot('06-form-filled');
        lg('SAVE', await clickLabel(P, 'Save'));
        await sleep(4000);
        await shot('07-after-save');
        lg('TEXT', (await text()).replace(/\n/g, ' / ').slice(0, 700));
        lg('BUTTONS', (await buttons(P)).split(' | ').slice(24).join(' | '));
      });
      await step('item-with-owner-badge', async () => {
        await shot('08-item-detail-owner-badge');
      });
      await step('fill-in-browser', async () => {
        lg('MOREACTIONS', await clickLabel(P, 'More actions'));
        await sleep(800);
        lg('MENU', await menuItems(P));
        lg('SETTINGS', await clickLabel(P, 'Settings', { sel: '[role=menuitem]' }));
        await sleep(1500);
        const sw = () =>
          ev(
            P,
            `[...document.querySelectorAll('[role=switch]')].map((e) => (e.getAttribute('aria-label') || '?') + '=' + e.getAttribute('aria-checked')).join(' | ')`,
          );
        lg('SWITCHES', await sw());
        lg('TOGGLE', await clickLabel(P, 'Fill in browser', { sel: '[role=switch]' }));
        await sleep(2500);
        lg('SWITCHES', await sw());
        lg('DONE', await clickLabel(P, 'Done'));
        await sleep(800);
        await shot('08b-fill-in-browser');
      });
      await step('confirm-dialog', async () => {
        // Fault injection: the first reveal/copy is answered as the server answers a stale sign-in,
        // so the package's own "Confirm it's you" dialog opens; the retry after it goes to the real server.
        await ev(
          P,
          `(() => { const f = window.fetch; window.__armed = true; window.__urls = [];
          window.fetch = async (input, init) => { const u = String(input?.url ?? input); window.__urls.push((init?.method || 'GET') + ' ' + u.replace(/[?].*/, '').slice(-80));
            if (window.__armed && /reveal|secret|decrypt/i.test(u)) { window.__armed = false;
              return new Response(JSON.stringify({ detail: { code: 'recent_auth_required', message: 'Recent authentication required' } }), { status: 403, headers: { 'content-type': 'application/json' } }); }
            return f(input, init); }; return true; })()`,
        );
        lg('SHOW', await clickLabel(P, 'Show Password'));
        await sleep(2500);
        lg('URLS', JSON.stringify(await ev(P, 'window.__urls')));
        lg(
          'DIALOG',
          await ev(
            P,
            `[...document.querySelectorAll('[role=dialog],[role=alertdialog]')].map((d) => d.innerText.slice(0, 300)).join(' || ')`,
          ),
        );
        await shot('11a-confirm-its-you');
        lg('CONTINUE', await clickLabel(P, 'Continue with Browser'));
        let consent;
        for (let i = 0; i < 40 && !consent; i++) {
          await sleep(1000);
          consent = (await c.browserSession.send('Target.getTargets')).targetInfos.find(
            (t) => /\/oauth\/consent|\/login/.test(t.url) && /aimatrx/.test(t.url),
          );
        }
        lg('CONSENT_TARGET', consent ? consent.url.replace(/[?#].*/, '') : 'none');
        const tokinfo = () =>
          ev(
            P,
            `chrome.storage.local.get('matrx.auth.accessToken').then((r) => { const t = r['matrx.auth.accessToken']; if (!t) return null; const c = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/') + '==')); return { iat: c.iat, amr: c.amr, now: Math.floor(Date.now() / 1000) }; })`,
          );
        if (consent) {
          try {
            const cs = await attachTargetSession(c.browserSession, consent.targetId);
            await sleep(1500);
            const shotC = await cs.send('Page.captureScreenshot', { format: 'png' });
            await writeFile(
              join(SHOTS, '11c-oauth-consent.png'),
              Buffer.from(shotC.data, 'base64'),
            );
            const clicked = await cs.send('Runtime.evaluate', {
              expression: `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Authorize'); if (b) b.click(); return b ? 'clicked' : document.body.innerText.slice(0, 200); })()`,
              returnByValue: true,
            });
            lg('AUTHORIZE', JSON.stringify(clicked.result?.value));
          } catch (e) {
            lg('CONSENT_ATTACH', String(e.message));
          }
        }
        lg('TOKEN_BEFORE_WAIT', JSON.stringify(await tokinfo()));
        const t1 = Date.now();
        for (let i = 0; i < 60; i++) {
          await sleep(1000);
          const open = await ev(
            P,
            `document.querySelectorAll('[role=dialog],[role=alertdialog]').length`,
          );
          if (!open) break;
        }
        lg('CONFIRM_MS', Date.now() - t1);
        await sleep(2000);
        await shot('11b-after-continue-with-browser');
        lg('TEXT', await short(text));
        lg(
          'DIALOG',
          await ev(
            P,
            `[...document.querySelectorAll('[role=dialog],[role=alertdialog]')].map((d) => d.innerText.slice(0, 300)).join(' || ')`,
          ),
        );
      });
      await step('reveal-copy', async () => {
        lg('SHOW', await clickLabel(P, 'Show Password'));
        await sleep(2500);
        await shot('11-after-show-password');
        lg('TEXT', await short(text));
        lg(
          'DIALOG',
          await ev(
            P,
            `[...document.querySelectorAll('[role=dialog],[role=alertdialog]')].map((d) => d.innerText.slice(0, 300)).join(' || ')`,
          ),
        );
        lg('COPY', await clickLabel(P, 'Copy Password'));
        await sleep(2500);
        await shot('12-after-copy-password');
        lg(
          'DIALOG',
          await ev(
            P,
            `[...document.querySelectorAll('[role=dialog],[role=alertdialog]')].map((d) => d.innerText.slice(0, 300)).join(' || ')`,
          ),
        );
        lg('TEXT', await short(text));
      });
      await step('page-view-match', async () => {
        lg('BACK', await clickLabel(P, 'Back'));
        await sleep(1500);
        lg('SHOWMENU', await clickLabel(P, 'Show'));
        await sleep(800);
        lg('MENU', await menuItems(P));
        lg(
          'THISPAGE',
          await clickLabel(P, 'This page', {
            sel: '[role=menuitem],[role=menuitemradio],[role=option],[role=tab],button',
          }),
        );
        await sleep(4000);
        await shot('10-page-view-match');
        lg('TEXT', await short(text));
        lg('NET', JSON.stringify(await ev(P, 'window.__net')));
        lg('CHECKAGAIN', await clickLabel(P, 'Check again'));
        await sleep(4000);
        await shot('10b-page-view-after-check-again');
        lg('NET', JSON.stringify(await ev(P, 'window.__net')));
        lg('TEXT', await short(text));
        lg('BUTTONS', (await buttons(P)).split(' | ').slice(24).join(' | ').slice(0, 300));
      });
      await step('fill', async () => {
        await page.bringToFront().catch(() => {});
        await page.click('#u');
        await sleep(2500);
        await shot('13a-before-fill');
        lg('TEXT', await short(text));
        lg('BUTTONS', (await buttons(P)).split(' | ').slice(24).join(' | ').slice(0, 300));
        let ready = false;
        for (let i = 0; i < 30 && !ready; i++) {
          ready = /Fill ZZ walk/.test(await buttons(P));
          if (!ready) await sleep(1000);
        }
        lg('FILL_OFFER_READY', ready);
        await shot('13b-fill-offer');
        lg('FILL', await clickLabel(P, 'Fill ZZ walk', { sub: true }));
        await sleep(2500);
        await shot('13-after-fill');
        lg(
          'PAGEFIELDS',
          JSON.stringify(
            await page.evaluate(() => ({
              u: document.getElementById('u')?.value,
              pLen: document.getElementById('p')?.value.length,
            })),
          ),
        );
        lg('TEXT', await short(text));
      });
      await step('generator', async () => {
        lg('GEN', await clickLabel(P, 'Generate'));
        await sleep(2500);
        await shot('14-generator');
        lg('TEXT', await short(text));
        lg('BUTTONS', (await buttons(P)).split(' | ').slice(24).join(' | ').slice(0, 400));
        await clickLabel(P, 'Close').catch(() => {});
        await page.keyboard.press('Escape').catch(() => {});
      });
      await step('capture', async () => {
        await page.bringToFront().catch(() => {});
        await page.fill('#u', 'walk-user-two');
        await page.fill('#p', `Wk-${crypto.randomUUID()}`);
        await page.click('button[type=submit]');
        await sleep(6000);
        await shot('15-after-submit-capture');
        lg('TEXT', await short(text));
        lg('BUTTONS', (await buttons(P)).split(' | ').slice(24).join(' | ').slice(0, 400));
        lg('POSTS', site.seen.posts);
      });
      await step('cleanup', async () => {
        await page.goto(site.url);
        await sleep(2000);
        await clickLabel(P, 'Show');
        await sleep(600);
        await clickLabel(P, 'Every category', {
          sub: true,
          sel: '[role=menuitem],[role=menuitemradio],[role=option]',
        });
        await sleep(2500);
        lg('FIELDS', await fields(P));
        const searchLabel = (await fields(P))
          .split(' | ')
          .find((f) => /^INPUT:search/.test(f))
          ?.split(':')
          .slice(2)
          .join(':');
        for (let n = 0; n < 40; n++) {
          await typeInto(P, searchLabel, 'ZZ walk');
          await sleep(1500);
          const row = await ev(
            P,
            `(() => { const e = [...document.querySelectorAll('button,[role=option],[role=row],li,a')].filter((x) => x.getBoundingClientRect().width > 0 && /^\\W*\\w?\\s*ZZ walk/.test(x.textContent.trim()) && x.textContent.length < 120)[0]; return e ? e.textContent.trim().slice(0, 40) : null; })()`,
          );
          if (!row) break;
          const name = row.replace(/^\\W*[A-Z]?(?=ZZ walk)/, '');
          lg(
            'CLEAN_OPEN',
            row,
            await clickLabel(P, 'ZZ walk', {
              sub: true,
              sel: 'button,[role=option],[role=row],li,a',
            }),
          );
          await sleep(1800);
          await clickLabel(P, 'More actions');
          await sleep(500);
          await clickLabel(P, 'Delete', { sel: '[role=menuitem]' });
          await sleep(1000);
          if (n === 0) {
            await shot('16-delete-confirm');
            lg(
              'DIALOG',
              await ev(
                P,
                `[...document.querySelectorAll('[role=dialog],[role=alertdialog]')].map((d) => d.innerText.slice(0, 200)).join(' || ')`,
              ),
            );
          }
          const labels = await ev(
            P,
            `[...document.querySelectorAll('[role=dialog] button,[role=alertdialog] button')].map((b) => b.textContent.trim()).join('|')`,
          );
          lg('DLG_BUTTONS', labels);
          const confirmLabel = labels.split('|').find((l) => /delete|trash/i.test(l));
          if (confirmLabel)
            await clickLabel(P, confirmLabel, {
              sel: '[role=dialog] button,[role=alertdialog] button',
            });
          await sleep(2000);
        }
        lg('CLEAN_DONE', await short(text));
      });
    });
  } finally {
    site.server.close();
  }
}
