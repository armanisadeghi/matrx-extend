/**
 * Demo cloud sync (TASK-004 follow-up).
 *
 * Guidance metadata already syncs (see src/lib/guidance/cloud-sync.ts), but a
 * guidance item of kind `demo_ref` carries only a POINTER — the recorded demo
 * itself lived local-only in chrome.storage.local under `matrx.demos.{id}`. On
 * a fresh machine the synced ref listed fine and then `replay_demo` failed: the
 * user was shown a saved workflow that did not exist. This module makes the
 * BODY travel too, through `extend.wbx_demo`.
 *
 * Model — identical to guidance on purpose: the DB is the source of truth,
 * chrome.storage.local is a fast offline cache. Every local mutation
 * best-effort mirrors to the cloud (see the hooks in storage.ts); on sign-in we
 * hydrate the cache from the cloud, reconciling last-write-wins by `updated_at`.
 * All cloud calls swallow errors — connectivity loss must never break the local
 * demo flow. Imports of the Supabase client and the storage layer are dynamic
 * so this module stays cheap for callers that only need the pure mappers.
 *
 * One deliberate difference from guidance: reconciliation compares the CLIENT
 * `updated_at` carried inside the row's `body`, not the `updated_at` column.
 * The platform `_100_touch_row` trigger overwrites that column with now() on
 * every write, so it measures server time, not when the user last edited.
 */

import { log } from '@/lib/debug/log';
import type { Demo, DemoParameter, DemoStep } from '@/lib/demos/types';
import type { SaveDemoRowPayload, WbxDemoRow } from '@/lib/supabase/queries';

/** Flatten a Demo into the row payload. Summary columns are denormalised; `body` is the whole record. */
export function demoToRowPayload(demo: Demo): SaveDemoRowPayload {
  return {
    id: demo.id,
    name: demo.name,
    description: demo.description,
    start_url: demo.start_url,
    step_count: demo.step_count,
    parameter_names: demo.parameter_names,
    body: demo,
  };
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

/**
 * Rebuild a Demo from a row. Returns null when the body is missing or has no
 * step array — a row we cannot replay is worse than no row, because it would
 * overwrite a good local copy with a hollow one.
 */
export function rowToDemo(row: WbxDemoRow): Demo | null {
  const body = (row.body && typeof row.body === 'object' ? row.body : null) as Record<
    string,
    unknown
  > | null;
  if (!body) return null;
  const steps = body.steps;
  if (!Array.isArray(steps)) return null;

  const parameters = Array.isArray(body.parameters) ? (body.parameters as DemoParameter[]) : [];
  const parameterNames = Array.isArray(row.parameter_names)
    ? row.parameter_names
    : parameters.map((p) => p.name);
  const createdByUserId = body.created_by_user_id;

  return {
    id: row.id,
    name: row.name ?? str(body.name, 'Demo'),
    description: row.description ?? str(body.description, ''),
    start_url: row.start_url ?? str(body.start_url, ''),
    step_count: row.step_count ?? steps.length,
    parameter_names: parameterNames,
    // Client epoch-ms timestamps come from the BODY — the columns are server
    // clock (see the module note above) and would corrupt last-write-wins.
    created_at: num(body.created_at, 0),
    updated_at: num(body.updated_at, 0),
    steps: steps as DemoStep[],
    parameters,
    ...(typeof createdByUserId === 'string' && { created_by_user_id: createdByUserId }),
  };
}

/** Fire-and-forget upsert of one demo to the cloud. Never throws. */
export async function pushDemoToCloud(demo: Demo): Promise<void> {
  try {
    const { upsertDemoRow } = await import('@/lib/supabase/queries');
    const ok = await upsertDemoRow(demoToRowPayload(demo));
    if (ok) log.info('sys', `demo synced to cloud id=${demo.id} steps=${demo.step_count}`);
  } catch (err) {
    log.warn('sys', 'demo cloud push failed (kept local)', err);
  }
}

/** Fire-and-forget tombstone of one demo in the cloud. Never throws. */
export async function removeDemoFromCloud(id: string): Promise<void> {
  try {
    const { deleteDemoRow } = await import('@/lib/supabase/queries');
    await deleteDemoRow(id);
  } catch (err) {
    log.warn('sys', 'demo cloud delete failed', err);
  }
}

/**
 * Pull the user's demo bodies from the cloud and merge into the local cache.
 * Additive + last-write-wins: a cloud demo is written locally only when there's
 * no local copy or the cloud copy is strictly newer. Local-only demos (recorded
 * offline, not yet pushed) are never removed. Writes with `sync:false` so the
 * merge doesn't echo straight back to the cloud.
 */
export async function hydrateDemosFromCloud(): Promise<{ merged: number; ok: boolean }> {
  let rows: WbxDemoRow[];
  try {
    const { fetchAllDemoRows } = await import('@/lib/supabase/queries');
    rows = await fetchAllDemoRows();
  } catch (err) {
    log.warn('sys', 'demo cloud hydrate failed', err);
    // ok:false lets the sign-in hook retry — a fetch that failed (offline,
    // token race) must not be recorded as "synced" for the whole session.
    return { merged: 0, ok: false };
  }
  if (rows.length === 0) return { merged: 0, ok: true };

  const { getDemo, saveDemo, deleteDemo } = await import('@/lib/demos/storage');
  let merged = 0;
  for (const row of rows) {
    if (row.is_deleted) {
      // Tombstone application. The column timestamp is the only clock we have
      // for a delete (nothing writes a body on delete), so compare against it.
      const local = await getDemo(row.id);
      if (local && new Date(row.updated_at).getTime() >= local.updated_at) {
        await deleteDemo(row.id, { sync: false });
        merged += 1;
      }
      continue;
    }
    const cloud = rowToDemo(row);
    if (!cloud) continue;
    const local = await getDemo(cloud.id);
    if (local && local.updated_at >= cloud.updated_at) continue;
    await saveDemo(cloud, { sync: false });
    merged += 1;
  }
  if (merged > 0) log.info('sys', `demos hydrated from cloud — merged ${merged} demo(s)`);
  return { merged, ok: true };
}

/**
 * Read a demo, repairing a local miss from the cloud before giving up.
 *
 * This is the path that makes a synced `demo_ref` honest: the ref can arrive
 * (or the user can sign in mid-session) before the sign-in hydrate has run, and
 * a replay that fails with "no such demo" reads as a broken feature. Every
 * consumer that needs the BODY — `replay_demo`, `describe_demo`, the Guidance
 * tab preview — goes through here rather than `getDemo` directly.
 */
export async function getDemoOrHydrate(id: string): Promise<Demo | null> {
  const { getDemo, saveDemo } = await import('@/lib/demos/storage');
  const local = await getDemo(id);
  if (local) return local;
  try {
    const { fetchDemoRow } = await import('@/lib/supabase/queries');
    const row = await fetchDemoRow(id);
    if (!row || row.is_deleted) return null;
    const demo = rowToDemo(row);
    if (!demo) return null;
    await saveDemo(demo, { sync: false });
    log.info('sys', `demo body repaired from cloud id=${id}`);
    return demo;
  } catch (err) {
    log.warn('sys', `demo cloud repair failed id=${id}`, err);
    return null;
  }
}
