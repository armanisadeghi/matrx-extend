/**
 * `data_patterns` mega-tool — the agent's interface to the saved-extraction
 * system the Showcase + Data tabs drive (audit X3 / decision D8).
 *
 * Actions:
 *   list     (read)   — saved patterns for a domain (default: assigned tab's)
 *   describe (read)   — one pattern's full config/fields
 *   recipes  (read)   — curated recipes matching the assigned tab's URL
 *   run      (action) — execute a saved pattern on the assigned tab
 *                       (DOM kinds in-page; ai_extract via the extractor
 *                       agent; network_capture via guided auto re-capture)
 *   save     (action) — persist a new pattern for the assigned tab's page
 *   delete   (action) — remove a saved pattern
 *
 * Cross-working rule: every action routes through the SAME functions the UI
 * uses (fetchPatternsForDomain / runSavedPattern / savePattern /
 * deletePattern / loadRecipes) — one code path, two drivers.
 *
 * No `description` here (Rule 4) — tool descriptions live ONLY in tool_def.
 */

import { loadRecipes, recipesForUrl } from '@/lib/data-pattern/recipes';
import { NetworkNoMatchError, runSavedPattern } from '@/lib/data-pattern/run-interactive';
import {
  type ExtractionPatternField,
  PATTERN_KINDS,
  bumpPatternRun,
  deletePattern,
  fetchPatternsForDomain,
  savePattern,
} from '@/lib/supabase/queries';
import { getAssignedTab } from '@/lib/tools/handlers/_active-tab';
import type { ToolHandler, ToolTier } from '@/lib/tools/types';
import { z } from 'zod';

const FieldSchema = z.object({
  name: z.string().min(1),
  selector: z.string().min(1),
  attr: z.string().optional(),
  is_list: z.boolean().optional(),
});

const DataPatternsArgs = z
  .object({
    action: z.enum(['list', 'describe', 'recipes', 'run', 'save', 'delete']),
    /** For describe / run / delete. */
    pattern_id: z.string().uuid().optional(),
    /** For list — defaults to the assigned tab's host. */
    domain: z.string().optional(),
    /** For save. */
    name: z.string().min(1).max(120).optional(),
    kind: z.enum(PATTERN_KINDS).optional(),
    /** For save — mode-specific config (see the kind's schema). */
    config: z.record(z.string(), z.unknown()).optional(),
    /** For save when kind === 'manual_css'. */
    fields: z.array(FieldSchema).max(40).optional(),
    /** For run — cap on returned rows (full count still reported). */
    rows_limit: z.number().int().min(1).max(500).optional(),
  })
  .superRefine((v, ctx) => {
    if ((v.action === 'describe' || v.action === 'run' || v.action === 'delete') && !v.pattern_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `action '${v.action}' requires pattern_id`,
      });
    }
    if (v.action === 'save' && (!v.name || !v.kind)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "action 'save' requires name and kind",
      });
    }
  });
type DataPatternsArgs = z.infer<typeof DataPatternsArgs>;

const READ_ACTIONS = new Set<DataPatternsArgs['action']>(['list', 'describe', 'recipes']);
const DEFAULT_ROWS_LIMIT = 100;

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

async function resolveDomain(
  args: DataPatternsArgs,
  ctx: Parameters<ToolHandler<DataPatternsArgs, unknown>['run']>[1],
): Promise<string | null> {
  if (args.domain) return args.domain;
  const tab = await getAssignedTab(ctx);
  return hostOf(tab?.url ?? undefined);
}

