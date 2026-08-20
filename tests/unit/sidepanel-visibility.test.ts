import {
  SIDEPANEL_TAB_AUDIENCE,
  canAccessSidepanelTab,
  firstAccessibleSidepanelTab,
} from '@/config/sidepanel-visibility';
import type { SidepanelTab } from '@/state/sidepanel-tab';
import { describe, expect, it } from 'vitest';

const ALL_TABS = Object.keys(SIDEPANEL_TAB_AUDIENCE) as SidepanelTab[];

describe('sidepanel visibility', () => {
  it('keeps the launch configuration exhaustive and explicit', () => {
    expect(ALL_TABS).toHaveLength(20);
    expect(SIDEPANEL_TAB_AUDIENCE.chat).toBe('everyone');
    expect(SIDEPANEL_TAB_AUDIENCE.profile).toBe('signed-in');
    expect(SIDEPANEL_TAB_AUDIENCE.debug).toBe('admin');
  });

  it('shows guests only everyone tabs', () => {
    const visible = ALL_TABS.filter((tab) =>
      canAccessSidepanelTab(tab, { signedIn: false, isAdmin: false }),
    );
    expect(visible).toEqual(['chat', 'scrape', 'data', 'seo', 'settings']);
  });

  it('shows signed-in members everything except admin tabs', () => {
    const visible = ALL_TABS.filter((tab) =>
      canAccessSidepanelTab(tab, { signedIn: true, isAdmin: false }),
    );
    expect(visible).not.toContain('pilot');
    expect(visible).not.toContain('showcase');
    expect(visible).not.toContain('broker');
    expect(visible).not.toContain('debug');
    expect(visible).toContain('vault');
  });

  it('shows admins every configured tab', () => {
    expect(
      ALL_TABS.every((tab) => canAccessSidepanelTab(tab, { signedIn: true, isAdmin: true })),
    ).toBe(true);
  });

  it('returns a safe public fallback', () => {
    expect(firstAccessibleSidepanelTab({ signedIn: false, isAdmin: false })).toBe('chat');
  });
});
