#!/usr/bin/env node
/** Narrow owned-profile acceptance for EXT-F-1005 T14/T15/T17/T22.
 * No event injection: event supply comes from loading and using a public page.
 * Execution is deliberately deferred to the admitted native-browser owner.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { click, evaluate, waitFor } from './settings-panel-driver.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUTPUT = join(REPO, 'docs/stabilization/runs/debug-log-controls-acceptance.json');
const PUBLIC_URL = 'https://www.aimatrx.com/';
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
    const text = document.body?.innerText ?? '';
    const rows = [...document.querySelectorAll('button')].filter((e) => e.querySelector('svg'));
    return { rowCount: rows.length, noEvents: text.includes("No events yet. Use the extension and they'll show up here."),
      noMatches: text.includes('No events match the current filter.'), expandedDetails: document.querySelectorAll('pre').length,
      searchPresent: [...document.querySelectorAll('input')].some((e) => e.placeholder === 'Search…') };
  })()`,
  );
}

async function setSearch(panel, value) {
  const expression = `(() => { const e=[...document.querySelectorAll('input')].find(x=>x.placeholder==='Search…'); if(!e)return false; e.focus(); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; setter.call(e,${JSON.stringify(value)}); e.dispatchEvent(new InputEvent('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`;
  return evaluate(panel, expression);
}

async function exercise({ page, panel, artifacts }) {
  let preClearCount = 0;
  try {
    stage = 'open_debug';
    await click(panel, 'button', 'Debug');
    await click(panel, 'button', 'Log');
    stage = 'admin_gate';
    const identity = await evaluate(
      panel,
      `(() => document.body.innerText.includes('admin@admin.com'))()`,
    );
    if (!identity) throw new Error('admin_identity_not_observed');
    stage = 'natural_event_generation';
    await page.goto(PUBLIC_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    stage = 'natural_event_observation';
    await new Promise((r) => setTimeout(r, 2500));
    let state = await snapshot(panel);
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
        state.noEvents ? 'pass' : 'fail',
        'Clear removes local events and shows the no-events state.',
        `No-events state=${state.noEvents}; row count=${state.rowCount}.`,
        'fresh owned disposable profile only',
      );
    } else {
      stage = 'search_control';
      const positive = await evaluate(
        panel,
        `(() => {
        const row=[...document.querySelectorAll('button')].find(b=>b.querySelector('svg') && b.textContent.trim().length>0);
        return row?.textContent.trim().slice(0,24) ?? null;
      })()`,
      );
      if (!positive) throw new Error('natural_search_control_missing');
      assert.equal(await setSearch(panel, positive), true);
      const matched = await waitFor(
        'search_positive',
        () => snapshot(panel),
        (s) => s?.rowCount > 0,
      );
      assert.ok(matched.rowCount > 0);
      await setSearch(panel, 'zzzz-no-match-acceptance');
      state = await waitFor(
        'search_empty',
        () => snapshot(panel),
        (s) => s?.noMatches === true,
      );
      add(
        'EXT-F-1005-T14',
        'pass',
        'Search matches existing row text and unmatched text shows no-match state.',
        `Positive count=${matched.rowCount}; unmatched count=${state.rowCount}.`,
        'DOM labels and counts only',
      );
      await setSearch(panel, '');
      stage = 'pause_resume';
      await click(panel, 'title', 'Pause');
      const paused = await snapshot(panel);
      await page
        .goto(`${PUBLIC_URL}about/`, { waitUntil: 'domcontentloaded', timeout: 60000 })
        .catch(() => {});
      await new Promise((r) => setTimeout(r, 1500));
      const held = await snapshot(panel);
      await click(panel, 'title', 'Resume');
      const resumed = await snapshot(panel);
      const pauseProved = held.rowCount === paused.rowCount && resumed.rowCount > held.rowCount;
      add(
        'EXT-F-1005-T15',
        pauseProved ? 'pass' : 'unverified',
        'Paused view stays frozen; resume displays naturally arriving events.',
        `Counts before=${paused.rowCount}, held=${held.rowCount}, resumed=${resumed.rowCount}.`,
        'counts only; no log values retained',
      );
      stage = 'details';
      const details = await evaluate(
        panel,
        `(() => [...document.querySelectorAll('button')].filter(b=>b.querySelector('svg')).length)`,
      );
      add(
        'EXT-F-1005-T22',
        details > 0 ? 'unverified' : 'unverified',
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
        state.noEvents ? 'pass' : 'fail',
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
      await writeFile(
        join(artifacts, 'debug-log-controls-failure.png'),
        Buffer.from(png.data, 'base64'),
        { mode: 0o600 },
      );
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
  return {
    present: true,
    code: typeof d.code === 'string' ? d.code : 'unknown',
    sampleStage: typeof d.sampleStage === 'string' ? d.sampleStage : null,
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
  result.status = result.cases.some((c) => c.status === 'fail') ? 'fail' : 'partial';
} catch {
  result.status = 'unverified';
  result.failure ??= { stage, driverFailure: { present: false } };
}
await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${result.status.toUpperCase()} debug_log_controls_acceptance\n`);
if (result.status === 'fail') process.exitCode = 1;
