#!/usr/bin/env node
/** Narrow owned-profile acceptance for EXT-F-1005 T14/T15/T17/T22.
 * No event injection: event supply comes from loading and using a public page.
 * Execution is deliberately deferred to the admitted native-browser owner.
 */
import assert from 'node:assert/strict';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { click, evaluate, openSection, waitFor } from './settings-panel-driver.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUTPUT = join(REPO, 'test-results/debug-log-controls-acceptance.json');
const PUBLIC_URL = 'https://www.aimatrx.com/';
const WEB_ORIGIN = 'https://www.aimatrx.com';
const ADMIN_ENV = join(homedir(), 'code', 'aidream', '.env');
const ADMIN_EMAIL = 'admin@admin.com';
let stage = 'startup';
const result = {
  schema: 1,
  feature: 'EXT-F-1005',
  status: 'unverified',
  cases: [],
  countsOnly: true,
};
const add = (id, status, expected, actual, evidence) =>
  result.cases.push({ id, status, expected, actual, evidence });

async function snapshot(panel) {
  return evaluate(
    panel,
    `(() => {
    const search = [...document.querySelectorAll('input')].find((e) => e.placeholder === 'Search…');
    const view = search?.closest('div.flex.h-full.flex-col');
    const list = view?.lastElementChild;
    const rows = [...(list?.children ?? [])].filter((e) => e.firstElementChild?.matches('button'));
    const countText = search?.nextElementSibling?.textContent.trim() ?? '';
    const count = /^(\\d+)\\/(\\d+)$/.exec(countText);
    const text = list?.innerText ?? '';
    return { rowCount: rows.length, totalCount: count ? Number(count[2]) : null,
      counterMatchesRows: count ? Number(count[1]) === rows.length : false,
      noEvents: text.includes("No events yet. Use the extension and they'll show up here."),
      noMatches: text.includes('No events match the current filter.'),
      expandedDetails: list?.querySelectorAll('pre').length ?? 0,
      searchPresent: !!search, searchLength: search?.value.length ?? null };
  })()`,
  );
}

