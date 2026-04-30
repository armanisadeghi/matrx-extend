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
export type PermissionMode = 'ask' | 'act';
export type ChatSpeed = 'fast' | 'thinking';
export type ScrapeAutoMode = 'capture' | 'scroll-capture';

interface SettingsState {
  theme: 'light' | 'dark' | 'system';

  /** Send captured HTML through the server-side AI cleanup pass before saving. */
  scrapeDeepClean: boolean;

  // ─── Chat defaults ──────────────────────────────────────────────────────
  /** Auto-selected when the chat tab loads with no agent chosen yet. */
  defaultAgentId: string | null;
  /** Fallback for the per-agent ask/act mode when an agent has no override. */
  defaultPermissionMode: PermissionMode;
  /** Composer speed default. NOT WIRED YET — placeholder UI only. */
  defaultChatSpeed: ChatSpeed;

  // ─── Scrape auto-capture (NOT WIRED YET) ───────────────────────────────
  /** Auto-run a scrape on every page load. Coming soon. */
  scrapeAutoOnLoad: boolean;
  /** When auto-scraping: plain capture, or scroll-and-capture. Coming soon. */
  scrapeAutoMode: ScrapeAutoMode;

  setTheme: (t: SettingsState['theme']) => void;
  setScrapeDeepClean: (b: boolean) => void;
  setDefaultAgentId: (id: string | null) => void;
  setDefaultPermissionMode: (m: PermissionMode) => void;
  setDefaultChatSpeed: (s: ChatSpeed) => void;
  setScrapeAutoOnLoad: (b: boolean) => void;
  setScrapeAutoMode: (m: ScrapeAutoMode) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'system',
      scrapeDeepClean: false,
      defaultAgentId: null,
      defaultPermissionMode: 'ask',
      defaultChatSpeed: 'fast',
      scrapeAutoOnLoad: false,
      scrapeAutoMode: 'capture',
      setTheme: (theme) => set({ theme }),
      setScrapeDeepClean: (scrapeDeepClean) => set({ scrapeDeepClean }),
      setDefaultAgentId: (defaultAgentId) => set({ defaultAgentId }),
      setDefaultPermissionMode: (defaultPermissionMode) => set({ defaultPermissionMode }),
      setDefaultChatSpeed: (defaultChatSpeed) => set({ defaultChatSpeed }),
      setScrapeAutoOnLoad: (scrapeAutoOnLoad) => set({ scrapeAutoOnLoad }),
      setScrapeAutoMode: (scrapeAutoMode) => set({ scrapeAutoMode }),
    }),
    {
      name: 'matrx.settings.v1',
      storage: createJSONStorage(() => chromeLocalStorage),
    },
  ),
);
