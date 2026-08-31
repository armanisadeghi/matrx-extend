/**
 * THE EXTENSION'S CONTENT IR REGISTRIES — what a kind is, and which component
 * draws it here.
 *
 * ## Why this is small
 *
 * matrx-frontend ships a compiled bootstrap of ~50 kind definitions with
 * `legacyBlockType` bridges, because it grew the Shape System. This client has
 * none of that and does not want it: it is a THIN client. The division of
 * labour is deliberate and is the reason this file is ~150 lines instead of
 * thousands —
 *
 *   - DETECTION is server-side. This extension never parses a raw chunk
 *     looking for a `__kind`; the server hands it a `render_block` carrying a
 *     validated Content-IR envelope on `metadata.__ir`.
 *   - The ROUTE and the RESOLVER come from `@ai-matrx/content-ir-react`. Every
 *     tier rule, every fallback disposition, is the shared one.
 *   - Only the DISPATCH TABLE (`components/kinds/dispatch.tsx`) is ours, and it
 *     is EXPLICIT: a kind renders through a real component here only because a
 *     `content_ir.kind_component` row names a component key this client maps.
 *     A kind with no mapped key falls to the honest generic floor — never a
 *     silent lookalike.
 *
 * ## Both registries read the live DB
 *
 * `content_ir` is PostgREST-exposed and readable from any authenticated
 * client, so "which kinds exist" and "what draws them on chrome-extension" are
 * DATA, not code. Adding a component to this client is therefore a row plus a
 * dispatch entry — the registry stays the authority.
 */

import { contentIrDb } from '@/lib/supabase/schemas';
import type { KindDefinition } from '@ai-matrx/content-ir';
import {
  ComponentResolver,
  type ComponentRole,
  type KindComponentRow,
} from '@ai-matrx/content-ir-react';
import { reportContentIrError } from './errors';
import { CONTENT_IR_PLATFORM } from './platform';

// ─── Kind definitions ──────────────────────────────────────────────────────

/**
 * A thin client's kind definition carries IDENTITY only: no schema (the server
 * validated the envelope before sending it), no compiled bridge (there is no
 * legacy component set here to bridge to).
 *
 * Identity alone is load-bearing: the shared route uses "is this kind
 * registered" to separate a KNOWN shape with no component here — which earns
 * the generic structured floor and its honest notice — from a slug the
 * platform has never heard of, which is left completely untouched.
 */
function thinDefinition(kind: string): KindDefinition {
  return { kind, schema: null, schemaSource: 'content_ir', tier: 'warm' };
}

/**
 * Warm-load retry backoff, matching `@ai-matrx/content-ir-react`'s
 * `ComponentResolver` (0.10.0) delay for delay. THE AUTH-HYDRATION RACE: a
 * freshly opened side panel mounts the chat surface — and therefore calls
 * `warmContentIr()` — before the Supabase session has restored, so this read
 * runs as `anon`, RLS answers 42501, and the load fails. `warmContentIr()` is
 * called ONCE per mount, so without a retry that single unlucky read decides
 * for the whole session that the platform has never heard of ANY kind, and
 * every render block is captioned "unregistered" while its row sits one
 * authenticated retry away.
 */
const WARM_RETRY_DELAYS_MS: readonly number[] = [1_000, 5_000, 15_000];

class ExtensionKindSource {
  private readonly known = new Map<string, KindDefinition>();
  private warmPromise: Promise<void> | null = null;
  /** Consecutive warm-load failures — indexes WARM_RETRY_DELAYS_MS. */
  private warmFailures = 0;
  private warmRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private version = 0;
  private readonly kindVersions = new Map<string, number>();
  private readonly kindListeners = new Map<string, Set<() => void>>();

  getDefinition(kind: string): KindDefinition | undefined {
    return this.known.get(kind);
  }

  getKindVersion(kind: string): number {
    return this.kindVersions.get(kind) ?? this.version;
  }

  subscribeKind(kind: string, listener: () => void): () => void {
    let set = this.kindListeners.get(kind);
    if (!set) {
      set = new Set();
      this.kindListeners.set(kind, set);
    }
    set.add(listener);
    return () => set.delete(listener);
  }

