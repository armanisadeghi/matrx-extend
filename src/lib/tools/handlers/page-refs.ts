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
import type { ToolHandler } from '@/lib/tools/types';
import { z } from 'zod';

async function activeTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

/** Convert ref string ("ref:42" or "42") to the data-attribute selector. */
export function refToSelector(ref: string): string {
  const n = ref.startsWith('ref:') ? ref.slice(4) : ref;
  return `[data-matrx-ref="${n.replace(/"/g, '\\"')}"]`;
}

const ReadPageArgs = z
  .object({
    tab_id: z.number().int().optional(),
    /** Only return interactive elements (links, buttons, inputs, etc.). Default true. */
    interactive_only: z.boolean().optional().default(true),
    /** Include hidden elements. Default false (visible only). */
    include_hidden: z.boolean().optional().default(false),
    /** Maximum elements to return. Default 200. */
    max_nodes: z.number().int().positive().max(2000).optional().default(200),
    /** Include the page's text content for each element. Default true. */
    include_text: z.boolean().optional().default(true),
    /** Include bounding rectangles. Default false (saves tokens). */
    include_bounds: z.boolean().optional().default(false),
  })
  .default({});
type ReadPageArgs = z.infer<typeof ReadPageArgs>;

export const read_page: ToolHandler<ReadPageArgs, unknown> = {
  name: 'read_page',
  tier: 'read',
  description:
    'Return an accessibility-style summary of the active page. Each interactive element gets a reference id (`ref:N`) you can pass to click_element / type_into_element / scroll_into_view / etc. instead of a CSS selector — refs are stable across DOM mutations within the same page lifetime. Pass interactive_only=false to include headings, paragraphs, and labels too. Refs invalidate on navigation; call this again after navigating. Returns { url, title, count, elements: [{ ref, role, name, tag, text, visible, bounds? }] }.',
  argsSchema: ReadPageArgs,
  run: async (args) => {
    const tabId = args.tab_id ?? (await activeTabId());
    if (tabId == null) return { ok: false, reason: 'No active tab' };
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
              entry.value = el.value;
              if (el.type === 'checkbox' || el.type === 'radio') entry.checked = el.checked;
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
          args.interactive_only,
          args.include_hidden,
          args.max_nodes,
          args.include_text,
          args.include_bounds,
        ],
      });
      return first?.result ?? { ok: false, reason: 'no result' };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  },
};

const FindArgs = z.object({
  /** Natural-language description of the element you want. */
  query: z.string().min(1),
  /** Maximum candidates to consider from read_page. Default 100. */
  max_candidates: z.number().int().positive().max(500).optional().default(100),
  /** Maximum matches to return. Default 5. */
  limit: z.number().int().positive().max(20).optional().default(5),
});
type FindArgs = z.infer<typeof FindArgs>;

export const find: ToolHandler<FindArgs, unknown> = {
  name: 'find',
  tier: 'read',
  description:
    'Find elements on the active page by natural-language description ("the sign-in button", "the search input near the top", "the link to the pricing page"). Returns matching refs you can immediately pass to interaction tools. Uses on-device AI for matching when available; falls back to text similarity. Always run read_page first OR pass refs through this in the same conversation. Returns { matches: [{ ref, name, role, score, reason }] }.',
  argsSchema: FindArgs,
  run: async (args) => {
    const tabId = await activeTabId();
    if (tabId == null) return { ok: false, reason: 'No active tab' };

    // Re-read so refs are fresh.
    const readResult = (await read_page.run(
      {
        tab_id: tabId,
        interactive_only: true,
        max_nodes: args.max_candidates,
        include_hidden: false,
        include_text: true,
        include_bounds: false,
      },
      {
        conversationId: null,
        runId: 'find-internal',
        callId: 'find-internal',
        agentName: null,
        permissionMode: 'act',
      } as never,
    )) as {
      ok?: boolean;
      reason?: string;
      elements?: Array<{
        ref: string;
        name: string;
        role: string;
        tag: string;
        text?: string;
      }>;
    };
    if (readResult.ok === false) {
      return { ok: false, reason: readResult.reason ?? 'read_page failed' };
    }
    const candidates = readResult.elements ?? [];
    if (candidates.length === 0) return { ok: true, matches: [] };

    // Try AI-backed match first.
    const indexed = candidates.map((e, i) => ({
      idx: i,
      ref: e.ref,
      role: e.role,
      name: e.name,
      tag: e.tag,
      snippet: (e.text ?? '').slice(0, 100),
    }));
    const sys =
      'You are a precise element-matching tool. Given a user query and a list of candidate elements (with refs, roles, names, and snippets), pick the best matches. Score 0..1. Return JSON only.';
    const promptText = `Query: ${args.query}\n\nCandidates:\n${indexed
      .map(
        (c) =>
          `${c.ref} role=${c.role} tag=${c.tag} name="${c.name}" text="${c.snippet}"`,
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
        const enriched = parsed.matches
          .slice(0, args.limit)
          .map((m) => {
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
        return { ok: true, mode: 'ai', matches: enriched };
      } catch {
        // Fall through to text match.
      }
    }

    // Text-similarity fallback. Naive but useful when on-device AI is missing.
    const q = args.query.toLowerCase();
    const tokens = q.split(/\s+/).filter((t) => t.length > 1);
    const scored = candidates.map((c) => {
      const hay = `${c.name} ${c.role} ${c.tag} ${c.text ?? ''}`.toLowerCase();
      let score = 0;
      for (const t of tokens) if (hay.includes(t)) score += 1 / tokens.length;
      return {
        ref: c.ref,
        score,
        reason: 'text-similarity',
        name: c.name,
        role: c.role,
        tag: c.tag,
      };
    });
    scored.sort((a, b) => b.score - a.score);
    const matches = scored.filter((m) => m.score > 0).slice(0, args.limit);
    return { ok: true, mode: 'text', matches };
  },
};

const PageTextArgs = z
  .object({
    tab_id: z.number().int().optional(),
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
  run: async (args) => {
    const tabId = args.tab_id ?? (await activeTabId());
    if (tabId == null) return { ok: false, reason: 'No active tab' };
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
