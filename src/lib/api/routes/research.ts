/**
 * Subset of /research/* used by the Tasks tab + scrape submission.
 * See aidream/research/docs/EXTENSION_API.md for the authoritative contract.
 *
 * The capture ladder:
 *   Level 1 (quick):       open tab, scrape outerHTML immediately
 *   Level 2 (scroll):      open tab, wait for load, auto-scroll, scrape
 *   Level 3 (user_gated):  open tab, wait, scroll, surface to user → user clicks past
 *                          obstacles → user clicks Go → scrape
 *   Level 4 (paste):       user copies content from a normal tab and pastes here
 *
 * Items only move UP the ladder — a Level-N thin submission cannot reappear
 * under Level N. The backend tracks `capture_level` history per source.
 */

import { apiGet, apiPatch, apiPost } from '@/lib/api/client';
import { z } from 'zod';

export type CaptureLevel = 1 | 2 | 3 | 4;
export type SubmittableLevel = 1 | 2 | 3;

export const ScrapeStatusSchema = z.enum([
  'pending',
  'success',
  'thin',
  'failed',
  'manual',
  'skipped',
  'complete',
]);
export type ScrapeStatus = z.infer<typeof ScrapeStatusSchema>;

const captureLevel = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

export const ExtensionScrapeItemSchema = z.object({
  source_id: z.string().uuid(),
  topic_id: z.string().uuid(),
  topic_name: z.string(),
  url: z.string().url(),
  title: z.string().nullable().optional(),
  scrape_status: ScrapeStatusSchema,
  next_level: captureLevel,
  attempted_levels: z.array(captureLevel).default([]),
  last_attempt_at: z.string().nullable().optional(),
  last_char_count: z.number().nullable().optional(),
  last_failure_reason: z.string().nullable().optional(),
});
export type ExtensionScrapeItem = z.infer<typeof ExtensionScrapeItemSchema>;

export const ExtensionScrapeQueueSchema = z.object({
  level_1_quick: z.array(ExtensionScrapeItemSchema).default([]),
  level_2_scroll: z.array(ExtensionScrapeItemSchema).default([]),
  level_3_user_gated: z.array(ExtensionScrapeItemSchema).default([]),
  level_4_paste: z.array(ExtensionScrapeItemSchema).default([]),
  totals: z.record(z.string(), z.number()).default({}),
});
export type ExtensionScrapeQueue = z.infer<typeof ExtensionScrapeQueueSchema>;

export async function getExtensionScrapeQueue() {
  const r = await apiGet<unknown>('/research/extension/scrape-queue');
  if (!r.ok) return r;
  const parsed = ExtensionScrapeQueueSchema.safeParse(r.data);
  if (!parsed.success) {
    console.warn('[matrx-extend] scrape-queue failed schema', parsed.error.format());
    return { ok: false as const, status: 0, error: 'Schema validation failed' };
  }
  return { ok: true as const, data: parsed.data };
}

export interface ExtensionContentResponse {
  status: ScrapeStatus;
  source_id: string;
  capture_level: CaptureLevel;
  is_good_scrape: boolean;
  char_count: number;
  failure_reason: string | null;
  content_id: string | null;
  next_level: CaptureLevel | null;
  needs_user_action: boolean;
}

export async function submitExtensionContent(
  topicId: string,
  sourceId: string,
  htmlContent: string,
  captureLevel: SubmittableLevel,
) {
  return apiPost<ExtensionContentResponse>(
    `/research/topics/${encodeURIComponent(topicId)}/sources/${encodeURIComponent(sourceId)}/extension-content`,
    { html_content: htmlContent, capture_level: captureLevel },
  );
}

/**
 * Level 4 — user pastes content directly. Goes to the existing /content route,
 * NOT /extension-content. Server records capture_level=4 and sets the source
 * to scrape_status=manual.
 */
export async function submitPasteContent(
  topicId: string,
  sourceId: string,
  content: string,
  contentType = 'plain_text',
) {
  return apiPost<unknown>(
    `/research/topics/${encodeURIComponent(topicId)}/sources/${encodeURIComponent(sourceId)}/content`,
    { content, content_type: contentType },
  );
}

/**
 * User says "this page genuinely has no more content" — sets scrape_status=complete,
 * removes from every queue bucket permanently.
 */
export async function markSourceComplete(topicId: string, sourceId: string) {
  return apiPost<unknown>(
    `/research/topics/${encodeURIComponent(topicId)}/sources/${encodeURIComponent(sourceId)}/mark-complete`,
    {},
  );
}

export const ResearchSourceSchema = z.object({
  id: z.string().uuid(),
  topic_id: z.string().uuid(),
  url: z.string().url(),
  hostname: z.string().optional(),
  scrape_status: z.string().optional(),
  is_included: z.boolean().optional(),
  source_type: z.string().optional(),
});
export type ResearchSource = z.infer<typeof ResearchSourceSchema>;

export async function updateSource(
  topicId: string,
  sourceId: string,
  updates: Partial<ResearchSource>,
) {
  return apiPatch<ResearchSource>(
    `/research/topics/${encodeURIComponent(topicId)}/sources/${encodeURIComponent(sourceId)}`,
    updates,
  );
}

/** Convenience: re-queue a source that was marked success/manual/complete. */
export async function requeueSource(topicId: string, sourceId: string) {
  return updateSource(topicId, sourceId, { scrape_status: 'pending' });
}
