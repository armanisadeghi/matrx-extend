/**
 * Service-worker side of "Save to swipe file": a long-lived port from the
 * injected pill (progress needs a stream, not one reply) and the notification
 * used by the context-menu entry. Registered synchronously from bootstrap.
 */

import { log } from '@/lib/debug/log';
import { openPanel, panelOpenRemedy } from '@/lib/panel/adapter';
import { SWIPE_OPEN_KEY } from '@/lib/swipe-file/navigation';
import { type SwipeOutcome, saveToSwipeFile } from '@/lib/swipe-file/save';
import {
  type SwipeCollectionRow,
  getLastCollectionId,
  listCollections,
} from '@/lib/swipe-file/store';

export const SWIPE_PORT = 'matrx.swipe-file';

export type SwipeClientMsg =
  | { t: 'list' }
  | { t: 'capture_slides'; postId: string; organizationId: string; url: string }
  | { t: 'save'; url: string; collectionId: string | null; newCollectionName?: string };

export type SwipeHostMsg =
  | { t: 'collections'; collections: SwipeCollectionRow[]; lastId: string | null }
  | { t: 'collections_error'; reason: string }
  | { t: 'progress'; label: string }
  | { t: 'capture_started'; ok: boolean; sentence: string; url: string }
  | { t: 'result'; outcome: SwipeOutcome };

export function describeOutcome(o: SwipeOutcome): string {
  if (o.status === 'failed') return `Not saved: ${o.reason}`;
  const head = o.status === 'saved' ? 'Saved to your swipe file' : 'Already in that collection';
  return o.notice ? `${head}. ${o.notice}` : `${head}: ${o.title}`;
}

export function registerSwipeFileHost(): void {
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.channel !== SWIPE_OPEN_KEY) return;
    if (
      !sender.tab?.id ||
      sender.tab.windowId == null ||
      typeof message.postId !== 'string' ||
      typeof message.organizationId !== 'string' ||
      typeof message.collectionId !== 'string'
    ) {
      reply({ ok: false, reason: 'Capture unavailable. Open Swipe file from Matrx.' });
      return;
    }
    // Invoke before any await: Chrome requires the initiating click gesture.
    const opening = openPanel({ tabId: sender.tab.id });
    if (!opening.promise) {
      reply({ ok: false, reason: panelOpenRemedy(opening.reason) });
      return;
    }
    const selection = {
      postId: message.postId,
      organizationId: message.organizationId,
      collectionId: message.collectionId,
      windowId: sender.tab.windowId,
      at: Date.now(),
    };
    Promise.all([opening.promise, chrome.storage.session.set({ [SWIPE_OPEN_KEY]: selection })])
      .then(() => reply({ ok: true }))
      .catch((err: unknown) =>
        reply({
          ok: false,
          reason: panelOpenRemedy(
            err instanceof Error ? err.message : 'Could not open Swipe file.',
          ),
        }),
      );
    return true;
  });
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
      if (msg.t === 'capture_slides') {
        const { startSwipeBrowserCapture } = await import('@/lib/swipe-file/browser-capture');
        const result = await startSwipeBrowserCapture({
          ...msg,
          openerTabId: port.sender?.tab?.id ?? null,
        });
        post({
          t: 'capture_started',
          url: msg.url,
          ok: result.ok,
          sentence: result.ok ? 'Swipe through every slide, then press Capture.' : result.sentence,
        });
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
        iconUrl: chrome.runtime.getURL('icon/128.png'),
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
