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

it('retries exactly the missing slides by saving into the same collection again', () => {
  mountSwipePill();
  const root = document.querySelector('#matrx-swipe-pill')!.shadowRoot!;
  receive({
    t: 'collections',
    collections: [{ id: 'collection', name: 'Carousel hooks', organization_id: 'saved-org' }],
    lastId: 'collection',
  });
  root.querySelector<HTMLButtonElement>('#save')!.click();
  const slide = (i: number) => ({
    file_id: `f${i}`,
    role: `image_${i}`,
    source_index: i,
    mime_type: 'image/jpeg',
    size_bytes: 1,
    door: '/d',
  });
  receive({
    t: 'result',
    outcome: {
      status: 'saved',
      postId: 'saved-post',
      collectionId: 'collection',
      title: 'Coast',
      notice: null,
      receipt: {
        postId: 'saved-post',
        organizationId: 'saved-org',
        platform: 'instagram',
        capturedAt: '2026-10-10T12:00:00Z',
        media: [slide(1), slide(3)],
        mediaNotes: [],
        transcript: { status: 'none', notes: [] },
        reused: false,
        format: 'carousel',
        coverage: {
          expected_items: 3,
          observed_items: 3,
          stored_items: 2,
          missing_items: 1,
          status: 'partial',
        },
      },
    },
  });
  const retry = root.querySelector<HTMLButtonElement>('#retry-slides')!;
  expect(retry.hidden).toBe(false);
  expect(retry.textContent).toBe('Retry slide 2');
  retry.click();
  expect(posted).toHaveBeenLastCalledWith({
    t: 'save',
    url: 'https://www.instagram.com/p/captured-post/',
    collectionId: 'collection',
  });
  expect(retry.hidden).toBe(true);
});

it('on a profile page offers Capture more and wakes the guide once the tab is adopted', () => {
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(
    'https://www.instagram.com/nasa/',
  );
  mountSwipePill();
  const root = document.querySelector('#matrx-swipe-pill')!.shadowRoot!;
  expect(root.querySelector<HTMLElement>('#feedrow')!.hidden).toBe(false);
  expect(root.querySelector<HTMLElement>('#postrow')!.hidden).toBe(true);
  root.querySelector<HTMLButtonElement>('#feed')!.click();
  expect(posted).toHaveBeenLastCalledWith({
    t: 'feed_capture',
    url: 'https://www.instagram.com/nasa/',
  });
  const woke = vi.fn();
  window.addEventListener('matrx:guided-wake', woke);
  receive({
    t: 'feed_started',
    ok: true,
    sentence: 'Capture guide opened.',
    url: 'https://www.instagram.com/nasa/',
  });
  expect(woke).toHaveBeenCalledTimes(1);
  expect(document.querySelector('#matrx-swipe-pill')).toBeNull();
});

it('tells the person plainly when Capture more cannot start', () => {
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(
    'https://www.instagram.com/nasa/',
  );
  mountSwipePill();
  const root = document.querySelector('#matrx-swipe-pill')!.shadowRoot!;
  root.querySelector<HTMLButtonElement>('#feed')!.click();
  receive({
    t: 'feed_started',
    ok: false,
    sentence: 'Sign in to Matrx to capture posts.',
    url: 'https://www.instagram.com/nasa/',
  });
  expect(root.querySelector('#msg')!.textContent).toContain('Sign in to Matrx');
  expect(root.querySelector<HTMLButtonElement>('#feed')!.disabled).toBe(false);
});

it('does not bring the card back over the guide after Capture more handed the page off', () => {
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(
    'https://www.instagram.com/nasa/',
  );
  mountSwipePill();
  const root = document.querySelector('#matrx-swipe-pill')!.shadowRoot!;
  root.querySelector<HTMLButtonElement>('#feed')!.click();
  receive({ t: 'feed_started', ok: true, sentence: '', url: 'https://www.instagram.com/nasa/' });
  vi.advanceTimersByTime(3000);
  expect(document.querySelector('#matrx-swipe-pill')).toBeNull();
});

it('closing the card hides it on every page until the extension is opened again', async () => {
  const { SWIPE_PILL_HIDDEN_KEY, showSwipePillAgain } = await import(
    '@/lib/swipe-file/pill-dismiss'
  );
  let changed: ((changes: Record<string, { newValue?: unknown }>, area: string) => void) | null =
    null;
  const onChanged = chrome.storage.onChanged;
  Object.assign(chrome.storage, {
    onChanged: { addListener: (fn: typeof changed) => (changed = fn), removeListener: () => {} },
  });
  try {
    (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(
      'https://www.instagram.com/nasa/',
    );
    mountSwipePill();
    const host = document.querySelector<HTMLElement>('#matrx-swipe-pill')!;
    await vi.waitFor(() => expect(host.style.visibility).toBe('visible'));
    host.shadowRoot!.querySelector<HTMLButtonElement>('#close')!.click();
    expect(document.querySelector('#matrx-swipe-pill')).toBeNull();
    await vi.waitFor(async () =>
      expect((await chrome.storage.local.get(SWIPE_PILL_HIDDEN_KEY))[SWIPE_PILL_HIDDEN_KEY]).toBe(
        true,
      ),
    );
    vi.advanceTimersByTime(3000);
    expect(document.querySelector('#matrx-swipe-pill')).toBeNull();

    // A fresh page load while closed never shows the card.
    host.remove();
    delete (window as unknown as { __matrxSwipePill?: boolean }).__matrxSwipePill;
    mountSwipePill();
    await vi.waitFor(() => expect(document.querySelector('#matrx-swipe-pill')).toBeNull());

    // Opening the extension clears the flag and the card comes back.
    await showSwipePillAgain();
    changed!({ [SWIPE_PILL_HIDDEN_KEY]: {} }, 'local');
    const back = document.querySelector<HTMLElement>('#matrx-swipe-pill');
    expect(back).not.toBeNull();
    expect(back!.style.visibility).toBe('visible');
  } finally {
    Object.assign(chrome.storage, { onChanged });
    await showSwipePillAgain();
  }
});
