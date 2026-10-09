import {
  getActiveTabIdentitySnapshot,
  isCurrentPageIdentity,
  useActiveTab,
} from '@/hooks/use-active-tab';
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
import { useCallback, useEffect, useRef, useState } from 'react';

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
  const tab = useActiveTab();
  const pickerSessionRef = useRef<{ pageKey: string; sessionId: string } | null>(null);
  const captureSequenceRef = useRef(0);
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
    markUnsaved,
  } = useScrapeStore();
  const setDiagnosePicking = useScrapeStore((s) => s.setDiagnosePicking);
  const setDiagnoseLaunchError = useScrapeStore((s) => s.setDiagnoseLaunchError);
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
        const session = pickerSessionRef.current;
        if (
          !session ||
          payload.sessionId !== session.sessionId ||
          !isCurrentPageIdentity(session.pageKey)
        )
          return { ack: true };
        const mode: DiagnoseMode = payload.mode === 'unwanted' ? 'unwanted' : 'missing';
        const result: DiagnoseResult = {
          ...payload,
          mode,
          capturedAt: Date.now(),
          pageKey: session.pageKey,
        };
        pickerSessionRef.current = null;
        setDiagnoseResult(result);
        return { ack: true };
      },
    );
    const offExit = on<{ sessionId?: string }, { ack: true }>(
      CHANNELS.DIAGNOSE_PICKER_EXIT,
      (payload) => {
        if (payload.sessionId !== pickerSessionRef.current?.sessionId) return { ack: true };
        pickerSessionRef.current = null;
        setDiagnosePicking(false);
        setDiagnoseLaunchError(null);
        return { ack: true };
      },
    );
    return () => {
      offResult();
      offExit();
    };
  }, [setDiagnoseResult, setDiagnosePicking, setDiagnoseLaunchError]);

  useEffect(() => {
    captureSequenceRef.current += 1;
    setLoading(false);
    setActiveMode(null);
    setProgress(null);
    if (pickerSessionRef.current && pickerSessionRef.current.pageKey !== tab.pageKey) {
      pickerSessionRef.current = null;
      setDiagnosePicking(false);
    }
    const launchError = useScrapeStore.getState().diagnose.launchError;
    if (
      launchError &&
      (tab.pageKey ? tab.pageKey !== launchError.pageKey : tab.id !== launchError.tabId)
    )
      setDiagnoseLaunchError(null);
  }, [tab.id, tab.pageKey, setDiagnosePicking, setDiagnoseLaunchError, setLoading]);

  const launchDiagnose = useCallback(async () => {
    const page = getActiveTabIdentitySnapshot();
    const capturedPageKey = useScrapeStore.getState().pageKey;
    setDiagnoseLaunchError(null);
    if (capturedPageKey && page.pageKey && page.pageKey !== capturedPageKey) return;
    if (!page.id || !page.documentId || !page.pageKey) {
      if (capturedPageKey && page.id === tab.id)
        setDiagnoseLaunchError({
          pageKey: capturedPageKey,
          tabId: page.id,
          message: 'Picker needs this page to finish loading. Retry picker in a moment.',
        });
      return;
    }
    const sessionId = crypto.randomUUID();
    pickerSessionRef.current = { pageKey: page.pageKey, sessionId };
    setDiagnosePicking(true);
    try {
      // Stamp the mode on documentElement so the content-script entrypoint
      // can read it on startup. Same world as the content script (both ISOLATED
      // and MAIN can read attributes set this way).
      await chrome.scripting.executeScript({
        target: { tabId: page.id, documentIds: [page.documentId] },
        func: (mode: string, session: string) => {
          document.documentElement.setAttribute('data-matrx-diagnose-mode', mode);
          document.documentElement.setAttribute('data-matrx-diagnose-session', session);
        },
        args: [diagnoseMode, sessionId],
      });
      if (
        pickerSessionRef.current?.sessionId !== sessionId ||
        !isCurrentPageIdentity(page.pageKey)
      ) {
        if (pickerSessionRef.current?.sessionId === sessionId) {
          pickerSessionRef.current = null;
          setDiagnosePicking(false);
        }
        return;
      }
      await chrome.scripting.executeScript({
        target: { tabId: page.id, documentIds: [page.documentId] },
        files: ['content-scripts/diagnose-picker.js'],
      });
    } catch (err) {
      if (pickerSessionRef.current?.sessionId !== sessionId || !isCurrentPageIdentity(page.pageKey))
        return;
      pickerSessionRef.current = null;
      setDiagnosePicking(false);
      setDiagnoseLaunchError({
        pageKey: page.pageKey,
        tabId: page.id,
        message: classifyTabUrl(page.url).blocked
          ? 'Chrome blocks the picker here. Open a regular website.'
          : 'Picker could not start. Refresh this page, then try again.',
      });
      console.warn('[matrx-extend] diagnose picker injection failed', err);
    }
  }, [diagnoseMode, tab.id, setDiagnosePicking, setDiagnoseLaunchError]);

  const captureActiveTab = useCallback(
    async ({ mode = 'fast' }: CaptureOptions = {}) => {
      const run = ++captureSequenceRef.current;
      setLoading(true);
      setActiveMode(mode);
      setError(null);
      setProgress(null);
      let tabId: number | null = null;
      let tabUrl: string | null = null;
      try {
        const page = getActiveTabIdentitySnapshot();
        tabId = page.id;
        tabUrl = page.url;
        if (!page.id || !page.documentId || !page.pageKey) {
          setError(
            buildCaptureError({
              err: new Error(page.identityError ?? 'Page identity is unavailable. Retry.'),
              url: tabUrl,
              tabId,
            }),
          );
          return null;
        }

        // Pre-flight URL check. Saves a confusing Chrome error and a wasted
        // round-trip when we already know the page is on the blocklist.
        const urlClass = classifyTabUrl(page.url);
        if (urlClass.blocked) {
          setError(buildCaptureError({ err: null, url: page.url, tabId: page.id }));
          return null;
        }

        if (mode === 'deep') {
          // scrollToLoadLazy includes shared post-scroll settling so JSXGraph
          // cannot be captured while only its empty axis/grid shell exists.
          await scrollToLoadLazy(page.id, {
            documentId: page.documentId,
            onProgress: ({ step, total }) => {
              if (run === captureSequenceRef.current && isCurrentPageIdentity(page.pageKey))
                setProgress({ step, total });
            },
          });
          if (!isCurrentPageIdentity(page.pageKey) || run !== captureSequenceRef.current)
            return null;
          setProgress(null);
        }

        // Route through captureWithFallback (the same path auto-scrape and
        // read_active_page use) so a missing content script triggers an
        // inject retry instead of a hard "no-receiver" failure.
        const cap = await captureWithFallback(page.id, page.url, page.documentId);
        if (!isCurrentPageIdentity(page.pageKey) || run !== captureSequenceRef.current) return null;
        if (cap.ok && cap.soup) {
          setCurrent(cap.soup, page.pageKey);
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
        if (run === captureSequenceRef.current)
          setError(buildCaptureError({ err, url: tabUrl, tabId }));
        return null;
      } finally {
        if (run === captureSequenceRef.current) {
          setLoading(false);
          setActiveMode(null);
          setProgress(null);
        }
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
   * "Not yet a Source" (retry) (`save-capture.ts`).
   *
   * The panel disarms the unsaved-edits guard only after a landed result is
   * confirmed for its current capture and workspace. A late result from an
   * earlier workspace must not silently mark the current draft saved.
   */
  const save = useCallback(
    async (
      extra: {
        patternId?: string;
        name?: string;
        attachTo?: import('@/lib/api/routes/sources').AttachTarget[];
      } = {},
    ): Promise<SaveOutcome | null> => {
      if (!current || !isCurrentPageIdentity(useScrapeStore.getState().pageKey)) return null;
      // Text and collectors from the (possibly edited) capture; the untouched
      // capture is the original; edited article text wins over the old HTML.
      const outcome = await saveCaptureAsSource(current, {
        ...extra,
        ...(original ? { original } : {}),
        articleEdited,
      });
      if (outcome.status !== 'landed') return outcome;
      // The normalized wbx_seo_audit row powers the SEO tab's "Previously
      // audited" recognition. It is a companion write, not the save itself —
      // but when it fails the person is TOLD, never left believing it happened.
      void saveSeoAudit({
        url: current.url,
        organizationId: outcome.organizationId,
        signals: current.seo,
        flesch_reading_ease: current.seo.flesch_reading_ease,
        word_count: current.seo.word_count,
      })
        .catch(() => null)
        .then((audit) => {
          if (!audit) {
            pushNotice({
              tone: 'warning',
              title: 'SEO audit not recorded',
              message:
                'The page is now a Source, but its SEO audit was not recorded, so the SEO tab will not show it as previously audited. Open the SEO tab and press Save to record it.',
            });
          }
        });
      return outcome;
    },
    [current, original, articleEdited],
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
    markSaved,
    markUnsaved,
    launchDiagnose,
  };
}
