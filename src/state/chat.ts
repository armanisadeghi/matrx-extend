import { chromeLocalStorage } from "@/lib/storage/zustand-adapter";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Server-side tool calls that happen during an assistant turn (e.g. SEO
 * lookups, context fetches). Distinct from CLIENT tool calls (browser
 * harness) which flow through `tool-inbox` and render via ToolTimelineRow.
 *
 * Server tools are bound to a specific assistant message so they can render
 * inline within that turn instead of in a global timeline.
 */
export interface ServerToolCall {
  callId: string;
  toolName: string;
  /** Friendly label from the server: "Executing Seo Get Keyword Data" / "Done". */
  message?: string;
  /** Inputs the model passed. Shown when the user expands the row. */
  args?: unknown;
  /** Output payload. Only present once `phase === 'completed'`. */
  result?: unknown;
  phase: "started" | "completed" | "error";
  startedAt: number;
  endedAt?: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  pending?: boolean;
  /** Server-side tools called during this assistant turn, in arrival order. */
  serverTools?: ServerToolCall[];
}

export type PermissionMode = "ask" | "act";

interface ChatState {
  selectedAgentId: string | null;
  selectedConversationId: string | null;
  draft: string;
  messages: ChatMessage[];
  isStreaming: boolean;
  /**
   * Per-agent variable values, keyed by `<agentId>.<varName>`. Persisted
   * across reloads so users don't have to re-fill every time. Cleared per
   * agent via resetAgentVariables.
   */
  variableValues: Record<string, string>;
  /**
   * Per-agent permission mode for action tools.
   *   'ask' — agent asks before each mutating tool call (default).
   *   'act' — agent runs mutating tool calls without prompting.
   * Privileged tools always confirm regardless. Set/changeable in chat header.
   */
  permissionMode: Record<string, PermissionMode>;
  setAgent: (id: string | null) => void;
  setConversation: (id: string | null) => void;
  /**
   * Annotate the current chat with the server-assigned conversation_id.
   * Distinct from `setConversation`, which is the "switch to a different
   * thread" action and wipes the visible messages. `adoptConversationId`
   * is the "we just learned the id of the thread we're already in" path —
   * called from `useChatStream` when the server emits the X-Conversation-ID
   * header on the first turn so subsequent turns stay on the same thread.
   * No-op if the new id matches what's already stored.
   */
  adoptConversationId: (id: string) => void;
  setDraft: (s: string) => void;
  pushMessage: (m: ChatMessage) => void;
  appendAssistantText: (id: string, chunk: string) => void;
  finalizeAssistant: (id: string) => void;
  /**
   * Upsert a server-side tool call attached to a specific assistant message.
   * On `tool_started` it appends a new entry; on `tool_completed`/`tool_error`
   * it merges into the existing one (matched by callId).
   */
  upsertServerTool: (
    messageId: string,
    callId: string,
    patch: Partial<ServerToolCall>,
  ) => void;
  setStreaming: (b: boolean) => void;
  setMessages: (ms: ChatMessage[]) => void;
  setVariable: (agentId: string, name: string, value: string) => void;
  getAgentVariables: (agentId: string) => Record<string, string>;
  resetAgentVariables: (agentId: string) => void;
  setPermissionMode: (agentId: string, mode: PermissionMode) => void;
  getPermissionMode: (agentId: string | null) => PermissionMode;
  reset: () => void;
}

const varKey = (agentId: string, name: string) => `${agentId}.${name}`;

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      selectedAgentId: null,
      selectedConversationId: null,
      draft: "",
      messages: [],
      isStreaming: false,
      variableValues: {},
      permissionMode: {},
      setAgent: (selectedAgentId) => set({ selectedAgentId }),
      setConversation: (selectedConversationId) =>
        set({ selectedConversationId, messages: [] }),
      adoptConversationId: (id) =>
        set((s) =>
          s.selectedConversationId === id ? s : { selectedConversationId: id },
        ),
      setDraft: (draft) => set({ draft }),
      pushMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),
      upsertServerTool: (messageId, callId, patch) =>
        set((s) => ({
          messages: s.messages.map((m) => {
            if (m.id !== messageId) return m;
            const tools = m.serverTools ?? [];
            const idx = tools.findIndex((t) => t.callId === callId);
            if (idx === -1) {
              return {
                ...m,
                serverTools: [
                  ...tools,
                  {
                    callId,
                    toolName: patch.toolName ?? "(unknown)",
                    phase: patch.phase ?? "started",
                    startedAt: Date.now(),
                    ...patch,
                  },
                ],
              };
            }
            const existing = tools[idx];
            if (!existing) return m;
            const next: ServerToolCall = {
              ...existing,
              ...patch,
              endedAt:
                patch.phase === "completed" || patch.phase === "error"
                  ? Date.now()
                  : existing.endedAt,
            };
            const updated = [...tools];
            updated[idx] = next;
            return { ...m, serverTools: updated };
          }),
        })),
      appendAssistantText: (id, chunk) =>
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === id ? { ...m, content: m.content + chunk } : m,
          ),
        })),
      finalizeAssistant: (id) =>
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === id ? { ...m, pending: false } : m,
          ),
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
      resetAgentVariables: (agentId) =>
        set((s) => {
          const prefix = `${agentId}.`;
          const next: Record<string, string> = {};
          for (const [k, v] of Object.entries(s.variableValues)) {
            if (!k.startsWith(prefix)) next[k] = v;
          }
          return { variableValues: next };
        }),
      setPermissionMode: (agentId, mode) =>
        set((s) => ({
          permissionMode: { ...s.permissionMode, [agentId]: mode },
        })),
      getPermissionMode: (agentId) => {
        if (!agentId) return "ask";
        return get().permissionMode[agentId] ?? "ask";
      },
      reset: () => set({ messages: [], draft: "", isStreaming: false }),
    }),
    {
      name: "matrx.chat.v1",
      storage: createJSONStorage(() => chromeLocalStorage),
      partialize: (s) => ({
        selectedAgentId: s.selectedAgentId,
        selectedConversationId: s.selectedConversationId,
        draft: s.draft,
        variableValues: s.variableValues,
        permissionMode: s.permissionMode,
      }),
    },
  ),
);
