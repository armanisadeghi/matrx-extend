import { useActiveTab } from '@/hooks/use-active-tab';
import { detectModeInPage, runMode } from '@/lib/data-pattern/run-pattern';
import type { DetectionHint, ExtractedRow } from '@/lib/data-pattern/types';
import { useCallback, useEffect, useRef, useState } from 'react';

/** Where extracted rows actually came from, captured at extraction time. */
export interface ExtractionSource {
  url: string;
  host: string;
  pathname: string;
}

export function sourceFromUrl(url: string | null | undefined): ExtractionSource | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return { url, host: u.host, pathname: u.pathname };
  } catch {
    return null;
  }
}

/**
 * Drive a single extraction mode against the active tab. Used by every
 * Showcase sub-tab. Auto-detects on mount + URL change so the summary at
 * the top of each sub-tab is always current.
 *
 * Staleness rules (audit P0-2 / P1-8):
 *   - rows/error/source reset when the tab or URL changes — rows extracted
 *     on site A must never sit under site B's header (or get saved there).
 *   - detect/run results only commit if no newer call started since
 *     (token guard), so out-of-order responses can't win.
 *   - a successful detect clears a previous error — a chrome:// failure
 *     doesn't stick after navigating somewhere extractable.
 */
export function useExtraction(modeId: string, options?: { autoDetect?: boolean }) {
  const autoDetect = options?.autoDetect ?? true;
  const tab = useActiveTab();
  const [detection, setDetection] = useState<DetectionHint | null>(null);
  const [rows, setRows] = useState<ExtractedRow[] | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<ExtractionSource | null>(null);
  const callSeq = useRef(0);

  // Navigation invalidates everything extracted from the previous page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tab.id/tab.url are the invalidation keys.
  useEffect(() => {
    callSeq.current += 1; // in-flight calls from the old page can't commit
    setRows(null);
    setError(null);
    setSource(null);
    setRunning(false); // a superseded run's finally won't clear this itself
  }, [tab.id, tab.url]);

  const detect = useCallback(
    async (config?: unknown): Promise<DetectionHint | null> => {
      if (!tab.id) return null;
      const seq = ++callSeq.current;
      try {
        const hint = await detectModeInPage(modeId, tab.id, config);
        if (seq !== callSeq.current) return hint; // a newer call superseded us
        setDetection(hint);
        setError(null);
        return hint;
      } catch (err) {
        if (seq === callSeq.current) {
          setError(err instanceof Error ? err.message : String(err));
        }
        return null;
      }
    },
    [modeId, tab.id],
  );

  const run = useCallback(
    async (config: unknown): Promise<ExtractedRow[]> => {
      if (!tab.id) return [];
      const seq = ++callSeq.current;
      const sourceAtRun = sourceFromUrl(tab.url);
      setRunning(true);
      setError(null);
      try {
        const result = await runMode(modeId, tab.id, config);
        if (seq === callSeq.current) {
          setRows(result);
          setSource(sourceAtRun);
        }
        return result;
      } catch (err) {
        if (seq === callSeq.current) {
          setError(err instanceof Error ? err.message : String(err));
        }
        return [];
      } finally {
        if (seq === callSeq.current) setRunning(false);
      }
    },
    [modeId, tab.id, tab.url],
  );

  // tab.url is in deps so SPA navigations (same tab.id, new URL) re-detect.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tab.url is intentional.
  useEffect(() => {
    if (autoDetect && tab.id) void detect();
  }, [autoDetect, detect, tab.id, tab.url]);

  const reset = useCallback(() => {
    setRows(null);
    setError(null);
    setSource(null);
  }, []);

  return { tab, detection, rows, running, error, source, detect, run, reset };
}
