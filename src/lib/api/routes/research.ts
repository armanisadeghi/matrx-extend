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
  'dead_link',
  'gated',
]);
export type ScrapeStatus = z.infer<typeof ScrapeStatusSchema>;

/**
 * User verdicts — optional escape hatch when the auto-pipeline can't decide.
 * The user being on the page is what makes "blocked" not a verdict — they're
 * past whatever the obstacle was. See research/docs/EXTENSION_API.md.
 *   - accept_as_is: the sparse content IS the page
 *   - dead_link:    URL is gone (404 / removed)
 *   - retry:        throw away the last result, requeue
 *   - gated:        page exists but is locked (login / paywall / captcha) —
 *                   not dead, but stop trying
 */
export type UserVerdict = 'accept_as_is' | 'dead_link' | 'retry' | 'gated';

const captureLevel = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

/**
 * Items returned by /research/extension/scrape-queue. The contract narrows
 * the broad ScrapeStatus enum: only sources where the server has given up
 * (server_gave_up = true) and the user has approved (is_included = true)
 * appear here, so scrape_status is always 'thin' or 'failed' on this shape.
 * If the server ever returns 'pending' / 'success' / etc., that's a backend
 * bug — schema parse will warn and the queue load will fail loudly.
 */
export const ExtensionScrapeItemSchema = z.object({
  source_id: z.string().uuid(),
  topic_id: z.string().uuid(),
  topic_name: z.string(),
  url: z.string().url(),
  title: z.string().nullable().optional(),
  scrape_status: z.enum(['thin', 'failed']),
  is_included: z.boolean(),
  next_level: captureLevel,
  attempted_levels: z.array(captureLevel).default([]),
  last_attempt_at: z.string().nullable().optional(),
  last_char_count: z.number().nullable().optional(),
  last_failure_reason: z.string().nullable().optional(),
  // Server-side accounting — always present on queue items by contract.
  // server_attempts >= 1 and server_gave_up === true on every item here.
  server_attempts: z.number().int(),
  last_server_attempt_at: z.string().nullable().optional(),
  last_server_failure_reason: z.string().nullable().optional(),
  server_gave_up: z.boolean(),
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

export interface VerdictResponse {
  source_id: string;
  verdict: UserVerdict | 'mark_complete';
  scrape_status: ScrapeStatus;
  user_verdict_at: string;
  is_terminal: boolean;
  next_level: CaptureLevel | null;
}

/**
 * User verdict on a source — opt-in escape hatch. Three flavors:
 *   - 'accept_as_is' → status=complete (the sparse content IS the page)
 *   - 'dead_link'    → status=dead_link (404, removed, domain dead)
 *   - 'retry'        → status=pending (throw the last result away, requeue)
 *
 * The auto-pipeline still works without verdicts; this just lets the user
 * end the cycle on their own terms when they know something we can't infer.
 */
export async function applyVerdict(
  topicId: string,
  sourceId: string,
  verdict: UserVerdict,
  notes?: string,
) {
  return apiPost<VerdictResponse>(
    `/research/topics/${encodeURIComponent(topicId)}/sources/${encodeURIComponent(sourceId)}/verdict`,
    notes ? { verdict, notes } : { verdict },
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

// ─────────────────────────────────────────────────────────────────────────────
// Topic picker — endpoints required for the "Add this page to a project" UX.
// Spec for the server team lives at aidream/docs/EXTENSION_TOPIC_PICKER_API.md.
// Until those endpoints ship the calls below will 404; the UI handles that
// gracefully (shows "endpoint not available yet" instead of an opaque error).
// ─────────────────────────────────────────────────────────────────────────────

export const ResearchTopicSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  source_count: z.number().int().optional(),
  updated_at: z.string().nullable().optional(),
});
export type ResearchTopicSummary = z.infer<typeof ResearchTopicSummarySchema>;

export async function listTopics() {
  const r = await apiGet<unknown>('/research/topics');
  if (!r.ok) return r;
  const parsed = z.array(ResearchTopicSummarySchema).safeParse(r.data);
  if (!parsed.success) {
    console.warn('[matrx-extend] /research/topics failed schema', parsed.error.format());
    return { ok: false as const, status: 0, error: 'Schema validation failed' };
  }
  return { ok: true as const, data: parsed.data };
}

export interface AddSourceRequest {
  url: string;
  title?: string;
  source_type?: string;
}

/**
 * Idempotent on (topic_id, url): if a source already exists at this URL in
 * the topic, the server returns the existing row (200), no duplicate.
 */
export async function addSourceToTopic(
  topicId: string,
  body: AddSourceRequest,
) {
  return apiPost<ResearchSource>(
    `/research/topics/${encodeURIComponent(topicId)}/sources`,
    body,
  );
}

export const SourceUrlMatchSchema = z.object({
  source_id: z.string().uuid(),
  topic_id: z.string().uuid(),
  topic_name: z.string(),
});
export type SourceUrlMatch = z.infer<typeof SourceUrlMatchSchema>;

/**
 * Cross-topic discovery: which topics already contain this URL? Optional —
 * if the server hasn't shipped this endpoint yet, the picker just skips
 * the "already in: X" inline hint.
 */
export async function findSourcesByUrl(url: string) {
  const r = await apiGet<unknown>(
    `/research/sources/by-url?url=${encodeURIComponent(url)}`,
  );
  if (!r.ok) return r;
  const parsed = z
    .object({ matches: z.array(SourceUrlMatchSchema) })
    .safeParse(r.data);
  if (!parsed.success) {
    console.warn('[matrx-extend] /research/sources/by-url failed schema', parsed.error.format());
    return { ok: false as const, status: 0, error: 'Schema validation failed' };
  }
  return { ok: true as const, data: parsed.data };
}
