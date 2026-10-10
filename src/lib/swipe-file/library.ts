/** Canonical social library reads under caller RLS; no local content copies. */
import { apiDelete, apiPut } from '@/lib/api/client';
import { getSupabase } from '@/lib/supabase/client';
import { associations } from '@/lib/supabase/generated/platform';
import {
  postStat,
  post as postTable,
  postTranscript,
  socialProfile,
  swipeCollection,
} from '@/lib/supabase/generated/social';
import { createDb, listAll, read, update } from '@ai-matrx/data/db';
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

const swipeDb = () => createDb({ client: getSupabase() });
const postColumns = [
  'id',
  'organization_id',
  'platform',
  'url',
  'title',
  'caption',
  'format',
  'posted_at',
  'hashtags',
  'mentions',
  'profile_id',
] as const;

export async function readSwipeCollections(includeArchived = false): Promise<SwipeCollection[]> {
  const rows = await listAll(
    swipeDb(),
    swipeCollection,
    (q) => q.order('updated_at', { ascending: false }),
    {
      columns: ['id', 'name', 'organization_id', 'deleted_at'],
      includeDeleted: includeArchived,
    },
  );
  return z.array(CollectionSchema).parse(rows);
}
export async function readSwipeMemberships(collectionId?: string): Promise<SwipeMembership[]> {
  const rows = await listAll(
    swipeDb(),
    associations,
    (q) => {
      let filter = q.eq('source_type', 'social_swipe_collection');
      if (collectionId) filter = filter.eq('source_id', collectionId);
      return filter.order('created_at', { ascending: false });
    },
    {
      columns: [
        'id',
        'source_id',
        'target_id',
        'target_type',
        'organization_id',
        'metadata',
        'created_at',
      ],
    },
  );
  return z.array(MembershipSchema).parse(rows);
}
/** Row cards do not download transcripts; detail loads those only when opened. */
export async function readSwipePostSummary(postId: string): Promise<SwipePost> {
  const post = await read(swipeDb(), postTable, postId, { columns: postColumns });
  if (!post) throw new Error('Saved post unavailable.');
  return PostSchema.parse(post);
}
export async function readSwipePost(postId: string) {
  const db = swipeDb();
  const [post, transcripts, stats] = await Promise.all([
    readSwipePostSummary(postId),
    listAll(
      db,
      postTranscript,
      (q) => q.eq('post_id', postId).order('created_at', { ascending: false }),
      {
        columns: ['id', 'text', 'language', 'source'],
      },
    ),
    listAll(db, postStat, (q) => q.eq('post_id', postId), {
      columns: ['views', 'likes', 'comments', 'shares', 'saves', 'metrics_observed_at'],
    }),
  ]);
  const profile = post.profile_id
    ? await read(db, socialProfile, post.profile_id, {
        columns: ['handle', 'display_name', 'profile_url'],
      })
    : null;
  return {
    post,
    transcripts: z.array(TranscriptSchema).parse(transcripts),
    profile: profile ? ProfileSchema.parse(profile) : null,
    stats: stats[0] ? StatsSchema.parse(stats[0]) : null,
  };
}
export async function updateSwipeCollection(
  collection: SwipeCollection,
  change: { name?: string; deleted_at?: string | null },
) {
  // Destination identity travels with the write, independent of active-org switches.
  const result = await update(swipeDb(), swipeCollection, collection.id, {
    ...change,
    organization_id: collection.organization_id,
  });
  if (result.status !== 'saved')
    throw new Error(
      result.status === 'conflict'
        ? 'Collection changed. Refresh and retry.'
        : 'Collection could not be updated.',
    );
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
