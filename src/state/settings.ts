import { chromeLocalStorage } from '@/lib/storage/zustand-adapter';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * UI-only preferences that don't affect cross-context wiring.
 *
 * Backend env / URL override are NOT here — they live in chrome.storage.local
 * under their own keys (see src/config/backend.ts) so every MV3 context
 * (sidepanel, SW, offscreen) reads the same source of truth.
 */
interface SettingsState {
  theme: 'light' | 'dark' | 'system';
  scrapeDeepClean: boolean;
  setTheme: (t: SettingsState['theme']) => void;
  setScrapeDeepClean: (b: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'system',
      scrapeDeepClean: false,
      setTheme: (theme) => set({ theme }),
      setScrapeDeepClean: (scrapeDeepClean) => set({ scrapeDeepClean }),
    }),
    {
      name: 'matrx.settings.v1',
      storage: createJSONStorage(() => chromeLocalStorage),
    },
  ),
);