// Mirrors the proven real UI flow in isolated-admin-signin-acceptance.mjs.
// Its executable entrypoint cannot be imported without launching another browser.
async function signInAsAdmin(page, panel) {
  stage = 'guest_account';
  await click(panel, 'title', 'Settings');
  await openSection(panel, 'Account');
  const web = await page.context().newPage();
  try {
    stage = 'web_login';
    await web.goto(`${WEB_ORIGIN}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const route = new URL(web.url());
    if (route.origin !== WEB_ORIGIN || route.pathname !== '/login')
      throw new Error('web_login_route_unverified');
    const source = await readFile(ADMIN_ENV, 'utf8');
    const variables = {};
    for (const line of source.split(/\r?\n/)) {
      const found = /^\s*(AI_ADMIN_USERNAME|AI_ADMIN_PASSWORD)\s*=\s*(.*?)\s*$/.exec(line);
      if (!found) continue;
      let value = found[2];
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      )
        value = value.slice(1, -1);
      variables[found[1]] = value;
    }
    if (variables.AI_ADMIN_USERNAME !== ADMIN_EMAIL || !variables.AI_ADMIN_PASSWORD)
      throw new Error('admin_credentials_unavailable');
    await web.locator('input[name="email"]').fill(ADMIN_EMAIL);
    await web.locator('input[name="password"]').fill(variables.AI_ADMIN_PASSWORD);
    await Promise.all([
      web.waitForURL((url) => url.origin === WEB_ORIGIN && url.pathname === '/dashboard', {
        timeout: 90_000,
      }),
      web.getByRole('button', { name: 'Sign in', exact: true }).click(),
    ]);
    stage = 'extension_signin';
    await click(panel, 'button', 'Sign in');
    await waitFor(
      'real_admin_identity',
      () =>
        evaluate(
          panel,
          `(() => {
            const account = [...document.querySelectorAll('button[aria-expanded]')]
              .find((button) => button.textContent.trim() === 'Account');
            const section = account?.parentElement?.nextElementSibling;
            const row = (label) => [...(section?.querySelectorAll('span') ?? [])]
              .find((span) => span.textContent.trim() === label)?.parentElement?.textContent.trim() ?? null;
            return { emailMatch: row('Email') === 'Email${ADMIN_EMAIL}',
              adminRole: row('Role')?.toLowerCase() === 'roleadmin',
              signOut: [...document.querySelectorAll('button')]
                .some((button) => button.textContent.trim() === 'Sign out') };
          })()`,
        ),
      (state) => state?.emailMatch && state.adminRole && state.signOut,
      90_000,
    );
    result.realAdminUi = true;
  } finally {
    await web.close();
  }
}

async function setSearch(panel, value) {
  const sample = () =>
    evaluate(
      panel,
      `(() => {
        const inputs=[...document.querySelectorAll('input[placeholder="Search…"]')];
        if(inputs.length!==1)return {count:inputs.length};
        const input=inputs[0];
        input.scrollIntoView({block:'center',inline:'center',behavior:'instant'});
        const rect=input.getBoundingClientRect();
        const x=rect.x+rect.width/2,y=rect.y+rect.height/2;
        const hit=document.elementFromPoint(x,y);
        return {count:1,x,y,area:rect.width>0&&rect.height>0,
          hit:hit===input||input.contains(hit)};
      })()`,
    );
  const deadline = Date.now() + 3000;
  let previous;
  let stable = 0;
  do {
    const current = await sample();
    assert.equal(current?.count, 1, 'unique visible Debug search input');
    assert.equal(current.hit && current.area, true, 'Debug search input accepts pointer');
    stable =
      previous && Math.abs(previous.x - current.x) < 0.25 && Math.abs(previous.y - current.y) < 0.25
        ? stable + 1
        : 0;
    previous = current;
    if (stable >= 2) break;
    await new Promise((done) => setTimeout(done, 50));
  } while (Date.now() < deadline);
  assert.equal(stable >= 2, true, 'Debug search input remained stable');
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: previous.x,
    y: previous.y,
    button: 'left',
    clickCount: 1,
  });
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: previous.x,
    y: previous.y,
    button: 'left',
    clickCount: 1,
  });
  const selection = () =>
    evaluate(
      panel,
      `(() => {
        const e=document.querySelector('input[placeholder="Search…"]');
        return e&&{focused:document.activeElement===e,length:e.value.length,
          start:e.selectionStart,end:e.selectionEnd,value:e.value};
      })()`,
    );
  const initial = await selection();
  assert.equal(initial?.focused, true, 'trusted pointer focused Debug search');
  const modifiers = process.platform === 'darwin' ? 4 : 2;
  await panel.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'a',
    code: 'KeyA',
    modifiers,
    windowsVirtualKeyCode: 65,
    commands: ['selectAll'],
  });
  await panel.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'a',
    code: 'KeyA',
    modifiers,
    windowsVirtualKeyCode: 65,
  });
  const selected = await selection();
  assert.equal(
    selected?.focused && selected.start === 0 && selected.end === initial.length,
    true,
    'trusted select-all covered Debug search',
  );
  if (value) await panel.send('Input.insertText', { text: value });
  else {
    await panel.send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key: 'Backspace',
      code: 'Backspace',
      windowsVirtualKeyCode: 8,
    });
    await panel.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Backspace',
      code: 'Backspace',
      windowsVirtualKeyCode: 8,
    });
  }
  await waitFor(
    'trusted_search_input',
    selection,
    (state) => state?.focused && state.value === value,
  );
  return true;
}

async function exercise({ page, panel, artifacts }) {
  let preClearCount = 0;
  try {
    await signInAsAdmin(page, panel);
    stage = 'open_debug';
    await click(panel, 'title', 'Debug (admin only)');
    await click(panel, 'button', 'Log');
    const baseline = await waitFor(
      'debug_log_counter_ready',
      () => snapshot(panel),
      (state) => state?.searchPresent && state.counterMatchesRows,
    );
    stage = 'natural_event_generation';
    await page.goto(PUBLIC_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    stage = 'natural_event_observation';
    await new Promise((r) => setTimeout(r, 2500));
    let state = await snapshot(panel);
    if (!state.searchPresent || !state.counterMatchesRows)
      throw new Error('debug_log_counter_unverified');
    result.naturalEventObservation = {
      before: baseline.rowCount,
      after: state.rowCount,
      increased: state.rowCount > baseline.rowCount,
    };
    preClearCount = state.rowCount;
    if (state.rowCount === 0) {
      add(
        'EXT-F-1005-T14',
        'unverified',
        'Search matches natural log message/detail values.',
        'No event rows from natural public-page interaction.',
        'positive control unavailable; no event injected',
      );
      add(
        'EXT-F-1005-T15',
        'unverified',
        'Pause freezes displayed rows while arrivals continue; resume catches up.',
        'No natural positive event set available.',
        'positive control unavailable',
      );
      add(
        'EXT-F-1005-T22',
        'unverified',
        'Details expand/collapse and empty states are distinct.',
        'No event rows available for detail controls.',
        'positive control unavailable',
      );
      stage = 'clear_disposable_profile';
      await click(panel, 'title', 'Clear');
      state = await waitFor(
        'clear_empty_state',
        () => snapshot(panel),
        (s) => s?.noEvents === true,
      );
      add(
        'EXT-F-1005-T17',
        'unverified',
        'Clear removes local events and shows the no-events state.',
        `No-events state=${state.noEvents}; row count=${state.rowCount}.`,
        'No natural event rows existed before Clear; positive control unavailable.',
      );
    } else {
      stage = 'search_control';
      const positive = await evaluate(
        panel,
        `(() => {
        const search=[...document.querySelectorAll('input')].find(e=>e.placeholder==='Search…');
        const list=search?.closest('div.flex.h-full.flex-col')?.lastElementChild;
        const row=[...(list?.children??[])].find(e=>
          e.firstElementChild?.matches('button') &&
          !e.firstElementChild.firstElementChild?.querySelector('svg'));
        return row?.firstElementChild?.querySelector('span.truncate')?.textContent.trim().slice(0,24) ?? null;
      })()`,
      );
      if (positive) {
        assert.equal(await setSearch(panel, positive), true);
        const matched = await waitFor(
          'search_positive',
          () => snapshot(panel),
          (s) => s?.counterMatchesRows && s.searchLength > 0 && s.rowCount > 0,
        );
        assert.ok(matched.rowCount > 0);
        await setSearch(panel, 'zzzz-no-match-acceptance');
        state = await waitFor(
          'search_empty',
          () => snapshot(panel),
          (s) => s?.counterMatchesRows && s?.noMatches === true && s.rowCount === 0,
        );
        add(
          'EXT-F-1005-T14',
          'partial',
          'Search matches message and detail values; unmatched text shows no-match state.',
          `Positive count=${matched.rowCount}; unmatched count=${state.rowCount}.`,
          {
            messageSearch: 'pass_via_trusted_input_on_row_without_detail',
            unmatchedState: 'pass',
            detailSearch: 'unverified_no_natural_detail_only_term',
          },
        );
        await setSearch(panel, '');
        await waitFor(
          'search_reset',
          () => snapshot(panel),
          (s) => s?.counterMatchesRows && s.searchLength === 0 && s.rowCount === preClearCount,
        );
      } else {
        add(
          'EXT-F-1005-T14',
          'unverified',
          'Search matches message and detail values; unmatched text shows no-match state.',
          'Natural rows existed, but no message-only row supplied a safe positive search term.',
          'No event values retained or fabricated.',
        );
      }
      stage = 'pause_resume';
      await click(panel, 'title', 'Pause');
      const paused = await snapshot(panel);
      await page.goto(`${PUBLIC_URL}about/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await new Promise((r) => setTimeout(r, 1500));
      const held = await snapshot(panel);
      await click(panel, 'title', 'Resume');
      const resumed = await snapshot(panel);
      const pauseProved =
        paused.counterMatchesRows &&
        held.counterMatchesRows &&
        resumed.counterMatchesRows &&
        held.rowCount === paused.rowCount &&
        held.totalCount > paused.totalCount &&
        resumed.rowCount > held.rowCount;
      add(
        'EXT-F-1005-T15',
        pauseProved ? 'pass' : 'unverified',
        'Paused view stays frozen; resume displays naturally arriving events.',
        `Visible counts before=${paused.rowCount}, held=${held.rowCount}, resumed=${resumed.rowCount}; total before=${paused.totalCount}, held=${held.totalCount}.`,
        'counts only; no log values retained',
      );
      stage = 'details';
      add(
        'EXT-F-1005-T22',
        'unverified',
        'A details row expands/collapses; empty and no-match states differ.',
        'Detail-bearing row identification requires visual review in the admitted run.',
        'runner records no payload; manual positive detail control pending',
      );
      stage = 'clear_disposable_profile';
      await click(panel, 'title', 'Clear');
      state = await waitFor(
        'clear_empty_state',
        () => snapshot(panel),
        (s) => s?.noEvents === true,
      );
      add(
        'EXT-F-1005-T17',
        state.noEvents && state.rowCount === 0 && state.totalCount === 0 ? 'pass' : 'fail',
        'Clear removes local events and shows the no-events state.',
        `No-events state=${state.noEvents}; row count=${state.rowCount}.`,
        'fresh owned disposable profile only',
      );
    }
  } catch (error) {
    result.failure = {
      stage,
      driverFailure: safeDriverFailure(error),
      priorRowCount: preClearCount,
    };
    try {
      const png = await panel.send('Page.captureScreenshot', { format: 'png' });
      const screenshot = await open(join(artifacts, 'debug-log-controls-failure.png'), 'wx', 0o600);
      try {
        await screenshot.writeFile(Buffer.from(png.data, 'base64'));
        await screenshot.sync();
      } finally {
        await screenshot.close();
      }
      result.failure.privateScreenshot = true;
    } catch {
      result.failure.privateScreenshot = false;
    }
    throw new Error('debug_log_controls_stage_failed');
  }
}

