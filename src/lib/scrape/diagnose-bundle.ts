/**
 * Diagnose-picker payload + bundle builder.
 *
 * Two halves:
 *   - `capturePickPayload(el)` runs in the content-script (needs DOM) and
 *     captures everything an LLM needs to reason about WHY this element
 *     is or isn't in the scrape. Selectors are cheap, so we collect many.
 *     HTML is expensive, so each layer has a byte cap.
 *   - `formatDiagnoseBundle(args)` runs in the sidepanel and composes the
 *     final `wrapForAgent`-flavored string — adds the user's note, the
 *     mode (missing / unwanted), and an excerpt from the current scrape
 *     markdown so the LLM can see what we *did* capture for comparison.
 *
 * The single most useful signal we can produce: if the picked element's
 * text doesn't appear in the current scrape markdown, that is itself
 * strong evidence we lost it during extraction. We call that out
 * explicitly in the bundle so the LLM doesn't have to figure it out.
 */

import { wrapForAgent } from '@/lib/clipboard/copy';
import { elementPathSelector, inferListPattern } from '@/lib/data-pattern/selector-resilience';

export type DiagnoseMode = 'missing' | 'unwanted';

export interface DiagnosePickPayload {
  /** Full path selectors, leaf → ancestor (up to 6 levels). */
  selectorChain: string[];
  leafTag: string;
  leafHtml: string;
  leafTruncated: boolean;
  parentHtml: string | null;
  parentTruncated: boolean;
  /** One sibling's outerHTML, included only when the leaf looks like a list item. */
  siblingHtml: string | null;
  siblingTruncated: boolean;
  /** Number of similar siblings detected at the list level (0 if none). */
  siblingCount: number;
  /** Short text excerpt for display in the side-panel card. */
  leafTextPreview: string;
  /**
   * Anchor candidates for searching the scrape markdown. Ordered by specificity
   * (leaf textContent first, then parent, then grandparent). Sidepanel picks
   * the first one that's distinctive enough to find a match.
   */
  anchorCandidates: string[];
  pickedAtUrl: string;
  pickedAtTitle: string;
}

/** Final result stored in zustand after a successful pick. */
export interface DiagnoseResult extends DiagnosePickPayload {
  mode: DiagnoseMode;
  capturedAt: number;
}

const LEAF_CAP = 3072;
const PARENT_CAP = 2048;
const SIBLING_CAP = 1536;
const MAX_SELECTOR_DEPTH = 6;
const ANCHOR_CANDIDATE_COUNT = 4;
const MARKDOWN_EXCERPT_RADIUS = 400;

// =============================================================================
// Page-side capture (runs in the picker content script)
// =============================================================================

/**
 * Capture everything we'll need about a picked element. Pure read-only over
 * the live DOM — no network, no mutation, no async.
 */
export function capturePickPayload(el: Element): DiagnosePickPayload {
  const selectorChain = buildSelectorChain(el, MAX_SELECTOR_DEPTH);
  const leafOuter = el.outerHTML;
  const leaf = capHtml(leafOuter, LEAF_CAP);

  // Parent HTML — only if including it keeps us under a soft total budget.
  // The thinking: if the leaf is already big, the parent is bigger still,
  // and the LLM gets more from one focused leaf than two truncated layers.
  const parentEl = el.parentElement;
  let parentHtml: string | null = null;
  let parentTruncated = false;
  if (parentEl && leafOuter.length < 2500) {
    const cap = capHtml(parentEl.outerHTML, PARENT_CAP);
    parentHtml = cap.html;
    parentTruncated = cap.truncated;
  }

  // Sibling example — useful when the picked element is one of N similar
  // cards (a list item). We pick a different sibling so the LLM sees the
  // pattern, not a duplicate of what's already in `leafHtml`.
  let siblingHtml: string | null = null;
  let siblingTruncated = false;
  let siblingCount = 0;
  const list = inferListPattern(el);
  if (list && leafOuter.length < 2000) {
    siblingCount = list.itemCount;
    const sample = pickSibling(list.sampleItem);
    if (sample) {
      const cap = capHtml(sample.outerHTML, SIBLING_CAP);
      siblingHtml = cap.html;
      siblingTruncated = cap.truncated;
    }
  }

  return {
    selectorChain,
    leafTag: el.tagName.toLowerCase(),
    leafHtml: leaf.html,
    leafTruncated: leaf.truncated,
    parentHtml,
    parentTruncated,
    siblingHtml,
    siblingTruncated,
    siblingCount,
    leafTextPreview: trimWhitespace(el.textContent ?? '').slice(0, 120),
    anchorCandidates: collectAnchorCandidates(el),
    pickedAtUrl: window.location.href,
    pickedAtTitle: document.title,
  };
}

