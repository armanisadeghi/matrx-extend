/**
 * The chat-target seam: every feature that hands words to "the chat" goes through
 * `lib/chat-target`. Default mode keeps the old chat store exactly; package mode (`?chat=package`)
 * goes through the package's host door and never touches the old store.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const door = {
  putTextInDraft: vi.fn(async () => undefined),
  openConversation: vi.fn(async () => undefined),
  currentConversationId: vi.fn(() => 'conv-from-package'),
  sendMessage: vi.fn(async () => ({ conversationId: 'conv-new' })),
};
vi.mock('@ai-matrx/chat/agents/components/chat/chat-door', () => ({ chatDoor: door }));

function setMode(mode: 'default' | 'package') {
  window.history.replaceState(
    {},
    '',
    mode === 'package' ? '/sidepanel.html?chat=package' : '/sidepanel.html',
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  const { useChatStore } = await import('@/state/chat');
  useChatStore.setState({ draft: '', selectedConversationId: null });
});
afterEach(() => setMode('default'));

describe('default mode: the old chat, unchanged', () => {
  it('appends to the old draft and opens the Chat tab; the package is untouched', async () => {
    setMode('default');
    const { putTextInChatDraft, openConversationInChat, currentChatConversationId } = await import(
      '@/lib/chat-target'
    );
    const { useChatStore } = await import('@/state/chat');
    const { useSidepanelTabStore } = await import('@/state/sidepanel-tab');
    useChatStore.getState().setDraft('typed');
    await putTextInChatDraft('selected');
    expect(useChatStore.getState().draft).toBe('typed\n\nselected');
    expect(useSidepanelTabStore.getState().tab).toBe('chat');
    await openConversationInChat('c1');
    expect(useChatStore.getState().selectedConversationId).toBe('c1');
    expect(await currentChatConversationId()).toBe('c1');
    expect(door.putTextInDraft).not.toHaveBeenCalled();
    expect(door.openConversation).not.toHaveBeenCalled();
  });
});

describe('package mode: through the package door', () => {
  it('puts text in the package draft and leaves the old store alone', async () => {
    setMode('package');
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
