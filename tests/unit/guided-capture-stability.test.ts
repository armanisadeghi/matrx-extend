import { mountGuidedOverlay } from '@/lib/guided-capture/overlay';
import { GUIDED_WAKE, type GuidedHostMsg } from '@/lib/guided-capture/protocol';
import { findFeedScroller } from '@/lib/guided-capture/scroller';
import { wakeGuide } from '@/lib/guided-capture/start';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const profile = 'https://www.instagram.com/harbor.bakery/';
const setUrl = (value: string) =>
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(value);
const sized = (el: Element, scrollHeight: number, clientHeight: number) =>
  Object.defineProperties(el, {
    scrollHeight: { configurable: true, get: () => scrollHeight },
    clientHeight: { configurable: true, get: () => clientHeight },
    clientWidth: { configurable: true, get: () => 600 },
  });

let receive: (message: GuidedHostMsg) => void = () => {};
let wakeListener: ((m: unknown, sender: unknown, reply: (r: unknown) => void) => boolean) | null =
  null;
const sent = vi.fn();

function mountProfileJob() {
  mountGuidedOverlay();
  receive({
    t: 'job',
    job: {
      handoffId: 'h1',
      url: profile,
      title: 'Harbor Bakery',
      platform: 'instagram',
      target: 'profile',
      rowSteps: '',
    },
  });
  return document.querySelector('#matrx-guided-capture')!.shadowRoot!;
}

beforeEach(() => {
  setUrl(profile);
  document.body.innerHTML = '<main id="feed"></main>';
  sent.mockReset();
  wakeListener = null;
  Object.assign(chrome, {
    runtime: {
      ...chrome.runtime,
      connect: () => ({
        postMessage: sent,
        onMessage: {
          addListener: (cb: typeof receive) => {
            receive = cb;
          },
        },
        onDisconnect: { addListener: () => {} },
      }),
      onMessage: {
        addListener: (cb: (m: unknown) => boolean) => {
          wakeListener = cb;
        },
      },
    },
  });
});
afterEach(() => {
  vi.useRealTimers();
  document.querySelector('#matrx-guided-capture')?.remove();
  delete (window as unknown as { __matrxGuided?: boolean }).__matrxGuided;
});

it('keeps the same buttons while a busy feed keeps changing, so a click is never lost mid-redraw', async () => {
  vi.useFakeTimers();
  const shadow = mountProfileJob();
  const scrollButton = shadow.querySelector('[data-act="scroll"]');
  expect(scrollButton).not.toBeNull();
  // The site re-renders constantly (no new posts): every scan used to rewrite the card.
  for (let i = 0; i < 5; i++) {
    document.querySelector('#feed')!.append(document.createElement('div'));
    await vi.advanceTimersByTimeAsync(450);
  }
  expect(shadow.querySelector('[data-act="scroll"]')).toBe(scrollButton);
});

it('Scroll for me moves the inner panel when the page itself cannot scroll', async () => {
  vi.useFakeTimers();
  sized(document.documentElement, 900, 900);
  const panel = document.querySelector<HTMLElement>('#feed')!;
  panel.style.overflowY = 'auto';
  sized(panel, 6000, 800);
  let top = 0;
  Object.defineProperty(panel, 'scrollTop', { configurable: true, get: () => top });
  const panelScroll = vi.fn(({ top: by }: { top: number }) => {
    top += by;
  });
  panel.scrollBy = panelScroll as never;
  const windowScroll = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
  const shadow = mountProfileJob();
  shadow.querySelector<HTMLButtonElement>('[data-act="scroll"]')!.click();
  await vi.advanceTimersByTimeAsync(2000);
  expect(panelScroll).toHaveBeenCalled();
  expect(windowScroll).not.toHaveBeenCalled();
  shadow.querySelector<HTMLButtonElement>('[data-act="scroll-stop"]')?.click();
});

it('scrolls the page itself when the page can move', () => {
  sized(document.documentElement, 8000, 900);
  expect(findFeedScroller().element).toBeNull();
});

it('a wake from the service worker makes the guide ask for its job again', () => {
  mountGuidedOverlay();
  sent.mockClear();
  const reply = vi.fn();
  wakeListener?.({ t: GUIDED_WAKE }, {}, reply);
  expect(sent).toHaveBeenCalledWith({ t: 'hello' });
  expect(reply).toHaveBeenCalledWith({ guide: 'alive' });
});

it('re-injects the guide when the tab only has a dead copy (opened before the extension reloaded)', async () => {
  const executeScript = vi.fn(async () => []);
  Object.assign(chrome, {
    tabs: {
      ...chrome.tabs,
      sendMessage: vi.fn(async () => {
        throw new Error('Receiving end does not exist.');
      }),
    },
    scripting: { executeScript },
  });
  await wakeGuide(7);
  expect(executeScript).toHaveBeenCalledWith({
    target: { tabId: 7 },
    files: ['content-scripts/guided-capture.js'],
  });

  // Another live script answered, but not the guide: still re-inject.
  executeScript.mockClear();
  Object.assign(chrome, { tabs: { ...chrome.tabs, sendMessage: vi.fn(async () => undefined) } });
  await wakeGuide(7);
  expect(executeScript).toHaveBeenCalledTimes(1);

  executeScript.mockClear();
  Object.assign(chrome, {
    tabs: { ...chrome.tabs, sendMessage: vi.fn(async () => ({ guide: 'alive' })) },
  });
  await wakeGuide(7);
  expect(executeScript).not.toHaveBeenCalled();
});
