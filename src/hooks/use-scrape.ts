import type { SoupResult } from '@/lib/scrape/pipeline';
import { saveCapture } from '@/lib/supabase/queries';
import { useScrapeStore } from '@/state/scrape';
import { useCallback } from 'react';

interface ScrapeMessage {
  __matrx: true;
  kind: 'scrape:capture-page';
  payload: { options: Record<string, unknown> };
}

export function useScrape() {
  const { current, loading, error, setCurrent, setLoading, setError } = useScrapeStore();

  const captureActiveTab = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        setError('No active tab');
        return null;
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
    }
  }, [setCurrent, setError, setLoading]);

  const save = useCallback(
    async (extra: { patternId?: string } = {}) => {
      if (!current) return null;
      return saveCapture({
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
    },
    [current],
  );

  return { current, loading, error, captureActiveTab, save };
}
