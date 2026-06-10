/**
 * Pilot-side chat store — CLAUDE.md roadmap item #9.
 *
 * Parallel to useChatStore but isolated to the Pilot surface. Cloning
 * (rather than sharing) is intentional: the Assistant Chat tab and the
 * Pilot tab evolve along different vectors (Pilot will grow plan-mode,
 * receipt verification, group telemetry; Assistant will grow inline
 * artifact rendering, voice transport tweaks). Sharing one store now
 * would force one of the two surfaces to bend whenever the other gains
 * a feature it doesn't need.
 *
 * Persisted differences vs. useChatStore:
 *   - Storage key `matrx.pilot-chat.v1` (separate from `matrx.chat.v1`)
 *   - Conversation id is NOT force-nulled on rehydrate. The Pilot
 *     session itself dictates whether a conversation continues, so we
 *     persist whatever was open.
 *
 * Permission mode default: Pilot defaults to 'act' because the surface
 * is meant to be more autonomous — the user has already chosen to start
 * a sandboxed session. The chip in the header still lets them flip back
 * to 'ask' if they want approval-per-step.
 */

import { chromeLocalStorage } from '@/lib/storage/zustand-adapter';
import type {
  ChatMessage,
  MessagePart,
  PermissionMode,
  ToolPartCall,
  ToolProgressEntry,
} from '@/state/chat';
import { useToolInbox } from '@/state/tool-inbox';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface PilotChatState {
  selectedAgentId: string | null;
  selectedConversationId: string | null;
  draft: string;
  messages: ChatMessage[];
  isStreaming: boolean;
  /** Per-agent variable values (mirrors useChatStore semantics). */
  variableValues: Record<string, string>;
  /**
   * Per-agent permission mode. Defaults to 'act' for Pilot agents — see
   * `getPermissionMode` below. The user can override via the header chip.
   */
  permissionMode: Record<string, PermissionMode>;
  setAgent: (id: string | null) => void;
  setConversation: (id: string | null) => void;
  adoptConversationId: (id: string) => void;
  setDraft: (s: string) => void;
  pushMessage: (m: ChatMessage) => void;
  appendAssistantText: (id: string, chunk: string) => void;
  appendAssistantReasoning: (id: string, chunk: string) => void;
  finalizeAssistant: (id: string) => void;
  upsertToolPart: (
    messageId: string,
    callId: string,
    patch: Partial<ToolPartCall> & { kind?: 'server' | 'client' },
  ) => void;
  appendToolProgress: (
    messageId: string,
    callId: string,
    entry: ToolProgressEntry,
    meta?: { toolName?: string; kind?: 'server' | 'client' },
  ) => void;
  setStreaming: (b: boolean) => void;
  setMessages: (ms: ChatMessage[]) => void;
  setVariable: (agentId: string, name: string, value: string) => void;
  getAgentVariables: (agentId: string) => Record<string, string>;
  setPermissionMode: (agentId: string, mode: PermissionMode) => void;
  getPermissionMode: (agentId: string | null) => PermissionMode;
  reset: () => void;
}

const varKey = (agentId: string, name: string) => `${agentId}.${name}`;

