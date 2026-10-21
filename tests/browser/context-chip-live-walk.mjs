#!/usr/bin/env node
/**
 * CONTEXT VALUE CHIP — LIVE WALK (real server, real receipt).
 *
 * Loads the BUILT extension in headless Chromium (`--headless=new`, persistent profile in a
 * temp dir), signs in as admin@admin.com, opens a Wikipedia article in a normal tab and the
 * extension's Chat page beside it in the same window (the article stays the active tab, as it is
 * with the real side panel), then walks the composer's value chip against the LIVE aidream server:
 *
 *   1. the chip lists the page's values with switches, plus User / Client / Organization;
 *   2. turn one page value off, send → the server's receipt says that value was off; chip not amber;
 *   3. turn it back on, send → the receipt says it was sent; chip not amber;
 *   4. the persisted receipt (chat.message.model_context.delivery.receipt) is printed for the
 *      owner to read back with SQL.
 *
 *   WXT_OUT_DIR=<dir> pnpm build && WXT_OUT_DIR=<dir> SHOTS=<dir> \
 *     MATRX_PLAYWRIGHT_MODULE=<playwright/index.mjs> node tests/browser/context-chip-live-walk.mjs
 *
 * SPENDS: two short turns on the chat's own agent (the extension's browser-chat mandate).
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
const OUT = process.env.WXT_OUT_DIR || join(REPO, '.output');
const EXTENSION_DIR = join(OUT, 'chrome-mv3');
const SHOTS = process.env.SHOTS || join(OUT, 'context-chip-live-walk');
const ARTICLE = process.env.WALK_ARTICLE || 'https://en.wikipedia.org/wiki/Lighthouse';
const STEP = process.env.WALK_STEP || 'all';
mkdirSync(SHOTS, { recursive: true });

const env = { ...readEnvFile(join(REPO, '.env')), ...readEnvFile(join(REPO, '.env.development')) };
const aidreamEnv = readEnvFile(join(resolve(REPO, '..'), 'aidream', '.env'));
const supabaseUrl = env.WXT_SUPABASE_URL;
const publishableKey = env.WXT_SUPABASE_PUBLISHABLE_KEY;
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
if (session.user?.email !== 'admin@admin.com') {
  console.error(`REFUSED: signed in as ${session.user?.email}, not the test account`);
  process.exit(1);
}
console.log(`  identity: ${session.user.email} (${session.user.id})`);
const rest = (path) =>
  fetch(`${supabaseUrl}/rest/v1/${path}`, {
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${session.access_token}`,
      'Accept-Profile': 'users',
    },
  }).then((r) => r.json());

const ORGANIZATION_ID = process.env.WALK_ORG_ID || '884d1ce8-7b49-4fba-a2f3-0f7dd7c83d4f';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const { chromium, executablePath } = await resolveBrowserRuntime();
const profile = mkdtempSync(join(tmpdir(), 'ctx-chip-walk-'));
const context = await chromium.launchPersistentContext(profile, {
  executablePath,
  headless: true,
  viewport: { width: 460, height: 960 },
  args: [
    '--headless=new',
    `--disable-extensions-except=${EXTENSION_DIR}`,
    `--load-extension=${EXTENSION_DIR}`,
  ],
});
const net = [];
context.on('request', (req) => {
  const u = req.url();
  if (/matrxserver\.com|aimatrx\.com/.test(u) && !/supabase|db\.matrxserver/.test(u))
    net.push(`${req.method()} ${u.slice(0, 160)}`);
});
/** Each chip row's resolved row (React props), read off the rendered table. */
const dumpRows = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[role=row][data-key]')].map((el) => {
      const fk = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
      let f = fk ? el[fk] : null;
      while (f && !f.memoizedProps?.row) f = f.return;
      const r = f?.memoizedProps?.row ?? {};
      return {
        key: r.key,
        surfaceKey: r.surfaceKey,
        origin: r.origin,
        include: r.include,
        delivery: r.delivery,
        chars: r.chars,
        decided_by: r.decided_by,
        user_rule: r.user_rule,
        layers: r.layers,
      };
    }),
  );
const shot = async (page, name) => {
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
  console.log(`  shot ${join(SHOTS, `${name}.png`)}`);
};

