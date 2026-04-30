import { agentExecutePath, type AgentStartRequest } from '@/lib/api/routes/ai';
import { log } from '@/lib/debug/log';
import { newId } from '@/lib/id';
import { on, send } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { type ChatMessage, useChatStore } from '@/state/chat';
import { useCallback, useEffect, useRef } from 'react';

interface SendOptions {
  agentId?: string;
  conversationId?: string;
  variables?: Record<string, unknown>;
}

interface StreamChunk {
  runId: string;
  type: 'text' | 'reasoning' | 'event' | 'error' | 'done';
  payload: {
    content?: string;
    eventName?: string;
    data?: Record<string, unknown>;
    message?: string;
  };
}

export function useChatStream() {
  const runIdRef = useRef<string | null>(null);
  const targetIdRef = useRef<string | null>(null);

  useEffect(() => {
    return on<StreamChunk, { ack: true }>(CHANNELS.STREAM_CHUNK, (chunk) => {
      if (chunk.runId !== runIdRef.current) return { ack: true };
      const target = targetIdRef.current;
      if (!target) return { ack: true };

      if (chunk.type === 'text') {
        if (chunk.payload.content)
          useChatStore.getState().appendAssistantText(target, chunk.payload.content);
      } else if (chunk.type === 'reasoning') {
        // Reasoning chunks are model "thinking" tokens — log only for now.
        log.info('stream', 'reasoning chunk', chunk.payload.content);
      } else if (chunk.type === 'event') {
        // Non-text events: phase, completion, tool_event, render_block, etc.
        // Logged for visibility; chat UI doesn't render them yet.
        log.info('stream', `event: ${chunk.payload.eventName}`, chunk.payload.data);
      } else if (chunk.type === 'error') {
        const message = chunk.payload.message ?? 'stream error';
        useChatStore.getState().appendAssistantText(target, `\n\n_Error:_ ${message}`);
      } else if (chunk.type === 'done') {
        useChatStore.getState().finalizeAssistant(target);
        useChatStore.getState().setStreaming(false);
        runIdRef.current = null;
        targetIdRef.current = null;
      }
      return { ack: true };
    });
  }, []);

  const sendMessage = useCallback(async (text: string, opts: SendOptions = {}) => {
    if (!opts.agentId) {
      log.error('stream', 'sendMessage called without agentId');
      return;
    }
    const userMsg: ChatMessage = {
      id: newId('user'),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    const assistantMsg: ChatMessage = {
      id: newId('asst'),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      pending: true,
    };
    useChatStore.getState().pushMessage(userMsg);
    useChatStore.getState().pushMessage(assistantMsg);
    useChatStore.getState().setStreaming(true);

    const runId = newId('run');
    runIdRef.current = runId;
    targetIdRef.current = assistantMsg.id;

    const body: AgentStartRequest = {
      user_input: text,
      conversation_id: opts.conversationId ?? null,
      variables: opts.variables ?? null,
      stream: true,
      store: true,
      source_app: 'matrx-extend',
      source_feature: 'chat',
    };

    await send(CHANNELS.STREAM_START, {
      runId,
      endpoint: agentExecutePath(opts.agentId),
      body,
      parser: 'rich-events' as const,
    });
  }, []);

  const cancel = useCallback(async () => {
    if (!runIdRef.current) return;
    await send(CHANNELS.STREAM_CANCEL, { runId: runIdRef.current });
    if (targetIdRef.current) useChatStore.getState().finalizeAssistant(targetIdRef.current);
    useChatStore.getState().setStreaming(false);
    runIdRef.current = null;
    targetIdRef.current = null;
  }, []);

  return { send: sendMessage, cancel };
}
