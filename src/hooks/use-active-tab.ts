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
        setInfo({ id: tab.id ?? null, url: tab.url ?? null, title: tab.title ?? null });
      } catch (err) {
        console.warn('[matrx-extend] active tab query failed', err);
      }
    };
    void refresh();

    const onActivated = () => void refresh();
    const onUpdated = (_id: number, _info: chrome.tabs.TabChangeInfo, _tab: chrome.tabs.Tab) =>
      void refresh();

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
