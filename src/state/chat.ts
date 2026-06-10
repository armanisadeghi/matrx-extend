import { chromeLocalStorage } from '@/lib/storage/zustand-adapter';
import type { ToolProgressUpdate } from '@/lib/tools/types';
import { useToolInbox } from '@/state/tool-inbox';
import type { ComputeTargetRef } from '@/types/compute-target';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/** Max progress entries retained per tool call — bounds memory if a handler spams. */
const MAX_PROGRESS_ENTRIES = 200;

/** A stored progress update — a {@link ToolProgressUpdate} stamped with arrival time. */
export interface ToolProgressEntry extends ToolProgressUpdate {
  at: number;
}

/**
 * One tool invocation captured inside an assistant turn — server-side OR
 * client-side. Stored as a part on the message itself so tool entries
 * interleave correctly with text and reasoning in the order they arrived
 * over the SSE wire.
 */
export interface ToolPartCall {
  /** 'server' = ran in Python; 'client' = ran in our SW dispatcher. */
  kind: 'server' | 'client';
  callId: string;
  toolName: string;
  /** Friendly label the server occasionally sends ("Executing X" / "Done"). */
  message?: string;
  /** Inputs the model passed. Shown when the user expands the row. */
  args?: unknown;
  /** Output payload. Only present once `phase === 'completed'`. */
  result?: unknown;
  phase: 'started' | 'completed' | 'error';
  startedAt: number;
  endedAt?: number;
  /**
   * Incremental progress updates emitted while the tool ran. Optional and
   * usually absent — only long-running tools that opt in (server `tool_progress`
   * sub-events, or client handlers calling `ctx.reportProgress`) populate it.
   * The display layer renders it only when non-empty, so every other tool is
   * unaffected.
   */
  progress?: ToolProgressEntry[];
}

/**
 * Ordered fragment of a message — used so a single assistant turn can be
 * rendered as text → tool → text → tool → reasoning → text in the exact
 * order the model produced them. Each new chunk on the SSE either appends
 * to the last part (when types match) or pushes a new part.
 */
export type MessagePart =
  | { type: 'text'; content: string }
  | { type: 'reasoning'; content: string }
  | { type: 'tool'; tool: ToolPartCall };

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  /**
   * Concatenated plain text — kept as a fast-access summary for things like
   * conversation list previews. New code paths populate via `parts` and
   * derive `content` automatically; older DB-hydrated messages still have
   * `content` set directly with no `parts`.
   */
  content: string;
  /**
   * Ordered parts (text / reasoning / tool) as they arrived in the stream.
   * Optional for backwards compat — DB-hydrated messages typically don't
   * have parts and render via `content` only.
   */
  parts?: MessagePart[];
  timestamp: number;
  pending?: boolean;
  /**
   * Conversation this message belongs to. Set at push time; used to filter
   * out stale tool inbox entries when the user switches conversations.
   */
  conversationId?: string | null;
}

/** Backwards-compat alias — older callers reference `ServerToolCall`. */
export type ServerToolCall = ToolPartCall;

/**
 * Set when a run ends abnormally (the stall watchdog fired, or a stream error
 * arrived) so the UI can clear the stuck spinner and offer a Retry. Cleared on
 * the next send, on conversation switch, and on reset.
 */
export interface StreamInterruption {
  runId: string;
  reason: 'stalled' | 'error';
  /** For 'stalled': how long the stream was silent before we gave up. */
  silentMs?: number;
  /** The user input of the interrupted turn, so Retry can re-send it. */
  lastInput: string;
  at: number;
}

export type PermissionMode = 'ask' | 'act';

