/**
 * Persisted view state for the Scrape-queue tab — the active project/domain/
 * status/category/level filters, search text, sort, and group mode.
 *
 * chrome.storage.local (survives browser restart) so the user stays focused on
 * the project they're working through until they change it — the #1 ask. The
 * pure view logic lives in src/features/tasks/queue-view.ts; this is just the
 * persisted UI selection on top of it.
 */

import type { BucketKey, GroupMode, QueueFilters, SortSpec } from '@/features/tasks/queue-view';
import { DEFAULT_SORT, EMPTY_FILTERS } from '@/features/tasks/queue-view';
import type { PolicyCategory, ScrapeStatus } from '@/lib/api/routes/research';
import { chromeLocalStorage } from '@/lib/storage/zustand-adapter';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface ScrapeQueueViewState {
  filters: QueueFilters;
  sort: SortSpec;
  groupMode: GroupMode;

  setSearch: (search: string) => void;
  setTopicId: (topicId: string | null) => void;
  setDomain: (domain: string | null) => void;
  toggleStatus: (status: ScrapeStatus) => void;
  toggleCategory: (category: PolicyCategory) => void;
  toggleBucket: (bucket: BucketKey) => void;
  setSort: (sort: SortSpec) => void;
  setGroupMode: (mode: GroupMode) => void;
  /** Clear all facet filters + search; keep sort + group mode (the layout the user chose). */
  clearFilters: () => void;
}

function toggle<T>(arr: T[], value: T): T[] {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
}

export const useScrapeQueueView = create<ScrapeQueueViewState>()(
  persist(
    (set) => ({
      filters: EMPTY_FILTERS,
      sort: DEFAULT_SORT,
      groupMode: 'level',

      setSearch: (search) => set((s) => ({ filters: { ...s.filters, search } })),
      setTopicId: (topicId) => set((s) => ({ filters: { ...s.filters, topicId } })),
      setDomain: (domain) => set((s) => ({ filters: { ...s.filters, domain } })),
      toggleStatus: (status) =>
        set((s) => ({ filters: { ...s.filters, statuses: toggle(s.filters.statuses, status) } })),
      toggleCategory: (category) =>
        set((s) => ({
          filters: { ...s.filters, categories: toggle(s.filters.categories, category) },
        })),
      toggleBucket: (bucket) =>
        set((s) => ({ filters: { ...s.filters, buckets: toggle(s.filters.buckets, bucket) } })),
      setSort: (sort) => set({ sort }),
      setGroupMode: (groupMode) => set({ groupMode }),
      clearFilters: () => set((s) => ({ filters: { ...EMPTY_FILTERS, search: '' }, sort: s.sort })),
    }),
    {
      name: 'matrx.scrapeQueue.view.v1',
      storage: createJSONStorage(() => chromeLocalStorage),
      // Persist the selection, not the action fns.
      partialize: (s) => ({ filters: s.filters, sort: s.sort, groupMode: s.groupMode }),
    },
  ),
);
