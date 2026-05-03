/**
 * Bundled context shape (v2). Default for all chats.
 *
 * Design principles (locked in CLAUDE.md):
 *   - Bundle by mental concept; one coherent thing, one key.
 *   - Big rich values are FREE — each key costs ~one line in the model's
 *     advertised-keys menu, regardless of payload. Don't shatter into
 *     shallow keys; don't move usable state to tools.
 *   - One source of truth per fact. No `images_count` AND `images.length`.
 *   - Dynamic keys welcome — surface adds them based on detected page kind.
 *   - Keys are public API. Engineers template `{{page_brief.title}}` etc.
 *
 * Always-attached keys: page_brief, user, client (and selection when present).
 * On-demand keys (still in this map; the server presents them as fetchable
 * by name via the auto-context-fetch tool): page_meta, page_seo_audit,
 * page_full_content, page_links, page_media, page_structured_data, tab_state.
 *
 * Dynamic keys (added when relevant):
 *   - form_elements        — when the page has a form (kind === 'form' or
 *                            forms count > 0 with main-area presence)
 *   - product_data         — when product schema is detected
 *   - article_excerpt      — when kind === 'article' (just title + byline +
 *                            excerpt — content lives in page_full_content)
 */

import { log } from '@/lib/debug/log';
import { lookupCapturedByUrl } from '@/lib/supabase/queries';
import type { ContextBuildInputs } from './types';
import { probeActivePage } from './probe';

