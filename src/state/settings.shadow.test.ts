import { beforeEach, expect, it, vi } from 'vitest';

beforeEach(async () => {
  vi.resetModules();
  await chrome.storage.local.clear();
});

it.each(['dark', 'light'] as const)(
  'persists %s theme without creating a retired mode shadow',
  async (theme) => {
    const { useSettingsStore } = await import('./settings');
    await useSettingsStore.persist.rehydrate();
    useSettingsStore.getState().setTheme(theme);
    await vi.waitFor(async () => {
      const saved = await chrome.storage.local.get('matrx.settings.v1');
      const state = JSON.parse(saved['matrx.settings.v1'] as string).state;
      expect(state.theme).toBe(theme);
      expect(state).not.toHaveProperty('defaultPermissionMode');
    });
  },
);

it('migrates a legacy shadow while retaining unrelated settings across reload and later writes', async () => {
  await chrome.storage.local.set({
    'matrx.settings.v1': JSON.stringify({
      version: 6,
      state: {
        theme: 'dark',
        defaultPermissionMode: 'act',
        defaultAgentId: 'chosen-agent',
        scrapeDeepClean: true,
      },
    }),
  });
  let { useSettingsStore } = await import('./settings');
  await useSettingsStore.persist.rehydrate();
  expect(useSettingsStore.getState()).not.toHaveProperty('defaultPermissionMode');
  useSettingsStore.getState().setTheme('light');
  await vi.waitFor(async () => {
    const saved = await chrome.storage.local.get('matrx.settings.v1');
    const state = JSON.parse(saved['matrx.settings.v1'] as string).state;
    expect(state.theme).toBe('light');
    expect(state.defaultAgentId).toBe('chosen-agent');
    expect(state.scrapeDeepClean).toBe(true);
    expect(state).not.toHaveProperty('defaultPermissionMode');
  });
  vi.resetModules();
  ({ useSettingsStore } = await import('./settings'));
  await useSettingsStore.persist.rehydrate();
  useSettingsStore.getState().setTheme('system');
  await vi.waitFor(async () => {
    const saved = await chrome.storage.local.get('matrx.settings.v1');
    const state = JSON.parse(saved['matrx.settings.v1'] as string).state;
    expect(state.theme).toBe('system');
    expect(state.defaultAgentId).toBe('chosen-agent');
    expect(state.scrapeDeepClean).toBe(true);
    expect(state).not.toHaveProperty('defaultPermissionMode');
  });
});

it('does not re-emit a retired field from a current-version hydrated blob', async () => {
  const { SETTINGS_PERSIST_VERSION } = await import('@/lib/settings/migrate');
  await chrome.storage.local.set({
    'matrx.settings.v1': JSON.stringify({
      version: SETTINGS_PERSIST_VERSION,
      state: { theme: 'light', defaultPermissionMode: 'ask', scrapeDeepClean: true },
    }),
  });
  const { useSettingsStore } = await import('./settings');
  await useSettingsStore.persist.rehydrate();
  useSettingsStore.getState().setTheme('dark');
  await vi.waitFor(async () => {
    const saved = await chrome.storage.local.get('matrx.settings.v1');
    const state = JSON.parse(saved['matrx.settings.v1'] as string).state;
    expect(state.theme).toBe('dark');
    expect(state.scrapeDeepClean).toBe(true);
    expect(state).not.toHaveProperty('defaultPermissionMode');
  });
});
