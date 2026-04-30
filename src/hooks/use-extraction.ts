import { useActiveTab } from '@/hooks/use-active-tab';
import { detectModeInPage, runMode } from '@/lib/data-pattern/run-pattern';
import type { DetectionHint, ExtractedRow } from '@/lib/data-pattern/types';
import { useCallback, useEffect, useState } from 'react';

/**
 * Drive a single extraction mode against the active tab. Used by every
 * Showcase sub-tab. Auto-detects on mount + URL change so the summary at
 * the top of each sub-tab is always current.
 */
export function useExtraction(modeId: string, options?: { autoDetect?: boolean }) {
  const autoDetect = options?.autoDetect ?? true;
  const tab = useActiveTab();
  const [detection, setDetection] = useState<DetectionHint | null>(null);
  const [rows, setRows] = useState<ExtractedRow[] | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detect = useCallback(
    async (config?: unknown): Promise<DetectionHint | null> => {
      if (!tab.id) return null;
      try {
        const hint = await detectModeInPage(modeId, tab.id, config);
        setDetection(hint);
        return hint;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [modeId, tab.id],
  );

  const run = useCallback(
    async (config: unknown): Promise<ExtractedRow[]> => {
      if (!tab.id) return [];
      setRunning(true);
      setError(null);
      try {
        const result = await runMode(modeId, tab.id, config);
        setRows(result);
        return result;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return [];
      } finally {
        setRunning(false);
      }
    },
    [modeId, tab.id],
  );

  // tab.url is in deps so SPA navigations (same tab.id, new URL) re-detect.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tab.url is intentional.
  useEffect(() => {
    if (autoDetect && tab.id) void detect();
  }, [autoDetect, detect, tab.id, tab.url]);

  const reset = useCallback(() => {
    setRows(null);
    setError(null);
  }, []);

  return { tab, detection, rows, running, error, detect, run, reset };
}
