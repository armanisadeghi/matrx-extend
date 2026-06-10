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

const LIST_COLUMNS =
  'id, user_id, label, folder_name, folder_id, tags, updated_at, position, is_public';
const FULL_COLUMNS = `${LIST_COLUMNS}, content, metadata, is_deleted, version, created_at`;

// ─── Reads ──────────────────────────────────────────────────────────────────

export async function listMyNotes(): Promise<NoteListItem[]> {
  const c = getSupabase();
  const { data, error } = await c
    .from('notes')
    .select(LIST_COLUMNS)
    .eq('is_deleted', false)
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
  const c = getSupabase();
  const { data, error } = await c
    .from('note_folders')
    .select('*')
    .eq('is_deleted', false)
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
  const c = getSupabase();
  const { data, error } = await c.from('notes').select(FULL_COLUMNS).eq('id', id).maybeSingle();
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
  const payload = {
    user_id: userId,
    label: input.label?.trim() || 'Untitled',
    content: input.content ?? '',
    folder_name: input.folder_name ?? null,
    folder_id: input.folder_id ?? null,
    is_deleted: false,
  };
  const { data, error } = await c.from('notes').insert(payload).select(FULL_COLUMNS).single();
  if (error || !data) {
    console.warn('[notes] createNote error', error?.message);
    return null;
  }
  const parsed = NoteSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export async function updateNote(id: string, patch: UpdateNotePatch): Promise<Note | null> {
  const c = getSupabase();
  const { data, error } = await c
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
  const c = getSupabase();
  const { error } = await c
    .from('notes')
    .update({ is_deleted: true, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) {
    console.warn('[notes] softDeleteNote error', error.message);
    return false;
  }
  return true;
}
