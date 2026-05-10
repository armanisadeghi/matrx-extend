/**
 * Note editor — title, folder, textarea/preview, append-from-page, delete.
 *
 * Auto-save: label / content / folder_name changes flush to Supabase ~600ms
 * after the last keystroke. Appends from page-extract bypass the debounce
 * and persist immediately so the new content lands in the textarea
 * deterministically.
 *
 * Optimistic UX: the React Query detail cache is updated on every save so
 * a quick "open list → re-open this note" reflects the latest content even
 * before the next list refetch.
 */

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { MarkdownView } from '@/components/MarkdownView';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { getNote, softDeleteNote, updateNote } from '@/lib/notes/queries';
import type { NoteListItem } from '@/lib/notes/types';
import { formatRelativeTime, uniqueFolderNames } from '@/lib/notes/utils';
import { useNotesUiStore } from '@/state/notes';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Eye, Pencil, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppendFromPagePanel } from './AppendFromPagePanel';

const SAVE_DEBOUNCE_MS = 600;
const FOLDERS_LIST_ID = 'matrx-notes-folder-suggestions';

interface DraftState {
  label: string;
  content: string;
  folderName: string;
}

export function NoteEditor({ noteId }: { noteId: string }) {
  const queryClient = useQueryClient();
  const setSelectedNoteId = useNotesUiStore((s) => s.setSelectedNoteId);
  const viewMode = useNotesUiStore((s) => s.viewMode);
  const setViewMode = useNotesUiStore((s) => s.setViewMode);

  const detailQuery = useQuery({
    queryKey: ['notes', 'detail', noteId],
    queryFn: () => getNote(noteId),
    staleTime: 30_000,
  });

  const note = detailQuery.data ?? null;

  const [draft, setDraft] = useState<DraftState | null>(null);
  const [savingState, setSavingState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const draftRef = useRef<DraftState | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightRef = useRef(false);

  // Hydrate draft from server data the first time it lands. After that, the
  // user owns the draft until they switch notes — server pushes don't clobber
  // local edits (no realtime in v1, so this is a non-issue in practice).
  useEffect(() => {
    if (!note) return;
    if (draftRef.current === null) {
      const seed: DraftState = {
        label: note.label ?? '',
        content: note.content ?? '',
        folderName: note.folder_name ?? '',
      };
      setDraft(seed);
      draftRef.current = seed;
      setLastSavedAt(note.updated_at);
    }
  }, [note]);

  // Reset draft when noteId changes (user opened a different note).
  useEffect(() => {
    draftRef.current = null;
    setDraft(null);
    setSavingState('idle');
    setLastSavedAt(null);
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, [noteId]);

  const allNotes = queryClient.getQueryData<NoteListItem[]>(['notes', 'list']) ?? [];
  const folderSuggestions = useMemo(() => uniqueFolderNames(allNotes), [allNotes]);

  const persist = useCallback(
    async (snapshot: DraftState) => {
      if (inflightRef.current) return;
      inflightRef.current = true;
      setSavingState('saving');
      const updated = await updateNote(noteId, {
        label: snapshot.label.trim() || 'Untitled',
        content: snapshot.content,
        folder_name: snapshot.folderName.trim() ? snapshot.folderName.trim() : null,
      });
      inflightRef.current = false;
      if (updated) {
        setSavingState('saved');
        setLastSavedAt(updated.updated_at);
        queryClient.setQueryData(['notes', 'detail', noteId], updated);
        await queryClient.invalidateQueries({ queryKey: ['notes', 'list'] });
      } else {
        setSavingState('error');
      }
    },
    [noteId, queryClient],
  );

  const scheduleSave = useCallback(
    (next: DraftState) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        void persist(next);
      }, SAVE_DEBOUNCE_MS);
    },
    [persist],
  );

  const updateDraft = useCallback(
    (patch: Partial<DraftState>) => {
      if (!draftRef.current) return;
      const next = { ...draftRef.current, ...patch };
      draftRef.current = next;
      setDraft(next);
      scheduleSave(next);
    },
    [scheduleSave],
  );

  // Flush pending edits on unmount so a quick switch-and-back doesn't lose typing.
  useEffect(
    () => () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        if (draftRef.current) void persist(draftRef.current);
      }
    },
    [persist],
  );

  const onAppend = useCallback(
    async (next: string) => {
      if (!draftRef.current) return;
      // Cancel any pending debounced save — we're persisting now.
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const updatedDraft = { ...draftRef.current, content: next };
      draftRef.current = updatedDraft;
      setDraft(updatedDraft);
      await persist(updatedDraft);
    },
    [persist],
  );

  const performDelete = async () => {
    setDeleteOpen(false);
    const ok = await softDeleteNote(noteId);
    if (ok) {
      await queryClient.invalidateQueries({ queryKey: ['notes', 'list'] });
      setSelectedNoteId(null);
    }
  };

  const onBack = () => setSelectedNoteId(null);

  if (detailQuery.isPending || !note || !draft) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-border/50 px-3 py-2">
          <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={onBack}>
            <ArrowLeft className="size-3.5" /> Back
          </Button>
        </div>
        <div className="flex-1 space-y-2 p-3">
          <Skeleton className="h-8 w-full rounded-md" />
          <Skeleton className="h-7 w-1/2 rounded-md" />
          <Skeleton className="h-48 w-full rounded-md" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/50 px-3 py-2">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 px-2 text-xs"
          onClick={onBack}
          title="Back to list"
        >
          <ArrowLeft className="size-3.5" /> Back
        </Button>
        <div className="ml-auto flex items-center gap-1">
          <div className="flex rounded-md border border-border/50 p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('edit')}
              className={[
                'inline-flex h-6 items-center gap-1 rounded px-2 text-[11px] transition-colors',
                viewMode === 'edit'
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >
              <Pencil className="size-3" /> Edit
            </button>
            <button
              type="button"
              onClick={() => setViewMode('preview')}
              className={[
                'inline-flex h-6 items-center gap-1 rounded px-2 text-[11px] transition-colors',
                viewMode === 'preview'
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >
              <Eye className="size-3" /> Preview
            </button>
          </div>
          <AppendFromPagePanel
            getCurrentContent={() => draftRef.current?.content ?? ''}
            onAppend={onAppend}
          />
          <Button
            size="sm"
            variant="ghost"
            className="size-7 p-0 text-destructive"
            onClick={() => setDeleteOpen(true)}
            title="Delete note"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        title="Delete this note?"
        description="It will be marked deleted but is recoverable from the main app."
        confirmLabel="Delete"
        destructive
        onConfirm={() => void performDelete()}
        onClose={() => setDeleteOpen(false)}
      />

      <div className="flex shrink-0 flex-col gap-2 border-b border-border/50 px-3 py-2">
        <Input
          value={draft.label}
          onChange={(e) => updateDraft({ label: e.target.value })}
          placeholder="Untitled"
          className="h-8 border-0 bg-transparent px-0 text-base font-semibold focus-visible:ring-0 focus-visible:ring-offset-0"
        />
        <div className="flex items-center gap-2">
          <Input
            value={draft.folderName}
            onChange={(e) => updateDraft({ folderName: e.target.value })}
            placeholder="Folder"
            list={FOLDERS_LIST_ID}
            className="h-7 max-w-[200px] text-xs"
          />
          <datalist id={FOLDERS_LIST_ID}>
            {folderSuggestions.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
          <SaveStatus state={savingState} lastSavedAt={lastSavedAt} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {viewMode === 'edit' ? (
          <Textarea
            value={draft.content}
            onChange={(e) => updateDraft({ content: e.target.value })}
            placeholder="Start writing… or use Append from page to capture content."
            className="h-full min-h-full w-full resize-none rounded-none border-0 bg-transparent px-3 py-2 font-mono text-xs leading-relaxed focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        ) : draft.content.trim() ? (
          <div className="px-3 py-2 text-sm">
            <MarkdownView content={draft.content} />
          </div>
        ) : (
          <div className="px-3 py-12 text-center text-xs text-muted-foreground">
            Empty note. Switch to Edit to start writing.
          </div>
        )}
      </div>
    </div>
  );
}

function SaveStatus({
  state,
  lastSavedAt,
}: {
  state: 'idle' | 'saving' | 'saved' | 'error';
  lastSavedAt: string | null;
}) {
  if (state === 'saving') {
    return <span className="text-[10px] text-muted-foreground">Saving…</span>;
  }
  if (state === 'error') {
    return <span className="text-[10px] text-destructive">Save failed</span>;
  }
  if (lastSavedAt) {
    return (
      <span className="text-[10px] text-muted-foreground">
        Saved {formatRelativeTime(lastSavedAt)}
      </span>
    );
  }
  return null;
}
