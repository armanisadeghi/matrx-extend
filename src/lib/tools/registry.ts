/**
 * Central tool registry.
 *
 * Surface bundles:
 *   - coreToolNames()           — what we ship to the agent on EVERY chat:
 *                                 ~10 always-on essentials + every
 *                                 `list_<category>_tools` discovery tool.
 *                                 The agent uses the discovery tools to ask
 *                                 for more capabilities when it needs them.
 *   - assistantToolNames()      — read-only Chat surface (legacy; bigger
 *                                 advertised surface).
 *   - pilotToolNames()          — full kit: read + action + ask-user.
 *   - allToolNames()            — every registered tool, including
 *                                 privileged. Trusted agents only.
 *   - categoryToolNames(cat)    — tools in a specific category. Used by
 *                                 the Python server when resolving "the
 *                                 agent just called list_page_tools, what
 *                                 schemas should I add to its toolset?".
 *
 * Each bundle accepts `{ isAdmin? }`. Non-admins never see admin-only tools.
 */

import { action_handlers } from '@/lib/tools/handlers/action';
import { batch_handlers } from '@/lib/tools/handlers/batch';
import { browser_data_handlers } from '@/lib/tools/handlers/browser-data';
import { cdp_handlers } from '@/lib/tools/handlers/cdp';
import { discover_handlers } from '@/lib/tools/handlers/discover';
import { download_handlers } from '@/lib/tools/handlers/downloads';
import { form_action_handlers, form_read_handlers } from '@/lib/tools/handlers/forms';
import { inspect_handlers } from '@/lib/tools/handlers/inspect';
import { keyboard_handlers } from '@/lib/tools/handlers/keyboard';
import { memory_handlers } from '@/lib/tools/handlers/memory';
import { onbox_ai_handlers } from '@/lib/tools/handlers/onbox-ai';
import {
  cookies_handlers,
  pagecapture_handlers,
  sessions_handlers,
} from '@/lib/tools/handlers/optional-perms';
import { page_ref_handlers } from '@/lib/tools/handlers/page-refs';
import { privileged_handlers, privileged_read_handlers } from '@/lib/tools/handlers/privileged';
import { read_handlers } from '@/lib/tools/handlers/read';
import { tab_action_handlers, tab_read_handlers } from '@/lib/tools/handlers/tabs';
import { user_handlers } from '@/lib/tools/handlers/user';
import { webmcp_handlers } from '@/lib/tools/handlers/webmcp';
import {
  CATEGORIES,
  type ToolCategory,
  categoryOf,
  toolsInCategory,
} from '@/lib/tools/categories';
import type { AnyToolHandler, ToolHandler } from '@/lib/tools/types';

const ALL: AnyToolHandler[] = [
  // ─── discovery (core) ──────────────────────────────────────────────────
  ...discover_handlers,
  // ─── core extras ───────────────────────────────────────────────────────
  ...batch_handlers,
  // ─── page understanding (ref system) ──────────────────────────────────
  ...page_ref_handlers,
  // ─── existing page reads ───────────────────────────────────────────────
  ...read_handlers,
  ...inspect_handlers,
  // ─── browser-level reads ───────────────────────────────────────────────
  ...tab_read_handlers,
  ...browser_data_handlers,
  // ─── form discovery ────────────────────────────────────────────────────
  ...form_read_handlers,
  // ─── privileged reads ──────────────────────────────────────────────────
  ...privileged_read_handlers,
  // ─── on-device AI ──────────────────────────────────────────────────────
  ...onbox_ai_handlers,
  // ─── page actions ──────────────────────────────────────────────────────
  ...action_handlers,
  ...keyboard_handlers,
  ...form_action_handlers,
  // ─── browser-level actions ─────────────────────────────────────────────
  ...tab_action_handlers,
  ...download_handlers,
  // ─── memory ────────────────────────────────────────────────────────────
  ...memory_handlers,
  // ─── optional-permission tools ─────────────────────────────────────────
  ...sessions_handlers,
  ...pagecapture_handlers,
  ...cookies_handlers,
  ...cdp_handlers,
  // ─── webmcp ────────────────────────────────────────────────────────────
  ...webmcp_handlers,
  // ─── ask-user ──────────────────────────────────────────────────────────
  ...user_handlers,
  // ─── privileged ────────────────────────────────────────────────────────
  ...privileged_handlers,
] as AnyToolHandler[];

const BY_NAME = new Map<string, AnyToolHandler>();
for (const t of ALL) BY_NAME.set(t.name, t);

export function lookup(name: string): AnyToolHandler | undefined {
  return BY_NAME.get(name);
}

interface BundleOptions {
  isAdmin?: boolean;
}

function visible(t: AnyToolHandler, opts: BundleOptions): boolean {
  return opts.isAdmin ? true : !t.admin_only;
}

/**
 * The minimum set we advertise to every agent on every chat. Tiny enough to
 * fit comfortably in any model's context: a handful of always-on
 * essentials + the master `list_browser_tools` discovery tool + every
 * `list_<category>_tools` so the agent can pull more capabilities on
 * demand.
 */
export function coreToolNames(opts: BundleOptions = {}): string[] {
  const out = ALL.filter(
    (t) => categoryOf(t.name) === 'core' && visible(t, opts),
  ).map((t) => t.name);
  // Add the per-category discovery tools so the agent can ask for any
  // category by name.
  for (const cat of Object.values(CATEGORIES)) {
    if (cat.admin_only && !opts.isAdmin) continue;
    if (!out.includes(cat.list_tool_name)) out.push(cat.list_tool_name);
  }
  return out;
}

/** Tool names in a specific category (used by the server for dynamic registration). */
export function categoryToolNames(
  category: ToolCategory,
  opts: BundleOptions = {},
): string[] {
  return toolsInCategory(ALL, category, opts).map((t) => t.name);
}

/** Every registered tool. Includes privileged. */
export function allToolNames(opts: BundleOptions = {}): string[] {
  return ALL.filter((t) => visible(t, opts)).map((t) => t.name);
}

/** Tool names suitable for the conversational Chat surface (read-only). */
export function assistantToolNames(opts: BundleOptions = {}): string[] {
  return ALL.filter((t) => t.tier === 'read' && visible(t, opts)).map((t) => t.name);
}

/**
 * Full Pilot tool set: read + action + ask-user. Privileged tools are
 * excluded — opt them in explicitly per agent if needed.
 */
export function pilotToolNames(opts: BundleOptions = {}): string[] {
  return ALL.filter(
    (t) =>
      (t.tier === 'read' || t.tier === 'action' || t.tier === 'ask-user') && visible(t, opts),
  ).map((t) => t.name);
}

/** Pilot + privileged. For trusted agents only. */
export function pilotToolNamesWithPrivileged(opts: BundleOptions = {}): string[] {
  return ALL.filter((t) => visible(t, opts)).map((t) => t.name);
}

/** Re-exports for callers that need the typed handler objects. */
export type { AnyToolHandler, ToolHandler };

/** Used by the catalog dump + admin debug UI. Not a hot path. */
export function listAllHandlers(): AnyToolHandler[] {
  return ALL.slice();
}
