/**
 * Page inspection tools — surgical alternatives to read_active_page when the
 * agent only needs a slice of the page.
 *
 *   find_text_on_page    (read) — locate text in the DOM, return matches with
 *                                 a stable selector + surrounding context.
 *   get_page_links       (read) — return links from the page, filtered.
 *   get_computed_style   (read) — read computed CSS for an element.
 *   get_element_at_point (read) — DOM element at viewport (x, y).
 *   inspect_element      (read) — snapshot of one element: tag, attrs,
 *                                 bounding rect, computed style, ancestor
 *                                 chain.
 */

import { SENSITIVE_ATTR, sensitiveSelectorsForTab } from '@/lib/credentials/sensitive-fields';
import { getAssignedTabId } from '@/lib/tools/handlers/_active-tab';
import type { ToolHandler } from '@/lib/tools/types';
import { z } from 'zod';

const FindTextArgs = z.object({
  query: z.string().min(1),
  /** Canonical: target tab. */
  tab_id: z.string().optional(),
  /** Case-sensitive match. Default false. */
  case_sensitive: z.boolean().optional().default(false),
  /** Treat `query` as a regex. Default false. */
  regex: z.boolean().optional().default(false),
  /** Cap on returned matches. Default 20. */
  limit: z.number().int().positive().max(100).optional().default(20),
  /** Characters of surrounding context to include. Default 80. */
  context_chars: z.number().int().min(0).max(500).optional().default(80),
});
type FindTextArgs = z.infer<typeof FindTextArgs>;

