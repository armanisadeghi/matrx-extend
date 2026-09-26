/**
 * The extension's materializer: a captured page → the portions the landing
 * door stores (SOURCE-CONVERGENCE §3.3, "Web page (extension)").
 *
 * A Source is stored as addressable portions so a citation can open the exact
 * passage. For a web page a portion is a SECTION: everything from one H1–H3
 * heading to the next, addressed by its heading path plus the first 80
 * characters of its text (the locator the door validates:
 * `{"heading_path": [...], "text_fragment": "..."}`).
 *
 * Order of preference, as the plan fixes it:
 *   1. the sanitized article HTML (`article.content_html_safe`), split at H1–H3;
 *   2. the article markdown (`article.content_markdown`), split at ATX `#`–`###`.
 * A page with no headings is ONE section with an empty heading path. Pure,
 * free, no model — landing runs no AI.
 */

import type { SoupResult } from '@/lib/scrape/pipeline';

export interface SectionLocator {
  heading_path: string[];
  text_fragment: string;
}

export interface SectionPortion {
  ordinal: number;
  kind: 'section';
  text: string;
  locator: SectionLocator;
  method: string;
}

export type PortionSourceField = 'article_html' | 'article_markdown';

export interface CapturePortions {
  portions: SectionPortion[];
  /** Which field the portions were cut from (null when the capture had no text). */
  from: PortionSourceField | null;
}

const FRAGMENT_CHARS = 80;
const HEADING_TAGS: Record<string, number> = { H1: 1, H2: 2, H3: 3 };
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT']);
const BLOCK_TAGS = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'BR',
  'DD',
  'DIV',
  'DL',
  'DT',
  'FIGCAPTION',
  'FIGURE',
  'FOOTER',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'HR',
  'LI',
  'MAIN',
  'NAV',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'TABLE',
  'TD',
  'TH',
  'TR',
  'UL',
]);

interface Draft {
  path: string[];
  lines: string[];
}

function tidyLines(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.replace(/[\s ]+/g, ' ').trim())
    .filter((line) => line.length > 0);
}

function fragmentOf(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, FRAGMENT_CHARS);
}

function nextPath(stack: (string | undefined)[], level: number, heading: string): string[] {
  stack.length = level - 1;
  stack[level - 1] = heading;
  return stack.filter((h): h is string => typeof h === 'string' && h.length > 0);
}

function finish(drafts: Draft[], joiner: string): SectionPortion[] {
  const out: SectionPortion[] = [];
  for (const draft of drafts) {
    const text = draft.lines.join(joiner).trim();
    if (!text) continue;
    out.push({
      ordinal: out.length + 1,
      kind: 'section',
      text,
      locator: { heading_path: draft.path, text_fragment: fragmentOf(text) },
      method: 'native',
    });
  }
  return out;
}

/** Split sanitized article HTML at H1–H3 into plain-text sections. */
export function portionsFromArticleHtml(html: string | null | undefined): SectionPortion[] {
  if (!html?.trim() || typeof DOMParser === 'undefined') return [];
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const stack: (string | undefined)[] = [];
  const drafts: Draft[] = [{ path: [], lines: [] }];
  let buffer = '';

  const flushBuffer = () => {
    const current = drafts[drafts.length - 1];
    if (current) current.lines.push(...tidyLines(buffer));
    buffer = '';
  };

  const visit = (node: Node) => {
    if (node.nodeType === 3) {
      buffer += node.textContent ?? '';
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    if (SKIP_TAGS.has(tag)) return;
    const level = HEADING_TAGS[tag];
    if (level !== undefined) {
      flushBuffer();
      const heading = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (!heading) return;
      drafts.push({ path: nextPath(stack, level, heading), lines: [heading] });
      return;
    }
    const block = BLOCK_TAGS.has(tag);
    if (block) buffer += '\n';
    for (const child of Array.from(el.childNodes)) visit(child);
    if (block) buffer += '\n';
  };

  for (const child of Array.from(doc.body.childNodes)) visit(child);
  flushBuffer();
  return finish(drafts, '\n');
}

const ATX = /^ {0,3}(#{1,3})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;
const FENCE = /^ {0,3}(```|~~~)/;

/** Split markdown at ATX `#`, `##`, `###` headings (never inside a fenced code block). */
export function portionsFromMarkdown(markdown: string | null | undefined): SectionPortion[] {
  if (!markdown?.trim()) return [];
  const stack: (string | undefined)[] = [];
  const drafts: Draft[] = [{ path: [], lines: [] }];
  let fence: string | null = null;
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1] ?? '';
      fence = fence === null ? marker : fence === marker ? null : fence;
    }
    const heading = fence === null && !fenceMatch ? ATX.exec(line) : null;
    if (heading) {
      const level = (heading[1] ?? '#').length;
      const title = (heading[2] ?? '').trim();
      drafts.push({ path: nextPath(stack, level, title), lines: [line.trim()] });
      continue;
    }
    drafts[drafts.length - 1]?.lines.push(line);
  }
  return finish(drafts, '\n');
}

/** The portions for a capture: article HTML first, the article markdown as the fallback. */
export function buildCapturePortions(soup: Pick<SoupResult, 'article'>): CapturePortions {
  const fromHtml = portionsFromArticleHtml(soup.article.content_html_safe);
  if (fromHtml.length > 0) return { portions: fromHtml, from: 'article_html' };
  const fromMarkdown = portionsFromMarkdown(soup.article.content_markdown);
  if (fromMarkdown.length > 0) return { portions: fromMarkdown, from: 'article_markdown' };
  return { portions: [], from: null };
}
