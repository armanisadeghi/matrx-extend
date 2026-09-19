#!/usr/bin/env node
/**
 * THE REAL TURN: the extension, in a real browser, reading and writing this
 * organization's custom records through the record store's own doors.
 * (Campaign lane `W6-EXT`, contract row CUT-N-11, check `C-28`.)
 *
 * WHY THIS FILE EXISTS. The claim the contract makes is not "the code compiles"
 * — it is "the extension's record read and write paths resolve through the new
 * store, proven on one real turn". A unit test cannot say that: it runs the
 * handler against a fake `chrome` and a fake database. So this harness loads
 * the BUILT extension unpacked in a real Chrome, signs in as the real
 * admin@admin.com account (a real JWT under real RLS), and drives the
 * extension's own Tools tab — the same registry, the same Zod validation and
 * the same handler the tool dispatcher runs when the agent calls `records`
 * mid-turn. Every value that comes back came out of the live store.
 *
 * WHAT IT PROVES
 *   1. `records / table_list` through the extension lists this organization's
 *      Tables — read through `custom.read_records`, not a table scan.
 *   2. `records / record_read` reads a record the browser never wrote.
 *   3. `records / record_write` CREATES a record, and the new id is then read
 *      back FROM OUTSIDE THE BROWSER through the store's read door with the
 *      same account. A path that only appeared to write fails here.
 *   4. `records / record_write` with a record_id UPDATES it, and the update is
 *      confirmed from outside the browser the same way.
 *   5. The switch is real: the same tool, asked in an organization the store is
 *      NOT open for, answers with the store's sentence instead of data.
 *
 * WHAT IT DOES NOT PROVE. The tool is exercised through the extension's own
 * manual runner, not through a server-driven chat turn — identical code path
 * (registry lookup → argsSchema.parse → handler.run), one layer of the
 * transport short of a full agent conversation. Said out loud rather than
 * blurred: `V6-CONS` re-executes this check with its own hands.
 *
 * RUN:
 *   pnpm build && node tests/browser/records-agent-turn-e2e.mjs --table <uuid> --record <uuid>
 * Options:
 *   --keep-open   run HEADED for a person who asked to watch. Never unattended:
 *                 a headed window steals keystrokes from whoever is at the Mac.
 *
 * Nothing here prints a credential.
 */

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const WORKSPACE = resolve(REPO, '..');
const EXTENSION_DIR = join(REPO, '.output', 'chrome-mv3');
const SHOTS = join(REPO, '.output', 'records-agent-turn');

const KEEP_OPEN = process.argv.includes('--keep-open');
const argOf = (flag) => {
  const at = process.argv.indexOf(flag);
  return at >= 0 ? process.argv[at + 1] : undefined;
};

/** The organization the record store is switched ON for (admin's Workspace). */
const ORGANIZATION_ID = argOf('--org') ?? '884d1ce8-7b49-4fba-a2f3-0f7dd7c83d4f';
/** The throwaway Table this run reads and writes. Seeded before the run, deleted after. */
const TABLE_ID = argOf('--table');
/** A record seeded into that Table before the browser ever started. */
const SEEDED_RECORD_ID = argOf('--record');

// Playwright is deliberately NOT a dependency of this repo — the extension
// ships to a store, it does not ship a browser-test runner. It is borrowed from
// matrx-frontend, and the borrow is announced rather than hidden.
const require_ = createRequire(join(WORKSPACE, 'matrx-frontend', 'package.json'));
let chromium;
try {
  ({ chromium } = require_('playwright'));
} catch (error) {
  fail(
    'Playwright is not installed. This harness borrows it from matrx-frontend; ' +
      `run \`pnpm install\` there first. (${error.message})`,
  );
}

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

/** A real session for the real admin account. Never a fixture user. */
async function signIn({ supabaseUrl, publishableKey, email, password }) {
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: publishableKey },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    fail(`sign-in as the admin account was refused by Supabase (${response.status}).`);
  }
  return response.json();
}

/**
 * The independent read: the store's own read door, called from NODE with the
 * same account, outside the browser. This is what makes a write claim
 * believable — the browser saying "ok" is not evidence that a row exists.
 */
