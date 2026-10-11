/**
 * Notes list — search + cascading home→note picker + scrollable list.
 *
 * The cascade matches the user's mental model from the main app: pick a
 * "home", then a specific note. Selecting a note in
 * either dropdown OR the row list sets `selectedNoteId` and the parent
 * view swaps to the editor.
 */

import { createNote, listMyHomes } from '@/lib/notes/queries';
import type { NoteListItem } from '@/lib/notes/types';
import {
  filterNotes,
  formatRelativeTime,
  generateUniqueLabel,
  homeLabelFor,
} from '@/lib/notes/utils';
import { useNotesUiStore } from '@/state/notes';
import {
  Button,
  BasicInput as Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ai-matrx/design-system';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Home, NotebookPen, Plus, Search } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { HomePicker } from './HomePicker';

export function NotesList({ notes }: { notes: NoteListItem[] }) {
  const queryClient = useQueryClient();
  const setSelectedNoteId = useNotesUiStore((s) => s.setSelectedNoteId);
  const searchQuery = useNotesUiStore((s) => s.searchQuery);
  const setSearchQuery = useNotesUiStore((s) => s.setSearchQuery);
  const selectedHome = useNotesUiStore((s) => s.selectedHome);
  const setSelectedHome = useNotesUiStore((s) => s.setSelectedHome);
  const homesQuery = useQuery({
    queryKey: ['notes', 'homes'],
    queryFn: listMyHomes,
    staleTime: 60_000,
    retry: false,
  });
  const homes = homesQuery.data ?? [];
  const [creating, setCreating] = useState(false);
  const [createFailed, setCreateFailed] = useState(false);

  const deferredSearch = useDeferredValue(searchQuery);

  const homeFilteredNotes = useMemo(() => {
    if (selectedHome === null) return notes;
    return notes.filter((n) => n.home_scope_id === selectedHome);
  }, [notes, selectedHome]);

  const visibleNotes = useMemo(
    () => filterNotes(homeFilteredNotes, { search: deferredSearch }),
    [homeFilteredNotes, deferredSearch],
  );

  const onPickNote = (id: string) => setSelectedNoteId(id);

  const onCreate = async () => {
    if (creating) return;
    setCreating(true);
    setCreateFailed(false);
    try {
      const label = generateUniqueLabel(notes, 'Untitled');
      const note = await createNote({ label });
      if (note) {
        setSelectedNoteId(note.id);
        void queryClient.invalidateQueries({ queryKey: ['notes', 'list'] });
      } else {
        setCreateFailed(true);
      }
    } catch (error) {
      console.warn('[notes] create action failed', error);
      setCreateFailed(true);
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

      {createFailed && (
        <div
          className="flex shrink-0 flex-col gap-2 border-b border-destructive/30 bg-destructive/5 px-3 py-2 text-xs"
          role="alert"
        >
          <span>Could not confirm note creation. Refresh your notes before retrying.</span>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void queryClient.invalidateQueries({ queryKey: ['notes', 'list'] })}
            >
              Refresh notes
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void onCreate()}
              disabled={creating}
            >
              Retry creating note
            </Button>
          </div>
        </div>
      )}

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
          <HomePicker
            homes={homes}
            value={selectedHome}
            placeholder="All homes"
            clearLabel="All homes"
            onChange={setSelectedHome}
          />
          <Select
            value={''}
            onValueChange={(id) => {
              if (id) onPickNote(id);
            }}
          >
            <SelectTrigger className="h-8 text-xs" disabled={homeFilteredNotes.length === 0}>
              <SelectValue
                placeholder={`${homeFilteredNotes.length} note${homeFilteredNotes.length === 1 ? '' : 's'}`}
              />
            </SelectTrigger>
            <SelectContent>
              {homeFilteredNotes.length === 0 ? (
                <SelectItem value="__empty__" disabled>
                  No notes
                </SelectItem>
              ) : (
                homeFilteredNotes.map((n) => (
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
          <div className="px-3 py-8 text-center text-xs text-muted-foreground">No matches.</div>
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
                      {homeLabelFor(homes, n.home_scope_id) && (
                        <span className="inline-flex items-center gap-1 rounded bg-secondary/40 px-1.5 py-0.5">
                          <Home className="size-2.5" />
                          {homeLabelFor(homes, n.home_scope_id)}
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
