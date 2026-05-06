/**
 * URL identity for matching the active tab against research-source URLs.
 *
 * Identity rules (intentionally lenient):
 *   - protocol: http and https are equivalent
 *   - host: lowercased, www.* stripped
 *   - path: trailing slash dropped (except root)
 *   - fragment: dropped
 *   - search: kept exact (?id=1 vs ?id=2 are different pages)
 *
 * The goal is to recognize "user is on this queued URL" even when the user
 * navigates a slight variant (typed http://, the page redirects to www, etc.)
 * without conflating distinct pages that happen to share a path.
 */

export function normalizeUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  try {
    const u = new URL(input);
    let host = u.host.toLowerCase();
    if (host.startsWith('www.')) host = host.slice(4);
    let path = u.pathname || '/';
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    return `${host}${path}${u.search}`;
  } catch {
    return null;
  }
}

export function urlsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeUrl(a);
  const nb = normalizeUrl(b);
  return na !== null && nb !== null && na === nb;
}
