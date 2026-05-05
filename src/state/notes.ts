/**
 * Notes tab — UI state only.
 *
 * Note **data** lives in the React Query cache (see NotesView). This store is
 * just for selection / filter state that needs to survive component remounts
 * within a sidepanel session. Cleared on tab unmount is fine.
 */

import { create } from 'zustand';

export type NoteViewMode = 'edit' | 'preview';

interface NotesUiState {
  selectedNoteId: string | null;
  selectedFolder: string | null;
  searchQuery: string;
  viewMode: NoteViewMode;
  setSelectedNoteId: (id: string | null) => void;
  setSelectedFolder: (folder: string | null) => void;
  setSearchQuery: (q: string) => void;
  setViewMode: (m: NoteViewMode) => void;
}

export const useNotesUiStore = create<NotesUiState>((set) => ({
  selectedNoteId: null,
  selectedFolder: null,
  searchQuery: '',
  viewMode: 'edit',
  setSelectedNoteId: (id) => set({ selectedNoteId: id }),
  setSelectedFolder: (folder) => set({ selectedFolder: folder }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setViewMode: (m) => set({ viewMode: m }),
}));
