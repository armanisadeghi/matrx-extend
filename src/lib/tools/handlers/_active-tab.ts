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
 *   - If the assigned tab was closed → fall back to the focused tab so
 *     the agent at least gets *something* and can recover gracefully.
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
      // Tab was closed (or never existed). Fall through to the focused-tab
      // fallback rather than failing the call outright — the agent gets a
      // chance to detect the URL changed and react.
    }
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

export async function getAssignedTabId(ctx: ToolContext): Promise<number | null> {
  const tab = await getAssignedTab(ctx);
  return tab?.id ?? null;
}
