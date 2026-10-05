import { captureFullPage } from '@/lib/screenshot/full-page';
import { afterEach, describe, expect, it, vi } from 'vitest';

// An app's main pane scrolls independently while its navigation remains visible.
// Replacing captureFullPage with a viewport capture loses the pane's lower content.
const page = {
  tabId: 42,
  windowId: 3,
  documentId: 'capture-document',
  url: 'https://aimatrx.com/tasks',
  title: 'Tasks',
};

function setupPage(contentHeight: number, nested: boolean) {
  document.body.innerHTML = nested ? '<main style="overflow-y: auto"></main>' : '';
  const pane = nested ? document.querySelector('main') : null;
  Object.defineProperties(window, {
    innerWidth: { configurable: true, value: 1000 },
    innerHeight: { configurable: true, value: 600 },
    devicePixelRatio: { configurable: true, value: 1 },
    scrollX: { configurable: true, value: 0, writable: true },
    scrollY: { configurable: true, value: nested ? 0 : 75, writable: true },
  });
  Object.defineProperties(document.documentElement, {
    scrollHeight: { configurable: true, value: nested ? 600 : contentHeight },
    scrollWidth: { configurable: true, value: 1000 },
    clientHeight: { configurable: true, value: 600 },
  });
  window.scrollTo = vi.fn((options?: ScrollToOptions | number, _y?: number) => {
    if (!options || typeof options === 'number') return;
    Object.defineProperty(window, 'scrollY', {
      value: Math.min(options.top ?? 0, nested ? 0 : contentHeight - 600),
    });
    Object.defineProperty(window, 'scrollX', { value: options.left ?? 0 });
  });
  if (pane) {
    Object.defineProperties(pane, {
      clientHeight: { configurable: true, value: 500 },
      clientWidth: { configurable: true, value: 900 },
      scrollHeight: { configurable: true, value: contentHeight },
      scrollTop: { configurable: true, value: 125, writable: true },
      scrollLeft: { configurable: true, value: 0, writable: true },
    });
    pane.getBoundingClientRect = () => new DOMRect(100, 100, 900, 500);
    pane.scrollTo = vi.fn((options?: ScrollToOptions | number, _y?: number) => {
      if (options && typeof options !== 'number')
        pane.scrollTop = Math.min(options.top ?? 0, contentHeight - 500);
    });
  }
  const tiles: number[] = [];
  const draws: unknown[][] = [];
  vi.stubGlobal('chrome', {
    tabs: {
      get: async () => ({ id: 42, windowId: 3, title: 'Tasks' }),
      query: async () => [{ id: 42 }],
      captureVisibleTab: async () => {
        tiles.push(pane?.scrollTop ?? window.scrollY);
        return 'data:image/png;base64,AQ==';
      },
    },
    webNavigation: { getFrame: async () => ({ documentId: 'capture-document', url: page.url }) },
    scripting: {
      executeScript: async ({
        func,
        args = [],
      }: { func: (...args: never[]) => unknown; args?: never[] }) => [{ result: func(...args) }],
    },
  });
  vi.stubGlobal('createImageBitmap', async () => ({ width: 1000, height: 600, close: vi.fn() }));
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      getContext() {
        return { drawImage: (...args: unknown[]) => draws.push(args) };
      }
      async convertToBlob() {
        return { arrayBuffer: async () => new Uint8Array([1]).buffer };
      }
    },
  );
  vi.useFakeTimers();
  return { pane, tiles, draws };
}

async function capture() {
  const pending = captureFullPage(page);
  await vi.runAllTimersAsync();
  return pending;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('full page capture', () => {
  it.each([
    { height: 1500, outputHeight: 1600, positions: [0, 500, 1000], lastDrawY: 1100 },
    { height: 2200, outputHeight: 2300, positions: [0, 500, 1000, 1500, 1700], lastDrawY: 1800 },
  ])(
    'captures all $height pixels of a nested scrolling pane',
    async ({ height, outputHeight, positions, lastDrawY }) => {
      const { pane, tiles, draws } = setupPage(height, true);
      const result = await capture();
      expect(result.height).toBe(outputHeight);
      expect(result.tileCount).toBe(positions.length);
      expect(tiles).toEqual(positions);
      expect(draws.at(-1)?.slice(1)).toEqual([100, 100, 900, 500, 100, lastDrawY, 900, 500]);
      expect(pane?.scrollTop).toBe(125);
    },
  );

  it('preserves document scrolling capture and its original position', async () => {
    const { tiles } = setupPage(1600, false);
    const result = await capture();
    expect(result.height).toBe(1600);
    expect(tiles).toEqual([0, 600, 1000]);
    expect(window.scrollY).toBe(75);
  });
  it('restores the pane when Chrome cannot capture a tile', async () => {
    const { pane } = setupPage(1500, true);
    chrome.tabs.captureVisibleTab = vi.fn().mockRejectedValue(new Error('Capture unavailable'));
    const pending = captureFullPage(page);
    const rejected = expect(pending).rejects.toThrow('Capture unavailable');
    await vi.runAllTimersAsync();
    await rejected;
    expect(pane?.scrollTop).toBe(125);
  });

  it('refuses a full page image when the pane does not move', async () => {
    const { pane, tiles } = setupPage(1500, true);
    if (!pane) throw new Error('Missing scrolling pane');
    pane.scrollTop = 0;
    pane.scrollTo = vi.fn();
    const pending = captureFullPage(page);
    const rejected = expect(pending).rejects.toThrow('did not scroll');
    await vi.runAllTimersAsync();
    await rejected;
    expect(tiles).toEqual([0]);
  });
});
