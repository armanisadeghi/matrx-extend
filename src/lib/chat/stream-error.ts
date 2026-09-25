import { useChatStore } from '@/state/chat';

/**
 * The only path from a stream failure into an assistant message. `message`
 * originates in the transport's safe-copy contract, never an exception body.
 */
export function presentChatStreamError({
  messageId,
  runId,
  message,
  lastInput,
}: {
  messageId: string;
  runId: string;
  message: string;
  lastInput: string;
}): void {
  const chat = useChatStore.getState();
  chat.appendAssistantText(messageId, `\n\n_Error:_ ${message}`);
  chat.setStreamInterruption({
    runId,
    reason: 'error',
    lastInput,
    at: Date.now(),
  });
}