function safeDriverFailure(error) {
  const d = error?.driverFailure;
  if (!d || typeof d !== 'object') return { present: false };
  const codes = new Set([
    'pointer_initial_evaluation_failed',
    'pointer_page_sample_failed',
    'pointer_target_not_unique',
    'pointer_followup_evaluation_failed',
    'pointer_stable_hit_not_observed',
    'pointer_press_dispatch_failed',
    'pointer_release_dispatch_failed',
  ]);
  return {
    present: true,
    code: codes.has(d.code) ? d.code : 'unknown',
    matchedTargetCount: Number.isInteger(d.matchedTargetCount) ? d.matchedTargetCount : null,
    visibleMatchCount: Number.isInteger(d.visibleMatchCount) ? d.visibleMatchCount : null,
    uniqueVisibleTarget: d.uniqueVisibleTarget === true,
    hitTarget: d.hitTarget === true,
  };
}

try {
  stage = 'owned_profile_harness';
  const native = await runNativeSidepanelQa({ headed: true, exercisePanel: exercise });
  result.profileOwned = native.verified === true;
  result.status = result.cases.some((c) => c.status === 'fail')
    ? 'fail'
    : result.cases.length > 0 && result.cases.every((c) => c.status === 'unverified')
      ? 'unverified'
      : 'partial';
} catch {
  result.status = 'unverified';
  result.failure ??= { stage, driverFailure: { present: false } };
}
await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${result.status.toUpperCase()} debug_log_controls_acceptance\n`);
if (result.status === 'fail' || result.status === 'unverified') process.exitCode = 1;
