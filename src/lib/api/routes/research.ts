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
import { ENRICH_GOALS, type EnrichGoal } from '@/lib/research/enrich-types';
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
  // 2026-06-18 — honest terminal statuses (see UserVerdict below). Both drop out
  // of the scrape queue (server adds them to _TERMINAL_STATUSES).
  'ignored',
  'content_mismatch',
]);
export type ScrapeStatus = z.infer<typeof ScrapeStatusSchema>;

/**
 * User verdicts — optional escape hatch when the auto-pipeline can't decide.
 * The user being on the page is what makes "blocked" not a verdict — they're
 * past whatever the obstacle was. See research/docs/EXTENSION_API.md.
 *   - accept_as_is:     the sparse content IS the page → status `complete`
 *   - dead_link:        URL is gone (404 / removed) → status `dead_link`
 *   - retry:            throw away the last result, requeue → status `pending`
 *   - gated:            page is locked (login / paywall / captcha) → status `gated`
 *   - ignored:          not interested — stop surfacing it. Not dead, not gated,
 *                       just not wanted. Honest "make it go away" → status `ignored`
 *   - content_mismatch: the page loaded but isn't what it claimed to be (redirect
 *                       / changed page / wrong content) — NOT a 404 → status
 *                       `content_mismatch`
 * `ignored` + `content_mismatch` are terminal (drop out of the queue).
 */
export type UserVerdict =
  | 'accept_as_is'
  | 'dead_link'
  | 'retry'
  | 'gated'
  | 'ignored'
  | 'content_mismatch';

const captureLevel = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

/**
 * Domain-policy category the server resolved for a source (RESEARCH_ENRICHMENT.md
 * §5; aidream research/domain_policy.py). Drives how the queue UI treats it:
 *   - open          — normal scrape ladder.
 *   - gated_login   — login/paywall; show "Sign in to capture", never auto-retry.
 *   - low_value     — rarely useful (e.g. Facebook); never auto-queue.
 *   - special       — capturable with a tuned selector (e.g. Reddit); worth it.
 *   - blocked       — server won't touch it.
 * Optional/nullable — legacy server builds omit it (treated as `open`).
 */
export const PolicyCategorySchema = z.enum([
  'open',
  'gated_login',
  'low_value',
  'special',
  'blocked',
]);
export type PolicyCategory = z.infer<typeof PolicyCategorySchema>;

/**
 * Enrich directive carried on an `enrich` task (RESEARCH_ENRICHMENT.md §3). The
 * goal enum mirrors ENRICH_GOALS; `enrich-types.ts` owns the canonical list.
 */
export const EnrichDirectiveSchema = z.object({
  goal: z.enum([...ENRICH_GOALS] as [EnrichGoal, ...EnrichGoal[]]),
  reason: z.string().nullable().optional(),
  hints: z
    .object({
      selector: z.string().nullable().optional(),
      expect_chars_min: z.number().nullable().optional(),
    })
    .passthrough()
    .nullable()
    .optional(),
});

/**
 * Items returned by /research/extension/scrape-queue. The four level buckets are
 * sources the server gave up on (server_gave_up = true). The two policy buckets
 * (gated_login / low_value, §5) are NOT failures — they're deliberately routed —
 * so `scrape_status` here spans the full enum, not just 'thin'/'failed'. A
 * legacy item with no policy/task fields parses as an `open` `scrape` task.
 */