  /**
   * One slug load per session. Slugs only — a thin client never needs a kind's
   * schema, and pulling ~900 schema documents into a side panel would be a
   * real cost for zero rendering benefit.
   */
  ensureWarm(): Promise<void> {
    if (!this.warmPromise) {
      this.warmPromise = this.load()
        .then(() => {
          this.warmFailures = 0;
          this.clearWarmRetry();
        })
        .catch((error: unknown) => {
          // Loud, and RETRYABLE: a failed warm must not permanently convince
          // this client that every kind is unknown. Nobody calls
          // `warmContentIr()` a second time, so the retry is OURS to schedule.
          this.warmPromise = null;
          const attempt = this.warmFailures;
          this.warmFailures += 1;
          const delay = WARM_RETRY_DELAYS_MS[attempt];
          const remedy =
            delay === undefined
              ? 'retries exhausted — reopen the side panel to try again'
              : `retrying in ${Math.round(delay / 1000)}s`;
          reportContentIrError({
            source: 'content-ir',
            message: `kind-definition warm load failed — every kind reads as unregistered until this succeeds (${remedy}): ${
              error instanceof Error ? error.message : String(error)
            }`,
            relation: 'kind-registry',
            raw: error,
          });
          if (delay === undefined) return;
          this.clearWarmRetry();
          this.warmRetryTimer = setTimeout(() => {
            this.warmRetryTimer = null;
            void this.ensureWarm();
          }, delay);
        });
    }
    return this.warmPromise;
  }

  private clearWarmRetry(): void {
    if (this.warmRetryTimer !== null) {
      clearTimeout(this.warmRetryTimer);
      this.warmRetryTimer = null;
    }
  }

  private async load(): Promise<void> {
    const { data, error } = await contentIrDb()
      .from('kind_definition')
      .select('kind')
      .is('deleted_at', null);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const kind = (row as { kind?: unknown }).kind;
      if (typeof kind === 'string' && kind) this.known.set(kind, thinDefinition(kind));
    }
    this.version += 1;
    for (const [kind, listeners] of this.kindListeners) {
      this.kindVersions.set(kind, this.version);
      for (const listener of listeners) listener();
    }
  }
}

export const kindRegistry = new ExtensionKindSource();

// ─── Component resolution ──────────────────────────────────────────────────

interface KindComponentSelect {
  platform: string;
  role: string;
  component_key: string;
  source: string;
  is_active: boolean;
  updated_at: string | null;
  kind_definition: { kind: string } | { kind: string }[] | null;
}

function kindOf(row: KindComponentSelect): string | null {
  const embedded = Array.isArray(row.kind_definition)
    ? row.kind_definition[0]
    : row.kind_definition;
  return embedded?.kind ?? null;
}

function toRow(row: KindComponentSelect, kind: string): KindComponentRow {
  return {
    kind,
    platform: row.platform,
    // The column is free text; the resolver dispatches on two roles. Anything
    // else is a malformed row, and reading it as `output` would make it draw
    // where an INPUT component was meant to.
    role: row.role === 'input' ? 'input' : ('output' satisfies ComponentRole),
    componentKey: row.component_key,
    source: row.source,
    config: {},
    isActive: row.is_active,
    // `source='db'` is web-sandbox-only (ruling R1): this client compiles no
    // user-authored component source, so these are always null here and a
    // db-source row simply never routes.
    componentSource: null,
    propsTransform: null,
    pinnedKindVersion: null,
    updatedAt: row.updated_at,
    createdBy: null,
  };
}

const SELECT =
  'platform, role, component_key, source, is_active, updated_at, kind_definition!inner(kind, deleted_at)';

/**
 * THE PLATFORM FILTER is not an optimisation, it is correctness: a `web` row
 * names a component key that exists only in the Next.js app, and resolving one
 * here would type a block as something this client cannot draw.
 */
async function loadPlatformRows(kind?: string): Promise<KindComponentRow[]> {
  let query = contentIrDb()
    .from('kind_component')
    .select(SELECT)
    .eq('platform', CONTENT_IR_PLATFORM)
    .is('deleted_at', null)
    .is('kind_definition.deleted_at', null)
    .order('is_default', { ascending: false })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (kind) query = query.eq('kind_definition.kind', kind);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows: KindComponentRow[] = [];
  for (const raw of (data ?? []) as unknown as KindComponentSelect[]) {
    const slug = kindOf(raw);
    if (slug) rows.push(toRow(raw, slug));
  }
  return rows;
}

export const componentRegistry = new ComponentResolver({
  loadAll: () => loadPlatformRows(),
  loadForKind: (kind) => loadPlatformRows(kind),
  reportError: reportContentIrError,
});
