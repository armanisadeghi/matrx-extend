import { usePilotChatStream } from '@/hooks/use-pilot-chat-stream';
import type { AgentStartRequest } from '@/lib/api/routes/ai';
import { DEFAULT_CHAT_MANDATE_REF, STRUCTURED_EXTRACTOR_MANDATE_REF } from '@/lib/mandates';
import { usePilotChatStore } from '@/state/pilot-chat';
import { useSettingsStore } from '@/state/settings';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface StartEnvelope {
  endpoint: string;
  body: AgentStartRequest;
  assignedTabId: number;
}
const transport = vi.hoisted(() => ({
  send: vi.fn(async (_channel: string, _payload: StartEnvelope) => ({ ack: true })),
}));
vi.mock('@/lib/messaging/native', () => ({
  send: transport.send,
  on: () => () => {},
}));
vi.mock('@/lib/auth/flow', () => ({ getAccessToken: async () => null }));
vi.mock('@/lib/permissions/optional', () => ({
  ALL_OPTIONAL: [],
  hasOptionalPermissions: async () => false,
}));
vi.mock('@/lib/chat/refresh-page-context', () => ({
  refreshPageContextBeforeSend: async () => ({ action: 'none', reason: 'no page' }),
}));
vi.mock('@/lib/chat/build-context', () => ({
  buildChatContext: async () => ({ values: {}, rows: [], context: undefined, withheld: [] }),
}));
vi.mock('@/lib/settings/default-chat-model', () => ({ defaultChatModelFor: async () => null }));

// Harbor Dental staff start a Pilot browser session through the default Holder,
// or choose a saved agent. Observe the actual hook's outgoing transport envelope.
describe('Pilot start target routing', () => {
  beforeEach(() => {
    transport.send.mockClear();
    Object.assign(chrome, {
      tabs: { query: async () => [] },
      runtime: { id: 'harbor-dental-extension', getManifest: () => ({ version: '0.2.1' }) },
    });
    useSettingsStore.setState({ modelOverrideId: null });
    usePilotChatStore.setState({
      selectedAgentId: null,
      selectedConversationId: null,
      messages: [],
      permissionMode: {},
      isStreaming: false,
    });
  });
  afterEach(() => cleanup());

  it.each([DEFAULT_CHAT_MANDATE_REF, STRUCTURED_EXTRACTOR_MANDATE_REF])(
    'starts %s through its mandate door',
    async (target) => {
      const { result } = renderHook(() => usePilotChatStream());
      await act(async () => {
        await result.current.send('Review the new-patient intake page.', {
          agentId: target,
          assignedTabId: 71,
        });
      });
      expect(transport.send).toHaveBeenCalledTimes(1);
      const envelope = transport.send.mock.calls[0]?.[1];
      if (!envelope) throw new Error('Pilot start transport was not called');
      expect(envelope.endpoint).toBe(`/v2/ai/mandates/${target.slice('mandate:'.length)}`);
      expect(envelope.body).toMatchObject({ is_new: true, store: true, initiation: 'user' });
      expect(envelope.body.conversation_id).toBe(
        usePilotChatStore.getState().selectedConversationId,
      );
      expect(envelope.assignedTabId).toBe(71);
    },
  );

  it.each(['ad2f9baa-e6fd-4479-b311-c55042feec61', '34d95ff6-5923-4cd0-aa55-8349fe1031ea'])(
    'starts saved agent %s through its agent door',
    async (target) => {
      const conversation = '1c08c1fb-027d-49ed-a0de-c886af17ca09';
      const { result } = renderHook(() => usePilotChatStream());
      await act(async () => {
        await result.current.send('Review the new-patient intake page.', {
          agentId: target,
          conversationId: conversation,
          assignedTabId: 73,
        });
      });
      expect(transport.send).toHaveBeenCalledTimes(1);
      const envelope = transport.send.mock.calls[0]?.[1];
      if (!envelope) throw new Error('Pilot start transport was not called');
      expect(envelope.endpoint).toBe(`/v2/ai/agent/${target}`);
      expect(envelope.body).toMatchObject({
        conversation_id: conversation,
        is_new: false,
        store: true,
      });
      expect(envelope.assignedTabId).toBe(73);
    },
  );
});
