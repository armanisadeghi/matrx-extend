import type { SidepanelTab } from '@/state/sidepanel-tab';

/**
 * The single release-facing switchboard for sidepanel features.
 *
 * To keep an unfinished feature available for internal testing while hiding
 * it from the public extension, change its value to `admin`. Both the tab
 * trigger and its content are gated from this table.
 */
export type SidepanelAudience = 'everyone' | 'signed-in' | 'admin';

export const SIDEPANEL_TAB_AUDIENCE = {
  chat: 'everyone',
  pilot: 'admin',
  tasks: 'signed-in',
  agenda: 'signed-in',
  lists: 'signed-in',
  scrape: 'everyone',
  data: 'everyone',
  highlight: 'signed-in',
  guidance: 'signed-in',
  seo: 'everyone',
  notes: 'signed-in',
  files: 'signed-in',
  screenshots: 'signed-in',
  vault: 'signed-in',
  tools: 'signed-in',
  settings: 'everyone',
  profile: 'signed-in',
  showcase: 'admin',
  broker: 'admin',
  debug: 'admin',
} as const satisfies Record<SidepanelTab, SidepanelAudience>;

export interface SidepanelViewer {
  signedIn: boolean;
  isAdmin: boolean;
}

export function canAccessSidepanelTab(tab: SidepanelTab, viewer: SidepanelViewer): boolean {
  const audience = SIDEPANEL_TAB_AUDIENCE[tab];
  if (audience === 'everyone') return true;
  if (audience === 'admin') return viewer.isAdmin;
  return viewer.signedIn;
}

export function firstAccessibleSidepanelTab(viewer: SidepanelViewer): SidepanelTab {
  const preferred: readonly SidepanelTab[] = ['chat', 'scrape', 'data', 'seo', 'settings'];
  return preferred.find((tab) => canAccessSidepanelTab(tab, viewer)) ?? 'chat';
}
