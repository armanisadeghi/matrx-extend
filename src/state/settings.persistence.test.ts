import { retrySettingsSave, useSettingsSaveState } from '@/lib/settings/persistence';
import { renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useSettingsStore } from './settings';

const originalSet = chrome.storage.local.set.bind(chrome.storage.local);

afterEach(() => {
  chrome.storage.local.set = originalSet;
});

it('persists the latest theme when two Chrome writes would complete in reverse order', async () => {
  const pending: Array<{ value: string; finish: () => Promise<void> }> = [];
  chrome.storage.local.set = vi.fn((values: Record<string, unknown>) => {
    const value = values['matrx.settings.v1'];
    if (typeof value !== 'string') return originalSet(values);
    return new Promise<void>((resolve) => {
      pending.push({
        value,
        finish: async () => {
          await originalSet(values);
          resolve();
        },
      });
    });
  }) as typeof chrome.storage.local.set;

  useSettingsStore.getState().setTheme('light');
  useSettingsStore.getState().setTheme('dark');
  await vi.waitFor(() => expect(pending.length).toBe(1));
  await pending[0]?.finish();
  await vi.waitFor(() => expect(pending.length).toBe(2));
  await pending[1]?.finish();
  const saved = await chrome.storage.local.get('matrx.settings.v1');
  expect(JSON.parse(saved['matrx.settings.v1'] as string).state.theme).toBe('dark');
});

it('reports a rejected preference write and retries the same latest choice', async () => {
  let refuse = true;
  chrome.storage.local.set = vi.fn((values: Record<string, unknown>) =>
    refuse ? Promise.reject(new Error('disk unavailable')) : originalSet(values),
  ) as typeof chrome.storage.local.set;
  const { result } = renderHook(() => useSettingsSaveState());

  useSettingsStore.getState().setTheme('light');
  await vi.waitFor(() => expect(result.current).toBe('error'));
  const before = await chrome.storage.local.get('matrx.settings.v1');
  expect(
    typeof before['matrx.settings.v1'] === 'string'
      ? JSON.parse(before['matrx.settings.v1']).state.theme
      : null,
  ).not.toBe('light');

  refuse = false;
  await retrySettingsSave();
  await vi.waitFor(() => expect(result.current).toBe('saved'));
  const after = await chrome.storage.local.get('matrx.settings.v1');
  expect(JSON.parse(after['matrx.settings.v1'] as string).state.theme).toBe('light');
});

it('does not report an older failed choice after a newer choice saves', async () => {
  let failFirst = true;
  chrome.storage.local.set = vi.fn((values: Record<string, unknown>) => {
    if (failFirst) {
      failFirst = false;
      return Promise.reject(new Error('temporary write refusal'));
    }
    return originalSet(values);
  }) as typeof chrome.storage.local.set;
  const { result } = renderHook(() => useSettingsSaveState());

  useSettingsStore.getState().setTheme('dark');
  useSettingsStore.getState().setTheme('system');
  await vi.waitFor(() => expect(chrome.storage.local.set).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(result.current).toBe('saved'));
  const saved = await chrome.storage.local.get('matrx.settings.v1');
  expect(JSON.parse(saved['matrx.settings.v1'] as string).state.theme).toBe('system');
});
