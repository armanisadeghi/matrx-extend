#!/usr/bin/env node
/**
 * The unpacked-extension harness — the thing that makes a capture-ladder claim
 * believable (acquisition-frontier board row C19).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Every rung-3 / rung-4 claim this repo makes is about behaviour inside a REAL
 * Chrome with the extension installed and a REAL signed-in session. Unit tests
 * cannot reach that: they run the runner against a fake `chrome` object, which
 * is exactly the "manufactured data to the author's own code" a test is not
 * allowed to be mistaken for. Before this file, the only browser script in the
 * repo was a single explicitly-armed Vault canary, and it borrowed Playwright
 * from matrx-frontend's node_modules. This one does the same borrowing — that
 * is deliberate and stated, not an accident — but it is a general harness.
 *
 * WHAT IT PROVES, AND WHAT IT DOES NOT
 * ------------------------------------
 * It signs in for real (Supabase password grant as admin@admin.com, a real JWT
 * under real RLS — no seeded fixture user), loads the built extension unpacked,
 * seeds that real session into chrome.storage the way the auth flow does, and
 * then reads what the Capture tab actually renders against the LIVE
 * `media.capture_handoff` queue.
 *
 * It does NOT sign into any third-party site, and it must never be made to: the
 * fourth rung of the ladder exists precisely because a person does that
 * themselves.
 *
 * RUN:
 *   pnpm build && node tests/browser/capture-ladder-e2e.mjs
 * Options:
 *   --keep-open     run HEADED and leave the browser up for a person who asked
 *                   to watch. Never use it unattended: a headed automated window
 *                   steals keyboard focus from whoever is at the machine.
 *   --seed          write one real handoff row for this org through aidream
 *                   /capture/handoffs first (needs the endpoints deployed)
 *
 * Nothing here prints a credential. The password is read from aidream's .env
 * and passed straight to the token endpoint.
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

// Playwright is deliberately NOT a dependency of this repo — the extension
// ships to a store, it does not ship a browser-test runner. It is borrowed from
// matrx-frontend, which already installs it, and the borrow is announced rather
// than hidden behind a try/catch that would make a missing install look like a
// passing run.
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
    const body = await response.text();
    // The body can echo the email but never the password; still, only the
    // status and the provider's error code are printed.
    let code = '';
    try {
      code = JSON.parse(body).error_code || JSON.parse(body).error || '';
    } catch {
      code = '';
    }
    fail(
      `sign-in as the admin account was refused by Supabase (${response.status} ${code}). ` +
        'Check AI_ADMIN_USERNAME / AI_ADMIN_PASSWORD in aidream/.env.',
    );
  }
  return response.json();
}

/**
 * The organizations this real user is a MEMBER of — the same question
 * src/lib/org/active-org.ts asks, through the same RPC. Reading
 * `iam.organizations` instead would answer a different and wrong question: RLS
 * lets an admin READ organizations she is not a member of, and the extension
 * refuses a stored selection that is not a membership (correctly).
 */
