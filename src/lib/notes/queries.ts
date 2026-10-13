/**
 * Supabase queries for the Notes tab.
 *
 * Read failures reject into React Query so the UI can distinguish them from
 * successful empty results. Writes return null on a failed database response.
 */

import { requireRequestOrganizationId } from '@/lib/api/routes/auth';
import { listHomeChoices, resolveHomeScopeId } from '@/lib/homes/queries';
import {
  type CreateNoteInput,
  type Note,
  type NoteHomeChoice,
  type NoteListItem,
  NoteListItemSchema,
  NoteSchema,
  type UpdateNotePatch,
} from '@/lib/notes/types';
import { failDbCall } from '@/lib/supabase/db-failure';
import { platformDb, workbenchDb } from '@/lib/supabase/schemas';

const LIST_COLUMNS = 'id, created_by, label, home_scope_id, tags, updated_at, position';
const FULL_COLUMNS = `${LIST_COLUMNS}, content, metadata, deleted_at, version, created_at`;

// ─── Reads ──────────────────────────────────────────────────────────────────

export async function listMyNotes(): Promise<NoteListItem[]> {
  const { data, error } = await workbenchDb()
    .from('notes')
    .select(LIST_COLUMNS)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false });
  if (error) {
    console.warn('[notes] listMyNotes error', error.message);
    throw new Error(`Could not load notes: ${error.message}`);
  }
  const out: NoteListItem[] = [];
  for (const row of data ?? []) {
    const parsed = NoteListItemSchema.safeParse(row);
    if (parsed.success) out.push(parsed.data);
    else {
      console.warn('[notes] list row failed validation', parsed.error.issues);
      throw new Error('Could not load notes: a returned note had an unexpected shape.');
    }
  }
  return out;
}

/**
 * Every home the person can see (each organization's General + scopes), with
 * a display label: the home's name, plus its organization for General or duplicate names.
 */
export async function listMyHomes(): Promise<NoteHomeChoice[]> {
  return listHomeChoices();
}

/**
 * Move a note to another home as the signed-in person. Never writes
 * `organization_id` or `home_scope_id` directly: the database refuses it.
 */
export async function moveNoteHome(
  noteId: string,
  home: string | NoteHomeChoice,
): Promise<boolean> {
  let resolvedScopeId: string;
  try {
    resolvedScopeId = await resolveHomeScopeId(home);
  } catch (error) {
    console.warn('[notes] resolve home error', error);
    return false;
  }
  const { error } = await platformDb().rpc('set_home', {
    p_entity_type: 'note',
    p_entity_id: noteId,
    p_scope_id: resolvedScopeId,
  });
  if (error) {
    console.warn('[notes] moveNoteHome error', error.message);
    return false;
  }
  return true;
}

export async function getNote(id: string): Promise<Note | null> {
  const { data, error } = await workbenchDb()
    .from('notes')
    .select(FULL_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) {
    console.warn('[notes] getNote error', error.message);
    throw new Error(`Could not load note: ${error.message}`);
  }
  if (!data) return null;
  const parsed = NoteSchema.safeParse(data);
  if (!parsed.success) {
    console.warn('[notes] getNote row failed validation', parsed.error.issues);
    throw new Error('Could not load note: the returned note had an unexpected shape.');
  }
  return parsed.data;
}

// ─── Writes ─────────────────────────────────────────────────────────────────

export async function createNote(input: CreateNoteInput): Promise<Note | null> {
  const organizationId = await requireRequestOrganizationId();
  // Owner (`created_by`) is stamped server-side by the platform _stamp_actor
  // trigger from auth.uid(); we do NOT send it. The trigger is a
  // COALESCE(NEW.created_by, uid), so a client-supplied value WINS over the
  // DB's — and RLS `WITH CHECK (created_by = auth.uid())` then rejects the whole
  // insert if the cached session id has drifted from the JWT. Sending it buys
  // nothing and turns a token-refresh skew into a failed save.
  const payload = {
    organization_id: organizationId,
    label: input.label?.trim() || 'Untitled',
    content: input.content ?? '',
  };
  const { data, error } = await workbenchDb()
    .from('notes')
    .insert(payload)
    .select(FULL_COLUMNS)
    .single();
  if (error || !data) {
    console.warn('[notes] createNote error', error?.message);
    return null;
  }
  const parsed = NoteSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export async function updateNote(id: string, patch: UpdateNotePatch): Promise<Note | null> {
  const { data, error } = await workbenchDb()
    .from('notes')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(FULL_COLUMNS)
    .single();
  if (error || !data) {
    console.warn('[notes] updateNote error', error?.message);
    return null;
  }
  const parsed = NoteSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export async function softDeleteNote(id: string): Promise<boolean> {
  const { count, error } = await workbenchDb()
    .from('notes')
    .update(
      { deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { count: 'exact' },
    )
    .eq('id', id);
  if (error || count !== 1) {
    failDbCall(
      {
        table: 'workbench.notes',
        operation: 'update',
        what: 'delete this note',
        title: 'Note not deleted',
      },
      error ??
        (count === null || count === 0
          ? null
          : { message: `Deletion affected an unexpected number of notes: ${count}` }),
    );
  }
  return true;
}
