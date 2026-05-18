/**
 * Tool-name forgiveness layer.
 *
 * Three resolution stages, applied in order:
 *
 *   1. **Namespace stripping** — incoming wire names from aidream are
 *      namespaced (`matrx-extend__take_screenshot`) or bundle-aliased
 *      (`forms__fill_form`) per the matrx-extend ↔ aidream migration
 *      (docs/MATRX_EXTEND_MIGRATION_GUIDE.md). The local registry is
 *      keyed on bare names (`take_screenshot`, `fill_form`), so we strip
 *      any `<bundle>__` prefix first. The double-underscore separator is
 *      load-bearing — single `_` characters appear inside tool names
 *      (`take_screenshot`) and must NOT be split. The canonical form
 *      (`matrx-extend:take_screenshot`) is also accepted in case the `:`
 *      ↔ `__` translation hasn't run; we strip up through `:`.
 *
 *   2. **Legacy alias map** — older `public.tools` rows from before the
 *      registry redesign used different verb-noun shapes
 *      (`browser_click`, `interaction_ask`). The map below routes those
 *      to the modern handler so the agent stays functional during the
 *      reconciliation period. Each entry is documented with its source.
 *
 *   3. **Suggestion search** — when nothing matches, `suggestSimilar`
 *      offers a "did you mean" so the agent gets a useful next-turn
 *      signal instead of an opaque "Browser session not found".
 *
 * The dispatcher consumes these via `resolveToolName` (which combines
 * stages 1 and 2) and `suggestSimilar` (stage 3).
 */

/**
 * Our namespace assigned by the aidream redesign. Wire form uses `__`
 * because Anthropic/OpenAI/Gemini reject `:` in tool names; canonical
 * form uses `:`. We accept both because the `__` ↔ `:` translation can
 * happen on either side of the wire.
 */
const MATRX_EXTEND_NAMESPACE_WIRE = 'matrx-extend__';
const MATRX_EXTEND_NAMESPACE_CANONICAL = 'matrx-extend:';
const NAMESPACE_SEPARATOR_WIRE = '__';
const NAMESPACE_SEPARATOR_CANONICAL = ':';

/**
 * Strip any namespace / bundle prefix from a wire-format tool name and
 * return the bare local name our registry is keyed on.
 *
 * Cases handled:
 *   - `matrx-extend__take_screenshot` → `take_screenshot` (our namespace)
 *   - `matrx-extend:take_screenshot`  → `take_screenshot` (canonical form
 *     leaking through; should be rare but harmless to support)
 *   - `forms__fill_form`              → `fill_form` (bundle alias —
 *     after Step 2 of the registry redesign, aidream may load our tools
 *     into a different bundle namespace)
 *   - `take_screenshot`               → `take_screenshot` (no prefix —
 *     legacy callers and tests)
 *   - `browser_click`                 → `browser_click` (single `_` is
 *     NOT a separator; this is preserved verbatim and resolved later via
 *     the legacy alias map)
 *
 * The `bundle` field is informational — useful for telemetry and for the
 * dispatcher's log line so we can track which bundles are calling in.
 */
export function stripNamespace(wireName: string): { local: string; bundle: string | null } {
  // Canonical-form leak path (`<ns>:<local>`).
  const colonIdx = wireName.indexOf(NAMESPACE_SEPARATOR_CANONICAL);
  if (colonIdx > 0) {
    return {
      local: wireName.slice(colonIdx + NAMESPACE_SEPARATOR_CANONICAL.length),
      bundle: wireName.slice(0, colonIdx),
    };
  }
  // Wire-form fast path for our own namespace.
  if (wireName.startsWith(MATRX_EXTEND_NAMESPACE_WIRE)) {
    return {
      local: wireName.slice(MATRX_EXTEND_NAMESPACE_WIRE.length),
      bundle: 'matrx-extend',
    };
  }
  // Generic `<bundle>__<local>` form. Single `_` is NOT a separator —
  // tool names like `take_screenshot` must pass through unchanged.
  const sepIdx = wireName.indexOf(NAMESPACE_SEPARATOR_WIRE);
  if (sepIdx > 0) {
    return {
      local: wireName.slice(sepIdx + NAMESPACE_SEPARATOR_WIRE.length),
      bundle: wireName.slice(0, sepIdx),
    };
  }
  // Bare name — no namespace.
  return { local: wireName, bundle: null };
}

