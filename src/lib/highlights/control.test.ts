import { CHANNELS } from '@/lib/messaging/schemas';
import { beforeEach, expect, it, vi } from 'vitest';
import { setHighlighterMode, startHighlighter, stopHighlighter } from './control';

const executeScript = vi.fn();
const sendMessage = vi.fn();

beforeEach(() => {
  executeScript.mockReset().mockResolvedValue([]);
  sendMessage.mockReset().mockResolvedValue(undefined);
  Object.assign(globalThis, {
    chrome: {
      scripting: { executeScript },
      tabs: { sendMessage },
    },
  });
});

it.each([
  [11, 'document-one', 'session-one'],
  [22, 'document-two', 'session-two'],
])(
  'addresses injection, start, mode, and stop to document %s/%s',
  async (tabId, documentId, sessionId) => {
    expect(await startHighlighter(tabId, documentId, sessionId)).toBe(true);
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId, documentIds: [documentId] },
      files: ['content-scripts/highlighter.js'],
    });
    expect(sendMessage).toHaveBeenCalledWith(
      tabId,
      { __matrx: true, kind: CHANNELS.HIGHLIGHT_START, payload: { sessionId } },
      { documentId },
    );
    await setHighlighterMode(tabId, documentId, sessionId, 'element');
    await stopHighlighter(tabId, documentId, sessionId);
    expect(sendMessage).toHaveBeenCalledWith(
      tabId,
      { __matrx: true, kind: CHANNELS.HIGHLIGHT_SET_MODE, payload: { sessionId, mode: 'element' } },
      { documentId },
    );
    expect(sendMessage).toHaveBeenCalledWith(
      tabId,
      { __matrx: true, kind: CHANNELS.HIGHLIGHT_STOP, payload: { sessionId } },
      { documentId },
    );
  },
);

it('does not report an active overlay if the exact document has no listener', async () => {
  sendMessage.mockRejectedValueOnce(new Error('Receiving end does not exist'));
  expect(await startHighlighter(11, 'document-gone', 'session-gone')).toBe(false);
});
