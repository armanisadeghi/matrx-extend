import { handleToolEvent } from '@/hooks/use-chat-stream';
import { type Message, type ToolCallRow, dbMessagesToChatMessages } from '@/lib/supabase/queries';
import { useChatStore } from '@/state/chat';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/client', () => ({ getSupabase: vi.fn() }));
vi.mock('@/lib/tools/registry', () => ({ lookup: () => ({ name: 'data_patterns' }) }));

afterEach(() => useChatStore.getState().reset());

const args = {
  action: 'save',
  kind: 'network_capture',
  domain: 'calendar.invalid',
  name: 'Network: https://user:SYNTHETIC_PASSWORD@calendar.invalid/api?access_token=SYNTHETIC_TOKEN',
  config: {
    url_filter: 'https://calendar.invalid/api?date=2026-09-27&access_token=SYNTHETIC_TOKEN',
    body_match: 'ignore',
  },
};

describe('D48 chat observation of Network save arguments', () => {
  it('keeps raw delegated arguments out of the live tool row while preserving useful identity', () => {
    useChatStore.setState({
      messages: [{ id: 'assistant-d48', role: 'assistant', content: '', timestamp: 1 }],
    });
    handleToolEvent('assistant-d48', {
      event: 'tool_delegated',
      call_id: 'call-d48',
      tool_name: 'data_patterns',
      data: { arguments: args },
    });
    const message = useChatStore.getState().messages[0];
    const part = message?.parts?.find((entry) => entry.type === 'tool');
    if (!part || part.type !== 'tool') throw new Error('No live tool row');
    expect(part.tool.phase).toBe('started');
    expect(JSON.stringify(part.tool.args)).not.toMatch(/SYNTHETIC_(TOKEN|PASSWORD)/);
    expect(JSON.stringify(part.tool.args)).toContain('date=2026-09-27');
  });

  it('hydrates the same safe arguments after reopening a conversation', () => {
    const message: Message = {
      id: '00000000-0000-4000-8000-000000000002',
      conversation_id: '00000000-0000-4000-8000-000000000001',
      role: 'assistant',
      position: 1,
      status: 'completed',
      created_at: '2026-09-27T00:00:00Z',
      metadata: null,
      content: [{ type: 'tool_call', call_id: 'call-d48', name: 'data_patterns', arguments: args }],
    };
    const row: ToolCallRow = {
      call_id: 'call-d48',
      message_id: message.id,
      conversation_id: message.conversation_id,
      tool_name: 'data_patterns',
      tool_type: 'local',
      status: 'delegated',
      arguments: args,
      output: null,
      is_error: null,
      error_type: null,
      error_message: null,
      duration_ms: null,
      created_at: '2026-09-27T00:00:00Z',
    };
    const { messages, badCount } = dbMessagesToChatMessages([message], [row]);
    expect(badCount).toBe(0);
    const part = messages[0]?.parts?.find((entry) => entry.type === 'tool');
    if (!part || part.type !== 'tool') throw new Error('No hydrated tool row');
    expect(JSON.stringify(part.tool.args)).not.toMatch(/SYNTHETIC_(TOKEN|PASSWORD)/);
    expect(JSON.stringify(part.tool.args)).toContain('date=2026-09-27');
  });
});
