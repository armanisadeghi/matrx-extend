/**
 * Hierarchical tool discovery.
 *
 * Why: 100+ tools won't fit in a model's context window, and even when they
 * do, the noise hurts decision quality. We ship the agent a tiny core set
 * + the names of category list-tools. When the agent needs more, it asks.
 *
 *   list_browser_tools           — root index. Returns every category with
 *                                 description + count + the name of its
 *                                 list-tool.
 *   list_<category>_tools        — one per category. Returns the full tool
 *                                 schemas for that category.
 *
 * Server side (Python): when the agent calls a `list_<category>_tools` tool,
 * the server registers those tools as available for subsequent calls in
 * this conversation. The extension just reports the schemas; the server
 * decides which tools the model is allowed to invoke next.
 *
 * `list_core_tools` is included for completeness — it returns the same set
 * the agent already has; useful for "what's always-on?" questions.
 */

import {
  ALL_CATEGORIES,
  CATEGORIES,
  type ToolCategory,
  toolsInCategory,
} from '@/lib/tools/categories';
import { ensureToolDescriptions } from '@/lib/tools/descriptions';
import { listAllHandlers } from '@/lib/tools/registry';
import type { AnyToolHandler, ToolContext, ToolHandler } from '@/lib/tools/types';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

const NoArgs = z.object({}).default({});
type NoArgs = z.infer<typeof NoArgs>;

interface CategoryEntry {
  name: ToolCategory;
  label: string;
  description: string;
  list_tool: string;
  tool_count: number;
  tool_names: string[];
  admin_only: boolean;
}

function ctxIsAdmin(_ctx: ToolContext): boolean {
  // Agent context doesn't carry isAdmin yet. The dispatcher upstream filters
  // admin tools out of non-admin advertisement; here we err on the safe side
  // and assume non-admin unless we have signal otherwise. The Python server
  // tells the agent which categories are visible.
  return false;
}

export const list_browser_tools: ToolHandler<NoArgs, unknown> = {
  name: 'list_browser_tools',
  tier: 'read',
  argsSchema: NoArgs,
  run: async (_args, ctx) => {
    const handlers = listAllHandlers();
    const isAdmin = ctxIsAdmin(ctx);
    const categories: CategoryEntry[] = [];
    for (const cat of ALL_CATEGORIES) {
      const meta = CATEGORIES[cat];
      if (meta.admin_only && !isAdmin) continue;
      const tools = toolsInCategory(handlers, cat, { isAdmin });
      if (tools.length === 0) continue;
      categories.push({
        name: cat,
        label: meta.label,
        description: meta.description,
        list_tool: meta.list_tool_name,
        tool_count: tools.length,
        tool_names: tools.map((t) => t.name),
        admin_only: !!meta.admin_only,
      });
    }
    return {
      total_categories: categories.length,
      categories,
      hint: 'Call list_<category>_tools for full schemas. Tools you call next must come from a category whose list-tool you have already invoked.',
    };
  },
};

function buildCategoryListTool(category: ToolCategory): ToolHandler<NoArgs, unknown> {
  const meta = CATEGORIES[category];
  return {
    name: meta.list_tool_name,
    tier: 'read',
    admin_only: meta.admin_only,
    argsSchema: NoArgs,
    run: async (_args, ctx) => {
      const isAdmin = ctxIsAdmin(ctx) || !!meta.admin_only === false;
      const handlers = listAllHandlers();
      const tools = toolsInCategory(handlers, category, { isAdmin: isAdmin });
      // Descriptions live ONLY in the DB (Rule 4) — read them live so the
      // agent-facing schemas still carry a description without hardcoding it.
      const descs = await ensureToolDescriptions();
      return {
        category,
        count: tools.length,
        tools: tools.map((h) => ({
          name: h.name,
          description: descs.get(h.name) ?? null,
          tier: h.tier,
          admin_only: !!h.admin_only,
          required_optional_permissions: h.required_optional_permissions ?? [],
          supported_browsers: (h.supportedBrowsers ?? null) as readonly string[] | null,
          input_schema: zodToJsonSchema(h.argsSchema, {
            $refStrategy: 'none',
            target: 'jsonSchema7',
          }),
        })),
        hint:
          tools.length > 0
            ? 'You may now call any tool listed here. The server has been notified to make these tools available.'
            : 'Category exists but has no tools available to you (admin restriction or empty).',
      };
    },
  };
}

const category_list_tools: AnyToolHandler[] = ALL_CATEGORIES.map(
  (c) => buildCategoryListTool(c) as AnyToolHandler,
);

export const discover_handlers: AnyToolHandler[] = [
  list_browser_tools as AnyToolHandler,
  ...category_list_tools,
];
