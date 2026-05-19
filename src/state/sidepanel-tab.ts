/**
 * Active sidepanel tab — exposed as a tiny zustand store so non-React
 * code (e.g. the agenda runner) can switch tabs programmatically.
 */

import { create } from 'zustand';

export type SidepanelTab =
  | 'chat'
  | 'pilot'
  | 'tasks'
  | 'agenda'
  | 'lists'
  | 'scrape'
  | 'data'
  | 'guidance'
  | 'seo'
  | 'notes'
  | 'screenshots'
  | 'tools'
  | 'settings'
  | 'profile'
  | 'showcase'
  | 'debug';

interface SidepanelTabState {
  tab: SidepanelTab;
  setTab: (t: SidepanelTab) => void;
}

export const useSidepanelTabStore = create<SidepanelTabState>((set) => ({
  tab: 'chat',
  setTab: (tab) => set({ tab }),
}));
