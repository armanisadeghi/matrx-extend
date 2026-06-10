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
import { getPlan, listTasks, listUserTodos } from '@/lib/lists/storage';
import { lookupCapturedByUrl } from '@/lib/supabase/queries';
import { prewarmReadPageCache } from '@/lib/tools/handlers/page-refs';
import { useSettingsStore } from '@/state/settings';
import { checkAuthState } from './check-auth-state';
import { checkPageReady } from './check-page-ready';
import { detectEmail, isEmailUrl } from './detect-email';
import { detectPullRequest, isPullRequestUrl } from './detect-pull-request';
import { detectTicket, isTicketUrl } from './detect-ticket';
import { discoverFormsForContext } from './discover-forms';
import { getDomainMemoForUrl } from './domain-memo';
import { getGuidanceForUrl } from './guidance';
import { probeActivePage } from './probe';
import type { ContextBuildInputs } from './types';

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

  // ── plan / tasks / user_todos ────────────────────────────────────────────
  // Per-conversation slices. Attached only when non-empty so the menu
  // stays clean during fresh conversations. Surfaces user edits since
  // the last turn — the model literally sees what the user changed.
  if (inputs.conversationId) {
    const [plan, taskList, userTodos] = await Promise.all([
      getPlan(inputs.conversationId),
      listTasks(inputs.conversationId),
      listUserTodos(inputs.conversationId),
    ]);
    if (plan) {
      ctx.current_plan = {
        title: plan.title,
        steps: plan.steps,
        status: plan.status,
        reasoning: plan.reasoning,
        domains: plan.domains,
        estimated_minutes: plan.estimated_minutes,
        updated_at: plan.updated_at,
      };
    }
    if (taskList.length) {
      ctx.task_list = taskList.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        note: t.note,
      }));
    }
    // Surface OPEN todos always; include up to 5 most-recent done so the
    // model sees what the user has cleared since last turn.
    const openTodos = userTodos.filter((t) => !t.done);
    const recentDone = userTodos
      .filter((t) => t.done)
      .sort((a, b) => (b.done_at ?? 0) - (a.done_at ?? 0))
      .slice(0, 5);
    if (openTodos.length || recentDone.length) {
      ctx.user_todos = {
        open: openTodos.map((t) => ({
          id: t.id,
          title: t.title,
          context: t.context,
          due: t.due,
        })),
        recent_done: recentDone.map((t) => ({
          id: t.id,
          title: t.title,
          done_at: t.done_at,
        })),
      };
    }
  }

  // ── active tab + probe ──────────────────────────────────────────────────
  // Caller (use-chat-stream / use-pilot-chat-stream) resolves the active
  // tab ONCE per send and threads it in. Falling back to our own query is
  // only for legacy / one-off callers; the chat path always passes one.
  // See docs/REQUEST_PAYLOAD_CONTRACT.md §1 for why this matters.
  let tabId: number | null = null;
  let tabMeta: chrome.tabs.Tab | null = inputs.activeTab ?? null;
  if (tabMeta) {
    tabId = tabMeta.id ?? null;
  } else if (inputs.activeTab === undefined) {
    // Legacy/one-off caller that didn't resolve a tab at all. An EXPLICIT
    // null means the caller's single resolveActiveTab() found nothing — in
    // that case we must NOT run our own query: this builder and
    // buildBrowserDomState each re-querying independently is exactly the
    // cross-tab race (page_brief.tab_id != browser-dom.current_tab_id) the
    // single-resolve convention exists to prevent (audit P2-13).
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = tab?.id ?? null;
      tabMeta = tab ?? null;
    } catch (err) {
      log.warn('scrape', 'active tab query failed', err);
    }
  }

  // Everything cheap and deterministic, fired the moment the user submits.
  //
  //   prewarm       — populate read_page cache + tag data-matrx-ref="N" on
  //                   every interactive element. SEQUENCED FIRST so the
  //                   discover-forms walk that follows can read back the
  //                   refs and surface them in form_elements (saves the
  //                   agent a read_page call on every form interaction).
  //   probe         — meta + brief (kind, dismissibles, result_list, ...)
  //   forms         — full form schema for main-area forms (reads refs
  //                   tagged by prewarm above)
  //   page_ready    — safe-to-screenshot signal (300ms observer)
  //   pull_request  — only when URL is a GitHub/GitLab PR
  //   email         — only when URL is Gmail/Outlook/Hey/Superhuman
  const url = tabMeta?.url ?? '';
  // Privacy gate (audit P1-10, user decision 2026-06-10): auth_state's
  // visible-username and the Gmail inbox/thread bundles are PII shipped to
  // the server — user-toggleable in Settings, default ON. Checked HERE so
  // the detectors' executeScripts don't even run when sharing is off.
  const sharePageIdentity = useSettingsStore.getState().sharePageIdentity;
  if (tabId !== null) {
    // Wait for ref tagging before kicking off the rest. Adds ~30-80ms
    // serially but every form field now ships with a `ref` the agent
    // can pass straight to form_input / click_element without a
    // separate read_page round trip.
    await prewarmReadPageCache(tabId);
  }
  const tasks =
    tabId !== null
      ? Promise.all([
          probeActivePage(tabId),
          discoverFormsForContext(tabId),
          checkPageReady(tabId),
          isPullRequestUrl(url) ? detectPullRequest(tabId, url) : Promise.resolve(null),
          sharePageIdentity && isEmailUrl(url) ? detectEmail(tabId, url) : Promise.resolve(null),
          isTicketUrl(url) ? detectTicket(tabId, url) : Promise.resolve(null),
          sharePageIdentity && url ? checkAuthState(tabId, url) : Promise.resolve(null),
          url ? getDomainMemoForUrl(url) : Promise.resolve(null),
          url ? getGuidanceForUrl(url) : Promise.resolve(null),
        ])
      : Promise.resolve([null, null, null, null, null, null, null, null, null] as const);
  const [probe, forms, pageReady, pullRequest, email, ticket, authState, domainMemo, guidance] =
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
    : (autoScrape?.capturedAt ?? null);

  // Confidence gate, hoisted so EVERY content-bearing key honors it — not
  // just page_brief.structure/content. On a CAPTCHA / bot-blocked /
  // unhydrated page the scrape-derived keys (page_full_content,
  // page_seo_audit, article_summary, product_data) used to ship the
  // challenge page's body anyway, defeating the whole point of the gate
  // (audit P1-9). No probe = can't assess; treat as trustworthy (the scrape
  // is then usually absent too).
  const trustworthy = probe ? probe.brief.confidence !== 'low' : true;

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

    // Trim snapshot.ready to the two fields the agent actually reasons
    // about. document/load_event_ms/mutation_count/pending_images are
    // debugging detail — kept in checkPageReady's return type so the
    // Debug tab can inspect, but not surfaced in the per-turn context.
    const readyTrimmed = pageReady
      ? {
          observed_idle: pageReady.observed_idle,
          loading_indicators: pageReady.loading_indicators,
        }
      : null;

    ctx.page_brief = {
      url: probe.url,
      title: probe.title,
      description: probe.description,
      lang: probe.lang,
      kind: probe.brief.kind,
      // tab_id / window_id removed — they live in tab_state. Same Tab object
      // resolved once in use-chat-stream.ts; duplicating here was pure bloat.
      ready: probe.ready_state,
      snapshot: {
        captured_at: new Date().toISOString(),
        confidence: probe.brief.confidence,
        flags: probe.brief.flags,
        ready: readyTrimmed,
      },
      structure: trustworthy
        ? {
            headings: probe.brief.headings,
            primary_action: probe.brief.primary_action,
            main_interactive: probe.brief.main_interactive,
          }
        : null,
      content:
        trustworthy && scrape
          ? {
              excerpt: firstChars(scrape.article.content_markdown, 1500),
              // word_count/reading_time describe the FULL page text, not the
              // 1500-char excerpt above — the flag keeps the model from
              // treating the excerpt as the whole article (audit P2-12).
              excerpt_truncated: (scrape.article.content_markdown?.length ?? 0) > 1500,
              word_count: scrape.article.word_count,
              reading_time_min: scrape.article.reading_time_minutes,
              full_in: 'page_full_content',
            }
          : null,
      more_available: briefMore,
    };
  } else if (tabMeta) {
    // Probe failed (chrome:// page, PDF viewer, scripting blocked, script
    // threw). Without this the request shipped tab_state but NO page_brief
    // at all — the agent couldn't distinguish "page unreadable" from "key
    // missing" (audit P2-12). Emit an honest minimal brief instead.
    ctx.page_brief = {
      url: tabMeta.url ?? null,
      title: tabMeta.title ?? null,
      description: null,
      lang: null,
      kind: 'unknown',
      ready: null,
      snapshot: {
        captured_at: new Date().toISOString(),
        confidence: 'low',
        flags: ['unreadable_or_restricted'],
        ready: null,
      },
      structure: null,
      content: null,
      more_available: {},
    };
  }

  // ── selection — only when present ──────────────────────────────────────
  if (probe?.selection) {
    ctx.selection = probe.selection;
  }

  // ── highlights — user-attached page captures (text + elements) ─────────
  // Sticky attachments from the Highlight tab. Each carries the captured
  // text plus its reference so the agent can act on the exact element /
  // passage. Only attached when the user has highlights queued. One bundled
  // key (rich payload is free; menu cost is one line).
  if (inputs.highlights && inputs.highlights.length > 0) {
    ctx.highlights = {
      count: inputs.highlights.length,
      items: inputs.highlights,
    };
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

  // ── chrome_elements — header / nav / footer / sidebar interactive bits ─
  // Surfaces sign-in, primary nav, sidebar links, footer items so the
  // agent doesn't have to walk the full read_page result just to find a
  // login button. Capped at 20 entries in the probe; the full count
  // lives in `page_brief.more_available.chrome_elements` for the agent
  // to know whether more exist.
  if (probe && probe.brief.chrome_interactive.length > 0) {
    ctx.chrome_elements = {
      count: probe.brief.chrome_interactive.length,
      total: probe.brief.more_available.chrome_elements,
      items: probe.brief.chrome_interactive,
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
  // Browser-agent feedback (2026-05-18): the raw list has null
  // price/rating/image_alt on most items, and ad-network entries (jd8trk,
  // taboola, etc.) interleave with content — flag them so the model can
  // skip when summarizing.
  if (probe?.brief.result_list) {
    ctx.result_list = formatResultListForContext(probe.brief.result_list);
  }

  // ── page_meta — OG / Twitter / canonical / robots / charset / etc. ─────
  // Empty objects ({}) for og/twitter are pure noise — omit them so the
  // bundle reflects only what's actually set on the page.
  if (probe) {
    const meta: Record<string, unknown> = {
      canonical: probe.canonical,
      robots: probe.robots,
      referrer: probe.referrer,
      charset: probe.charset,
      content_type: probe.content_type,
      viewport_meta: probe.viewport_meta,
    };
    if (Object.keys(probe.og).length > 0) meta.og = probe.og;
    if (Object.keys(probe.twitter).length > 0) meta.twitter = probe.twitter;
    ctx.page_meta = meta;
  }

  // ── page_full_content — full clean body ────────────────────────────────
  // Capped at the extension boundary (audit P1-8): "the server trims it"
  // doesn't help the UPLOAD path — a long page was a multi-MB POST on every
  // message. The caps are generous (well past what a model turn can use);
  // `truncated` + the original char counts keep the bundle honest.
  if (scrape && scrapeCapturedAt !== null && trustworthy) {
    const md = scrape.article.content_markdown ?? '';
    const html = scrape.article.content_html_safe ?? '';
    const MD_CAP = 120_000;
    const HTML_CAP = 150_000;
    ctx.page_full_content = {
      markdown: md.length > MD_CAP ? md.slice(0, MD_CAP) : md,
      html: html.length > HTML_CAP ? html.slice(0, HTML_CAP) : html,
      ...(md.length > MD_CAP || html.length > HTML_CAP
        ? {
            truncated: true,
            full_chars: { markdown: md.length, html: html.length },
          }
        : {}),
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
  // Intentionally NOT trimmed. SEO consumers (audit prompts, SERP
  // assistants) genuinely use every field — title length, description
  // length, full og/twitter, heading hierarchy, alt-text coverage,
  // perf metrics, etc. Only obvious always-noise field is an empty
  // hreflang array (most pages); drop it when empty so the bundle
  // doesn't carry `hreflang: []` on every send.
  if (scrape && trustworthy) {
    const seo = scrape.seo as unknown as Record<string, unknown>;
    const hreflang = seo.hreflang;
    if (Array.isArray(hreflang) && hreflang.length === 0) {
      const { hreflang: _drop, ...rest } = seo;
      void _drop;
      ctx.page_seo_audit = rest;
    } else {
      ctx.page_seo_audit = seo;
    }
  }

  // ── page_links — internal/external split for nav reasoning ─────────────
  // Browser-agent feedback (2026-05-18): the raw scrape ships every <a>
  // twice (once with empty text for an image-wrapped link, once with the
  // actual text), every entry has rel:null, and there's no signal of WHERE
  // on the page a link lives. Trim + dedupe + categorize at the boundary;
  // the scrape's raw list is preserved for the SEO audit path.
  if (scrape) {
    ctx.page_links = formatLinksForContext(scrape.links, probe?.url ?? activeUrl ?? null);
  }

  // ── page_media — images + videos + audio in one bundle ─────────────────
  // Default filter: drop tracking pixels (< 50x50, or width*height < 2500),
  // drop data: placeholders (lazy-load empty SVGs, 1x1 GIFs), unwrap CDN
  // proxy URLs (yimg/nitrocdn/cloudflare-wrapper patterns) into the logical
  // source URL. The agent can still fetch the unfiltered list via the
  // separate `page_media_raw` key (ctx-on-demand) when it needs full
  // opaque URLs for SEO analysis / downloads / re-routing.
  if (scrape) {
    const filteredImages = filterImagesForContext(scrape.images);
    const hasMedia =
      filteredImages.length > 0 || scrape.videos.length > 0 || scrape.audio.length > 0;
    if (hasMedia) {
      const bundle: Record<string, unknown> = {};
      if (filteredImages.length > 0) bundle.images = filteredImages;
      if (scrape.videos.length > 0) bundle.videos = scrape.videos;
      if (scrape.audio.length > 0) bundle.audio = scrape.audio;
      // Stamp the filter origin so the model can decide whether the raw list
      // is worth fetching for whatever it's about to do.
      const dropped = scrape.images.length - filteredImages.length;
      if (dropped > 0) {
        bundle.images_filtered = {
          shown: filteredImages.length,
          dropped,
          dropped_reason:
            'tracking pixels, placeholders, and CDN wrappers — fetch `page_media_raw` for the full list',
        };
      }
      ctx.page_media = bundle;
    }
    // Always make the raw bundle available — agents doing SEO audits or
    // downloading specific images can read it on demand. Cheap to ship
    // because the wire path is ctx-pagination; large payloads don't
    // auto-inline (see ctx_get(mode='page') in matrx-ai).
    if (scrape.images.length > 0 || scrape.videos.length > 0 || scrape.audio.length > 0) {
      // Capped (audit P1-8): media-heavy pages shipped hundreds of opaque
      // 400-char CDN URLs in this one key. Counts make the cap honest.
      const RAW_CAP = 100;
      ctx.page_media_raw = {
        images: scrape.images.slice(0, RAW_CAP),
        videos: scrape.videos.slice(0, RAW_CAP),
        audio: scrape.audio.slice(0, RAW_CAP),
        ...(scrape.images.length > RAW_CAP ||
        scrape.videos.length > RAW_CAP ||
        scrape.audio.length > RAW_CAP
          ? {
              truncated: true,
              full_counts: {
                images: scrape.images.length,
                videos: scrape.videos.length,
                audio: scrape.audio.length,
              },
            }
          : {}),
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
  if (probe?.brief.kind === 'article' && scrape && trustworthy) {
    ctx.article_summary = {
      title: scrape.article.title,
      byline: scrape.article.byline,
      excerpt: scrape.article.excerpt,
    };
  }

  // product: lift product schema into a clean bundle.
  if (probe?.brief.kind === 'product' && scrape && trustworthy) {
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
  if (email && sharePageIdentity) {
    if (email.shape === 'inbox') {
      ctx.email_inbox = email;
    } else {
      ctx.email_thread = email;
    }
  }

  // auth_state: cross-cutting "are you signed in here?" signal — saves a
  // turn every session by letting the agent check the sidebar instead of
  // navigating. Always attached when we have a URL (works on every page).
  if (authState && sharePageIdentity) {
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
  if (Array.isArray(type))
    return type.some((t) => typeof t === 'string' && /Product|Offer/i.test(t));
  return false;
}

// ─── page_media helpers ────────────────────────────────────────────────────
// Browser-agent feedback (2026-05-18): a Yahoo homepage shipped 39 KB of
// page_media — 50+ tracking pixels, 20×20 logos, and CDN-wrapped URLs of
// 400+ chars each. None of it useful for text-mode reasoning. These
// helpers do the obvious filters at the context boundary (the raw list
// is still available via `page_media_raw`).

interface ContextImage {
  src: string;
  alt: string | null;
  width: number | null;
  height: number | null;
}

function filterImagesForContext(images: ContextImage[]): ContextImage[] {
  const out: ContextImage[] = [];
  for (const img of images) {
    if (!img.src) continue;
    // 1) Lazy-load placeholders. base64 SVG/GIF shims have no info.
    if (img.src.startsWith('data:image/svg+xml')) continue;
    if (img.src.startsWith('data:image/gif')) continue;
    // 2) Tracking pixels. < 2500 px² is the threshold the agent suggested;
    // 50×50 lands right at that boundary which is large enough for a logo
    // but excludes 1×1 / 20×20 trackers and tiny brand sprites.
    if (img.width != null && img.height != null && img.width * img.height < 2500) {
      continue;
    }
    // 3) Unwrap common CDN proxy patterns into the logical inner URL.
    // The full opaque path lives in `page_media_raw` for any agent that
    // genuinely needs it (downloads, SEO analysis).
    out.push({ ...img, src: unwrapCdnUrl(img.src) });
  }
  return out;
}

// ─── result_list helpers ───────────────────────────────────────────────────

interface RawResultListItem {
  title: string;
  url: string;
  price: string | null;
  rating: string | null;
  image_alt: string | null;
}

interface FormattedResultListItem {
  title: string;
  url: string;
  price?: string;
  rating?: string;
  image_alt?: string;
  /** Only set when the heuristics flag this entry as ad/sponsored. */
  kind?: 'ad';
}

// Common ad-network hostnames. Conservative — extend as we see more in
// the wild. False negative is fine (item just shows up as content);
// false positive is worse (model skips legit content).
const AD_NETWORK_HOSTS =
  /\b(jd8trk|doubleclick|googleadservices|googlesyndication|taboola|outbrain|adsystem|adservice|criteo|adnxs)\.com\b/i;

function formatResultListForContext(list: { count: number; items: RawResultListItem[] }): {
  count: number;
  items: FormattedResultListItem[];
} {
  const items = list.items.map((item) => {
    const out: FormattedResultListItem = { title: item.title, url: item.url };
    if (item.price) out.price = item.price;
    if (item.rating) out.rating = item.rating;
    if (item.image_alt) out.image_alt = item.image_alt;
    if (isAdResultItem(item)) out.kind = 'ad';
    return out;
  });
  return { count: list.count, items };
}

function isAdResultItem(item: RawResultListItem): boolean {
  if (!item.url) return false;
  if (AD_NETWORK_HOSTS.test(item.url)) return true;
  // Tracker-style URLs with gclid/utm_source=ad/adset_ are also reliable
  // ad signals. The empty-title + opaque domain pattern from the Yahoo
  // case (`wallstwatchdogs.com`, `jd8trk.com`) is captured by the first
  // check when the host is in the list; opaque non-listed hosts with no
  // title fall through as 'content' which is the safe default.
  if (/[?&](gclid|utm_source=ad|adset_id=|fbclid)=/.test(item.url)) return true;
  return false;
}

// ─── page_links helpers ────────────────────────────────────────────────────

interface ContextLink {
  href: string;
  text: string;
  rel: string | null;
}

interface FormattedLink {
  href: string;
  text: string;
  kind: 'nav' | 'footer' | 'social' | 'contact' | 'external' | 'content';
  /** True when the link lives outside header/nav/footer/aside. */
  in_main: boolean;
  /** Only present when the page actually sets rel (rare). */
  rel?: string;
}

const SOCIAL_HOSTS =
  /\b(facebook|twitter|x|instagram|linkedin|youtube|tiktok|reddit|pinterest|threads\.net|mastodon|bsky\.app|github)\b/i;

function formatLinksForContext(links: ContextLink[], pageUrl: string | null): FormattedLink[] {
  // Dedupe by href, preferring the entry with non-empty text.
  const byHref = new Map<string, ContextLink>();
  for (const link of links) {
    if (!link.href) continue;
    const existing = byHref.get(link.href);
    if (!existing) {
      byHref.set(link.href, link);
      continue;
    }
    // Keep whichever has actual text content.
    if (!existing.text.trim() && link.text.trim()) {
      byHref.set(link.href, link);
    }
  }

  let pageHost: string | null = null;
  if (pageUrl) {
    try {
      pageHost = new URL(pageUrl).host;
    } catch {
      /* ignore */
    }
  }

  const out: FormattedLink[] = [];
  for (const link of byHref.values()) {
    // Categorize. Scrape doesn't tell us the DOM ancestor, so kind is
    // derived from href + simple heuristics. Future enhancement: have
    // the scrape collector tag each link's nearest landmark.
    const lower = link.href.toLowerCase();
    let kind: FormattedLink['kind'];
    if (lower.startsWith('tel:') || lower.startsWith('mailto:')) {
      kind = 'contact';
    } else if (SOCIAL_HOSTS.test(link.href)) {
      kind = 'social';
    } else if (pageHost) {
      try {
        const linkHost = new URL(link.href, pageUrl ?? undefined).host;
        kind = linkHost === pageHost ? 'content' : 'external';
      } catch {
        kind = 'content';
      }
    } else {
      kind = 'content';
    }

    // The raw scrape's links array is already filtered to "links that
    // appeared in the main article area" by the scrape pipeline when it
    // can detect one. Default in_main:true is safe when we can't tell;
    // chrome links get explicit false via the kind taxonomy.
    const inMain = kind !== 'social' && kind !== 'contact';

    const formatted: FormattedLink = {
      href: link.href,
      text: link.text,
      kind,
      in_main: inMain,
    };
    if (link.rel) formatted.rel = link.rel;
    out.push(formatted);
  }
  return out;
}

/**
 * Heuristic CDN-wrapper unwrap. Returns the inner logical URL when the
 * source matches one of the known proxy patterns; returns the input
 * unchanged otherwise. Never throws — graceful passthrough on any
 * decoding failure.
 *
 * Patterns handled:
 *   1. URLs containing `https%3A%2F%2F` or `http%3A%2F%2F` (any encoded
 *      inner URL) — pull the last decoded http(s) URL out of the path.
 *   2. NitroCDN: `cdn-<hash>.nitrocdn.com/<token>/assets/images/optimized/<rev>/<inner-host>/<inner-path>`
 *      — reconstruct as `https://<inner-host>/<inner-path>`.
 *   3. Generic encoded query param: `?url=...` or `?u=...`.
 */
function unwrapCdnUrl(src: string): string {
  try {
    // Pattern 1: encoded inner URL anywhere in the path (Yahoo's
    // s.yimg.com/lo/mysterio/api/<hash>/.../https%3A%2F%2F<real>).
    const encodedHttpsIdx = src.lastIndexOf('https%3A%2F%2F');
    const encodedHttpIdx = src.lastIndexOf('http%3A%2F%2F');
    const idx = Math.max(encodedHttpsIdx, encodedHttpIdx);
    if (idx > -1) {
      const decoded = decodeURIComponent(src.slice(idx));
      // Sanity: must be a valid URL on its own.
      try {
        const u = new URL(decoded);
        if (u.protocol === 'http:' || u.protocol === 'https:') return decoded;
      } catch {
        /* fall through */
      }
    }
    // Pattern 2: NitroCDN proxy.
    const nitroMatch = src.match(
      /^https?:\/\/cdn-[^.]+\.nitrocdn\.com\/[^/]+\/assets\/images\/optimized\/[^/]+\/(.+)$/,
    );
    if (nitroMatch?.[1]) return `https://${nitroMatch[1]}`;
    // Pattern 3: ?url=... / ?u=... query param wrapper.
    const u = new URL(src);
    const inner = u.searchParams.get('url') ?? u.searchParams.get('u');
    if (inner && /^https?:\/\//i.test(inner)) return inner;
  } catch {
    /* malformed input — return as-is */
  }
  return src;
}
