/**
 * Context-match trigger evaluation.
 *
 * A `context-match` agenda task fires when the user's ACTIVE tab matches the
 * task's `trigger_config` — e.g. "whenever I'm on a GitHub PR" or "whenever I
 * open Gmail". Unlike clock triggers it has no `next_due_at`; the scanner
 * fetches these tasks (listContextMatchTasks) and runs them through this
 * evaluator against the current tab on every scan.
 *
 * Evaluable from the service worker (no page probe needed):
 *   - `hostname`    — case-insensitive substring of the tab's hostname.
 *   - `url_pattern` — JavaScript regex tested against the full tab URL.
 * The optional `kind` (page_brief.kind) would require a DOM probe the SW
 * can't cheaply do; it is ignored here. The create form requires at least one
 * of hostname / url_pattern, so a task always has an SW-evaluable condition.
 *
 * Cooldown: while the user lingers on a matching page the scan runs every
 * minute, so we rate-limit each task to one fire per COOLDOWN_MS using its
 * `last_run_at`. That turns "I'm on a PR" into "fire ~once", not "fire every
 * minute forever".
 */

import type { AgendaTask, TriggerConfig } from './queries';

export const CONTEXT_MATCH_COOLDOWN_MS = 10 * 60_000;

interface ActiveTabInfo {
  url: string;
  hostname: string;
}

/** Pull the SW-evaluable fields out of a context-match trigger config. */
function asContextMatch(
  config: Record<string, unknown> | TriggerConfig,
): { hostname?: string; url_pattern?: string } | null {
  const c = config as { type?: string; hostname?: unknown; url_pattern?: unknown };
  const hostname = typeof c.hostname === 'string' ? c.hostname : undefined;
  const url_pattern = typeof c.url_pattern === 'string' ? c.url_pattern : undefined;
  if (!hostname && !url_pattern) return null;
  return { hostname, url_pattern };
}

/**
 * True if `tab` satisfies the task's context-match conditions. When multiple
 * conditions are set, ALL must match (AND). A malformed regex never matches
 * (and never throws).
 */
export function tabMatchesTask(task: AgendaTask, tab: ActiveTabInfo): boolean {
  const cfg = asContextMatch({ type: 'context-match', ...task.trigger_config });
  if (!cfg) return false;
  if (cfg.hostname && !tab.hostname.toLowerCase().includes(cfg.hostname.toLowerCase())) {
    return false;
  }
  if (cfg.url_pattern) {
    try {
      if (!new RegExp(cfg.url_pattern).test(tab.url)) return false;
    } catch {
      return false; // invalid regex → never matches
    }
  }
  return true;
}

/** True if enough time has elapsed since the task last fired to fire again. */
export function cooldownElapsed(task: AgendaTask, now = Date.now()): boolean {
  if (!task.last_run_at) return true;
  const last = Date.parse(task.last_run_at);
  if (!Number.isFinite(last)) return true;
  return now - last >= CONTEXT_MATCH_COOLDOWN_MS;
}