interface ChatState {
  selectedAgentId: string | null;
  selectedConversationId: string | null;
  draft: string;
  messages: ChatMessage[];
  isStreaming: boolean;
  /** Set when a run stalled or errored abnormally; gates the Retry banner. */
  streamInterruption: StreamInterruption | null;
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
  /**
   * The user's selected compute target (sandbox or their own PC) for the
   * agent to dispatch shell/fs tools against. `null` = the agent runs
   * unbound and falls back to aidream's multi-tenant filesystem.
   *
   * Persisted across reloads but distinct from `selectedConversationId` —
   * the binding is a per-user preference within this surface (Chat),
   * carried forward into every new conversation until the user changes
   * it. Same mental model as the matrx-frontend `activeAgentSandboxBySurface`
   * preference key, scoped to this single surface (the extension).
   */
  boundComputeTarget: ComputeTargetRef | null;
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
  /**
   * Insert a message immediately BEFORE the message with id `beforeId`.
   * Falls back to appending if `beforeId` is null or not found. Used by the
   * turn-boundary inbox: when a queued user message is consumed mid-stream we
   * slot it in just above the still-streaming assistant bubble so the order
   * reads naturally (… → user steer → assistant continues) without rotating
   * the active stream target.
   */
  insertMessageBefore: (beforeId: string | null, m: ChatMessage) => void;
  /**
   * Append a text chunk to the assistant message identified by `id`. If the
   * last part is already a text part, the chunk is concatenated. Otherwise a
   * new text part is pushed — preserving stream order so a tool call
   * mid-response forces the next text chunk into a fresh part on the other
   * side of the tool entry.
   */
  appendAssistantText: (id: string, chunk: string) => void;
  /**
   * Same arrival-order semantics as `appendAssistantText`, but for
   * "thinking" tokens (reasoning chunks). Renders as a separate part type
   * so the UI can style / collapse independently from regular text.
   */
  appendAssistantReasoning: (id: string, chunk: string) => void;
  finalizeAssistant: (id: string) => void;
  /**
   * Upsert a tool call (server- or client-side) attached to an assistant
   * message AS A PART. New tools push a fresh `tool` part at the end of the
   * parts array — this is what makes tool calls interleave with text in the
   * order they arrived. Subsequent updates (completed / error / output)
   * merge into the existing part by callId.
   */
  upsertToolPart: (
    messageId: string,
    callId: string,
    patch: Partial<ToolPartCall> & { kind?: 'server' | 'client' },
  ) => void;
  /** Backwards-compat — older callers used this for server tools only. */
  upsertServerTool: (messageId: string, callId: string, patch: Partial<ToolPartCall>) => void;
  /**
   * Append an incremental progress update to a tool part (by callId). Creates
   * a `started` part if none exists yet. Never changes the part's phase — a
   * progress update is orthogonal to started/completed/error. Bounded to the
   * last {@link MAX_PROGRESS_ENTRIES}.
   */
  appendToolProgress: (
    messageId: string,
    callId: string,
    entry: ToolProgressEntry,
    meta?: { toolName?: string; kind?: 'server' | 'client' },
  ) => void;
  setStreaming: (b: boolean) => void;
  /** Set or clear the abnormal-end marker that drives the Retry banner. */
  setStreamInterruption: (i: StreamInterruption | null) => void;
  setMessages: (ms: ChatMessage[]) => void;
  setVariable: (agentId: string, name: string, value: string) => void;
  getAgentVariables: (agentId: string) => Record<string, string>;
  resetAgentVariables: (agentId: string) => void;
  setPermissionMode: (agentId: string, mode: PermissionMode) => void;
  getPermissionMode: (agentId: string | null) => PermissionMode;
  /** Set or clear the user's compute-target selection. */
  setBoundComputeTarget: (ref: ComputeTargetRef | null) => void;
  reset: () => void;
}