function buildSelectorChain(el: Element, maxDepth: number): string[] {
  const out: string[] = [];
  let node: Element | null = el;
  let i = 0;
  while (node && i < maxDepth) {
    try {
      out.push(elementPathSelector(node, 5));
    } catch {
      // selector generation can fail on exotic elements; skip rather than die
    }
    const next: Element | null = node.parentElement;
    if (!next || next === document.documentElement || next === document.body) break;
    node = next;
    i++;
  }
  return out;
}

function pickSibling(sample: Element): Element | null {
  const parent = sample.parentElement;
  if (!parent) return null;
  const sibs = Array.from(parent.children).filter(
    (c) => c.tagName === sample.tagName && c !== sample,
  );
  // Prefer the one with the most text content — likely the most informative.
  let best: Element | null = null;
  let bestLen = -1;
  for (const s of sibs) {
    const len = (s.textContent ?? '').length;
    if (len > bestLen) {
      bestLen = len;
      best = s;
    }
  }
  return best;
}

/**
 * Pull progressively-broader text snippets from the picked element and its
 * ancestors. The sidepanel uses these in order to find a match in the
 * scraped markdown — the first one to match defines the excerpt window.
 */
function collectAnchorCandidates(el: Element): string[] {
  const out: string[] = [];
  let node: Element | null = el;
  let i = 0;
  while (node && i < ANCHOR_CANDIDATE_COUNT) {
    const text = trimWhitespace(node.textContent ?? '');
    // Skip if too short (won't disambiguate) or absurdly long (likely whole page).
    if (text.length >= 8 && text.length <= 400) {
      out.push(text);
    }
    node = node.parentElement;
    i++;
  }
  return out;
}

function trimWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function capHtml(html: string, cap: number): { html: string; truncated: boolean } {
  if (html.length <= cap) return { html, truncated: false };
  return {
    html: `${html.slice(0, cap)}\n<!-- …truncated; original ${html.length} bytes -->`,
    truncated: true,
  };
}

// =============================================================================
// Sidepanel-side bundle composition
// =============================================================================

export interface FormatBundleArgs {
  result: DiagnoseResult;
  userNote: string;
  /** Article markdown from the current scrape (may be null if not captured). */
  scrapeMarkdown: string | null;
  /** Source extractor used (defuddle / readability / fallback / null). */
  extractor: string | null;
  /** Active scrape mode at the time of last capture. */
  scrapeMode: string | null;
  capturedAt?: number | null;
}

/**
 * Compose the final string a user can paste into an LLM chat. Built on top
 * of `wrapForAgent` so the format matches every other "Copy for AI" output
 * in the extension.
 */
