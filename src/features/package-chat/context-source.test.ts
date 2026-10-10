/**
 * The extension's package-chat context source: the page context the package asks for on every turn.
 * It must return the same keys `buildChatContext` builds, and nothing (not a throw) when the build
 * fails or is empty.
 */
import { describe, expect, it, vi } from 'vitest';

const build = vi.fn();
vi.mock('@/lib/chat/build-context', () => ({ buildChatContext: (...a: unknown[]) => build(...a) }));
vi.mock('@/lib/chat/active-tab', () => ({
  resolveActiveTab: async () => ({ id: 7, url: 'https://harborlightdental.com/lab-policy' }),
}));

import { useAutoScrapeStore } from '@/state/auto-scrape';
import { extensionPageContextSource } from './context-source';

const input = {
  conversationId: '3b9f1c2e-4d5a-4e6f-8a7b-9c0d1e2f3a4b',
  agentId: null,
  phase: 'start' as const,
};

describe('extension page context source', () => {
  it('hands the built page context to the turn', async () => {
    build.mockResolvedValueOnce({
      context: { page_brief: { url: 'https://harborlightdental.com/lab-policy' } },
      rows: [],
      withheld: [],
    });
    const out = await extensionPageContextSource.contribute(input);
    expect(out).toEqual({
      context: { page_brief: { url: 'https://harborlightdental.com/lab-policy' } },
    });
    expect(build).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: input.conversationId }),
    );
  });
  it('contributes nothing when the page gave nothing', async () => {
    build.mockResolvedValueOnce({ context: undefined, rows: [], withheld: [] });
    expect(await extensionPageContextSource.contribute(input)).toBeNull();
  });
  it('a failed build is skipped, not thrown', async () => {
    build.mockRejectedValueOnce(new Error('tab gone'));
    expect(await extensionPageContextSource.contribute(input)).toBeNull();
  });
  it('re-reads when the background page capture lands or clears, not only on tab events', () => {
    // Regression: returning to a tab fires onActivated before the auto-capture finishes, so the
    // chip read the page without its scrape (13 -> 3) and never refreshed when the capture landed.
    const l = () => ({ addListener: vi.fn(), removeListener: vi.fn() });
    const chromeStub = {
      tabs: { onActivated: l(), onUpdated: l(), query: vi.fn(async () => []) },
      windows: { onFocusChanged: l() },
      webNavigation: {
        onBeforeNavigate: l(),
        onCommitted: l(),
        onErrorOccurred: l(),
        getFrame: vi.fn(),
      },
    };
    vi.stubGlobal('chrome', chromeStub);
    const onChange = vi.fn();
    const unsubscribe = extensionPageContextSource.subscribe?.(onChange);
    useAutoScrapeStore.getState().clear();
    useAutoScrapeStore.getState().set({
      url: 'https://en.wikipedia.org/wiki/Coffee',
      pageKey: 'k',
      capturedAt: Date.now(),
      usedFullScroll: false,
      soup: {} as never,
    });
    expect(onChange).toHaveBeenCalled();
    onChange.mockClear();
    unsubscribe?.();
    useAutoScrapeStore.getState().clear();
    expect(onChange).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it('re-reads when the active page identity settles (it lags the tab events)', () => {
    // Regression: the scrape only counts once the page identity is ready, which happens after
    // onActivated; without this subscription the chip stayed at 3 on a page that gives 13.
    const l = () => ({ addListener: vi.fn(), removeListener: vi.fn() });
    const webNavigation = {
      onBeforeNavigate: l(),
      onCommitted: l(),
      onErrorOccurred: l(),
      getFrame: vi.fn(),
    };
    vi.stubGlobal('chrome', {
      tabs: { onActivated: l(), onUpdated: l(), query: vi.fn(async () => []) },
      windows: { onFocusChanged: l() },
      webNavigation,
    });
    const off = extensionPageContextSource.subscribe?.(vi.fn());
    expect(webNavigation.onCommitted.addListener).toHaveBeenCalled();
    off?.();
    expect(webNavigation.onCommitted.removeListener).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
