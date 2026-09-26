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
import { type SaveOutcome, saveCaptureAsSource } from '@/lib/sources/save-capture';
import { saveSeoAudit } from '@/lib/supabase/queries';
import { pushNotice } from '@/state/notices';
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
   * 'deep': scrolls top→bottom and waits for lazy content to settle
   * to trigger lazy-loaded images / IntersectionObserver content, THEN
   * captures, with live progress shown while the shared readiness routine runs.
   */
  mode?: ScrapeMode;
}

export function useScrape() {
  const {
    current,
    original,
    articleEdited,
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
          // scrollToLoadLazy includes shared post-scroll settling so JSXGraph
          // cannot be captured while only its empty axis/grid shell exists.
          await scrollToLoadLazy(tab.id, {
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
            result: {
              ok: false,
              ...(cap.reason !== undefined ? { reason: cap.reason } : {}),
              ...(cap.detail !== undefined ? { detail: cap.detail } : {}),
            },
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

  /**
   * Save the capture as a Source through the landing door (SOURCE-CONVERGENCE
   * §4.2). Never throws for a refusal or an outage and never loses the capture:
   * a landing that does not happen leaves it on this device under
   * "Unsaved — retry" (`save-capture.ts`).
   *
   * The unsaved-edits guard is disarmed (`markSaved`) ONLY when the Source
   * actually landed. An unsaved outcome leaves it armed, so a Re-capture still
   * asks before discarding edits the person has not saved.
   */
  const save = useCallback(
    async (extra: { patternId?: string } = {}): Promise<SaveOutcome | null> => {
      if (!current) return null;
      // Text and collectors from the (possibly edited) capture; the untouched
      // capture is the original; edited article text wins over the old HTML.
      const outcome = await saveCaptureAsSource(current, {
        ...extra,
        ...(original ? { original } : {}),
        articleEdited,
      });
      if (outcome.status !== 'landed') return outcome;
      markSaved();
      // The normalized wbx_seo_audit row powers the SEO tab's "Previously
      // audited" recognition. It is a companion write, not the save itself —
      // but when it fails the person is TOLD, never left believing it happened.
      const audit = await saveSeoAudit({
        url: current.url,
        signals: current.seo,
        flesch_reading_ease: current.seo.flesch_reading_ease,
        word_count: current.seo.word_count,
      }).catch(() => null);
      if (!audit) {
        pushNotice({
          tone: 'warning',
          title: 'SEO audit not recorded',
          message:
            'The page was saved, but its SEO audit was not recorded, so the SEO tab will not show it as previously audited. Open the SEO tab and press Save to record it.',
        });
      }
      return outcome;
    },
    [current, original, articleEdited, markSaved],
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
