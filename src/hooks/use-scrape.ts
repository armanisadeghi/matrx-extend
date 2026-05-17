import { on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import {
  buildCaptureError,
  buildCaptureErrorFromResult,
  classifyTabUrl,
} from '@/lib/scrape/capture-error';
import { captureWithFallback } from '@/lib/scrape/capture-with-fallback';
import type {
  DiagnoseMode,
  DiagnosePickPayload,
  DiagnoseResult,
} from '@/lib/scrape/diagnose-bundle';
import { scrollToLoadLazy } from '@/lib/scrape/page-ready';
import { saveCapture, saveSeoAudit } from '@/lib/supabase/queries';
import { useScrapeStore } from '@/state/scrape';
import { useCallback, useEffect, useState } from 'react';

export type ScrapeMode = 'fast' | 'deep';

export interface ScrapeProgress {
  /** 1-indexed step. */
  step: number;
  /** Estimated total steps. */
  total: number;
}

interface CaptureOptions {
  /**
   * 'fast' (default): captures whatever's currently in the DOM. Predictable,
   * instant. Same behavior the manual Scrape tab has always had.
   *
   * 'deep': scrolls top→bottom (no settle wait — page is already visible)
   * to trigger lazy-loaded images / IntersectionObserver content, THEN
   * captures. Tuned for snappiness: 100ms/step, 4s cap, with live progress.
   */
  mode?: ScrapeMode;
}

export function useScrape() {
  const {
    current,
    loading,
    error,
    edited,
    setCurrent,
    setLoading,
    setError,
    markSaved,
  } = useScrapeStore();
  const setDiagnosePicking = useScrapeStore((s) => s.setDiagnosePicking);
  const setDiagnoseResult = useScrapeStore((s) => s.setDiagnoseResult);
  const diagnoseMode = useScrapeStore((s) => s.diagnose.mode);
  /** Which mode is currently running. Null when idle. */
  const [activeMode, setActiveMode] = useState<ScrapeMode | null>(null);
  /** Scroll progress, surfaced for the manual "Scroll & capture" button. */
  const [progress, setProgress] = useState<ScrapeProgress | null>(null);

  // Subscribe to picker results once. The picker is short-lived per click but
  // a stale listener doesn't hurt; the unsubscribe keeps things tidy on
  // sidepanel unmount / re-mount.
  useEffect(() => {
    const offResult = on<DiagnosePickPayload & { mode?: DiagnoseMode }, { ack: true }>(
      CHANNELS.DIAGNOSE_PICKER_RESULT,
      (payload) => {
        const mode: DiagnoseMode = payload.mode === 'unwanted' ? 'unwanted' : 'missing';
        const result: DiagnoseResult = {
          ...payload,
          mode,
          capturedAt: Date.now(),
        };
        setDiagnoseResult(result);
        return { ack: true };
      },
    );
    const offExit = on<unknown, { ack: true }>(CHANNELS.DIAGNOSE_PICKER_EXIT, () => {
      setDiagnosePicking(false);
      return { ack: true };
    });
    return () => {
      offResult();
      offExit();
    };
  }, [setDiagnoseResult, setDiagnosePicking]);

  const launchDiagnose = useCallback(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    setDiagnosePicking(true);
    try {
      // Stamp the mode on documentElement so the content-script entrypoint
      // can read it on startup. Same world as the content script (both ISOLATED
      // and MAIN can read attributes set this way).
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (mode: string) => {
          document.documentElement.setAttribute('data-matrx-diagnose-mode', mode);
        },
        args: [diagnoseMode],
      });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content-scripts/diagnose-picker.js'],
      });
    } catch (err) {
      setDiagnosePicking(false);
      console.warn('[matrx-extend] diagnose picker injection failed', err);
    }
  }, [diagnoseMode, setDiagnosePicking]);

  const captureActiveTab = useCallback(
    async ({ mode = 'fast' }: CaptureOptions = {}) => {
      setLoading(true);
      setActiveMode(mode);
      setError(null);
      setProgress(null);
      let tabId: number | null = null;
      let tabUrl: string | null = null;
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        tabId = tab?.id ?? null;
        tabUrl = tab?.url ?? null;
        if (!tab?.id) {
          setError(buildCaptureError({ err: new Error('No active tab'), url: tabUrl, tabId }));
          return null;
        }

        // Pre-flight URL check. Saves a confusing Chrome error and a wasted
        // round-trip when we already know the page is on the blocklist.
        const urlClass = classifyTabUrl(tab.url);
        if (urlClass.blocked) {
          setError(buildCaptureError({ err: null, url: tab.url ?? null, tabId: tab.id }));
          return null;
        }

        if (mode === 'deep') {
          // NOTE: no settlePage here. The user already sees the rendered page
          // before clicking — settling adds latency without value. Tasks
          // (automated) is where settling matters; that path is untouched.
          await scrollToLoadLazy(tab.id, {
            delayMs: 100,
            maxMs: 4000,
            onProgress: ({ step, total }) => setProgress({ step, total }),
          });
          setProgress(null);
        }

        // Route through captureWithFallback (the same path auto-scrape and
        // read_active_page use) so a missing content script triggers an
        // inject retry instead of a hard "no-receiver" failure.
        const cap = await captureWithFallback(tab.id, tab.url ?? null);
        if (cap.ok && cap.soup) {
          setCurrent(cap.soup);
          return cap.soup;
        }
        setError(
          buildCaptureErrorFromResult({
            result: { ok: false, reason: cap.reason, detail: cap.detail },
            url: tabUrl,
            tabId,
          }),
        );
        return null;
      } catch (err) {
        setError(buildCaptureError({ err, url: tabUrl, tabId }));
        return null;
      } finally {
        setLoading(false);
        setActiveMode(null);
        setProgress(null);
      }
    },
    [setCurrent, setError, setLoading],
  );

  /**
   * Reload the active tab. Used by the error card's "Reload page" button —
   * the most common fix for "Receiving end does not exist" (content script
   * present in the page but tied to a stale extension instance).
   */
  const reloadActiveTab = useCallback(async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return false;
      await chrome.tabs.reload(tab.id);
      setError(null);
      return true;
    } catch {
      return false;
    }
  }, [setError]);

  const clearError = useCallback(() => setError(null), [setError]);

  const save = useCallback(
    async (extra: { patternId?: string } = {}) => {
      if (!current) return null;
      // Persist the full capture (the SEO data is embedded in soup as
      // current.seo, so it round-trips with the snapshot).
      const captureRow = await saveCapture({
        url: current.url,
        title: current.metadata.title || undefined,
        description: current.metadata.description ?? undefined,
        lang: current.metadata.lang ?? undefined,
        soup: current,
        markdown: current.article.content_markdown ?? undefined,
        metadata: current.metadata,
        ld_json: current.ld_json,
        media_count: current.images.length + current.videos.length + current.audio.length,
        pattern_id: extra.patternId,
      });
      // Also write a normalized wbx_seo_audit row so the standalone SEO tab's
      // "Previously audited" recognition works without us re-fetching the
      // capture's JSONB blob. Best-effort — we don't fail the save if this
      // sub-write errors.
      void saveSeoAudit({
        url: current.url,
        signals: current.seo,
        flesch_reading_ease: current.seo.flesch_reading_ease,
        word_count: current.seo.word_count,
      }).catch(() => undefined);
      // The persisted row now matches the in-memory state — clear the
      // "edited" flag so the badge disappears and Re-capture stops warning.
      markSaved();
      return captureRow;
    },
    [current, markSaved],
  );

  return {
    current,
    loading,
    activeMode,
    progress,
    error,
    edited,
    captureActiveTab,
    reloadActiveTab,
    clearError,
    save,
    launchDiagnose,
  };
}