export const data_patterns: ToolHandler<DataPatternsArgs, unknown> = {
  name: 'data_patterns',
  tier: 'action',
  tierFor: (args): ToolTier => (READ_ACTIONS.has(args.action) ? 'read' : 'action'),
  argsSchema: DataPatternsArgs,
  run: async (args, ctx) => {
    if (args.action === 'list') {
      const domain = await resolveDomain(args, ctx);
      if (!domain) return { ok: false, reason: 'No domain — pass one or open a normal page.' };
      const patterns = await fetchPatternsForDomain(domain);
      return {
        ok: true,
        domain,
        patterns: patterns.map((p) => ({
          id: p.id,
          name: p.name,
          kind: p.kind,
          route_pattern: p.route_pattern,
          field_count: p.fields.length,
          last_status: p.last_status,
          last_run_at: p.last_run_at,
          last_run_count: p.last_run_count,
        })),
      };
    }

    if (args.action === 'describe') {
      const domain = await resolveDomain(args, ctx);
      if (!domain) return { ok: false, reason: 'No domain to look in.' };
      const patterns = await fetchPatternsForDomain(domain);
      const pattern = patterns.find((p) => p.id === args.pattern_id);
      if (!pattern) {
        return { ok: false, reason: `No pattern ${args.pattern_id} under ${domain}.` };
      }
      return { ok: true, pattern };
    }

    if (args.action === 'recipes') {
      const tab = await getAssignedTab(ctx);
      if (!tab?.url) return { ok: false, reason: 'No assigned tab URL.' };
      const all = await loadRecipes();
      const matching = recipesForUrl(tab.url, all);
      return {
        ok: true,
        url: tab.url,
        matching,
        total_in_catalog: all.length,
      };
    }

    if (args.action === 'run') {
      const tab = await getAssignedTab(ctx);
      if (!tab?.id) return { ok: false, reason: 'No assigned tab to run on.' };
      const domain = hostOf(tab.url ?? undefined);
      if (!domain) return { ok: false, reason: 'Assigned tab has no usable URL.' };
      const patterns = await fetchPatternsForDomain(domain);
      const pattern = patterns.find((p) => p.id === args.pattern_id);
      if (!pattern) {
        return { ok: false, reason: `No pattern ${args.pattern_id} under ${domain}.` };
      }
      try {
        const rows = await runSavedPattern(pattern, tab.id, {
          onProgress: (note) => ctx.reportProgress?.(note),
        });
        void bumpPatternRun(pattern.id, 'ok', rows.length);
        const limit = args.rows_limit ?? DEFAULT_ROWS_LIMIT;
        return {
          ok: true,
          pattern: { id: pattern.id, name: pattern.name, kind: pattern.kind },
          row_count: rows.length,
          rows: rows.slice(0, limit),
          truncated: rows.length > limit,
        };
      } catch (err) {
        if (err instanceof NetworkNoMatchError) {
          // Circumstantial, not a broken pattern — give the agent guidance.
          return { ok: false, reason: err.message, retryable: true };
        }
        void bumpPatternRun(pattern.id, 'broken', 0);
        return {
          ok: false,
          reason: err instanceof Error ? err.message : String(err),
        };
      }
    }

    if (args.action === 'save') {
      const tab = await getAssignedTab(ctx);
      const domain = args.domain ?? hostOf(tab?.url ?? undefined);
      if (!domain) return { ok: false, reason: 'No domain — pass one or open a normal page.' };
      let route: string | null = null;
      try {
        route = tab?.url ? new URL(tab.url).pathname : null;
      } catch {
        route = null;
      }
      const saved = await savePattern({
        name: args.name as string,
        domain,
        route_pattern: route,
        list_root_selector: null,
        fields: (args.fields ?? []) as ExtractionPatternField[],
        ...(args.kind !== undefined && { kind: args.kind }),
        config: args.config ?? {},
        target_user_table_id: null,
      });
      if (!saved) return { ok: false, reason: 'Save failed — check connection and inputs.' };
      return { ok: true, id: saved.id, domain };
    }

    if (args.action === 'delete') {
      const ok = await deletePattern(args.pattern_id as string);
      return ok ? { ok: true, deleted: args.pattern_id } : { ok: false, reason: 'Delete failed.' };
    }

    return { ok: false, reason: `Unknown action: ${args.action as string}` };
  },
};

export const data_pattern_handlers = [data_patterns];
