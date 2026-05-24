/**
 * Live tool descriptions — read from the database (the source of truth), never
 * hardcoded in this repo (Rule 4, docs/TOOL_SOURCE_OF_TRUTH.md).
 *
 * The model never needs descriptions from us: aidream injects `tl_def`
 * descriptions server-side. But human-facing UI (the approval card, the Tools
 * tab) and the client discovery tools display them, so we fetch them LIVE from
 * aidream's public tools endpoint and hold the result in memory for the
 * session. No persisted snapshot — refreshed each SW / sidepanel lifecycle, so
 * the truth is never served stale.
 *
 * Channel: `GET /ai-tools/app/matrx-extend` (public; returns
 * `{id,name,description,source_app}` per tool) via the shared `apiGet` client.
 */
import { apiGet } from '@/lib/api/client';
import { log } from '@/lib/debug/log';

/**
 * Chrome-extension-exclusive tools carry the legacy `matrx-extend:` prefix in
 * `tl_def.name`; UI-first tools live at bare names. Strip the prefix so lookups
 * key by the same bare name the local handlers use. Mirrors `normalizeName` in
 * scripts/check-tool-db-drift.ts.
 */
const DB_PREFIX = 'matrx-extend:';
function normalizeName(name: string): string {
  return name.startsWith(DB_PREFIX) ? name.slice(DB_PREFIX.length) : name;
}

interface ToolRecord {
  name?: string | null;
  description?: string | null;
}
interface ListToolsByAppResponse {
  tools?: ToolRecord[] | null;
}

let cache: Map<string, string> | null = null;
let inflight: Promise<Map<string, string>> | null = null;

/**
 * Fetch (once per session) the bare-name → description map for matrx-extend
 * tools. Cached in memory; concurrent callers share the in-flight promise.
 * Failures are NOT cached (so a later call retries) and resolve to an empty map
 * so callers degrade gracefully — UI shows name + args, never a stale string.
 */
export async function ensureToolDescriptions(): Promise<Map<string, string>> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await apiGet<ListToolsByAppResponse>('/ai-tools/app/matrx-extend', undefined, {
        silent: true,
      });
      if (res.ok && res.data?.tools) {
        const map = new Map<string, string>();
        for (const t of res.data.tools) {
          if (t?.name && typeof t.description === 'string' && t.description) {
            map.set(normalizeName(t.name), t.description);
          }
        }
        cache = map;
        return map;
      }
      log.warn('api', 'tool-description fetch returned no tools; UI shows names only');
      return new Map<string, string>();
    } catch (err) {
      log.warn('api', 'tool-description fetch failed; UI shows names only', err);
      return new Map<string, string>();
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Synchronous lookup from the in-memory cache. Undefined until loaded. */
export function getToolDescription(name: string): string | undefined {
  return cache?.get(normalizeName(name));
}

/** Snapshot of the current cache (empty until loaded) — for React seeding. */
export function toolDescriptionsSnapshot(): Map<string, string> {
  return cache ?? new Map<string, string>();
}

/** Fire-and-forget prime — call on SW boot / sidepanel mount. */
export function primeToolDescriptions(): void {
  void ensureToolDescriptions();
}
