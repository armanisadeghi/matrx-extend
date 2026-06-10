/**
 * Active Showcase sub-tab. Persisted so the user's place survives sidepanel
 * close/reopen (audit P1-1) — every sub-tab is forceMounted and keeps its
 * state; this store is what decides which one is visible.
 */

import { chromeLocalStorage } from '@/lib/storage/zustand-adapter';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const SHOWCASE_SUB_TABS = [
  'doctor',
  'recipes',
  'prepare',
  'snapshot',
  'json_ld',
  'microdata',
  'tables',
  'framework',
  'ai_extract',
  'list_pattern',
  'network',
  'patterns',
] as const;
export type ShowcaseSubTab = (typeof SHOWCASE_SUB_TABS)[number];

interface ShowcaseTabState {
  subTab: ShowcaseSubTab;
  setSubTab: (t: ShowcaseSubTab) => void;
}

export const useShowcaseTabStore = create<ShowcaseTabState>()(
  persist(
    (set) => ({
      subTab: 'doctor',
      setSubTab: (subTab) => set({ subTab }),
    }),
    {
      name: 'matrx.showcase.subTab.v1',
      storage: createJSONStorage(() => chromeLocalStorage),
    },
  ),
);
