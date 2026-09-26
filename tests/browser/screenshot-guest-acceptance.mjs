#!/usr/bin/env node
/** EXT-F-1009 guest gate only; the capture/gallery features are signed-in-only. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, open, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { click, evaluate, waitFor } from './settings-panel-driver.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUTPUT = join(REPO, 'test-results', `screenshot-guest-acceptance-${randomUUID()}.json`);
let stage = 'owned_profile';
const report = {
  schema: 1,
  feature: 'EXT-F-1009',
  mode: 'guest',
  status: 'unverified',
  buildBinding:
    'native harness validates exact release receipt, manifest version, and tree hash before launch',
  cases: [],
};

async function guestNavigation(panel) {
  return evaluate(
    panel,
    `(() => {
    const lists=[...document.querySelectorAll('[role="tablist"]')].filter(n=>!n.closest('[role="tabpanel"]'));
    const list=lists.length===1?lists[0]:null;
    const tabs=list?[...list.querySelectorAll('[role="tab"]')].filter(n=>n.closest('[role="tablist"]')===list):[];
    const screenshotTabs=tabs.filter(n=>n.title==='Screenshots');
    const panes=[...document.querySelectorAll('[role="tabpanel"]')].filter(n=>!n.parentElement?.closest('[role="tabpanel"]'));
    const active=panes.filter(n=>n.getAttribute('data-state')==='active');
    return {listCount:lists.length,tabCount:tabs.length,screenshotTriggerCount:screenshotTabs.length,
      screenshotTriggerVisible:screenshotTabs.some(n=>{const r=n.getBoundingClientRect();return r.width>0&&r.height>0}),
      screenshotContentMounted:[...document.querySelectorAll('button')].some(n=>['Visible','Full page'].includes(n.textContent.trim())),
      activePaneCount:active.length,activePaneIsScreenshots:active.some(n=>n.id.toLowerCase().includes('screenshots'))};
  })()`,
  );
}

async function saveFailureScreenshot(panel, artifacts) {
  const path = join(artifacts, `guest-gate-failure-${randomUUID()}.png`);
  const image = await panel.send('Page.captureScreenshot', { format: 'png' });
  const handle = await open(path, 'wx', 0o600);
  try {
    await handle.writeFile(Buffer.from(image.data, 'base64'));
    await handle.sync();
  } finally {
    await handle.close();
  }
  return true;
}

async function exercise({ panel, artifacts }) {
  try {
    stage = 'guest_initial_navigation';
    const initial = await guestNavigation(panel);
    assert.equal(initial.listCount, 1);
    assert.equal(initial.screenshotTriggerCount, 0);
    assert.equal(initial.screenshotContentMounted, false);
    report.cases.push({
      id: 'EXT-F-1009-T09',
      status: 'pass',
      expected: 'Guest cannot see Screenshots navigation or protected content.',
      actual: initial,
      evidence: 'role-scoped navigation and content booleans',
    });

    stage = 'accessible_view_navigation';
    await click(panel, 'title', 'Settings');
    await waitFor('settings_selected', guestNavigation, (value) => value?.activePaneCount === 1);
    await click(panel, 'title', 'SEO');
    const afterNavigation = await waitFor(
      'seo_selected',
      guestNavigation,
      (value) => value?.activePaneCount === 1,
    );
    assert.equal(afterNavigation.screenshotTriggerCount, 0);
    assert.equal(afterNavigation.screenshotContentMounted, false);
    report.cases.push({
      id: 'EXT-F-1009-T09',
      subcase: 'visible_navigation',
      status: 'pass',
      expected: 'Moving through public tabs does not expose screenshot view.',
      actual: afterNavigation,
      evidence: 'public tab navigation remained protected',
    });

    report.cases.push({
      id: 'EXT-F-1009-T09',
      subcase: 'stale_selection',
      status: 'unverified',
      expected: 'Attempt stale Screenshots selection after a role change.',
      actual:
        'Fresh guest profile has no prior signed-in Screenshots selection; a real auth transition was outside this guest-only run.',
      evidence: 'No auth state or tab selection was fabricated.',
    });
    report.status = 'partial';
  } catch (error) {
    report.status = 'unverified';
    report.failure = { stage, driverFailure: safeFailure(error) };
    try {
      report.failure.privateScreenshot = await saveFailureScreenshot(panel, artifacts);
    } catch {
      report.failure.privateScreenshot = false;
    }
    throw new Error('screenshot_guest_gate_stage_failed');
  }
}

function safeFailure(error) {
  const d = error?.driverFailure;
  return d && typeof d === 'object'
    ? {
        code: typeof d.code === 'string' ? d.code : 'unknown',
        sampleStage: typeof d.sampleStage === 'string' ? d.sampleStage : null,
        matchedTargetCount: Number.isInteger(d.matchedTargetCount) ? d.matchedTargetCount : null,
        visibleMatchCount: Number.isInteger(d.visibleMatchCount) ? d.visibleMatchCount : null,
      }
    : { code: 'stage_operation_failed' };
}

try {
  const run = await runNativeSidepanelQa({ exercisePanel: exercise });
  report.profileOwned = run.verified === true;
} catch {
  report.status = 'unverified';
  report.failure ??= { stage, driverFailure: { code: 'owned_harness_failed' } };
}
await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${report.status.toUpperCase()} screenshot_guest_gate\n`);
if (report.status === 'unverified') process.exitCode = 1;
