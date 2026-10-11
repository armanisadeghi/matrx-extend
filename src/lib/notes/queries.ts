/**
 * Supabase queries for the Notes tab.
 *
 * Read failures reject into React Query so the UI can distinguish them from
 * successful empty results. Writes return null on a failed database response.
 */

import { requireRequestOrganizationId } from '@/lib/api/routes/auth';
import {
  type CreateNoteInput,
  type Note,
  type NoteHome,
  type NoteHomeChoice,
  NoteHomeSchema,
  type NoteListItem,
  NoteListItemSchema,
  NoteSchema,
  type UpdateNotePatch,
} from '@/lib/notes/types';
import { customDb, iamDb, platformDb, workbenchDb } from '@/lib/supabase/schemas';

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
 * a display label: the home's name, plus " · <organization>" only when two
 * visible homes share a name.
 */
export async function listMyHomes(): Promise<NoteHomeChoice[]> {
  const { data, error } = await customDb()
    .from('context_scopes')
    .select('id, organization_id, name')
    .order('name', { ascending: true });
  if (error) {
    console.warn('[notes] listMyHomes error', error.message);
    throw new Error(`Could not load homes: ${error.message}`);
  }
  const homes: NoteHome[] = [];
  for (const row of data ?? []) {
    const parsed = NoteHomeSchema.safeParse(row);
    if (parsed.success) homes.push(parsed.data);
  }
  const taken = new Map<string, number>();
  for (const h of homes)
    taken.set(h.name.toLowerCase(), (taken.get(h.name.toLowerCase()) ?? 0) + 1);
  const needsOrg = homes.some((h) => (taken.get(h.name.toLowerCase()) ?? 0) > 1);
  const orgNames = new Map<string, string>();
  if (needsOrg) {
    const ids = Array.from(
      new Set(homes.map((h) => h.organization_id).filter((v): v is string => !!v)),
    );
    const { data: orgs, error: orgError } = await iamDb()
      .from('organizations')
      .select('id, name')
      .in('id', ids);
    if (orgError) console.warn('[notes] listMyHomes organization names error', orgError.message);
    for (const o of (orgs ?? []) as { id: string; name: string | null }[]) {
      if (o.name) orgNames.set(o.id, o.name);
    }
  }
  return homes.map((h) => {
    const shared = (taken.get(h.name.toLowerCase()) ?? 0) > 1;
    const org = h.organization_id ? orgNames.get(h.organization_id) : undefined;
    return { ...h, label: shared && org ? `${h.name} \u00b7 ${org}` : h.name };
  });
}

/**
 * Move a note to another home as the signed-in person. Never writes
 * `organization_id` or `home_scope_id` directly: the database refuses it.
 */
export async function moveNoteHome(noteId: string, scopeId: string): Promise<boolean> {
  const { error } = await platformDb().rpc('set_home', {
    p_entity_type: 'note',
    p_entity_id: noteId,
    p_scope_id: scopeId,
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
  if (error) {
    console.warn('[notes] softDeleteNote error', error.message);
    return false;
  }
  if (count !== 1) {
    console.warn('[notes] softDeleteNote affected unexpected row count', count);
    return false;
  }
  return true;
}
