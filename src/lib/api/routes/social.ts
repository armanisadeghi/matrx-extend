/**
 * Social Intelligence doors — aidream `/social` (services/social/FEATURE.md).
 *
 * Only what "Save to swipe file" needs: the streaming post ingest, collection
 * create and add-item. Reads of collections and membership go direct to
 * Supabase under RLS (`src/lib/swipe-file/store.ts`), never through here.
 * Every call carries `X-Organization-Id` (buildHeaders); the ingest stream is
 * NDJSON: `data` events `social_stage` then ONE `social_result`, or an
 * in-stream `error` event carrying the server's `user_message`.
 */

import {
  type ApiResult,
  ORGANIZATION_CONTEXT_HEADER,
  buildHeaders,
  getApiBaseUrl,
} from '@/lib/api/client';
import { runOp } from '@/lib/api/matrx-api';
import { streamFetch } from '@/lib/api/stream';
import { getActiveOrganizationId } from '@/lib/org/active-org';
import {
  MediaCoverageSchema,
  type SocialPostMedia,
  SocialPostMediaSchema,
} from '@/lib/swipe-file/receipt';
import {
  addItemDoor,
  createCollectionDoor,
  listMediaDoor,
  mediaCoverageDoor,
  mediaDoor,
} from '@ai-matrx/api/marketing';
import { z } from 'zod';

export type { SocialPostMedia } from '@/lib/swipe-file/receipt';

export const SocialTraceSchema = z
  .object({
    provider: z.string().nullable().optional(),
    fallback_reason: z.string().nullable().optional(),
    cost_credits: z.number().nullable().optional(),
    reused: z.boolean().nullable().optional(),
  })
  .passthrough();

/** Every field but the post id degrades alone: an odd value is dropped, never a lost save. */
const bonus = <T extends z.ZodTypeAny>(t: T) => t.nullish().catch(undefined);

export const SocialPostResultSchema = z
  .object({
    post_id: z.string(),
    platform: bonus(z.string()),
    url: bonus(z.string()),
    format: bonus(z.string()),
    title: bonus(z.string()),
    caption: bonus(z.string()),
    handle: bonus(z.string()),
    thumbnail_url: bonus(z.string()),
    trace: bonus(SocialTraceSchema),
    // Everything below the post id is a bonus. A field the server sends as null or in a
    // newer shape must never turn an already-saved post into "Not saved" (the server
    // answers `browser_capture: null` for an untouched carousel), so each degrades alone.
    media_notes: z.array(z.string()).nullish().catch(undefined),
    media_coverage: MediaCoverageSchema.nullish().catch(undefined),
    media: z.array(SocialPostMediaSchema).nullish().catch(undefined),
    transcript: z
      .object({
        status: z.enum(['available', 'none']),
        notes: z.array(z.string()).nullish(),
      })
      .passthrough()
      .nullish()
      .catch(undefined),
  })
  .passthrough();
export type SocialPostResult = z.infer<typeof SocialPostResultSchema>;

export const SwipeCollectionSchema = z.object({
  collection_id: z.string(),
  name: z.string(),
});
export type SwipeCollectionCreated = z.infer<typeof SwipeCollectionSchema>;

export interface IngestStage {
  stage: string;
  label: string;
  current: number;
  total: number;
}

/** Why an ingest stopped, in the person's words, plus what an admin needs to find it. */
export interface IngestFailure {
  reason: string;
  status?: number;
  /** The server's error code (diagnostic, never user text). */
  serverCode?: string;
  /** Server `X-Request-ID`: the same id is on the server's own error record. */
  requestId?: string;
  /** What this extension saw go wrong (field paths and rules, never the body). */
  technical?: string;
}

export type IngestOutcome = { ok: true; result: SocialPostResult } | ({ ok: false } & IngestFailure);

/** Which fields broke and why, e.g. `post_id: Required`. Never values: they can carry page content. */
export function describeSchemaIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.') || 'answer'}: ${i.message}`)
    .join('; ');
}