async function organizationsFor({ supabaseUrl, publishableKey, accessToken }) {
  const rpc = await fetch(`${supabaseUrl}/rest/v1/rpc/mbr_for_user`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: publishableKey,
      Authorization: `Bearer ${accessToken}`,
      // RPCs are not schema-scoped in this codebase; PostgREST's default
      // profile here is `api`, so the profile has to be said out loud.
      'Content-Profile': 'public',
      'Accept-Profile': 'public',
    },
    body: JSON.stringify({ p_container_type: 'organization' }),
  });
  if (!rpc.ok) {
    fail(`membership lookup (mbr_for_user) was refused: ${rpc.status} ${await rpc.text()}`);
  }
  const rows = await rpc.json();
  const ids = [
    ...new Set(
      (Array.isArray(rows) ? rows : [])
        .map((row) => row.container_id ?? row.containerId)
        .filter((id) => typeof id === 'string' && id.length > 0),
    ),
  ];
  if (!ids.length) return [];
  const orgs = await fetch(
    `${supabaseUrl}/rest/v1/organizations?select=id,name,is_personal&id=in.(${ids.join(',')})`,
    {
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${accessToken}`,
        'Accept-Profile': 'iam',
      },
    },
  );
  if (!orgs.ok) {
    fail(`organization read was refused: ${orgs.status} ${await orgs.text()}`);
  }
  return orgs.json();
}

/** The live queue, read the same way the extension reads it. */
async function handoffsFor({ supabaseUrl, publishableKey, accessToken, organizationId }) {
  const url =
    `${supabaseUrl}/rest/v1/capture_handoff` +
    `?select=id,url,title,rung,status,reason,reason_note,what_to_do,estimated_seconds` +
    `&organization_id=eq.${organizationId}` +
    `&status=in.(waiting,needs_drive)&deleted_at=is.null&order=created_at.desc&limit=25`;
  const response = await fetch(url, {
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${accessToken}`,
      'Accept-Profile': 'media',
    },
  });
  if (!response.ok) {
    return { error: `${response.status} ${await response.text()}` };
  }
  return { rows: await response.json() };
}

