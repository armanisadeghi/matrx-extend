/**
 * Build the per-message context payload for `POST /ai/agent/{agent_id}`.
 *
 * Philosophy:
 *   - Ship EVERYTHING we have, in every variation we have. The server
 *     matches keys against the agent's slots → system slots → "ad-hoc",
 *     and gives the model tools to read/search large objects. Truncating
 *     here is one-way data loss for the model — never do it.
 *   - All keys are well-known; if they don't match a slot, the server adds
 *     a hint to the system prompt about what's available and the model can
 *     request via a tool.
 *
 * This runs in the sidepanel context. Heavy DOM reads happen via
 * chrome.scripting.executeScript on the active tab.
 */

import { log } from '@/lib/debug/log';
import { lookupCapturedByUrl } from '@/lib/supabase/queries';
import type { AutoScrapeRecord } from '@/state/auto-scrape';
import type { useScrapeStore } from '@/state/scrape';

export interface ContextBuildInputs {
  user: {
    id: string;
    email: string | null;
    full_name: string | null;
  } | null;
  desktopTransport: 'native' | 'http' | 'none';
  /** The current value of `useScrapeStore.current` — null if no manual capture exists. */
  scrape: ReturnType<typeof useScrapeStore.getState>['current'];
  /**
   * Background auto-capture (from `useAutoScrapeStore`). Used when there's no
   * manual scrape — captures the page in the background on load and right
   * before send so the agent always sees the current state without the user
   * having to click "Scrape".
   */
  autoScrape?: AutoScrapeRecord | null;
}

/**
 * Always-shipped, cheap browser-derived bits. Collected in a single
 * `chrome.scripting.executeScript` call so it's one round trip.
 */
interface PageProbe {
  url: string;
  title: string;
  description: string | null;
  canonical: string | null;
  lang: string | null;
  charset: string | null;
  viewport_meta: string | null;
  robots: string | null;
  referrer: string | null;
  selection: string | null;
  scrollY: number;
  scrollHeight: number;
  innerWidth: number;
  innerHeight: number;
  ready_state: string;
  content_type: string | null;
  og: Record<string, string>;
  twitter: Record<string, string>;
}

async function probeActivePage(tabId: number): Promise<PageProbe | null> {
  try {
    const [first] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (): PageProbe => {
        const og: Record<string, string> = {};
        const twitter: Record<string, string> = {};
        document.querySelectorAll<HTMLMetaElement>('meta').forEach((m) => {
          const property = m.getAttribute('property') ?? '';
          const name = m.getAttribute('name') ?? '';
          const content = m.getAttribute('content') ?? '';
          if (!content) return;
          if (property.startsWith('og:')) og[property] = content;
          if (name.startsWith('twitter:')) twitter[name] = content;
        });
        const description =
          document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content ?? null;
        const canonical =
          document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? null;
        const robots =
          document.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content ?? null;
        const charset =
          document.querySelector<HTMLMetaElement>('meta[charset]')?.getAttribute('charset') ??
          document.characterSet ??
          null;
        const viewport_meta =
          document.querySelector<HTMLMetaElement>('meta[name="viewport"]')?.content ?? null;
        let selection: string | null = null;
        try {
          selection = window.getSelection()?.toString() ?? null;
          if (selection !== null && selection.trim() === '') selection = null;
        } catch {
          /* ignore */
        }
        return {
          url: location.href,
          title: document.title,
          description,
          canonical,
          lang: document.documentElement.lang || null,
          charset,
          viewport_meta,
          robots,
          referrer: document.referrer || null,
          selection,
          scrollY: window.scrollY,
          scrollHeight: Math.max(
            document.documentElement.scrollHeight,
            document.body?.scrollHeight ?? 0,
          ),
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          ready_state: document.readyState,
          content_type: document.contentType ?? null,
          og,
          twitter,
        };
      },
    });
    return (first?.result as PageProbe | undefined) ?? null;
  } catch (err) {
    log.warn('scrape', 'probeActivePage failed', err);
    return null;
  }
}

/** First N words of a markdown-ish string. Words = whitespace-separated tokens. */
function firstWords(s: string | null | undefined, n: number): string | null {
  if (!s) return null;
  const tokens = s.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  if (tokens.length <= n) return s.trim();
  return `${tokens.slice(0, n).join(' ')}…`;
}

/**
 * Assemble the full context payload. Every cheap thing we know is included.
 * Returns a flat record keyed by stable names so the server can match against
 * agent slots / system slots / surface up to the model as a hint.
 */
export async function buildChatContext(
  inputs: ContextBuildInputs,
): Promise<Record<string, unknown>> {
  const ctx: Record<string, unknown> = {};

  // ── User-facing identity / locale / extension info ────────────────────────
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
  let probe: PageProbe | null = null;
  if (tabId !== null) {
    probe = await probeActivePage(tabId);
    if (probe) {
      // Spread the probe into individual top-level keys so each one can map
      // to its own slot if the agent defines them; also keep the bundle.
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

      // Compact "page_overview" bundle for slots that prefer one tidy field.
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
  // Use manual if present, else fall through to auto. Auto is the common
  // path now that background capture is on by default.
  const scrape = manualScrape ?? autoScrape?.soup ?? null;
  const scrapeCapturedAt = manualScrape
    ? manualScrape.capturedAt
    : autoScrape?.capturedAt ?? null;

  if (scrape && scrapeCapturedAt !== null) {
    // Article body in every variation we have. NO truncation.
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

    // Media + structured data. Full lists, no slicing.
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

    // SEO bundle (already part of the scrape result)
    ctx.seo_audit = scrape.seo;
    ctx.seo_headings = scrape.seo.headings;

    // Metadata bundle (slightly different from page_overview — based on
    // the captured DOM, not the live one).
    ctx.scrape_metadata = scrape.metadata;
    ctx.scrape_captured_at = new Date(scrapeCapturedAt).toISOString();
    ctx.scrape_age_ms = Math.max(0, Date.now() - scrapeCapturedAt);
    ctx.raw_html_size = scrape.raw_html_size;

    // Provenance — lets the agent reason about freshness + whether lazy
    // content was caught.
    ctx.scrape_source = manualScrape ? 'manual' : 'auto-background';
    ctx.scrape_used_full_scroll = manualScrape ? false : !!autoScrape?.usedFullScroll;
    if (autoScrape && autoScrape.initialScrollY != null) {
      ctx.user_scroll_y_before_capture = autoScrape.initialScrollY;
    }
  }

  // ── Capture history for this URL (Supabase recognition row) ───────────────
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
