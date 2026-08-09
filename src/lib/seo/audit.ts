/**
 * SEO audit collector. Runs in a content script via chrome.scripting.executeScript
 * (or in the main thread of the side panel against an offscreen DOMParser
 * snapshot). Output is JSON-LD-ish — easy to display, easy to ship to backend.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ DELIBERATE SECOND IMPLEMENTATION — read before "unifying" this away.
 * ─────────────────────────────────────────────────────────────────────────────
 * The canonical single-page auditor is
 * `aidream/packages/matrx-scraper/matrx_scraper/seo_audit.py::audit_html`,
 * exposed at `POST /seo/public/page-audit`. This file is NOT a competing
 * feature — it is the LIVE-DOM mirror of it, in the same spirit as
 * matrx-frontend's `features/seo/audit/` mirroring `audit_metrics.py`.
 *
 * WHY IT EXISTS (the server physically cannot produce this result):
 *   - `audit_html(html, url)` audits HTML the SERVER fetched. This audits the
 *     DOM the USER is looking at — post-JS, post-hydration. On an SPA the
 *     server's fetch sees an empty shell; we see the rendered page.
 *   - Signed-in, paywalled, cookie-walled, `localhost`, and intranet pages are
 *     reachable only from the user's own browser session.
 *   - It is instant, free, and works offline. `/seo/public/page-audit` is a
 *     streaming, spend-metered, network round trip; the SEO tab auto-runs on
 *     every navigation.
 *   - `performance.*` (nav timing, transfer size) exists only in the browser.
 *
 * THE RULE: every threshold, formula, and counting rule below is a MIRROR of
 * the Python. They are named in CANONICAL_* / the comments with their source
 * line of reasoning. **Change one → change the other in the same unit of
 * work.** Divergences here are not stylistic; they silently produce different
 * numbers for the same page and both get persisted (this file's output is
 * saved to `extend.wbx_seo_audit` and copied into agent context).
 *
 * THE RULE IS MECHANICALLY ENFORCED. `tests/unit/seo-audit-fixture-parity.test.ts`
 * replays `tests/fixtures/seo-audit-parity.json` — HTML fixtures and the answers
 * the PYTHON produced for them — through `runAudit` and demands identical output.
 * A red test means one side changed without the other. Fix BOTH, then regenerate:
 *
 *   cd /Users/armanisadeghi/code/aidream
 *   .venv/bin/python packages/matrx-scraper/scripts/generate_seo_audit_parity_fixture.py
 *
 * (That generator writes the fixture into BOTH repos. Add a case there, not here,
 * when you add a counting rule.) The sibling `tests/unit/seo-audit-parity.test.ts`
 * pins the same rules in prose — it explains, this one proves; keep both.
 *
 * KNOWN, DELIBERATE DIFFERENCES the fixture does not paper over:
 *   - Text metrics (`word_count`, `sentence_count`, `flesch_reading_ease`)
 *     against a LIVE tab read `body.innerText` — rendered text, which honours
 *     `display:none` and CSS-generated content. The server reads the parsed
 *     text of the HTML it fetched. On a hidden-nav page or an SPA these
 *     legitimately differ; that difference is why this file exists. The fixture
 *     compares the COUNTING RULES on parsed text, which is what can drift.
 *   - `canonical` and `hreflang[].href` are read via the DOM `.href` property,
 *     which RESOLVES against the document base; the Python returns the RAW
 *     `href` attribute. A relative `<link rel="canonical" href="/other">` is
 *     therefore `https://…/other` here and `/other` there. Fixtures use
 *     absolute hrefs. This one is a genuine open divergence, not a design
 *     choice — resolving is the more useful value, and the server's raw string
 *     also reaches `evaluate_indexability`'s declared-vs-final comparison.
 *
 * Fields are named for the extension's own display shape rather than the
 * server's flat one. The mapping is 1:1:
 *   title.value/length   ← title / title_length
 *   description.*        ← meta_description / meta_description_length
 *   links.internal/external ← internal_links / external_links
 *   images.total/missing_alt ← images_total / images_missing_alt
 * Everything else shares the server's name. We deliberately do NOT compute the
 * server's crawl-only fields (link graph, resources, mixed content, content
 * fingerprint, page identity) — those need a crawl, not a tab.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * COLLECTED FOR THE DETERMINISTIC EVALUATORS (2026-08-09)
 * ─────────────────────────────────────────────────────────────────────────────
 * `src/lib/seo/evaluators/` is a byte-parity mirror of
 * `matrx_scraper/audit_metrics.py`. `evaluate_indexability` needs two inputs
 * this file did not collect, so they were ADDED here rather than faked at the
 * mapping layer (`evaluators/from-audit.ts`):
 *   performance.http_status    ← the server's `http_status`. Read from
 *     `PerformanceNavigationTiming.responseStatus`. `0`/absent means the
 *     browser did not expose it (cross-origin without Timing-Allow-Origin,
 *     same-document navigation, older Chrome) and is normalized to `null`,
 *     which the evaluator reports as "HTTP status was not captured". We never
 *     invent a 200.
 *   performance.redirect_count ← the hop count behind the server's
 *     `redirect_chain`. Read from `PerformanceNavigationTiming.redirectCount`.
 *     The browser exposes the COUNT but not the intermediate URLs, and it
 *     reports 0 for cross-origin redirects without Timing-Allow-Origin — so
 *     this under-reports rather than over-reports, and never invents a hop.
 *
 * Both live under `performance` because both come from navigation timing, and
 * that whole block is now gated on `doc === globalThis.document`. Reading the
 * ambient `performance` while auditing a DOMParser-parsed Document (the
 * fetch-and-parse path) describes the OFFSCREEN page, not the audited URL —
 * harmless noise for `nav_type`/`duration_ms`, but it would have made
 * `http_status` assert a verdict about the wrong document.
 */

