/**
 * Supabase queries for the Notes tab.
 *
 * Same shape conventions as src/lib/agenda/queries.ts — Zod-parse on read,
 * console.warn on error and return safe defaults so the UI never crashes
 * when the user is offline or RLS rejects.
 */

import {
  type CreateNoteInput,
  type Note,
  type NoteFolder,
  NoteFolderSchema,
  type NoteListItem,
  NoteListItemSchema,
  NoteSchema,
  type UpdateNotePatch,
} from '@/lib/notes/types';
import { getSupabase } from '@/lib/supabase/client';
import { workbenchDb } from '@/lib/supabase/schemas';

const LIST_COLUMNS =
  'id, created_by, label, folder_name, folder_id, tags, updated_at, position, visibility';
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
    return [];
  }
  const out: NoteListItem[] = [];
  for (const row of data ?? []) {
    const parsed = NoteListItemSchema.safeParse(row);
    if (parsed.success) out.push(parsed.data);
    else console.warn('[notes] list row failed validation', parsed.error.issues);
  }
  return out;
}

export async function listMyFolders(): Promise<NoteFolder[]> {
  const { data, error } = await workbenchDb()
    .from('note_folders')
    .select('*')
    .is('deleted_at', null)
    .order('position', { ascending: true });
  if (error) {
    console.warn('[notes] listMyFolders error', error.message);
    return [];
  }
  const out: NoteFolder[] = [];
  for (const row of data ?? []) {
    const parsed = NoteFolderSchema.safeParse(row);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export async function getNote(id: string): Promise<Note | null> {
  const { data, error } = await workbenchDb()
    .from('notes')
    .select(FULL_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error || !data) {
    if (error) console.warn('[notes] getNote error', error.message);
    return null;
  }
  const parsed = NoteSchema.safeParse(data);
  if (!parsed.success) {
    console.warn('[notes] getNote row failed validation', parsed.error.issues);
    return null;
  }
  return parsed.data;
}

// ─── Writes ─────────────────────────────────────────────────────────────────

export async function createNote(input: CreateNoteInput): Promise<Note | null> {
  const c = getSupabase();
  const { data: userRes } = await c.auth.getUser();
  const userId = userRes?.user?.id;
  if (!userId) {
    console.warn('[notes] createNote: no auth user');
    return null;
  }
  // Owner (`created_by`) is stamped server-side by the platform _stamp_actor
  // trigger from auth.uid(); we do NOT send it. The trigger is a
  // COALESCE(NEW.created_by, uid), so a client-supplied value WINS over the
  // DB's — and RLS `WITH CHECK (created_by = auth.uid())` then rejects the whole
  // insert if the cached session id has drifted from the JWT. Sending it buys
  // nothing and turns a token-refresh skew into a failed save.
  // (`organization_id` is likewise stamped, by _stamp_org_default.)
  // Same rule as createHighlight() — see src/lib/supabase/schemas.ts.
  const payload = {
    label: input.label?.trim() || 'Untitled',
    content: input.content ?? '',
    folder_name: input.folder_name ?? null,
    folder_id: input.folder_id ?? null,
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
  const { error } = await workbenchDb()
    .from('notes')
    .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) {
    console.warn('[notes] softDeleteNote error', error.message);
    return false;
  }
  return true;
}
