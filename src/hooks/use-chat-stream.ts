import { type AgentStartRequest, agentExecutePath } from "@/lib/api/routes/ai";
import { resolveActiveTab } from "@/lib/chat/active-tab";
import { buildBrowserDomState } from "@/lib/chat/build-browser-dom-state";
import { buildChatContext } from "@/lib/chat/build-context";
import { refreshPageContextBeforeSend } from "@/lib/chat/refresh-page-context";
import { log } from "@/lib/debug/log";
import { newId } from "@/lib/id";
import { on, send } from "@/lib/messaging/native";
import { CHANNELS } from "@/lib/messaging/schemas";
import { resolveToolName } from "@/lib/tools/aliases";
import { lookup as lookupTool } from "@/lib/tools/registry";
import {
  projectAdminFlagsToRequest,
  useAdminFlagsStore,
} from "@/state/admin-flags";
import { useActiveToolsStore } from "@/state/active-tools";
import { useAuthStore } from "@/state/auth";
import { useAutoScrapeStore } from "@/state/auto-scrape";
import { type ChatMessage, type ToolPartCall, useChatStore } from "@/state/chat";
import { useDesktopStore } from "@/state/desktop";
import { useScrapeStore } from "@/state/scrape";
import { useSettingsStore } from "@/state/settings";
import { useCallback, useEffect, useRef } from "react";

