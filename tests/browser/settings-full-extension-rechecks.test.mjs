import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  enforceFullExtensionRechecks,
  FULL_EXTENSION_RECHECK_IDS,
  initializeFullExtensionRechecks,
  runFullExtensionRecheck,
  snapshotPanelDocumentReload,
} from './settings-full-extension-rechecks.mjs';

function cases() {
  return FULL_EXTENSION_RECHECK_IDS.map((id) => ({
    id: `EXT-F-1003-${id}`,
    status: 'pass',
    steps: [],
    criteria: [
      { name: 'panel-document reload check', status: 'pass', evidence: { visible: true } },
    ],
  }));
}

test('missing or failed full-extension rechecks force the individual case to fail', async () => {
  const reportCases = cases();
  initializeFullExtensionRechecks(reportCases);
  const [theme, mode, sections, autoScrape, scrapeMode] = reportCases;

  await runFullExtensionRecheck(theme, async (record) => {
    record('theme visible, stored, and rendered after extension reload', 'pass', {
      selected: 'Dark',
      stored: 'dark',
      rendered: true,
    });
  });
  await runFullExtensionRecheck(mode, async (record) => {
    record('mode visible and stored after extension reload', 'pass', {
      selected: 'Act without asking',
      stored: 'act',
    });
    record('new chat inherits mode after extension reload', 'pass', {
      modeLabel: 'Act without asking',
      modeIcon: 'act',
    });
  });
  await runFullExtensionRecheck(sections, async (record) => {
    record('all section open/close assertions after extension reload', 'pass', { count: 44 });
  });
  await runFullExtensionRecheck(autoScrape, async (record, result) => {
    record('switch and stored value after extension reload; cleanup restored', 'pass', {
      visible: false,
      stored: false,
    });
    result.downstreamCapture = { status: 'unverified' };
  });
  await runFullExtensionRecheck(scrapeMode, async (record, result) => {
    record('mode picker and stored value after extension reload; cleanup restored', 'pass', {
      visible: 'Capture',
      stored: 'capture',
    });
    result.downstreamCapture = { status: 'unverified' };
  });

  const [fullTheme, fullMode, fullSections, fullAutoScrape, fullScrapeMode] = reportCases;
  snapshotPanelDocumentReload(fullTheme);
  assert.equal(fullTheme.panelDocumentReload.status, 'pass');
  assert.equal(fullTheme.fullExtensionReload.status, 'pass');
  assert.equal(fullMode.fullExtensionReload.criteria.length, 2);
  assert.equal(fullSections.fullExtensionReload.status, 'pass');
  assert.equal(fullAutoScrape.fullExtensionReload.downstreamCapture.status, 'unverified');
  assert.equal(fullScrapeMode.fullExtensionReload.downstreamCapture.status, 'unverified');

  const missing = { id: 'EXT-F-1003-T04', status: 'pass', criteria: [] };
  const failed = { id: 'EXT-F-1003-T10', status: 'pass', steps: [], criteria: [] };
  initializeFullExtensionRechecks([missing, failed]);
  await runFullExtensionRecheck(failed, async () => {
    throw new Error('injected_full_extension_failure');
  });
  enforceFullExtensionRechecks([missing, failed]);
  assert.equal(missing.fullExtensionReload.status, 'missing');
  assert.equal(missing.status, 'fail');
  assert.equal(failed.fullExtensionReload.status, 'fail');
  assert.equal(failed.status, 'fail');
  assert.match(failed.fullExtensionReload.error, /injected_full_extension_failure/);
});

test('native harness invokes the five rechecks after opening the replacement Settings panel', async () => {
  const source = await readFile(
    new URL('./settings-local-controls-acceptance.mjs', import.meta.url),
    'utf8',
  );
  const boundary = source.indexOf("status: 'settings_opened'");
  const recheck = source.indexOf('await rerunGuestSettingsAfterExtensionReload(replacement.panel)');
  const reloadCatch = source.indexOf('report.guestStageFailed = guestStage', boundary);
  assert.ok(boundary >= 0 && recheck > boundary && reloadCatch > recheck);
  assert.ok(source.includes('GUEST_PREFERENCES.filter('));
  assert.ok(source.includes("['T04', 'T10']"));
  assert.match(
    source,
    /\['T28', runGuestSectionsCase\][\s\S]*\['T40', runGuestAutoScrapeCase\][\s\S]*\['T67', runGuestAutoScrapeModeCase\]/,
  );
  assert.match(source, /enforceFullExtensionRechecks\(report\.cases\)/);
});
