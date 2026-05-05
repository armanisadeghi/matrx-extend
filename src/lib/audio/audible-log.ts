/**
 * Tiny SW-side audio event log. Subscribes to `chrome.tabs.onUpdated` for
 * the `audible` field; remembers the most recent timestamp each tab was
 * last heard from. `tab_audio_inspect` reads this log to answer
 * "which tabs have made noise recently?".
 */
const lastAudibleByTab = new Map<number, number>();
const lastMutedByTab = new Map<number, number>();
let installed = false;

export function startAudibleLog(): void {
  if (installed) return;
  installed = true;
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.audible !== undefined) {
      if (changeInfo.audible) lastAudibleByTab.set(tabId, Date.now());
    }
    if (changeInfo.mutedInfo !== undefined) {
      lastMutedByTab.set(tabId, Date.now());
    }
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    lastAudibleByTab.delete(tabId);
    lastMutedByTab.delete(tabId);
  });
}

export function lastAudibleAt(tabId: number): number | null {
  return lastAudibleByTab.get(tabId) ?? null;
}

export function lastMutedChangeAt(tabId: number): number | null {
  return lastMutedByTab.get(tabId) ?? null;
}
