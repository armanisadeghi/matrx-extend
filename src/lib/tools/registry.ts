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

import { isBrowserSupported } from '@/lib/browser/detect';
import { CATEGORIES, type ToolCategory, categoryOf, toolsInCategory } from '@/lib/tools/categories';
import { action_handlers } from '@/lib/tools/handlers/action';
import { batch_handlers } from '@/lib/tools/handlers/batch';
import { browser_data_handlers } from '@/lib/tools/handlers/browser-data';
import { canonical_handlers } from '@/lib/tools/handlers/canonical';
import { canonical_merger_handlers } from '@/lib/tools/handlers/canonical-mergers';
import { cdp_handlers } from '@/lib/tools/handlers/cdp';
import { credential_handlers } from '@/lib/tools/handlers/credential-login';
import { data_pattern_handlers } from '@/lib/tools/handlers/data-patterns';
import { demo_handlers } from '@/lib/tools/handlers/demos';
import { discover_handlers } from '@/lib/tools/handlers/discover';
import { download_handlers } from '@/lib/tools/handlers/downloads';
import { education_handlers } from '@/lib/tools/handlers/education';
import { extract_handlers } from '@/lib/tools/handlers/extract';
import { extras_handlers } from '@/lib/tools/handlers/extras';
import { fetch_handlers } from '@/lib/tools/handlers/fetch';
import { form_action_handlers, form_read_handlers } from '@/lib/tools/handlers/forms';
import { google_handlers } from '@/lib/tools/handlers/google-email-send';
import { guidance_handlers } from '@/lib/tools/handlers/guidance';
import { highlight_handlers } from '@/lib/tools/handlers/highlights';
import { inspect_handlers } from '@/lib/tools/handlers/inspect';
import { keyboard_handlers } from '@/lib/tools/handlers/keyboard';
import { lists_handlers } from '@/lib/tools/handlers/lists';
import { memory_handlers } from '@/lib/tools/handlers/memory';
import { microdata_handlers } from '@/lib/tools/handlers/microdata';
import { onbox_ai_handlers } from '@/lib/tools/handlers/onbox-ai';
import {
  cookies_handlers,
  pagecapture_handlers,
  sessions_handlers,
} from '@/lib/tools/handlers/optional-perms';
import { page_ref_handlers } from '@/lib/tools/handlers/page-refs';
import { parallel_handlers } from '@/lib/tools/handlers/parallel';
import { privileged_handlers, privileged_read_handlers } from '@/lib/tools/handlers/privileged';
import { prospect_handlers } from '@/lib/tools/handlers/prospects';
import { read_handlers } from '@/lib/tools/handlers/read';
import { record_handlers } from '@/lib/tools/handlers/record';
import { tab_action_handlers, tab_read_handlers } from '@/lib/tools/handlers/tabs';
import { user_handlers } from '@/lib/tools/handlers/user';
import { video_handlers } from '@/lib/tools/handlers/video';
import { webmcp_handlers } from '@/lib/tools/handlers/webmcp';
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
  // ─── vault browser login (agent never sees the credential) ─────────────
  ...credential_handlers,
  // ─── crm capture (IC-10 — the one prospect import path) ────────────────
  ...prospect_handlers,
  // ─── education capture (IC-11 — the one deck import door) ──────────────
  ...education_handlers,
  // ─── google workspace (the reviewed Gmail send — client-only BY DESIGN) ─
  ...google_handlers,
  // ─── memory ────────────────────────────────────────────────────────────
  ...memory_handlers,
  // ─── optional-permission tools ─────────────────────────────────────────
  ...sessions_handlers,
  ...pagecapture_handlers,
  ...cookies_handlers,
  ...cdp_handlers,
  // ─── system / DNR diagnostics (admin) ──────────────────────────────────
  // ─── webmcp ────────────────────────────────────────────────────────────
  ...webmcp_handlers,
  // ─── ask-user ──────────────────────────────────────────────────────────
  ...user_handlers,
  // ─── plan / user_todos (tasks executes natively in aidream) ───────────
  ...lists_handlers,
  // ─── privileged ────────────────────────────────────────────────────────
  ...privileged_handlers,
  // ─── parallel orchestration (CLAUDE.md item #6) ────────────────────────
  ...parallel_handlers,
  // ─── recording ─────────────────────────────────────────────────────────
  ...record_handlers,
  // ─── tab video recording (TASK-003) ───────────────────────────────────
  ...video_handlers,
  // ─── demos (record & replay) ───────────────────────────────────────────
  ...demo_handlers,
  // ─── guidance (user-saved clues for the agent) ─────────────────────────
  ...guidance_handlers,
  // ─── highlights (user-captured page text + elements) ───────────────────
  ...highlight_handlers,
  // ─── focused extractors (table, region screenshot) ─────────────────────
  ...extract_handlers,
  // ─── small utilities (clipboard, audio inspect, mutation watch) ────────
  ...extras_handlers,
  // ─── structured-data extractor (shares modes with Showcase tab) ────────
  ...microdata_handlers,
  // Saved extraction patterns (Showcase/Data cross-working)
  ...data_pattern_handlers,
  // ─── URL fetch + parse → markdown (shares scrape pipeline) ─────────────
  ...fetch_handlers,
  // ─── canonical routers ─────────────────────────────────────────────────
  // Registered LAST so canonical names (`wait_for`, etc.) win over any
  // legacy handler with the same name — last-write-wins in BY_NAME.
  ...canonical_handlers,
  // ─── canonical merger routers (2nd wave 2026-05-05) ────────────────────
  // ai / cookies / webmcp / storage / tab_groups / bookmarks / history /
  // recently_closed / stylesheet / cdp_session / cdp_emulate / evaluate_javascript
  ...canonical_merger_handlers,
] as AnyToolHandler[];