const varKey = (agentId: string, name: string) => `${agentId}.${name}`;

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      selectedAgentId: null,
      selectedConversationId: null,
      draft: '',
      messages: [],
      isStreaming: false,
      streamInterruption: null,
      variableValues: {},
      permissionMode: {},
      boundComputeTarget: null,
      setAgent: (selectedAgentId) => set({ selectedAgentId }),
      setConversation: (selectedConversationId) => {
        set({ selectedConversationId, messages: [], streamInterruption: null });
        // Wipe any pending approval / ask cards from the previous
        // conversation. They were tied to a different runId; the SW will
        // time them out on its end. Keeping them visible here would just
        // confuse the user since responding to them no longer reaches a
        // listener that cares.
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
              // Tag every newly-pushed message with the current conversation_id.
              // Used so tool inbox entries arriving for a stale runId don't
              // bleed into a different conversation's view.
              conversationId: m.conversationId ?? s.selectedConversationId,
            },
          ],
        })),
      insertMessageBefore: (beforeId, m) =>
        set((s) => {
          const tagged: ChatMessage = {
            ...m,
            conversationId: m.conversationId ?? s.selectedConversationId,
          };
          const idx = beforeId ? s.messages.findIndex((x) => x.id === beforeId) : -1;
          if (idx === -1) {
            // A non-null beforeId that we can't find means the target
            // assistant bubble belongs to a conversation that's no longer
            // loaded (the user switched mid-stream). Appending here used to
            // leak the consumed inbox message into the WRONG conversation's
            // transcript (audit P1-11). The message isn't lost — the server
            // already persisted it into its real conversation's history.
            if (beforeId) return s;
            return { messages: [...s.messages, tagged] };
          }
          const next = s.messages.slice();
          next.splice(idx, 0, tagged);
          return { messages: next };
        }),
      upsertToolPart: (messageId, callId, patch) =>
        set((s) => ({
          messages: s.messages.map((m) => {
            if (m.id !== messageId) return m;
            const parts = m.parts ?? [];
            const idx = parts.findIndex((p) => p.type === 'tool' && p.tool.callId === callId);
            if (idx === -1) {
              // First time we see this callId — push a brand new `tool` part
              // at the END of the array. Crucial for ordering: any text/
              // reasoning that arrived before this lands BEFORE this part;
              // anything after lands AFTER (in fresh parts).
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
            // Defensive ordering: never let a stale `started` event downgrade
            // a part that's already reached `completed` or `error`. Two paths
            // emit started events for client tools (SSE `tool_delegated` +
            // SW `TOOL_TIMELINE_EVENT`); if the SW one races and arrives
            // AFTER tool_completed, the row would flicker back to spinning.
            const phaseLocked =
              (existing.tool.phase === 'completed' || existing.tool.phase === 'error') &&
              patch.phase === 'started';
            const merged: ToolPartCall = {
              ...existing.tool,
              ...patch,
              ...(phaseLocked ? { phase: existing.tool.phase } : {}),
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
      // Backwards-compat shim — older code paths called this for server tools.
      upsertServerTool: (messageId, callId, patch) =>
        get().upsertToolPart(messageId, callId, { kind: 'server', ...patch }),
      appendToolProgress: (messageId, callId, entry, meta) =>
        set((s) => ({
          messages: s.messages.map((m) => {
            if (m.id !== messageId) return m;
            const parts = m.parts ?? [];
            const idx = parts.findIndex((p) => p.type === 'tool' && p.tool.callId === callId);
            // No part yet (progress raced ahead of tool_started) — seed one.
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
            const prior = existing.tool.progress ?? [];
            const nextProgress = [...prior, entry];
            // FIFO cap — keep the most recent updates if a handler over-reports.
            if (nextProgress.length > MAX_PROGRESS_ENTRIES) {
              nextProgress.splice(0, nextProgress.length - MAX_PROGRESS_ENTRIES);
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
            // Coalesce into the trailing text part when possible. If the
            // last part is something else (a tool, or reasoning), push a
            // new text part — that's what preserves "text → tool → text"
            // visual ordering.
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
      setStreamInterruption: (streamInterruption) => set({ streamInterruption }),
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
        if (!agentId) return 'ask';
        return get().permissionMode[agentId] ?? 'ask';
      },
      setBoundComputeTarget: (boundComputeTarget) => set({ boundComputeTarget }),
      reset: () => set({ messages: [], draft: '', isStreaming: false, streamInterruption: null }),
    }),
    {
      name: 'matrx.chat.v1',
      storage: createJSONStorage(() => chromeLocalStorage),
      // Intentionally NOT persisting `selectedConversationId` — opening
      // the side panel should always land on a fresh chat. Past
      // conversations live in the chat header's history picker; the user
      // can re-open one explicitly. Persisting agent + draft + per-agent
      // variables keeps the user's setup; persisting the conversation id
      // would force a re-fetch of the prior thread on every open and
      // break the "new chat by default" expectation.
      partialize: (s) => ({
        selectedAgentId: s.selectedAgentId,
        draft: s.draft,
        variableValues: s.variableValues,
        permissionMode: s.permissionMode,
        boundComputeTarget: s.boundComputeTarget,
      }),
      // Force selectedConversationId to null on every rehydration. The
      // storage key is shared with previous installs that DID persist the
      // conversation id; without this, an old stored value would survive
      // and re-open the user's last chat. Force-null defends against
      // that without bumping the storage version (which would wipe
      // agent + draft + variableValues unnecessarily).
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ChatState>;
        return { ...current, ...p, selectedConversationId: null, messages: [] };
      },
    },
  ),
);
