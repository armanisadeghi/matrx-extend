import type { StreamErrorCode } from '@/lib/api/stream';
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
  code,
}: {
  messageId: string;
  runId: string;
  message: string;
  lastInput: string;
  code?: StreamErrorCode;
}): void {
  const chat = useChatStore.getState();
  chat.appendAssistantText(messageId, `\n\n_Error:_ ${message}`);
  if (code === 'guest_ai_allowance_used') {
    chat.setStreamInterruption(null);
    return;
  }
  chat.setStreamInterruption({
    runId,
    reason: 'error',
    lastInput,
    at: Date.now(),
  });
}
