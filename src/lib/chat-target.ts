/**
 * THE CHAT TARGET SEAM. Other extension features hand words to "the chat" (right-click send-to-chat,
 * SEO verdict, showcase result, lists' Open in chat, the agenda runner, files reading the open
 * conversation). Which chat that is depends on the panel mode: the extension's own chat (default)
 * or the shared `@ai-matrx/chat` package (`sidepanel.html?chat=package`). Every such feature goes
 * through here, so the choice is made in ONE place; in default mode every function does exactly what
 * the feature did before (the old chat store), and the package is never even loaded.
 */

import { useChatStore } from '@/state/chat';
import { useSettingsStore } from '@/state/settings';
import { useSidepanelTabStore } from '@/state/sidepanel-tab';
import { useEffect, useState } from 'react';

/**
 * True when the panel shows the package chat: the person's Settings → Chat choice (persisted), or
 * `sidepanel.html?chat=package` (a developer override). The side panel waits for settings to load
 * before it mounts (sidepanel/main.tsx), so this synchronous read is already correct at first render.
 */
export function isPackageChatMode(): boolean {
  try {
    if (new URLSearchParams(globalThis.location?.search ?? '').get('chat') === 'package')
      return true;
  } catch {
    // no location (service worker): fall through to the saved choice
  }
  return useSettingsStore.getState().chatSurface === 'package';
}

/** The package's host door, loaded only in package mode. */
async function door() {
  return (await import('@ai-matrx/chat/agents/components/chat/chat-door')).chatDoor;
}

/** Put `text` in the open chat's draft after what is already there, and show the Chat tab. */
export async function putTextInChatDraft(text: string): Promise<void> {
  useSidepanelTabStore.getState().setTab('chat');
  if (isPackageChatMode()) {
    await (await door()).putTextInDraft(text);
    return;
  }
  const chat = useChatStore.getState();
  chat.setDraft(chat.draft ? `${chat.draft}\n\n${text}` : text);
}

/** Open an existing conversation in the chat and show the Chat tab. */
export async function openConversationInChat(conversationId: string): Promise<void> {
  useSidepanelTabStore.getState().setTab('chat');
  if (isPackageChatMode()) {
    await (await door()).openConversation(conversationId);
    return;
  }
  useChatStore.getState().setConversation(conversationId);
}

/** The conversation the chat shows now, or null. */
export async function currentChatConversationId(): Promise<string | null> {
  if (isPackageChatMode()) return (await door()).currentConversationId();
  return useChatStore.getState().selectedConversationId;
}

/** Package mode only: send `text` to an agent (variables by name) and show the conversation. */
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

/** The open conversation id, live. Package mode polls the door (its address is not observable from outside React). */
export function useChatConversationId(): string | null {
  const legacy = useChatStore((s) => s.selectedConversationId);
  const [packaged, setPackaged] = useState<string | null>(null);
  const packageMode = isPackageChatMode();
  useEffect(() => {
    if (!packageMode) return;
    let live = true;
    const read = () =>
      void currentChatConversationId().then(
        (id) => live && setPackaged((p) => (p === id ? p : id)),
      );
    read();
    const timer = setInterval(read, 500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [packageMode]);
  return packageMode ? packaged : legacy;
}