export async function buildContextV2Bundled(
  inputs: ContextBuildInputs,
): Promise<Record<string, unknown>> {
  const ctx: Record<string, unknown> = {};

  // ── user ────────────────────────────────────────────────────────────────
  if (inputs.user) {
    ctx.user = {
      id: inputs.user.id,
      name: inputs.user.full_name ?? null,
      email: inputs.user.email,
    };
  }

  // ── client ──────────────────────────────────────────────────────────────
  let timezone: string | null = null;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    /* ignore */
  }
  ctx.client = {
    surface: 'chrome-extension-chat',
    extension_version: chrome.runtime.getManifest().version,
    desktop_bridge: inputs.desktopTransport,
    now: new Date().toISOString(),
    timezone,
    locale: (typeof navigator !== 'undefined' && navigator.language) || null,
  };

  // ── active tab + probe ──────────────────────────────────────────────────
  let tabId: number | null = null;
  let tabMeta: chrome.tabs.Tab | null = null;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id ?? null;
    tabMeta = tab ?? null;
  } catch (err) {
    log.warn('scrape', 'active tab query failed', err);
  }

  const probe = tabId !== null ? await probeActivePage(tabId) : null;

  // Scrape lookup. Prefer manual capture, then auto-background.
  const activeUrl = probe?.url ?? tabMeta?.url ?? null;
  const manualScrape =
    inputs.scrape && activeUrl && inputs.scrape.url === activeUrl ? inputs.scrape : null;
  const autoScrape =
    inputs.autoScrape && activeUrl && inputs.autoScrape.url === activeUrl
      ? inputs.autoScrape
      : null;
  const scrape = manualScrape ?? autoScrape?.soup ?? null;
  const scrapeCapturedAt = manualScrape
    ? manualScrape.capturedAt
    : autoScrape?.capturedAt ?? null;

  // ── page_brief — the always-loaded rich snapshot ───────────────────────
  if (probe) {
    const briefMore = probe.brief.more_available;
    // Augment "more_available" counts with anything we know from the scrape
    // (links/structured-data totals come from the scrape, not the live DOM).
    if (scrape) {
      Object.assign(briefMore, {
        links: scrape.links.length,
        videos: scrape.videos.length,
        full_content_chars: scrape.article.content_markdown?.length ?? 0,
        structured_data: scrape.ld_json.length,
        seo_audit: 'available',
      });
    }

    // Drop heavy fields when confidence is low — better to send less than to
    // mislead the model about a CAPTCHA-blocked or unhydrated page.
    const trustworthy = probe.brief.confidence !== 'low';

    ctx.page_brief = {
      url: probe.url,
      title: probe.title,
      description: probe.description,
      lang: probe.lang,
      kind: probe.brief.kind,
      tab_id: tabMeta?.id ?? null,
      window_id: tabMeta?.windowId ?? null,
      ready: probe.ready_state,
      snapshot: {
        captured_at: new Date().toISOString(),
        confidence: probe.brief.confidence,
        flags: probe.brief.flags,
      },
      structure: trustworthy
        ? {
            headings: probe.brief.headings,
            primary_action: probe.brief.primary_action,
            main_interactive: probe.brief.main_interactive,
          }
        : null,
      content: trustworthy && scrape
        ? {
            excerpt: firstChars(scrape.article.content_markdown, 1500),
            word_count: scrape.article.word_count,
            reading_time_min: scrape.article.reading_time_minutes,
          }
        : null,
      more_available: briefMore,
    };
  }

  // ── selection — only when present ──────────────────────────────────────
  if (probe?.selection) {
    ctx.selection = probe.selection;
  }

  // ── page_meta — OG / Twitter / canonical / robots / charset / etc. ─────
  if (probe) {
    ctx.page_meta = {
      canonical: probe.canonical,
      robots: probe.robots,
      referrer: probe.referrer,
      charset: probe.charset,
      content_type: probe.content_type,
      viewport_meta: probe.viewport_meta,
      og: probe.og,
      twitter: probe.twitter,
    };
  }

  // ── page_full_content — full clean body ────────────────────────────────
  if (scrape && scrapeCapturedAt !== null) {
    ctx.page_full_content = {
      markdown: scrape.article.content_markdown,
      html: scrape.article.content_html_safe,
      title: scrape.article.title,
      byline: scrape.article.byline,
      excerpt: scrape.article.excerpt,
      word_count: scrape.article.word_count,
      reading_time_min: scrape.article.reading_time_minutes,
      extractor: scrape.article.extractor,
      captured_at: new Date(scrapeCapturedAt).toISOString(),
    };
  }

  // ── page_seo_audit — full SEO bundle ───────────────────────────────────
  if (scrape) {
    ctx.page_seo_audit = scrape.seo;
  }

  // ── page_links — internal/external split for nav reasoning ─────────────
  if (scrape) {
    ctx.page_links = scrape.links;
  }

  // ── page_media — images + videos + audio in one bundle ─────────────────
  if (scrape) {
    const hasMedia =
      scrape.images.length > 0 || scrape.videos.length > 0 || scrape.audio.length > 0;
    if (hasMedia) {
      ctx.page_media = {
        images: scrape.images,
        videos: scrape.videos,
        audio: scrape.audio,
      };
    }
  }

  // ── page_structured_data — schema.org / JSON-LD ───────────────────────
  if (scrape && scrape.ld_json.length > 0) {
    ctx.page_structured_data = {
      blocks: scrape.ld_json,
      schema_types: scrape.metadata.schemaTypes,
    };
  }

  // ── tab_state — rarely useful but real (one bundle) ───────────────────
  if (tabMeta) {
    ctx.tab_state = {
      tab_id: tabMeta.id ?? null,
      window_id: tabMeta.windowId ?? null,
      tab_index: tabMeta.index,
      pinned: tabMeta.pinned,
      incognito: tabMeta.incognito,
      status: tabMeta.status ?? null,
    };
  }

  // ── viewport_state ────────────────────────────────────────────────────
  if (probe) {
    ctx.viewport_state = {
      width: probe.innerWidth,
      height: probe.innerHeight,
      scroll_y: probe.scrollY,
      scroll_height: probe.scrollHeight,
    };
  }

  // ── Dynamic keys — added based on detected page kind ─────────────────
  // These don't need pre-declaration. Surfaces lean into this: detect
  // something useful → attach the bundle for that turn only.

  // article: convenience bundle of just title + byline + excerpt for slots
  // that want the gist without the full body.
  if (probe?.brief.kind === 'article' && scrape) {
    ctx.article_summary = {
      title: scrape.article.title,
      byline: scrape.article.byline,
      excerpt: scrape.article.excerpt,
    };
  }

  // product: lift product schema into a clean bundle.
  if (probe?.brief.kind === 'product' && scrape) {
    const product = scrape.ld_json.find((b) => isProductBlock(b));
    if (product) ctx.product_data = product;
  }

  // form: the form-detector fired — surface the form fields directly so the
  // agent doesn't have to call get_form_fields just to see what's there.
  if (probe?.brief.kind === 'form' || (probe && probe.brief.more_available.forms > 0)) {
    // We don't run get_form_fields here (it's a separate executeScript) —
    // the agent can call it. But mark its availability via the brief.
    // Future work: prefetch form fields when forms count is small.
  }

  // ── Capture history (recognition row from Supabase) ──────────────────
  if (activeUrl) {
    try {
      const captured = await lookupCapturedByUrl(activeUrl);
      if (captured) {
        ctx.prior_capture = {
          captured_at: captured.captured_at,
          id: captured.id,
          title: captured.title,
        };
      }
    } catch {
      /* not critical */
    }
  }

  return ctx;
}

function firstChars(s: string | null | undefined, n: number): string | null {
  if (!s) return null;
  if (s.length <= n) return s;
  return `${s.slice(0, n)}…`;
}

function isProductBlock(block: unknown): boolean {
  if (!block || typeof block !== 'object') return false;
  const type = (block as Record<string, unknown>)['@type'];
  if (typeof type === 'string') return /Product|Offer/i.test(type);
  if (Array.isArray(type)) return type.some((t) => typeof t === 'string' && /Product|Offer/i.test(t));
  return false;
}