export const ExtensionScrapeItemSchema = z.object({
  source_id: z.string().uuid(),
  topic_id: z.string().uuid(),
  topic_name: z.string(),
  url: z.string().url(),
  title: z.string().nullable().optional(),
  scrape_status: ScrapeStatusSchema,
  is_included: z.boolean(),
  next_level: captureLevel,
  attempted_levels: z.array(captureLevel).default([]),
  last_attempt_at: z.string().nullable().optional(),
  last_char_count: z.number().nullable().optional(),
  last_failure_reason: z.string().nullable().optional(),
  // Server-side accounting — always present on queue items by contract.
  // server_attempts >= 1 and server_gave_up === true on every level item.
  server_attempts: z.number().int(),
  last_server_attempt_at: z.string().nullable().optional(),
  last_server_failure_reason: z.string().nullable().optional(),
  server_gave_up: z.boolean(),
  // §5 domain policy (optional — absent on legacy server builds → 'open').
  policy_category: PolicyCategorySchema.nullable().optional(),
  policy_reason: z.string().nullable().optional(),
  // §3 enrich task kind (optional — absent → a plain 'scrape' task).
  task_kind: z.enum(['scrape', 'enrich']).default('scrape'),
  enrich: EnrichDirectiveSchema.nullable().optional(),
});
export type ExtensionScrapeItem = z.infer<typeof ExtensionScrapeItemSchema>;

