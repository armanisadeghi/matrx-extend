/**
 * Service-worker side of "Save to swipe file": a long-lived port from the
 * injected pill (progress needs a stream, not one reply) and the notification
 * used by the context-menu entry. Registered synchronously from bootstrap.
 */

import { log } from '@/lib/debug/log';
import { type SwipeOutcome, saveToSwipeFile } from '@/lib/swipe-file/save';
import {
  type SwipeCollectionRow,
  getLastCollectionId,
  listCollections,
} from '@/lib/swipe-file/store';

export const SWIPE_PORT = 'matrx.swipe-file';

export type SwipeClientMsg =
  | { t: 'list' }
  | { t: 'save'; url: string; collectionId: string | null; newCollectionName?: string };

export type SwipeHostMsg =
  | { t: 'collections'; collections: SwipeCollectionRow[]; lastId: string | null }
  | { t: 'collections_error'; reason: string }
  | { t: 'progress'; label: string }
  | { t: 'result'; outcome: SwipeOutcome };

export function describeOutcome(o: SwipeOutcome): string {
  if (o.status === 'failed') return `Not saved: ${o.reason}`;
  const head = o.status === 'saved' ? 'Saved to your swipe file' : 'Already in that collection';
  return o.notice ? `${head}. ${o.notice}` : `${head}: ${o.title}`;
}

export function registerSwipeFileHost(): void {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== SWIPE_PORT) return;
    const post = (m: SwipeHostMsg) => {
      try {
        port.postMessage(m);
      } catch {
        /* page closed mid-save; the save itself continues and completes */
      }
    };
    port.onMessage.addListener(async (msg: SwipeClientMsg) => {
      if (msg.t === 'list') {
        try {
          post({
            t: 'collections',
            collections: await listCollections(),
            lastId: await getLastCollectionId(),
          });
        } catch (err) {
          post({ t: 'collections_error', reason: (err as Error).message });
        }
        return;
      }
      if (msg.t === 'save') {
        const outcome = await saveToSwipeFile(
          {
            url: msg.url,
            collectionId: msg.collectionId,
            ...(msg.newCollectionName ? { newCollectionName: msg.newCollectionName } : {}),
          },
          (label) => post({ t: 'progress', label }),
        ).catch(
          (err): SwipeOutcome => ({
            status: 'failed',
            reason: (err as Error).message || 'Unexpected error',
          }),
        );
        log.info('sw', `save ${outcome.status}`);
        post({ t: 'result', outcome });
      }
    });
  });
}

/** Context-menu path: no page UI, so the honest result goes to a notification. */
export async function saveFromMenu(url: string): Promise<void> {
  const notify = async (message: string) => {
    try {
      await chrome.notifications?.create(`matrx-swipe-${Date.now()}`, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icon-128.png'),
        title: 'Swipe file',
        message,
      });
    } catch (err) {
      log.warn('sw', 'notification failed', err);
    }
  };
  const outcome = await saveToSwipeFile({ url, collectionId: null }, () => {}).catch(
    (err): SwipeOutcome => ({ status: 'failed', reason: (err as Error).message }),
  );
  await notify(describeOutcome(outcome));
}