export const find_text_on_page: ToolHandler<FindTextArgs, unknown> = {
  name: 'find_text_on_page',
  tier: 'read',
  argsSchema: FindTextArgs,
  run: async (args, ctx) => {
    const tabId =
      (args.tab_id ? Number.parseInt(args.tab_id, 10) : null) ?? (await getAssignedTabId(ctx));
    if (tabId == null || !Number.isFinite(tabId)) return { ok: false, reason: 'No active tab' };
    const [first] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (
        query: string,
        caseSensitive: boolean,
        useRegex: boolean,
        limit: number,
        ctxChars: number,
      ) => {
        function uniqueSelector(el: Element): string {
          if ('id' in el && (el as { id: string }).id) {
            return `#${CSS.escape((el as { id: string }).id)}`;
          }
          const parts: string[] = [];
          let n: Element | null = el;
          while (n && n !== document.body && parts.length < 6) {
            const current: Element = n;
            const tag = current.tagName.toLowerCase();
            const parent = current.parentElement;
            if (!parent) {
              parts.unshift(tag);
              break;
            }
            const siblings = Array.from(parent.children).filter(
              (c: Element) => c.tagName === current.tagName,
            );
            const idx = siblings.indexOf(current) + 1;
            parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${idx})` : tag);
            n = parent;
          }
          return parts.join(' > ');
        }
        let regex: RegExp;
        try {
          regex = useRegex
            ? new RegExp(query, caseSensitive ? 'g' : 'gi')
            : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'g' : 'gi');
        } catch (err) {
          return { ok: false, reason: `bad regex: ${(err as Error).message}` };
        }

        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
          acceptNode: (node) => {
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            const tag = parent.tagName.toLowerCase();
            if (tag === 'script' || tag === 'style' || tag === 'noscript') {
              return NodeFilter.FILTER_REJECT;
            }
            const style = window.getComputedStyle(parent);
            if (style.visibility === 'hidden' || style.display === 'none') {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
          },
        });
        const matches: Array<Record<string, unknown>> = [];
        let node: Node | null;
        while ((node = walker.nextNode())) {
          const text = node.textContent ?? '';
          if (!text.trim()) continue;
          regex.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = regex.exec(text))) {
            const start = Math.max(0, m.index - ctxChars);
            const end = Math.min(text.length, m.index + m[0].length + ctxChars);
            matches.push({
              text: m[0],
              context: text.slice(start, end).replace(/\s+/g, ' ').trim(),
              selector: uniqueSelector(node.parentElement!),
              tag: node.parentElement?.tagName.toLowerCase(),
            });
            if (matches.length >= limit) break;
            if (m[0].length === 0) regex.lastIndex++;
          }
          if (matches.length >= limit) break;
        }
        return { count: matches.length, matches };
      },
      args: [args.query, args.case_sensitive, args.regex, args.limit, args.context_chars],
    });
    return first?.result ?? { count: 0, matches: [] };
  },
};

const GetLinksArgs = z
  .object({
    /** Substring (or full URL prefix) the href must contain. */
    href_contains: z.string().optional(),
    /** Only links whose text matches this substring. Case-insensitive. */
    text_contains: z.string().optional(),
    /** Only links whose href is on the SAME origin as the page. Default false. */
    same_origin_only: z.boolean().optional().default(false),
    /** Cap on returned links. Default 200. */
    limit: z.number().int().positive().max(2000).optional().default(200),
  })
  .default({});
type GetLinksArgs = z.infer<typeof GetLinksArgs>;

export const get_page_links: ToolHandler<GetLinksArgs, unknown> = {
  name: 'get_page_links',
  tier: 'read',
  argsSchema: GetLinksArgs,
  run: async (args, ctx) => {
    const tabId = await getAssignedTabId(ctx);
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    const [first] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (
        hrefContains: string | null,
        textContains: string | null,
        sameOriginOnly: boolean,
        limit: number,
      ) => {
        const hrefSub = hrefContains?.toLowerCase();
        const textSub = textContains?.toLowerCase();
        const origin = location.origin;
        const out: Array<Record<string, unknown>> = [];
        const links = document.querySelectorAll('a[href]');
        for (const a of Array.from(links)) {
          const el = a as HTMLAnchorElement;
          const href = el.href;
          if (!href || href.startsWith('javascript:')) continue;
          if (hrefSub && !href.toLowerCase().includes(hrefSub)) continue;
          const text = (el.innerText ?? el.textContent ?? '').trim();
          if (textSub && !text.toLowerCase().includes(textSub)) continue;
          if (sameOriginOnly) {
            try {
              if (new URL(href).origin !== origin) continue;
            } catch {
              continue;
            }
          }
          out.push({
            href,
            text: text.slice(0, 200),
            title: el.title || null,
            rel: el.rel || null,
            target: el.target || null,
          });
          if (out.length >= limit) break;
        }
        return { count: out.length, total: links.length, links: out };
      },
      args: [
        args.href_contains ?? null,
        args.text_contains ?? null,
        args.same_origin_only,
        args.limit,
      ],
    });
    return first?.result ?? { count: 0, links: [] };
  },
};

const ComputedStyleArgs = z.object({
  selector: z.string().min(1),
  /** List of CSS properties to read. Empty = useful default set. */
  properties: z.array(z.string()).optional(),
});
type ComputedStyleArgs = z.infer<typeof ComputedStyleArgs>;

export const get_computed_style: ToolHandler<ComputedStyleArgs, unknown> = {
  name: 'get_computed_style',
  tier: 'read',
  argsSchema: ComputedStyleArgs,
  run: async (args, ctx) => {
    const tabId = await getAssignedTabId(ctx);
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    const [first] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (selector: string, props: string[] | null) => {
        const el = document.querySelector(selector) as HTMLElement | null;
        if (!el) return { ok: false, reason: `No element at ${selector}` };
        const cs = window.getComputedStyle(el);
        const list =
          props && props.length > 0
            ? props
            : [
                'color',
                'background-color',
                'font-family',
                'font-size',
                'font-weight',
                'line-height',
                'padding',
                'margin',
                'border',
                'border-radius',
                'display',
                'position',
                'width',
                'height',
                'opacity',
                'visibility',
                'z-index',
              ];
        const styles: Record<string, string> = {};
        for (const p of list) styles[p] = cs.getPropertyValue(p);
        const rect = el.getBoundingClientRect();
        return {
          ok: true,
          tag: el.tagName.toLowerCase(),
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          styles,
        };
      },
      args: [args.selector, args.properties ?? null],
    });
    return first?.result ?? { ok: false, reason: 'no result' };
  },
};

const ElementAtPointArgs = z.object({
  x: z.number(),
  y: z.number(),
});
type ElementAtPointArgs = z.infer<typeof ElementAtPointArgs>;

export const get_element_at_point: ToolHandler<ElementAtPointArgs, unknown> = {
  name: 'get_element_at_point',
  tier: 'read',
  argsSchema: ElementAtPointArgs,
  run: async (args, ctx) => {
    const tabId = await getAssignedTabId(ctx);
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    const [first] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (x: number, y: number, sensitiveSelectors: string[], sensitiveAttr: string) => {
        // Redaction is the OR of three signals — marker attribute, the
        // extension's own filled-field memory, and the legacy live
        // `type === 'password'` check. See src/lib/credentials/sensitive-fields.ts.
        const sensitiveEls = new Set<Element>();
        for (const s of sensitiveSelectors) {
          try {
            for (const e of Array.from(document.querySelectorAll(s))) sensitiveEls.add(e);
          } catch {
            /* a selector that no longer parses simply matches nothing */
          }
        }
        function uniqueSelector(el: Element): string {
          if ('id' in el && (el as { id: string }).id) {
            return `#${CSS.escape((el as { id: string }).id)}`;
          }
          const parts: string[] = [];
          let n: Element | null = el;
          while (n && n !== document.body && parts.length < 6) {
            const current: Element = n;
            const tag = current.tagName.toLowerCase();
            const parent = current.parentElement;
            if (!parent) {
              parts.unshift(tag);
              break;
            }
            const siblings = Array.from(parent.children).filter(
              (c: Element) => c.tagName === current.tagName,
            );
            const idx = siblings.indexOf(current) + 1;
            parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${idx})` : tag);
            n = parent;
          }
          return parts.join(' > ');
        }
        const el = document.elementFromPoint(x, y);
        if (!el) return { ok: false, reason: 'No element at that point' };
        const isPassword =
          el.hasAttribute(sensitiveAttr) ||
          sensitiveEls.has(el) ||
          (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'password');
        const attrs: Record<string, string> = {};
        for (const a of Array.from(el.attributes)) {
          attrs[a.name] = isPassword && a.name === 'value' ? '***' : a.value;
        }
        return {
          ok: true,
          tag: el.tagName.toLowerCase(),
          text: ((el as HTMLElement).innerText ?? '').slice(0, 200),
          selector: uniqueSelector(el),
          attrs,
          ...(isPassword ? { masked: true } : {}),
        };
      },
      args: [args.x, args.y, sensitiveSelectorsForTab(tabId), SENSITIVE_ATTR],
    });
    return first?.result ?? { ok: false, reason: 'no result' };
  },
};

const InspectArgs = z.object({ selector: z.string().min(1) });
type InspectArgs = z.infer<typeof InspectArgs>;

export const inspect_element: ToolHandler<InspectArgs, unknown> = {
  name: 'inspect_element',
  tier: 'read',
  argsSchema: InspectArgs,
  run: async (args, ctx) => {
    const tabId = await getAssignedTabId(ctx);
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    const [first] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (selector: string, sensitiveSelectors: string[], sensitiveAttr: string) => {
        // Redaction is the OR of three signals — marker attribute, the
        // extension's own filled-field memory, and the legacy live
        // `type === 'password'` check. See src/lib/credentials/sensitive-fields.ts.
        const sensitiveEls = new Set<Element>();
        for (const s of sensitiveSelectors) {
          try {
            for (const e of Array.from(document.querySelectorAll(s))) sensitiveEls.add(e);
          } catch {
            /* a selector that no longer parses simply matches nothing */
          }
        }
        const el = document.querySelector(selector) as HTMLElement | null;
        if (!el) return { ok: false, reason: `No element at ${selector}` };
        const isPassword =
          el.hasAttribute(sensitiveAttr) ||
          sensitiveEls.has(el) ||
          (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'password');
        const attrs: Record<string, string> = {};
        for (const a of Array.from(el.attributes)) {
          attrs[a.name] = isPassword && a.name === 'value' ? '***' : a.value;
        }
        const cs = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const ancestors: Array<{ tag: string; classes: string[]; id: string | null }> = [];
        let node: Element | null = el.parentElement;
        let depth = 0;
        while (node && depth < 6 && node !== document.body) {
          ancestors.push({
            tag: node.tagName.toLowerCase(),
            classes: Array.from(node.classList),
            id: node.id || null,
          });
          node = node.parentElement;
          depth++;
        }
        return {
          ok: true,
          tag: el.tagName.toLowerCase(),
          text: (el.innerText ?? '').slice(0, 400),
          attrs,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          visible: rect.width > 0 && rect.height > 0,
          styles: {
            display: cs.display,
            visibility: cs.visibility,
            opacity: cs.opacity,
            position: cs.position,
            'pointer-events': cs.pointerEvents,
          },
          child_count: el.childElementCount,
          ancestors,
        };
      },
      args: [args.selector, sensitiveSelectorsForTab(tabId), SENSITIVE_ATTR],
    });
    return first?.result ?? { ok: false, reason: 'no result' };
  },
};

// Canonical version (browser_tools_canonical.json:get_element_details).
// Takes a ref (preferred) instead of a CSS selector, and gates the heavy
// fields (innerHTML, computed styles) behind opt-in flags. The handler
// shares its core probe logic with inspect_element but is registered
// separately so the canonical tool catalog has the exact name.
const ElementDetailsArgs = z.object({
  tab_id: z.string().optional(),
  ref: z.string(),
  include_html: z.boolean().default(false),
  include_styles: z.boolean().default(false),
});
type ElementDetailsArgs = z.infer<typeof ElementDetailsArgs>;

export const get_element_details: ToolHandler<ElementDetailsArgs, unknown> = {
  name: 'get_element_details',
  tier: 'read',
  argsSchema: ElementDetailsArgs,
  run: async (args, ctx) => {
    let tabId: number | null;
    if (args.tab_id) {
      tabId = Number.parseInt(args.tab_id, 10);
      if (!Number.isFinite(tabId)) return { ok: false, reason: 'Invalid tabId' };
    } else {
      tabId = await getAssignedTabId(ctx);
    }
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    const refSelector = `[data-matrx-ref="${args.ref.replace(/^ref:/, '')}"]`;
    const [first] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (
        selector: string,
        includeHtml: boolean,
        includeStyles: boolean,
        sensitiveSelectors: string[],
        sensitiveAttr: string,
      ) => {
        // Redaction is the OR of three signals — marker attribute, the
        // extension's own filled-field memory, and the legacy live
        // `type === 'password'` check. See src/lib/credentials/sensitive-fields.ts.
        const sensitiveEls = new Set<Element>();
        for (const s of sensitiveSelectors) {
          try {
            for (const e of Array.from(document.querySelectorAll(s))) sensitiveEls.add(e);
          } catch {
            /* a selector that no longer parses simply matches nothing */
          }
        }
        const isSensitiveEl = (e: Element): boolean =>
          e.hasAttribute(sensitiveAttr) ||
          sensitiveEls.has(e) ||
          (e.tagName === 'INPUT' && (e as HTMLInputElement).type === 'password');
        const el = document.querySelector(selector) as HTMLElement | null;
        if (!el) return { ok: false, reason: `No element for ${selector}` };
        const isPassword = isSensitiveEl(el);
        const attrs: Record<string, string> = {};
        for (const a of Array.from(el.attributes)) {
          attrs[a.name] = isPassword && a.name === 'value' ? '***' : a.value;
        }
        const rect = el.getBoundingClientRect();
        const cs = window.getComputedStyle(el);
        const out: Record<string, unknown> = {
          ok: true,
          tag: el.tagName.toLowerCase(),
          text: (el.innerText ?? '').slice(0, 400),
          attrs,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          visible:
            rect.width > 0 &&
            rect.height > 0 &&
            cs.display !== 'none' &&
            cs.visibility !== 'hidden' &&
            cs.opacity !== '0',
          child_count: el.childElementCount,
        };
        if (includeStyles) {
          out.styles = {
            display: cs.display,
            visibility: cs.visibility,
            opacity: cs.opacity,
            position: cs.position,
            'pointer-events': cs.pointerEvents,
            color: cs.color,
            'background-color': cs.backgroundColor,
            font: cs.font,
            'z-index': cs.zIndex,
          };
        }
        if (includeHtml) {
          const cap = 50 * 1024;
          // Serialize from a CLONE whose sensitive descendants have their
          // `value` attribute masked — otherwise a subtree containing a
          // filled login field could round-trip the value as markup.
          let html: string;
          const descendants = Array.from(el.querySelectorAll('*'));
          if (descendants.some(isSensitiveEl)) {
            const clone = el.cloneNode(true) as HTMLElement;
            const originals = [el, ...descendants];
            const copies = [clone, ...Array.from(clone.querySelectorAll('*'))];
            for (let i = 0; i < originals.length; i++) {
              const orig = originals[i];
              const copy = copies[i];
              if (!orig || !copy) continue;
              if (isSensitiveEl(orig) && copy.hasAttribute('value')) {
                copy.setAttribute('value', '***');
              }
            }
            html = clone.innerHTML ?? '';
            out.html_redacted = true;
          } else {
            html = el.innerHTML ?? '';
          }
          if (html.length > cap) {
            out.innerHTML = html.slice(0, cap);
            out.truncated = true;
          } else {
            out.innerHTML = html;
          }
        }
        return out;
      },
      args: [
        refSelector,
        args.include_html,
        args.include_styles,
        sensitiveSelectorsForTab(tabId),
        SENSITIVE_ATTR,
      ],
    });
    return first?.result ?? { ok: false, reason: 'no result' };
  },
};

export const inspect_handlers = [
  find_text_on_page,
  get_page_links,
  get_computed_style,
  get_element_at_point,
  inspect_element,
  get_element_details,
];
