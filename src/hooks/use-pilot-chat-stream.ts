/**
 * Pilot-side chat-stream hook — CLAUDE.md roadmap item #9.
 *
 * Parallel to `useChatStream` but routes streamed events into
 * `usePilotChatStore` instead of the assistant's `useChatStore`. Cloning
 * (rather than parameterizing the existing hook) keeps the two surfaces
 * decoupled — Pilot will gain plan-mode, receipts, and agent-driven
 * sub-task spawning over time, all of which would clutter the existing
 * assistant code path.
 *
 * Wire-format differences from the assistant flow:
 *   - `surface: 'pilot'` in the browser-dom state
 *   - `source_feature: 'pilot-chat'` for telemetry
 *   - The caller MUST pass `assignedTabId` explicitly — pilot runs are
 *     scoped to the session's tab group, never to the user's focused tab.
 */

import { type AgentStartRequest, agentExecutePath } from '@/lib/api/routes/ai';
import { buildBrowserDomState } from '@/lib/chat/build-browser-dom-state';
import { buildChatContext } from '@/lib/chat/build-context';
import { refreshPageContextBeforeSend } from '@/lib/chat/refresh-page-context';
import { log } from '@/lib/debug/log';
import { newId } from '@/lib/id';
import { on, send } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { lookup as lookupTool } from '@/lib/tools/registry';
import {
  projectAdminFlagsToRequest,
  useAdminFlagsStore,
} from '@/state/admin-flags';
import { useActiveToolsStore } from '@/state/active-tools';
import { useAuthStore } from '@/state/auth';
import { useAutoScrapeStore } from '@/state/auto-scrape';
import { type ChatMessage, type ToolPartCall } from '@/state/chat';
import { useDesktopStore } from '@/state/desktop';
import { usePilotChatStore } from '@/state/pilot-chat';
import { usePilotStore } from '@/state/pilot';
import { useScrapeStore } from '@/state/scrape';
import { useSettingsStore } from '@/state/settings';
import { useCallback, useEffect, useRef } from 'react';

