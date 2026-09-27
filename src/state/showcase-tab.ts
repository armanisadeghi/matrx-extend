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

/** One explicit Doctor click, scoped to the page that produced its selectors. */
export interface ListPatternRecommendation {
  tabId: number;
  url: string;
  listRoot: string;
  itemSelector: string;
  requestId: number;
}

let nextListRecommendationId = 0;

interface ShowcaseTabState {
  subTab: ShowcaseSubTab;
  setSubTab: (t: ShowcaseSubTab) => void;
  listRecommendation: ListPatternRecommendation | null;
  offerListRecommendation: (recommendation: Omit<ListPatternRecommendation, 'requestId'>) => void;
  clearListRecommendation: (requestId: number) => void;
}

export const useShowcaseTabStore = create<ShowcaseTabState>()(
  persist(
    (set) => ({
      subTab: 'doctor',
      setSubTab: (subTab) => set({ subTab }),
      listRecommendation: null,
      offerListRecommendation: (recommendation) =>
        set(() => ({
          listRecommendation: {
            ...recommendation,
            requestId: ++nextListRecommendationId,
          },
        })),
      clearListRecommendation: (requestId) =>
        set((state) =>
          state.listRecommendation?.requestId === requestId ? { listRecommendation: null } : state,
        ),
    }),
    {
      name: 'matrx.showcase.subTab.v1',
      storage: createJSONStorage(() => chromeLocalStorage),
      partialize: (state) => ({ subTab: state.subTab }),
    },
  ),
);
