import { createAccumulator } from '@/lib/guided-capture/accumulator';
import { mountGuidedOverlay } from '@/lib/guided-capture/overlay';
import {
  nextSlideControl,
  resolvePostRoot,
  scanPost,
  waitForSlide,
} from '@/lib/guided-capture/post';
import type { GuidedHostMsg } from '@/lib/guided-capture/protocol';
import { RECIPES } from '@/lib/guided-capture/recipes';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const url = 'https://www.instagram.com/p/C9Beaches/';
const recipe = RECIPES.instagram;
const setUrl = (value: string) =>
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(value);
function readyImage(img: HTMLImageElement) {
  Object.defineProperties(img, {
    naturalWidth: { configurable: true, get: () => 1080 },
    naturalHeight: { configurable: true, get: () => 1080 },
    complete: { configurable: true, get: () => true },
  });
}
function page() {
  document.body.innerHTML = `<main><article id="saved"><header><img src="https://cdn.example/avatar.jpg" width="100" /></header><a href="${url}">Post</a><img id="slide" src="https://cdn.example/coast.jpg" width="1080" /><video src="https://cdn.example/waves.mp4"><source type="video/mp4" /></video><button aria-label="Next">→</button></article><article><a href="https://www.instagram.com/p/C9Related/">Related</a><img src="https://cdn.example/related.jpg" width="1080" /><button aria-label="Next">→</button></article></main>`;
  readyImage(document.querySelector<HTMLImageElement>('#slide')!);
  Object.defineProperty(document.querySelector('video'), 'readyState', {
    configurable: true,
    value: 2,
  });
}
beforeEach(() => {
  setUrl(url);
  page();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  document.querySelector('#matrx-guided-capture')?.remove();
  delete (window as unknown as { __matrxGuided?: boolean }).__matrxGuided;
});

it('retains every recycled slide alongside video while excluding avatars and related posts', () => {
  const acc = createAccumulator(recipe);
  scanPost(acc, recipe, url);
  document.querySelector<HTMLImageElement>('#slide')!.src = 'https://cdn.example/sunset.jpg';
  scanPost(acc, recipe, url);
  document.querySelector<HTMLImageElement>('#slide')!.src = 'https://cdn.example/coast.jpg';
  scanPost(acc, recipe, url);
  expect(acc.count()).toBe(1);
  expect(acc.images().map((i) => [i.src, i.post_ref])).toEqual([
    ['https://cdn.example/coast.jpg', 'C9Beaches'],
    ['https://cdn.example/sunset.jpg', 'C9Beaches'],
  ]);
  expect(acc.videos()).toEqual([
    { src: 'https://cdn.example/waves.mp4', post_ref: 'C9Beaches', mime_type: 'video/mp4' },
  ]);
  setUrl('https://www.instagram.com/p/C9Related/');
  expect(scanPost(acc, recipe, url).root).toBeNull();
  expect(acc.images()).toHaveLength(2);
});

it('refuses ambiguous post roots and ambiguous or disabled next controls', () => {
  const root = resolvePostRoot(recipe, url)!;
  expect(nextSlideControl(root)).toBe(root.querySelector('button'));
  root.insertAdjacentHTML('beforeend', '<button aria-label="Next slide">→</button>');
  expect(nextSlideControl(root)).toBeNull();
  root.querySelector('button')!.setAttribute('disabled', '');
  expect(nextSlideControl(root)).toBe(root.querySelector('button:last-child'));
  root.querySelector('button:last-child')!.setAttribute('aria-disabled', 'true');
  expect(nextSlideControl(root)).toBeNull();
  document
    .querySelector('main')!
    .insertAdjacentHTML('beforeend', `<article><a href="${url}">Quoted duplicate</a></article>`);
  expect(resolvePostRoot(recipe, url)).toBeNull();
});

it('waits for decoded slide content and cancels pending navigation immediately', async () => {
  const acc = createAccumulator(recipe);
  const original = scanPost(acc, recipe, url).signature;
  const controller = new AbortController();
  const waiting = waitForSlide(() => scanPost(acc, recipe, url), original, 1000, controller.signal);
  const slide = document.querySelector<HTMLImageElement>('#slide')!;
  Object.defineProperty(slide, 'naturalWidth', { configurable: true, value: 0 });
  slide.src = 'https://cdn.example/sunset.jpg';
  await Promise.resolve();
  readyImage(slide);
  slide.dispatchEvent(new Event('load'));
  expect((await waiting)?.signature).toContain('sunset.jpg');
  const pending = waitForSlide(
    () => scanPost(acc, recipe, url),
    scanPost(acc, recipe, url).signature,
    1000,
    controller.signal,
  );
  controller.abort();
  expect(await pending).toBeNull();
});

