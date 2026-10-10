/**
 * Swipe-file reads (Supabase, RLS) and the last-used collection (device).
 *
 * Membership writes use src/lib/api/routes/social.ts; collection metadata uses
 * direct caller-scoped RLS in library.ts. The last-used
 * collection is per device and per organization, kept in chrome.storage.local.
 */

import { getActiveOrganizationId } from '@/lib/org/active-org';
import { platformDb, socialDb } from '@/lib/supabase/schemas';

export interface SwipeCollectionRow {
  id: string;
  name: string;
  organization_id: string;
}

const LAST_KEY = 'matrx.swipe.last_collection';

export async function listCollections(): Promise<SwipeCollectionRow[]> {
  // Everything the person can see across ALL their organizations (access-ladder
  // law: the active org is where new things are saved, never a list filter).
  const { data, error } = await socialDb()
    .from('swipe_collection')
    .select('id,name,organization_id')
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(200);
  if (error) throw new Error(`Could not load your collections: ${error.message}`);
  return (data ?? []) as SwipeCollectionRow[];
}

export async function isPostInCollection(collectionId: string, postId: string): Promise<boolean> {
  const { data, error } = await platformDb()
    .from('associations')
    .select('id')
    .eq('source_type', 'social_swipe_collection')
    .eq('source_id', collectionId)
    .eq('target_type', 'social_post')
    .eq('target_id', postId)
    .is('deleted_at', null)
    .limit(1);
  if (error) throw new Error(`Could not check the collection: ${error.message}`);
  return (data ?? []).length > 0;
}

export async function getCollectionOrganizationId(id: string): Promise<string> {
  const { data, error } = await socialDb()
    .from('swipe_collection')
    .select('organization_id')
    .eq('id', id)
    .is('deleted_at', null)
    .single();
  if (error || !data?.organization_id) throw new Error(error?.message ?? 'Collection unavailable.');
  return String(data.organization_id);
}

export async function getLastCollectionId(organizationId?: string): Promise<string | null> {
  const org = organizationId ?? (await getActiveOrganizationId());
  const got = await chrome.storage.local.get(LAST_KEY);
  const map = (got[LAST_KEY] ?? {}) as Record<string, string>;
  return org ? (map[org] ?? null) : null;
}

export async function setLastCollectionId(id: string, organizationId?: string): Promise<void> {
  const org = organizationId ?? (await getActiveOrganizationId());
  if (!org) return;
  const got = await chrome.storage.local.get(LAST_KEY);
  const map = (got[LAST_KEY] ?? {}) as Record<string, string>;
  await chrome.storage.local.set({ [LAST_KEY]: { ...map, [org]: id } });
}