/**
 * Names where last-write-wins shadowing is INTENTIONAL — a canonical router
 * deliberately replaces a legacy handler of the same name. Anything else
 * colliding is a bug (two handlers accidentally sharing a name silently
 * dropped one with zero signal — audit P3-10).
 */
const INTENTIONAL_SHADOWS = new Set(['wait_for']);

const BY_NAME = new Map<string, AnyToolHandler>();
for (const t of ALL) {
  if (BY_NAME.has(t.name) && !INTENTIONAL_SHADOWS.has(t.name)) {
    // Warn loudly — don't throw; a broken registry at SW boot is worse
    // than a shadowed tool.
    console.warn(
      `[matrx-extend] duplicate tool name '${t.name}' in registry — later registration wins`,
    );
  }
  BY_NAME.set(t.name, t);
}

export function lookup(name: string): AnyToolHandler | undefined {
  return BY_NAME.get(name);
}

interface BundleOptions {
  isAdmin?: boolean;
}

function visible(t: AnyToolHandler, opts: BundleOptions): boolean {
  // Drop tools that don't support the current browser. The check defaults
  // to "all browsers" when supportedBrowsers is omitted.
  if (!isBrowserSupported(t.supportedBrowsers)) return false;
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
  const out = ALL.filter((t) => categoryOf(t.name) === 'core' && visible(t, opts)).map(
    (t) => t.name,
  );
  // Add the per-category discovery tools so the agent can ask for any
  // category by name.
  for (const cat of Object.values(CATEGORIES)) {
    if (cat.admin_only && !opts.isAdmin) continue;
    if (!out.includes(cat.list_tool_name)) out.push(cat.list_tool_name);
  }
  return out;
}

/** Tool names in a specific category (used by the server for dynamic registration). */
export function categoryToolNames(category: ToolCategory, opts: BundleOptions = {}): string[] {
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
    (t) => (t.tier === 'read' || t.tier === 'action' || t.tier === 'ask-user') && visible(t, opts),
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
