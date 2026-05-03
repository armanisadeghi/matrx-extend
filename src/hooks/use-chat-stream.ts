import { type AgentStartRequest, agentExecutePath } from "@/lib/api/routes/ai";
import { buildBrowserDomState } from "@/lib/chat/build-browser-dom-state";
import { buildChatContext } from "@/lib/chat/build-context";
import { refreshPageContextBeforeSend } from "@/lib/chat/refresh-page-context";
import { log } from "@/lib/debug/log";
import { newId } from "@/lib/id";
import { on, send } from "@/lib/messaging/native";
import { CHANNELS } from "@/lib/messaging/schemas";
import { lookup as lookupTool } from "@/lib/tools/registry";
import { useActiveToolsStore } from "@/state/active-tools";
import { useAuthStore } from "@/state/auth";
import { useAutoScrapeStore } from "@/state/auto-scrape";
import { type ChatMessage, useChatStore } from "@/state/chat";
import { useDesktopStore } from "@/state/desktop";
import { useScrapeStore } from "@/state/scrape";
import { useSettingsStore } from "@/state/settings";
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

/**
 * Detect the server-side discovery handler running and record what category
 * was loaded. Used to update `loaded_categories` in the next request's
 * client.state for the discovery handler to short-circuit re-loads.
 */
function handleDiscoveryToolEvent(
  conversationId: string | null,
  data: Record<string, unknown> | undefined,
): void {
  if (!data) return;
  const subEvent = String(data.event ?? "");
  if (subEvent !== "tool_completed") return;
  if (String(data.tool_name ?? "") !== "load_browser_tools") return;
  // Try common shapes — the server may surface the category in args, output, or data.
  const inner = (data.data ?? {}) as Record<string, unknown>;
  const argsCategory =
    typeof inner.arguments === "object" && inner.arguments !== null
      ? (inner.arguments as Record<string, unknown>).category
      : null;
  const resultCategory =
    typeof inner.result === "object" && inner.result !== null
      ? (inner.result as Record<string, unknown>).category
      : null;
  const cat = String(argsCategory ?? resultCategory ?? "");
  if (cat) useActiveToolsStore.getState().recordCategoryLoaded(conversationId, cat);
}

/**
 * Update the live tool list when the server emits RESOURCE_CHANGED with
 * kind=active_tools. Used by the Tools tab UI to show what the agent
 * currently has available.
 */
function handleResourceChangedEvent(data: Record<string, unknown> | undefined): void {
  if (!data) return;
  if (String(data.kind ?? "") !== "active_tools") return;
  const tools = data.tools ?? data.value ?? [];
  if (!Array.isArray(tools)) return;
  const names = tools
    .map((t) => (typeof t === "string" ? t : (t as { name?: unknown })?.name))
    .filter((n): n is string => typeof n === "string");
  useActiveToolsStore.getState().setLiveTools(names);
}

/**
 * Routes a `tool_event` from the stream to the active assistant message's
 * `serverTools` list. Skips client-registry tools — those are dispatched by
 * the SW and surface via `tool-inbox` / `ToolTimelineRow` instead.
 */
