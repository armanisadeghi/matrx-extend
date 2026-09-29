import { chatTargetForViewer, shouldDiscardChatOnIdentityChange } from '@/lib/chat/guest-boundary';
import { DEFAULT_CHAT_MANDATE_REF } from '@/lib/mandates';
import { useChatStore } from '@/state/chat';
import { useHighlightStore } from '@/state/highlights';
import { describe, expect, it } from 'vitest';

describe('guest Chat identity boundary', () => {
  it('starts a guest on the platform chat Mandate even with an account Agent saved', () => {
    expect(chatTargetForViewer(null, 'private-agent-id')).toBe(DEFAULT_CHAT_MANDATE_REF);
  });

  it('keeps a signed-in person’s chosen Agent', () => {
    expect(chatTargetForViewer('account-a', 'chosen-agent-id')).toBe('chosen-agent-id');
  });

  it('discards visible turns when an account signs out or changes', () => {
    expect(shouldDiscardChatOnIdentityChange('account-a', null)).toBe(true);
    expect(shouldDiscardChatOnIdentityChange('account-a', 'account-b')).toBe(true);
    expect(shouldDiscardChatOnIdentityChange(null, null)).toBe(false);
    expect(shouldDiscardChatOnIdentityChange(null, 'account-a')).toBe(true);
  });

  it('clears account chat content and attachments before guest use', () => {
    useChatStore.setState({
      chatActorId: 'account-a',
      selectedAgentId: 'private-agent-id',
      selectedConversationId: 'private-conversation-id',
      messages: [{ id: 'private-turn', role: 'user', content: 'private', timestamp: 1 }],
      draft: 'private draft',
      variableValues: { 'private-agent-id.secret': 'private' },
      permissionMode: { 'private-agent-id': 'act' },
      isStreaming: true,
    });
    useHighlightStore.getState().attach('private-highlight');

    useChatStore.getState().clearForIdentityChange('guest');

    const chat = useChatStore.getState();
    expect(chat.chatActorId).toBe('guest');
    expect(chat.selectedAgentId).toBeNull();
    expect(chat.selectedConversationId).toBeNull();
    expect(chat.messages).toEqual([]);
    expect(chat.draft).toBe('');
    expect(chat.variableValues).toEqual({});
    expect(chat.permissionMode).toEqual({});
    expect(chat.isStreaming).toBe(false);
    expect(useHighlightStore.getState().attachedIds).toEqual([]);
  });
});
