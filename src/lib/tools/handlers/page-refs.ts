/**
 * Reference-ID-based page-understanding tools.
 *
 * The reference-ID system is the key abstraction: instead of fragile CSS
 * selectors or x/y coordinates, every interactive element gets a stable
 * reference (`ref:N`) that the agent can pass to interaction tools.
 *
 * How it works:
 *   1. `read_page` walks the live DOM, picks elements (interactive-only by
 *      default), and tags each with `data-matrx-ref="N"`. It returns an
 *      accessibility-style summary: { ref, role, name, tag, text, bounds,
 *      visible }.
 *   2. The agent uses those refs in `click_element({ ref })`,
 *      `type_into_element({ ref })`, `scroll_into_view({ ref })`, etc. The
 *      Zod schemas now accept selector OR ref; ref resolves to
 *      `[data-matrx-ref="N"]` internally.
 *   3. Refs invalidate on navigation (the data attributes don't survive
 *      the next page load). Re-call `read_page` after any navigation.
 *
 * Trade-off: we mutate the page DOM with `data-matrx-ref` attributes.
 * Frameworks usually leave unknown data-* attributes alone. For the rare
 * case where they don't, fall back to selector-based tools.
 *
 * Companion tools:
 *   - `find` — natural-language element search using on-device AI; returns
 *     refs, no need for the agent to scan a giant tree itself.
 *   - `get_page_text` — clean, article-style readable text extraction.
 *     Lighter than `read_active_page` (which returns the full scrape).
 */

import { quickPrompt } from '@/lib/onbox-ai/client';
import { getAssignedTabId } from '@/lib/tools/handlers/_active-tab';
import type { ToolHandler } from '@/lib/tools/types';
import { z } from 'zod';

/** Convert ref string ("ref:42" or "42") to the data-attribute selector. */
export function refToSelector(ref: string): string {
  const n = ref.startsWith('ref:') ? ref.slice(4) : ref;
  return `[data-matrx-ref="${n.replace(/"/g, '\\"')}"]`;
}

// ─── last-scrape cache ──────────────────────────────────────────────────────
//
// `read_page` is the slow part of the page-understanding pipeline (executeScript
// round-trip + DOM walk + ref reassignment). When the agent calls read_page and
// then immediately calls `find`, the second scrape is wasted work — the DOM
// hasn't moved. We cache the most recent scrape per tab and let `find` (and
// future tools) reuse it when fresh and same-url. Refs in the cached result are
// the live `data-matrx-ref` attributes still on the page, so they remain valid
// for interaction tools as long as no other read_page has run since.
//
// Invalidation: TTL + per-tab URL match + chrome.tabs.onUpdated/onRemoved hooks.

interface ScrapeElement {
  ref: string;
  name: string;
  role: string;
  tag: string;
  text?: string;
  [k: string]: unknown;
}

interface CachedScrape {
  tabId: number;
  url: string;
  ts: number;
  args: {
    interactive_only: boolean;
    include_hidden: boolean;
    include_text: boolean;
  };
  result: {
    ok: true;
    url: string;
    title: string;
    count: number;
    total_candidates: number;
    elements: ScrapeElement[];
  };
}

// 60s TTL — refs survive in the DOM as long as the page hasn't been replaced
// or another read_page hasn't run. URL/tab change invalidates via the chrome
// listeners below. 5s was too aggressive: agents often think for several
// seconds between read_page and a follow-up find/click.
const SCRAPE_TTL_MS = 60_000;
let lastScrape: CachedScrape | null = null;

/**
 * External entry point for warming the cache from the context-build pipeline.
 * Runs a read_page with sensible find-friendly defaults if no fresh entry
 * exists. Quiet — never throws; just drops on the floor on error.
 */
