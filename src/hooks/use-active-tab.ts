import { useEffect, useState } from 'react';

export interface ActiveTabInfo {
  id: number | null;
  url: string | null;
  title: string | null;
}

export function useActiveTab(): ActiveTabInfo {
  const [info, setInfo] = useState<ActiveTabInfo>({ id: null, url: null, title: null });

  useEffect(() => {
    const refresh = async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) return;
        // Value-compare before writing: onUpdated fires for EVERY tab's
        // title/favicon/loading churn, and an always-fresh object re-rendered
        // every consumer (all 12 Showcase sub-tabs) per event (audit J5).
        setInfo((prev) => {
          const next = { id: tab.id ?? null, url: tab.url ?? null, title: tab.title ?? null };
          return prev.id === next.id && prev.url === next.url && prev.title === next.title
            ? prev
            : next;
        });
      } catch (err) {
        console.warn('[matrx-extend] active tab query failed', err);
      }
    };
    void refresh();

    const onActivated = () => void refresh();
    const onUpdated = (_id: number, _info: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      // Background-tab events can't change the ACTIVE tab's info.
      if (tab.active) void refresh();
    };

    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.windows.onFocusChanged.addListener(onActivated);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.windows.onFocusChanged.removeListener(onActivated);
    };
  }, []);

  return info;
}