/** `POST /social/ingest/post` (NDJSON). Resolves once the stream ends. */
export async function ingestPost(
  url: string,
  onStage: (s: IngestStage) => void,
  signal?: AbortSignal,
  organizationId?: string,
): Promise<IngestOutcome> {
  const org = organizationId ?? (await getActiveOrganizationId());
  if (!org)
    return { ok: false, reason: 'No organization is selected. Open Matrx and choose one first.' };
  const base = await getApiBaseUrl();
  const headers = await buildHeaders(
    { Accept: 'application/x-ndjson' },
    { token: null, organizationId: org },
  );
  if (!headers.Authorization || !headers[ORGANIZATION_CONTEXT_HEADER])
    return { ok: false, reason: 'Sign in to Matrx to save to your swipe file.' };

  const box: { result: SocialPostResult | null; failure: IngestFailure | null; requestId?: string } =
    { result: null, failure: null };
  await streamFetch({
    url: `${base}/social/ingest/post`,
    body: { url, land_media: true, transcript: true, comments: false, force: false },
    headers,
    ...(signal ? { signal } : {}),
    onOpened: (info) => {
      if (info.requestId) box.requestId = info.requestId;
    },
    onEvent: (e) => {
      if (e.type === 'error') {
        box.failure ??= {
          reason: e.message,
          ...(e.status !== undefined ? { status: e.status } : {}),
          ...(e.serverCode !== undefined ? { serverCode: e.serverCode } : {}),
        };
        return;
      }
      if (e.type !== 'event' || e.eventName !== 'data') return;
      const d = e.data as Record<string, unknown>;
      if (d.type === 'social_stage') {
        onStage({
          stage: String(d.stage ?? ''),
          label: String(d.label ?? d.stage ?? ''),
          current: Number(d.current ?? 0),
          total: Number(d.total ?? 0),
        });
      } else if (d.type === 'social_result') {
        const parsed = SocialPostResultSchema.safeParse(d.result);
        if (parsed.success) box.result = parsed.data;
        else
          box.failure ??= {
            reason: 'Matrx read the post but its answer had no post id.',
            technical: describeSchemaIssues(parsed.error),
          };
      }
    },
  });
  if (box.result) return { ok: true, result: box.result };
  const f = box.failure ?? {
    reason: 'The server stopped before answering.',
    technical: 'stream ended with no social_result and no error event',
  };
  return { ok: false, ...f, ...(box.requestId ? { requestId: box.requestId } : {}) };
}

export async function createCollection(
  name: string,
  organizationId?: string,
): Promise<ApiResult<SwipeCollectionCreated>> {
  const r = await runOp<unknown>(
    (api, o) => createCollectionDoor(api, { body: { name } }, o),
    organizationId ? { organizationId } : {},
  );
  if (!r.ok) return r;
  const p = SwipeCollectionSchema.safeParse(r.data);
  return p.success
    ? { ok: true, data: p.data }
    : { ok: false, status: -1, error: 'Unreadable collection answer.' };
}

export async function addPostToCollection(
  collectionId: string,
  postId: string,
  organizationId?: string,
): Promise<ApiResult<{ saved: boolean }>> {
  return runOp<{ saved: boolean }>(
    (api, o) =>
      addItemDoor(
        api,
        {
          path: { collection_id: collectionId },
          body: { item_type: 'social_post', item_id: postId },
        },
        o,
      ) as Promise<{ saved: boolean }>,
    organizationId ? { organizationId } : {},
  );
}

/** Current canonical coverage, independent of this device's cached save receipt. */
export async function getPostMediaCoverage(postId: string, organizationId: string) {
  const result = await runOp<unknown>(
    (api, o) => mediaCoverageDoor(api, { path: { post_id: postId } }, o),
    { organizationId },
  );
  if (!result.ok) throw new Error(result.error);
  return MediaCoverageSchema.parse(result.data);
}

export async function getPostMedia(
  postId: string,
  organizationId: string,
): Promise<SocialPostMedia[]> {
  const result = await runOp<unknown>(
    (api, o) => listMediaDoor(api, { path: { post_id: postId } }, o),
    { organizationId },
  );
  if (!result.ok) throw new Error(result.error);
  return z.array(SocialPostMediaSchema).parse(result.data);
}

export async function readPostMediaBlob(
  postId: string,
  fileId: string,
  organizationId: string,
): Promise<Blob> {
  const result = await runOp(
    async (api, o) =>
      (await mediaDoor(api, { path: { post_id: postId, file_id: fileId } }, o)).blob(),
    { organizationId },
  );
  if (!result.ok) throw new Error(`Media unavailable (${result.status}).`);
  return result.data;
}
