import { useActiveTab } from '@/hooks/use-active-tab';
import {
  type CapturedNetEvent,
  networkRelayIsolated,
  networkTapMain,
} from '@/lib/data-pattern/network-tap';
import { on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Sidepanel-side network capture controller. Injects MAIN-world fetch/XHR
 * patches and the ISOLATED-world relay into the active tab on Start, then
 * accumulates incoming events until Stop.
 *
 * Important: only the patches are sticky — once installed they stay in place
 * for the page's lifetime. Stop just stops *recording* events; the patches
 * remain (idempotent) until the page reloads.
 */
export function useNetworkCapture() {
  const tab = useActiveTab();
  const [capturing, setCapturing] = useState(false);
  const [events, setEvents] = useState<CapturedNetEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [installed, setInstalled] = useState(false);
  const capturingRef = useRef(false);
  const tabIdRef = useRef<number | null>(null);

  useEffect(() => {
    return on<CapturedNetEvent, { ack: true }>(CHANNELS.NET_CAPTURE_EVENT, (event) => {
      // Filter: only events for the tab we're capturing, while we're capturing.
      // We can't get the source tab from chrome.runtime here, so trust the
      // event window: only accept while capturingRef is true.
      if (capturingRef.current) {
        setEvents((prev) => [...prev, event]);
      }
      return { ack: true };
    });
  }, []);

  const start = useCallback(async () => {
    if (!tab.id) return;
    setError(null);
    setEvents([]);
    tabIdRef.current = tab.id;
    try {
      // 1. Install MAIN-world tap (idempotent).
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: networkTapMain,
        args: [1_000_000],
      });
      // 2. Install ISOLATED-world relay (idempotent).
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: networkRelayIsolated,
      });
      setInstalled(true);
      capturingRef.current = true;
      setCapturing(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [tab.id]);

  const stop = useCallback(() => {
    capturingRef.current = false;
    setCapturing(false);
  }, []);

  const reload = useCallback(async () => {
    if (!tab.id) return;
    await chrome.tabs.reload(tab.id);
    // After reload, the patches are gone. Re-install on next start.
    setInstalled(false);
  }, [tab.id]);

  const clear = useCallback(() => setEvents([]), []);

  return {
    tab,
    capturing,
    events,
    error,
    installed,
    start,
    stop,
    reload,
    clear,
  };
}
