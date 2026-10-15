/**
 * The chat-target seam: every feature that hands words to "the chat" goes through
 * `lib/chat-target`, which goes through the package's host door and never touches the old store.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const door = {
  putTextInDraft: vi.fn(async () => undefined),
  openConversation: vi.fn(async () => undefined),
  currentConversationId: vi.fn(() => 'conv-from-package'),
  sendMessage: vi.fn(async () => ({ conversationId: 'conv-new' })),
};
vi.mock('@ai-matrx/chat/agents/components/chat/chat-door', () => ({ chatDoor: door }));

beforeEach(async () => {
  vi.clearAllMocks();
  const { useChatStore } = await import('@/state/chat');
  useChatStore.setState({ draft: '', selectedConversationId: null });
});

describe('every feature reaches the chat through the package door', () => {
  it('puts text in the package draft and leaves the old store alone', async () => {
    const {
      putTextInChatDraft,
      openConversationInChat,
      currentChatConversationId,
      sendThroughPackageChat,
    } = await import('@/lib/chat-target');
    const { useChatStore } = await import('@/state/chat');
    await putTextInChatDraft('selected');
    expect(door.putTextInDraft).toHaveBeenCalledWith('selected');
    expect(useChatStore.getState().draft).toBe('');
    await openConversationInChat('c2');
    expect(door.openConversation).toHaveBeenCalledWith('c2');
    expect(useChatStore.getState().selectedConversationId).toBeNull();
    expect(await currentChatConversationId()).toBe('conv-from-package');
    await sendThroughPackageChat({ text: 'go', agentId: 'a1', variables: { k: 'v' } });
    expect(door.sendMessage).toHaveBeenCalledWith({
      text: 'go',
      agentId: 'a1',
      variables: { k: 'v' },
    });
  });
});