it('announces browser-only video instead of silently counting it as a stored candidate', () => {
  const acc = createAccumulator(recipe);
  document.querySelector<HTMLVideoElement>('video')!.src = 'blob:https://www.instagram.com/session';
  document.querySelector('source')!.remove();
  expect(scanPost(acc, recipe, url).unavailableVideos).toBe(1);
  expect(acc.videos()).toEqual([]);
});

it('automatically reveals scoped carousel slides and files accumulated media through the guided port', async () => {
  vi.useFakeTimers();
  let receive: (message: GuidedHostMsg) => void = () => {};
  const sent = vi.fn();
  Object.assign(chrome, {
    runtime: {
      connect: () => ({
        postMessage: sent,
        onMessage: {
          addListener: (callback: typeof receive) => {
            receive = callback;
          },
        },
        onDisconnect: { addListener: () => {} },
      }),
    },
  });
  const next = document.querySelector<HTMLButtonElement>('#saved button')!;
  let step = 0;
  next.addEventListener('click', () => {
    step++;
    const slide = document.querySelector<HTMLImageElement>('#slide')!;
    slide.src = step === 1 ? 'https://cdn.example/sunset.jpg' : 'https://cdn.example/harbor.jpg';
    slide.dispatchEvent(new Event('load'));
    if (step === 2) next.disabled = true;
  });
  mountGuidedOverlay();
  receive({
    t: 'job',
    job: {
      handoffId: 'capture',
      url,
      title: 'Beach walk',
      platform: 'instagram',
      target: 'post',
      rowSteps: '',
    },
  });
  const shadow = document.querySelector('#matrx-guided-capture')!.shadowRoot!;
  shadow.querySelector<HTMLButtonElement>('[data-act="reveal"]')!.click();
  await vi.advanceTimersByTimeAsync(450);
  expect(step).toBe(2);
  expect(shadow.textContent).toContain('3 images · 1 videos');
  expect(shadow.textContent).toContain('Swipe through any remaining slides');
  shadow.querySelector<HTMLButtonElement>('[data-act="capture"]')!.click();
  const capture = sent.mock.calls.find(([message]) => message.t === 'capture')?.[0];
  expect(capture.payload.images.map((i: { src: string }) => i.src)).toEqual([
    'https://cdn.example/coast.jpg',
    'https://cdn.example/sunset.jpg',
    'https://cdn.example/harbor.jpg',
  ]);
  expect(capture.payload.videos[0].post_ref).toBe('C9Beaches');
  expect(capture.payload.images.some((i: { src: string }) => i.src.includes('related'))).toBe(
    false,
  );
});

it('keeps manual slide changes after Stop without scheduling another click', async () => {
  vi.useFakeTimers();
  let receive: (message: GuidedHostMsg) => void = () => {};
  const sent = vi.fn();
  Object.assign(chrome, {
    runtime: {
      connect: () => ({
        postMessage: sent,
        onMessage: {
          addListener: (callback: typeof receive) => {
            receive = callback;
          },
        },
        onDisconnect: { addListener: () => {} },
      }),
    },
  });
  const next = document.querySelector<HTMLButtonElement>('#saved button')!;
  const clicks = vi.fn();
  next.addEventListener('click', clicks);
  mountGuidedOverlay();
  receive({
    t: 'job',
    job: {
      handoffId: 'capture',
      url,
      title: 'Beach walk',
      platform: 'instagram',
      target: 'post',
      rowSteps: '',
    },
  });
  const shadow = document.querySelector('#matrx-guided-capture')!.shadowRoot!;
  shadow.querySelector<HTMLButtonElement>('[data-act="reveal"]')!.click();
  expect(clicks).toHaveBeenCalledOnce();
  shadow.querySelector<HTMLButtonElement>('[data-act="stop"]')!.click();
  document.querySelector<HTMLImageElement>('#slide')!.src = 'https://cdn.example/manual-sunset.jpg';
  await vi.advanceTimersByTimeAsync(500);
  expect(clicks).toHaveBeenCalledOnce();
  expect(shadow.textContent).toContain('2 images');
  shadow.querySelector<HTMLButtonElement>('[data-act="capture"]')!.click();
  const captured = sent.mock.calls.find(([message]) => message.t === 'capture')?.[0];
  expect(captured.payload.images).toHaveLength(2);
});
