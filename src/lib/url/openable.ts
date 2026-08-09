/**
 * "Is this string something we can put a door on?" — the shared test behind
 * the <OpenUrl> primitive.
 *
 * The No Dead Ends door law says a URL must be openable. The inverse matters
 * just as much: a string that ISN'T a reachable URL must NOT be dressed up as
 * a link, because a link that goes nowhere is a worse dead end than plain text
 * — the user spends a click to find out.
 *
 * Only `http:` / `https:` qualify. Everything else a page can put in an
 * `href` or a `<meta content>` is deliberately excluded:
 *   - `javascript:` — would execute in whatever context opened it.
 *   - `data:` / `blob:` — opaque, and a phishing vector when auto-linked from
 *     untrusted page metadata.
 *   - `mailto:` / `tel:` — real, but they hand off to an external app rather
 *     than opening a page; a tab-opening affordance is the wrong shape.
 *   - relative paths — the SEO audit already resolves `link.href` and
 *     `a.href` through the DOM, so anything still relative here came from raw
 *     `<meta content>` (e.g. a sloppy `og:image`) and has no base we can
 *     trust at render time.
 *
 * Note `new URL('javascript:void(0)')` PARSES successfully — it just has an
 * empty host. The protocol check, not the try/catch, is what does the work
 * here. Same trap the audit's link classifier had to fix.
 */
export function isOpenableUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const u = new URL(trimmed);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.host.length > 0;
  } catch {
    return false;
  }
}

/**
 * Canonical documentation URL for a schema.org type, so a bare type name like
 * `Product` becomes a door.
 *
 * The audit collects types from two sources with two shapes:
 *   - JSON-LD `@type` → a bare name (`"Recipe"`, `"BreadcrumbList"`).
 *   - microdata `itemtype` → already an absolute URL
 *     (`"https://schema.org/Product"`, sometimes `http://`).
 * Both must resolve to something openable, so an absolute value passes through
 * untouched and a bare name is appended to schema.org.
 *
 * @returns the URL, or `null` for a type we can't resolve (a namespaced
 *   vocabulary we don't host docs for, or junk) — the caller then renders a
 *   plain chip rather than a broken link.
 */
export function schemaTypeUrl(type: string): string | null {
  const t = type.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return isOpenableUrl(t) ? t : null;
  // Bare `@type` values are single tokens in practice; anything with a slash or
  // whitespace is a vocabulary path we can't map to a schema.org doc page.
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(t)) return null;
  return `https://schema.org/${t}`;
}
