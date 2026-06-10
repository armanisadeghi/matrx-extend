/**
 * Guidance persistence — chrome.storage.local backed.
 *
 * Layout:
 *   matrx.guidance.list   → GuidanceSummary[]   (cheap-to-list index)
 *   matrx.guidance.{id}   → GuidanceItem        (full record)
 *
 * Keep the list index in sync with per-id records on every mutation;
 * mirror the demos.ts pattern. We never delete an `id` row without also
 * removing it from the list (and vice versa).
 */

import { log } from '@/lib/debug/log';
import type { GuidanceItem, GuidanceSummary } from '@/lib/guidance/types';

const LIST_KEY = 'matrx.guidance.list';
const ITEM_PREFIX = 'matrx.guidance.';

function itemKey(id: string): string {
  return `${ITEM_PREFIX}${id}`;
}

/** Generate a unique guidance id. Mirrors the demo id format. */
export function makeGuidanceId(): string {
  // Short URL-safe id — sortable by creation time.
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `gd_${ts}_${rand}`;
}

/** Domain-match helper. Memos/guidance on a parent domain apply to subdomains. */
export function guidanceMatchesDomain(itemDomain: string, currentDomain: string): boolean {
  if (itemDomain === currentDomain) return true;
  if (currentDomain.endsWith(`.${itemDomain}`)) return true;
  return false;
}

async function loadList(): Promise<GuidanceSummary[]> {
  try {
    const r = await chrome.storage.local.get([LIST_KEY]);
    const v = r[LIST_KEY];
    return Array.isArray(v) ? (v as GuidanceSummary[]) : [];
  } catch {
    return [];
  }
}

async function saveList(list: GuidanceSummary[]): Promise<void> {
  await chrome.storage.local.set({ [LIST_KEY]: list });
}

function toSummary(item: GuidanceItem): GuidanceSummary {
  return {
    id: item.id,
    kind: item.kind,
    domain: item.domain,
    caption: item.caption,
    created_at: item.created_at,
    updated_at: item.updated_at,
    demo_id: item.kind === 'demo_ref' ? item.demo_id : undefined,
  };
}

export async function listAllGuidance(): Promise<GuidanceSummary[]> {
  return loadList();
}

export async function listGuidanceForDomain(domain: string): Promise<GuidanceSummary[]> {
  const list = await loadList();
  return list.filter((g) => guidanceMatchesDomain(g.domain, domain));
}

export async function getGuidanceItem(id: string): Promise<GuidanceItem | null> {
  try {
    const r = await chrome.storage.local.get([itemKey(id)]);
    const v = r[itemKey(id)] as GuidanceItem | undefined;
    return v ?? null;
  } catch {
    return null;
  }
}

export async function getGuidanceItems(ids: string[]): Promise<GuidanceItem[]> {
  if (ids.length === 0) return [];
  try {
    const keys = ids.map(itemKey);
    const r = await chrome.storage.local.get(keys);
    return ids
      .map((id) => r[itemKey(id)] as GuidanceItem | undefined)
      .filter((v): v is GuidanceItem => v != null);
  } catch {
    return [];
  }
}

/**
 * Upsert. Updates the list index when the item is new, refreshes its
 * summary when fields like `caption`/`updated_at` change.
 *
 * Also best-effort mirrors the item to the cloud (`wbx_guidance`) so guidance
 * follows the user across machines (TASK-004). The cloud push is
 * fire-and-forget — connectivity loss never blocks the local write. Pass
 * `{ sync: false }` to write the local cache only (used by the cloud→local
 * hydration so a merge doesn't echo straight back to the cloud).
 */
export async function saveGuidanceItem(
  item: GuidanceItem,
  opts?: { sync?: boolean },
): Promise<void> {
  await chrome.storage.local.set({ [itemKey(item.id)]: item });
  const list = await loadList();
  const idx = list.findIndex((g) => g.id === item.id);
  const summary = toSummary(item);
  if (idx >= 0) {
    list[idx] = summary;
  } else {
    list.push(summary);
  }
  await saveList(list);
  log.info('sys', `guidance saved id=${item.id} kind=${item.kind} domain=${item.domain}`);
  if (opts?.sync !== false) {
    void import('@/lib/guidance/cloud-sync').then((m) => m.pushGuidanceToCloud(item));
  }
}

export async function deleteGuidanceItem(id: string, opts?: { sync?: boolean }): Promise<boolean> {
  const list = await loadList();
  const idx = list.findIndex((g) => g.id === id);
  if (idx < 0) return false;
  list.splice(idx, 1);
  await saveList(list);
  await chrome.storage.local.remove([itemKey(id)]);
  log.info('sys', `guidance deleted id=${id}`);
  if (opts?.sync !== false) {
    void import('@/lib/guidance/cloud-sync').then((m) => m.removeGuidanceFromCloud(id));
  }
  return true;
}

/**
 * Convenience for the demo flow: when a demo is recorded and saved, we
 * also create a domain-attached `demo_ref` guidance item so it appears
 * alongside notes/screenshots/GIFs in the unified Guidance tab.
 */
export async function attachDemoAsGuidance(args: {
  demo_id: string;
  domain: string;
  origin_url: string;
  name: string;
  step_count: number;
  parameter_names: string[];
}): Promise<GuidanceItem> {
  const now = Date.now();
  const item: GuidanceItem = {
    id: makeGuidanceId(),
    kind: 'demo_ref',
    domain: args.domain,
    origin_url: args.origin_url,
    caption: args.name,
    created_at: now,
    updated_at: now,
    demo_id: args.demo_id,
    name: args.name,
    step_count: args.step_count,
    parameter_names: args.parameter_names,
  };
  await saveGuidanceItem(item);
  return item;
}

/**
 * When a demo is deleted (via the Demos tab or `delete_demo` tool), drop
 * any matching `demo_ref` guidance items too. Caller is responsible for
 * deleting the underlying demo separately.
 */
export async function deleteDemoRefsByDemoId(demoId: string): Promise<number> {
  const list = await loadList();
  const matches = list.filter((g) => g.demo_id === demoId);
  for (const m of matches) {
    await deleteGuidanceItem(m.id);
  }
  return matches.length;
}