export async function prewarmReadPageCache(tabId: number): Promise<void> {
  const fresh = getFreshScrape(tabId, { interactive_only: true, include_text: true });
  if (fresh) return;
  try {
    await read_page.run(
      {
        tab_id: tabId,
        interactive_only: true,
        max_nodes: 200,
        include_hidden: false,
        include_text: true,
        include_bounds: false,
        trigger_lazy_load: false,
      },
      {
        conversationId: null,
        runId: 'prewarm',
        callId: 'prewarm',
        agentName: null,
        permissionMode: 'act',
      } as never,
    );
  } catch {
    /* ignore — pre-warm is best-effort */
  }
}

function rememberScrape(s: CachedScrape): void {
  lastScrape = s;
}

function getFreshScrape(
  tabId: number,
  requirement: { interactive_only?: boolean; include_hidden?: boolean; include_text?: boolean },
): CachedScrape | null {
  const s = lastScrape;
  if (!s) return null;
  if (s.tabId !== tabId) return null;
  if (Date.now() - s.ts > SCRAPE_TTL_MS) return null;
  // Cache must be at least as inclusive as the requirement.
  if (requirement.interactive_only === false && s.args.interactive_only) return null;
  if (requirement.include_hidden === true && !s.args.include_hidden) return null;
  if (requirement.include_text === true && !s.args.include_text) return null;
  return s;
}

function invalidateScrape(tabId?: number): void {
  if (tabId == null) {
    lastScrape = null;
  } else if (lastScrape?.tabId === tabId) {
    lastScrape = null;
  }
}

// Wipe cache on navigation / tab removal. Listeners survive SW restarts because
// the module is loaded fresh on each restart.
if (typeof chrome !== 'undefined' && chrome.tabs?.onUpdated) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    // 'loading' fires at the start of a navigation; URL field appears here too.
    if (changeInfo.status === 'loading' || changeInfo.url) invalidateScrape(tabId);
  });
  chrome.tabs.onRemoved?.addListener((tabId) => invalidateScrape(tabId));
}

const ReadPageArgs = z
  .object({
    tab_id: z.number().int().optional(),
    /** Canonical alias for tab_id. */
    tabId: z.string().optional(),
    /** Only return interactive elements (links, buttons, inputs, etc.). Default true. */
    interactive_only: z.boolean().optional().default(true),
    /** Canonical alias: 'interactive' = interactive_only:true; 'all' = false. */
    filter: z.enum(['interactive', 'all']).optional(),
    /** Include hidden elements. Default false (visible only). */
    include_hidden: z.boolean().optional().default(false),
    /** Maximum elements to return. Default 200. */
    max_nodes: z.number().int().positive().max(2000).optional().default(200),
    /** Include the page's text content for each element. Default true. */
    include_text: z.boolean().optional().default(true),
    /** Include bounding rectangles. Default false (saves tokens). */
    include_bounds: z.boolean().optional().default(false),
    /** Force lazy-loaded content to render before snapshotting. */
    trigger_lazy_load: z.boolean().optional().default(false),
    /** Output cap (post-serialization). */
    max_chars: z.number().int().positive().optional(),
  })
  .default({});
type ReadPageArgs = z.infer<typeof ReadPageArgs>;

