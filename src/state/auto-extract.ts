import type { ExtractedRow } from '@/lib/data-pattern/types';
import type { ExtractionPattern } from '@/lib/supabase/queries';
import { create } from 'zustand';

/**
 * Auto-extract: whenever the user navigates to a URL that matches a saved
 * pattern, fire that pattern in the background and cache the rows here so
 * the side-panel surfaces them without requiring a click.
 *
 * Cache key = `${patternId}|${url}`. We deliberately key by URL (not just
 * pattern) so navigations and back-and-forth don't trigger duplicate runs
 * on already-extracted state.
 */

export type AutoExtractStatus = 'pending' | 'running' | 'ok' | 'error';

export interface AutoExtractRecord {
  pattern: ExtractionPattern;
  url: string;
  rows: ExtractedRow[];
  status: AutoExtractStatus;
  error?: string;
  /** Wall-clock when the run completed (ms epoch). */
  lastRunAt: number;
}

interface AutoExtractState {
  /** Map keyed by `${patternId}|${url}`. */
  records: Map<string, AutoExtractRecord>;
  setRecord: (key: string, record: AutoExtractRecord) => void;
  removeRecord: (key: string) => void;
  /** Drop every record whose URL doesn't match the current tab. */
  pruneTo: (currentUrl: string | null) => void;
  /** All records that match the given URL. */
  getForUrl: (url: string | null | undefined) => AutoExtractRecord[];
}

export const useAutoExtractStore = create<AutoExtractState>((set, get) => ({
  records: new Map(),
  setRecord: (key, record) =>
    set((s) => {
      const next = new Map(s.records);
      next.set(key, record);
      return { records: next };
    }),
  removeRecord: (key) =>
    set((s) => {
      const next = new Map(s.records);
      next.delete(key);
      return { records: next };
    }),
  pruneTo: (currentUrl) =>
    set((s) => {
      if (!currentUrl) return { records: new Map() };
      const next = new Map<string, AutoExtractRecord>();
      for (const [k, v] of s.records) {
        if (v.url === currentUrl) next.set(k, v);
      }
      return { records: next };
    }),
  getForUrl: (url) => {
    if (!url) return [];
    return Array.from(get().records.values()).filter((r) => r.url === url);
  },
}));

export const autoExtractKey = (patternId: string, url: string): string =>
  `${patternId}|${url}`;
