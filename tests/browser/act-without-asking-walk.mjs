#!/usr/bin/env node
/**
 * ACT-WITHOUT-ASKING WALK (Current chat AND New chat), zero AI spend.
 *
 * Loads the BUILT extension in headless Chromium, signs in as admin@admin.com, and points the
 * extension's backend at a local mock server that answers the agent/mandate start with a recorded-
 * shape NDJSON stream (aidream chat corpus format: `{event, data, stream_seq, stream_id}`) carrying
 * three `tool_delegated` events: a browser action tool, a privileged tool, and the agent's own
 * `user` question. Nothing reaches a real model: the mock answers every AI POST and every
 * request to the real aidream hosts is aborted.
 *
 *   Act ON  -> no approval card, both tools execute (their results are POSTed to /tool_results),
 *              the agent's `user` question still waits.
 *   Act OFF -> approval cards appear and nothing executes until answered.
 *
 *   WXT_OUT_DIR=.output pnpm build && node tests/browser/act-without-asking-walk.mjs
 *   (MATRX_PLAYWRIGHT_MODULE / MATRX_CHROME_PATH as for every walk.)
 * The New chat hops through `tool:device-invoke`; the SW gate admits the extension's own pages even with a tab.
 */
import { readFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBrowserRuntime } from './browser-runtime.mjs';
import {
  extensionOAuthClientId,
  readEnvFile,
  seedExtensionSession,
} from './seed-extension-session.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const OUT = process.env.WXT_OUT_DIR || '.output';
const EXTENSION_DIR = join(REPO, OUT, 'chrome-mv3');
const SHOTS = join(REPO, OUT, 'act-without-asking-walk');
const ORGANIZATION_ID = '884d1ce8-7b49-4fba-a2f3-0f7dd7c83d4f';

const env = { ...readEnvFile(join(REPO, '.env')), ...readEnvFile(join(REPO, '.env.development')) };
const aidreamEnv = readEnvFile(join(resolve(REPO, '..'), 'aidream', '.env'));
const supabaseUrl = env.WXT_SUPABASE_URL;
const publishableKey = env.WXT_SUPABASE_PUBLISHABLE_KEY ?? env.WXT_SUPABASE_ANON_KEY;
if (
  !supabaseUrl ||
  !publishableKey ||
  !aidreamEnv.AI_ADMIN_USERNAME ||
  !aidreamEnv.AI_ADMIN_PASSWORD
) {
  console.error('REFUSED: missing WXT_SUPABASE_* or AI_ADMIN_* env');
  process.exit(1);
}
const signIn = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: publishableKey },
  body: JSON.stringify({
    email: aidreamEnv.AI_ADMIN_USERNAME,
    password: aidreamEnv.AI_ADMIN_PASSWORD,
  }),
});
if (!signIn.ok) {
  console.error(`REFUSED: sign-in ${signIn.status}`);
  process.exit(1);
}
const session = await signIn.json();
mkdirSync(SHOTS, { recursive: true });

// ── The mock aidream server ────────────────────────────────────────────────────────────────
// Recorded GET /mandates/extend.browser_chat/resolution (read-only; the package resolves its agent from it).
const MANDATE_RESOLUTION = readFileSync(
  join(HERE, 'fixtures', 'mandate-resolution-extend-browser-chat.json'),
  'utf8',
);
const posted = { starts: [], toolResults: [] };
let runNo = 0; // call ids are unique per run: the service worker de-duplicates a call id it has already run
const STREAM_ID = 'walk-stream';
const line = (seq, event, data) =>
  `${JSON.stringify({ event, data, stream_seq: seq, stream_id: STREAM_ID })}\n`;