/**
 * Mirrored from `matrx_scraper/seo_audit.py`. Do not tune independently.
 */
const CANONICAL = {
  /** `if len(headings) >= 200: break` */
  HEADING_LIMIT: 200,
  /** `_FLESCH_DB_MIN` / `_FLESCH_DB_MAX` — the DB column's numeric range. */
  FLESCH_MIN: -999.99,
  FLESCH_MAX: 999.99,
} as const;

export interface SeoAudit {
  url: string;
  fetched_at: number;
  title: { value: string; length: number };
  description: { value: string | null; length: number };
  canonical: string | null;
  robots: string | null;
  /** `<html lang>` — server field `lang`. */
  lang: string | null;
  hreflang: { lang: string; href: string }[];
  og: Record<string, string>;
  twitter: Record<string, string>;
  schema_types: string[];
  headings: { level: number; text: string }[];
  links: { internal: number; external: number };
  images: { total: number; missing_alt: number };
  word_count: number;
  /** Server field `sentence_count` — the Flesch denominator, kept so a score can be re-derived. */
  sentence_count: number;
  flesch_reading_ease: number | null;
  performance: {
    nav_type: string | null;
    duration_ms: number | null;
    transfer_size_bytes: number | null;
    /** Server field `http_status`. null = the browser did not expose it. */
    http_status: number | null;
    /** Hop count behind the server's `redirect_chain`. null = not exposed. */
    redirect_count: number | null;
  };
}

/**
 * @param baseUrl The page's resolved final URL. Equivalent to the server's
 *   `audit_html(html, base_url)` argument, and required for the same reason:
 *   a DOMParser-parsed Document (the fetch-and-parse path) has NO usable
 *   document URL in Chrome — `doc.location` is null — so without it `host` was
 *   empty and every link on a fetched page counted as external. A content
 *   script omits it; the live document already knows where it is.
 */
