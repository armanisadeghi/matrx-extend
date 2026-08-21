import { routeToolTimelineEvent } from '@/hooks/use-tool-inbox';
import type { ChatMessage, ToolPartCall } from '@/state/chat';
import { useChatStore } from '@/state/chat';
import { usePilotChatStore } from '@/state/pilot-chat';
import { afterEach, describe, expect, it } from 'vitest';

function assistant(
  id: string,
  conversationId: string,
  timestamp: number,
  tool?: Partial<ToolPartCall> & { callId: string },
): ChatMessage {
  return {
    id,
    role: 'assistant',
    content: '',
    conversationId,
    timestamp,
    parts: tool
      ? [
          {
            type: 'tool',
            tool: {
              kind: 'client',
              toolName: 'computer',
              phase: 'started',
              startedAt: timestamp,
              ...tool,
            },
          },
        ]
      : [],
  };
}

function tool(message: ChatMessage, callId: string): ToolPartCall | undefined {
  const part = message.parts?.find((p) => p.type === 'tool' && p.tool.callId === callId);
  return part?.type === 'tool' ? part.tool : undefined;
}

afterEach(() => {
  useChatStore.setState({ selectedConversationId: null, messages: [] });
  usePilotChatStore.setState({ selectedConversationId: null, messages: [] });
});

describe('client tool timeline routing', () => {
  it('attaches a new started call to the surface owning the conversation', () => {
    useChatStore.setState({
      selectedConversationId: 'conv-assistant',
      messages: [assistant('a1', 'conv-assistant', 10)],
    });
    usePilotChatStore.setState({
      selectedConversationId: 'conv-pilot',
      messages: [assistant('p1', 'conv-pilot', 20)],
    });

    routeToolTimelineEvent({
      callId: 'call-a',
      conversationId: 'conv-assistant',
      toolName: 'computer',
      phase: 'started',
      args: { action: 'click' },
    });

    expect(tool(useChatStore.getState().messages[0]!, 'call-a')?.phase).toBe('started');
    expect(tool(usePilotChatStore.getState().messages[0]!, 'call-a')).toBeUndefined();
  });

  it('completes the original call owner instead of the newest assistant bubble', () => {
    useChatStore.setState({
      selectedConversationId: 'conv-1',
      messages: [
        assistant('original', 'conv-1', 10, { callId: 'call-1' }),
        assistant('continuation', 'conv-1', 20),
      ],
    });

    routeToolTimelineEvent({
      callId: 'call-1',
      conversationId: 'conv-1',
      toolName: 'computer',
      phase: 'completed',
      output: { ok: true },
    });

    const [original, continuation] = useChatStore.getState().messages;
    expect(tool(original!, 'call-1')).toMatchObject({ phase: 'completed', result: { ok: true } });
    expect(tool(continuation!, 'call-1')).toBeUndefined();
  });

  it('routes Pilot progress and terminal events to the Pilot-owned call', () => {
    useChatStore.setState({
      selectedConversationId: 'conv-assistant',
      messages: [assistant('a1', 'conv-assistant', 10)],
    });
    usePilotChatStore.setState({
      selectedConversationId: 'conv-pilot',
      messages: [assistant('p1', 'conv-pilot', 20, { callId: 'call-p' })],
    });

    routeToolTimelineEvent({
      callId: 'call-p',
      conversationId: 'conv-pilot',
      toolName: 'computer',
      phase: 'started',
      progress: { label: 'Clicking' },
    });
    routeToolTimelineEvent({
      callId: 'call-p',
      conversationId: 'conv-pilot',
      toolName: 'computer',
      phase: 'error',
      message: 'Delivery failed',
    });

    expect(tool(usePilotChatStore.getState().messages[0]!, 'call-p')).toMatchObject({
      phase: 'error',
      message: 'Delivery failed',
      progress: [expect.objectContaining({ label: 'Clicking' })],
    });
    expect(tool(useChatStore.getState().messages[0]!, 'call-p')).toBeUndefined();
  });

  it('does not invent a tool row for an ownerless terminal event', () => {
    useChatStore.setState({
      selectedConversationId: 'conv-1',
      messages: [assistant('a1', 'conv-1', 10)],
    });

    routeToolTimelineEvent({
      callId: 'missing',
      conversationId: 'conv-1',
      toolName: 'computer',
      phase: 'completed',
      output: { ok: true },
    });

    expect(useChatStore.getState().messages[0]!.parts).toEqual([]);
  });

  it('never lets a late Pilot started event reopen a terminal call', () => {
    usePilotChatStore.setState({
      selectedConversationId: 'conv-pilot',
      messages: [
        assistant('p1', 'conv-pilot', 10, {
          callId: 'call-p',
          phase: 'completed',
          endedAt: 20,
        }),
      ],
    });

    routeToolTimelineEvent({
      callId: 'call-p',
      conversationId: 'conv-pilot',
      toolName: 'computer',
      phase: 'started',
    });

    expect(tool(usePilotChatStore.getState().messages[0]!, 'call-p')?.phase).toBe('completed');
  });
});