function handleServerToolEvent(
  messageId: string,
  data: Record<string, unknown> | undefined,
): void {
  if (!data) return;
  const subEvent = String(data.event ?? "");
  const callId = String(data.call_id ?? "");
  const toolName = String(data.tool_name ?? "");
  if (!callId || !toolName) return;

  // If this tool is in our client registry, the SW dispatcher is handling it
  // and the existing tool-inbox timeline will render it. Don't double-track.
  if (lookupTool(toolName)) return;

  const message = typeof data.message === "string" ? data.message : undefined;
  const inner = (data.data ?? {}) as Record<string, unknown>;

  if (subEvent === "tool_started") {
    useChatStore.getState().upsertServerTool(messageId, callId, {
      toolName,
      message,
      args: inner.arguments ?? null,
      phase: "started",
    });
  } else if (subEvent === "tool_completed") {
    useChatStore.getState().upsertServerTool(messageId, callId, {
      toolName,
      message,
      result: inner.result ?? null,
      phase: "completed",
    });
  } else if (subEvent === "tool_error" || subEvent === "tool_failed") {
    useChatStore.getState().upsertServerTool(messageId, callId, {
      toolName,
      message,
      result: inner.error ?? inner.result ?? null,
      phase: "error",
    });
  }
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
        if (chunk.payload.eventName === "tool_event") {
          // Two side-effects on top of the regular per-message routing:
          // (a) record category-discovery completions so future requests can
          //     hint `loaded_categories`; (b) hand non-registry tools to
          //     ServerToolRow.
          const convId = useChatStore.getState().selectedConversationId;
          handleDiscoveryToolEvent(convId, chunk.payload.data);
          handleServerToolEvent(target, chunk.payload.data);
        } else if (
          chunk.payload.eventName === "resource_changed" ||
          chunk.payload.eventName === "RESOURCE_CHANGED"
        ) {
          // Live tool-set updates. Used by the Tools tab UI to show what the
          // agent currently has available after each load_browser_tools call.
          handleResourceChangedEvent(chunk.payload.data);
        } else {
          // Other events: phase, completion, render_block, etc. — log only.
          log.info(
            "stream",
            `event: ${chunk.payload.eventName}`,
            chunk.payload.data,
          );
        }
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

      // Pre-send page-context refresh. This is what makes the difference
      // between "agent is staring at last load's content" and "agent has
      // exactly what's on screen RIGHT NOW". Decides between no-op / fast
      // recapture / deep recapture (with scroll-and-restore) based on cache
      // freshness + the user's composer settings. Never blocks longer than
      // ~4s (the deep-capture cap).
      const settings = useSettingsStore.getState();
      try {
        const decision = await refreshPageContextBeforeSend({
          autoFullScrollOnFirstSubmit: settings.autoFullScrollOnFirstSubmit,
        });
        log.info("stream", `pre-send page refresh: ${decision.action} (${decision.reason})`);
      } catch (err) {
        log.warn("stream", "pre-send page refresh failed", err);
      }

      // Assemble the per-message context. We ship EVERYTHING we know about the
      // active page + extension state. The server matches keys against agent /
      // system slots and surfaces the rest to the model as a tool-callable hint.
      // No truncation here — that's the server's job.
      const user = useAuthStore.getState().user;
      const desktop = useDesktopStore.getState();
      // Prefer a manual user-driven scrape (Scrape tab → Save) when present.
      // Otherwise fall through to the background auto-capture (always reflects
      // the page's current state).
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

      // Build the browser-dom capability state. The server-side discovery
      // handler reads this to decide which tool category to load.
      // `loaded_categories` is the per-conversation hint — once cross-request
      // tool persistence ships server-side, the handler can use it to
      // short-circuit re-discovery.
      const conversationId = opts.conversationId ?? null;
      const loadedCategories = useActiveToolsStore.getState().getLoaded(conversationId);
      const browserDomState = await buildBrowserDomState({
        surface: "assistant",
        agentId: opts.agentId,
        loadedCategories,
      });

      const body: AgentStartRequest = {
        user_input: text,
        conversation_id: conversationId,
        variables: opts.variables ?? null,
        context,
        stream: true,
        store: true,
        source_app: "matrx-extend",
        source_feature: "chat",
        // New capability envelope. Replaces the old `client_tools` field.
        // The server's `browser-dom` capability brings `load_browser_tools`
        // online; the model calls it with a category to pull the matching
        // tool schemas in via `ctx.queue_tool_changes(...)`. Smaller surface
        // every turn, full coverage on demand.
        client: {
          capabilities: ["browser-dom"],
          state: {
            "browser-dom": browserDomState as unknown as Record<string, unknown>,
          },
        },
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
