/**
 * THE CHAT TARGET SEAM. Other extension features hand words to "the chat" (right-click send-to-chat,
 * SEO verdict, showcase result, lists' Open in chat, the agenda runner, files reading the open
 * conversation). The chat is the shared `@ai-matrx/chat` package; every such feature goes through
 * here, so the one door to it is in ONE place.
 */

import { useSidepanelTabStore } from '@/state/sidepanel-tab';
import { useEffect, useState } from 'react';

/** The package's host door. */
async function door() {
  return (await import('@ai-matrx/chat/agents/components/chat/chat-door')).chatDoor;
}

/** Put `text` in the open chat's draft after what is already there, and show the Chat tab. */
export async function putTextInChatDraft(text: string): Promise<void> {
  useSidepanelTabStore.getState().setTab('chat');
  await (await door()).putTextInDraft(text);
}

/** Open an existing conversation in the chat and show the Chat tab. */
export async function openConversationInChat(conversationId: string): Promise<void> {
  useSidepanelTabStore.getState().setTab('chat');
  await (await door()).openConversation(conversationId);
}

/** The conversation the chat shows now, or null. */
export async function currentChatConversationId(): Promise<string | null> {
  return (await door()).currentConversationId();
}

/** Send `text` to an agent (variables by name) and show the conversation. */
export async function sendThroughPackageChat(message: {
  text: string;
  agentId?: string;
  mandateKey?: string;
  variables?: Record<string, unknown>;
  conversationId?: string | null;
}): Promise<{ conversationId: string }> {
  useSidepanelTabStore.getState().setTab('chat');
  const { mandateKey, ...rest } = message;
  return (await door()).sendMessage({
    ...rest,
    ...(mandateKey ? { mandateKey: mandateKey as never } : {}),
  });
}

/** The open conversation id, live. The door's address is not observable from outside React, so poll it. */
export function useChatConversationId(): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const read = () =>
      void currentChatConversationId().then((next) => live && setId((p) => (p === next ? p : next)));
    read();
    const timer = setInterval(read, 500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  return id;
}
