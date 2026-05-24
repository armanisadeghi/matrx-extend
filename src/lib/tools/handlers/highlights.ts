/**
 * Tier: READ — highlight access for the agent.
 *
 * Surfaces the highlights the user captured via the Highlight tab so the agent
 * can act on the exact element / passage with the existing interaction +
 * extraction tools. Each entry carries the captured text plus its reference
 * (stable CSS selector, the live data-matrx-ref when still valid, role/tag, and
 * the text-quote anchor for passages).
 *
 * Runs in the SW, which holds the user's Supabase session (set at boot — see
 * src/lib/background/bootstrap.ts), so RLS scopes rows to the signed-in user.
 */

import {
  listHighlightsForDomain,
  listHighlightsForUrl,
  listMyHighlights,
} from '@/lib/highlights/queries';
import { domainFromUrl } from '@/lib/highlights/types';
import { getAssignedTab } from '@/lib/tools/handlers/_active-tab';
import type { ToolHandler } from '@/lib/tools/types';
import { z } from 'zod';

const ListHighlightsArgs = z
  .object({
    /**
     * `page` (default) — highlights on the current tab's URL.
     * `site` — every highlight on the current tab's domain.
     * `all` — every highlight the user has saved.
     */
    scope: z.enum(['page', 'site', 'all']).optional().default('page'),
    /** Override the URL to scope to (otherwise the active tab's URL). */
    url: z.string().optional(),
    limit: z.number().int().positive().max(1000).optional().default(100),
  })
  .default({ scope: 'page', limit: 100 });
type ListHighlightsArgs = z.infer<typeof ListHighlightsArgs>;

export const list_highlights: ToolHandler<ListHighlightsArgs, unknown> = {
  name: 'list_highlights',
  tier: 'read',
  argsSchema: ListHighlightsArgs,
  run: async (args, ctx) => {
    const { scope, limit } = args;
    let url = args.url ?? null;
    if (!url && scope !== 'all') {
      const tab = await getAssignedTab(ctx);
      url = tab?.url ?? null;
    }

    let rows;
    if (scope === 'all') {
      rows = await listMyHighlights(limit);
    } else if (scope === 'site') {
      rows = url ? await listHighlightsForDomain(domainFromUrl(url)) : [];
    } else {
      rows = url ? await listHighlightsForUrl(url) : [];
    }

    const items = rows.slice(0, limit).map((h) => ({
      id: h.id,
      mode: h.mode,
      text: h.text,
      url: h.url,
      reference: {
        selector: h.anchor.selector ?? null,
        ref: h.anchor.ref ?? null,
        role: h.anchor.role ?? null,
        tag: h.anchor.tag ?? null,
        text_quote: h.anchor.text_quote ?? null,
      },
      created_at: h.created_at,
    }));

    return { ok: true, scope, url, count: items.length, highlights: items };
  },
};

export const highlight_handlers = [list_highlights];
