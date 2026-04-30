import { AGENT_EXECUTE_PATH, UNIFIED_CHAT_PATH } from '@/lib/api/routes/ai';
import { newId } from '@/lib/id';
import { CHANNELS } from '@/lib/messaging/schemas';
import { type ChatMessage, useChatStore } from '@/state/chat';
import { useCallback, useEffect, useRef } from 'react';
import { onMessage, sendMessage } from 'webext-bridge/window';

interface SendOptions {
  promptId?: string;
  agentId?: string;
  conversationId?: string;
  variables?: Record<string, unknown>;
  /** If true, uses /ai/agent/execute (rich events). Otherwise /ai/chat/unified (text deltas). */
  agentMode?: boolean;
}

/**
 * useChatStream wires the side panel chat composer to the offscreen-proxied
 * streaming pipeline.
 *
 * Flow:
 *   send() pushes a user message + a placeholder assistant message, then asks
 *   the SW to start a stream. As stream:chunk events arrive, we append text
 *   to the placeholder. Cancel + finalize transitions handled here.
 */
export function useChatStream() {
  const runIdRef = useRef<string | null>(null);
  const targetIdRef = useRef<string | null>(null);

  useEffect(() => {
    onMessage(CHANNELS.STREAM_CHUNK, ({ data }) => {
      const chunk = data as {
        runId: string;
        type: 'text' | 'event' | 'error' | 'done';
        payload: unknown;
      };
      if (chunk.runId !== runIdRef.current) return { ignored: true };
      const target = targetIdRef.current;
      if (!target) return { ignored: true };

      if (chunk.type === 'text') {
        const ev = chunk.payload as { content?: string };
        if (ev.content) useChatStore.getState().appendAssistantText(target, ev.content);
      } else if (chunk.type === 'event') {
        const ev = (chunk.payload as { event?: { type?: string; content?: string } }).event ?? {};
        // For rich events from /ai/agent/execute, surface the delta if present.
        if (ev.type === 'data' || ev.type === 'delta' || ev.type === 'text') {
          const txt =
            (ev as { content?: string; delta?: string }).content ??
            (ev as { delta?: string }).delta ??
            '';
          if (txt) useChatStore.getState().appendAssistantText(target, txt);
        }
      } else if (chunk.type === 'error') {
        const msg = (chunk.payload as { message?: string }).message ?? 'stream error';
        useChatStore.getState().appendAssistantText(target, `\n\n_Error:_ ${msg}`);
      } else if (chunk.type === 'done') {
        useChatStore.getState().finalizeAssistant(target);
        useChatStore.getState().setStreaming(false);
        runIdRef.current = null;
        targetIdRef.current = null;
      }
      return { ack: true };
    });
  }, []);

  const send = useCallback(async (text: string, opts: SendOptions = {}) => {
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

    const useAgent = !!opts.agentMode || !!opts.promptId;

    const body = useAgent
      ? {
          conversation_id: opts.conversationId,
          prompt_id: opts.promptId ?? opts.agentId,
          message: text,
          variables: opts.variables,
        }
      : {
          conversation_id: opts.conversationId,
          message: text,
          variables: opts.variables,
        };

    await sendMessage(
      CHANNELS.STREAM_START as never,
      {
        runId,
        endpoint: useAgent ? AGENT_EXECUTE_PATH : UNIFIED_CHAT_PATH,
        body,
        parser: useAgent ? 'rich-events' : 'text-chunks',
      } as never,
      'background' as never,
    );
  }, []);

  const cancel = useCallback(async () => {
    if (!runIdRef.current) return;
    await sendMessage(
      CHANNELS.STREAM_CANCEL as never,
      { runId: runIdRef.current } as never,
      'background' as never,
    );
    if (targetIdRef.current) useChatStore.getState().finalizeAssistant(targetIdRef.current);
    useChatStore.getState().setStreaming(false);
    runIdRef.current = null;
    targetIdRef.current = null;
  }, []);

  return { send, cancel };
}
