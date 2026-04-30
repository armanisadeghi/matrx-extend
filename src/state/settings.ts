import type { BackendEnv } from '@/config/env';
import { chromeLocalStorage } from '@/lib/storage/zustand-adapter';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface SettingsState {
  backendEnv: BackendEnv;
  backendOverride: string;
  theme: 'light' | 'dark' | 'system';
  scrapeDeepClean: boolean;
  setBackendEnv: (env: BackendEnv) => void;
  setBackendOverride: (s: string) => void;
  setTheme: (t: SettingsState['theme']) => void;
  setScrapeDeepClean: (b: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      backendEnv: 'prod',
      backendOverride: '',
      theme: 'system',
      scrapeDeepClean: false,
      setBackendEnv: (backendEnv) => set({ backendEnv }),
      setBackendOverride: (backendOverride) => set({ backendOverride }),
      setTheme: (theme) => set({ theme }),
      setScrapeDeepClean: (scrapeDeepClean) => set({ scrapeDeepClean }),
    }),
    {
      name: 'matrx.settings.v1',
      storage: createJSONStorage(() => chromeLocalStorage),
    },
  ),
);
