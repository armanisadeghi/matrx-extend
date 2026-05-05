/**
 * Fetch an arbitrary URL → DOMParser → existing scrape pipeline.
 *
 * Runs in the **offscreen document** because:
 *   - Service workers lack `DOMParser` and many DOM APIs.
 *   - The existing `runScrape` pipeline (defuddle / readability / turndown
 *     / collectors / SEO audit) is built around `Document`.
 *   - Offscreen has full DOM and is already running for streaming, so
 *     we reuse it instead of spinning up a tab.
 *
 * Cross-working: this is the SAME pipeline the **Scrape** tab uses
 * against the active page. Improvements to extractors / collectors /
 * markdown conversion flow to both surfaces automatically.
 *
 * 📝 Notes:
 *    .research/proposed-tools-and-features.md (item #10 → renumbered)
 *
 * 🧪 Tests: docs/feature-tests.md → "fetch_url_as_markdown"
 */
import { runScrape, type SoupResult } from '@/lib/scrape/pipeline';

export interface FetchAndParseRequest {
  url: string;
  /** Send credentials (cookies) with the fetch. Default false. */
  use_session?: boolean;
  /** Follow redirects (default true). */
  follow_redirects?: boolean;
  /** User-Agent override. Defaults to the browser's. */
  user_agent?: string;
  /** Cap on returned markdown length. Default 200_000 chars. */
  max_chars?: number;
}

export interface FetchAndParseResult {
  ok: boolean;
  reason?: string;
  http_status?: number;
  /** Resolved final URL after any redirects. */
  final_url?: string;
  content_type?: string | null;
  /** Slimmed payload for agent consumption. */
  title?: string | null;
  markdown?: string | null;
  byline?: string | null;
  excerpt?: string | null;
  extractor?: SoupResult['article']['extractor'];
  word_count?: number | null;
  reading_time_minutes?: number | null;
  metadata?: SoupResult['metadata'];
  ld_json?: unknown[];
  /** True when markdown was sliced because it exceeded max_chars. */
  truncated?: boolean;
  /** Caller asked for extras → populated. Otherwise omitted to keep payloads small. */
  links?: SoupResult['links'];
  images?: SoupResult['images'];
  videos?: SoupResult['videos'];
  seo?: SoupResult['seo'];
}

const DEFAULT_MAX_CHARS = 200_000;

export async function fetchUrlAndParse(
  req: FetchAndParseRequest,
  options: { include_extras?: boolean } = {},
): Promise<FetchAndParseResult> {
  const url = req.url;
  if (!url || !/^https?:/i.test(url)) {
    return { ok: false, reason: `Invalid URL (must be http/https): ${url}` };
  }

  let res: Response;
  try {
    res = await fetch(url, {
      credentials: req.use_session ? 'include' : 'omit',
      redirect: req.follow_redirects === false ? 'manual' : 'follow',
      headers: req.user_agent ? { 'User-Agent': req.user_agent } : undefined,
    });
  } catch (err) {
    return { ok: false, reason: `fetch failed: ${(err as Error).message}` };
  }
  const finalUrl = res.url || url;
  const contentType = res.headers.get('content-type');

  if (!res.ok) {
    return {
      ok: false,
      reason: `HTTP ${res.status} ${res.statusText}`,
      http_status: res.status,
      final_url: finalUrl,
      content_type: contentType,
    };
  }

  if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
    return {
      ok: false,
      reason: `Non-HTML content-type: ${contentType}. Use the appropriate tool for this kind of resource (read_pdf for PDFs, the agent's standard fetch for JSON, etc.).`,
      http_status: res.status,
      final_url: finalUrl,
      content_type: contentType,
    };
  }

  let html: string;
  try {
    html = await res.text();
  } catch (err) {
    return { ok: false, reason: `failed to read body: ${(err as Error).message}` };
  }

  // Parse into a Document. DOMParser is available in offscreen.
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, 'text/html');
  } catch (err) {
    return { ok: false, reason: `parse failed: ${(err as Error).message}` };
  }

  // The pipeline reads `doc.location?.href`; DOMParser-parsed Documents
  // have no `location`. Inject a <base href="..."> so collectors that
  // resolve relative URLs (img/src, links, etc.) get the right base.
  try {
    if (!doc.querySelector('base[href]')) {
      const base = doc.createElement('base');
      base.setAttribute('href', finalUrl);
      doc.head?.insertBefore(base, doc.head.firstChild ?? null);
    }
  } catch {
    // Non-fatal — the pipeline will still produce useful output.
  }

  let soup: SoupResult;
  try {
    soup = await runScrape(doc, {
      preferDefuddle: true,
      includeImages: !!options.include_extras,
      includeVideos: !!options.include_extras,
      includeLinks: !!options.include_extras,
      includeStructured: true,
    });
  } catch (err) {
    return { ok: false, reason: `pipeline failed: ${(err as Error).message}` };
  }

  const maxChars = req.max_chars ?? DEFAULT_MAX_CHARS;
  let md = soup.article.content_markdown ?? '';
  let truncated = false;
  if (md.length > maxChars) {
    md = md.slice(0, maxChars);
    truncated = true;
  }

  const out: FetchAndParseResult = {
    ok: true,
    http_status: res.status,
    final_url: finalUrl,
    content_type: contentType,
    title: soup.article.title ?? soup.metadata.title ?? null,
    markdown: md,
    byline: soup.article.byline,
    excerpt: soup.article.excerpt,
    extractor: soup.article.extractor,
    word_count: soup.article.word_count,
    reading_time_minutes: soup.article.reading_time_minutes,
    metadata: soup.metadata,
    ld_json: soup.ld_json,
    truncated,
  };
  if (options.include_extras) {
    out.links = soup.links;
    out.images = soup.images;
    out.videos = soup.videos;
    out.seo = soup.seo;
  }
  return out;
}