export const usePilotChatStore = create<PilotChatState>()(
  persist(
    (set, get) => ({
      selectedAgentId: null,
      selectedConversationId: null,
      draft: '',
      messages: [],
      isStreaming: false,
      variableValues: {},
      permissionMode: {},
      setAgent: (selectedAgentId) => set({ selectedAgentId }),
      setConversation: (selectedConversationId) => {
        set({ selectedConversationId, messages: [] });
        useToolInbox.getState().resetAll();
      },
      adoptConversationId: (id) =>
        set((s) => (s.selectedConversationId === id ? s : { selectedConversationId: id })),
      setDraft: (draft) => set({ draft }),
      pushMessage: (m) =>
        set((s) => ({
          messages: [
            ...s.messages,
            {
              ...m,
              conversationId: m.conversationId ?? s.selectedConversationId,
            },
          ],
        })),
      upsertToolPart: (messageId, callId, patch) =>
        set((s) => ({
          messages: s.messages.map((m) => {
            if (m.id !== messageId) return m;
            const parts = m.parts ?? [];
            const idx = parts.findIndex((p) => p.type === 'tool' && p.tool.callId === callId);
            if (idx === -1) {
              const fresh: ToolPartCall = {
                kind: patch.kind ?? 'server',
                callId,
                toolName: patch.toolName ?? '(unknown)',
                phase: patch.phase ?? 'started',
                startedAt: Date.now(),
                ...patch,
              };
              return { ...m, parts: [...parts, { type: 'tool', tool: fresh }] };
            }
            const existing = parts[idx];
            if (!existing || existing.type !== 'tool') return m;
            const merged: ToolPartCall = {
              ...existing.tool,
              ...patch,
              endedAt:
                patch.phase === 'completed' || patch.phase === 'error'
                  ? Date.now()
                  : existing.tool.endedAt,
            };
            const next = parts.slice();
            next[idx] = { type: 'tool', tool: merged };
            return { ...m, parts: next };
          }),
        })),
      appendToolProgress: (messageId, callId, entry, meta) =>
        set((s) => ({
          messages: s.messages.map((m) => {
            if (m.id !== messageId) return m;
            const parts = m.parts ?? [];
            const idx = parts.findIndex((p) => p.type === 'tool' && p.tool.callId === callId);
            if (idx === -1) {
              const fresh: ToolPartCall = {
                kind: meta?.kind ?? 'server',
                callId,
                toolName: meta?.toolName ?? '(unknown)',
                phase: 'started',
                startedAt: Date.now(),
                progress: [entry],
              };
              return { ...m, parts: [...parts, { type: 'tool', tool: fresh }] };
            }
            const existing = parts[idx];
            if (!existing || existing.type !== 'tool') return m;
            const nextProgress = [...(existing.tool.progress ?? []), entry];
            if (nextProgress.length > 200) {
              nextProgress.splice(0, nextProgress.length - 200);
            }
            const next = parts.slice();
            next[idx] = {
              type: 'tool',
              tool: { ...existing.tool, progress: nextProgress },
            };
            return { ...m, parts: next };
          }),
        })),
      appendAssistantText: (id, chunk) =>
        set((s) => ({
          messages: s.messages.map((m) => {
            if (m.id !== id) return m;
            const parts = m.parts ?? [];
            const last = parts[parts.length - 1];
            let nextParts: MessagePart[];
            if (last && last.type === 'text') {
              nextParts = parts.slice(0, -1).concat({
                type: 'text',
                content: last.content + chunk,
              });
            } else {
              nextParts = parts.concat({ type: 'text', content: chunk });
            }
            return { ...m, parts: nextParts, content: m.content + chunk };
          }),
        })),
      appendAssistantReasoning: (id, chunk) =>
        set((s) => ({
          messages: s.messages.map((m) => {
            if (m.id !== id) return m;
            const parts = m.parts ?? [];
            const last = parts[parts.length - 1];
            let nextParts: MessagePart[];
            if (last && last.type === 'reasoning') {
              nextParts = parts.slice(0, -1).concat({
                type: 'reasoning',
                content: last.content + chunk,
              });
            } else {
              nextParts = parts.concat({ type: 'reasoning', content: chunk });
            }
            return { ...m, parts: nextParts };
          }),
        })),
      finalizeAssistant: (id) =>
        set((s) => ({
          messages: s.messages.map((m) => (m.id === id ? { ...m, pending: false } : m)),
        })),
      setStreaming: (isStreaming) => set({ isStreaming }),
      setMessages: (messages) => set({ messages }),
      setVariable: (agentId, name, value) =>
        set((s) => ({
          variableValues: {
            ...s.variableValues,
            [varKey(agentId, name)]: value,
          },
        })),
      getAgentVariables: (agentId) => {
        const prefix = `${agentId}.`;
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(get().variableValues)) {
          if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
        }
        return out;
      },
      setPermissionMode: (agentId, mode) =>
        set((s) => ({
          permissionMode: { ...s.permissionMode, [agentId]: mode },
        })),
      getPermissionMode: (agentId) => {
        if (!agentId) return 'act';
        return get().permissionMode[agentId] ?? 'act';
      },
      reset: () => set({ messages: [], draft: '', isStreaming: false }),
    }),
    {
      name: 'matrx.pilot-chat.v1',
      storage: createJSONStorage(() => chromeLocalStorage),
      partialize: (s) => ({
        selectedAgentId: s.selectedAgentId,
        draft: s.draft,
        variableValues: s.variableValues,
        permissionMode: s.permissionMode,
      }),
      // Versioned + validated rehydration (audit P2-10) — see chat.ts.
      version: 1,
      migrate: (persisted) => {
        const p = (persisted ?? {}) as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        if (typeof p.selectedAgentId === 'string' || p.selectedAgentId === null)
          out.selectedAgentId = p.selectedAgentId;
        if (typeof p.draft === 'string') out.draft = p.draft;
        if (p.variableValues && typeof p.variableValues === 'object')
          out.variableValues = p.variableValues;
        if (p.permissionMode && typeof p.permissionMode === 'object')
          out.permissionMode = p.permissionMode;
        return out;
      },
    },
  ),
);
