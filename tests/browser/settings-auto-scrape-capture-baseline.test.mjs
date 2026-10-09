import assert from 'node:assert/strict';
import test from 'node:test';
import {
  captureAutoScrapeBaseline,
  restoreAutoScrapeBaseline,
} from './settings-auto-scrape-capture-baseline.mjs';

function storageMock(initial = {}) {
  const values = structuredClone(initial);
  return {
    values,
    async get(key) {
      return Object.hasOwn(values, key) ? { [key]: values[key] } : {};
    },
    async set(entries) {
      Object.assign(values, entries);
    },
    async remove(key) {
      delete values[key];
    },
  };
}

const SETTINGS_KEY = 'matrx.settings.v1';

test('an absent OFF preference restores exact field absence and preserves sibling settings', async () => {
  const initial = {
    state: { saveScrapedContent: true, defaultPermissionMode: 'ask' },
    version: 1,
  };
  const storage = storageMock({ [SETTINGS_KEY]: JSON.stringify(initial) });
  const baseline = await captureAutoScrapeBaseline(storage);

  assert.deepEqual(
    {
      storagePresent: baseline.storagePresent,
      settingPresent: baseline.settingPresent,
      stored: baseline.stored,
    },
    { storagePresent: true, settingPresent: false, stored: null },
  );

  storage.values[SETTINGS_KEY] = JSON.stringify({
    state: { ...initial.state, scrapeAutoOnLoad: false },
    version: 1,
  });
  await restoreAutoScrapeBaseline(storage, baseline);

  const restored = JSON.parse(storage.values[SETTINGS_KEY]);
  assert.equal(Object.hasOwn(restored.state, 'scrapeAutoOnLoad'), false);
  assert.deepEqual(restored.state, initial.state);
  assert.equal(Object.hasOwn(storage.values, SETTINGS_KEY), true);
});

test('an initially absent settings key is removed after the probe', async () => {
  const storage = storageMock();
  const baseline = await captureAutoScrapeBaseline(storage);
  storage.values[SETTINGS_KEY] = JSON.stringify({
    state: { scrapeAutoOnLoad: false },
    version: 1,
  });

  await restoreAutoScrapeBaseline(storage, baseline);

  assert.equal(Object.hasOwn(storage.values, SETTINGS_KEY), false);
});

test('an explicit OFF preference is restored as explicit OFF', async () => {
  const storage = storageMock({
    [SETTINGS_KEY]: JSON.stringify({
      state: { saveScrapedContent: true, scrapeAutoOnLoad: false },
      version: 1,
    }),
  });
  const baseline = await captureAutoScrapeBaseline(storage);
  storage.values[SETTINGS_KEY] = JSON.stringify({
    state: { saveScrapedContent: true, scrapeAutoOnLoad: true },
    version: 1,
  });

  await restoreAutoScrapeBaseline(storage, baseline);

  const restored = JSON.parse(storage.values[SETTINGS_KEY]);
  assert.equal(restored.state.scrapeAutoOnLoad, false);
  assert.equal(restored.state.saveScrapedContent, true);
});
