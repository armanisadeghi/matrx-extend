import assert from 'node:assert/strict';
import { scrapeModeMatches } from './settings-guest-scrape-controls.mjs';
import { evaluate } from './settings-panel-driver.mjs';

// Own the absent-container reproduction independently of preceding preference cases.
export async function runWithAbsentScrapeModeBaseline({
  getPanel,
  reloadSettings,
  settings,
  openSection,
  observe,
  record,
  execute,
  driver = { evaluate },
}) {
  const key = JSON.stringify('matrx.settings.v1');
  const baseline = await driver.evaluate(
    getPanel(),
    `(async () => {
      const entries = await chrome.storage.local.get(${key});
      return { present: Object.hasOwn(entries, ${key}), raw: entries[${key}] ?? null };
    })()`,
  );
  try {
    await driver.evaluate(
      getPanel(),
      `(async () => { await chrome.storage.local.remove(${key}); })()`,
    );
    await reloadSettings(getPanel());
    await settings(getPanel());
    await openSection(getPanel(), 'Scrape');
    const initial = await observe(getPanel());
    const absent =
      initial.storagePresent === false &&
      initial.mode?.storedPresent === false &&
      scrapeModeMatches(
        { ...initial.mode, active: initial.active, sectionOpen: initial.sectionOpen },
        'capture',
        'Capture',
      );
    record('initial absent Settings container observed', absent ? 'pass' : 'fail', initial);
    assert.equal(absent, true, 'scrape_mode_absent_container_setup_failed');
    await execute(initial);
  } finally {
    await driver.evaluate(
      getPanel(),
      `(async () => {
        const baseline = ${JSON.stringify(baseline)};
        if (baseline.present) await chrome.storage.local.set({ [${key}]: baseline.raw });
        else await chrome.storage.local.remove(${key});
      })()`,
    );
    await reloadSettings(getPanel());
    await settings(getPanel());
    await openSection(getPanel(), 'Scrape');
    const restored = await driver.evaluate(
      getPanel(),
      `(async () => {
        const baseline = ${JSON.stringify(baseline)};
        const entries = await chrome.storage.local.get(${key});
        return { storagePresent: Object.hasOwn(entries, ${key}),
          exactBaselineRestored: Object.hasOwn(entries, ${key}) === baseline.present &&
            (!baseline.present || entries[${key}] === baseline.raw) };
      })()`,
    );
    record(
      'pre-T67 Settings container restored after panel reload',
      restored.exactBaselineRestored ? 'pass' : 'fail',
      restored,
    );
    assert.equal(
      restored.exactBaselineRestored,
      true,
      'scrape_mode_original_container_not_restored',
    );
  }
}
