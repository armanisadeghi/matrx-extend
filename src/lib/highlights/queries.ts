/**
 * Supabase queries for the Highlights feature.
 *
 * Direct supabase-js calls — RLS automatically scopes every row to the
 * authenticated user via `user_id = auth.uid()`. Same conventions as
 * src/lib/notes/queries.ts: Zod-parse on read, console.warn + safe defaults
 * on error so the UI never crashes when offline / signed-out.
 *
 * NOTE: requires an authenticated user (a valid Supabase session). Guests
 * (X-Fingerprint-ID only) cannot write directly to Supabase — the Highlight
 * tab is signed-in-only, matching the Notes tab.
 */

import { requireRequestOrganizationId } from '@/lib/api/routes/auth';
import {
  type CreateHighlightInput,
  type Highlight,
  type HighlightListItem,
  HighlightListItemSchema,
  HighlightSchema,
  type UpdateHighlightPatch,
} from '@/lib/highlights/types';
import { getSupabase } from '@/lib/supabase/client';

const TABLE = 'wbx_highlight';

const LIST_COLUMNS =
  'id, created_by, conversation_id, mode, url, domain, page_title, color, text, anchor, created_at, updated_at';
const FULL_COLUMNS = `${LIST_COLUMNS}, metadata, is_deleted`;

function parseList(rows: unknown[] | null): HighlightListItem[] {
  const out: HighlightListItem[] = [];
  for (const row of rows ?? []) {
    const parsed = HighlightListItemSchema.safeParse(row);
    if (parsed.success) out.push(parsed.data);
    else console.warn('[highlights] list row failed validation', parsed.error.issues);
  }
  return out;
}

// ─── Reads ──────────────────────────────────────────────────────────────────

/** All non-deleted highlights for the signed-in user, newest first. */
export async function listMyHighlights(limit = 500): Promise<HighlightListItem[]> {
  const c = getSupabase();
  const { data, error } = await c
    .schema('extend')
    .from(TABLE)
    .select(LIST_COLUMNS)
    .eq('is_deleted', false)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.warn('[highlights] listMyHighlights error', error.message);
    return [];
  }
  return parseList(data);
}

/** Highlights captured on a specific page URL. */
export async function listHighlightsForUrl(url: string): Promise<HighlightListItem[]> {
  const c = getSupabase();
  const { data, error } = await c
    .schema('extend')
    .from(TABLE)
    .select(LIST_COLUMNS)
    .eq('url', url)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('[highlights] listHighlightsForUrl error', error.message);
    return [];
  }
  return parseList(data);
}

/** Highlights captured anywhere on a domain (re-paint on later visits). */
export async function listHighlightsForDomain(domain: string): Promise<HighlightListItem[]> {
  const c = getSupabase();
  const { data, error } = await c
    .schema('extend')
    .from(TABLE)
    .select(LIST_COLUMNS)
    .eq('domain', domain)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('[highlights] listHighlightsForDomain error', error.message);
    return [];
  }
  return parseList(data);
}

/** Highlights the user attached to a given conversation. */
export async function listHighlightsForConversation(
  conversationId: string,
): Promise<HighlightListItem[]> {
  const c = getSupabase();
  const { data, error } = await c
    .schema('extend')
    .from(TABLE)
    .select(LIST_COLUMNS)
    .eq('conversation_id', conversationId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('[highlights] listHighlightsForConversation error', error.message);
    return [];
  }
  return parseList(data);
}

export async function getHighlight(id: string): Promise<Highlight | null> {
  const c = getSupabase();
  const { data, error } = await c
    .schema('extend')
    .from(TABLE)
    .select(FULL_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error || !data) {
    if (error) console.warn('[highlights] getHighlight error', error.message);
    return null;
  }
  const parsed = HighlightSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

/** Fetch many by id (used to materialize chat-attached highlights). */
export async function getHighlightsByIds(ids: string[]): Promise<Highlight[]> {
  if (ids.length === 0) return [];
  const c = getSupabase();
  const { data, error } = await c
    .schema('extend')
    .from(TABLE)
    .select(FULL_COLUMNS)
    .in('id', ids)
    .eq('is_deleted', false);
  if (error) {
    console.warn('[highlights] getHighlightsByIds error', error.message);
    return [];
  }
  const out: Highlight[] = [];
  for (const row of data ?? []) {
    const parsed = HighlightSchema.safeParse(row);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

// ─── Writes ─────────────────────────────────────────────────────────────────

export async function createHighlight(input: CreateHighlightInput): Promise<Highlight | null> {
  let organizationId: string;
  try {
    organizationId = await requireRequestOrganizationId();
  } catch (error) {
    console.warn('[highlights] createHighlight refused: missing request organization', error);
    return null;
  }
  const c = getSupabase();
  const { data: userRes } = await c.auth.getUser();
  const userId = userRes?.user?.id;
  if (!userId) {
    console.warn('[highlights] createHighlight: no auth user');
    return null;
  }
  // Owner (`created_by`) is stamped server-side by the platform _stamp_actor
  // trigger from auth.uid(); we no longer send it in the payload.
  const payload = {
    organization_id: organizationId,
    conversation_id: input.conversation_id ?? null,
    mode: input.mode,
    url: input.url,
    domain: input.domain,
    page_title: input.page_title ?? null,
    color: input.color ?? 'yellow',
    text: input.text ?? null,
    anchor: input.anchor ?? {},
    metadata: input.metadata ?? {},
    is_deleted: false,
  };
  const { data, error } = await c
    .schema('extend')
    .from(TABLE)
    .insert(payload)
    .select(FULL_COLUMNS)
    .single();
  if (error || !data) {
    console.warn('[highlights] createHighlight error', error?.message);
    return null;
  }
  const parsed = HighlightSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export async function updateHighlight(
  id: string,
  patch: UpdateHighlightPatch,
): Promise<Highlight | null> {
  const c = getSupabase();
  const { data, error } = await c
    .schema('extend')
    .from(TABLE)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(FULL_COLUMNS)
    .single();
  if (error || !data) {
    console.warn('[highlights] updateHighlight error', error?.message);
    return null;
  }
  const parsed = HighlightSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export async function deleteHighlight(id: string): Promise<boolean> {
  const c = getSupabase();
  const { error } = await c
    .schema('extend')
    .from(TABLE)
    .update({ is_deleted: true, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) {
    console.warn('[highlights] deleteHighlight error', error.message);
    return false;
  }
  return true;
}

/** Soft-delete every highlight on a given URL. Returns count or -1 on error. */
export async function clearHighlightsForUrl(url: string): Promise<number> {
  const c = getSupabase();
  const { data, error } = await c
    .schema('extend')
    .from(TABLE)
    .update({ is_deleted: true, updated_at: new Date().toISOString() })
    .eq('url', url)
    .eq('is_deleted', false)
    .select('id');
  if (error) {
    console.warn('[highlights] clearHighlightsForUrl error', error.message);
    return -1;
  }
  return data?.length ?? 0;
}
