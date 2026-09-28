import { isCurrentPageIdentity, useActiveTab } from '@/hooks/use-active-tab';
import { type ExtractionSource, sourceFromUrl } from '@/hooks/use-extraction';
import { openNetworkPageLoadDiscovery } from '@/lib/data-pattern/document-network-transport';
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
  const [discovering, setDiscovering] = useState(false);
  const [discoveryProgress, setDiscoveryProgress] = useState<string | null>(null);
  const [events, setEvents] = useState<CapturedNetEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [installed, setInstalled] = useState(false);
  /** Page the capture session started on — pattern identity for saves. */
  const [source, setSource] = useState<ExtractionSource | null>(null);
  /** Oldest events evicted past MAX_EVENTS this session (FIFO cap). */
  const [dropped, setDropped] = useState(0);
  const capturingRef = useRef(false);
  const tabIdRef = useRef<number | null>(null);
  const capturePageKeyRef = useRef<string | null>(null);
  const droppedRef = useRef(0);
  const discoveryAbort = useRef<AbortController | null>(null);

  const appendEvent = useCallback((event: CapturedNetEvent) => {
    setEvents((prev) => {
      if (prev.length >= MAX_EVENTS) {
        droppedRef.current += 1;
        setDropped(droppedRef.current);
        return [...prev.slice(1), event];
      }
      return [...prev, event];
    });
  }, []);

  useEffect(() => {
    return on<CapturedNetEvent, { ack: true }>(CHANNELS.NET_CAPTURE_EVENT, (event) => {
      // Only accept while capturing AND only from the tab this session
      // started on — patches persist on previously-tapped tabs for their
      // page lifetime, and without this check their traffic pollutes the
      // current capture (audit I1). The SW stamps tab_id on every event.
      if (!capturingRef.current || !isCurrentPageIdentity(capturePageKeyRef.current)) return { ack: true };
      if (event.tab_id == null || event.tab_id !== tabIdRef.current) return { ack: true };
      appendEvent(event);
      return { ack: true };
    });
  }, [appendEvent]);

  const start = useCallback(async () => {
    if (!tab.id || !tab.pageKey) return;
    discoveryAbort.current?.abort();
    setError(null);
    setEvents([]);
    setSource(sourceFromUrl(tab.url));
    droppedRef.current = 0;
    setDropped(0);
    tabIdRef.current = tab.id;
    capturePageKeyRef.current = tab.pageKey;
    try {
      // Relay first so the earliest tapped response has somewhere to go.
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, documentIds: [tab.documentId!] },
        func: networkRelayIsolated,
      });
      if (!isCurrentPageIdentity(capturePageKeyRef.current)) return;
      capturingRef.current = true;
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, documentIds: [tab.documentId!] },
        world: 'MAIN',
        func: networkTapMain,
        args: [1_000_000],
      });
      if (!isCurrentPageIdentity(capturePageKeyRef.current)) return;
      setInstalled(true);
      capturingRef.current = true;
      setCapturing(true);
    } catch (err) {
      capturingRef.current = false;
      setCapturing(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [tab.id, tab.url, tab.documentId, tab.pageKey]);

  const capturePageLoad = useCallback(async () => {
    if (!tab.id || discoveryAbort.current) return;
    capturingRef.current = false;
    setCapturing(false);
    setError(null);
    setEvents([]);
    setSource(null);
    droppedRef.current = 0;
    setDropped(0);
    const controller = new AbortController();
    discoveryAbort.current = controller;
    setDiscovering(true);
    setDiscoveryProgress('Waiting for page-load capture approval…');
    try {
      const result = await openNetworkPageLoadDiscovery(tab.id, {
        signal: controller.signal,
        onEvent: appendEvent,
        onProgress: setDiscoveryProgress,
      });
      setSource(sourceFromUrl(result.pageUrl));
      setDiscoveryProgress('Page-load capture complete. Select a response below.');
    } catch (err) {
      // A failed or cancelled document capture did not establish a usable
      // current-page snapshot; never leave its partial responses selectable.
      setEvents([]);
      setSource(null);
      setError(err instanceof Error ? err.message : String(err));
      setDiscoveryProgress(null);
    } finally {
      if (discoveryAbort.current === controller) discoveryAbort.current = null;
      setDiscovering(false);
    }
  }, [appendEvent, tab.id, tab.url]);

  const stop = useCallback(() => {
    discoveryAbort.current?.abort();
    capturingRef.current = false;
    setCapturing(false);
  }, []);

  const reload = useCallback(async () => {
    if (!tab.id) return;
    discoveryAbort.current?.abort();
    // Reload destroys the patches — staying in "recording" state would show
    // "● recording" while nothing can ever arrive (audit I2). Stop first;
    // the user re-starts capture (which re-installs) after the reload.
    capturingRef.current = false;
    setCapturing(false);
    await chrome.tabs.reload(tab.id);
    setInstalled(false);
  }, [tab.id]);

  const clear = useCallback(() => setEvents([]), []);

  // Ordinary capture belongs to one document. Page-load discovery has its
  // own approved reload/document contract and is left to that controller.
  useEffect(() => {
    capturePageKeyRef.current = null;
    capturingRef.current = false;
    setCapturing(false);
    setInstalled(false);
    if (!discoveryAbort.current) {
      setEvents([]);
      setSource(null);
      setDropped(0);
    }
  }, [tab.pageKey]);

  useEffect(() => () => discoveryAbort.current?.abort(), [tab.id]);

  return {
    tab,
    capturing,
    discovering,
    discoveryProgress,
    events,
    error,
    installed,
    source,
    dropped,
    start,
    capturePageLoad,
    stop,
    reload,
    clear,
  };
}
