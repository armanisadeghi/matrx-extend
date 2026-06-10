/**
 * Guidance cloud sync (TASK-004).
 *
 * Guidance metadata used to be local-only in chrome.storage.local — only the
 * artifact bytes reached cld_files, so the guidance entries themselves vanished
 * on reinstall / machine-switch. This module syncs the metadata to the
 * `public.wbx_guidance` table so guidance follows the user across machines.
 *
 * Model: the DB is the source of truth; chrome.storage.local is a fast offline
 * cache. Every local mutation best-effort mirrors to the cloud (see the sync
 * hooks in storage.ts); on sign-in we hydrate the cache from the cloud,
 * reconciling last-write-wins by `updated_at`.
 *
 * All cloud calls are best-effort and swallow errors — losing connectivity
 * must never break the local guidance flow. Imports of the Supabase client and
 * the storage layer are dynamic so this module stays cheap for callers that
 * only need the pure mappers.
 *
 * Known limitation: `demo_ref` items sync their POINTER, but the underlying
 * recorded demo (chrome.storage.local `matrx.demos.{id}`) is not yet
 * cloud-synced — on a fresh machine a demo_ref will list but replay will fail
 * until demo bodies sync too. Tracked in docs/KNOWN_ISSUES.md.
 */

import { log } from '@/lib/debug/log';
import type { GuidanceItem } from '@/lib/guidance/types';
import type { SaveGuidanceRowPayload, WbxGuidanceRow } from '@/lib/supabase/queries';

const KNOWN_KINDS = new Set<GuidanceItem['kind']>(['note', 'screenshot', 'gif', 'demo_ref']);

/** Flatten a GuidanceItem into the row payload — kind-specific fields go to `data`. */
export function itemToRowPayload(item: GuidanceItem): SaveGuidanceRowPayload {
  const data: Record<string, unknown> = {};
  switch (item.kind) {
    case 'note':
      data.text = item.text;
      break;
    case 'screenshot':
      data.file_id = item.file_id;
      data.url = item.url;
      data.width = item.width;
      data.height = item.height;
      data.annotated_file_id = item.annotated_file_id;
      data.annotated_url = item.annotated_url;
      data.annotation_doc = item.annotation_doc;
      break;
    case 'gif':
      data.file_id = item.file_id;
      data.url = item.url;
      data.duration_ms = item.duration_ms;
      data.frame_count = item.frame_count;
      break;
    case 'demo_ref':
      data.demo_id = item.demo_id;
      data.name = item.name;
      data.step_count = item.step_count;
      data.parameter_names = item.parameter_names;
      break;
  }
  return {
    id: item.id,
    domain: item.domain,
    kind: item.kind,
    caption: item.caption ?? null,
    origin_url: item.origin_url ?? null,
    data,
    created_at: new Date(item.created_at).toISOString(),
    updated_at: new Date(item.updated_at).toISOString(),
  };
}

/** Rebuild a GuidanceItem from a row. Returns null for unknown/corrupt kinds. */
export function rowToItem(row: WbxGuidanceRow): GuidanceItem | null {
  if (!KNOWN_KINDS.has(row.kind as GuidanceItem['kind'])) return null;
  const d = (row.data && typeof row.data === 'object' ? row.data : {}) as Record<string, unknown>;
  const base = {
    id: row.id,
    domain: row.domain,
    caption: row.caption ?? undefined,
    origin_url: row.origin_url ?? undefined,
    created_at: Number.isFinite(Date.parse(row.created_at)) ? Date.parse(row.created_at) : 0,
    updated_at: Number.isFinite(Date.parse(row.updated_at)) ? Date.parse(row.updated_at) : 0,
  };
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
  const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

  switch (row.kind) {
    case 'note':
      return { ...base, kind: 'note', text: str(d.text) ?? '' };
    case 'screenshot':
      return {
        ...base,
        kind: 'screenshot',
        file_id: str(d.file_id) ?? '',
        url: str(d.url) ?? null,
        width: num(d.width),
        height: num(d.height),
        annotated_file_id: str(d.annotated_file_id),
        annotated_url: str(d.annotated_url) ?? undefined,
        annotation_doc: d.annotation_doc,
      };
    case 'gif':
      return {
        ...base,
        kind: 'gif',
        file_id: str(d.file_id) ?? '',
        url: str(d.url) ?? null,
        duration_ms: num(d.duration_ms),
        frame_count: num(d.frame_count),
      };
    case 'demo_ref':
      return {
        ...base,
        kind: 'demo_ref',
        demo_id: str(d.demo_id) ?? '',
        name: str(d.name) ?? base.caption ?? 'Demo',
        step_count: num(d.step_count) ?? 0,
        parameter_names: Array.isArray(d.parameter_names)
          ? d.parameter_names.filter((x): x is string => typeof x === 'string')
          : [],
      };
    default:
      return null;
  }
}

/** Fire-and-forget upsert of one item to the cloud. Never throws. */
export async function pushGuidanceToCloud(item: GuidanceItem): Promise<void> {
  try {
    const { upsertGuidanceRow } = await import('@/lib/supabase/queries');
    const ok = await upsertGuidanceRow(itemToRowPayload(item));
    if (ok) log.info('sys', `guidance synced to cloud id=${item.id}`);
  } catch (err) {
    log.warn('sys', 'guidance cloud push failed (kept local)', err);
  }
}

/** Fire-and-forget delete of one item from the cloud. Never throws. */
export async function removeGuidanceFromCloud(id: string): Promise<void> {
  try {
    const { deleteGuidanceRow } = await import('@/lib/supabase/queries');
    await deleteGuidanceRow(id);
  } catch (err) {
    log.warn('sys', 'guidance cloud delete failed', err);
  }
}

/**
 * Pull the user's guidance rows from the cloud and merge into the local cache.
 * Additive + last-write-wins: a cloud item is written locally only when there's
 * no local copy or the cloud copy is strictly newer. Local-only items (created
 * offline, not yet pushed) are never removed. Writes with `sync:false` so the
 * merge doesn't echo straight back to the cloud.
 */
export async function hydrateGuidanceFromCloud(): Promise<{ merged: number }> {
  let rows: WbxGuidanceRow[];
  try {
    const { fetchAllGuidanceRows } = await import('@/lib/supabase/queries');
    rows = await fetchAllGuidanceRows();
  } catch (err) {
    log.warn('sys', 'guidance cloud hydrate failed', err);
    return { merged: 0 };
  }
  if (rows.length === 0) return { merged: 0 };

  const { getGuidanceItem, saveGuidanceItem } = await import('@/lib/guidance/storage');
  let merged = 0;
  for (const row of rows) {
    const cloud = rowToItem(row);
    if (!cloud) continue;
    const local = await getGuidanceItem(cloud.id);
    if (local && local.updated_at >= cloud.updated_at) continue;
    await saveGuidanceItem(cloud, { sync: false });
    merged += 1;
  }
  if (merged > 0) log.info('sys', `guidance hydrated from cloud — merged ${merged} item(s)`);
  return { merged };
}
