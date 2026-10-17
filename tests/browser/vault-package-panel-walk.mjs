#!/usr/bin/env node
/**
 * Real-browser walk of the Vault tab now that it is the shared @ai-matrx/vault
 * workspace. Owned disposable profile, admin@admin.com, role/label selectors.
 * Usage: MATRX_VAULT_WALK_RECEIPT=<local-dev receipt> MATRX_VAULT_WALK_SHOTS=<dir> node vault-package-panel-walk.mjs [step...]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import http from 'node:http';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { signInSettings } from './settings-native-auth-driver.mjs';

const REPO = resolve(import.meta.dirname, '..', '..');
const RECEIPT = process.env.MATRX_VAULT_WALK_RECEIPT ?? join(REPO, 'test-results', 'vault-walk-receipt.json');
const SHOTS = process.env.MATRX_VAULT_WALK_SHOTS ?? join(REPO, 'test-results', 'vault-walk');
const WEB = 'https://www.aimatrx.com';
const log = (...a) => process.stderr.write(`${a.join(' ')}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ev = async (panel, expression) => {
  const r = await panel.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`eval: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result?.value;
};
const shot = async (panel, name) => {
  const s = await panel.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(SHOTS, `${name}.png`), Buffer.from(s.data, 'base64'));
  log('shot', name);
};
const text = (panel) => ev(panel, 'document.body.innerText');
/** Trusted click at the centre of the first visible element matching `label` (name = aria-label, title or text). */
const clickLabel = async (panel, label, { sub = false, sel = 'button,[role=button],[role=tab],[role=menuitem],[role=menuitemradio],[role=option],a,summary,[role=checkbox],[role=switch]', nth = 0 } = {}) => {
  const pt = await ev(panel, `(() => {
    const L = ${JSON.stringify(label)}, sub = ${sub};
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.closest('[inert]'); };
    const nm = (e) => (e.getAttribute('aria-label') || e.getAttribute('title') || e.getAttribute('data-matrx-title') || e.textContent || '').trim();
    const els = [...document.querySelectorAll(${JSON.stringify(sel)})].filter(vis).filter((e) => sub ? nm(e).includes(L) : nm(e) === L);
    const el = els[${nth}];
    if (!el) return null; el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (!pt) return false;
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
    await panel.send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 });
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
      await walk({ ...ctx, ev: (e) => ev(panel, e), shot: (n) => shot(panel, n), text: () => text(panel), clickLabel: (l, o) => clickLabel(panel, l, o), waitText: (r, ms) => waitText(panel, r, ms), sleep, log });
    },
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main(async ({ shot, text, log }) => {
    await sleep(15000);
    await shot('01-vault-open');
    log((await text()).slice(0, 1500));
  });
}
