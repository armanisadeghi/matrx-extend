/**
 * Live tool descriptions — read from the database (the source of truth), never
 * hardcoded in this repo (Rule 4, docs/TOOL_SOURCE_OF_TRUTH.md).
 *
 * The model never needs descriptions from us: aidream injects `tool_def`
 * descriptions server-side. But human-facing UI (the approval card, the Tools
 * tab) and the client discovery tools display them, so we fetch them LIVE from
 * Supabase and hold the result in memory for the session. No persisted
 * snapshot — refreshed each SW / sidepanel lifecycle, so the truth is never
 * served stale.
 *
 * Channel: direct Supabase REST `GET public.tool_def?select=name,description`,
 * gated by RLS on the publishable key. Replaces the retired
 * `GET /ai-tools/app/matrx-extend` endpoint (deleted in the 2026-05-27 tool
 * refactor — the new aidream router no longer filters by `source_app`).
 *
 * Tool names are globally unique (`tool_def.name` UNIQUE constraint — see
 * docs/official/tool_system_rules.md "Tool" definition), so caching every
 * active row's description is safe: there's no risk of name collision
 * between our handlers and another executor's tools sharing a name.
 */
import { log } from '@/lib/debug/log';
import { getSupabase } from '@/lib/supabase/client';

let cache: Map<string, string> | null = null;
let inflight: Promise<Map<string, string>> | null = null;

/**
 * Fetch (once per session) the name → description map for every active tool
 * in `public.tool_def`. Cached in memory; concurrent callers share the
 * in-flight promise. Failures are NOT cached (so a later call retries) and
 * resolve to an empty map so callers degrade gracefully — UI shows name +
 * args, never a stale string.
 */
export async function ensureToolDescriptions(): Promise<Map<string, string>> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const c = getSupabase();
      const { data, error } = await c
        .from('tool_def')
        .select('name, description')
        .eq('is_active', true);
      if (error) {
        log.warn('api', 'tool-description fetch failed; UI shows names only', error.message);
        return new Map<string, string>();
      }
      const map = new Map<string, string>();
      for (const row of (data ?? []) as Array<{
        name: string | null;
        description: string | null;
      }>) {
        if (row?.name && typeof row.description === 'string' && row.description) {
          map.set(row.name, row.description);
        }
      }
      cache = map;
      return map;
    } catch (err) {
      log.warn('api', 'tool-description fetch threw; UI shows names only', err);
      return new Map<string, string>();
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Synchronous lookup from the in-memory cache. Undefined until loaded. */
export function getToolDescription(name: string): string | undefined {
  return cache?.get(name);
}

/** Snapshot of the current cache (empty until loaded) — for React seeding. */
export function toolDescriptionsSnapshot(): Map<string, string> {
  return cache ?? new Map<string, string>();
}

/** Fire-and-forget prime — call on SW boot / sidepanel mount. */
export function primeToolDescriptions(): void {
  void ensureToolDescriptions();
}
