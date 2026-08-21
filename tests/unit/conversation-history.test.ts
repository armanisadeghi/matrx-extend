import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSupabase: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  getSupabase: mocks.getSupabase,
}));
vi.mock('@/lib/debug/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

import { isOptimisticNewConversation } from '@/lib/chat/history';
import {
  type Message,
  type ToolCallRow,
  dbMessagesToChatMessages,
  fetchConversationHistory,
} from '@/lib/supabase/queries';
import type { ChatMessage } from '@/state/chat';

const CONVERSATION_ID = '00000000-0000-4000-8000-000000000001';
const ASSISTANT_ID = '00000000-0000-4000-8000-000000000002';

function assistantWithTool(callId = 'call-1'): Message {
  return {
    id: ASSISTANT_ID,
    conversation_id: CONVERSATION_ID,
    role: 'assistant',
    position: 1,
    status: 'completed',
    content: [{ type: 'tool_call', call_id: callId, name: 'click_element', arguments: { ref: 3 } }],
    created_at: '2026-08-20T12:00:00.000Z',
    metadata: null,
  };
}

function toolCall(overrides: Partial<ToolCallRow> = {}): ToolCallRow {
  return {
    call_id: 'call-1',
    message_id: null,
    conversation_id: CONVERSATION_ID,
    tool_name: 'click_element',
    tool_type: 'local',
    status: 'completed',
    arguments: { ref: 3 },
    output: '{"clicked":true}',
    is_error: false,
    error_type: null,
    error_message: null,
    duration_ms: 125,
    created_at: '2026-08-20T12:00:00.125Z',
    ...overrides,
  };
}

describe('conversation history truthfulness', () => {
  it('rejects a conversation-list read error instead of returning valid empty history', async () => {
    const failure = { message: 'permission denied', code: '42501' };
    const builder = {
      select: vi.fn(),
      is: vi.fn(),
      order: vi.fn(),
      limit: vi.fn().mockResolvedValue({ data: null, error: failure }),
    };
    builder.select.mockReturnValue(builder);
    builder.is.mockReturnValue(builder);
    builder.order.mockReturnValue(builder);
    mocks.getSupabase.mockReturnValue({
      schema: () => ({ from: () => builder }),
    });

    await expect(fetchConversationHistory()).rejects.toThrow(
      'Could not load conversation history: permission denied',
    );
  });

  it('hydrates a completed tool directly from a nullable-message-id tool row', () => {
    const { messages, badCount } = dbMessagesToChatMessages([assistantWithTool()], [toolCall()]);
    const part = messages[0]?.parts?.[0];

    expect(badCount).toBe(0);
    expect(part?.type).toBe('tool');
    if (part?.type !== 'tool') throw new Error('expected tool part');
    expect(part.tool).toMatchObject({
      kind: 'client',
      phase: 'completed',
      result: { clicked: true },
      message: 'Done',
    });
    expect(part.tool.endedAt).toBe(part.tool.startedAt + 125);
  });

  it('hydrates a durable failed status as an error even without a result message', () => {
    const { messages } = dbMessagesToChatMessages(
      [assistantWithTool()],
      [
        toolCall({
          status: 'failed',
          output: null,
          is_error: null,
          error_type: 'delivery_failed',
          error_message: 'The browser did not acknowledge the result.',
        }),
      ],
    );
    const part = messages[0]?.parts?.[0];

    expect(part?.type).toBe('tool');
    if (part?.type !== 'tool') throw new Error('expected tool part');
    expect(part.tool.phase).toBe('error');
    expect(part.tool.message).toBe('The browser did not acknowledge the result.');
  });

  it('keeps delegated calls non-terminal until durable terminal evidence exists', () => {
    const { messages } = dbMessagesToChatMessages(
      [assistantWithTool()],
      [toolCall({ status: 'delegated', output: null, is_error: null, duration_ms: null })],
    );
    const part = messages[0]?.parts?.[0];

    expect(part?.type).toBe('tool');
    if (part?.type !== 'tool') throw new Error('expected tool part');
    expect(part.tool.phase).toBe('started');
  });
});

describe('optimistic new-conversation detection', () => {
  const localMessage: ChatMessage = {
    id: 'local-user',
    role: 'user',
    content: 'hello',
    timestamp: 1,
    conversationId: null,
  };

  it('preserves only a non-empty all-local optimistic transcript', () => {
    expect(isOptimisticNewConversation([localMessage])).toBe(true);
    expect(isOptimisticNewConversation([])).toBe(false);
    expect(
      isOptimisticNewConversation([{ ...localMessage, conversationId: CONVERSATION_ID }]),
    ).toBe(false);
    expect(
      isOptimisticNewConversation([
        localMessage,
        { ...localMessage, id: 'persisted', conversationId: CONVERSATION_ID },
      ]),
    ).toBe(false);
  });
});