interface SendOptions {
  agentId?: string;
  agentName?: string;
  conversationId?: string;
  variables?: Record<string, unknown>;
  /**
   * Tab the run is pinned to. PilotView resolves this to a tab inside
   * the active session's group before calling. Required — the dispatcher's
   * pilot gate rejects calls whose assignedTabId isn't in the group.
   */
  assignedTabId: number;
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

interface StreamOpened {
  runId: string;
  conversationId: string | null;
  requestId: string | null;
  agentName?: string | null;
  permissionMode?: 'ask' | 'act';
}

function handleDiscoveryToolEvent(
  conversationId: string | null,
  data: Record<string, unknown> | undefined,
): void {
  if (!data) return;
  const subEvent = String(data.event ?? '');
  if (subEvent !== 'tool_completed') return;
  if (String(data.tool_name ?? '') !== 'load_browser_tools') return;
  const inner = (data.data ?? {}) as Record<string, unknown>;
  const argsCategory =
    typeof inner.arguments === 'object' && inner.arguments !== null
      ? (inner.arguments as Record<string, unknown>).category
      : null;
  const resultCategory =
    typeof inner.result === 'object' && inner.result !== null
      ? (inner.result as Record<string, unknown>).category
      : null;
  const cat = String(argsCategory ?? resultCategory ?? '');
  if (cat) useActiveToolsStore.getState().recordCategoryLoaded(conversationId, cat);
}

function handleResourceChangedEvent(data: Record<string, unknown> | undefined): void {
  if (!data) return;
  if (String(data.kind ?? '') !== 'active_tools') return;
  const tools = data.tools ?? data.value ?? [];
  if (!Array.isArray(tools)) return;
  const names = tools
    .map((t) => (typeof t === 'string' ? t : (t as { name?: unknown })?.name))
    .filter((n): n is string => typeof n === 'string');
  useActiveToolsStore.getState().setLiveTools(names);
}

function handleToolEvent(
  messageId: string,
  data: Record<string, unknown> | undefined,
): void {
  if (!data) return;
  const subEvent = String(data.event ?? '');
  const callId = String(data.call_id ?? '');
  const toolName = String(data.tool_name ?? '');
  if (!callId || !toolName) return;

  const kind: 'server' | 'client' = lookupTool(toolName) ? 'client' : 'server';
  const message = typeof data.message === 'string' ? data.message : undefined;
  const inner = (data.data ?? {}) as Record<string, unknown>;
  const upsert = usePilotChatStore.getState().upsertToolPart;

  const base: Partial<ToolPartCall> & { kind: 'server' | 'client' } = {
    kind,
    toolName,
  };
  if (message !== undefined) base.message = message;

  if (subEvent === 'tool_started') {
    const args = inner.arguments;
    upsert(messageId, callId, {
      ...base,
      phase: 'started',
      ...(args !== undefined ? { args } : {}),
    });
  } else if (subEvent === 'tool_completed') {
    const result = inner.result;
    upsert(messageId, callId, {
      ...base,
      phase: 'completed',
      ...(result !== undefined ? { result } : {}),
    });
  } else if (subEvent === 'tool_error' || subEvent === 'tool_failed') {
    const errResult = inner.error ?? inner.result;
    upsert(messageId, callId, {
      ...base,
      phase: 'error',
      ...(errResult !== undefined ? { result: errResult } : {}),
    });
  }
}

export function usePilotChatStream() {
  const runIdRef = useRef<string | null>(null);
  const targetIdRef = useRef<string | null>(null);

  useEffect(() => {
    return on<StreamOpened, { ack: true }>(CHANNELS.STREAM_OPENED, (payload) => {
      if (payload.runId !== runIdRef.current) return { ack: true };
      if (payload.conversationId) {
        usePilotChatStore.getState().adoptConversationId(payload.conversationId);
        usePilotStore.getState().setConversationId(payload.conversationId);
      }
      return { ack: true };
    });
  }, []);

  useEffect(() => {
    return on<StreamChunk, { ack: true }>(CHANNELS.STREAM_CHUNK, (chunk) => {
      if (chunk.runId !== runIdRef.current) return { ack: true };
      const target = targetIdRef.current;
      if (!target) return { ack: true };

      if (chunk.type === 'text') {
        if (chunk.payload.content)
          usePilotChatStore.getState().appendAssistantText(target, chunk.payload.content);
      } else if (chunk.type === 'reasoning') {
        if (chunk.payload.content)
          usePilotChatStore
            .getState()
            .appendAssistantReasoning(target, chunk.payload.content);
      } else if (chunk.type === 'event') {
        if (chunk.payload.eventName === 'tool_event') {
          const convId = usePilotChatStore.getState().selectedConversationId;
          handleDiscoveryToolEvent(convId, chunk.payload.data);
          handleToolEvent(target, chunk.payload.data);
        } else if (
          chunk.payload.eventName === 'resource_changed' ||
          chunk.payload.eventName === 'RESOURCE_CHANGED'
        ) {
          handleResourceChangedEvent(chunk.payload.data);
        } else {
          log.info('pilot-stream', `event: ${chunk.payload.eventName}`, chunk.payload.data);
        }
      } else if (chunk.type === 'error') {
        const message = chunk.payload.message ?? 'stream error';
        usePilotChatStore
          .getState()
          .appendAssistantText(target, `\n\n_Error:_ ${message}`);
      } else if (chunk.type === 'done') {
        usePilotChatStore.getState().finalizeAssistant(target);
        usePilotChatStore.getState().setStreaming(false);
        runIdRef.current = null;
        targetIdRef.current = null;
      }
      return { ack: true };
    });
  }, []);

  const sendMessage = useCallback(
    async (text: string, opts: SendOptions): Promise<string | null> => {
      if (!opts.agentId) {
        log.error('pilot-stream', 'sendMessage called without agentId');
        return null;
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
      usePilotChatStore.getState().pushMessage(userMsg);
      usePilotChatStore.getState().pushMessage(assistantMsg);
      usePilotChatStore.getState().setStreaming(true);

      const runId = newId('run');
      runIdRef.current = runId;
      targetIdRef.current = assistantMsg.id;

      // Pre-send page-context refresh — same path as the assistant. Pilot
      // also benefits from "agent has exactly what's on screen RIGHT NOW",
      // since its first move is usually a screenshot or read_page.
      const settings = useSettingsStore.getState();
      try {
        const decision = await refreshPageContextBeforeSend({
          autoFullScrollOnFirstSubmit: settings.autoFullScrollOnFirstSubmit,
        });
        log.info(
          'pilot-stream',
          `pre-send page refresh: ${decision.action} (${decision.reason})`,
        );
      } catch (err) {
        log.warn('pilot-stream', 'pre-send page refresh failed', err);
      }

      const user = useAuthStore.getState().user;
      const desktop = useDesktopStore.getState();
      const manualScrape = useScrapeStore.getState().current;
      const autoScrape = useAutoScrapeStore.getState().current;
      let context: Record<string, unknown> = {};
      try {
        context = await buildChatContext({
          user: user
            ? {
                id: user.id,
                email: user.email,
                full_name: user.full_name ?? null,
              }
            : null,
          desktopTransport: desktop.transport,
          scrape: manualScrape,
          autoScrape,
        });
      } catch (err) {
        log.warn('pilot-stream', 'buildChatContext failed', err);
      }

      const permissionMode = usePilotChatStore.getState().getPermissionMode(opts.agentId);

      const conversationId = opts.conversationId ?? null;
      const loadedCategories = useActiveToolsStore.getState().getLoaded(conversationId);
      const browserDomState = await buildBrowserDomState({
        surface: 'pilot',
        agentId: opts.agentId,
        loadedCategories,
      });

      const isAdmin = useAuthStore.getState().isAdmin;
      const adminOverrides = isAdmin
        ? projectAdminFlagsToRequest(useAdminFlagsStore.getState())
        : {};

      const modelOverrideId = useSettingsStore.getState().modelOverrideId;
      let configOverrides: Record<string, unknown> | undefined;
      if (modelOverrideId) {
        configOverrides = { model: modelOverrideId };
      }
      if (
        adminOverrides.config_overrides &&
        typeof adminOverrides.config_overrides === 'object'
      ) {
        configOverrides = {
          ...(configOverrides ?? {}),
          ...(adminOverrides.config_overrides as Record<string, unknown>),
        };
        // biome-ignore lint/performance/noDelete: rare path, clarity > perf
        delete adminOverrides.config_overrides;
      }

      const body: AgentStartRequest = {
        user_input: text,
        conversation_id: conversationId,
        variables: opts.variables ?? null,
        context,
        stream: true,
        store: true,
        source_app: 'matrx-extend',
        source_feature: 'pilot-chat',
        ...adminOverrides,
        ...(configOverrides ? { config_overrides: configOverrides } : {}),
        client: {
          capabilities: ['browser-dom'],
          state: {
            'browser-dom': browserDomState as unknown as Record<string, unknown>,
          },
        },
      };

      await send(CHANNELS.STREAM_START, {
        runId,
        endpoint: agentExecutePath(opts.agentId),
        body,
        parser: 'rich-events' as const,
        agentName: opts.agentName ?? null,
        permissionMode,
        // Pilot pins to a tab inside the session group — not the user's
        // currently-focused tab. The PilotView resolves this id from the
        // group's tabs and passes it through.
        assignedTabId: opts.assignedTabId,
      });
      return runId;
    },
    [],
  );

  const cancel = useCallback(async () => {
    if (!runIdRef.current) return;
    await send(CHANNELS.STREAM_CANCEL, { runId: runIdRef.current });
    if (targetIdRef.current)
      usePilotChatStore.getState().finalizeAssistant(targetIdRef.current);
    usePilotChatStore.getState().setStreaming(false);
    runIdRef.current = null;
    targetIdRef.current = null;
  }, []);

  return { send: sendMessage, cancel };
}
