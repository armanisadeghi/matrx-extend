import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureForDocument, readScreenshotDocument } from './document';
import { captureFullPage } from './full-page';

describe('screenshot document boundary', () => {
  const first = { documentId: 'harbor-intake-first', url: 'https://harbordental.test/intake' };
  const second = { documentId: 'harbor-intake-reloaded', url: first.url };
  let current = first;
  let activeTabId = 18;

  beforeEach(() => {
    current = first;
    activeTabId = 18;
    vi.stubGlobal('chrome', {
      tabs: {
        get: vi.fn(async () => ({
          id: 18,
          windowId: 4,
          url: current.url,
          title: 'Harbor Dental intake',
        })),
        query: vi.fn(async () => [{ id: activeTabId }]),
        captureVisibleTab: vi.fn(async () => 'data:image/png;base64,AAAA'),
      },
      webNavigation: { getFrame: vi.fn(async () => current) },
    });
  });

  it('rejects a same-URL replacement before saving captured bytes', async () => {
    const original = await readScreenshotDocument(18);
    await expect(
      captureForDocument(original, async () => {
        current = second;
        return 'image bytes from the replaced page';
      }),
    ).rejects.toThrow(/changed during screenshot/i);
  });

  it('rejects a different active tab before and after a window capture', async () => {
    const original = await readScreenshotDocument(18);
    activeTabId = 19;
    const capture = vi.fn(async () => 'unrelated image');
    await expect(captureForDocument(original, capture)).rejects.toThrow(/active tab changed/i);
    expect(capture).not.toHaveBeenCalled();
    activeTabId = 18;
    await expect(
      captureForDocument(original, async () => {
        activeTabId = 19;
        return 'unrelated image';
      }),
    ).rejects.toThrow(/active tab changed/i);
  });

  it('returns bytes only while the same initiating tab and document remain active', async () => {
    const original = await readScreenshotDocument(18);
    await expect(captureForDocument(original, async () => 'harbor intake image')).resolves.toBe(
      'harbor intake image',
    );
  });

  it('restores the initiating document scroll after a full-page tile detects a reload', async () => {
    const executeScript = vi.fn(async (request: { args?: [number[] | null, number, number] }) =>
      request.args
        ? [{ result: request.args[2] }]
        : [
            {
              result: {
                scrollX: 7,
                scrollY: 43,
                innerWidth: 800,
                innerHeight: 600,
                scrollWidth: 800,
                scrollHeight: 1200,
                viewportHeight: 600,
                scrollPath: null,
                clip: null,
              },
            },
          ],
    );
    Object.assign(chrome, { scripting: { executeScript } });
    vi.mocked(chrome.tabs.captureVisibleTab).mockImplementationOnce(async () => {
      current = second;
      return 'data:image/png;base64,AAAA';
    });
    const original = await readScreenshotDocument(18);
    await expect(captureFullPage(original)).rejects.toThrow(/page changed during screenshot/i);
    const scrollCalls = executeScript.mock.calls.filter(([request]) => !!request.args);
    expect(scrollCalls.at(-1)?.[0]).toMatchObject({
      target: { tabId: 18, documentIds: [first.documentId] },
      args: [null, 7, 43],
    });
  });
});
