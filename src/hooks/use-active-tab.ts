import { useSyncExternalStore } from 'react';

export interface ActiveTabInfo {
  id: number | null;
  url: string | null;
  title: string | null;
  documentId: string | null;
  identityStatus: 'resolving' | 'ready' | 'unresolved';
  identityError: string | null;
  pageKey: string | null;
}

const initial: ActiveTabInfo = {
  id: null,
  url: null,
  title: null,
  documentId: null,
  identityStatus: 'resolving',
  identityError: null,
  pageKey: null,
};
let snapshot = initial;
let sequence = 0;
let navigationPending = false;
let committedDocumentId: string | null = null;
const subscribers = new Set<() => void>();

function publish(next: ActiveTabInfo) {
  if (
    Object.keys(next).every(
      (key) => next[key as keyof ActiveTabInfo] === snapshot[key as keyof ActiveTabInfo],
    )
  )
    return;
  snapshot = next;
  for (const listener of subscribers) listener();
}

function withhold() {
  navigationPending = true;
  sequence += 1;
  publish({
    ...snapshot,
    documentId: null,
    identityStatus: 'resolving',
    identityError: null,
    pageKey: null,
  });
}

/** One sequenced active-tab and top-frame read serves every side-panel consumer. */
export async function refreshActiveTabIdentity(): Promise<void> {
  const ownSequence = ++sequence;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (ownSequence !== sequence) return;
    if (!tab?.id) {
      publish({
        ...initial,
        identityStatus: 'unresolved',
        identityError: 'No active browser tab. Select a page and retry.',
      });
      return;
    }
    const base = { id: tab.id, url: tab.url ?? null, title: tab.title ?? null };
    const frame = await chrome.webNavigation.getFrame({ tabId: tab.id, frameId: 0 });
    if (ownSequence !== sequence) return;
    if (navigationPending) return;
    if (
      !frame?.documentId ||
      frame.errorOccurred ||
      !frame.url ||
      (committedDocumentId && frame.documentId !== committedDocumentId)
    ) {
      publish({
        ...base,
        documentId: null,
        identityStatus: 'unresolved',
        identityError: 'Page identity is unavailable. Reload the page or retry.',
        pageKey: null,
      });
      return;
    }
    if (base.url && frame.url !== base.url) {
      publish({
        ...base,
        documentId: null,
        identityStatus: 'unresolved',
        identityError: 'Page navigation is still settling. Retry in a moment.',
        pageKey: null,
      });
      return;
    }
    const url = base.url ?? frame.url;
    publish({
      ...base,
      url,
      documentId: frame.documentId,
      identityStatus: 'ready',
      identityError: null,
      pageKey: JSON.stringify([tab.id, frame.documentId, url]),
    });
  } catch (error) {
    if (ownSequence !== sequence) return;
    publish({
      ...snapshot,
      documentId: null,
      identityStatus: 'unresolved',
      identityError: `Could not verify this page: ${error instanceof Error ? error.message : String(error)}. Retry.`,
      pageKey: null,
    });
  }
}

const onActivated = () => {
  withhold();
  navigationPending = false;
  committedDocumentId = null;
  void refreshActiveTabIdentity();
};
const onUpdated = (tabId: number, change: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
  if (!tab.active) return;
  if (change.status === 'loading' && tabId === snapshot.id) {
    withhold();
    committedDocumentId = null;
  }
  if (change.status === 'complete' && tabId === snapshot.id) navigationPending = false;
  if (change.status || change.url || change.title) void refreshActiveTabIdentity();
};
const onBeforeNavigate = (details: chrome.webNavigation.WebNavigationParentedCallbackDetails) => {
  if (details.frameId === 0 && details.tabId === snapshot.id) withhold();
};
const onCommitted = (details: chrome.webNavigation.WebNavigationTransitionCallbackDetails) => {
  if (details.frameId !== 0 || details.tabId !== snapshot.id) return;
  withhold();
  committedDocumentId = details.documentId ?? null;
  navigationPending = false;
  void refreshActiveTabIdentity();
};
const onError = (details: chrome.webNavigation.WebNavigationFramedErrorCallbackDetails) => {
  if (details.frameId === 0 && details.tabId === snapshot.id) {
    navigationPending = false;
    committedDocumentId = null;
    void refreshActiveTabIdentity();
  }
};
function subscribe(listener: () => void) {
  subscribers.add(listener);
  if (subscribers.size === 1) {
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.windows.onFocusChanged.addListener(onActivated);
    chrome.webNavigation.onBeforeNavigate.addListener(onBeforeNavigate);
    chrome.webNavigation.onCommitted.addListener(onCommitted);
    chrome.webNavigation.onErrorOccurred.addListener(onError);
    void refreshActiveTabIdentity();
  }
  return () => {
    subscribers.delete(listener);
    if (subscribers.size === 0) {
      sequence += 1;
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.windows.onFocusChanged.removeListener(onActivated);
      chrome.webNavigation.onBeforeNavigate.removeListener(onBeforeNavigate);
      chrome.webNavigation.onCommitted.removeListener(onCommitted);
      chrome.webNavigation.onErrorOccurred.removeListener(onError);
      snapshot = initial;
      navigationPending = false;
      committedDocumentId = null;
    }
  };
}

/** Non-React subscription to the same shared identity (ref-counted with `useActiveTab`). */
export const subscribeActiveTab = subscribe;

export function useActiveTab(): ActiveTabInfo {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => initial,
  );
}

export function isCurrentPageIdentity(pageKey: string | null): boolean {
  return pageKey !== null && snapshot.identityStatus === 'ready' && snapshot.pageKey === pageKey;
}

/** Read the same shared identity synchronously at an async action boundary. */
export function getActiveTabIdentitySnapshot(): ActiveTabInfo {
  return snapshot;
}
