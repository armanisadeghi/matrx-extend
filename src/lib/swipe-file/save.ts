/**
 * "Save to swipe file" — the one orchestration every surface (injected pill,
 * context menu) calls from the service worker.
 *
 * ingest (streamed) -> add to collection. Outcome is always one of three
 * honest states; a provider fallback the server reports is carried through.
 */

import { addPostToCollection, createCollection, ingestPost } from '@/lib/api/routes/social';
import { log } from '@/lib/debug/log';
import { getActiveOrganizationId } from '@/lib/org/active-org';
import {
  type SwipeCaptureReceipt,
  captureReceiptWarnings,
  writeSwipeReceipt,
} from '@/lib/swipe-file/receipt';
import {
  getCollectionOrganizationId,
  getLastCollectionId,
  isPostInCollection,
  setLastCollectionId,
} from '@/lib/swipe-file/store';
import { swipeTargetFromUrl } from '@/lib/swipe-file/urls';

export type SwipeOutcome =
  | {
      status: 'saved' | 'already_saved';
      postId: string;
      collectionId: string;
      title: string;
      notice: string | null;
      receipt: SwipeCaptureReceipt;
    }
  | { status: 'failed'; reason: string };

export interface SwipeRequest {
  url: string;
  /** Existing collection id, or null to use `newCollectionName` / last used. */
  collectionId: string | null;
  newCollectionName?: string;
}

export async function saveToSwipeFile(
  req: SwipeRequest,
  onProgress: (label: string) => void,
): Promise<SwipeOutcome> {
  const target = swipeTargetFromUrl(req.url);
  if (!target) return { status: 'failed', reason: 'This page is not a post or ad Matrx can save.' };

  const initiatingOrg = await getActiveOrganizationId();
  if (!initiatingOrg) return { status: 'failed', reason: 'Sign in to Matrx to save this post.' };

  let collectionId =
    req.collectionId ?? (req.newCollectionName ? null : await getLastCollectionId(initiatingOrg));
  if (!collectionId && !req.newCollectionName?.trim())
    return { status: 'failed', reason: 'Choose a collection, or name a new one.' };

  // A selected collection may belong to a different visible organization.
  const organizationId = collectionId
    ? await getCollectionOrganizationId(collectionId)
    : initiatingOrg;

  onProgress(`Reading this ${target.label}`);
  const ingest = await ingestPost(
    target.url,
    (s) => onProgress(s.label),
    undefined,
    organizationId,
  );
  if (!ingest.ok) return { status: 'failed', reason: ingest.reason };
  const post = ingest.result;

  if (!collectionId) {
    onProgress('Creating the collection');
    const made = await createCollection(req.newCollectionName!.trim(), organizationId);
    if (!made.ok)
      return {
        status: 'failed',
        reason: `The post was fetched but the collection could not be created: ${made.error}`,
      };
    collectionId = made.data.collection_id;
  }

  let already = false;
  try {
    already = await isPostInCollection(collectionId, post.post_id);
  } catch {
    already = false; // the add below is idempotent; the badge just can't say "already"
  }
  if (!already) {
    onProgress('Adding to the collection');
    const added = await addPostToCollection(collectionId, post.post_id, organizationId);
    if (!added.ok)
      return {
        status: 'failed',
        reason: `The post was fetched but could not be added: ${added.error}`,
      };
  }
  const receipt: SwipeCaptureReceipt = {
    postId: post.post_id,
    url: target.url,
    organizationId,
    platform: target.platform,
    capturedAt: new Date().toISOString(),
    media: post.media ?? [],
    mediaNotes: post.media_notes ?? [],
    transcript: {
      status: post.transcript?.status ?? 'unknown',
      notes: post.transcript?.notes ?? [],
    },
    reused: post.trace?.reused === true,
    ...(post.media_coverage ? { coverage: post.media_coverage } : {}),
  };
  const notices = captureReceiptWarnings(receipt);
  try {
    await writeSwipeReceipt(receipt);
  } catch (err) {
    log.warn('sw', 'swipe receipt could not be cached', err);
    notices.push('Capture details could not be remembered on this device');
  }
  try {
    await setLastCollectionId(collectionId, organizationId);
  } catch (err) {
    log.warn('sw', 'swipe collection preference could not be remembered', err);
    notices.push('Collection preference could not be remembered');
  }
  const fb = post.trace?.fallback_reason;
  return {
    status: already ? 'already_saved' : 'saved',
    postId: post.post_id,
    collectionId,
    title: post.title || post.caption?.slice(0, 80) || target.label,
    // Vendors and their reasons are our business, not the person's (Arman, 2026-10-09).
    notice: [...(fb ? ['Fetched from a backup source'] : []), ...notices].join(' · ') || null,
    receipt,
  };
}