export function formatDiagnoseBundle(args: FormatBundleArgs): string {
  const { result, userNote, scrapeMarkdown, extractor, scrapeMode } = args;
  const lines: string[] = [];

  lines.push(`**Mode:** ${result.mode === 'missing' ? 'Missing element' : 'Unwanted element'}`);
  lines.push('');
  lines.push('**User note:**');
  lines.push(userNote.trim() || '_(none provided)_');
  lines.push('');

  // Page context — small, always included.
  lines.push('**Page:**');
  lines.push(`- URL: ${result.pickedAtUrl}`);
  lines.push(`- Title: ${result.pickedAtTitle}`);
  if (scrapeMode) lines.push(`- Scrape mode: ${scrapeMode}`);
  if (extractor) lines.push(`- Article extractor used: ${extractor}`);
  lines.push('');

  // Selector chain — also small, always included.
  lines.push('**Selector chain** (leaf → ancestors):');
  result.selectorChain.forEach((sel, i) => {
    lines.push(`- L${i}: \`${sel}\``);
  });
  lines.push('');

  // Sibling-pattern hint
  if (result.siblingCount > 0) {
    lines.push(
      `**Repeating siblings detected:** the picked element appears to be one of ${result.siblingCount} similar items.`,
    );
    lines.push('');
  }

  // Leaf HTML — always present.
  lines.push(`**Picked element** (\`<${result.leafTag}>\`):`);
  lines.push('```html');
  lines.push(result.leafHtml);
  lines.push('```');
  lines.push('');

  // Parent HTML — conditional.
  if (result.parentHtml) {
    lines.push('**Parent HTML** (for surrounding context):');
    lines.push('```html');
    lines.push(result.parentHtml);
    lines.push('```');
    lines.push('');
  }

  // Sibling HTML — conditional.
  if (result.siblingHtml) {
    lines.push('**Sibling example** (one of the other similar items):');
    lines.push('```html');
    lines.push(result.siblingHtml);
    lines.push('```');
    lines.push('');
  }

  // Scrape comparison — different rules per mode.
  if (result.mode === 'missing') {
    const cmp = compareToMarkdown(scrapeMarkdown, result.anchorCandidates);
    if (cmp.kind === 'no-markdown') {
      lines.push('**Current scrape output:** _(no markdown captured — page may not have been scraped, or the article extractor returned nothing.)_');
    } else if (cmp.kind === 'not-found') {
      lines.push(
        '**Current scrape output:** _the picked element\'s text does not appear in the scraped markdown — this is consistent with it being lost during extraction._',
      );
    } else {
      lines.push('**Current scrape output near this element:**');
      lines.push('```markdown');
      lines.push(cmp.excerpt);
      lines.push('```');
    }
    lines.push('');
  } else if (result.mode === 'unwanted') {
    // For unwanted, the user is reacting to junk THEY saw in the markdown.
    // Don't quote the markdown back at them — they already know what's there.
    // Just confirm the element exists on the page.
    lines.push('**Source DOM is above.** The user is reporting this as noise that shouldn\'t appear in the scrape output.');
    lines.push('');
  }

  // Trailing call to action.
  const followUp =
    result.mode === 'missing'
      ? 'Diagnose why this element didn\'t make it into the scrape, then propose a fix. The scrape pipeline is in `src/lib/scrape/pipeline.ts`. Pre-pass hooks (e.g. `protectMicroData`) run on a cloned DOM before Readability; that\'s the cheapest place to intervene if the loss happens during article extraction.'
      : 'Diagnose why this element ended up in the scrape output, then propose a fix. The scrape pipeline is in `src/lib/scrape/pipeline.ts` and post-processing (e.g. `cleanArticleMarkdown`) lives in `src/lib/scrape/to-markdown.ts`.';

  return wrapForAgent({
    description:
      'a scrape-debugging bundle captured by clicking an element on the live page',
    source: {
      url: result.pickedAtUrl,
      title: result.pickedAtTitle,
      capturedAt: result.capturedAt,
    },
    meta: {
      mode: result.mode,
      siblingCount: result.siblingCount > 0 ? result.siblingCount : undefined,
      extractor: extractor ?? undefined,
      scrapeMode: scrapeMode ?? undefined,
    },
    format: 'markdown',
    content: lines.join('\n'),
    followUp,
  });
}

type MarkdownComparison =
  | { kind: 'no-markdown' }
  | { kind: 'not-found' }
  | { kind: 'found'; excerpt: string };

/**
 * Find the picked element's text in the scraped markdown. Returns a window
 * of ±MARKDOWN_EXCERPT_RADIUS chars around the first matching anchor.
 */
function compareToMarkdown(
  markdown: string | null,
  anchors: string[],
): MarkdownComparison {
  if (!markdown) return { kind: 'no-markdown' };
  if (anchors.length === 0) return { kind: 'not-found' };

  // Normalize both sides for whitespace-insensitive substring search.
  const haystack = markdown.replace(/\s+/g, ' ');
  for (const candidate of anchors) {
    const needle = candidate.replace(/\s+/g, ' ').slice(0, 80);
    if (needle.length < 8) continue;
    const idx = haystack.indexOf(needle);
    if (idx === -1) continue;
    const start = Math.max(0, idx - MARKDOWN_EXCERPT_RADIUS);
    const end = Math.min(haystack.length, idx + needle.length + MARKDOWN_EXCERPT_RADIUS);
    const prefix = start > 0 ? '…' : '';
    const suffix = end < haystack.length ? '…' : '';
    return { kind: 'found', excerpt: `${prefix}${haystack.slice(start, end)}${suffix}` };
  }
  return { kind: 'not-found' };
}
