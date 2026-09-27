import type { ExtractedRow } from '@/lib/data-pattern/types';
import type { ExtractionPattern } from '@/lib/supabase/queries';
import { create } from 'zustand';

/**
 * Auto-extract: whenever the user navigates to a URL that matches a saved
 * pattern, fire that pattern in the background and cache the rows here so
 * the side-panel surfaces them without requiring a click.
 *
 * Cache key = `${tabId}|${patternId}|${url}`. Tab identity prevents another tab at the same URL from reusing these rows.
 */

export type AutoExtractStatus = 'pending' | 'running' | 'ok' | 'no_match' | 'error';

export interface AutoExtractRecord {
  pattern: ExtractionPattern;
  url: string;
  tabId: number;
  rows: ExtractedRow[];
  status: AutoExtractStatus;
  note?: string;
  error?: string;
  /** Wall-clock when the run completed (ms epoch). */
  lastRunAt: number;
}

interface AutoExtractState {
  /** Map keyed by `${tabId}|${patternId}|${url}`. */
  records: Map<string, AutoExtractRecord>;
  setRecord: (key: string, record: AutoExtractRecord) => void;
  removeRecord: (key: string) => void;
  /** Drop every record whose URL doesn't match the current tab. */
  pruneTo: (tabId: number | null, currentUrl: string | null) => void;
  /** All records that match the given URL. */
  getForUrl: (tabId: number | null, url: string | null | undefined) => AutoExtractRecord[];
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
  pruneTo: (tabId, currentUrl) =>
    set((s) => {
      if (!currentUrl) return { records: new Map() };
      const next = new Map<string, AutoExtractRecord>();
      for (const [k, v] of s.records) {
        if (v.tabId === tabId && v.url === currentUrl) next.set(k, v);
      }
      return { records: next };
    }),
  getForUrl: (tabId, url) => {
    if (!url) return [];
    return Array.from(get().records.values()).filter((r) => r.tabId === tabId && r.url === url);
  },
}));

export const autoExtractKey = (patternId: string, tabId: number, url: string): string =>
  `${tabId}|${patternId}|${url}`;
