import type { SwipeHostMsg } from '@/lib/swipe-file/host';
import { mountSwipePill } from '@/lib/swipe-file/pill';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let receive: (message: SwipeHostMsg) => void;
const posted = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  document.documentElement.querySelector('#matrx-swipe-pill')?.remove();
  delete (window as unknown as { __matrxSwipePill?: boolean }).__matrxSwipePill;
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(
    'https://www.instagram.com/p/captured-post/',
  );
  Object.assign(chrome, {
    runtime: {
      getURL: (path: string) => `chrome-extension://test/${path}`,
      connect: () => ({
        postMessage: posted,
        onMessage: {
          addListener: (fn: typeof receive) => {
            receive = fn;
          },
        },
        onDisconnect: { addListener: () => {} },
      }),
      sendMessage: vi.fn(async () => ({ ok: true })),
    },
  });
  posted.mockClear();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

it('keeps branded save feedback, capture warning and both destination actions together', async () => {
  mountSwipePill();
  const root = document.querySelector('#matrx-swipe-pill')!.shadowRoot!;
  receive({
    t: 'collections',
    collections: [{ id: 'collection', name: 'Inspiration', organization_id: 'org' }],
    lastId: 'collection',
  });
  root.querySelector<HTMLButtonElement>('#save')!.click();
  expect(posted).toHaveBeenLastCalledWith({
    t: 'save',
    url: 'https://www.instagram.com/p/captured-post/',
    collectionId: 'collection',
  });
  receive({
    t: 'result',
    outcome: {
      status: 'saved',
      postId: 'post',
      collectionId: 'collection',
      title: 'Post',
      notice: 'image_2: could not be downloaded',
      receipt: {
        postId: 'post',
        organizationId: 'org',
        platform: 'instagram',
        capturedAt: new Date().toISOString(),
        media: [],
        mediaNotes: ['image_2: could not be downloaded'],
        transcript: { status: 'none', notes: [] },
        reused: false,
      },
    },
  });
  const card = root.querySelector('.card')!;
  expect(card.querySelector('img')?.getAttribute('src')).toContain('icon/48.png');
  expect(card.querySelector('#msg')?.textContent).toBe('Saved to collection');
  expect(card.querySelector('#notice')?.textContent).toContain('image_2');
  expect(card.querySelector<HTMLElement>('#links')?.hidden).toBe(false);
  const href = card.querySelector<HTMLAnchorElement>('#web')!.href;
  expect(new URL(href).searchParams.get('panels')).toBe('social_post:post:o-org');
  root.querySelector<HTMLButtonElement>('#review')!.click();
  await Promise.resolve();
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
    channel: 'matrx.swipe.open',
    postId: 'post',
    collectionId: 'collection',
    organizationId: 'org',
  });
});

it('never attaches an earlier post save result to a new SPA page', () => {
  mountSwipePill();
  const root = document.querySelector('#matrx-swipe-pill')!.shadowRoot!;
  receive({
    t: 'collections',
    collections: [{ id: 'collection', name: 'Inspiration', organization_id: 'org' }],
    lastId: null,
  });
  root.querySelector<HTMLButtonElement>('#save')!.click();
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(
    'https://www.instagram.com/p/next-post/',
  );
  vi.advanceTimersByTime(1000);
  receive({ t: 'result', outcome: { status: 'failed', reason: 'Previous post failed' } });
  expect(root.querySelector<HTMLElement>('#feedback')!.hidden).toBe(true);
  expect(root.querySelector<HTMLElement>('#links')!.hidden).toBe(true);
});

it('offers browser capture for unverified media with the saved destination organization', () => {
  mountSwipePill();
  const root = document.querySelector('#matrx-swipe-pill')!.shadowRoot!;
  receive({
    t: 'collections',
    collections: [{ id: 'collection', name: 'Inspiration', organization_id: 'saved-org' }],
    lastId: 'collection',
  });
  root.querySelector<HTMLButtonElement>('#save')!.click();
  receive({
    t: 'result',
    outcome: {
      status: 'saved',
      postId: 'saved-post',
      collectionId: 'collection',
      title: 'Coast',
      notice: '',
      receipt: {
        postId: 'saved-post',
        organizationId: 'saved-org',
        platform: 'instagram',
        capturedAt: '2026-10-10T12:00:00Z',
        media: [],
        mediaNotes: [],
        transcript: { status: 'none', notes: [] },
        reused: false,
        coverage: {
          expected_items: null,
          observed_items: 1,
          stored_items: 1,
          missing_items: null,
          status: 'unknown',
        },
      },
    },
  });
  const capture = root.querySelector<HTMLButtonElement>('#capture-slides')!;
  expect(capture.hidden).toBe(false);
  capture.click();
  expect(posted).toHaveBeenLastCalledWith({
    t: 'capture_slides',
    postId: 'saved-post',
    organizationId: 'saved-org',
    url: 'https://www.instagram.com/p/captured-post/',
  });
});