const delegated = (callId, toolName, args, seq) =>
  line(seq, 'tool_event', {
    event: 'tool_delegated',
    call_id: callId,
    tool_name: toolName,
    timestamp: Date.now() / 1000,
    message: 'Delegated to the browser',
    show_spinner: true,
    data: { arguments: args },
  });
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': '*',
  'Access-Control-Expose-Headers': '*',
};
const mock = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end();
  let body = '';
  req.on('data', (c) => {
    body += c;
  });
  req.on('end', () => {
    if (process.env.WALK_DEBUG) console.log('  [mock]', req.method, req.url);
    if (req.method === 'POST' && /\/ai\/(agent|agents|mandates)\//.test(path)) {
      const parsed = (() => {
        try {
          return JSON.parse(body);
        } catch {
          return {};
        }
      })();
      const conversationId = parsed.conversation_id ?? 'walk-conversation';
      posted.starts.push({ path, conversationId });
      const n = ++runNo;
      res.writeHead(200, {
        ...CORS,
        'content-type': 'application/x-ndjson',
        'X-Conversation-ID': conversationId,
        'X-Request-ID': 'walk-request',
      });
      let seq = 1;
      res.write(line(seq++, 'phase', { phase: 'connected' }));
      res.write(line(seq++, 'data', { type: 'conversation_id', conversation_id: conversationId }));
      res.write(line(seq++, 'phase', { phase: 'processing' }));
      const urid = `walk-urid-${n}`;
      res.write(
        line(seq++, 'record_reserved', {
          db_project: 'main',
          table: 'request',
          record_id: urid,
          status: 'pending',
          parent_refs: { conversation_id: conversationId, user_request_id: urid },
          metadata: { iteration: 1 },
        }),
      );
      res.write(
        line(seq++, 'record_reserved', {
          db_project: 'main',
          table: 'message',
          record_id: `walk-msg-${n}`,
          status: 'pending',
          parent_refs: { conversation_id: conversationId, user_request_id: urid },
          metadata: { role: 'assistant', position: 1 },
        }),
      );
      res.write(line(seq++, 'chunk', { text: 'Working on three things.' }));
      res.write(
        delegated(
          `walk-act-${n}`,
          'save_guidance_note',
          { domain: 'example.com', text: 'walk' },
          seq++,
        ),
      );
      res.write(delegated(`walk-priv-${n}`, 'inject_stylesheet', { css: 'body{}' }, seq++));
      res.write(
        delegated(
          `walk-user-${n}`,
          'user',
          { type: 'confirm', question: 'Walk question: continue?' },
          seq++,
        ),
      );
      const beat = setInterval(
        () => res.write(line(seq++, 'heartbeat', { timestamp: Date.now() / 1000, seq })),
        1000,
      );
      res.on('close', () => clearInterval(beat));
      return; // the stream stays open: the agent is waiting on its own question
    }
    if (req.method === 'POST' && /\/tool_results/.test(path)) {
      let parsed = {};
      try {
        parsed = JSON.parse(body);
      } catch {}
      posted.toolResults.push(parsed);
      return res
        .writeHead(200, { ...CORS, 'content-type': 'application/json' })
        .end(JSON.stringify({ ok: true, continuation_needed: false }));
    }
    if (req.method === 'GET' && /\/mandates\/extend\.browser_chat\/resolution$/.test(path)) {
      return res
        .writeHead(200, { ...CORS, 'content-type': 'application/json' })
        .end(MANDATE_RESOLUTION);
    }
    res.writeHead(200, { ...CORS, 'content-type': 'application/json' }).end('{}');
  });
});
await new Promise((r) => mock.listen(0, '127.0.0.1', r));
const MOCK_URL = `http://127.0.0.1:${mock.address().port}`;

