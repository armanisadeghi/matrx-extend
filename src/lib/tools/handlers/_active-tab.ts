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
