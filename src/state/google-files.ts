/**
 * Google file attachment state (side panel).
 *
 * Holds the user's registered Docs / Sheets (mirrored from Supabase — see
 * src/lib/google/files.ts) and the set of files "attached" to the chat. The
 * attached ids ride along as the reserved `__google_files` context key on every
 * send until the user clears them (sticky, like an attachment tray) — exactly
 * the semantics of the highlight tray, and deliberately the same shape.
 *
 * Session-scoped, like `useHighlightStore`: nothing here is persisted. The
 * registry is re-read from the database whenever the chip opens, so a file the
 * user picked on the web app a moment ago shows up without a reload.
 */

import type { RegisteredGoogleFile } from '@/lib/google/files';
import { create } from 'zustand';

interface GoogleFilesState {
  /** Mirror of the user's registered Docs / Sheets (Docs first, then Sheets). */
  items: RegisteredGoogleFile[];
  /** True once a load has SUCCEEDED, so the chip can tell "empty" from "unknown". */
  loaded: boolean;
  /** A load is in flight. */
  loading: boolean;
  /**
   * The last load failed. Distinct from `items: []` on purpose — an empty
   * account and an unreadable database must never render the same, or we tell
   * a user with ten registered files that they have none.
   */
  loadFailed: boolean;
  /** Drive file ids attached to the chat (sticky until cleared). */
  attachedIds: string[];

  setItems: (items: RegisteredGoogleFile[]) => void;
  setLoading: (loading: boolean) => void;
  setLoadFailed: () => void;

  attach: (fileId: string) => void;
  detach: (fileId: string) => void;
  toggle: (fileId: string) => void;
  clearAttached: () => void;
}

export const useGoogleFilesStore = create<GoogleFilesState>((set) => ({
  items: [],
  loaded: false,
  loading: false,
  loadFailed: false,
  attachedIds: [],

  // A file the user un-picked on the web app can no longer be attached: drop it
  // from the tray rather than sending an id the server would silently discard.
  // Pruning happens ONLY on a successful read — a failed read must never be
  // allowed to quietly empty the user's tray.
  setItems: (items) =>
    set((s) => {
      const known = new Set(items.map((i) => i.fileId));
      return {
        items,
        loaded: true,
        loading: false,
        loadFailed: false,
        attachedIds: s.attachedIds.filter((id) => known.has(id)),
      };
    }),
  setLoading: (loading) => set({ loading }),
  setLoadFailed: () => set({ loading: false, loadFailed: true }),

  attach: (fileId) =>
    set((s) => (s.attachedIds.includes(fileId) ? s : { attachedIds: [...s.attachedIds, fileId] })),
  detach: (fileId) => set((s) => ({ attachedIds: s.attachedIds.filter((a) => a !== fileId) })),
  toggle: (fileId) =>
    set((s) => ({
      attachedIds: s.attachedIds.includes(fileId)
        ? s.attachedIds.filter((a) => a !== fileId)
        : [...s.attachedIds, fileId],
    })),
  clearAttached: () => set({ attachedIds: [] }),
}));
