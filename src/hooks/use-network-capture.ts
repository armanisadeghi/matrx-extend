import { useActiveTab } from '@/hooks/use-active-tab';
import { type ExtractionSource, sourceFromUrl } from '@/hooks/use-extraction';
import {
  type CapturedNetEvent,
  networkRelayIsolated,
  networkTapMain,
} from '@/lib/data-pattern/network-tap';
import { on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Event buffer cap. Bodies can be up to 1MB each, so an unbounded array can
 * reach hundreds of MB on a chatty SPA. Oldest events are evicted FIFO and
 * the UI shows how many were dropped.
 */
const MAX_EVENTS = 500;

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
  /** Page the capture session started on — pattern identity for saves. */
  const [source, setSource] = useState<ExtractionSource | null>(null);
  /** Oldest events evicted past MAX_EVENTS this session (FIFO cap). */
  const [dropped, setDropped] = useState(0);
  const capturingRef = useRef(false);
  const tabIdRef = useRef<number | null>(null);
  const droppedRef = useRef(0);

  useEffect(() => {
    return on<CapturedNetEvent, { ack: true }>(CHANNELS.NET_CAPTURE_EVENT, (event) => {
      // Only accept while capturing AND only from the tab this session
      // started on — patches persist on previously-tapped tabs for their
      // page lifetime, and without this check their traffic pollutes the
      // current capture (audit I1). The SW stamps tab_id on every event.
      if (!capturingRef.current) return { ack: true };
      if (event.tab_id == null || event.tab_id !== tabIdRef.current) return { ack: true };
      setEvents((prev) => {
        if (prev.length >= MAX_EVENTS) {
          droppedRef.current += 1;
          setDropped(droppedRef.current);
          return [...prev.slice(1), event];
        }
        return [...prev, event];
      });
      return { ack: true };
    });
  }, []);

  const start = useCallback(async () => {
    if (!tab.id) return;
    setError(null);
    setEvents([]);
    setSource(sourceFromUrl(tab.url));
    droppedRef.current = 0;
    setDropped(0);
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
    // Reload destroys the patches — staying in "recording" state would show
    // "● recording" while nothing can ever arrive (audit I2). Stop first;
    // the user re-starts capture (which re-installs) after the reload.
    capturingRef.current = false;
    setCapturing(false);
    await chrome.tabs.reload(tab.id);
    setInstalled(false);
  }, [tab.id]);

  const clear = useCallback(() => setEvents([]), []);

  return {
    tab,
    capturing,
    events,
    error,
    installed,
    source,
    dropped,
    start,
    stop,
    reload,
    clear,
  };
}