export function runAudit(doc: Document = document, baseUrl?: string): SeoAudit {
  const url = baseUrl ?? doc.location?.href ?? doc.baseURI ?? '';
  const titleEl = doc.querySelector<HTMLTitleElement>('title');
  // Mirror of `title_node.text(...).strip()`. Untrimmed, a title indented in
  // the source (`<title>\n  Page\n</title>`) reported a length several
  // characters longer than the server's for the same page — and title_length
  // is exactly what the SERP-truncation checks read.
  const titleText = (titleEl?.textContent ?? doc.title ?? '').trim();
  const description =
    doc.querySelector<HTMLMetaElement>('meta[name="description"]')?.content ?? null;
  const canonical = doc.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? null;
  const robots = doc.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content ?? null;

  const hreflang = Array.from(
    doc.querySelectorAll<HTMLLinkElement>('link[rel="alternate"][hreflang]'),
  ).map((l) => ({ lang: l.hreflang, href: l.href }));

  const og: Record<string, string> = {};
  const twitter: Record<string, string> = {};
  doc.querySelectorAll<HTMLMetaElement>('meta').forEach((m) => {
    const property = m.getAttribute('property') ?? '';
    const name = m.getAttribute('name') ?? '';
    const content = m.getAttribute('content') ?? '';
    if (!content) return;
    if (property.startsWith('og:')) og[property] = content;
    if (name.startsWith('twitter:')) twitter[name] = content;
  });

  const schema_types = collectSchemaTypes(doc);

  // Mirror of the Python loop: skip empty-text headings, THEN cap at 200.
  // Slicing after mapping let blank <h_> wrappers (common in card grids) eat
  // the 200 slots and inflate `headings.length` past the server's count.
  const headings: { level: number; text: string }[] = [];
  for (const h of doc.querySelectorAll<HTMLHeadingElement>('h1, h2, h3, h4, h5, h6')) {
    const text = (h.textContent ?? '').trim();
    if (!text) continue;
    headings.push({ level: Number(h.tagName.slice(1)), text });
    if (headings.length >= CANONICAL.HEADING_LIMIT) break;
  }

  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return '';
    }
  })();
  let internal = 0;
  let external = 0;
  doc.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
    const href = a.getAttribute('href');
    if (!href) return;
    let u: URL;
    try {
      u = new URL(href, url);
    } catch {
      return;
    }
    // Mirror: `if not host or not u.startswith(("http://", "https://")): continue`.
    // `new URL('javascript:void(0)')` PARSES — it just has an empty host — so
    // the old exception-only guard counted every JS/mailto/tel link as
    // external. Subdomains count as external on both sides (the Python tags
    // them link_type="subdomain" but still does `external += 1`).
    if (!u.host || (u.protocol !== 'http:' && u.protocol !== 'https:')) return;
    if (u.host.toLowerCase() === host.toLowerCase()) internal++;
    else external++;
  });

  const imgs = Array.from(doc.querySelectorAll<HTMLImageElement>('img'));
  const missing_alt = imgs.filter((i) => !i.alt || i.alt.trim().length === 0).length;

  // `innerText` is layout-dependent and returns '' on a non-rendered
  // DOMParser Document (the fetch-and-parse path), which zeroed word_count
  // and nulled the Flesch score for every fetched URL. textContent is the
  // fallback — it is also what the server's parser sees.
  const rawText = doc.body?.innerText || doc.body?.textContent || '';
  const text = rawText.replace(/\s+/g, ' ').trim();
  const word_count = text ? text.split(/\s+/).length : 0;
  // Mirror of `sentences = re.split(r"[.!?]+\s+", text)` → count of non-empty
  // pieces. Counting DELIMITERS instead (the old `match(/[.!?]+\s/g).length`)
  // is off by one on every page — it misses the final sentence, which has no
  // trailing whitespace after the `\s+`-collapse above. That fed straight into
  // the Flesch denominator, so extension and server scored the same page
  // differently.
  const sentence_count = text ? text.split(/[.!?]+\s+/).filter((s) => s.trim()).length : 0;
  const flesch = fleschReadingEase(text, word_count, sentence_count);

  const nav = navigationTimingFor(doc);
  return {
    url,
    fetched_at: Date.now(),
    title: { value: titleText, length: titleText.length },
    description: { value: description, length: description?.length ?? 0 },
    canonical,
    robots,
    lang: doc.documentElement.lang || null,
    hreflang,
    og,
    twitter,
    schema_types,
    headings,
    links: { internal, external },
    images: { total: imgs.length, missing_alt },
    word_count,
    sentence_count,
    flesch_reading_ease: flesch,
    performance: {
      nav_type: nav?.type ?? null,
      duration_ms: nav?.duration ? Math.round(nav.duration) : null,
      transfer_size_bytes: nav?.transferSize ?? null,
      // `0` is the spec's "not available" value for both, not a real status /
      // a real hop count — normalize it to null so the evaluator says
      // "not captured" instead of asserting a wrong verdict.
      http_status: nav?.responseStatus ? nav.responseStatus : null,
      redirect_count: typeof nav?.redirectCount === 'number' ? nav.redirectCount : null,
    },
  };
}

