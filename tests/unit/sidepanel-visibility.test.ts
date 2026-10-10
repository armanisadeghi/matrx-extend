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
    // Every tab has an explicit release audience; adding one changes this roster deliberately.
    expect(ALL_TABS).toEqual([
      'chat',
      'pilot',
      'tasks',
      'agenda',
      'lists',
      'scrape',
      'saved-captures',
      'swipe-file',
      'capture',
      'data',
      'highlight',
      'guidance',
      'seo',
      'notes',
      'files',
      'screenshots',
      'vault',
      'tools',
      'settings',
      'profile',
      'showcase',
      'broker',
      'debug',
    ]);
    expect(SIDEPANEL_TAB_AUDIENCE.chat).toBe('everyone');
    expect(SIDEPANEL_TAB_AUDIENCE.profile).toBe('signed-in');
    expect(SIDEPANEL_TAB_AUDIENCE['saved-captures']).toBe('signed-in');
    expect(SIDEPANEL_TAB_AUDIENCE['swipe-file']).toBe('signed-in');
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
    expect(visible).toContain('swipe-file');
  });

  it('shows admins every configured tab', () => {
    expect(
      ALL_TABS.every((tab) => canAccessSidepanelTab(tab, { signedIn: true, isAdmin: true })),
    ).toBe(true);
  });

  it('does not open admin tabs from a stale admin flag on a guest viewer', () => {
    const staleGuest = { signedIn: false, isAdmin: true };
    expect(canAccessSidepanelTab('pilot', staleGuest)).toBe(false);
    expect(canAccessSidepanelTab('showcase', staleGuest)).toBe(false);
    expect(canAccessSidepanelTab('broker', staleGuest)).toBe(false);
    expect(canAccessSidepanelTab('debug', staleGuest)).toBe(false);
  });

  it('returns a safe public fallback', () => {
    expect(firstAccessibleSidepanelTab({ signedIn: false, isAdmin: false })).toBe('chat');
    expect(firstAccessibleSidepanelTab({ signedIn: true, isAdmin: false })).toBe('chat');
  });
});
