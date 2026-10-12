import type { OpenAiWatchWindowOptions } from '@ai-matrx/chat/host/window-openers';

type CreateTab = (properties: { url: string }) => Promise<unknown>;

function aiWatchPanelInstance(options: OpenAiWatchWindowOptions): string | null {
  const targets = [
    [options.workflowRunId, 'w'],
    [options.userRequestId, 'u'],
    [options.requestId, 'r'],
    [options.conversationId, 'c'],
  ] as const;
  const target = targets.find(([id]) => typeof id === 'string' && id.trim().length > 0);
  return target ? `${target[1]}-${target[0]?.trim()}` : null;
}

/** Open the platform's documented Watch AI panel deep link in a browser tab. */
export function createAiWatchWindowOpener(createTab: CreateTab) {
  return (options: OpenAiWatchWindowOptions): void => {
    const instance = aiWatchPanelInstance(options);
    if (!instance) {
      console.error('Watch AI could not open because the run has no watchable identifier.');
      return;
    }

    const url = new URL('https://aimatrx.com/');
    url.searchParams.set('panels', `ai-watch:${instance}`);
    void createTab({ url: url.toString() }).catch((error: unknown) => {
      console.error('Watch AI could not open in aimatrx.com.', error);
    });
  };
}
