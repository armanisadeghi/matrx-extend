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
import { prewarmReadPageCache } from '@/lib/tools/handlers/page-refs';
import type { ContextBuildInputs } from './types';
import { checkAuthState } from './check-auth-state';
import { checkPageReady } from './check-page-ready';
import { detectEmail, isEmailUrl } from './detect-email';
import { detectPullRequest, isPullRequestUrl } from './detect-pull-request';
import { detectTicket, isTicketUrl } from './detect-ticket';
import { discoverFormsForContext } from './discover-forms';
import { getDomainMemoForUrl } from './domain-memo';
import { getGuidanceForUrl } from './guidance';
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

  // Everything cheap and deterministic, in parallel — fired the moment the
  // user submits, before the cloud round-trip even starts. By the time the
  // cloud response wants any of this, it's already in memory.
  //
  //   probe         — meta + brief (kind, dismissibles, result_list, ...)
  //   forms         — full form schema for main-area forms
  //   page_ready    — safe-to-screenshot signal (300ms observer)
  //   prewarm       — populate find tool's read_page cache
  //   pull_request  — only when URL is a GitHub/GitLab PR
  //   email         — only when URL is Gmail/Outlook/Hey/Superhuman
  const url = tabMeta?.url ?? '';
  const tasks = tabId !== null
    ? Promise.all([
        probeActivePage(tabId),
        discoverFormsForContext(tabId),
        checkPageReady(tabId),
        prewarmReadPageCache(tabId),
        isPullRequestUrl(url) ? detectPullRequest(tabId, url) : Promise.resolve(null),
        isEmailUrl(url) ? detectEmail(tabId, url) : Promise.resolve(null),
        isTicketUrl(url) ? detectTicket(tabId, url) : Promise.resolve(null),
        url ? checkAuthState(tabId, url) : Promise.resolve(null),
        url ? getDomainMemoForUrl(url) : Promise.resolve(null),
        url ? getGuidanceForUrl(url) : Promise.resolve(null),
      ])
    : Promise.resolve([null, null, null, undefined, null, null, null, null, null, null] as const);
  const [probe, forms, pageReady, , pullRequest, email, ticket, authState, domainMemo, guidance] =
    await tasks;

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
        // Page-ready signal — answers "safe to screenshot/read right now?"
        // null when the check failed (e.g., tab navigated away mid-build).
        ready: pageReady,
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

  // ── page_dismissibles — modal / banner inventory with close-button refs ─
  // BrowserArena's #2 universal failure mode is agents not dismissing
  // popups. Surface the inventory + close selectors so the agent can
  // either auto-dismiss or hand off cleanly. Only attached when something
  // dismissible is on screen.
  if (probe && probe.brief.dismissibles.length > 0) {
    ctx.page_dismissibles = {
      count: probe.brief.dismissibles.length,
      items: probe.brief.dismissibles,
    };
  }

  // ── form_elements — full form schema for the page's main form(s) ───────
  // Highest-ROI workflow category in the field (insurance, procurement,
  // healthcare, cross-portal data entry). Saves a full tool call on the
  // common path: agent reads context, sees fields, types into them.
  if (forms) {
    ctx.form_elements = {
      count: forms.length,
      forms,
    };
  }

  // ── result_list — repeating-card list (search results, product grids) ──
  // URL-derived item URLs survive virtualized scroll where refs recycle.
  if (probe?.brief.result_list) {
    ctx.result_list = probe.brief.result_list;
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

  // pull_request: GitHub / GitLab PR pages — dev workflow #1.
  if (pullRequest) {
    ctx.pull_request = pullRequest;
  }

  // ticket: GitHub Issues / Linear / Jira — completes the dev trifecta
  // alongside pull_request.
  if (ticket) {
    ctx.ticket = ticket;
  }

  // email: Gmail / Outlook / Hey / Superhuman. Either inbox-list or
  // single-thread shape, distinguished by the bundle's `shape` field.
  if (email) {
    if (email.shape === 'inbox') {
      ctx.email_inbox = email;
    } else {
      ctx.email_thread = email;
    }
  }

  // auth_state: cross-cutting "are you signed in here?" signal — saves a
  // turn every session by letting the agent check the sidebar instead of
  // navigating. Always attached when we have a URL (works on every page).
  if (authState) {
    ctx.auth_state = authState;
  }

  // domain_memo: per-domain memory written via `remember_for_domain`.
  // Surfaces the agent's accumulated knowledge about this domain so it
  // doesn't re-learn the same lessons every session.
  if (domainMemo) {
    ctx.domain_memo = domainMemo;
  }

  // guidance: user-saved clues for this domain — notes, screenshots,
  // GIFs, demo references. Authored via the Guidance sidepanel tab.
  // The agent can read text inline, view images via `ai({action:'describe_image'})`,
  // and replay demos via `replay_demo({demo_id: ...})`.
  if (guidance) {
    ctx.guidance = guidance;
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
