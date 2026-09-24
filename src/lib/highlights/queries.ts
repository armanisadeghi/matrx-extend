/**
 * Supabase queries for the Highlights feature.
 *
 * Direct supabase-js calls — RLS automatically scopes every row to the
 * authenticated user via `user_id = auth.uid()`. Zod-parse on read.
 *
 * WRITES go through the one error seam (`src/lib/supabase/db-failure.ts`):
 * a refused create/update/delete raises `DbFailureError` after telling the
 * user in a sentence and recording the refusal in the platform error store.
 * They never return `null`/`false` quietly — the caller has usually already
 * updated the list optimistically, so a swallowed refusal leaves the screen
 * lying about what is in the database.
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
import { type DbCallSite, failDbCall } from '@/lib/supabase/db-failure';

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

/**
 * Create a highlight. Throws `DbFailureError` on refusal — a highlight the
 * database rejected must never come back as a quiet `null` while the overlay
 * keeps the mark on screen.
 */
export async function createHighlight(input: CreateHighlightInput): Promise<Highlight> {
  const site: DbCallSite = {
    table: 'extend.wbx_highlight',
    operation: 'insert',
    what: 'save this highlight',
    title: 'Highlight not saved',
  };
  let organizationId: string;
  try {
    organizationId = await requireRequestOrganizationId();
  } catch (error) {
    failDbCall(site, {
      code: 'no_organization',
      message: error instanceof Error ? error.message : String(error),
    });
  }
  const c = getSupabase();
  const { data: userRes } = await c.auth.getUser();
  const userId = userRes?.user?.id;
  if (!userId) {
    failDbCall(site, { code: 'PGRST301', message: 'no signed-in user' });
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
    // CONVERGE: C-7 — caller-supplied metadata written with no reserved-key guard; metadata is system-only — declared 2026-09-10, Data Doctrine §3.2. Register: /projects/data-doctrine-adoption/REGISTER.md#DD-060
    metadata: input.metadata ?? {},
    is_deleted: false,
  };
  const { data, error } = await c
    .schema('extend')
    .from(TABLE)
    .insert(payload)
    .select(FULL_COLUMNS)
    .single();
  // No row back with no error = RLS filtered the RETURNING row: a refusal.
  if (error || !data) failDbCall(site, error);
  const parsed = HighlightSchema.safeParse(data);
  if (!parsed.success) {
    failDbCall(site, {
      code: 'row_shape',
      message: `the saved highlight came back in an unexpected shape: ${parsed.error.issues[0]?.message ?? 'schema mismatch'}`,
    });
  }
  return parsed.data;
}

export async function updateHighlight(id: string, patch: UpdateHighlightPatch): Promise<Highlight> {
  const site: DbCallSite = {
    table: 'extend.wbx_highlight',
    operation: 'update',
    what: 'update this highlight',
    title: 'Highlight not updated',
  };
  const c = getSupabase();
  const { data, error } = await c
    .schema('extend')
    .from(TABLE)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(FULL_COLUMNS)
    .single();
  if (error || !data) failDbCall(site, error);
  const parsed = HighlightSchema.safeParse(data);
  if (!parsed.success) {
    failDbCall(site, {
      code: 'row_shape',
      message: `the updated highlight came back in an unexpected shape: ${parsed.error.issues[0]?.message ?? 'schema mismatch'}`,
    });
  }
  return parsed.data;
}

/**
 * Soft-delete a highlight. `.select('id')` is load-bearing: without it an RLS
 * refusal on an UPDATE comes back as `error: null` with zero rows touched, and
 * the caller — which has already removed the row from the list optimistically —
 * shows the user a deletion that never happened.
 */
export async function deleteHighlight(id: string): Promise<void> {
  const site: DbCallSite = {
    table: 'extend.wbx_highlight',
    operation: 'delete',
    what: 'delete this highlight',
    title: 'Highlight not deleted',
  };
  const c = getSupabase();
  const { data, error } = await c
    .schema('extend')
    .from(TABLE)
    .update({ is_deleted: true, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id');
  if (error || !data || data.length === 0) failDbCall(site, error);
}

/**
 * Soft-delete every highlight on a given URL. Returns how many were cleared.
 *
 * The ids are read FIRST, deliberately. A refused UPDATE returns `error: null`
 * with zero rows — identical to "there was nothing to clear" — so without
 * knowing what was there beforehand, a refusal reports "cleared 0" and the
 * user is told a comforting number instead of the truth. With the ids in hand
 * the two cases separate cleanly: nothing to clear is 0 and honest; rows that
 * existed and did not move is a refusal.
 */
export async function clearHighlightsForUrl(url: string): Promise<number> {
  const site: DbCallSite = {
    table: 'extend.wbx_highlight',
    operation: 'delete',
    what: 'clear the highlights on this page',
    title: 'Highlights not cleared',
  };
  const c = getSupabase();
  const { data: existing, error: readError } = await c
    .schema('extend')
    .from(TABLE)
    .select('id')
    .eq('url', url)
    .eq('is_deleted', false);
  if (readError) failDbCall({ ...site, operation: 'select' }, readError);
  if (!existing || existing.length === 0) return 0;

  const ids = existing.map((row) => (row as { id: string }).id);
  const { data, error } = await c
    .schema('extend')
    .from(TABLE)
    .update({ is_deleted: true, updated_at: new Date().toISOString() })
    .in('id', ids)
    .select('id');
  if (error || !data || data.length < ids.length) failDbCall(site, error);
  return data.length;
}
