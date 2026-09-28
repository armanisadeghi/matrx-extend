import type { ExtractedRow } from '@/lib/data-pattern/types';
import type { ExtractionPattern } from '@/lib/supabase/queries';
import { create } from 'zustand';

/**
 * Auto-extract: whenever the user navigates to a URL that matches a saved
 * pattern, fire that pattern in the background and cache the rows here so
 * the side-panel surfaces them without requiring a click.
 *
 * Cache key includes the resolved top-frame document, so a reload cannot reuse rows.
 */

export type AutoExtractStatus = 'pending' | 'running' | 'ok' | 'no_match' | 'error';

export interface AutoExtractRecord {
  pattern: ExtractionPattern;
  url: string;
  tabId: number;
  pageKey: string;
  rows: ExtractedRow[];
  status: AutoExtractStatus;
  note?: string;
  error?: string;
  /** Wall-clock when the run completed (ms epoch). */
  lastRunAt: number;
}

interface AutoExtractState {
  /** Map keyed by document-scoped page identity and pattern. */
  records: Map<string, AutoExtractRecord>;
  setRecord: (key: string, record: AutoExtractRecord) => void;
  removeRecord: (key: string) => void;
  /** Drop every record whose URL doesn't match the current tab. */
  pruneTo: (pageKey: string | null) => void;
  /** All records that match the given URL. */
  getForUrl: (pageKey: string | null) => AutoExtractRecord[];
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
  pruneTo: (pageKey) =>
    set((s) => {
      if (!pageKey) return { records: new Map() };
      const next = new Map<string, AutoExtractRecord>();
      for (const [k, v] of s.records) {
        if (v.pageKey === pageKey) next.set(k, v);
      }
      return { records: next };
    }),
  getForUrl: (pageKey) => {
    if (!pageKey) return [];
    return Array.from(get().records.values()).filter((r) => r.pageKey === pageKey);
  },
}));

export const autoExtractKey = (patternId: string, pageKey: string): string =>
  `${pageKey}|${patternId}`;