interface SendOptions {
  agentId?: string;
  agentName?: string;
  conversationId?: string;
  variables?: Record<string, unknown>;
  /**
   * Surface initiating this run. Drives the `client.state["browser-dom"]`
   * `surface` field — the server's discovery handler reads it to pick the
   * right default tool category set. Default 'assistant' preserves
   * existing behavior; the Pilot view passes 'pilot'.
   */
  surface?: 'assistant' | 'pilot';
  /**
   * Override the source feature reported in telemetry. Defaults to 'chat'.
   * Pilot runs report 'pilot' so server-side analytics can split the two.
   */
  sourceFeature?: string;
  /**
   * When provided, the run pins to this tab id instead of the active tab.
   * Pilot uses this to keep every tool call inside the session's tab group.
   */
  assignedTabId?: number | null;
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
 * Route a `tool_event` from the stream into the active assistant message's
 * parts array. Server-side AND client-side tools both flow through here —
 * the only difference is `kind`. Tool entries push as new parts in arrival
 * order so they interleave correctly with text and reasoning.
 *
 * For client tools the SW dispatcher will ALSO emit a TOOL_TIMELINE_EVENT
 * with the full local output once the tool finishes. That second update
 * merges into the same part by callId — this stream-side handler just
 * marks the part as started and seeds the args.
 */
function handleToolEvent(
  messageId: string,
  data: Record<string, unknown> | undefined,
): void {
  if (!data) return;
  const subEvent = String(data.event ?? "");
  const callId = String(data.call_id ?? "");
  const wireName = String(data.tool_name ?? "");
  if (!callId || !wireName) return;

  // Normalize the wire name (e.g. `matrx-extend__take_screenshot`) to the
  // bare local name the registry + display-config use (`take_screenshot`).
  // Without this, lookupTool fails, kind is mis-set to 'server', and the
  // tool-display registry can't find a config — the polished phase-aware
  // header (Loader2 → final icon, "Reading page" → "Read page", etc.)
  // never renders. Prefer the server-supplied canonical_name when present.
  const canonicalName =
    (data.canonical_name as string | undefined) ??
    (data.canonicalName as string | undefined) ??
    null;
  const resolved = canonicalName
    ? { local: canonicalName.split(":").pop() ?? canonicalName, bundle: null }
    : resolveToolName(wireName);
  const toolName = resolved.local;

  // Kind is derived from whether the RESOLVED name is in our client
  // registry — must use the bare form, since the registry is keyed there.
  const kind: "server" | "client" = lookupTool(toolName) ? "client" : "server";
  const message = typeof data.message === "string" ? data.message : undefined;
  const inner = (data.data ?? {}) as Record<string, unknown>;
  const upsert = useChatStore.getState().upsertToolPart;

  // Only include fields that are actually present so we never overwrite a
  // real value (e.g. args set by the SW broadcast) with undefined.
  const base: Partial<ToolPartCall> & { kind: "server" | "client" } = {
    kind,
    toolName,
  };
  if (message !== undefined) base.message = message;

  // `tool_delegated` is the server's explicit "your turn" signal for client
  // tools — and it arrives BEFORE the SW dispatcher's TOOL_TIMELINE_EVENT.
  // Treating it as a started-phase event is what gets a phase-aware row
  // (spinner + "Reading page" + shimmer) on screen the moment the model
  // makes the call, instead of waiting for completion. The server does NOT
  // emit `tool_started` for client-dispatched tools — only this one.
  if (subEvent === "tool_started" || subEvent === "tool_delegated") {
    const args = inner.arguments;
    upsert(messageId, callId, {
      ...base,
      phase: "started",
      ...(args !== undefined ? { args } : {}),
    });
  } else if (subEvent === "tool_completed") {
    const result = inner.result;
    upsert(messageId, callId, {
      ...base,
      phase: "completed",
      ...(result !== undefined ? { result } : {}),
    });
  } else if (subEvent === "tool_error" || subEvent === "tool_failed") {
    const errResult = inner.error ?? inner.result;
    upsert(messageId, callId, {
      ...base,
      phase: "error",
      ...(errResult !== undefined ? { result: errResult } : {}),
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
        // Reasoning chunks are model "thinking" tokens. Append to the
        // active assistant message's parts in arrival order so they show
        // between text + tool entries exactly where the model produced them.
        if (chunk.payload.content)
          useChatStore
            .getState()
            .appendAssistantReasoning(target, chunk.payload.content);
      } else if (chunk.type === "event") {
        if (chunk.payload.eventName === "tool_event") {
          // Two side-effects on top of the regular per-message routing:
          // (a) record category-discovery completions so future requests can
          //     hint `loaded_categories`; (b) push the tool entry as a part
          //     on the active assistant message so it interleaves with text.
          const convId = useChatStore.getState().selectedConversationId;
          handleDiscoveryToolEvent(convId, chunk.payload.data);
          handleToolEvent(target, chunk.payload.data);
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
    async (text: string, opts: SendOptions = {}): Promise<string | null> => {
      if (!opts.agentId) {
        log.error("stream", "sendMessage called without agentId");
        return null;
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
      // Resolve the active tab ONCE — this Tab is the source of truth for
      // every tab-id field on the wire (page_brief.tab_id, tab_state.*,
      // client.state["browser-dom"].current_tab_id, STREAM_START.assignedTabId).
      // See docs/REQUEST_PAYLOAD_CONTRACT.md §1.
      const activeTab = await resolveActiveTab();
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
          activeTab,
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
      const surface = opts.surface ?? "assistant";
      // Reuse the active tab from above and lift `page_lang` out of the
      // freshly-built context's page_brief so the browser-dom builder
      // doesn't re-query Chrome OR re-fetch the page lang. Both payloads
      // now reference the same Tab and same lang.
      const briefLang =
        (context.page_brief as { lang?: string | null } | undefined)?.lang ?? null;
      const browserDomState = await buildBrowserDomState({
        surface,
        agentId: opts.agentId,
        loadedCategories,
        activeTab,
        pageLang: briefLang,
      });
      // Pilot pins every run to a tab inside its session group so the
      // dispatcher's group-scoping gate accepts the call. The PilotView
      // computes the target tab and passes it explicitly; falling back to
      // the active-tab id (the default) would let any focused tab leak
      // into the run, defeating the sandbox.
      const effectiveAssignedTabId =
        opts.assignedTabId !== undefined
          ? opts.assignedTabId
          : browserDomState.current_tab_id;

      // Admin-only request overrides (debug, snapshot, block_mode, memory_*,
      // max_iterations, etc). Stripped if the user isn't an admin — defense
      // in depth: even a stale store from a previous admin session can't
      // bleed into a non-admin's request.
      const isAdmin = useAuthStore.getState().isAdmin;
      const adminOverrides = isAdmin
        ? projectAdminFlagsToRequest(useAdminFlagsStore.getState())
        : {};

      // User-set model override (also editable by admins via the Debug-tab
      // full picker). Merges into config_overrides.model. The admin's raw
      // config_overrides_json wins on conflict — admins know what they're
      // doing. We only set this field when the user has actively picked
      // something, so the absence of the key means "let server default apply"
      // — never sent as null.
      const modelOverrideId = useSettingsStore.getState().modelOverrideId;
      let configOverrides: Record<string, unknown> | undefined;
      if (modelOverrideId) {
        configOverrides = { model: modelOverrideId };
      }
      // adminOverrides may already contain a config_overrides field from the
      // raw JSON path. Merge so admin JSON keys win on conflict, but if only
      // the user override is set, that flows through cleanly.
      if (adminOverrides.config_overrides && typeof adminOverrides.config_overrides === 'object') {
        configOverrides = {
          ...(configOverrides ?? {}),
          ...(adminOverrides.config_overrides as Record<string, unknown>),
        };
        // Strip from adminOverrides so the spread below doesn't double-set it.
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
        source_app: "matrx-extend",
        source_feature: opts.sourceFeature ?? "chat",
        ...adminOverrides,
        ...(configOverrides ? { config_overrides: configOverrides } : {}),
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

      // Latch the tab the agent will operate on for the entire run.
      // `browserDomState.current_tab_id` mirrors the single `activeTab`
      // we resolved at the top of this send — same Tab on the dispatcher
      // gate, in `context.page_brief`, and in `client.state["browser-dom"]`.
      // Passing it through STREAM_START is what the SW dispatcher uses
      // to pin every tool call in this turn — so the user can switch
      // tabs mid-execution without dragging `read_page`/`click`/`screenshot`
      // along.
      await send(CHANNELS.STREAM_START, {
        runId,
        endpoint: agentExecutePath(opts.agentId),
        body,
        parser: "rich-events" as const,
        agentName: opts.agentName ?? null,
        permissionMode,
        assignedTabId: effectiveAssignedTabId,
      });
      return runId;
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