export const read_page: ToolHandler<ReadPageArgs, unknown> = {
  name: 'read_page',
  tier: 'read',
  description:
    'Return an accessibility-style summary of the active page. Each interactive element gets a reference id (`ref:N`) you can pass to click_element / type_into_element / scroll_into_view / etc. instead of a CSS selector — refs are stable across DOM mutations within the same page lifetime. Pass interactive_only=false to include headings, paragraphs, and labels too. Refs invalidate on navigation; call this again after navigating. Returns { url, title, count, elements: [{ ref, role, name, tag, text, visible, bounds? }] }.',
  argsSchema: ReadPageArgs,
  run: async (args, ctx) => {
    const tabId =
      args.tab_id ??
      (args.tabId ? Number.parseInt(args.tabId, 10) : null) ??
      (await getAssignedTabId(ctx));
    if (tabId == null || !Number.isFinite(tabId))
      return { ok: false, reason: 'No active tab' };
    // Canonical 'filter' overrides interactive_only when present.
    const interactiveOnly =
      args.filter !== undefined ? args.filter === 'interactive' : args.interactive_only;
    if (args.trigger_lazy_load) {
      // Best-effort lazy-load trigger: scroll to bottom, settle, scroll back.
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          func: async () => {
            const startY = window.scrollY;
            const step = window.innerHeight * 0.8;
            const maxScrolls = 12;
            for (let i = 0; i < maxScrolls; i++) {
              const before = document.documentElement.scrollHeight;
              window.scrollBy({ top: step, behavior: 'instant' });
              await new Promise((r) => setTimeout(r, 250));
              const after = document.documentElement.scrollHeight;
              if (
                window.innerHeight + window.scrollY >= after - 4 &&
                after === before
              ) {
                break;
              }
            }
            window.scrollTo({ top: startY, behavior: 'instant' });
            await new Promise((r) => setTimeout(r, 150));
          },
        });
      } catch {
        /* lazy-load is best-effort */
      }
    }
    try {
      const [first] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (
          interactiveOnly: boolean,
          includeHidden: boolean,
          maxNodes: number,
          includeText: boolean,
          includeBounds: boolean,
        ) => {
          const INTERACTIVE = [
            'a[href]',
            'button',
            'input:not([type="hidden"])',
            'select',
            'textarea',
            'summary',
            '[role="button"]',
            '[role="link"]',
            '[role="checkbox"]',
            '[role="radio"]',
            '[role="combobox"]',
            '[role="textbox"]',
            '[role="searchbox"]',
            '[role="switch"]',
            '[role="tab"]',
            '[role="menuitem"]',
            '[role="option"]',
            '[role="treeitem"]',
            '[contenteditable="true"]',
            '[tabindex]:not([tabindex="-1"])',
          ].join(', ');
          const READABLE = INTERACTIVE + ', h1, h2, h3, h4, p, label, li, dt, dd, [role="heading"]';

          // Wipe stale refs from the previous read.
          const stale = document.querySelectorAll('[data-matrx-ref]');
          for (const el of Array.from(stale)) el.removeAttribute('data-matrx-ref');

          const candidates = Array.from(
            document.querySelectorAll(interactiveOnly ? INTERACTIVE : READABLE),
          );

          function isVisible(el: Element): boolean {
            if (!(el instanceof HTMLElement)) return false;
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return false;
            const style = window.getComputedStyle(el);
            if (style.visibility === 'hidden' || style.display === 'none') return false;
            if (parseFloat(style.opacity || '1') === 0) return false;
            return true;
          }
          function implicitRole(el: Element): string {
            const tag = el.tagName.toLowerCase();
            const map: Record<string, string> = {
              a: 'link',
              button: 'button',
              select: 'combobox',
              textarea: 'textbox',
              h1: 'heading',
              h2: 'heading',
              h3: 'heading',
              h4: 'heading',
              h5: 'heading',
              h6: 'heading',
              li: 'listitem',
              p: 'paragraph',
              label: 'label',
              summary: 'button',
            };
            if (map[tag]) return map[tag];
            if (tag === 'input') {
              const t = (el as HTMLInputElement).type;
              if (t === 'checkbox' || t === 'radio' || t === 'submit') return t;
              if (t === 'button') return 'button';
              return 'textbox';
            }
            return tag;
          }
          function accessibleName(el: Element): string {
            const aria = el.getAttribute('aria-label');
            if (aria) return aria.trim();
            const labelledBy = el.getAttribute('aria-labelledby');
            if (labelledBy) {
              const lbl = document.getElementById(labelledBy);
              if (lbl?.textContent) return lbl.textContent.trim();
            }
            const id = el.getAttribute('id');
            if (id) {
              const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
              if (label?.textContent) return label.textContent.trim();
            }
            const title = el.getAttribute('title');
            if (title) return title.trim();
            const placeholder = el.getAttribute('placeholder');
            if (placeholder && (el as HTMLInputElement).tagName === 'INPUT') return placeholder.trim();
            const alt = el.getAttribute('alt');
            if (alt) return alt.trim();
            const text = (el as HTMLElement).innerText?.trim();
            if (text) return text.slice(0, 80);
            return '';
          }

          const out: Array<Record<string, unknown>> = [];
          let counter = 0;
          for (const el of candidates) {
            if (!includeHidden && !isVisible(el)) continue;
            const refNum = counter++;
            el.setAttribute('data-matrx-ref', String(refNum));
            const entry: Record<string, unknown> = {
              ref: `ref:${refNum}`,
              tag: el.tagName.toLowerCase(),
              role: el.getAttribute('role') ?? implicitRole(el),
              name: accessibleName(el),
            };
            if (includeText) {
              const t = (el as HTMLElement).innerText ?? el.textContent ?? '';
              entry.text = t.length > 200 ? `${t.slice(0, 200)}…` : t;
            }
            if (includeBounds) {
              const r = el.getBoundingClientRect();
              entry.bounds = {
                x: Math.round(r.x),
                y: Math.round(r.y),
                w: Math.round(r.width),
                h: Math.round(r.height),
              };
            }
            // Carry a few key attributes for the agent.
            if (el instanceof HTMLAnchorElement && el.href) entry.href = el.href;
            if (el instanceof HTMLInputElement) {
              entry.type = el.type;
              // Never echo password/secret values back to the agent — the field
              // may be autofilled. Surface presence + length only.
              if (el.type === 'password') {
                entry.value = el.value ? '***' : '';
                if (el.value) entry.value_length = el.value.length;
                entry.masked = true;
              } else {
                entry.value = el.value;
                if (el.type === 'checkbox' || el.type === 'radio') entry.checked = el.checked;
              }
            }
            if (el instanceof HTMLSelectElement) {
              entry.value = el.value;
              entry.option_count = el.options.length;
            }
            const ariaExpanded = el.getAttribute('aria-expanded');
            if (ariaExpanded != null) entry.expanded = ariaExpanded === 'true';
            const disabled = (el as HTMLInputElement).disabled;
            if (disabled) entry.disabled = true;
            out.push(entry);
            if (out.length >= maxNodes) break;
          }
          return {
            ok: true,
            url: location.href,
            title: document.title,
            count: out.length,
            total_candidates: candidates.length,
            elements: out,
          };
        },
        args: [
          interactiveOnly,
          args.include_hidden,
          args.max_nodes,
          args.include_text,
          args.include_bounds,
        ],
      });
      const result = first?.result as CachedScrape['result'] | { ok: false; reason: string } | undefined;
      if (result && 'ok' in result && result.ok) {
        rememberScrape({
          tabId,
          url: result.url,
          ts: Date.now(),
          args: {
            interactive_only: interactiveOnly,
            include_hidden: args.include_hidden,
            include_text: args.include_text,
          },
          result,
        });
      }
      // Canonical max_chars: serialize-then-truncate when an explicit cap is set.
      if (result && 'ok' in result && result.ok && args.max_chars) {
        const serialized = JSON.stringify(result);
        if (serialized.length > args.max_chars) {
          return {
            ...result,
            elements: (result as { elements?: unknown[] }).elements?.slice(
              0,
              Math.max(1, Math.floor(args.max_chars / 200)),
            ),
            truncated: true,
            original_count: (result as { count?: number }).count,
          };
        }
      }
      return result ?? { ok: false, reason: 'no result' };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  },
};