export const ExtensionScrapeQueueSchema = z.object({
  level_1_quick: z.array(ExtensionScrapeItemSchema).default([]),
  level_2_scroll: z.array(ExtensionScrapeItemSchema).default([]),
  level_3_user_gated: z.array(ExtensionScrapeItemSchema).default([]),
  level_4_paste: z.array(ExtensionScrapeItemSchema).default([]),
  // §5 policy buckets — present on current server builds, defaulted for older ones.
  gated_login: z.array(ExtensionScrapeItemSchema).default([]),
  low_value: z.array(ExtensionScrapeItemSchema).default([]),
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

/**
 * Browser-measured image sent with the capture. The server overlays
 * width/height (naturalWidth/naturalHeight) onto its HTML-parsed images so the
 * research media gallery gets exact dimensions without re-downloading. Optional
 * and additive — omitting it just falls back to server-side dimension probing.
 */
export interface ExtensionImagePayload {
  src: string;
  alt: string | null;
  width: number | null;
  height: number | null;
}

/**
 * Media + structured data the live DOM has but the server's HTML scan can't see
 * — JS-injected `<video>`/`<audio>`/iframe players and clean OpenGraph/JSON-LD
 * (RESEARCH_ENRICHMENT.md §4). Additive: the server ignores unknown body fields
 * today (ExtensionContentSubmit has no `extra='forbid'`), so sending these is a
 * harmless no-op until the server consumes them.
 */
export interface ExtensionMediaPayload {
  videos: { src: string; poster: string | null; duration: number | null }[];
  audio: { src: string; type: string | null }[];
}

export interface ExtensionStructuredPayload {
  metadata: {
    title: string;
    description: string | null;
    canonical: string | null;
    lang: string | null;
    og: Record<string, string>;
    twitter: Record<string, string>;
    schemaTypes: string[];
  } | null;
  jsonLd: unknown[];
}

export interface SubmitExtras {
  media?: ExtensionMediaPayload;
  structured?: ExtensionStructuredPayload;
  /** §3 — routes the result server-side (a transcript → content, a screenshot → rs_media). */
  enrichGoal?: EnrichGoal;
}

export async function submitExtensionContent(
  topicId: string,
  sourceId: string,
  htmlContent: string,
  captureLevel: SubmittableLevel,
  images: ExtensionImagePayload[] = [],
  extras: SubmitExtras = {},
) {
  const body: Record<string, unknown> = {
    html_content: htmlContent,
    capture_level: captureLevel,
    images,
  };
  // Only attach the new keys when there's something to send — keeps legacy
  // captures byte-for-byte identical and the body lean.
  if (extras.media && (extras.media.videos.length > 0 || extras.media.audio.length > 0)) {
    body.media = extras.media;
  }
  if (
    extras.structured &&
    (extras.structured.metadata != null || extras.structured.jsonLd.length > 0)
  ) {
    body.structured = extras.structured;
  }
  if (extras.enrichGoal) body.enrich_goal = extras.enrichGoal;

  return apiPost<ExtensionContentResponse>(
    `/research/topics/${encodeURIComponent(topicId)}/sources/${encodeURIComponent(sourceId)}/extension-content`,
    body,
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

export interface BulkVerdictItem {
  topicId: string;
  sourceId: string;
}

export interface BulkVerdictResult {
  succeeded: string[];
  failed: { sourceId: string; error: string }[];
}

/** Server response shape for the bulk endpoint (snake_case, mirrors FastAPI). */
interface BulkVerdictServerResponse {
  succeeded: string[];
  failed: { source_id: string; error: string }[];
}

/**
 * Apply one verdict to many sources. Prefers the atomic server bulk endpoint
 * (`POST /research/extension/sources/verdict_bulk`); if that endpoint isn't
 * deployed yet (404), falls back to a concurrency-capped loop over the live
 * per-source endpoint so bulk actions work TODAY without waiting on a backend
 * deploy. The fallback is intentional graceful degradation (same convention as
 * the topic-picker endpoints above), not a permanent second path — once the
 * bulk endpoint ships everywhere the 404 branch is simply never taken.
 *
 * `onProgress(done, total)` fires as the fallback loop advances (the bulk
 * endpoint resolves in one shot). Per-source failures are collected, never
 * thrown — one bad source can't abort the batch.
 */
export async function applyVerdictBulk(
  items: BulkVerdictItem[],
  verdict: UserVerdict,
  notes?: string,
  onProgress?: (done: number, total: number) => void,
): Promise<BulkVerdictResult> {
  if (items.length === 0) return { succeeded: [], failed: [] };

  // 1) Atomic server path.
  const bulk = await apiPost<BulkVerdictServerResponse>(
    '/research/extension/sources/verdict_bulk',
    {
      source_ids: items.map((i) => i.sourceId),
      verdict,
      ...(notes ? { notes } : {}),
    },
  );
  if (bulk.ok) {
    onProgress?.(items.length, items.length);
    return {
      succeeded: bulk.data.succeeded ?? [],
      failed: (bulk.data.failed ?? []).map((f) => ({ sourceId: f.source_id, error: f.error })),
    };
  }
  // Only fall back when the endpoint is genuinely absent. A real error (5xx/4xx
  // other than 404) means the endpoint exists and rejected us — don't risk
  // double-applying via the loop.
  if (bulk.status !== 404) {
    return {
      succeeded: [],
      failed: items.map((i) => ({ sourceId: i.sourceId, error: bulk.error })),
    };
  }

  // 2) Fallback: concurrency-capped per-source loop over the live endpoint.
  const CONCURRENCY = 6;
  const succeeded: string[] = [];
  const failed: { sourceId: string; error: string }[] = [];
  let done = 0;
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const chunk = items.slice(i, i + CONCURRENCY);
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(
      chunk.map(async (item) => {
        const r = await applyVerdict(item.topicId, item.sourceId, verdict, notes);
        if (r.ok) succeeded.push(item.sourceId);
        else failed.push({ sourceId: item.sourceId, error: r.error });
        done++;
        onProgress?.(done, items.length);
      }),
    );
  }
  return { succeeded, failed };
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
export async function addSourceToTopic(topicId: string, body: AddSourceRequest) {
  return apiPost<ResearchSource>(`/research/topics/${encodeURIComponent(topicId)}/sources`, body);
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
  const r = await apiGet<unknown>(`/research/sources/by-url?url=${encodeURIComponent(url)}`);
  if (!r.ok) return r;
  const parsed = z.object({ matches: z.array(SourceUrlMatchSchema) }).safeParse(r.data);
  if (!parsed.success) {
    console.warn('[matrx-extend] /research/sources/by-url failed schema', parsed.error.format());
    return { ok: false as const, status: 0, error: 'Schema validation failed' };
  }
  return { ok: true as const, data: parsed.data };
}