/**
 * Convert a canonical name (`matrx-extend:fill_form`) to its local
 * registry key (`fill_form`). Use this when aidream provides
 * `canonical_name` on a `tool_started` event — that's the most reliable
 * source because aidream resolved the bundle alias for us already.
 *
 * Returns the input unchanged if it doesn't look like a canonical name.
 */
export function localFromCanonical(canonicalName: string): string {
  const idx = canonicalName.indexOf(NAMESPACE_SEPARATOR_CANONICAL);
  if (idx <= 0) return canonicalName;
  return canonicalName.slice(idx + NAMESPACE_SEPARATOR_CANONICAL.length);
}

/**
 * Map of (legacy / hallucinated alias name) → (canonical local tool
 * name in our registry). Applied AFTER namespace stripping. Each entry
 * is here because the live trace has shown the model emit it; do not
 * speculate — only add what's been observed.
 */
export const TOOL_NAME_ALIASES: Readonly<Record<string, string>> = {
  // --- DB drift: legacy "browser_*" generation in public.tools ---------
  // Pre-redesign `public.tools` rows that haven't been reconciled yet.
  browser_click: 'click_element',
  browser_close: 'close_tab',
  browser_get_element: 'query_elements',
  browser_navigate: 'navigate_active_tab',
  browser_screenshot: 'take_screenshot',
  browser_scroll: 'scroll_page',
  browser_select_option: 'select_dropdown_option',
  browser_wait_for: 'wait_for',
  browser_type_text: 'type_into_element',

  // --- Canonical-shape renames (browser_tools_canonical.json) ----------
  // Tools that share the call shape with an existing handler — pure name
  // map. Mega-tool routers (computer, form_input, navigate, tabs, …) are
  // their own handlers, NOT here.
  //
  // NOTE: do NOT add `upload_file: 'file_upload'` here. `upload_file` is
  // now a first-class canonical handler (canonical.ts) with a *different*
  // call shape from `file_upload` (canonical takes `file_ids: string[]`
  // resolved via cld_files; legacy takes inline base64). Aliasing them
  // would silently mis-route depending on whether the dispatcher took the
  // canonical-name fast path — see the audit trace in
  // .research/2026-05-04-canonical-migration-losses.md.
  evaluate_javascript: 'execute_javascript',
};

/**
 * Resolve a wire-format tool name to its local registry key.
 *
 * Pipeline:
 *   1. Strip namespace / bundle prefix (`matrx-extend__`, `forms__`,
 *      `matrx-extend:`).
 *   2. Apply the legacy alias map.
 *   3. Return whatever's left.
 *
 * `bundle` is returned alongside so the dispatcher can log it.
 */
export function resolveToolName(wireName: string): { local: string; bundle: string | null } {
  const stripped = stripNamespace(wireName);
  const aliased = TOOL_NAME_ALIASES[stripped.local];
  return {
    local: aliased ?? stripped.local,
    bundle: stripped.bundle,
  };
}

/**
 * Find similar tool names for "did you mean" suggestions when neither
 * the raw name nor an alias resolves. Cheap token-overlap match —
 * intentionally narrow so we don't suggest unrelated tools.
 */
export function suggestSimilar(name: string, knownNames: readonly string[], limit = 3): string[] {
  // Strip namespace before scoring — comparing `matrx-extend__foo`
  // against bare local names tanks the similarity score.
  const stripped = stripNamespace(name).local.toLowerCase();
  const scored = knownNames.map((n) => ({ name: n, score: similarity(stripped, n.toLowerCase()) }));
  return scored
    .filter((s) => s.score >= 0.45)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.name);
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.85;
  const tokensA = new Set(a.split(/[_\-]/).filter(Boolean));
  const tokensB = new Set(b.split(/[_\-]/).filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let shared = 0;
  for (const t of tokensA) if (tokensB.has(t)) shared++;
  return shared / Math.max(tokensA.size, tokensB.size);
}
