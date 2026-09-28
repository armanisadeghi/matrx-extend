import { afterEach, describe, expect, it, vi } from 'vitest';
import { preparePage } from './page-prep';

afterEach(() => vi.unstubAllGlobals());

describe('preparePage injection result', () => {
  it.each([[], [{ result: undefined }], [{ result: null }]])(
    'refuses a missing page report instead of showing false success: %j',
    async (injectionResult) => {
      const executeScript = vi.fn().mockResolvedValue(injectionResult);
      vi.stubGlobal('chrome', { scripting: { executeScript } });

      await expect(preparePage(812)).rejects.toThrow(
        'The page did not return a valid preparation report. Reload the page and try Prepare again.',
      );
      expect(executeScript).toHaveBeenCalledWith(
        expect.objectContaining({ target: { tabId: 812 } }),
      );
    },
  );

  it.each([
    { banners_dismissed: [], load_more_clicks: [], scroll_steps: 0 },
    { banners_dismissed: [], load_more_clicks: 'none', scroll_steps: 0, duration_ms: 37 },
    {
      banners_dismissed: [{ selector: 5, text: 'Accept all' }],
      load_more_clicks: [],
      scroll_steps: 0,
      duration_ms: 37,
    },
    { banners_dismissed: [], load_more_clicks: [], scroll_steps: -1, duration_ms: 37 },
  ])('refuses malformed preparation data: %j', async (malformedReport) => {
    const executeScript = vi.fn().mockResolvedValue([{ result: malformedReport }]);
    vi.stubGlobal('chrome', { scripting: { executeScript } });

    await expect(preparePage(812)).rejects.toThrow('valid preparation report');
  });

  it.each([
    {
      report: {
        banners_dismissed: [{ selector: 'button', text: 'Accept all' }],
        load_more_clicks: [],
        scroll_steps: 3,
        duration_ms: 851,
      },
      config: { dismissBanners: true, expandLoadMore: false, scrollToBottom: true },
    },
    {
      report: {
        banners_dismissed: [],
        load_more_clicks: [{ selector: 'button', text: 'Load more' }],
        scroll_steps: 0,
        duration_ms: 807,
      },
      config: { dismissBanners: false, expandLoadMore: true, scrollToBottom: false },
    },
  ])(
    'returns the actual complete page report with the selected options: %j',
    async ({ report, config }) => {
      const executeScript = vi.fn().mockResolvedValue([{ result: report }]);
      vi.stubGlobal('chrome', { scripting: { executeScript } });

      await expect(preparePage(812, config)).resolves.toEqual(report);
      expect(executeScript).toHaveBeenCalledWith(
        expect.objectContaining({
          target: { tabId: 812 },
          args: [expect.objectContaining(config)],
        }),
      );
    },
  );
});
