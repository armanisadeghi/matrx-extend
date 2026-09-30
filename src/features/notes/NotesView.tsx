/**
 * Notes — sidepanel tab.
 *
 * Two views: list (cascading folder→note picker + searchable list) and
 * editor. Selection lives in `useNotesUiStore`; data lives in React Query
 * (queryKey ['notes', 'list' | 'detail', id]).
 *
 * The list query is gated by `enabled: tab === 'notes'` so we only hit
 * Supabase when the tab is actually open. Detail fetch is similarly gated
 * on `selectedNoteId`.
 */

import { listMyNotes } from '@/lib/notes/queries';
import { useNotesUiStore } from '@/state/notes';
import { useSidepanelTabStore } from '@/state/sidepanel-tab';
import { Button, Skeleton } from '@ai-matrx/design-system';
import { useQuery } from '@tanstack/react-query';
import { NoteEditor } from './NoteEditor';
import { NotesList } from './NotesList';

export function NotesView() {
  const tab = useSidepanelTabStore((s) => s.tab);
  const selectedNoteId = useNotesUiStore((s) => s.selectedNoteId);

  const notesQuery = useQuery({
    queryKey: ['notes', 'list'],
    queryFn: listMyNotes,
    enabled: tab === 'notes',
    staleTime: 30_000,
    retry: false,
  });

  if (notesQuery.isPending && tab === 'notes') {
    return (
      <div className="flex h-full flex-col gap-2 p-3">
        <Skeleton className="h-9 w-full rounded-md" />
        <Skeleton className="h-8 w-full rounded-md" />
        <Skeleton className="h-12 w-full rounded-md" />
        <Skeleton className="h-12 w-full rounded-md" />
        <Skeleton className="h-12 w-full rounded-md" />
      </div>
    );
  }

  if (selectedNoteId) {
    return <NoteEditor key={selectedNoteId} noteId={selectedNoteId} />;
  }

  if (notesQuery.isError) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center"
        role="alert"
      >
        <p className="text-sm font-medium">Could not load notes.</p>
        <p className="text-xs text-muted-foreground">Check your connection and try again.</p>
        <Button type="button" size="sm" onClick={() => void notesQuery.refetch()}>
          Retry loading notes
        </Button>
      </div>
    );
  }

  return <NotesList notes={notesQuery.data ?? []} />;
}
