/**
 * Types + Zod schemas for the Highlights feature.
 *
 * A highlight is something the user marked on a web page (a text passage or a
 * whole element) that they want to remember, attach to an agent chat, or feed
 * into the Data / Scrape extraction tabs. Backed by the `wbx_highlight` table
 * (see migrations/2026_05_20_wbx_highlight.sql).
 *
 * The `anchor` is the load-bearing "reference": everything needed to re-find
 * the highlight on a later visit and to hand a selector / ref to interaction +
 * extraction tools.
 */

import { z } from 'zod';

export type HighlightMode = 'text' | 'element';

/**
 * The re-locatable reference captured for a highlight. All fields optional —
 * text-mode highlights lean on `css_path` + `text_quote`; element-mode
 * highlights lean on `selector` + `ref` + `role`/`tag`.
 */
export const HighlightAnchorSchema = z
  .object({
    /** Stable CSS selector (selector-resilience). Element container in text mode. */
    selector: z.string().optional(),
    /** data-matrx-ref captured this session — ephemeral, invalid after navigation. */
    ref: z.string().optional(),
    /** Container element path (text mode). */
    css_path: z.string().optional(),
    /** W3C-style text anchor for re-finding a passage. */
    text_quote: z
      .object({
        exact: z.string(),
        prefix: z.string().optional(),
        suffix: z.string().optional(),
      })
      .optional(),
    /** Last-known bounding rect (page coords). */
    rect: z
      .object({
        x: z.number(),
        y: z.number(),
        width: z.number(),
        height: z.number(),
      })
      .optional(),
    role: z.string().optional(),
    tag: z.string().optional(),
    attrs: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

export type HighlightAnchor = z.infer<typeof HighlightAnchorSchema>;

export const HighlightSchema = z.object({
  id: z.string().uuid(),
  created_by: z.string().uuid().nullable(),
  conversation_id: z.string().uuid().nullable(),
  mode: z.enum(['text', 'element']),
  url: z.string(),
  domain: z.string(),
  page_title: z.string().nullable(),
  color: z.string(),
  text: z.string().nullable(),
  anchor: HighlightAnchorSchema,
  metadata: z.record(z.string(), z.unknown()),
  is_deleted: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type Highlight = z.infer<typeof HighlightSchema>;

/** Lighter shape for list rendering (omits metadata / soft-delete flag). */
export const HighlightListItemSchema = HighlightSchema.omit({
  metadata: true,
  is_deleted: true,
});

export type HighlightListItem = z.infer<typeof HighlightListItemSchema>;

export interface CreateHighlightInput {
  mode: HighlightMode;
  url: string;
  domain: string;
  page_title?: string | null;
  text?: string | null;
  anchor: HighlightAnchor;
  color?: string;
  conversation_id?: string | null;
  metadata?: Record<string, unknown>;
}

export interface UpdateHighlightPatch {
  text?: string;
  color?: string;
  conversation_id?: string | null;
  metadata?: Record<string, unknown>;
}

/** Derive a bare hostname from a URL for the `domain` column. Falls back to ''. */
export function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
