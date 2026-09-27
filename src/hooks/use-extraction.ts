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
  const [detectError, setDetectError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [source, setSource] = useState<ExtractionSource | null>(null);
  const [previewConfig, setPreviewConfig] = useState<unknown>(null);
  const [previewPageKey, setPreviewPageKey] = useState<string | null>(null);
  const pageGeneration = useRef(0);
  const detectSeq = useRef(0);
  const runSeq = useRef(0);
  const pageKey = `${tab.id ?? ''}:${tab.url ?? ''}`;

  // Navigation invalidates everything extracted from the previous page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tab.id/tab.url are the invalidation keys.
  useEffect(() => {
    pageGeneration.current += 1; // in-flight calls from the old page can't commit
    detectSeq.current += 1;
    runSeq.current += 1;
    setRows(null);
    setDetectError(null);
    setRunError(null);
    setSource(null);
    setPreviewConfig(null);
    setPreviewPageKey(null);
    setRunning(false); // a superseded run's finally won't clear this itself
  }, [tab.id, tab.url]);

  const detect = useCallback(
    async (config?: unknown): Promise<DetectionHint | null> => {
      if (!tab.id) return null;
      const seq = ++detectSeq.current;
      const generation = pageGeneration.current;
      try {
        const hint = await detectModeInPage(modeId, tab.id, config);
        if (seq !== detectSeq.current || generation !== pageGeneration.current) return hint;
        setDetection(hint);
        setDetectError(null);
        return hint;
      } catch (err) {
        if (seq === detectSeq.current && generation === pageGeneration.current) {
          setDetectError(err instanceof Error ? err.message : String(err));
        }
        return null;
      }
    },
    [modeId, tab.id],
  );

  const run = useCallback(
    async (config: unknown): Promise<ExtractedRow[]> => {
      if (!tab.id) return [];
      const seq = ++runSeq.current;
      const generation = pageGeneration.current;
      const sourceAtRun = sourceFromUrl(tab.url);
      const pageKeyAtRun = `${tab.id}:${tab.url ?? ''}`;
      setRunning(true);
      setRunError(null);
      setRows(null);
      setSource(null);
      setPreviewConfig(null);
      setPreviewPageKey(null);
      try {
        const result = await runMode(modeId, tab.id, config);
        if (seq === runSeq.current && generation === pageGeneration.current) {
          setRows(result);
          setSource(sourceAtRun);
          setPreviewConfig(config);
          setPreviewPageKey(pageKeyAtRun);
        }
        return result;
      } catch (err) {
        if (seq === runSeq.current && generation === pageGeneration.current) {
          setRunError(err instanceof Error ? err.message : String(err));
        }
        return [];
      } finally {
        if (seq === runSeq.current && generation === pageGeneration.current) setRunning(false);
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
    setDetectError(null);
    setRunError(null);
    setSource(null);
    setPreviewConfig(null);
    setPreviewPageKey(null);
  }, []);

  const previewIsCurrentPage = previewPageKey === pageKey;
  return {
    tab,
    detection,
    rows: previewIsCurrentPage ? rows : null,
    running,
    error: runError ?? detectError,
    source: previewIsCurrentPage ? source : null,
    previewConfig: previewIsCurrentPage ? previewConfig : null,
    detect,
    run,
    reset,
  };
}
