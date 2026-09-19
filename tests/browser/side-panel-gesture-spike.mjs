#!/usr/bin/env node
/**
 * WHAT CHROME ACTUALLY ALLOWS — measured, not remembered.
 *
 * Owner, 2026-09-18: *"is there a way that it could automatically open the
 * extension while on the page inside of our app so that it's open when we send
 * the user? If so, that makes more sense."*
 *
 * The answer had been written down as NO, on the grounds that
 * `chrome.sidePanel.open()` needs a user gesture and a click in our own web
 * page is not one for the extension's service worker. This run exists because
 * that claim had never been tested. It is wrong.
 *
 * ## How to read this
 *
 * A throwaway extension — not ours — with one job: receive a message and try to
 * open its side panel. A real Playwright click on a real page drives it, so the
 * gesture is a genuine trusted input event. Sixteen variants isolate ONE
 * variable each. Nothing here touches the Matrx extension, any account, or the
 * database; it is a question put to Chrome.
 *
 * ## The result (Chrome for Testing 153.0.0.0, `--headless=new`, 2026-09-19)
 *
 *   A  relay, open({tabId}) first .......................... OPENS
 *   B  relay, open({windowId}) first ....................... OPENS
 *   C  relay, tabs.create() THEN open() .................... refused
 *   D  relay, open() then navigate the tab ................. OPENS
 *   E  relay, await setTimeout(50) THEN open() ............. refused
 *   K  relay, await Promise.resolve() THEN open() .......... refused   ← one microtask
 *   L  relay, five microtasks THEN open() .................. refused
 *   M  relay, await chrome.storage.get THEN open() ......... refused
 *   N  relay, INVOKE open(), then storage + 100ms, await it  OPENS     ← the design
 *   I  relay, await sidePanel.setOptions THEN open() ....... refused
 *   H  relay, open() first then tabs.create() .............. OPENS
 *   F  page → extension DIRECTLY (externally_connectable) .. OPENS     ← no content script needed
 *   O  page awaits 30ms, then sends directly ............... OPENS
 *   O2 page awaits 2s, then sends directly ................. OPENS
 *   O3 page awaits 6s, then sends directly ................. refused   ← ~5s of page activation
 *   J  page click after the service worker went idle (45s) . OPENS     ← cold worker is fine
 *   G  no gesture at all (timer inside the worker) ......... refused
 *
 * Two laws come out of it, and both are load-bearing in shipped code:
 *
 *   1. `chrome.sidePanel.open()` must be INVOKED before the listener's first
 *      `await`. Its promise may be awaited at leisure (N). There is no slack —
 *      a single microtask is enough to lose it (K).
 *      → `src/lib/frontend-bridge/panel-gesture.ts`
 *   2. The page has ~5 seconds of transient activation to spend before it
 *      sends (O2 vs O3), so the page must not probe for the extension on the
 *      click path.
 *      → matrx-frontend `lib/extension-bridge/chrome-rpc.ts`
 *
 * A content script relay works (A, B) but is unnecessary (F), so none was
 * added: `externally_connectable` already carries the gesture.
 *
 * ## Two honest limits of this run
 *
 * - Under `--headless=new` the side panel has no UI host, so the panel
 *   DOCUMENT never loads. What is proven is Chrome's gesture verdict on the
 *   API call — which is the whole of what was in doubt — not that pixels
 *   appear. A person watching a real window is the remaining check.
 * - Chrome stable 153.0.8010.48 is installed on this machine but its build
 *   refuses `--load-extension` (Chrome ships that switch disabled outside
 *   Chrome for Testing), so the matrix ran on Chrome for Testing at the SAME
 *   milestone, 153.
 *
 * Run: `node tests/browser/side-panel-gesture-spike.mjs`
 *      `SKIP_SLOW=1 …` drops the two trials that wait 45s and 6s.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require_ = createRequire('/Users/armanisadeghi/code/matrx-frontend/package.json');
const { chromium } = require_('playwright');

const SKIP_SLOW = process.env.SKIP_SLOW === '1';
const PORT = Number(process.env.SPIKE_PORT ?? 8899);
const root = mkdtempSync(join(tmpdir(), 'panel-gesture-spike-'));

// ── The throwaway extension ────────────────────────────────────────────────
writeFileSync(
  join(root, 'manifest.json'),
  JSON.stringify({
    manifest_version: 3,
    name: 'Side panel gesture spike',
    version: '1.0',
    permissions: ['sidePanel', 'tabs', 'storage'],
    host_permissions: ['<all_urls>'],
    background: { service_worker: 'background.js' },
    side_panel: { default_path: 'panel.html' },
    action: { default_title: 'Spike' },
    content_scripts: [
      {
        matches: ['http://localhost/*', 'http://127.0.0.1/*'],
        js: ['content.js'],
        run_at: 'document_start',
      },
    ],
    externally_connectable: { matches: ['http://localhost/*', 'http://127.0.0.1/*'] },
  }),
);
writeFileSync(join(root, 'panel.html'), '<!doctype html><title>spike</title><h1>panel</h1>');
// The relay: a real click on the page, forwarded SYNCHRONOUSLY.
writeFileSync(
  join(root, 'content.js'),
  `document.addEventListener('spike:open', (ev) => {
     chrome.runtime.sendMessage({ kind: 'openPanel', ...(ev.detail || {}) }, () => void chrome.runtime.lastError);
   });`,
);
writeFileSync(
  join(root, 'background.js'),
  `async function openFor(msg, sender) {
    const out = { mode: msg.mode };
    const tabId = sender && sender.tab ? sender.tab.id : undefined;
    const windowId = sender && sender.tab ? sender.tab.windowId : undefined;
    try {
      switch (msg.mode) {
        case 'tabFirst':      await chrome.sidePanel.open({ tabId }); break;
        case 'windowFirst':   await chrome.sidePanel.open({ windowId }); break;
        case 'createThenOpen': {
          const t = await chrome.tabs.create({ url: msg.url, active: true });
          await chrome.sidePanel.open({ tabId: t.id }); break;
        }
        case 'openThenNavigate':
          await chrome.sidePanel.open({ tabId });
          await chrome.tabs.update(tabId, { url: msg.url }); break;
        case 'timeoutThenOpen':
          await new Promise((r) => setTimeout(r, 50));
          await chrome.sidePanel.open({ tabId }); break;
        case 'microtaskThenOpen':
          await Promise.resolve();
          await chrome.sidePanel.open({ tabId }); break;
        case 'fiveMicrotasksThenOpen':
          for (let i = 0; i < 5; i++) await Promise.resolve();
          await chrome.sidePanel.open({ tabId }); break;
        case 'storageThenOpen':
          await chrome.storage.local.get('nothing');
          await chrome.sidePanel.open({ tabId }); break;
        case 'setOptionsThenOpen':
          await chrome.sidePanel.setOptions({ tabId, path: 'panel.html', enabled: true });
          await chrome.sidePanel.open({ tabId }); break;
        case 'openThenCreate':
          await chrome.sidePanel.open({ tabId });
          await chrome.tabs.create({ url: msg.url, active: true }); break;
        case 'invokeThenWorkThenAwait': {
          const p = chrome.sidePanel.open({ tabId });
          await chrome.storage.local.get('nothing');
          await new Promise((r) => setTimeout(r, 100));
          await p; break;
        }
        default: await chrome.sidePanel.open({ windowId }); break;
      }
      out.opened = true; out.reason = 'opened';
    } catch (e) {
      out.opened = false; out.reason = String((e && e.message) || e);
    }
    await chrome.storage.local.set({ lastResult: out });
    return out;
  }
  chrome.runtime.onMessage.addListener((m, s, send) => {
    if (m && m.kind === 'openPanel') { openFor(m, s).then(send); return true; }
  });
  chrome.runtime.onMessageExternal.addListener((m, s, send) => {
    if (m && m.kind === 'openPanel') { openFor(m, s).then(send); return true; }
  });`,
);

// ── The page that does the clicking ────────────────────────────────────────
const PAGE = `<!doctype html><meta charset="utf-8">
<button id="relay">relay</button><button id="direct">direct</button>
<script>
  const q = new URLSearchParams(location.search);
  const mode = q.get('mode') || 'tabFirst';
  const url = 'http://localhost:${PORT}/target.html';
  document.getElementById('relay').addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('spike:open', { detail: { mode, url } }));
  });
  document.getElementById('direct').addEventListener('click', async () => {
    const d = Number(q.get('delay') || 0);
    if (d) await new Promise((r) => setTimeout(r, d));
    chrome.runtime.sendMessage(q.get('ext'), { kind: 'openPanel', mode, url }, () => void chrome.runtime.lastError);
  });
</script>`;

const srv = createServer((req, res) => {
  const path = req.url.split('?')[0];
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(path === '/target.html' ? '<!doctype html>target' : PAGE);
});
await new Promise((r) => srv.listen(PORT, r));

const ctx = await chromium.launchPersistentContext('', {
  headless: false,
  args: ['--headless=new', `--disable-extensions-except=${root}`, `--load-extension=${root}`],
  viewport: { width: 1280, height: 900 },
});
let worker =
  ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker', { timeout: 30000 }));
const extId = new URL(worker.url()).host;
const probe = await ctx.newPage();
console.log('chrome:', await probe.evaluate(() => navigator.userAgent));
await probe.close();

const results = {};
async function trial(name, { mode, how = 'relay', delay = 0, idleMs = 0 }) {
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/?ext=${extId}&mode=${mode}&delay=${delay}`);
  await worker.evaluate(() => chrome.storage.local.remove('lastResult'));
  if (idleMs) await page.waitForTimeout(idleMs);
  await page.click(how === 'direct' ? '#direct' : '#relay').catch(() => {});
  await page.waitForTimeout(2000 + delay);
  worker = ctx.serviceWorkers()[0] ?? worker; // it may have been restarted
  const { lastResult } = await worker.evaluate(() => chrome.storage.local.get('lastResult'));
  results[name] = lastResult ?? null;
  console.log(
    `${name.padEnd(42)} ${lastResult?.opened ? 'OPENS  ' : 'refused'}  ${lastResult?.opened ? '' : (lastResult?.reason ?? 'no answer')}`,
  );
  await page.close().catch(() => {});
}

await trial('A  relay, open({tabId}) first', { mode: 'tabFirst' });
await trial('B  relay, open({windowId}) first', { mode: 'windowFirst' });
await trial('C  relay, tabs.create THEN open', { mode: 'createThenOpen' });
await trial('D  relay, open then navigate', { mode: 'openThenNavigate' });
await trial('E  relay, setTimeout(50) THEN open', { mode: 'timeoutThenOpen' });
await trial('K  relay, ONE microtask THEN open', { mode: 'microtaskThenOpen' });
await trial('L  relay, five microtasks THEN open', { mode: 'fiveMicrotasksThenOpen' });
await trial('M  relay, storage.get THEN open', { mode: 'storageThenOpen' });
await trial('I  relay, setOptions THEN open', { mode: 'setOptionsThenOpen' });
await trial('H  relay, open THEN tabs.create', { mode: 'openThenCreate' });
await trial('N  relay, invoke, work, await last', { mode: 'invokeThenWorkThenAwait' });
await trial('F  page direct (externally_connectable)', { mode: 'windowFirst', how: 'direct' });
await trial('O  page awaits 30ms, then direct', { mode: 'windowFirst', how: 'direct', delay: 30 });
if (!SKIP_SLOW) {
  await trial('O2 page awaits 2s, then direct', {
    mode: 'windowFirst',
    how: 'direct',
    delay: 2000,
  });
  await trial('O3 page awaits 6s, then direct', {
    mode: 'windowFirst',
    how: 'direct',
    delay: 6000,
  });
  await trial('J  cold service worker (45s idle)', { mode: 'tabFirst', idleMs: 45000 });
}

const g = await worker.evaluate(async () => {
  const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  try {
    await chrome.sidePanel.open({ windowId: t.windowId });
    return { opened: true, reason: 'opened' };
  } catch (e) {
    return { opened: false, reason: String(e.message || e) };
  }
});
results['G  no gesture at all'] = g;
console.log(`${'G  no gesture at all'.padEnd(42)} ${g.opened ? 'OPENS  ' : 'refused'}`);

await ctx.close();
srv.close();

// The two laws this file exists to state. If either flips, the shipped design
// is wrong and this run must fail loudly rather than print a nice table.
const must = (name, want) => {
  const got = results[Object.keys(results).find((k) => k.startsWith(name))];
  if (!got || got.opened !== want) {
    console.error(`\nLAW BROKEN: ${name} expected ${want ? 'OPENS' : 'refused'}, got`, got);
    process.exitCode = 1;
  }
};
must('F ', true); // a page's own click reaches us as a gesture
must('N ', true); // invoke first, await later
must('K ', false); // one microtask is already too late
must('G ', false); // and no gesture is still no
if (!process.exitCode) console.log('\nboth laws hold.');