async function readRecordThroughTheDoor({
  supabaseUrl,
  publishableKey,
  accessToken,
  recordId,
  organizationId,
}) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/read_record`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: publishableKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Profile': 'custom',
      'Accept-Profile': 'custom',
    },
    body: JSON.stringify({
      p_organization_id: organizationId,
      p_record_id: recordId,
      p_by_id: true,
    }),
  });
  const body = await response.text();
  if (!response.ok) return { error: `${response.status} ${body}` };
  try {
    return { row: JSON.parse(body) };
  } catch {
    return { error: `unparseable answer from the read door: ${body}` };
  }
}

async function main() {
  if (!TABLE_ID || !SEEDED_RECORD_ID) {
    fail(
      'pass --table <uuid> and --record <uuid>: the Table this run writes into and a record ' +
        'seeded in it before the browser started. Both are throwaway and are deleted after the run.',
    );
  }
  if (!existsSync(join(EXTENSION_DIR, 'manifest.json'))) {
    fail(`no built extension at ${EXTENSION_DIR} — run \`pnpm build\` first.`);
  }
  mkdirSync(SHOTS, { recursive: true });

  const extensionEnv = {
    ...readEnvFile(join(REPO, '.env')),
    ...readEnvFile(join(REPO, '.env.development')),
  };
  const aidreamEnv = readEnvFile(join(WORKSPACE, 'aidream', '.env'));
  const supabaseUrl = extensionEnv.WXT_SUPABASE_URL;
  const publishableKey = extensionEnv.WXT_SUPABASE_PUBLISHABLE_KEY;
  const email = aidreamEnv.AI_ADMIN_USERNAME;
  const password = aidreamEnv.AI_ADMIN_PASSWORD;
  if (!supabaseUrl || !publishableKey) fail("WXT_SUPABASE_* are missing from this repo's .env.");
  if (!email || !password) fail('AI_ADMIN_USERNAME / AI_ADMIN_PASSWORD are missing from aidream/.env.');

  console.log('\n  the record store, through the extension, in a real browser\n  ' + '─'.repeat(58));
  console.log(`  extension   ${EXTENSION_DIR.replace(WORKSPACE + '/', '')}`);
  console.log(`  signing in  ${email}`);

  const session = await signIn({ supabaseUrl, publishableKey, email, password });
  const userId = session?.user?.id;
  if (!userId) fail('the token endpoint returned no user.');
  console.log(`  signed in   real session, user ${userId}`);
  console.log(`  acting in   organization ${ORGANIZATION_ID}`);
  console.log(`  table       ${TABLE_ID}`);

  // HEADLESS, ALWAYS (see the note in capture-ladder-e2e.mjs): `headless: false`
  // plus `--headless=new` keeps unpacked extensions working with no window on
  // anyone's screen. Playwright's own `headless: true` swaps in the headless
  // SHELL, which cannot load an unpacked extension at all.
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      ...(KEEP_OPEN ? [] : ['--headless=new']),
      `--disable-extensions-except=${EXTENSION_DIR}`,
      `--load-extension=${EXTENSION_DIR}`,
    ],
  });

  const failures = [];
  let createdRecordId = null;

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
    const extensionId = new URL(worker.url()).host;
    console.log(`  loaded      extension id ${extensionId}`);

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await page.evaluate(
      async ([accessToken, expiresIn, user, org]) => {
        await chrome.storage.local.set({
          'matrx.auth.accessToken': accessToken,
          'matrx.auth.expiresAt': Date.now() + expiresIn * 1000,
          'matrx.user.profile': user,
          'matrx.org.active': org,
        });
      },
      [
        session.access_token,
        session.expires_in ?? 3600,
        session.user,
        { id: ORGANIZATION_ID, name: "Admin's Workspace" },
      ],
    );
    await page.reload();
    await page.waitForTimeout(2500);

    /**
     * Run the `records` tool the way the extension runs it: find it in the
     * registry through the Tools tab, hand it JSON arguments, press Run, read
     * what the handler answered. The Zod schema, the registry lookup and the
     * handler body are the dispatcher's, not this file's.
     */
    async function runRecordsTool(args, shot) {
      // The tab strip is icon-only; Radix gives each trigger a stable id.
      const toolsTab = page.locator('[id$="-trigger-tools"]');
      if ((await toolsTab.count()) === 0) {
        await page.screenshot({ path: join(SHOTS, 'no-tools-tab.png'), fullPage: true });
        fail('the sidepanel rendered but has no Tools tab — the seeded session did not take.');
      }
      await toolsTab.first().click();
      await page.waitForTimeout(800);
      const search = page.getByPlaceholder(/search by name or description/i);
      await search.fill('records');
      await page.waitForTimeout(600);
      // One row survives the filter; opening it reveals that tool's test
      // runner. The row TOGGLES, so it is opened only when it is not already
      // open — a second click on an open row closes it and the run never fires.
      // The test runner's own textarea is identified by its own placeholder:
      // the chat composer is also a textarea and is also on the page.
      const textarea = page.getByPlaceholder('{"selector": "h1"}');
      if (!(await textarea.isVisible().catch(() => false))) {
        await page.getByText('records', { exact: true }).first().click();
        await page.waitForTimeout(600);
      }
      await textarea.fill(JSON.stringify(args));
      await page.getByRole('button', { name: /^run$/i }).first().click();
      // The handler is talking to the live store over the network, so the wait
      // is on the ANSWER appearing, not on a clock: a fixed sleep read the
      // input schema back as the result the first time this ran.
      await page
        .locator('pre')
        .last()
        .filter({ hasText: /"ok"\s*:/ })
        .waitFor({ timeout: 30_000 })
        .catch(() => {});
      await page.screenshot({ path: join(SHOTS, `${shot}.png`), fullPage: true });
      // The runner renders the handler's answer in the LAST <pre> of the open
      // card — after the description and the input schema. Reading the page's
      // whole text instead picks up the input schema, which is also JSON and
      // also ends in a brace: the first version of this harness did exactly
      // that and called a passing read a failure.
      const panes = page.locator('pre');
      const raw = await panes.last().innerText();
      try {
        return JSON.parse(raw);
      } catch {
        return { unparsed: raw.slice(0, 1200) };
      }
    }

    const check = (label, condition, detail) => {
      if (condition) {
        console.log(`  ✓ ${label}`);
      } else {
        console.log(`  ✗ ${label} — ${detail}`);
        failures.push(label);
      }
    };

    console.log('\n  what the extension actually did\n  ' + '─'.repeat(58));

    // 1 — the Tables of this organization, through the read door.
    const listed = await runRecordsTool({ action: 'table_list', limit: 50 }, '01-table-list');
    check(
      'records / table_list returned this organization\'s Tables through the store',
      listed?.ok === true && Array.isArray(listed.tables) && listed.tables.length > 0,
      JSON.stringify(listed).slice(0, 400),
    );
    check(
      'the throwaway Table is among them',
      Array.isArray(listed?.tables) && listed.tables.some((t) => t.id === TABLE_ID),
      'the Table the store holds was not in the list the extension rendered',
    );

    // 2 — a record the browser never wrote.
    const read = await runRecordsTool(
      { action: 'record_read', record_id: SEEDED_RECORD_ID },
      '02-record-read',
    );
    check(
      'records / record_read read the seeded record through the read door',
      read?.ok === true && read.values?.title === 'seeded before the browser ran',
      JSON.stringify(read).slice(0, 400),
    );

    // 3 — a real write, confirmed from outside the browser.
    const stamp = new Date().toISOString();
    const written = await runRecordsTool(
      {
        action: 'record_write',
        table_id: TABLE_ID,
        values: { title: 'written by the extension', note: stamp },
      },
      '03-record-write',
    );
    check(
      'records / record_write created a record',
      written?.ok === true && typeof written.record_id === 'string',
      JSON.stringify(written).slice(0, 400),
    );
    createdRecordId = written?.record_id ?? null;
    if (createdRecordId) {
      const confirmed = await readRecordThroughTheDoor({
        supabaseUrl,
        publishableKey,
        accessToken: session.access_token,
        recordId: createdRecordId,
        organizationId: ORGANIZATION_ID,
      });
      const document = confirmed.row?.document ?? confirmed.row;
      check(
        'the store, read from outside the browser, holds what the extension wrote',
        document?.title === 'written by the extension' && document?.note === stamp,
        confirmed.error ?? JSON.stringify(confirmed.row).slice(0, 400),
      );

      // 4 — the update half of the same verb.
      const updated = await runRecordsTool(
        {
          action: 'record_write',
          record_id: createdRecordId,
          values: { note: 'updated by the extension' },
        },
        '04-record-update',
      );
      check(
        'records / record_write updated the record it had just created',
        updated?.ok === true && updated.wrote === 'update',
        JSON.stringify(updated).slice(0, 400),
      );
      const reconfirmed = await readRecordThroughTheDoor({
        supabaseUrl,
        publishableKey,
        accessToken: session.access_token,
        recordId: createdRecordId,
        organizationId: ORGANIZATION_ID,
      });
      const after = reconfirmed.row?.document ?? reconfirmed.row;
      check(
        'the store holds the update, read from outside the browser',
        after?.note === 'updated by the extension' && after?.title === 'written by the extension',
        reconfirmed.error ?? JSON.stringify(reconfirmed.row).slice(0, 400),
      );
    }

    // 5 — THE SWITCH. The same tool, the same account, an organization the
    // store is not open for: the answer must be the store's sentence, not data
    // and not an empty list.
    await page.evaluate(
      async ([org]) => {
        await chrome.storage.local.set({ 'matrx.org.active': org });
      },
      [{ id: '5dc930e9-bd65-44a1-8369-af773f6e1a5b', name: 'AI Matrx' }],
    );
    await page.reload();
    await page.waitForTimeout(2000);
    const closed = await runRecordsTool({ action: 'table_list', limit: 5 }, '05-switch-closed');
    check(
      'with the store switched off for the organization, the tool says so instead of answering',
      closed?.ok === false && typeof closed.reason === 'string' && closed.reason.length > 20,
      JSON.stringify(closed).slice(0, 400),
    );
    if (closed?.reason) console.log(`      it said: "${closed.reason}"`);

    console.log(`\n  screenshots ${SHOTS}`);
    if (createdRecordId) console.log(`  created     ${createdRecordId} (throwaway — delete it)`);
    if (KEEP_OPEN) {
      console.log('  --keep-open: leaving the browser up. Ctrl-C when done.');
      await new Promise(() => {});
    }
  } finally {
    if (!KEEP_OPEN) await context.close();
  }

  if (failures.length) {
    console.error(`\n  ${failures.length} check(s) FAILED: ${failures.join(' · ')}\n`);
    process.exit(1);
  }
  console.log('\n  ALL CHECKS PASSED — the extension read and wrote real records.\n');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
