/**
 * Highlight feature state (side panel).
 *
 * Holds the user's highlight list (mirrored from Supabase), the live overlay
 * status for the active tab, and the set of highlights "attached" to the chat
 * — those ride along as the `highlights` context key on every send until the
 * user clears them (sticky, like an attachment tray).
 */

import type { HighlightListItem, HighlightMode } from '@/lib/highlights/types';
import { create } from 'zustand';

interface HighlightState {
  /** Mirror of the user's highlights (most-recent first). */
  items: HighlightListItem[];
  /** Whether the on-page overlay is currently running. */
  overlayActive: boolean;
  /** Tab the overlay is running on (null when inactive). */
  overlayTabId: number | null;
  /** Live count reported by the overlay. */
  overlayCount: number;
  /** Current capture mode. */
  mode: HighlightMode;
  /** Highlight ids attached to the chat (sticky until cleared). */
  attachedIds: string[];

  /**
   * Cross-tab handoffs (same side-panel context, so a chrome.runtime
   * broadcast wouldn't loop back — we pass through the store instead).
   * DataView / ScrapeView consume + clear these on mount.
   */
  dataHandoff: { name: string; selector: string }[] | null;
  scrapeHandoff: { title: string; text: string }[] | null;

  setItems: (items: HighlightListItem[]) => void;
  upsertItem: (item: HighlightListItem) => void;
  removeItem: (id: string) => void;
  setOverlay: (s: { active: boolean; tabId?: number | null; count?: number }) => void;
  setMode: (mode: HighlightMode) => void;

  attach: (id: string) => void;
  attachMany: (ids: string[]) => void;
  detach: (id: string) => void;
  clearAttached: () => void;

  setDataHandoff: (fields: { name: string; selector: string }[] | null) => void;
  setScrapeHandoff: (regions: { title: string; text: string }[] | null) => void;
}

export const useHighlightStore = create<HighlightState>((set) => ({
  items: [],
  overlayActive: false,
  overlayTabId: null,
  overlayCount: 0,
  mode: 'text',
  attachedIds: [],
  dataHandoff: null,
  scrapeHandoff: null,

  setItems: (items) => set({ items }),
  upsertItem: (item) =>
    set((s) => {
      const rest = s.items.filter((i) => i.id !== item.id);
      return { items: [item, ...rest] };
    }),
  removeItem: (id) =>
    set((s) => ({
      items: s.items.filter((i) => i.id !== id),
      attachedIds: s.attachedIds.filter((a) => a !== id),
    })),
  setOverlay: ({ active, tabId, count }) =>
    set((s) => ({
      overlayActive: active,
      overlayTabId: tabId === undefined ? (active ? s.overlayTabId : null) : tabId,
      overlayCount: count ?? (active ? s.overlayCount : 0),
    })),
  setMode: (mode) => set({ mode }),

  attach: (id) =>
    set((s) => (s.attachedIds.includes(id) ? s : { attachedIds: [...s.attachedIds, id] })),
  attachMany: (ids) =>
    set((s) => ({ attachedIds: Array.from(new Set([...s.attachedIds, ...ids])) })),
  detach: (id) => set((s) => ({ attachedIds: s.attachedIds.filter((a) => a !== id) })),
  clearAttached: () => set({ attachedIds: [] }),

  setDataHandoff: (fields) => set({ dataHandoff: fields }),
  setScrapeHandoff: (regions) => set({ scrapeHandoff: regions }),
}));
