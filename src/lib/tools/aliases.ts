/**
 * Tool-name forgiveness layer.
 *
 * Two failure modes this fixes:
 *
 *   1. The Supabase `public.tools` table and the extension's catalog have
 *      drifted. The DB still has an older "browser_*" naming generation
 *      (browser_click, browser_type_text, …) while the extension uses the
 *      current verb-noun naming (click_element, type_into_element, …).
 *      Until the DB is reconciled (see .research/2026-05-03-pending-fixes.md),
 *      route the legacy names to the modern handler.
 *
 *   2. The model occasionally hallucinates tool names from its
 *      training-data muscle memory (Playwright/Puppeteer/Browserbase shapes
 *      like `browser_click(selector, session_id)`). When the call shape is
 *      close enough we route it; when it isn't, we surface a structured
 *      "did you mean" so the agent can correct course on the next turn
 *      instead of getting an opaque "Browser session not found" from the
 *      server's fallback handler.
 *
 * The alias map is intentionally minimal — only add entries that the live
 * trace has actually shown the model emit. Each entry is documented with
 * the source of the confusion.
 */

/** Map of (alias name) → (canonical tool name in our registry). */
export const TOOL_NAME_ALIASES: Readonly<Record<string, string>> = {
  // --- DB drift: legacy "browser_*" generation in public.tools (May 2026) -
  browser_click: 'click_element',
  browser_close: 'close_tab',
  browser_get_element: 'query_elements',
  browser_navigate: 'navigate_active_tab',
  browser_screenshot: 'take_screenshot',
  browser_scroll: 'scroll_page',
  browser_select_option: 'select_dropdown_option',
  browser_wait_for: 'wait_for',
  browser_type_text: 'type_into_element',
  interaction_ask: 'ask_user',

  // --- Canonical (browser_tools_canonical.json) renames — pure name maps.
  // Tools that share the same call shape; we just route the new name to the
  // existing handler. Mega-tool routers (computer, form_input, navigate,
  // tabs, downloads, memory, clipboard, unified ask_user) are NOT here —
  // they require new handlers, see the migration loss list.
  evaluate_javascript: 'execute_javascript',
  upload_file: 'file_upload',
};

/**
 * Resolve a possibly-aliased tool name to its canonical form.
 * Returns the input unchanged when no alias matches.
 */
export function resolveToolName(name: string): string {
  return TOOL_NAME_ALIASES[name] ?? name;
}

/**
 * Find similar tool names for "did you mean" suggestions when neither the
 * raw name nor an alias resolves. Cheap Levenshtein-bounded match —
 * intentionally narrow so we don't suggest unrelated tools.
 */
export function suggestSimilar(name: string, knownNames: readonly string[], limit = 3): string[] {
  const lower = name.toLowerCase();
  const scored = knownNames.map((n) => ({ name: n, score: similarity(lower, n.toLowerCase()) }));
  return scored
    .filter((s) => s.score >= 0.45)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.name);
}

function similarity(a: string, b: string): number {
  // Token overlap + substring boost — good enough for short identifiers.
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.85;
  const tokensA = new Set(a.split(/[_\-]/).filter(Boolean));
  const tokensB = new Set(b.split(/[_\-]/).filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let shared = 0;
  for (const t of tokensA) if (tokensB.has(t)) shared++;
  return shared / Math.max(tokensA.size, tokensB.size);
}
