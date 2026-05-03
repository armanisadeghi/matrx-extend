/**
 * Legacy flat context shape. ~65 keys, lots of duplication.
 * Kept behind admin toggle (`matrx.context.shape = "v1-flat"`) for A/B
 * comparison while v2-bundled proves out. Will be deleted once v2 wins.
 *
 * Don't add new keys here. New work goes in v2-bundled.ts.
 */

import { log } from '@/lib/debug/log';
import { lookupCapturedByUrl } from '@/lib/supabase/queries';
import type { ContextBuildInputs } from './types';
import { probeActivePage } from './probe';

/** First N words of a markdown-ish string. */
function firstWords(s: string | null | undefined, n: number): string | null {
  if (!s) return null;
  const tokens = s.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  if (tokens.length <= n) return s.trim();
  return `${tokens.slice(0, n).join(' ')}…`;
}

export async function buildContextV1Flat(
  inputs: ContextBuildInputs,
): Promise<Record<string, unknown>> {
  const ctx: Record<string, unknown> = {};

  // ── User identity / locale / extension info ───────────────────────────────
  if (inputs.user) {
    ctx.user_id = inputs.user.id;
    ctx.user_email = inputs.user.email;
    if (inputs.user.full_name) ctx.user_full_name = inputs.user.full_name;
  }
  ctx.current_time = new Date().toISOString();
  ctx.current_time_local = new Date().toString();
  try {
    ctx.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    /* ignore */
  }
  ctx.locale = (typeof navigator !== 'undefined' && navigator.language) || null;
  ctx.locales = (typeof navigator !== 'undefined' && navigator.languages) || null;
  ctx.user_agent = (typeof navigator !== 'undefined' && navigator.userAgent) || null;

  // ── Extension state ───────────────────────────────────────────────────────
  ctx.desktop_bridge_status = inputs.desktopTransport;
  ctx.extension_id = chrome.runtime.id;
  ctx.extension_version = chrome.runtime.getManifest().version;
  ctx.extension_name = 'matrx-extend';
  ctx.surface = 'chrome-extension-chat';

  // ── Active tab (cheap) ────────────────────────────────────────────────────
  let tabId: number | null = null;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      tabId = tab.id ?? null;
      ctx.url = tab.url ?? null;
      ctx.page_title = tab.title ?? null;
      ctx.tab_id = tab.id ?? null;
      ctx.window_id = tab.windowId ?? null;
      ctx.tab_status = tab.status ?? null;
      ctx.tab_index = tab.index;
      ctx.tab_pinned = tab.pinned;
      ctx.tab_incognito = tab.incognito;
      ctx.favicon_url = tab.favIconUrl ?? null;
    }
  } catch (err) {
    log.warn('scrape', 'active tab query failed', err);
  }

  // ── Active tab probe (one executeScript call) ─────────────────────────────
  if (tabId !== null) {
    const probe = await probeActivePage(tabId);
    if (probe) {
      ctx.url = probe.url;
      ctx.page_title = probe.title;
      ctx.page_description = probe.description;
      ctx.page_canonical = probe.canonical;
      ctx.page_lang = probe.lang;
      ctx.page_charset = probe.charset;
      ctx.page_viewport_meta = probe.viewport_meta;
      ctx.page_robots = probe.robots;
      ctx.page_referrer = probe.referrer;
      ctx.page_ready_state = probe.ready_state;
      ctx.page_content_type = probe.content_type;
      ctx.page_og = probe.og;
      ctx.page_twitter = probe.twitter;
      ctx.viewport = { width: probe.innerWidth, height: probe.innerHeight };
      ctx.scroll_position = { y: probe.scrollY, max: probe.scrollHeight };
      ctx.selection = probe.selection;
      ctx.has_selection = !!probe.selection;
      ctx.page_overview = {
        url: probe.url,
        title: probe.title,
        description: probe.description,
        canonical: probe.canonical,
        lang: probe.lang,
        robots: probe.robots,
        og: probe.og,
        twitter: probe.twitter,
      };
    }
  }

  // ── Scrape (manual user-driven capture takes priority over auto) ──────────
  const activeUrl = (ctx.url as string | null | undefined) ?? null;
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

  if (scrape && scrapeCapturedAt !== null) {
    ctx.clean_content_markdown = scrape.article.content_markdown;
    ctx.clean_content_html = scrape.article.content_html_safe;
    ctx.clean_content_excerpt_1000_words = firstWords(scrape.article.content_markdown, 1000);
    ctx.clean_content_excerpt_300_words = firstWords(scrape.article.content_markdown, 300);
    ctx.scrape_extractor = scrape.article.extractor;
    ctx.scrape_word_count = scrape.article.word_count;
    ctx.scrape_reading_time_minutes = scrape.article.reading_time_minutes;
    ctx.article_title = scrape.article.title;
    ctx.article_byline = scrape.article.byline;
    ctx.article_excerpt = scrape.article.excerpt;
    ctx.images = scrape.images;
    ctx.images_count = scrape.images.length;
    ctx.videos = scrape.videos;
    ctx.videos_count = scrape.videos.length;
    ctx.audio = scrape.audio;
    ctx.audio_count = scrape.audio.length;
    ctx.links = scrape.links;
    ctx.links_count = scrape.links.length;
    ctx.structured_data = scrape.ld_json;
    ctx.schema_types = scrape.metadata.schemaTypes;
    ctx.seo_audit = scrape.seo;
    ctx.seo_headings = scrape.seo.headings;
    ctx.scrape_metadata = scrape.metadata;
    ctx.scrape_captured_at = new Date(scrapeCapturedAt).toISOString();
    ctx.scrape_age_ms = Math.max(0, Date.now() - scrapeCapturedAt);
    ctx.raw_html_size = scrape.raw_html_size;
    ctx.scrape_source = manualScrape ? 'manual' : 'auto-background';
    ctx.scrape_used_full_scroll = manualScrape ? false : !!autoScrape?.usedFullScroll;
    if (autoScrape && autoScrape.initialScrollY != null) {
      ctx.user_scroll_y_before_capture = autoScrape.initialScrollY;
    }
  }

  // ── Capture history for this URL ─────────────────────────────────────────
  if (activeUrl) {
    try {
      const captured = await lookupCapturedByUrl(activeUrl);
      if (captured) {
        ctx.previously_captured_at = captured.captured_at;
        ctx.previously_captured_id = captured.id;
        ctx.previously_captured_title = captured.title;
      }
    } catch {
      /* not critical */
    }
  }

  return ctx;
}
