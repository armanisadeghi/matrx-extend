import type { ChatMessage } from '@/state/chat';

/**
 * A first send is rendered optimistically before `useChatStream` mints and
 * adopts its conversation id. Those local messages must survive that null ->
 * UUID transition. Persisted messages always carry their conversation id, so
 * they must never suppress a later database hydration.
 */
export function isOptimisticNewConversation(messages: ChatMessage[]): boolean {
  return messages.length > 0 && messages.every((message) => message.conversationId == null);
}
