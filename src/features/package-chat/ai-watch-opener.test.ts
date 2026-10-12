import { describe, expect, it, vi } from 'vitest';
import { createAiWatchWindowOpener } from './ai-watch-opener';

describe('createAiWatchWindowOpener', () => {
  it.each([
    [{ requestId: 'request-74af' }, 'ai-watch:r-request-74af'],
    [{ userRequestId: 'user-request-39be' }, 'ai-watch:u-user-request-39be'],
    [{ workflowRunId: 'workflow-82c1' }, 'ai-watch:w-workflow-82c1'],
    [{ conversationId: 'conversation-b671' }, 'ai-watch:c-conversation-b671'],
  ])('opens the documented Watch AI deep link for %o', (options, expectedPanel) => {
    const opened: Array<{ url: string }> = [];
    const openWatchAi = createAiWatchWindowOpener(async (properties) => {
      opened.push(properties);
    });

    openWatchAi(options);

    expect(opened).toHaveLength(1);
    const firstOpened = opened.at(0);
    if (!firstOpened) throw new Error('Expected Watch AI to open a browser tab.');
    const openedUrl = new URL(firstOpened.url);
    expect(openedUrl.origin).toBe('https://aimatrx.com');
    expect(openedUrl.searchParams.get('panels')).toBe(expectedPanel);
  });

  it('does not open a tab when no run or conversation identifier exists', () => {
    const opened: Array<{ url: string }> = [];
    const openWatchAi = createAiWatchWindowOpener(async (properties) => {
      opened.push(properties);
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    openWatchAi({});

    expect(opened).toHaveLength(0);
    error.mockRestore();
  });
});
