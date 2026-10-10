/** Canonical social library reads under caller RLS; no local content copies. */
import { apiDelete, apiPut } from '@/lib/api/client';
import { platformDb, socialDb } from '@/lib/supabase/schemas';
import { z } from 'zod';

export const CollectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  organization_id: z.string(),
  deleted_at: z.string().nullable(),
});
export type SwipeCollection = z.infer<typeof CollectionSchema>;
const MembershipSchema = z.object({
  id: z.string(),
  source_id: z.string(),
  target_id: z.string(),
  target_type: z.string(),
  organization_id: z.string(),
  metadata: z
    .object({ note: z.string().optional(), tags: z.array(z.string()).optional() })
    .passthrough()
    .nullable(),
  created_at: z.string(),
});
export type SwipeMembership = z.infer<typeof MembershipSchema>;
export const PostSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  platform: z.string(),
  url: z.string(),
  title: z.string().nullable(),
  caption: z.string().nullable(),
  format: z.string(),
  posted_at: z.string().nullable(),
  hashtags: z.array(z.string()),
  mentions: z.array(z.string()),
  profile_id: z.string().nullable(),
});
export type SwipePost = z.infer<typeof PostSchema>;
const TranscriptSchema = z.object({
  id: z.string(),
  text: z.string(),
  language: z.string(),
  source: z.string(),
});
export type SwipeTranscript = z.infer<typeof TranscriptSchema>;
const ProfileSchema = z.object({
  handle: z.string(),
  display_name: z.string().nullable(),
  profile_url: z.string().nullable(),
});
export type SwipeProfile = z.infer<typeof ProfileSchema>;
const StatsSchema = z.object({
  views: z.number().nullable(),
  likes: z.number().nullable(),
  comments: z.number().nullable(),
  shares: z.number().nullable(),
  saves: z.number().nullable(),
  metrics_observed_at: z.string().nullable(),
});
export type SwipeStats = z.infer<typeof StatsSchema>;

/** Follow the server's own page size so a library never silently truncates. */
async function allRows(
  read: (range?: { from: number; to: number }) => Promise<{
    data: unknown[] | null;
    error: { message: string } | null;
    count: number | null;
  }>,
): Promise<unknown[]> {
  const first = await read();
  if (first.error) throw new Error(first.error.message);
  const rows = [...(first.data ?? [])];
  const pageSize = rows.length;
  while (first.count !== null && rows.length < first.count) {
    if (!pageSize) throw new Error('The library could not be read completely. Refresh to retry.');
    const next = await read({ from: rows.length, to: rows.length + pageSize - 1 });
    if (next.error) throw new Error(next.error.message);
    if (!next.data?.length) throw new Error('The library changed while loading. Refresh to retry.');
    rows.push(...next.data);
  }
  return rows;
}
export async function readSwipeCollections(includeArchived = false): Promise<SwipeCollection[]> {
  const rows = await allRows(async (range) => {
    let query = socialDb()
      .from('swipe_collection')
      .select('id,name,organization_id,deleted_at', { count: 'exact' })
      .order('updated_at', { ascending: false })
      .order('id');
    if (!includeArchived) query = query.is('deleted_at', null);
    if (range) query = query.range(range.from, range.to);
    return await query;
  });
  return z.array(CollectionSchema).parse(rows);
}
export async function readSwipeMemberships(collectionId?: string): Promise<SwipeMembership[]> {
  const rows = await allRows(async (range) => {
    let query = platformDb()
      .from('associations')
      .select('id,source_id,target_id,target_type,organization_id,metadata,created_at', {
        count: 'exact',
      })
      .eq('source_type', 'social_swipe_collection')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .order('id');
    if (collectionId) query = query.eq('source_id', collectionId);
    if (range) query = query.range(range.from, range.to);
    return await query;
  });
  return z.array(MembershipSchema).parse(rows);
}
/** Row cards do not download transcripts; detail loads those only when opened. */
export async function readSwipePostSummary(postId: string): Promise<SwipePost> {
  const { data, error } = await socialDb()
    .from('post')
    .select(
      'id,organization_id,platform,url,title,caption,format,posted_at,hashtags,mentions,profile_id',
    )
    .eq('id', postId)
    .is('deleted_at', null)
    .single();
  if (error) throw new Error(error.message);
  return PostSchema.parse(data);
}
export async function readSwipePost(postId: string) {
  const [{ data: post, error: postError }, { data: transcripts, error: transcriptError }] =
    await Promise.all([
      socialDb()
        .from('post')
        .select(
          'id,organization_id,platform,url,title,caption,format,posted_at,hashtags,mentions,profile_id',
        )
        .eq('id', postId)
        .is('deleted_at', null)
        .single(),
      socialDb()
        .from('post_transcript')
        .select('id,text,language,source')
        .eq('post_id', postId)
        .order('created_at', { ascending: false }),
    ]);
  if (postError) throw new Error(postError.message);
  if (transcriptError) throw new Error(transcriptError.message);
  const parsedPost = PostSchema.parse(post);
  const [profileResult, statsResult] = await Promise.all([
    parsedPost.profile_id
      ? socialDb()
          .from('social_profile')
          .select('handle,display_name,profile_url')
          .eq('id', parsedPost.profile_id)
          .is('deleted_at', null)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    socialDb()
      .from('post_stat')
      .select('views,likes,comments,shares,saves,metrics_observed_at')
      .eq('post_id', postId)
      .maybeSingle(),
  ]);
  if (profileResult.error) throw new Error(profileResult.error.message);
  if (statsResult.error) throw new Error(statsResult.error.message);
  return {
    post: parsedPost,
    profile: profileResult.data ? ProfileSchema.parse(profileResult.data) : null,
    stats: statsResult.data ? StatsSchema.parse(statsResult.data) : null,
    transcripts: z.array(TranscriptSchema).parse(transcripts ?? []),
  };
}
export async function updateSwipeCollection(
  collection: SwipeCollection,
  change: { name?: string; deleted_at?: string | null },
) {
  const { data, error } = await socialDb()
    .from('swipe_collection')
    .update(change)
    .eq('id', collection.id)
    .eq('organization_id', collection.organization_id)
    .select('id')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Collection could not be updated.');
}
export async function updateSwipeNotes(membership: SwipeMembership, note: string, tags: string[]) {
  const result = await apiPut(
    `/social/collections/${membership.source_id}/items/social_post/${membership.target_id}`,
    { note, tags },
    undefined,
    { organizationId: membership.organization_id },
  );
  if (!result.ok) throw new Error(result.error);
}
export async function removeSwipeMembership(membership: SwipeMembership) {
  const result = await apiDelete(
    `/social/collections/${membership.source_id}/items/${membership.target_type}/${membership.target_id}`,
    undefined,
    { organizationId: membership.organization_id },
  );
  if (!result.ok) throw new Error(result.error);
}
