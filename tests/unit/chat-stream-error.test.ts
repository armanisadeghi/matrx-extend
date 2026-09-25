import { presentChatStreamError } from '@/lib/chat/stream-error';
import { useChatStore } from '@/state/chat';
import { beforeEach, describe, expect, it } from 'vitest';

describe('presentChatStreamError', () => {
  beforeEach(() => {
    useChatStore.setState({
      messages: [
        {
          id: 'assistant-harbor-dental',
          role: 'assistant',
          content: '',
          timestamp: 1,
          pending: true,
        },
      ],
      streamInterruption: null,
    });
  });

  it('renders safe failure copy and creates the Retry state for the interrupted turn', () => {
    presentChatStreamError({
      messageId: 'assistant-harbor-dental',
      runId: 'run-harbor-dental',
      message: 'The chat service could not start this request. Try again.',
      lastInput: 'Summarize this new-patient intake page.',
    });

    const state = useChatStore.getState();
    expect(state.messages[0]?.content).toBe(
      '\n\n_Error:_ The chat service could not start this request. Try again.',
    );
    expect(state.streamInterruption).toEqual(
      expect.objectContaining({
        runId: 'run-harbor-dental',
        reason: 'error',
        lastInput: 'Summarize this new-patient intake page.',
      }),
    );
  });
});