/**
 * Navigation timing for the audited document — ONLY when `doc` is this
 * context's own live document. See the header: the ambient `performance`
 * describes the offscreen page in the fetch-and-parse path, which would make
 * `http_status` a verdict about the wrong URL.
 *
 * `responseStatus` is Chrome 109+; the DOM lib in this repo does not declare
 * it yet, so it is narrowed here rather than asserted at the read site.
 */
function navigationTimingFor(
  doc: Document,
): (PerformanceNavigationTiming & { responseStatus?: number }) | undefined {
  if (typeof globalThis.document === 'undefined' || doc !== globalThis.document) return undefined;
  if (typeof performance === 'undefined') return undefined;
  return performance.getEntriesByType('navigation')[0] as
    | (PerformanceNavigationTiming & { responseStatus?: number })
    | undefined;
}

function collectSchemaTypes(doc: Document): string[] {
  const types = new Set<string>();
  doc.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]').forEach((s) => {
    try {
      const parsed = JSON.parse(s.textContent ?? '{}');
      walk(parsed, types);
    } catch {
      /* skip */
    }
  });
  doc.querySelectorAll('[itemtype]').forEach((el) => {
    const t = el.getAttribute('itemtype');
    if (t) types.add(t);
  });
  return Array.from(types);
}
function walk(node: unknown, out: Set<string>) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) walk(n, out);
    return;
  }
  const t = (node as Record<string, unknown>)['@type'];
  if (typeof t === 'string') out.add(t);
  else if (Array.isArray(t)) for (const tt of t) if (typeof tt === 'string') out.add(tt);
  for (const v of Object.values(node)) walk(v, out);
}

/**
 * Mirror of `_flesch_reading_ease`. The rounding AND the ±999.99 clamp are
 * part of the contract — the clamp keeps a pathological page (one 4000-word
 * "sentence") inside the DB column's range on both write paths.
 *
 * The old inline version used `flesch ? …` as its null guard, which silently
 * turned a legitimate score of exactly 0 into `null`.
 */
function fleschReadingEase(text: string, wordCount: number, sentenceCount: number): number | null {
  if (!text || wordCount === 0 || sentenceCount === 0) return null;
  const syllables = countSyllables(text);
  const raw =
    206.835 - 1.015 * (wordCount / sentenceCount) - 84.6 * (syllables / Math.max(1, wordCount));
  const rounded = Math.round(raw * 100) / 100;
  return Math.max(CANONICAL.FLESCH_MIN, Math.min(CANONICAL.FLESCH_MAX, rounded));
}

function countSyllables(text: string): number {
  // Cheap approximation. Decent enough for Flesch.
  const words = text.toLowerCase().split(/\s+/);
  let count = 0;
  for (const w of words) {
    const cleaned = w.replace(/[^a-z]/g, '');
    if (!cleaned) continue;
    const matches = cleaned.match(/[aeiouy]+/g);
    count += Math.max(1, matches ? matches.length : 1);
  }
  return count;
}
