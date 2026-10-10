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
  apiPost,
  buildHeaders,
  getApiBaseUrl,
} from '@/lib/api/client';
import { streamFetch } from '@/lib/api/stream';
import { getActiveOrganizationId } from '@/lib/org/active-org';
import {
  MediaCoverageSchema,
  type SocialPostMedia,
  SocialPostMediaSchema,
} from '@/lib/swipe-file/receipt';
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

export const SocialPostResultSchema = z
  .object({
    post_id: z.string(),
    platform: z.string().optional(),
    url: z.string().optional(),
    title: z.string().nullable().optional(),
    caption: z.string().nullable().optional(),
    handle: z.string().nullable().optional(),
    thumbnail_url: z.string().nullable().optional(),
    trace: SocialTraceSchema.nullable().optional(),
    media_notes: z.array(z.string()).optional(),
    media_coverage: MediaCoverageSchema.optional(),
    media: z.array(SocialPostMediaSchema).optional(),
    transcript: z
      .object({
        status: z.enum(['available', 'none']),
        notes: z.array(z.string()).optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
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

export type IngestOutcome =
  | { ok: true; result: SocialPostResult }
  | { ok: false; reason: string; status?: number };

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

  const box: {
    result: SocialPostResult | null;
    failure: { reason: string; status?: number } | null;
  } = { result: null, failure: null };
  await streamFetch({
    url: `${base}/social/ingest/post`,
    body: { url, land_media: true, transcript: true, comments: false, force: false },
    headers,
    ...(signal ? { signal } : {}),
    onEvent: (e) => {
      if (e.type === 'error') {
        box.failure ??= {
          reason: e.message,
          ...(e.status !== undefined ? { status: e.status } : {}),
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
          box.failure ??= { reason: 'The server answered with a post this extension cannot read.' };
      }
    },
  });
  if (box.result) return { ok: true, result: box.result };
  const f = box.failure;
  return {
    ok: false,
    reason: f?.reason ?? 'The server ended without a result.',
    ...(f?.status !== undefined ? { status: f.status } : {}),
  };
}

export async function createCollection(
  name: string,
  organizationId?: string,
): Promise<ApiResult<SwipeCollectionCreated>> {
  const r = await apiPost<unknown>(
    '/social/collections',
    { name },
    undefined,
    organizationId ? { organizationId } : undefined,
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
  return apiPost<{ saved: boolean }>(
    `/social/collections/${collectionId}/items`,
    {
      item_type: 'social_post',
      item_id: postId,
    },
    undefined,
    organizationId ? { organizationId } : undefined,
  );
}

/** Current canonical coverage, independent of this device's cached save receipt. */
export async function getPostMediaCoverage(postId: string, organizationId: string) {
  const { apiGet } = await import('@/lib/api/client');
  const result = await apiGet<unknown>(
    `/social/posts/${encodeURIComponent(postId)}/media-coverage`,
    undefined,
    { organizationId },
  );
  if (!result.ok) throw new Error(result.error);
  return MediaCoverageSchema.parse(result.data);
}

export async function getPostMedia(
  postId: string,
  organizationId: string,
): Promise<SocialPostMedia[]> {
  const { apiGet } = await import('@/lib/api/client');
  const result = await apiGet<unknown>(
    `/social/posts/${encodeURIComponent(postId)}/media`,
    undefined,
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
  const base = await getApiBaseUrl();
  const headers = await buildHeaders({}, { token: null, organizationId });
  if (!headers.Authorization || !headers[ORGANIZATION_CONTEXT_HEADER])
    throw new Error('Sign in to Matrx to view media.');
  const response = await fetch(
    `${base}/social/posts/${encodeURIComponent(postId)}/media/${encodeURIComponent(fileId)}`,
    { headers },
  );
  if (!response.ok) throw new Error(`Media unavailable (${response.status}).`);
  return response.blob();
}
