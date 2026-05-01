/**
 * Central tool registry. The chat composer reads `assistantToolNames()` or
 * `pilotToolNames()` and ships those names to the agent. The SW dispatcher
 * reads `lookup(name)` when a tool_started event arrives.
 *
 * Surface bundles:
 *   - assistantToolNames()  — read-only only. Safe for the conversational
 *     "Chat" surface where the agent answers questions about what the user
 *     is looking at without changing anything.
 *   - pilotToolNames()      — full kit: read + action + ask-user. Used on
 *     the Pilot surface where the agent drives the browser. Privileged
 *     tools are NOT in this set by default — opt them in per agent.
 *   - allToolNames()        — every registered tool, including privileged.
 *     Use only for trusted agents the user has explicitly granted full
 *     access to.
 *
 * Admin filtering:
 *   - Each bundle accepts an `{ isAdmin? }` option. Non-admins never see
 *     `admin_only: true` tools advertised to their agents. The Tools tab
 *     shows them with a badge for admins.
 */

import { action_handlers } from '@/lib/tools/handlers/action';
import { browser_data_handlers } from '@/lib/tools/handlers/browser-data';
import { cdp_handlers } from '@/lib/tools/handlers/cdp';
import { download_handlers } from '@/lib/tools/handlers/downloads';
import { form_action_handlers, form_read_handlers } from '@/lib/tools/handlers/forms';
import { inspect_handlers } from '@/lib/tools/handlers/inspect';
import { keyboard_handlers } from '@/lib/tools/handlers/keyboard';
import { onbox_ai_handlers } from '@/lib/tools/handlers/onbox-ai';
import {
  cookies_handlers,
  pagecapture_handlers,
  sessions_handlers,
} from '@/lib/tools/handlers/optional-perms';
import { privileged_handlers, privileged_read_handlers } from '@/lib/tools/handlers/privileged';
import { read_handlers } from '@/lib/tools/handlers/read';
import { tab_action_handlers, tab_read_handlers } from '@/lib/tools/handlers/tabs';
import { user_handlers } from '@/lib/tools/handlers/user';
import { webmcp_handlers } from '@/lib/tools/handlers/webmcp';
import type { AnyToolHandler, ToolHandler } from '@/lib/tools/types';

const ALL: AnyToolHandler[] = [
  // Page reads
  ...read_handlers,
  ...inspect_handlers,
  // Browser-level reads
  ...tab_read_handlers,
  ...browser_data_handlers,
  // Form discovery (read tier)
  ...form_read_handlers,
  // Privileged reads (agent storage inspection)
  ...privileged_read_handlers,
  // On-device AI (free, on-device, all read tier)
  ...onbox_ai_handlers,
  // Page actions
  ...action_handlers,
  ...keyboard_handlers,
  ...form_action_handlers,
  // Browser-level actions
  ...tab_action_handlers,
  ...download_handlers,
  // Optional-permission tools (sessions: read+action, cookies+pageCapture+CDP: admin/privileged)
  ...sessions_handlers,
  ...pagecapture_handlers,
  ...cookies_handlers,
  ...cdp_handlers,
  // WebMCP (page-tool interop)
  ...webmcp_handlers,
  // Ask-user
  ...user_handlers,
  // Privileged
  ...privileged_handlers,
] as AnyToolHandler[];

const BY_NAME = new Map<string, AnyToolHandler>();
for (const t of ALL) BY_NAME.set(t.name, t);

export function lookup(name: string): AnyToolHandler | undefined {
  return BY_NAME.get(name);
}

interface BundleOptions {
  /** Include `admin_only` tools. Default false. */
  isAdmin?: boolean;
}

function visible(t: AnyToolHandler, opts: BundleOptions): boolean {
  return opts.isAdmin ? true : !t.admin_only;
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
