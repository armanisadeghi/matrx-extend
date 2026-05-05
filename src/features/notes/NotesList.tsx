/**
 * Notes list — search + cascading folder→note picker + scrollable list.
 *
 * The cascade matches the user's mental model from the main app: pick a
 * "category" (folder_name), then a specific note. Selecting a note in
 * either dropdown OR the row list sets `selectedNoteId` and the parent
 * view swaps to the editor.
 */

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createNote } from '@/lib/notes/queries';
import type { NoteListItem } from '@/lib/notes/types';
import {
  filterNotes,
  formatRelativeTime,
  generateUniqueLabel,
  uniqueFolderNames,
} from '@/lib/notes/utils';
import { useNotesUiStore } from '@/state/notes';
import { useQueryClient } from '@tanstack/react-query';
import { FolderClosed, NotebookPen, Plus, Search } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';

const ALL_FOLDERS = '__all__';
const NO_FOLDER = '__none__';

export function NotesList({ notes }: { notes: NoteListItem[] }) {
  const queryClient = useQueryClient();
  const setSelectedNoteId = useNotesUiStore((s) => s.setSelectedNoteId);
  const searchQuery = useNotesUiStore((s) => s.searchQuery);
  const setSearchQuery = useNotesUiStore((s) => s.setSearchQuery);
  const selectedFolder = useNotesUiStore((s) => s.selectedFolder);
  const setSelectedFolder = useNotesUiStore((s) => s.setSelectedFolder);
  const [creating, setCreating] = useState(false);

  const deferredSearch = useDeferredValue(searchQuery);

  const folders = useMemo(() => uniqueFolderNames(notes), [notes]);

  const folderFilteredNotes = useMemo(() => {
    if (selectedFolder === null) return notes;
    return notes.filter((n) => (n.folder_name ?? null) === selectedFolder);
  }, [notes, selectedFolder]);

  const visibleNotes = useMemo(
    () => filterNotes(folderFilteredNotes, { search: deferredSearch }),
    [folderFilteredNotes, deferredSearch],
  );

  const onFolderChange = (v: string) => {
    if (v === ALL_FOLDERS) setSelectedFolder(null);
    else if (v === NO_FOLDER) setSelectedFolder('');
    else setSelectedFolder(v);
  };

  const folderValue = selectedFolder === null ? ALL_FOLDERS : selectedFolder === '' ? NO_FOLDER : selectedFolder;

  const onPickNote = (id: string) => setSelectedNoteId(id);

  const onCreate = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const label = generateUniqueLabel(notes, 'Untitled');
      const folderForCreate =
        selectedFolder && selectedFolder !== '' ? selectedFolder : null;
      const note = await createNote({ label, folder_name: folderForCreate });
      if (note) {
        await queryClient.invalidateQueries({ queryKey: ['notes', 'list'] });
        setSelectedNoteId(note.id);
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border/50 px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <NotebookPen className="size-4" />
          Notes
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
            {notes.length}
          </span>
        </div>
        <Button
          size="sm"
          variant="secondary"
          className="h-7 gap-1 px-2 text-xs"
          onClick={() => void onCreate()}
          disabled={creating}
        >
          <Plus className="size-3.5" />
          New note
        </Button>
      </div>

      <div className="flex shrink-0 flex-col gap-2 border-b border-border/50 px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search notes…"
            className="h-8 pl-7 text-xs"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Select value={folderValue} onValueChange={onFolderChange}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="All folders" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FOLDERS}>All folders</SelectItem>
              <SelectItem value={NO_FOLDER}>(no folder)</SelectItem>
              {folders.map((f) => (
                <SelectItem key={f} value={f}>
                  {f}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={''}
            onValueChange={(id) => {
              if (id) onPickNote(id);
            }}
          >
            <SelectTrigger className="h-8 text-xs" disabled={folderFilteredNotes.length === 0}>
              <SelectValue placeholder={`${folderFilteredNotes.length} note${folderFilteredNotes.length === 1 ? '' : 's'}`} />
            </SelectTrigger>
            <SelectContent>
              {folderFilteredNotes.length === 0 ? (
                <SelectItem value="__empty__" disabled>
                  No notes
                </SelectItem>
              ) : (
                folderFilteredNotes.map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    {n.label}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {notes.length === 0 ? (
          <div className="px-3 py-12 text-center text-xs text-muted-foreground">
            No notes yet. Click <strong>New note</strong> to create your first one.
          </div>
        ) : visibleNotes.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-muted-foreground">
            No matches.
          </div>
        ) : (
          <ul className="divide-y divide-border/50">
            {visibleNotes.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => onPickNote(n.id)}
                  className="flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-secondary/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{n.label || 'Untitled'}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] font-mono text-muted-foreground">
                      {n.folder_name && (
                        <span className="inline-flex items-center gap-1 rounded bg-secondary/40 px-1.5 py-0.5">
                          <FolderClosed className="size-2.5" />
                          {n.folder_name}
                        </span>
                      )}
                      <span>updated {formatRelativeTime(n.updated_at)}</span>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
