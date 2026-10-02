import type { ActiveTabInfo } from '@/hooks/use-active-tab';

export interface SiteAccessTarget {
  tabId: number;
  pageKey: string;
  url: string;
  originPattern: string;
}

/** Capture one verified browser document before offering a site-specific action. */
export function siteAccessTarget(tab: ActiveTabInfo): SiteAccessTarget | null {
  if (tab.id === null || !tab.pageKey || !tab.url) return null;
  try {
    const url = new URL(tab.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return {
      tabId: tab.id,
      pageKey: tab.pageKey,
      url: tab.url,
      originPattern: `${url.origin}/*`,
    };
  } catch {
    return null;
  }
}

export function isSameSiteAccessTarget(
  captured: SiteAccessTarget | null,
  current: SiteAccessTarget | null,
): boolean {
  return (
    captured !== null &&
    current !== null &&
    captured.tabId === current.tabId &&
    captured.pageKey === current.pageKey &&
    captured.url === current.url
  );
}

/** A direct user click must call this without an intervening asynchronous check. */
export async function requestPersistentSiteAccess(
  target: SiteAccessTarget,
): Promise<'granted' | 'denied' | 'unavailable' | 'failed'> {
  if (typeof chrome === 'undefined' || !chrome.permissions?.request) return 'unavailable';
  try {
    return (await chrome.permissions.request({ origins: [target.originPattern] }))
      ? 'granted'
      : 'denied';
  } catch {
    return 'failed';
  }
}

/** Reloads only the tab captured when the control opened, never the sidepanel. */
export async function reloadSiteAccessTarget(
  target: SiteAccessTarget,
): Promise<'reloaded' | 'unavailable' | 'failed'> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.reload) return 'unavailable';
  try {
    await chrome.tabs.reload(target.tabId);
    return 'reloaded';
  } catch {
    return 'failed';
  }
}