async function main() {
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
  if (!supabaseUrl || !publishableKey) {
    fail('WXT_SUPABASE_URL / WXT_SUPABASE_PUBLISHABLE_KEY are missing from this repo\'s .env.');
  }
  if (!email || !password) {
    fail('AI_ADMIN_USERNAME / AI_ADMIN_PASSWORD are missing from aidream/.env.');
  }

  console.log('\n  the capture ladder, in a real browser\n  ' + '─'.repeat(52));
  console.log(`  extension   ${EXTENSION_DIR.replace(WORKSPACE + '/', '')}`);
  console.log(`  signing in  ${email}`);

  const session = await signIn({ supabaseUrl, publishableKey, email, password });
  const userId = session?.user?.id;
  if (!userId) fail('the token endpoint returned no user.');
  console.log(`  signed in   real session, user ${userId}`);

  const orgs = await organizationsFor({
    supabaseUrl,
    publishableKey,
    accessToken: session.access_token,
  });
  if (!orgs.length) {
    fail(
      'this account is a member of no organization, so there is no tenant to act in. ' +
        'That is a real finding, not a harness problem.',
    );
  }
  // Prefer a real shared organization over the personal one: a capture queue is
  // the organisation's material, and a personal tenant is the least interesting
  // place to prove it.
  const organization = orgs.find((row) => row.is_personal !== true) ?? orgs[0];
  const organizationId = organization.id;
  const organizationName = organization.name ?? organizationId;
  console.log(`  acting as   organization ${organizationName} (of ${orgs.length} membership(s))`);

  const queue = await handoffsFor({
    supabaseUrl,
    publishableKey,
    accessToken: session.access_token,
    organizationId,
  });
  if (queue.error) {
    fail(
      'the live media.capture_handoff queue could not be read with this real token: ' +
        queue.error,
    );
  }
  console.log(`  queue       ${queue.rows.length} row(s) waiting for a browser`);

  // HEADLESS, ALWAYS. A headed automated browser steals keyboard focus from
  // whoever is at the machine: on 2026-09-17 windows from runs like this one
  // popped up while the owner was typing, so his keystrokes went into a test's
  // address bar and the test saw failures that were his keys, not the code.
  // Chrome's new headless mode loads unpacked extensions properly, so there is
  // nothing to trade away. `--keep-open` runs headed ON PURPOSE and says so —
  // it is for a person who asked to watch, never for an unattended run.
  // `headless: false` plus `--headless=new` is not a contradiction: Playwright's
  // own `headless: true` swaps in the headless SHELL binary, which cannot load
  // an unpacked extension at all (it hangs waiting for a service worker that
  // never starts). Launching the full browser and putting IT in new headless
  // mode keeps extensions working with no window on anyone's screen.
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      ...(KEEP_OPEN ? [] : ['--headless=new']),
      `--disable-extensions-except=${EXTENSION_DIR}`,
      `--load-extension=${EXTENSION_DIR}`,
    ],
  });

  try {
    // MV3: the extension announces itself through its service worker, and the
    // worker's URL is the only honest source of the generated extension id.
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
    const extensionId = new URL(worker.url()).host;
    console.log(`  loaded      extension id ${extensionId}`);

    const page = await context.newPage();
    // Seed the REAL session the way src/lib/auth/flow.ts does. The refresh
    // token is deliberately not seeded: it is encrypted at rest by the flow's
    // own key, and a one-hour access token is all a test run needs.
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await page.evaluate(
      async ([accessToken, expiresIn, user, org]) => {
        await chrome.storage.local.set({
          'matrx.auth.accessToken': accessToken,
          'matrx.auth.expiresAt': Date.now() + expiresIn * 1000,
          'matrx.user.profile': user,
          // The shape persistSelection() writes — {id, name}, not a bare id.
          // A bare string reads back as "no organization selected", which is
          // exactly what the tab told us the first time this harness ran.
          'matrx.org.active': { id: org.id, name: org.name },
        });
      },
      [
        session.access_token,
        session.expires_in ?? 3600,
        session.user,
        { id: organizationId, name: organizationName },
      ],
    );
    await page.reload();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: join(SHOTS, '01-sidepanel-signed-in.png'), fullPage: true });

    // The tab is icon-only; its accessible name is the sentence a person would
    // read ("N pages need your browser" / "Pages that need your browser").
    const captureTab = page.getByRole('tab', { name: /need your browser/i });
    const tabCount = await captureTab.count();
    if (tabCount === 0) {
      await page.screenshot({ path: join(SHOTS, '02-no-capture-tab.png'), fullPage: true });
      fail(
        'the sidepanel rendered but has no Capture tab. The tab is registered in ' +
          'src/config/sidepanel-visibility.ts as signed-in only, so either the seeded ' +
          'session did not take or the tab is not wired. Screenshot: 02-no-capture-tab.png',
      );
    }
    await captureTab.first().click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: join(SHOTS, '03-capture-tab.png'), fullPage: true });

    const text = await page.evaluate(() => document.body.innerText);
    console.log('\n  what the Capture tab actually says\n  ' + '─'.repeat(52));
    console.log(
      text
        .split('\n')
        .filter((line) => line.trim())
        .slice(0, 40)
        .map((line) => `  │ ${line}`)
        .join('\n'),
    );

    // The honest assertion: the screen must agree with the database. An empty
    // queue must LOOK empty and say so; a non-empty queue must name its rows.
    if (queue.rows.length === 0) {
      console.log(
        '\n  NOTE: the live queue is empty, so this run proves the extension loads, ' +
          'authenticates and renders an honest empty state — it does NOT prove a ' +
          'capture. Re-run with rows in media.capture_handoff for that.',
      );
    } else {
      const missing = queue.rows.filter(
        (row) => !text.includes(row.url) && !(row.title && text.includes(row.title)),
      );
      if (missing.length) {
        fail(
          `${missing.length} of ${queue.rows.length} waiting rows are in the database but ` +
            'not on the screen. A queue that hides work is the silent failure this ' +
            'whole ladder exists to prevent. Screenshot: 03-capture-tab.png',
        );
      }
      console.log(
        `\n  ✓ all ${queue.rows.length} waiting row(s) in the database are on the screen.`,
      );
    }

    console.log(`\n  screenshots ${SHOTS}\n`);
    if (KEEP_OPEN) {
      console.log('  --keep-open: leaving the browser up. Ctrl-C when done.');
      await new Promise(() => {});
    }
  } finally {
    if (!KEEP_OPEN) await context.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
