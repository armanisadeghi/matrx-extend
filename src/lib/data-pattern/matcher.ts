import type { ExtractionPattern } from '@/lib/supabase/queries';

/**
 * Returns true if the URL falls within the pattern's scope.
 * Domain match is exact (host); route_pattern is a glob/regex.
 */
export function urlMatchesPattern(url: string, pattern: ExtractionPattern): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.host !== pattern.domain) return false;
  if (!pattern.route_pattern) return true;
  return matchRoute(u.pathname, pattern.route_pattern);
}

function matchRoute(pathname: string, expr: string): boolean {
  // Glob-style: '*' matches a single path segment, '**' matches across segments
  if (expr.startsWith('/^') && expr.endsWith('$/')) {
    try {
      return new RegExp(expr.slice(2, -2)).test(pathname);
    } catch {
      return false;
    }
  }
  // Use a placeholder for ** to keep it safe from the * replacement.
  const DOUBLE_STAR = 'DS';
  const re = new RegExp(
    `^${expr
      .replace(/\*\*/g, DOUBLE_STAR)
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '[^/]*')
      .replace(new RegExp(DOUBLE_STAR, 'g'), '.*')}$`,
  );
  return re.test(pathname);
}

export function findFirstMatch<T extends ExtractionPattern>(url: string, patterns: T[]): T | null {
  return patterns.find((p) => urlMatchesPattern(url, p)) ?? null;
}
