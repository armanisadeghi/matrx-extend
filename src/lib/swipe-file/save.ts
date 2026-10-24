/**
 * "Save to swipe file" — the one orchestration every surface (injected pill,
 * context menu) calls from the service worker.
 *
 * ingest (streamed) -> add to collection. Outcome is always one of three
 * honest states; a provider fallback the server reports is carried through.
 */

import {
  type IngestFailure,
  addPostToCollection,
  createCollection,
  ingestPost,
} from '@/lib/api/routes/social';
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
import { recordClientError } from '@/lib/telemetry/client-error';

export type SwipeOutcome =
  | {
      status: 'saved' | 'already_saved';
      postId: string;
      collectionId: string;
      title: string;
      notice: string | null;
      receipt: SwipeCaptureReceipt;
    }
  | { status: 'failed'; reason: string; detail?: SwipeFailureDetail };

/** What the "Details" view shows under a failure: enough for anyone to find this attempt. */
export interface SwipeFailureDetail {
  /** The step that stopped, in the same words the progress line used. */
  step: string;
  status?: number;
  serverCode?: string;
  /** Server request id: the server's own error record carries it too. */
  requestId?: string;
  technical?: string;
  /** The platform error-store row for this failure. */
  reference?: string;
  /** Why no reference could be written, when it could not. */
  referenceMissing?: string;
  /** A collection this attempt already created: a retry must reuse it, never make a second. */
  collectionId?: string;
}

/** Longest the person waits on the error log before the failure is shown anyway. */
const RECORD_WAIT_MS = 3000;

/**
 * A save that stopped after the person did everything right is OUR failure:
 * record it (with the server's request id, so both rows join) and hand the
 * reference back for the card to show. A sign-in that expired is the person's
 * to fix, so it is not recorded.
 */
async function failed(
  reason: string,
  at: { step: string; route: string; url: string; organizationId: string; collectionId?: string },
  f: Partial<IngestFailure>,
): Promise<SwipeOutcome> {
  const detail: SwipeFailureDetail = {
    step: at.step,
    ...(f.status !== undefined && { status: f.status }),
    ...(f.serverCode !== undefined && { serverCode: f.serverCode }),
    ...(f.requestId !== undefined && { requestId: f.requestId }),
    ...(f.technical !== undefined && { technical: f.technical }),
    ...(at.collectionId !== undefined && { collectionId: at.collectionId }),
  };
  if (f.status === 401) return { status: 'failed', reason, detail };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const reference = await Promise.race([
      recordClientError({
        feature: 'social',
        message: `swipe save stopped at "${at.step}": ${reason}`,
        code: f.serverCode ?? (f.status !== undefined ? `http_${f.status}` : 'swipe_save_failed'),
        route: at.route,
        ...(f.requestId !== undefined && { requestId: f.requestId }),
        context: {
          step: at.step,
          url: at.url,
          status: f.status ?? null,
          technical: f.technical ?? null,
        },
        organizationId: at.organizationId,
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('error log timed out')), RECORD_WAIT_MS);
      }),
    ]);
    if (reference) detail.reference = reference;
    else detail.referenceMissing = 'Diagnostics are off in this browser';
  } catch (err) {
    log.error('sw', 'swipe failure was NOT recorded in the platform error store', { detail, err });
    detail.referenceMissing = 'The error log could not be reached';
  } finally {
    clearTimeout(timer);
  }
  return { status: 'failed', reason, detail };
}

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
  if (!ingest.ok)
    return failed(
      ingest.reason,
      {
        step: `Reading this ${target.label}`,
        route: '/social/ingest/post',
        url: target.url,
        organizationId,
      },
      ingest,
    );
  const post = ingest.result;

  if (!collectionId) {
    onProgress('Creating the collection');
    const made = await createCollection(req.newCollectionName!.trim(), organizationId);
    if (!made.ok)
      return failed(
        `The post was fetched but the collection could not be created: ${made.error}`,
        {
          step: 'Creating the collection',
          route: '/social/collections',
          url: target.url,
          organizationId,
        },
        { status: made.status },
      );
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
      return failed(
        `The post was fetched but could not be added: ${added.error}`,
        {
          step: 'Adding to the collection',
          route: '/social/collections/{collection_id}/items',
          url: target.url,
          organizationId,
          collectionId,
        },
        { status: added.status },
      );
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
    ...(post.format ? { format: post.format } : {}),
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
