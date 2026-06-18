/**
 * Types for the research `enrich` task kind (docs/RESEARCH_ENRICHMENT.md §3).
 *
 * Pure types + constants — NO runtime imports — so both the wire layer
 * (api/routes/research.ts) and the executor (research/enrich.ts) can depend on
 * this without creating a cycle.
 *
 * An `enrich` task is the server saying "I know a SPECIFIC thing is missing —
 * go get exactly that, using a browser capability I lack." It carries a
 * directive (what + how). Today the server emits none of these (no generator
 * yet — see the matrx-feedback contract), so the queue's enrich path is dormant
 * but complete: the instant the server starts tagging items `task_kind:'enrich'`,
 * the extension fulfils them. Every field is optional/back-compatible so a
 * legacy scrape item parses unchanged.
 */

/** The enrichment goals the server can ask for. Order = catalog order in the doc. */
export const ENRICH_GOALS = [
  'rendered_dom',
  'authenticated',
  'transcript',
  'download',
  'xhr_json',
  'comments',
  'screenshot',
  'structured',
  'expand',
] as const;

export type EnrichGoal = (typeof ENRICH_GOALS)[number];

export function isEnrichGoal(v: unknown): v is EnrichGoal {
  return typeof v === 'string' && (ENRICH_GOALS as readonly string[]).includes(v);
}

/** Hints the server attaches to narrow the work (all optional). */
export interface EnrichHints {
  /** CSS selector to click / read / wait for, depending on the goal. */
  selector?: string | null;
  /** Treat the result as thin below this many chars. */
  expect_chars_min?: number | null;
  [key: string]: unknown;
}

/** The directive carried on an `enrich` queue item. */
export interface EnrichDirective {
  goal: EnrichGoal;
  /** Human reason the server emitted this (shown in the UI). */
  reason?: string | null;
  hints?: EnrichHints | null;
}

/**
 * Human-facing label + one-line description per goal. Used by the queue UI and
 * by the executor's "not yet supported server-side" messaging. Kept here so the
 * UI and executor never disagree on wording.
 */
export const ENRICH_GOAL_INFO: Record<EnrichGoal, { label: string; blurb: string }> = {
  rendered_dom: {
    label: 'Rendered DOM',
    blurb:
      'Settle + scroll the SPA, then capture the live DOM the server only saw as an empty shell.',
  },
  authenticated: {
    label: 'Signed-in capture',
    blurb: 'Capture this paywalled / member-walled page as the logged-in user.',
  },
  transcript: {
    label: 'Transcript',
    blurb: 'Open the video transcript panel and capture it as text.',
  },
  download: {
    label: 'Download',
    blurb: 'Trigger and capture a gated / JS-triggered file download.',
  },
  xhr_json: {
    label: 'API payload',
    blurb: 'Observe the network and capture the clean JSON the page rendered from.',
  },
  comments: {
    label: 'Comments',
    blurb: 'Expand and scroll the comment thread, then capture it.',
  },
  screenshot: {
    label: 'Screenshot',
    blurb: 'Capture a full-page or element screenshot of a visual-only source.',
  },
  structured: {
    label: 'Structured data',
    blurb: 'Read JSON-LD / microdata / metadata for citation / author / date fields.',
  },
  expand: {
    label: 'Expand content',
    blurb: 'Click past load-more / accordion / consent obstacles, then capture.',
  },
};
