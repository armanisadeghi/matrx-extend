import { scrollToLoadLazy } from '@/lib/scrape/page-ready';
import type { SoupResult } from '@/lib/scrape/pipeline';
import { saveCapture, saveSeoAudit } from '@/lib/supabase/queries';
import { useScrapeStore } from '@/state/scrape';
import { useCallback, useState } from 'react';

interface ScrapeMessage {
  __matrx: true;
  kind: 'scrape:capture-page';
  payload: { options: Record<string, unknown> };
}

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
  const { current, loading, error, setCurrent, setLoading, setError } = useScrapeStore();
  /** Which mode is currently running. Null when idle. */
  const [activeMode, setActiveMode] = useState<ScrapeMode | null>(null);
  /** Scroll progress, surfaced for the manual "Scroll & capture" button. */
  const [progress, setProgress] = useState<ScrapeProgress | null>(null);

  const captureActiveTab = useCallback(
    async ({ mode = 'fast' }: CaptureOptions = {}) => {
      setLoading(true);
      setActiveMode(mode);
      setError(null);
      setProgress(null);
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) {
          setError('No active tab');
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

        const message: ScrapeMessage = {
          __matrx: true,
          kind: 'scrape:capture-page',
          payload: { options: {} },
        };
        const result = (await chrome.tabs.sendMessage(tab.id, message)) as SoupResult;
        setCurrent(result);
        return result;
      } catch (err) {
        setError((err as Error).message);
        return null;
      } finally {
        setLoading(false);
        setActiveMode(null);
        setProgress(null);
      }
    },
    [setCurrent, setError, setLoading],
  );

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
      return captureRow;
    },
    [current],
  );

  return { current, loading, activeMode, progress, error, captureActiveTab, save };
}