try {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
  const extensionId = new URL(worker.url()).host;
  console.log(`  extension ${extensionId}`);

  const web = context.pages()[0] ?? (await context.newPage());
  await web.goto(ARTICLE, { waitUntil: 'domcontentloaded' });

  const panel = await context.newPage();
  const pageErrors = [];
  panel.on('pageerror', (e) => pageErrors.push(String(e)));
  panel.on('console', (m) => {
    if (process.env.WALK_DEBUG && m.type() !== 'debug')
      console.log(`  [panel ${m.type()}]`, m.text().slice(0, 300));
  });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await seedExtensionSession(panel, {
    session,
    clientId: extensionOAuthClientId(REPO),
    organization: { id: ORGANIZATION_ID, name: "Admin's Workspace" },
  });
  await panel.reload();
  // The article is the active tab of the panel's window, as with the real side panel.
  const focusArticle = () =>
    panel.evaluate(async (url) => {
      const [tab] = await chrome.tabs.query({ url: `${url}*` });
      if (tab?.id) await chrome.tabs.update(tab.id, { active: true });
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      return active?.url ?? null;
    }, ARTICLE);
  const activeUrl = await focusArticle();
  check(
    'the article is the active tab beside the panel',
    activeUrl?.startsWith(ARTICLE),
    activeUrl,
  );

  await panel
    .locator('[data-package-chat]')
    .first()
    .waitFor({ timeout: 30_000 })
    .catch(() => {});
  await panel.waitForTimeout(6000);
  await shot(panel, '01-panel');
  console.log(
    '  [panel text]',
    (await panel.locator('body').innerText()).slice(0, 1500).replace(/\n+/g, ' | '),
  );
  if (STEP === 'look') {
    const chip = panel.locator('button[aria-label$=" included"]');
    console.log(
      '  chip candidates',
      await chip.count(),
      await chip.first().getAttribute('aria-label'),
    );
    await chip.first().click();
    await panel.waitForTimeout(2500);
    await shot(panel, '02-chip-open');
    console.log(
      '  [chip text]',
      (
        await panel
          .locator('[role=dialog],[data-radix-popper-content-wrapper]')
          .first()
          .innerText()
          .catch(() => '?')
      )
        .replace(/\n+/g, ' | ')
        .slice(0, 2500),
    );
    console.log('  [rows]', JSON.stringify(await dumpRows(panel), null, 0).slice(0, 6000));
    await panel.keyboard.press('Escape');
    await panel
      .getByText(/Matrx Browser Agent/)
      .first()
      .click();
    await panel.waitForTimeout(2500);
    await shot(panel, '03-agent-picker');
    await panel
      .getByText(/^Model: /)
      .first()
      .click();
    await panel.waitForTimeout(2500);
    await shot(panel, '04-model-picker');
    console.log(
      '  [models]',
      (await panel.locator('body').innerText()).replace(/\n+/g, ' | ').slice(0, 4000),
    );
    console.log(
      '  [picker]',
      (await panel.locator('body').innerText()).replace(/\n+/g, ' | ').slice(0, 2500),
    );
    process.exit(0);
  }

  // ── The walk ────────────────────────────────────────────────────────────────────────────
  const TARGET = process.env.WALK_VALUE || 'page_meta';
  const MODEL = process.env.WALK_MODEL || 'Gemini 3.8 Flash';
  const face = () => panel.locator('button[aria-label$=" included"]:visible').first();
  const openChip = async () => {
    await face().click();
    await panel.locator('[role=row][data-key]').first().waitFor({ timeout: 15_000 });
    await panel.waitForTimeout(800);
  };
  const closeChip = async () => {
    await panel.keyboard.press('Escape');
    await panel.waitForTimeout(500);
  };
  const rowOf = async (key) => (await dumpRows(panel)).find((r) => r.key === key);
  const savedRule = async () => {
    const rows = await rest(
      `user_surface_state?select=surface_key,state&feature=eq.context_rules&deleted_at=is.null&user_id=eq.${session.user.id}`,
    );
    return Object.fromEntries(rows.map((r) => [r.surface_key, r.state?.[TARGET] ?? null]));
  };
  const chatRest = (path) =>
    fetch(`${supabaseUrl}/rest/v1/${path}`, {
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${session.access_token}`,
        'Accept-Profile': 'chat',
      },
    }).then((r) => r.json());
  const RUN = Date.now().toString(36);
  const persistedReceipt = async (text) => {
    for (let i = 0; i < 30; i++) {
      const msgs = await chatRest(
        `message?select=id,conversation_id,position,model_context&role=eq.user&content->0->>text=eq.${encodeURIComponent(text)}&limit=1`,
      );
      const m = Array.isArray(msgs) ? msgs[0] : null;
      const receipt = m?.model_context?.delivery?.receipt;
      if (receipt)
        return { id: m.id, conversationId: m.conversation_id, position: m.position, receipt };
      await new Promise((r) => setTimeout(r, 2000));
    }
    return null;
  };
  /** True when any visible chip face is amber; with the chip's mismatches (React props). */
  const amber = () =>
    panel.evaluate(() => {
      const faces = [...document.querySelectorAll('button[aria-label$=" included"]')].filter(
        (el) => el.offsetParent !== null,
      );
      const out = {
        amber: faces.some((f) => f.getAttribute('data-mismatch') === 'true'),
        mismatches: null,
      };
      for (const el of faces) {
        const fk = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
        let f = fk ? el[fk] : null;
        while (f && !Array.isArray(f.memoizedProps?.mismatches)) f = f.return;
        if (f) out.mismatches = f.memoizedProps.mismatches;
      }
      return out;
    });
  const pickModel = async () => {
    await panel
      .getByText(/Matrx Browser Agent ·/)
      .first()
      .click();
    await panel
      .getByText(/^Model: /)
      .first()
      .click();
    await panel.waitForTimeout(1200);
    // One message only: the conversation's own model is left as it was.
    const only = panel.getByRole('switch', { name: /This message only/i }).first();
    if ((await only.count()) && (await only.getAttribute('aria-checked')) !== 'true')
      await only.click();
    await panel
      .getByPlaceholder(/Search models/i)
      .first()
      .fill(MODEL);
    await panel.waitForTimeout(800);
    if (STEP === 'model') await shot(panel, '05a-model-search');
    const option = panel.getByRole('row', { name: new RegExp(MODEL) }).first();
    await ((await option.count())
      ? option
      : panel.locator(`text="${MODEL}" >> visible=true`).first()
    ).click();
    await panel.waitForTimeout(1200);
    if (STEP === 'model') await shot(panel, '05b-model-clicked');
    await panel
      .getByRole('button', { name: /^Select model$/ })
      .first()
      .click();
    await panel.waitForTimeout(1200);
    await panel.keyboard.press('Escape').catch(() => {});
    await panel.waitForTimeout(500);
    return (
      (await panel
        .getByText(/Matrx Browser Agent ·/)
        .first()
        .innerText()
        .catch(() => '')) || ''
    );
  };
  if (STEP === 'model') {
    console.log('  picked:', await pickModel());
    await shot(panel, '05-model-picked');
    process.exit(0);
  }
  const send = async (text, n) => {
    const modelLabel = await pickModel();
    check(`send ${n}: cheap model chosen`, modelLabel.includes(MODEL), modelLabel);
    const composer = panel.locator('[data-package-chat] textarea:not([readonly])').first();
    await composer.fill(text);
    await composer.press('Enter');
    await panel.waitForURL(/\/chat\/[0-9a-f-]{36}/, { timeout: 30_000 }).catch(() => {});
    // Wait for the run to finish: the reply shows and no stop control remains.
    for (let i = 0; i < 45; i++) {
      await panel.waitForTimeout(2000);
      const stopping = await panel.getByRole('button', { name: /^Stop/i }).count();
      const body = await panel.locator('[data-package-chat]').innerText();
      if (!stopping && /\bok\b/i.test(body.split(text).slice(1).join(' '))) break;
    }
    await panel.waitForTimeout(2000);
  };
  // 1. The chip lists the page's values with switches, plus identity.
  await openChip();
  const rows = await dumpRows(panel);
  await shot(panel, '10-chip-before');
  const pageRows = rows.filter((r) => r.origin === 'page');
  check('chip lists the page values', pageRows.length >= 3, pageRows.map((r) => r.key).join(','));
  const switches = await panel.getByRole('switch', { name: /^Include / }).count();
  check(
    'every value has a switch',
    switches >= rows.length,
    `${switches} switches / ${rows.length} rows`,
  );
  for (const key of ['user', 'client', 'organization'])
    check(
      `identity row ${key} shown`,
      rows.some((r) => r.key === key),
    );
  const target = rows.find((r) => r.key === TARGET);
  check(
    `target value ${TARGET} is on before the walk`,
    target?.include === true,
    JSON.stringify(target?.decided_by),
  );
  if (process.env.WALK_DEBUG) console.log('  [rows before]', JSON.stringify(rows));

  // 2. Turn it off; the rule is saved where the server reads it.
  const label = (await panel.locator(`[role=row][data-key="${TARGET}"]`).first().innerText()).split(
    '\n',
  )[0];
  await panel
    .getByRole('switch', { name: `Include ${label}` })
    .first()
    .click();
  await panel.waitForTimeout(2500);
  check(`${TARGET} shows off at once`, (await rowOf(TARGET))?.include === false);
  const ruleOff = await savedRule();
  check(
    'the off rule is saved for the server',
    Object.values(ruleOff).some((r) => r?.include === false),
    JSON.stringify(ruleOff),
  );
  await shot(panel, '11-chip-off');
  await closeChip();

  // 3. Send; the receipt says off; the chip is not amber.
  const TEXT1 = `Reply with exactly the word ok and nothing else. (walk ${RUN}-1)`;
  await send(TEXT1, 1);
  await shot(panel, '12-after-send-1');
  const first = await persistedReceipt(TEXT1);
  const conversationId = first?.conversationId ?? null;
  console.log(`  conversation ${conversationId}`);
  const r1 = first?.receipt?.rows?.find((r) => r.key === TARGET);
  console.log(`  receipt 1 message ${first?.id} ${TARGET}:`, JSON.stringify(r1));
  check(
    `receipt 1: ${TARGET} was off`,
    r1?.include === false && r1?.delivery === 'off',
    JSON.stringify(r1 && { include: r1.include, delivery: r1.delivery, decided_by: r1.decided_by }),
  );
  const amber1 = await amber();
  check('chip 1 not amber', !amber1.amber, JSON.stringify(amber1.mismatches));
  check(
    'turn 1 carried the page',
    (first?.receipt?.rows ?? []).some((r) => r.key === 'page_brief' && r.include),
    'page_brief on receipt 1',
  );

  // 4. Back on; send; the receipt says sent.
  await openChip();
  await panel
    .getByRole('switch', { name: `Include ${label}` })
    .first()
    .click();
  await panel.waitForTimeout(2500);
  check(`${TARGET} shows on at once`, (await rowOf(TARGET))?.include === true);
  await closeChip();
  const TEXT2 = `Reply with exactly the word ok again and nothing else. (walk ${RUN}-2)`;
  await send(TEXT2, 2);
  await shot(panel, '13-after-send-2');
  const second = await persistedReceipt(TEXT2);
  const r2 = second?.receipt?.rows?.find((r) => r.key === TARGET);
  console.log(`  receipt 2 message ${second?.id} ${TARGET}:`, JSON.stringify(r2));
  check(
    `receipt 2: ${TARGET} was sent`,
    r2?.include === true && ['inline', 'on_request'].includes(r2?.delivery),
    JSON.stringify(r2 && { include: r2.include, delivery: r2.delivery }),
  );
  const amber2 = await amber();
  check('chip 2 not amber', !amber2.amber, JSON.stringify(amber2.mismatches));

  // 5. Open a value on the sent message to see exactly what was delivered (viewer API).
  const badges = panel.getByRole('button', { name: /\d+ sent/ });
  console.log('  [sent badges]', await badges.allInnerTexts());
  await badges.last().click();
  await panel.waitForTimeout(1500);
  await shot(panel, '14-sent-values');
  const pageBriefRow = panel.locator('[role=row][data-key="page_brief"] button').last();
  await pageBriefRow
    .click()
    .catch((e) => console.log('  no page_brief row on the sent message', String(e).slice(0, 120)));
  await panel.waitForTimeout(5000);
  await shot(panel, '15-value-opened');
  const viewerText = (await panel.locator('body').innerText()).replace(/\n+/g, ' | ');
  const at = viewerText.search(/Lighthouse/i);
  console.log('  [viewer]', viewerText.slice(Math.max(0, at - 300), at + 500));
  check(
    'opening a value shows the delivered text',
    at >= 0 && /wikipedia|lighthouse/i.test(viewerText.slice(at, at + 2000)),
  );
  writeFileSync(
    join(SHOTS, 'receipts.json'),
    JSON.stringify({ conversationId, first, second }, null, 2),
  );
} finally {
  writeFileSync(join(SHOTS, 'network.txt'), net.join('\n'));
  await context.close();
}
console.log(`  screenshots ${SHOTS}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