const FindArgs = z.object({
  /** Natural-language description of the element you want. */
  query: z.string().min(1),
  /** Maximum candidates to consider from read_page. Default 30. */
  max_candidates: z.number().int().positive().max(500).optional().default(30),
  /** Maximum matches to return. Default 5. */
  limit: z.number().int().positive().max(20).optional().default(5),
  /** Canonical: target tab. */
  tabId: z.string().optional(),
});
type FindArgs = z.infer<typeof FindArgs>;

/** How many text-similarity-prefiltered candidates we send to the LLM. */
const FIND_AI_CANDIDATES = 20;

export const find: ToolHandler<FindArgs, unknown> = {
  name: 'find',
  tier: 'read',
  description:
    'Find elements on the active page by natural-language description ("the sign-in button", "the search input near the top", "the link to the pricing page"). Returns matching refs you can immediately pass to interaction tools. Uses on-device AI for matching when available; falls back to text similarity. Always run read_page first OR pass refs through this in the same conversation. Returns { matches: [{ ref, name, role, score, reason }] }.',
  argsSchema: FindArgs,
  run: async (args, ctx) => {
    const tabId =
      (args.tabId ? Number.parseInt(args.tabId, 10) : null) ?? (await getAssignedTabId(ctx));
    if (tabId == null || !Number.isFinite(tabId)) return { ok: false, reason: 'No active tab' };

    // Reuse a fresh cached scrape if the agent (or a prior tool call) just ran
    // read_page. Saves the executeScript round-trip + DOM walk on the common
    // path where read_page → find happens within a few seconds.
    let candidates: ScrapeElement[];
    let usedCache = false;
    const cached = getFreshScrape(tabId, {
      interactive_only: true,
      include_text: true,
    });
    if (cached) {
      candidates = cached.result.elements.slice(0, args.max_candidates);
      usedCache = true;
    } else {
      const readResult = (await read_page.run(
        {
          tab_id: tabId,
          interactive_only: true,
          max_nodes: args.max_candidates,
          include_hidden: false,
          include_text: true,
          include_bounds: false,
          trigger_lazy_load: false,
        },
        {
          conversationId: null,
          runId: 'find-internal',
          callId: 'find-internal',
          agentName: null,
          permissionMode: 'act',
        } as never,
      )) as { ok?: boolean; reason?: string; elements?: ScrapeElement[] };
      if (readResult.ok === false) {
        return { ok: false, reason: readResult.reason ?? 'read_page failed' };
      }
      candidates = readResult.elements ?? [];
    }

    if (candidates.length === 0) return { ok: true, matches: [], used_cache: usedCache };

    // Hybrid retrieval: cheap text-similarity prefilter, then send only the
    // top-N to the LLM. Smaller prompt = faster decoding, often better matches
    // because obvious noise is gone before the model sees it.
    const q = args.query.toLowerCase();
    const tokens = q.split(/\s+/).filter((t) => t.length > 1);
    const prefiltered = candidates
      .map((c) => {
        const hay = `${c.name} ${c.role} ${c.tag} ${c.text ?? ''}`.toLowerCase();
        let score = 0;
        for (const t of tokens) if (hay.includes(t)) score += 1 / Math.max(1, tokens.length);
        return { c, score };
      })
      .sort((a, b) => b.score - a.score);
    // Always send something to the AI, even if no token hit (lets Nano handle
    // semantic queries like "the sign-in button" against a "Log in" link).
    const aiCandidates = (
      prefiltered.some((x) => x.score > 0)
        ? prefiltered.filter((x) => x.score > 0).slice(0, FIND_AI_CANDIDATES)
        : prefiltered.slice(0, FIND_AI_CANDIDATES)
    ).map((x) => x.c);

    // Try AI-backed match first.
    const sys =
      'You are a precise element-matching tool. Given a user query and a list of candidate elements (with refs, roles, names, and snippets), pick the best matches. Score 0..1. Return JSON only.';
    const promptText = `Query: ${args.query}\n\nCandidates:\n${aiCandidates
      .map(
        (c) =>
          `${c.ref} role=${c.role} tag=${c.tag} name="${c.name}" text="${(c.text ?? '').slice(0, 100)}"`,
      )
      .join('\n')}`;
    const schema = {
      type: 'object',
      properties: {
        matches: {
          type: 'array',
          maxItems: args.limit,
          items: {
            type: 'object',
            properties: {
              ref: { type: 'string' },
              score: { type: 'number', minimum: 0, maximum: 1 },
              reason: { type: 'string' },
            },
            required: ['ref', 'score'],
            additionalProperties: false,
          },
        },
      },
      required: ['matches'],
      additionalProperties: false,
    };
    const ai = await quickPrompt(promptText, {
      systemPrompt: sys,
      responseConstraint: schema,
    });
    if (ai.ok && ai.data) {
      try {
        const parsed = JSON.parse(ai.data) as {
          matches: Array<{ ref: string; score: number; reason?: string }>;
        };
        const enriched = parsed.matches.slice(0, args.limit).map((m) => {
          const cand = candidates.find((c) => c.ref === m.ref);
          return {
            ref: m.ref,
            score: m.score,
            reason: m.reason,
            name: cand?.name,
            role: cand?.role,
            tag: cand?.tag,
          };
        });
        return { ok: true, mode: 'ai', used_cache: usedCache, matches: enriched };
      } catch {
        // Fall through to text match.
      }
    }

    // Text-similarity fallback. Reuse the prefilter scoring so we don't redo
    // the work — just take the top-K with score > 0.
    const matches = prefiltered
      .filter((x) => x.score > 0)
      .slice(0, args.limit)
      .map((x) => ({
        ref: x.c.ref,
        score: x.score,
        reason: 'text-similarity',
        name: x.c.name,
        role: x.c.role,
        tag: x.c.tag,
      }));
    return { ok: true, mode: 'text', used_cache: usedCache, matches };
  },
};

