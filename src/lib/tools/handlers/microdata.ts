/**
 * `extract_microdata` — agent-facing structured-data extractor.
 *
 * Cross-working: this tool is a thin wrapper over the same
 * `data-pattern/modes/{json_ld,microdata,og_meta}` extractors that the
 * **Showcase** tab's JsonLdTab / MicrodataTab / SnapshotTab already use.
 * One code path — when someone improves the JSON-LD or microdata logic
 * for the user-facing UI, the agent tool benefits automatically.
 *
 * The agent gets a single bundled response (snapshot + json_ld +
 * microdata + schema_org_types), with optional type filters; the user
 * gets the same data interactively in the Showcase tab.
 *
 * 📝 Notes:
 *    .research/proposed-tools-and-features.md (item #9 → renumbered)
 *    .research/tools-roadmap.md
 *
 * 🧪 Tests: docs/feature-tests.md → "extract_microdata"
 */
import { z } from 'zod';
import { runMode } from '@/lib/data-pattern/run-pattern';
import { getAssignedTabId } from '@/lib/tools/handlers/_active-tab';
import type { ToolHandler } from '@/lib/tools/types';

const KIND_VALUES = ['snapshot', 'json_ld', 'microdata'] as const;
type Kind = (typeof KIND_VALUES)[number];

const ExtractMicrodataArgs = z
  .object({
    /**
     * Which sub-extractors to run. Default: all three. Restrict for
     * smaller responses (e.g. `["json_ld"]` if you only want product /
     * recipe schema).
     */
    kinds: z.array(z.enum(KIND_VALUES)).optional(),
    /**
     * JSON-LD `@type` filter (e.g. "Product", "Recipe", "Event"). Only
     * blocks matching this @type are returned. When omitted, every
     * top-level / @graph-flattened block is returned.
     */
    ld_type: z.string().optional(),
    /**
     * Microdata itemtype filter (short form like "Product" or full URL
     * like "https://schema.org/Product"). When set, returns ALL items
     * of that type — including nested ones. When omitted, returns only
     * top-level itemscopes.
     */
    itemtype: z.string().optional(),
  })
  .default({});
type ExtractMicrodataArgs = z.infer<typeof ExtractMicrodataArgs>;

interface ExtractMicrodataResult {
  ok: boolean;
  reason?: string;
  /**
   * Page snapshot (from the og_meta mode): title, url, canonical, lang,
   * description, og.*, twitter.*, article.*, json_ld, favicon. Useful
   * even when neither json_ld nor microdata is present.
   */
  snapshot?: Record<string, unknown> | null;
  /** JSON-LD blocks, optionally filtered by `ld_type`. */
  json_ld?: Record<string, unknown>[];
  /** Schema.org microdata items, optionally filtered by `itemtype`. */
  microdata?: Record<string, unknown>[];
  /**
   * Union of every detected schema type — both JSON-LD `@type` values
   * and microdata `itemtype` short names. Useful for quickly answering
   * "is this a Product page?" without parsing the full payload.
   */
  schema_org_types?: string[];
  counts?: { json_ld: number; microdata: number };
}

export const extract_microdata: ToolHandler<ExtractMicrodataArgs, ExtractMicrodataResult> = {
  name: 'extract_microdata',
  tier: 'read',
  description:
    "Extract every structured-data signal on the active page in one call: { snapshot, json_ld, microdata, schema_org_types, counts }. `snapshot` is the OG/Twitter/canonical/JSON-LD snapshot used by the Showcase tab. `json_ld` returns each JSON-LD block (flattens @graph; honors `ld_type` filter). `microdata` walks every [itemscope][itemtype] tree (honors `itemtype` filter). `schema_org_types` unions all detected types so you can answer 'is this a Product page?' in one read. Same code paths as the user-facing Showcase → JSON-LD / Microdata / Snapshot sub-tabs, so improvements to either surface flow both ways.",
  argsSchema: ExtractMicrodataArgs,
  run: async (args, ctx) => {
    const tabId = await getAssignedTabId(ctx);
    if (tabId == null) return { ok: false, reason: 'No active tab' };

    const kinds: Set<Kind> = new Set(args.kinds ?? KIND_VALUES);
    const out: ExtractMicrodataResult = { ok: true };
    const types = new Set<string>();

    // ─── snapshot (og_meta) ───────────────────────────────────────────
    if (kinds.has('snapshot')) {
      try {
        const rows = await runMode('og_meta', tabId, {});
        out.snapshot = (rows[0] ?? null) as Record<string, unknown> | null;
        // Mine schema types from the snapshot's embedded JSON-LD too.
        const ldFromSnapshot = (out.snapshot?.json_ld as unknown[] | undefined) ?? [];
        for (const block of ldFromSnapshot) collectAtTypes(block, types);
      } catch (err) {
        out.snapshot = null;
        out.reason = `snapshot failed: ${(err as Error).message}`;
      }
    }

    // ─── json_ld ──────────────────────────────────────────────────────
    if (kinds.has('json_ld')) {
      try {
        const rows = await runMode('json_ld', tabId, args.ld_type ? { ld_type: args.ld_type } : {});
        out.json_ld = rows as Record<string, unknown>[];
        for (const row of rows) collectAtTypes(row, types);
      } catch (err) {
        out.json_ld = [];
        out.reason = `${out.reason ? out.reason + '; ' : ''}json_ld failed: ${(err as Error).message}`;
      }
    }

    // ─── microdata ────────────────────────────────────────────────────
    if (kinds.has('microdata')) {
      try {
        const rows = await runMode(
          'microdata',
          tabId,
          args.itemtype ? { itemtype: args.itemtype } : {},
        );
        out.microdata = rows as Record<string, unknown>[];
        for (const row of rows) {
          const t = row['@type'];
          if (typeof t === 'string') types.add(t);
        }
      } catch (err) {
        out.microdata = [];
        out.reason = `${out.reason ? out.reason + '; ' : ''}microdata failed: ${(err as Error).message}`;
      }
    }

    out.schema_org_types = Array.from(types).sort();
    out.counts = {
      json_ld: out.json_ld?.length ?? 0,
      microdata: out.microdata?.length ?? 0,
    };
    return out;
  },
};

/** Walk a JSON-LD value and collect every `@type` (string or array). */
function collectAtTypes(node: unknown, into: Set<string>): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) collectAtTypes(n, into);
    return;
  }
  const obj = node as Record<string, unknown>;
  if (Array.isArray(obj['@graph'])) {
    for (const g of obj['@graph']) collectAtTypes(g, into);
  }
  const t = obj['@type'];
  if (typeof t === 'string') into.add(t);
  else if (Array.isArray(t)) {
    for (const tt of t) if (typeof tt === 'string') into.add(tt);
  }
  for (const v of Object.values(obj)) {
    if (typeof v === 'object' && v !== null) collectAtTypes(v, into);
  }
}

export const microdata_handlers = [extract_microdata];