// ── Browser ────────────────────────────────────────────────────────────────────────────────
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
// AI SPEND: every POST to a real aidream host is aborted (the mock owns the AI endpoints).
const abortedPosts = [];
await context.route('**/*', (route) => {
  const req = route.request();
  const u = new URL(req.url());
  if (
    req.method() === 'POST' &&
    /matrxserver\.com|aimatrx\.com/.test(u.host) &&
    !/supabase|\/auth\/|\/rest\//.test(req.url())
  ) {
    abortedPosts.push(req.url());
    return route.abort();
  }
  return route.continue();
});
// The New chat's only hop to the service worker is `tool:device-invoke`; record what it sends.
await context.addInitScript(() => {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
  window.__invokes = [];
  const original = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = (...args) => {
    const m = args.find((a) => a && typeof a === 'object' && a.kind);
    if (m?.kind === 'tool:device-invoke') {
      window.__invokes.push({
        tool: m.payload?.toolName,
        mode: m.payload?.permissionMode,
        callId: m.payload?.callId,
      });
    }
    return original(...args);
  };
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
  if (process.env.WALK_DEBUG)
    worker.on('console', (m) => console.log('  [sw]', m.text().slice(0, 240)));
  const SETTINGS = 'matrx.settings.v1';
  const configure = async (page, patch) =>
    page.evaluate(
      async ([key, p, mockUrl]) => {
        const cur = (await chrome.storage.local.get([key]))[key];
        const parsed = cur ? JSON.parse(cur) : { state: {}, version: 0 };
        parsed.state = { ...parsed.state, ...p };
        await chrome.storage.local.set({
          [key]: JSON.stringify(parsed),
          'matrx.backend.env': 'local',
          'matrx.backend.urlOverride': mockUrl,
        });
      },
      [SETTINGS, patch, MOCK_URL],
    );

  for (const surface of ['default', 'package']) {
    for (const mode of ['act', 'ask']) {
      const label = `${surface === 'default' ? 'Current' : 'New'} chat, Act ${mode === 'act' ? 'ON' : 'OFF'}`;
      posted.toolResults.length = 0;
      const startedBefore = runNo;
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
      await seedExtensionSession(page, {
        session,
        clientId: extensionOAuthClientId(REPO),
        organization: { id: ORGANIZATION_ID, name: "Admin's Workspace" },
      });
      await configure(page, { chatSurface: surface, defaultPermissionMode: mode });
      await page.reload();
      await page.evaluate(() => {
        window.__seen = [];
        chrome.runtime.onMessage.addListener((m) => {
          if (m?.__matrx) window.__seen.push(m.kind);
        });
      });
      const isPackage =
        (await page.locator('[data-package-chat]').count()) > 0 ||
        (await page
          .locator('[data-package-chat]')
          .first()
          .waitFor({ timeout: 15_000 })
          .then(() => true)
          .catch(() => false));
      check(`${label}: the expected chat is showing`, isPackage === (surface === 'package'));
      const composer = page
        .locator(
          surface === 'package' ? '[data-package-chat] textarea:not([readonly])' : 'textarea',
        )
        .first();
      await composer.waitFor({ timeout: 30_000 }).catch(async (e) => {
        await page.screenshot({ path: join(SHOTS, `${surface}-${mode}-no-composer.png`) });
        throw e;
      });
      await composer.fill('walk: do the three things');
      await composer.press('Enter');
      // Let the stream arrive and the gate decide.
      await page.waitForTimeout(surface === "package" ? 20_000 : 8000);
      const seen = await page.evaluate(() => [...window.__seen]);
      const approvalButtons = await page
        .getByRole('button', { name: /^(Approve|Allow|Allow once|Allow always)/i })
        .count();
      const questionShown = (await page.getByText('Walk question: continue?').count()) > 0;
      const resultFor = (id) => posted.toolResults.find((r) => JSON.stringify(r).includes(id));
      const started = runNo > startedBefore;
      check(`${label}: the mocked run started`, started, `run ${runNo}`);
      const confirmCard = seen.includes('tool:confirm-request') || approvalButtons > 0;
      if (mode === 'act') {
        check(
          `${label}: no approval card`,
          !confirmCard,
          `msgs=${[...new Set(seen)].join(',')} buttons=${approvalButtons}`,
        );
        check(
          `${label}: browser action tool executed`,
          Boolean(resultFor(`walk-act-${runNo}`)) &&
            !resultFor(`walk-act-${runNo}`)?.results?.[0]?.is_error,
          JSON.stringify(resultFor(`walk-act-${runNo}`))?.slice(0, 120),
        );
        check(
          `${label}: privileged tool ran (not held for approval)`,
          Boolean(resultFor(`walk-priv-${runNo}`)),
          JSON.stringify(resultFor(`walk-priv-${runNo}`))?.slice(0, 120),
        );
        check(
          `${label}: the agent's question still waits`,
          questionShown && !resultFor(`walk-user-${runNo}`),
          `shown=${questionShown}`,
        );
      } else {
        check(
          `${label}: approval cards appear`,
          confirmCard,
          `msgs=${[...new Set(seen)].join(',')} buttons=${approvalButtons}`,
        );
        check(
          `${label}: nothing ran before approval`,
          !resultFor(`walk-act-${runNo}`) && !resultFor(`walk-priv-${runNo}`),
          `results=${posted.toolResults.length}`,
        );
      }
      if (surface === 'package') {
        // New chat: also prove what it SENDS into the gate: the person's choice.
        const invokes = await page.evaluate(() => window.__invokes ?? []);
        const mine = invokes.filter(
          (i) => i.callId?.endsWith(`-${runNo}`) || String(i.callId).includes(`${runNo}`),
        );
        const want = mode === 'act' ? 'act' : 'ask';
        check(
          `${label}: the chat hands all three calls to the gate`,
          ['save_guidance_note', 'inject_stylesheet', 'user'].every((t) =>
            mine.some((i) => i.tool === t),
          ),
          mine.map((i) => `${i.tool}:${i.mode}`).join(' '),
        );
        check(
          `${label}: every call carries permissionMode=${want}`,
          mine.length >= 3 && mine.every((i) => i.mode === want),
        );
      }
      if (process.env.WALK_DEBUG)
        console.log('  [page]', (await page.locator('body').innerText()).slice(0, 600).replace(/\n+/g, ' | '));
      if (process.env.WALK_DEBUG)
        console.log('  [results]', JSON.stringify(posted.toolResults).slice(0, 1200));
      await page.screenshot({ path: join(SHOTS, `${surface}-${mode}.png`) });
      if (errors.length)
        console.log(`  page errors (${label}): ${errors.slice(0, 2).join(' | ').slice(0, 300)}`);
      await page.close();
    }
  }
} finally {
  await context.close();
  mock.closeAllConnections?.();
  mock.close();
}
console.log(`  aborted real-host POSTs: ${abortedPosts.length}`);
console.log(`  screenshots ${SHOTS}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
