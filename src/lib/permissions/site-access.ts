import type { ActiveTabInfo } from '@/hooks/use-active-tab';

export interface SiteAccessTarget {
  tabId: number;
  documentId: string;
  pageKey: string;
  url: string;
  originPattern: string;
}

/** Capture one verified browser document before offering a site-specific action. */
export function siteAccessTarget(tab: ActiveTabInfo): SiteAccessTarget | null {
  if (tab.id === null || !tab.documentId || !tab.pageKey || !tab.url) return null;
  try {
    const url = new URL(tab.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return {
      tabId: tab.id,
      documentId: tab.documentId,
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
    captured.documentId === current.documentId &&
    captured.pageKey === current.pageKey &&
    captured.url === current.url
  );
}

/** Read Chrome at the action boundary; React's last render can lag a tab switch. */
export async function verifyLiveSiteAccessTarget(
  target: SiteAccessTarget,
): Promise<'current' | 'stale' | 'unavailable'> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query || !chrome.webNavigation?.getFrame)
    return 'unavailable';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id !== target.tabId || tab.url !== target.url) return 'stale';
    const frame = await chrome.webNavigation.getFrame({ tabId: target.tabId, frameId: 0 });
    if (frame?.documentId !== target.documentId || frame.url !== target.url) return 'stale';
    const [stillActive] = await chrome.tabs.query({ active: true, currentWindow: true });
    return stillActive?.id === target.tabId && stillActive.url === target.url ? 'current' : 'stale';
  } catch {
    return 'unavailable';
  }
}

/** Called in the originating click handler after live tab/frame verification. */
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
