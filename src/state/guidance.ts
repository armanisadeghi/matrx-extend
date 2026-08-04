/**
 * Guidance UI state — Zustand.
 *
 * Holds the in-memory list of guidance items rendered by the Guidance
 * tab, plus ephemeral UI state (filter pill, selected item, recording
 * indicator). Persistence lives in chrome.storage.local; this store
 * mirrors what the user is currently seeing.
 */

import type { GuidanceKind, GuidanceSummary } from '@/lib/guidance/types';
import { create } from 'zustand';

export type GuidanceFilter = 'all' | GuidanceKind;

/**
 * Recording mutex — only one capture at a time per the existing demo /
 * record_gif backend constraint. The UI uses this to:
 *   - Show a banner in the tab header
 *   - Reject "start new recording" while another is active (matches the
 *     mutex policy chosen during planning).
 */
export type RecordingState =
  | { kind: 'idle' }
  | {
      kind: 'demo';
      tab_id: number;
      recording_id: string;
      started_at: number;
      steps_captured: number;
    }
  | { kind: 'gif'; tab_id: number; started_at: number };

interface GuidanceUiState {
  /** All guidance summaries; null = not loaded yet. */
  items: GuidanceSummary[] | null;
  loading: boolean;
  error: string | null;

  /** Filter pill selection. */
  filter: GuidanceFilter;

  /** Currently expanded / previewed row (for inline detail). */
  selectedId: string | null;

  /** Domain the user is currently scoping new items to (default: active tab's domain). */
  scopeDomain: string | null;

  /** Recording mutex. */
  recording: RecordingState;

  setItems: (items: GuidanceSummary[] | null) => void;
  setLoading: (b: boolean) => void;
  setError: (e: string | null) => void;
  setFilter: (f: GuidanceFilter) => void;
  setSelectedId: (id: string | null) => void;
  setScopeDomain: (d: string | null) => void;
  setRecording: (r: RecordingState) => void;

  /** Optimistic add — keeps the list snappy without round-tripping storage. */
  upsertSummary: (s: GuidanceSummary) => void;
  /** Optimistic remove — same idea on the delete side. */
  removeSummary: (id: string) => void;
}

export const useGuidanceStore = create<GuidanceUiState>((set) => ({
  items: null,
  loading: false,
  error: null,
  filter: 'all',
  selectedId: null,
  scopeDomain: null,
  recording: { kind: 'idle' },

  setItems: (items) => set({ items }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setFilter: (filter) => set({ filter }),
  setSelectedId: (selectedId) => set({ selectedId }),
  setScopeDomain: (scopeDomain) => set({ scopeDomain }),
  setRecording: (recording) => set({ recording }),

  upsertSummary: (s) =>
    set((state) => {
      const list = state.items ?? [];
      const idx = list.findIndex((x) => x.id === s.id);
      if (idx >= 0) {
        const copy = list.slice();
        copy[idx] = s;
        return { items: copy };
      }
      return { items: [s, ...list] };
    }),
  removeSummary: (id) =>
    set((state) => ({
      items: state.items ? state.items.filter((g) => g.id !== id) : state.items,
      selectedId: state.selectedId === id ? null : state.selectedId,
    })),
}));
