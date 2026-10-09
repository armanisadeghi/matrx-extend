export async function captureAutoScrapeBaseline(storage) {
  const SETTINGS_KEY = 'matrx.settings.v1';
  const entries = await storage.get(SETTINGS_KEY);
  const storagePresent = Object.hasOwn(entries, SETTINGS_KEY);
  const rawValue = storagePresent ? entries[SETTINGS_KEY] : null;
  let settings;
  try {
    settings = rawValue ? JSON.parse(rawValue) : null;
  } catch {}
  const state = settings?.state;
  const settingPresent = Boolean(state && Object.hasOwn(state, 'scrapeAutoOnLoad'));
  const value = settingPresent ? state.scrapeAutoOnLoad : null;
  return {
    storagePresent,
    settingPresent,
    stored: typeof value === 'boolean' ? value : null,
    rawValue,
  };
}

export async function restoreAutoScrapeBaseline(storage, baseline) {
  const SETTINGS_KEY = 'matrx.settings.v1';
  if (!baseline.storagePresent) {
    await storage.remove(SETTINGS_KEY);
    return;
  }

  const entries = await storage.get(SETTINGS_KEY);
  const rawValue = Object.hasOwn(entries, SETTINGS_KEY) ? entries[SETTINGS_KEY] : baseline.rawValue;
  let settings;
  try {
    settings = JSON.parse(rawValue);
  } catch {
    settings = JSON.parse(baseline.rawValue);
  }
  if (
    !settings ||
    typeof settings !== 'object' ||
    !settings.state ||
    typeof settings.state !== 'object'
  ) {
    settings = JSON.parse(baseline.rawValue);
  }

  if (baseline.settingPresent) settings.state.scrapeAutoOnLoad = baseline.stored;
  else {
    settings.state = Object.fromEntries(
      Object.entries(settings.state).filter(([key]) => key !== 'scrapeAutoOnLoad'),
    );
  }

  await storage.set({ [SETTINGS_KEY]: JSON.stringify(settings) });
}

export function autoScrapePreferenceIsConsistent(observed) {
  return (
    observed?.visible === observed?.stored ||
    (observed?.visible === false && observed?.stored === null && observed?.settingPresent === false)
  );
}

export function autoScrapePreferenceMatches(observed, expected) {
  return (
    observed?.visible === expected &&
    (observed?.stored === expected ||
      (expected === false && observed?.stored === null && observed?.settingPresent === false))
  );
}
