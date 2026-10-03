/**
 * Active-tab resolution for handlers.
 *
 * Use these helpers — never call `chrome.tabs.query({active: true,
 * currentWindow: true})` directly from a handler. The agent has an
 * `assignedTabId` latched at message-send time; if a handler ignores it
 * and asks Chrome for "the active tab," the user switching tabs
 * mid-execution silently redirects tool calls onto the wrong page.
 *
 * Contract:
 *   - If `ctx.assignedTabId` is set AND the tab still exists → return it.
 *   - If the assigned tab was closed → return null. A latched request must
 *     never drift to whichever page the user focused later.
 *   - If `ctx.assignedTabId` is null (e.g. handler invoked from the
 *     Tools-tab "Run" button before any stream is open) → return the
 *     focused tab.
 *
 * This file is intentionally tiny and dependency-free so every handler
 * can import it without circular-import risk.
 */

import type { ToolContext } from '@/lib/tools/types';

export async function getAssignedTab(ctx: ToolContext): Promise<chrome.tabs.Tab | null> {
  if (ctx.assignedTabId != null) {
    try {
      const tab = await chrome.tabs.get(ctx.assignedTabId);
      if (tab) return tab;
    } catch {
      return null;
    }
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

export async function getAssignedTabId(ctx: ToolContext): Promise<number | null> {
  const tab = await getAssignedTab(ctx);
  return tab?.id ?? null;
}

/**
 * The ONE parse of a public `tab_id` arg. Canonical-shape tools declare `tab_id` as a
 * string while chrome.* wants an int; hand-rolled `args.tab_id ?? parseInt(...)` chains
 * let the raw string through (Number.isFinite('123') is false → "No active tab").
 * Accepts an int or a digit string; absent/empty → null (caller falls back to the
 * assigned tab); anything else is refused by name.
 */
export function parseTabIdArg(
  raw: string | number | null | undefined,
): { ok: true; id: number | null } | { ok: false; reason: string } {
  if (raw == null || raw === '') return { ok: true, id: null };
  if (typeof raw === 'number')
    return Number.isInteger(raw) && raw >= 0
      ? { ok: true, id: raw }
      : { ok: false, reason: `Invalid tab_id: ${raw}` };
  const s = raw.trim();
  if (/^\d+$/.test(s)) return { ok: true, id: Number(s) };
  return { ok: false, reason: `Invalid tab_id: ${raw}` };
}

/** `tab_id` when given (parsed once by parseTabIdArg), else the assigned tab. */
export async function resolveTabIdArg(
  raw: string | number | null | undefined,
  ctx: ToolContext,
): Promise<{ ok: true; id: number } | { ok: false; reason: string }> {
  const parsed = parseTabIdArg(raw);
  if (!parsed.ok) return parsed;
  const id = parsed.id ?? (await getAssignedTabId(ctx));
  return id == null ? { ok: false, reason: 'No active tab' } : { ok: true, id };
}
