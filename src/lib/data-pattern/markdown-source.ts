/**
 * Markdown-source detection + candidate resolution for the "Markdown" capture
 * mode. Many docs platforms (devsite, Mintlify, Docusaurus, GitBook) and the
 * emerging `llms.txt` standard publish a clean, LLM-ready Markdown rendering of
 * a page. When one exists it is the single best capture: no selectors, no
 * table fiddling, just the document.
 *
 * The in-page probe reports only cheap, synchronous signals (DOM/head). The
 * ordered candidate URLs are then fetched extension-side (host permissions
 * bypass CORS), confirming each with a content-type / body sniff. Splitting the
 * pure logic out here keeps it unit-testable without a browser.
 */

/** Cheap, synchronous signals readable inside the page (no network). */
export interface MarkdownSignals {
  /** `<link rel="alternate" type="text/markdown" href>` in <head>, if any. */
  alt_href: string | null;
  /** An on-page "Copy/Open/View as Markdown" affordance's href, if any. */
  affordance_href: string | null;
  /** Whether such an affordance exists even without a direct href. */
  has_affordance: boolean;
}

/**
 * Self-contained: runs across the chrome.scripting boundary. Returns the
 * page's declared/affordance Markdown signals. Absolute URLs.
 */
export function detectMarkdownSignalsInPage(): MarkdownSignals {
  const abs = (href: string | null | undefined): string | null => {
    if (!href) return null;
    try {
      return new URL(href, document.baseURI).href;
    } catch {
      return null;
    }
  };

  let altHref: string | null = null;
  for (const link of Array.from(
    document.querySelectorAll<HTMLLinkElement>('link[rel~="alternate"]'),
  )) {
    const type = (link.getAttribute('type') ?? '').toLowerCase();
    if (type === 'text/markdown' || type === 'text/x-markdown') {
      altHref = abs(link.getAttribute('href'));
      if (altHref) break;
    }
  }

  // On-page affordance: a link/button whose text advertises a Markdown view.
  // Match the common phrasings without naming any vendor.
  const AFFORDANCE_RE =
    /\b(?:copy|open|view|read|get)\s+(?:this\s+)?(?:page\s+)?(?:as|in)\s+markdown\b|\bview\s+as\s+\.md\b|\bmarkdown\s+version\b/i;
  let affordanceHref: string | null = null;
  let hasAffordance = false;
  const clickable = Array.from(
    document.querySelectorAll<HTMLElement>('a[href], button, [role="button"]'),
  ).slice(0, 400);
  for (const el of clickable) {
    const label = `${el.getAttribute('aria-label') ?? ''} ${el.textContent ?? ''}`.trim();
    if (!label || !AFFORDANCE_RE.test(label)) continue;
    hasAffordance = true;
    const href = el.getAttribute('href');
    if (href) {
      affordanceHref = abs(href);
      if (affordanceHref) break;
    }
  }

  return { alt_href: altHref, affordance_href: affordanceHref, has_affordance: hasAffordance };
}

/**
 * Pure: given the current page URL and any in-page signals, produce the ordered
 * list of candidate Markdown URLs to try. Cheapest / most-authoritative first:
 *   1. declared `<link rel=alternate type=text/markdown>`
 *   2. an on-page affordance href
 *   3. sibling `<url>.md` (and `<url>/index.md` for a directory-style URL)
 *   4. `/llms-full.txt` then `/llms.txt` at the site root (emerging standard)
 * The original URL (for Accept: text/markdown content-negotiation) is returned
 * separately since it reuses the same address with a different header.
 */
export function candidateMarkdownUrls(pageUrl: string, signals: MarkdownSignals): string[] {
  const out: string[] = [];
  const push = (u: string | null | undefined) => {
    if (u && !out.includes(u)) out.push(u);
  };

  push(signals.alt_href);
  push(signals.affordance_href);

  let url: URL | null = null;
  try {
    url = new URL(pageUrl);
  } catch {
    url = null;
  }
  if (url && (url.protocol === 'http:' || url.protocol === 'https:')) {
    const path = url.pathname;
    const isDocLike = !/\.[a-z0-9]{1,5}$/i.test(path); // no file extension already
    if (!/\.md$/i.test(path)) {
      if (path.endsWith('/')) {
        push(new URL(`${path}index.md`, url.origin).href);
        push(new URL(`${path.replace(/\/$/, '')}.md`, url.origin).href);
      } else if (isDocLike) {
        push(new URL(`${path}.md`, url.origin).href);
        push(new URL(`${path}/index.md`, url.origin).href);
      }
    } else {
      push(url.href);
    }
    push(new URL('/llms-full.txt', url.origin).href);
    push(new URL('/llms.txt', url.origin).href);
  }

  return out;
}

/** The original page URL, for an `Accept: text/markdown` content-negotiation try. */
export function contentNegotiationUrl(pageUrl: string): string | null {
  try {
    const u = new URL(pageUrl);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * Pure heuristic: does this response body look like real Markdown (and not an
 * HTML error page a server returned with a 200)? A trusted content-type short-
 * circuits to true; otherwise we require markdown-ish structure and the absence
 * of a leading HTML document.
 */
export function looksLikeMarkdown(body: string, contentType?: string | null): boolean {
  const ct = (contentType ?? '').toLowerCase();
  const trimmed = body.trimStart();
  if (!trimmed) return false;
  // A real HTML document is never Markdown even at content-type text/markdown
  // would be a lie — guard the common "200 OK but HTML" case.
  if (/^<(?:!doctype html|html|head|body|\?xml)\b/i.test(trimmed)) return false;
  if (ct.includes('text/markdown') || ct.includes('text/x-markdown')) return true;
  if (ct.includes('text/html')) return false;
  // text/plain or unknown: require markdown structure in the first chunk.
  const head = trimmed.slice(0, 4000);
  const signals = [
    /^#{1,6}\s+\S/m, // ATX heading
    /^\s*[-*+]\s+\S/m, // bullet list
    /^\s*\d+\.\s+\S/m, // ordered list
    /\[[^\]]+\]\([^)]+\)/, // link
    /^```/m, // fenced code
    /^\s*>\s+\S/m, // blockquote
    /^\|.+\|\s*$/m, // table row
  ].reduce((n, re) => n + (re.test(head) ? 1 : 0), 0);
  return signals >= 2;
}