const PageTextArgs = z
  .object({
    tab_id: z.number().int().optional(),
    /** Canonical alias for tab_id. */
    tabId: z.string().optional(),
    /** Cap on returned text length (chars). Default 8000. */
    max_chars: z.number().int().positive().max(50_000).optional().default(8000),
  })
  .default({});
type PageTextArgs = z.infer<typeof PageTextArgs>;

export const get_page_text: ToolHandler<PageTextArgs, unknown> = {
  name: 'get_page_text',
  tier: 'read',
  description:
    'Extract clean readable text from the active page — strips chrome / nav / ads / scripts / hidden DOM. Lighter than read_active_page (which returns full markdown + media + structured data). Best for "read me this article" style asks. Returns { url, title, byline, text, char_count }.',
  argsSchema: PageTextArgs,
  run: async (args, ctx) => {
    const tabId =
      args.tab_id ??
      (args.tabId ? Number.parseInt(args.tabId, 10) : null) ??
      (await getAssignedTabId(ctx));
    if (tabId == null || !Number.isFinite(tabId))
      return { ok: false, reason: 'No active tab' };
    try {
      const [first] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (maxChars: number) => {
          // Lightweight Readability-style extraction: prefer <main>, <article>,
          // largest text container, then fall back to body. Strip nav/aside/
          // header/footer/script/style.
          function gather(root: Element): string {
            const clone = root.cloneNode(true) as Element;
            const drop = clone.querySelectorAll(
              'nav, aside, header, footer, script, style, noscript, [aria-hidden="true"], [hidden]',
            );
            for (const el of Array.from(drop)) el.remove();
            return ((clone as HTMLElement).innerText ?? '').replace(/\s+\n/g, '\n').trim();
          }
          let target: Element | null = document.querySelector('main, article, [role="main"]');
          if (!target) {
            // Pick the largest text container.
            const candidates = Array.from(
              document.querySelectorAll('article, section, div'),
            ) as HTMLElement[];
            let best: { el: HTMLElement; len: number } | null = null;
            for (const el of candidates) {
              const len = (el.innerText ?? '').length;
              if (len > 500 && (!best || len > best.len)) best = { el, len };
            }
            target = best?.el ?? document.body;
          }
          let text = gather(target);
          if (text.length > maxChars) text = `${text.slice(0, maxChars)}…`;
          const meta = (s: string) =>
            document.querySelector(`meta[name="${s}"], meta[property="${s}"]`)?.getAttribute(
              'content',
            ) ?? null;
          return {
            ok: true,
            url: location.href,
            title: document.title,
            byline:
              meta('author') ??
              meta('article:author') ??
              document.querySelector('[rel="author"]')?.textContent?.trim() ??
              null,
            text,
            char_count: text.length,
          };
        },
        args: [args.max_chars],
      });
      return first?.result ?? { ok: false, reason: 'no result' };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  },
};

export const page_ref_handlers = [read_page, find, get_page_text];
