import { type AgentStartRequest, agentExecutePath } from "@/lib/api/routes/ai";
import { buildChatContext } from "@/lib/chat/build-context";
import { log } from "@/lib/debug/log";
import { newId } from "@/lib/id";
import { on, send } from "@/lib/messaging/native";
import { CHANNELS } from "@/lib/messaging/schemas";
import { coreToolNames } from "@/lib/tools/registry";
import { useAuthStore } from "@/state/auth";
import { type ChatMessage, useChatStore } from "@/state/chat";
import { useDesktopStore } from "@/state/desktop";
import { useScrapeStore } from "@/state/scrape";
import { useCallback, useEffect, useRef } from "react";

interface SendOptions {
  agentId?: string;
  agentName?: string;
  conversationId?: string;
  variables?: Record<string, unknown>;
}

interface StreamChunk {
  runId: string;
  type: "text" | "reasoning" | "event" | "error" | "done";
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
  permissionMode?: "ask" | "act";
}

export function useChatStream() {
  const runIdRef = useRef<string | null>(null);
  const targetIdRef = useRef<string | null>(null);

  // Adopt the server-assigned conversation_id as soon as the response opens.
  // Without this, every turn would POST `conversation_id: null` and the
  // backend would open a new conversation for every message — even though
  // the server-side route handles continue-mode correctly when given an id.
  useEffect(() => {
    return on<StreamOpened, { ack: true }>(
      CHANNELS.STREAM_OPENED,
      (payload) => {
        if (payload.runId !== runIdRef.current) return { ack: true };
        if (payload.conversationId) {
          useChatStore.getState().adoptConversationId(payload.conversationId);
        }
        return { ack: true };
      },
    );
  }, []);

  useEffect(() => {
    return on<StreamChunk, { ack: true }>(CHANNELS.STREAM_CHUNK, (chunk) => {
      if (chunk.runId !== runIdRef.current) return { ack: true };
      const target = targetIdRef.current;
      if (!target) return { ack: true };

      if (chunk.type === "text") {
        if (chunk.payload.content)
          useChatStore
            .getState()
            .appendAssistantText(target, chunk.payload.content);
      } else if (chunk.type === "reasoning") {
        // Reasoning chunks are model "thinking" tokens — log only for now.
        log.info("stream", "reasoning chunk", chunk.payload.content);
      } else if (chunk.type === "event") {
        // Non-text events: phase, completion, tool_event, render_block, etc.
        // Logged for visibility; chat UI doesn't render them yet.
        log.info(
          "stream",
          `event: ${chunk.payload.eventName}`,
          chunk.payload.data,
        );
      } else if (chunk.type === "error") {
        const message = chunk.payload.message ?? "stream error";
        useChatStore
          .getState()
          .appendAssistantText(target, `\n\n_Error:_ ${message}`);
      } else if (chunk.type === "done") {
        useChatStore.getState().finalizeAssistant(target);
        useChatStore.getState().setStreaming(false);
        runIdRef.current = null;
        targetIdRef.current = null;
      }
      return { ack: true };
    });
  }, []);

  const sendMessage = useCallback(
    async (text: string, opts: SendOptions = {}) => {
      if (!opts.agentId) {
        log.error("stream", "sendMessage called without agentId");
        return;
      }
      const userMsg: ChatMessage = {
        id: newId("user"),
        role: "user",
        content: text,
        timestamp: Date.now(),
      };
      const assistantMsg: ChatMessage = {
        id: newId("asst"),
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        pending: true,
      };
      useChatStore.getState().pushMessage(userMsg);
      useChatStore.getState().pushMessage(assistantMsg);
      useChatStore.getState().setStreaming(true);

      const runId = newId("run");
      runIdRef.current = runId;
      targetIdRef.current = assistantMsg.id;

      // Assemble the per-message context. We ship EVERYTHING we know about the
      // active page + extension state. The server matches keys against agent /
      // system slots and surfaces the rest to the model as a tool-callable hint.
      // No truncation here — that's the server's job.
      const user = useAuthStore.getState().user;
      const desktop = useDesktopStore.getState();
      const scrape = useScrapeStore.getState().current;
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
          scrape,
        });
        log.info(
          "stream",
          `built context (${Object.keys(context).length} keys)`,
          {
            keys: Object.keys(context).sort(),
          },
        );
      } catch (err) {
        log.warn(
          "stream",
          "buildChatContext failed; sending without context",
          err,
        );
      }

      // Read once at send time so the latched mode follows the run, even if the
      // user toggles the chip mid-stream.
      const permissionMode = useChatStore
        .getState()
        .getPermissionMode(opts.agentId);

      const isAdmin = useAuthStore.getState().isAdmin;
      const body: AgentStartRequest = {
        user_input: text,
        conversation_id: opts.conversationId ?? null,
        variables: opts.variables ?? null,
        context,
        stream: true,
        store: true,
        source_app: "matrx-extend",
        source_feature: "chat",
        // Tell the server which client-side tools the agent can call. We ship
        // the CORE bundle: a tiny set of always-on essentials plus every
        // `list_<category>_tools` discovery tool. The agent calls
        // `list_browser_tools` to enumerate categories, then a category's
        // list-tool to pull in its full schemas on demand. This keeps the
        // model's context window small without limiting capability.
        client_tools: coreToolNames({ isAdmin }),
      };

      await send(CHANNELS.STREAM_START, {
        runId,
        endpoint: agentExecutePath(opts.agentId),
        body,
        parser: "rich-events" as const,
        agentName: opts.agentName ?? null,
        permissionMode,
      });
    },
    [],
  );

  const cancel = useCallback(async () => {
    if (!runIdRef.current) return;
    await send(CHANNELS.STREAM_CANCEL, { runId: runIdRef.current });
    if (targetIdRef.current)
      useChatStore.getState().finalizeAssistant(targetIdRef.current);
    useChatStore.getState().setStreaming(false);
    runIdRef.current = null;
    targetIdRef.current = null;
  }, []);

  return { send: sendMessage, cancel };
}
