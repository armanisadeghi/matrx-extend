/**
 * "Did you mean…" suggestion helper for unknown tool names.
 *
 * When the model emits a tool name the dispatcher can't resolve (typo,
 * hallucination, or a category the agent forgot to load via
 * `list_chrome_categories`), we feed back a short list of similar known names
 * so the next turn has a useful signal. This is pure UX — it has nothing
 * to do with namespace resolution. (Per the 2026-05-27 refactor, tool
 * names are bare and the dispatcher does a direct registry lookup — no
 * prefix stripping, no alias table; an unknown name is a real error, not
 * a name to translate.)
 */

export function suggestSimilar(name: string, knownNames: readonly string[], limit = 3): string[] {
  const needle = name.toLowerCase();
  const scored = knownNames.map((n) => ({
    name: n,
    score: similarity(needle, n.toLowerCase()),
  }));
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
