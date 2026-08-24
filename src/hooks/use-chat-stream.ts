import {
  type AgentStartRequest,
  agentTargetExecutePath,
  mandateExecutePath,
} from '@/lib/api/routes/ai';
import { requireRequestOrganizationId } from '@/lib/api/routes/auth';
import { conversationResumePath } from '@/lib/api/routes/tool-results';
import { resolveActiveTab } from '@/lib/chat/active-tab';
import { buildBrowserDomState } from '@/lib/chat/build-browser-dom-state';
import { buildChatContext } from '@/lib/chat/build-context';
import type { AttachedHighlight } from '@/lib/chat/context/types';
import { refreshPageContextBeforeSend } from '@/lib/chat/refresh-page-context';
import { progressFromWire } from '@/lib/chat/tool-progress';
import { readInboundRenderBlock } from '@/lib/content-ir/inbound';
import { log } from '@/lib/debug/log';
import { getHighlightsByIds } from '@/lib/highlights/queries';
import { newId } from '@/lib/id';
import { broadcast, on, send } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import {
  deadlineFor,
  isTerminal,
  parseProviderRetry,
  toRetryState,
} from '@/lib/stream/provider-retry';
import { attemptResume } from '@/lib/stream/resume';
import { createStreamWatchdog } from '@/lib/stream/watchdog';
import { lookup as lookupTool } from '@/lib/tools/registry';
import { useActiveToolsStore } from '@/state/active-tools';
import { projectAdminFlagsToRequest, useAdminFlagsStore } from '@/state/admin-flags';
import { useAuthStore } from '@/state/auth';
import { useAutoScrapeStore } from '@/state/auto-scrape';
import { type ChatMessage, type ToolPartCall, useChatStore } from '@/state/chat';
import { useDesktopStore } from '@/state/desktop';
import { useHighlightStore } from '@/state/highlights';
import { useScrapeStore } from '@/state/scrape';
import { useSettingsStore } from '@/state/settings';
import { useTurnInboxStore } from '@/state/turn-inbox';
import type { ConsumedInjection } from '@gen/stream-events';
import { useCallback, useEffect } from 'react';

/**
 * Materialize the highlights the user attached via the Highlight tab into the
 * compact shape the `highlights` context key expects. Returns null when the
 * tray is empty so the context builder omits the key entirely.
 */
async function resolveAttachedHighlights(): Promise<AttachedHighlight[] | null> {
  const ids = useHighlightStore.getState().attachedIds;
  if (ids.length === 0) return null;
  const rows = await getHighlightsByIds(ids);
  if (rows.length === 0) return null;
  return rows.map((h) => ({
    id: h.id,
    mode: h.mode,
    text: h.text,
    url: h.url,
    ref: {
      ...(h.anchor.selector !== undefined ? { selector: h.anchor.selector } : {}),
      ...(h.anchor.ref !== undefined ? { ref: h.anchor.ref } : {}),
      ...(h.anchor.text_quote !== undefined
        ? {
            text_quote: {
              exact: h.anchor.text_quote.exact,
              ...(h.anchor.text_quote.prefix !== undefined
                ? { prefix: h.anchor.text_quote.prefix }
                : {}),
              ...(h.anchor.text_quote.suffix !== undefined
                ? { suffix: h.anchor.text_quote.suffix }
                : {}),
            },
          }
        : {}),
      ...(h.anchor.role !== undefined ? { role: h.anchor.role } : {}),
      ...(h.anchor.tag !== undefined ? { tag: h.anchor.tag } : {}),
    },
  }));
}

interface SendOptions {
  agentId?: string;
  /** When present, aidream resolves this Mandate instead of treating agentId as a UUID. */
  mandateKey?: string;
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
  /**
   * Invoked SYNCHRONOUSLY with the freshly-claimed runId, before any await in
   * the send path. Callers that need to subscribe stream listeners filtered
   * by runId (the agenda runner) use this — subscribing after the returned
   * promise settles is too late, since `sendMessage` only resolves after
   * context assembly and the STREAM_START handoff.
   */
  onRunId?: (runId: string) => void;
  /**
   * Invoked when the STREAM_START handoff fails before any chunk arrived —
   * the run never started. Same-context callers (the agenda runner) need
   * this because `broadcast` does not loop back to the sending context, so
   * they'd never see a terminal chunk for the failed run.
   */
  onStartFailed?: (err: Error) => void;
}

interface StreamChunk {
  runId: string;
  type: 'text' | 'reasoning' | 'event' | 'error' | 'done';
  payload: {
    content?: string;
    eventName?: string;
    data?: Record<string, unknown>;
    message?: string;
    /**
     * HTTP status for error-type chunks. 0 = network error, undefined =
     * mid-stream error (parse failure, server-emitted error). Specifically
     * used to suppress the resume protocol's 409 "outstanding_delegated_calls"
     * as a benign signal rather than rendering it as an error message.
     */
    status?: number;
  };
}

interface StreamOpened {
  runId: string;
  conversationId: string | null;
  requestId: string | null;
  agentName?: string | null;
  permissionMode?: 'ask' | 'act';
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
  const subEvent = String(data.event ?? '');
  if (subEvent !== 'tool_completed') return;
  if (String(data.tool_name ?? '') !== 'load_chrome_tools') return;
  // Try common shapes — the server may surface the category in args, output, or data.
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

/**
 * Update the live tool list when the server emits RESOURCE_CHANGED with
 * kind=active_tools. Used by the Tools tab UI to show what the agent
 * currently has available.
 */
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
function handleToolEvent(messageId: string, data: Record<string, unknown> | undefined): void {
  if (!data) return;
  const subEvent = String(data.event ?? '');
  const callId = String(data.call_id ?? '');
  const wireName = String(data.tool_name ?? '');
  if (!callId || !wireName) return;

  // Post-2026-05-27 tool refactor every `tool_def.name` is a bare
  // identifier (per docs/official/tool_system_rules.md R11). The wire
  // `tool_name` is the registry key directly — no prefix stripping, no
  // canonical_name fallback, no alias map.
  const toolName = wireName;

  // Kind is derived from whether the wire name is in our client registry.
  const kind: 'server' | 'client' = lookupTool(toolName) ? 'client' : 'server';
  const message = typeof data.message === 'string' ? data.message : undefined;
  const inner = (data.data ?? {}) as Record<string, unknown>;
  const upsert = useChatStore.getState().upsertToolPart;

  // Only include fields that are actually present so we never overwrite a
  // real value (e.g. args set by the SW broadcast) with undefined.
  const base: Partial<ToolPartCall> & { kind: 'server' | 'client' } = {
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
  if (subEvent === 'tool_started' || subEvent === 'tool_delegated') {
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
  } else if (subEvent === 'tool_progress') {
    // Incremental update for a long-running tool — does NOT change phase.
    // Only renders when a tool actually emits these (opt-in); every other
    // tool is unaffected.
    useChatStore
      .getState()
      .appendToolProgress(messageId, callId, progressFromWire(message, inner), {
        toolName,
        kind,
      });
  }
}

/**
 * The running agent drained one or more queued inbox items at a turn boundary
 * (turn-boundary inbox — docs/TURN_BOUNDARY_INBOX.md). For each item: flip its
 * floating "waiting" card to delivered, and slot the message into the
 * transcript as a real user bubble immediately above the still-streaming
 * assistant message so ordering reads naturally (… → user steer → assistant
 * continues). Items the server marks `is_visible_to_user: false` (silent
 * steering) are not rendered.
 *
 * The deployed `ConsumedInjection` schema now carries `text` +
 * `is_visible_to_user` (the drain echoes them at runtime), so we read the
 * generated typed fields directly. We still fall back to our local record of
 * what we sent when `text` is empty — covers a consumed item we never queued
 * locally with no echoed text. See docs/SERVER_NEEDS_turn_boundary_inbox.md.
 */
function handleInjectionConsumed(
  targetAssistantId: string | null,
  data: Record<string, unknown> | undefined,
): void {
  const items: ConsumedInjection[] = Array.isArray(data?.items)
    ? (data.items as ConsumedInjection[])
    : [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const injectionId = it.injection_id ?? '';
    if (!injectionId) continue;
    const matched = useTurnInboxStore.getState().markDeliveredByInjectionId(injectionId);
    // Prefer the server-echoed text (self-contained even for an item we never
    // queued ourselves); fall back to our local record of what we sent.
    const text = it.text ? it.text : (matched?.text ?? '');
    // Default visible unless the server explicitly says otherwise.
    const visibleToUser = it.is_visible_to_user !== false;
    if (visibleToUser && text) {
      const msg: ChatMessage = {
        id: newId('user'),
        role: 'user',
        content: text,
        timestamp: Date.now(),
      };
      useChatStore.getState().insertMessageBefore(targetAssistantId, msg);
    }
  }
}

/**
 * Total silence (no chunks, no heartbeat) after which the run is presumed
 * dead and the watchdog clears the spinner. Generous enough to ride out a
 * legitimately slow tool call between server events, short enough that a
 * hung offscreen/network doesn't strand the UI for minutes.
 */
const STALL_MS = 75_000;

/**
 * Cross-instance resume claim. `useChatStream` is mounted by several
 * co-mounted components (ChatView, the agenda listener at the App root,
 * every InteractionAskCard) — each registers its own STREAM_CONTINUE
 * listener, and before this claim a single broadcast made EVERY idle
 * instance POST /resume: the server's atomic claim 409'd the losers, whose
 * bounded retry loops then pushed ghost assistant bubbles (the residual
 * tail of the 2026-06-09 duplicate-resume incident — audit P1-13). The map
 * is module-scoped (shared by all instances in this JS context), keyed by
 * user_request_id. The owning instance may re-enter for its own 409
 * retries; everyone else bails before mutating any UI state.
 */
const resumeClaims = new Map<string, { owner: string; at: number }>();
const RESUME_CLAIM_TTL_MS = 30_000;

function claimResume(userRequestId: string, owner: string): boolean {
  const existing = resumeClaims.get(userRequestId);
  const now = Date.now();
  if (existing && existing.owner !== owner && now - existing.at < RESUME_CLAIM_TTL_MS) {
    return false;
  }
  resumeClaims.set(userRequestId, { owner, at: now });
  if (resumeClaims.size > 50) {
    const oldest = resumeClaims.keys().next().value;
    if (oldest !== undefined) resumeClaims.delete(oldest);
  }
  return true;
}

/* ── Module-scoped stream CONTROLLER ──────────────────────────────────────
 *
 * One controller per JS context, shared by every useChatStream() instance.
 * Run ownership used to live in per-instance useRefs — and useChatStream is
 * mounted by ChatView, the agenda listener, AND every InteractionAskCard.
 * A run started through a card's instance was invisible to ChatView's:
 * Stop did nothing, "Stop & send" started a SECOND concurrent run, and when
 * the card unmounted (conversation switch) its chunk listener died with it,
 * leaving isStreaming=true FOREVER — composer locked in queue-mode, chat
 * surface bricked until panel reload. Module scope makes every instance
 * operate on the one real run, and the (single) listeners/watchdog live for
 * the context lifetime, so unmount can't orphan them.
 */
const instanceIdRef = { current: newId('chathook') };
const runIdRef: { current: string | null } = { current: null };
const targetIdRef: { current: string | null } = { current: null };
// For stall recovery: the request id (resume key), how many events we've
// seen (resume cursor), and the last send (to power Retry).
const requestIdRef: { current: string | null } = { current: null };
const eventCountRef = { current: 0 };
const lastSendRef: { current: { input: string; opts: SendOptions } | null } = { current: null };
// Pending STREAM_CONTINUE that arrived while the original stream was still
// wrapping up. Drained on the next `done` chunk so the resume actually
// fires instead of being dropped on the floor.
const pendingContinueRef: {
  current: { conversationId: string; userRequestId: string | null } | null;
} = { current: null };
// Late-binding ref for `resumeRun` so the STREAM_CHUNK `done` handler can
// call it even though the function is (re)bound inside the hook.
const resumeRunRef: {
  current: (conversationId: string, userRequestId: string | null) => Promise<string | null>;
} = { current: async () => null };
// Retryable-409 recovery for /resume. Bounded per user_request.
const resumeRetryRef: {
  current: {
    conversationId: string;
    userRequestId: string | null;
    runId: string;
    attempts: number;
  } | null;
} = { current: null };

// The watchdog is created once per context; onStall late-binds below.
const onStallRef = { current: () => {} };
const watchdogRef = {
  current: createStreamWatchdog({
    stallMs: STALL_MS,
    onStall: () => onStallRef.current(),
  }),
};

let listenersInstalled = false;

/**
 * Install the context-singleton stream listeners + the stall handler.
 * Idempotent; never torn down (the controller lives as long as the
 * document). Previously each hook instance registered its own copies —
 * see the controller docblock above for why that broke.
 */
function ensureStreamListeners(): void {
  if (listenersInstalled) return;
  listenersInstalled = true;

  onStallRef.current = () => {
    const runId = runIdRef.current;
    const target = targetIdRef.current;
    if (!runId || !target) return; // run already ended cleanly
    log.warn('stream', `stream stalled — no activity for ${STALL_MS}ms`, { runId });
    const conversationId = useChatStore.getState().selectedConversationId;
    const requestId = requestIdRef.current;
    void (async () => {
      // Reset this run's bookkeeping to "idle" BEFORE attempting resume.
      // `resumeRun` treats a non-null runIdRef as "previous run still
      // finalizing" and QUEUES itself as a pendingContinue instead of
      // actually opening a stream (see resumeRun's idle guard) — so calling
      // it without this reset would silently no-op. We also finalize the
      // stalled bubble here since a successful resume renders its
      // continuation into a FRESH assistant message, exactly like a real
      // STREAM_CONTINUE does.
      watchdogRef.current?.stop();
      useChatStore.getState().finalizeAssistant(target);
      runIdRef.current = null;
      targetIdRef.current = null;

      const resume = await attemptResume(
        { runId, conversationId, requestId },
        resumeRunRef.current,
      );
      if (resume.resumed) {
        log.info('stream', 'stream resumed after stall (via /resume, no replay)', { runId });
        // resumeRun already pushed a new assistant message, set runIdRef/
        // targetIdRef, and re-armed the watchdog for the new run — nothing
        // left to do here.
        return;
      }
      // Give up: clear the stuck spinner and surface a Retry (full-turn
      // replay). This is the pre-existing fallback, unchanged.
      log.warn('stream', `stream giving up (${resume.reason})`, { runId });
      useChatStore.getState().setStreaming(false);
      useChatStore.getState().setStreamInterruption({
        runId,
        reason: 'stalled',
        silentMs: STALL_MS,
        lastInput: lastSendRef.current?.input ?? '',
        at: Date.now(),
      });
      // Queued turn-boundary cards can't be drained by a dead run — flip
      // them to failed so the user isn't watching a forever-ticking
      // "waiting its turn" timer (audit P2-5). The server-side inbox item
      // survives; it delivers on the conversation's next run.
      const inbox = useTurnInboxStore.getState();
      for (const item of inbox.items) {
        if (item.status === 'pending' || item.status === 'sending') {
          inbox.markFailed(
            item.localId,
            'Run ended before this was delivered — it will reach the agent on the next run.',
          );
        }
      }
      useChatStore.getState().setProviderRetry(null);
    })();
  };

  // Echo-adopt the conversation_id the response reports. The client now mints
  // its own id before the first send (see the send path below), so this is a
  // confirmation rather than the source — it stays because the server is the
  // authority on which conversation the stream actually ran against.
  on<StreamOpened, { ack: true }>(CHANNELS.STREAM_OPENED, (payload) => {
    if (payload.runId !== runIdRef.current) return { ack: true };
    if (payload.requestId) requestIdRef.current = payload.requestId;
    watchdogRef.current?.touch();
    if (payload.conversationId) {
      useChatStore.getState().adoptConversationId(payload.conversationId);
    }
    return { ack: true };
  });

  on<StreamChunk, { ack: true }>(CHANNELS.STREAM_CHUNK, (chunk) => {
    if (chunk.runId !== runIdRef.current) return { ack: true };
    const target = targetIdRef.current;
    if (!target) return { ack: true };

    // Any chunk — text, reasoning, event (incl. the server's `heartbeat`),
    // tool, error — is a sign of life. Reset the stall watchdog and bump the
    // resume cursor.
    eventCountRef.current += 1;
    watchdogRef.current?.touch();

    if (chunk.type === 'text') {
      if (chunk.payload.content)
        useChatStore.getState().appendAssistantText(target, chunk.payload.content);
    } else if (chunk.type === 'reasoning') {
      // Reasoning chunks are model "thinking" tokens. Append to the
      // active assistant message's parts in arrival order so they show
      // between text + tool entries exactly where the model produced them.
      if (chunk.payload.content)
        useChatStore.getState().appendAssistantReasoning(target, chunk.payload.content);
    } else if (chunk.type === 'event') {
      if (chunk.payload.eventName === 'tool_event') {
        // Two side-effects on top of the regular per-message routing:
        // (a) record category-discovery completions so future requests can
        //     hint `loaded_categories`; (b) push the tool entry as a part
        //     on the active assistant message so it interleaves with text.
        const convId = useChatStore.getState().selectedConversationId;
        handleDiscoveryToolEvent(convId, chunk.payload.data);
        handleToolEvent(target, chunk.payload.data);
      } else if (
        chunk.payload.eventName === 'resource_changed' ||
        chunk.payload.eventName === 'RESOURCE_CHANGED'
      ) {
        // Live tool-set updates. Used by the Tools tab UI to show what the
        // agent currently has available after each load_chrome_tools call.
        handleResourceChangedEvent(chunk.payload.data);
      } else if (chunk.payload.eventName === 'injection_consumed') {
        // Turn-boundary inbox: queued message(s) drained by the running
        // agent. Render them as user bubbles + flip their floating cards.
        handleInjectionConsumed(target, chunk.payload.data);
      } else if (
        chunk.payload.eventName === 'info' &&
        (chunk.payload.data as { code?: unknown } | undefined)?.code === 'inbox_continue'
      ) {
        // The agent had produced what looked like its final answer, but a
        // queued message arrived in the same turn — the run continues rather
        // than going idle. Nothing to render; the answer follows as chunks.
        log.info(
          'stream',
          'inbox_continue — agent will address a queued message',
          chunk.payload.data,
        );
      } else if (chunk.payload.eventName === 'provider_retry') {
        // The upstream LLM provider failed and the server is backing off.
        //
        // This is the one event where the stream's silence is EXPECTED. The
        // generic `touch()` above already reset the 75s stall timer once — but
        // the backoff can be much longer than that, and the server sends nothing
        // (not even a heartbeat) while it waits. Without a hold, the watchdog
        // would declare a perfectly healthy run dead mid-retry and show the user
        // a bogus "connection lost" banner. `hold()` pushes the deadline out to
        // the server's own retry_at, so a stall is still caught if the retry
        // never actually lands.
        const retry = parseProviderRetry(chunk.payload.data);
        if (retry) {
          const deadline = deadlineFor(retry);
          if (deadline !== null) watchdogRef.current?.hold(deadline);
          useChatStore.getState().setProviderRetry(isTerminal(retry) ? null : toRetryState(retry));
          log.info(
            'stream',
            `provider_retry: ${retry.state} (${retry.provider})`,
            chunk.payload.data,
          );
        }
      } else if (chunk.payload.eventName === 'reasoning') {
        // Reasoning block boundary ({state: 'started' | 'stopped'}). The tokens
        // themselves still arrive as `reasoning_chunk`; this only delimits them.
        // We don't need to open a part here — appendAssistantReasoning already
        // starts a fresh part whenever the previous part is a different type —
        // but on 'stopped' we finalize so any following text can't be appended
        // into the thinking block.
        const state = (chunk.payload.data as { state?: unknown } | undefined)?.state;
        if (state === 'stopped') useChatStore.getState().closeReasoning(target);
        log.info('stream', `reasoning: ${String(state)}`, chunk.payload.data);
      } else if (chunk.payload.eventName === 'render_block') {
        // THE SERVER ALREADY DID THE WORK. A render block carries a validated
        // Content-IR envelope on `metadata.__ir`: the region was detected,
        // parsed and checked against its registered schema server-side, which
        // is the whole division of labour for a thin client. Until 2026-08-23
        // this branch LOGGED the envelope and threw it away, so every
        // structured answer arrived as raw text or not at all.
        //
        // `readInboundRenderBlock` is the wire gate (the kernel's pure
        // envelope validator); rendering happens through the SHARED kind route
        // in `components/kinds/RenderBlockView.tsx`. Nothing here parses.
        const block = readInboundRenderBlock(chunk.payload.data);
        if (block) {
          useChatStore.getState().upsertRenderBlock(target, block);
        } else {
          log.warn(
            'stream',
            'render_block event had no usable blockId — dropped',
            chunk.payload.data,
            chunk.payload.eventName,
          );
        }
      } else {
        // Other events: phase, completion, etc. — log only.
        log.info(
          'stream',
          `event: ${chunk.payload.eventName}`,
          chunk.payload.data,
          chunk.payload.eventName,
        );
      }
    } else if (chunk.type === 'error') {
      const message = chunk.payload.message ?? 'stream error';
      const status = chunk.payload.status;
      // 409 on /resume = "outstanding_delegated_calls" — benign. The user
      // still has pending ask cards in the inbox; the server is telling us
      // it can't continue the loop yet because answers are missing. Don't
      // render it as a stream error; just clean up the empty assistant
      // bubble and let the inbox cards drive the next step. The full
      // protocol contract is at
      // matrx-frontend/features/agents/docs/CLIENT_TOOL_SUSPEND_RESUME.md §2.5.
      if (status === 409) {
        // Three 409 shapes from /resume:
        //   * outstanding_delegated_calls — benign; the user still has
        //     pending ask cards. No retry.
        //   * resume_conflict (retryable) — the suspending run hasn't
        //     persisted status='paused' yet, or a duplicate continuation
        //     lost the atomic claim. Retry with backoff (bounded).
        //   * not_resumable — terminal request status. No retry.
        const retryState = resumeRetryRef.current;
        const RESUME_CONFLICT_MAX_RETRIES = 4;
        if (
          message.includes('resume_conflict') &&
          retryState &&
          retryState.runId === chunk.runId &&
          retryState.attempts < RESUME_CONFLICT_MAX_RETRIES
        ) {
          retryState.attempts += 1;
          const delay = 700 * retryState.attempts;
          log.info(
            'stream',
            `409 resume_conflict — retrying resume in ${delay}ms (attempt ${retryState.attempts}/${RESUME_CONFLICT_MAX_RETRIES})`,
            { runId: chunk.runId },
          );
          setTimeout(() => {
            void resumeRunRef.current(retryState.conversationId, retryState.userRequestId);
          }, delay);
        } else {
          log.info(
            'stream',
            '409 on resume — not retrying (outstanding answers, terminal status, or retries exhausted)',
            { runId: chunk.runId, message },
          );
        }
        // Drop the placeholder assistant bubble we allocated for the resume —
        // there's no continuation to render. The `done` chunk that follows
        // this error handler in streamFetch's error path will finalize it,
        // and the ask cards remain interactive.
      } else {
        useChatStore.getState().appendAssistantText(target, `\n\n_Error:_ ${message}`);
      }
    } else if (chunk.type === 'done') {
      watchdogRef.current?.stop();
      useChatStore.getState().setProviderRetry(null);
      useChatStore.getState().finalizeAssistant(target);
      useChatStore.getState().setStreaming(false);
      runIdRef.current = null;
      targetIdRef.current = null;
      // Drain any STREAM_CONTINUE that raced the stream end. A fast
      // client tool (e.g. one that doesn't need user input) can finish
      // and POST its result before the offscreen→sidepanel `done` chunk
      // reaches us. The SW broadcasts STREAM_CONTINUE the moment the
      // server says `continuation_needed=true` — if that broadcast won
      // the race against `done`, we queued it; now is the moment to
      // fire it.
      const pending = pendingContinueRef.current;
      if (pending) {
        pendingContinueRef.current = null;
        log.info('stream', 'draining queued STREAM_CONTINUE after stream done', pending);
        void resumeRunRef.current(pending.conversationId, pending.userRequestId);
      }
    }
    return { ack: true };
  });

  // The SW broadcasts {conversationId, userRequestId} the moment a posted
  // tool result comes back continuation_needed=true; we open a fresh
  // /resume stream. Late-bound through resumeRunRef (set by the hook).
  on<{ conversationId: string; userRequestId: string | null }, { ack: true }>(
    CHANNELS.STREAM_CONTINUE,
    (payload) => {
      void resumeRunRef.current(payload.conversationId, payload.userRequestId);
      return { ack: true };
    },
  );
}

export function useChatStream() {
  // Register the context-singleton listeners; every instance shares the
  // module controller, so Stop/retry/done work no matter which mounted
  // component initiated the run.
  useEffect(() => {
    ensureStreamListeners();
  }, []);

  const sendMessage = useCallback(
    async (text: string, opts: SendOptions = {}): Promise<string | null> => {
      if (!opts.agentId) {
        log.error('stream', 'sendMessage called without agentId');
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
      useChatStore.getState().pushMessage(userMsg);
      useChatStore.getState().pushMessage(assistantMsg);
      useChatStore.getState().setStreaming(true);
      // Fresh run — clear any prior interruption banner and reset recovery state.
      useChatStore.getState().setStreamInterruption(null);

      const runId = newId('run');
      runIdRef.current = runId;
      targetIdRef.current = assistantMsg.id;
      requestIdRef.current = null;
      eventCountRef.current = 0;
      lastSendRef.current = { input: text, opts };
      // Synchronous — before ANY await — so callers can subscribe their
      // runId-filtered listeners with zero gap for STREAM_OPENED to slip by.
      opts.onRunId?.(runId);
      // Drop any queued resume — a fresh send supersedes it. (If a resume
      // was queued from a previous turn and the user typed a new message
      // before the previous stream's `done` fired, the new send is the
      // user's intent; honoring the queued resume would race two runs.)
      pendingContinueRef.current = null;
      watchdogRef.current?.start();

      // A new conversation must name its organization explicitly. The same
      // bootstrap works for bearer users and fingerprint guests; the server is
      // the authority because a guest's personal organization is not visible
      // through this client's anonymous Supabase session.
      let organizationId: string;
      try {
        organizationId = await requireRequestOrganizationId();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error('stream', 'conversation organization bootstrap failed', err);
        watchdogRef.current?.stop();
        useChatStore
          .getState()
          .appendAssistantText(assistantMsg.id, `\n\n_Error:_ ${message} Please try again.`);
        useChatStore.getState().finalizeAssistant(assistantMsg.id);
        useChatStore.getState().setStreaming(false);
        runIdRef.current = null;
        targetIdRef.current = null;
        opts.onStartFailed?.(err instanceof Error ? err : new Error(message));
        return null;
      }

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
        log.info('stream', `pre-send page refresh: ${decision.action} (${decision.reason})`);
      } catch (err) {
        log.warn('stream', 'pre-send page refresh failed', err);
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
      // Highlights the user attached via the Highlight tab (sticky until they
      // clear the tray). Fetched once per send so the agent sees the exact
      // captured text + references. Skipped entirely when none are attached.
      const attachedHighlights = await resolveAttachedHighlights();
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
          conversationId: useChatStore.getState().selectedConversationId,
          highlights: attachedHighlights,
        });
        log.info('stream', `built context (${Object.keys(context).length} keys)`, {
          keys: Object.keys(context).sort(),
        });
      } catch (err) {
        log.warn('stream', 'buildChatContext failed; sending without context', err);
      }

      // Read once at send time so the latched mode follows the run, even if the
      // user toggles the chip mid-stream.
      const permissionMode = useChatStore.getState().getPermissionMode(opts.agentId);

      // Resolve the user's bound compute target (sandbox or local PC) into
      // the full sandbox-binding payload aidream's agent loop already
      // consumes. Best-effort: a stale ref / expired token / offline tunnel
      // returns null and the chat send proceeds without a binding (the agent
      // falls back to aidream's multi-tenant filesystem). See
      // src/lib/compute/use-compute-targets.ts::resolveComputeTarget.
      const boundTarget = useChatStore.getState().boundComputeTarget;
      let sandboxBinding: Awaited<
        ReturnType<typeof import('@/lib/compute/use-compute-targets').resolveComputeTarget>
      > | null = null;
      if (boundTarget) {
        const { resolveComputeTarget } = await import('@/lib/compute/use-compute-targets');
        sandboxBinding = await resolveComputeTarget(boundTarget);
        if (!sandboxBinding) {
          log.warn(
            'stream',
            `bound compute target unavailable (kind=${boundTarget.kind}, id=${boundTarget.id}) — agent will run unbound`,
          );
        }
      }

      // Build the browser-dom capability state. The server-side discovery
      // handler reads this to decide which tool category to load.
      // `loaded_categories` is the per-conversation hint — once cross-request
      // tool persistence ships server-side, the handler can use it to
      // short-circuit re-discovery.
      // conversation_id is REQUIRED on every start request — the client mints
      // it. Turn 1 has none yet, so we mint here and adopt it immediately
      // (rather than waiting for STREAM_OPENED to hand one back), which also
      // means several in-flight sends can never be confused for each other.
      const existingConversationId = opts.conversationId ?? null;
      const conversationId = existingConversationId ?? crypto.randomUUID();
      const isNewConversation = existingConversationId === null;
      if (isNewConversation) {
        useChatStore.getState().adoptConversationId(conversationId);
      }
      const loadedCategories = useActiveToolsStore.getState().getLoaded(conversationId);
      const surface = opts.surface ?? 'assistant';
      // Reuse the active tab from above and lift `page_lang` out of the
      // freshly-built context's page_brief so the browser-dom builder
      // doesn't re-query Chrome OR re-fetch the page lang. Both payloads
      // now reference the same Tab and same lang.
      const briefLang = (context.page_brief as { lang?: string | null } | undefined)?.lang ?? null;
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
        opts.assignedTabId !== undefined ? opts.assignedTabId : browserDomState.current_tab_id;

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
        organization_id: organizationId,
        user_input: text,
        conversation_id: conversationId,
        is_new: isNewConversation,
        variables: opts.variables ?? null,
        context,
        stream: true,
        store: true,
        source_app: 'matrx-extend',
        source_feature: opts.sourceFeature ?? 'chat',
        ...adminOverrides,
        ...(configOverrides ? { config_overrides: configOverrides } : {}),
        // New capability envelope. Replaces the old `client_tools` field.
        // The server's `browser-dom` capability brings `load_chrome_tools`
        // online; the model calls it with a category to pull the matching
        // tool schemas in via `ctx.queue_tool_changes(...)`. Smaller surface
        // every turn, full coverage on demand.
        client: {
          capabilities: ['browser-dom'],
          state: {
            'browser-dom': browserDomState as unknown as Record<string, unknown>,
          },
        },
        // Compute-target binding for this turn. The server reads this into
        // ctx.metadata['active_sandbox'] before resolve_and_arm_run runs,
        // which arms the sandbox-fs capability and routes fs/shell/git tool
        // calls into the target (EC2 container OR the user's PC via
        // aidream's reverse-proxy + matrx-local's /sandbox/* routes).
        ...(sandboxBinding ? { sandbox: sandboxBinding } : {}),
      };

      // Latch the tab the agent will operate on for the entire run.
      // `browserDomState.current_tab_id` mirrors the single `activeTab`
      // we resolved at the top of this send — same Tab on the dispatcher
      // gate, in `context.page_brief`, and in `client.state["browser-dom"]`.
      // Passing it through STREAM_START is what the SW dispatcher uses
      // to pin every tool call in this turn — so the user can switch
      // tabs mid-execution without dragging `read_page`/`click`/`screenshot`
      // along.
      // Fire-and-forget with a guarded failure path. Two reasons NOT to
      // await this to completion:
      //   1. The SW's STREAM_START handler only responds after the offscreen
      //      doc has finished the ENTIRE SSE — awaiting it here parked
      //      callers (the agenda runner) until the run was already over,
      //      which is what broke every scheduled run (audit P0-6).
      //   2. The promise also rejects when the SW is reaped MID-stream
      //      ("message port closed") even though the stream itself is alive
      //      in the offscreen doc — chunks arrive via broadcast, not this
      //      port. Only a rejection BEFORE the first chunk means the run
      //      genuinely failed to start (offscreen creation / handler crash);
      //      that case used to leave a 75s stuck spinner (audit follow-up).
      void send(CHANNELS.STREAM_START, {
        runId,
        endpoint: opts.mandateKey
          ? mandateExecutePath(opts.mandateKey)
          : agentTargetExecutePath(opts.agentId),
        body,
        parser: 'rich-events' as const,
        agentName: opts.agentName ?? null,
        permissionMode,
        assignedTabId: effectiveAssignedTabId,
      }).catch((err) => {
        const stillThisRun = runIdRef.current === runId;
        const sawAnyEvent = eventCountRef.current > 0;
        if (!stillThisRun || sawAnyEvent) return; // benign port death mid-stream
        log.error('stream', `STREAM_START failed for ${runId}`, err);
        watchdogRef.current?.stop();
        useChatStore.getState().setProviderRetry(null);
        if (targetIdRef.current) useChatStore.getState().finalizeAssistant(targetIdRef.current);
        useChatStore.getState().setStreaming(false);
        useChatStore.getState().setStreamInterruption({
          runId,
          reason: 'error',
          lastInput: text,
          at: Date.now(),
        });
        // Synthesize the terminal chunk for OTHER contexts (the SW clears
        // its live-stream marker off this), and tell the same-context caller
        // directly — broadcast doesn't loop back to the sender's context.
        broadcast(CHANNELS.STREAM_CHUNK, {
          runId,
          type: 'error',
          payload: { message: `stream failed to start: ${(err as Error)?.message ?? err}` },
        });
        broadcast(CHANNELS.STREAM_CHUNK, { runId, type: 'done', payload: {} });
        opts.onStartFailed?.(err as Error);
      });
      return runId;
    },
    [],
  );

  const cancel = useCallback(async () => {
    if (!runIdRef.current) return;
    watchdogRef.current?.stop();
    useChatStore.getState().setProviderRetry(null);
    // Cancelling the user's run means the user wants OUT — discard any
    // queued resume so we don't snap back into the conversation a moment
    // later. The server will see the cancel + the outstanding tool call;
    // a re-send by the user re-arms a new run cleanly.
    pendingContinueRef.current = null;
    await send(CHANNELS.STREAM_CANCEL, { runId: runIdRef.current });
    if (targetIdRef.current) useChatStore.getState().finalizeAssistant(targetIdRef.current);
    useChatStore.getState().setStreaming(false);
    useChatStore.getState().setStreamInterruption(null);
    runIdRef.current = null;
    targetIdRef.current = null;
  }, []);

  /**
   * Open a fresh stream against `/ai/conversations/{id}/resume` to continue
   * an agent loop that hard-suspended after delegating a client tool. Fired
   * by the STREAM_CONTINUE subscription below when the SW relays the
   * `continuation_needed=true` flag from a POST /tool_results response.
   *
   * Mirrors `sendMessage()` minus the user-input pieces (no new user bubble,
   * no `text` to ship, no context refresh — the server reconstructs the
   * conversation from the DB). A fresh assistant bubble + runId is allocated
   * so the existing STREAM_CHUNK consumer routes the continuation into a new
   * message; the previous bubble was already finalized when the suspended
   * stream ended. See features/agents/docs/CLIENT_TOOL_SUSPEND_RESUME.md
   * (matrx-frontend repo) for the full protocol.
   */
  const resumeRun = useCallback(
    async (conversationId: string, userRequestId: string | null): Promise<string | null> => {
      // Ignore continuations for conversations the user isn't looking at —
      // runIdRef holds at most one run, and re-pointing it to a different
      // conversation would race the active run and steer its chunks into the
      // wrong bubble. The conversation stays answerable on the server; if the
      // user navigates back later, manual retry / a new send re-opens it. A
      // per-conversation run map would lift this constraint — out of scope for v1.
      const selectedId = useChatStore.getState().selectedConversationId;
      if (selectedId !== conversationId) {
        log.info(
          'stream',
          `STREAM_CONTINUE ignored — conversation ${conversationId} not selected (selected=${selectedId})`,
        );
        return null;
      }
      // Exactly one hook instance may own this continuation — see
      // claimResume's docstring. Must come BEFORE any state mutation
      // (including pendingContinueRef queueing) so losers are pure no-ops.
      // When the server no longer reports a user_request_id (conversation-
      // keyed resume, 2026-07-23), claim per-conversation instead.
      const claimKey = userRequestId ?? `conv:${conversationId}`;
      if (!claimResume(claimKey, instanceIdRef.current)) {
        log.info(
          'stream',
          `STREAM_CONTINUE ignored — another hook instance owns the resume for ${claimKey}`,
        );
        return null;
      }
      // Defensive: only resume from a fully idle hook state. A live run for
      // some other reason (the inline-waiter path still streamed under us, or
      // a previous resume hasn't ended) means continuation_needed shouldn't
      // have been true server-side, but skip rather than race.
      //
      // Important nuance — the original stream's `done` chunk may not have
      // landed yet, even though the server hard-suspended already. When a
      // fast client tool (one that didn't need user input) completes in the
      // same animation frame as the suspend, the SW broadcasts
      // STREAM_CONTINUE before the offscreen→sidepanel `done` chunk arrives.
      // We can't just bail — that drops the resume on the floor and the
      // conversation stalls. Instead, queue the continue; the STREAM_CHUNK
      // `done` handler will drain it as soon as the previous run finalizes.
      if (runIdRef.current) {
        log.info('stream', 'STREAM_CONTINUE queued — previous run still finalizing', {
          activeRunId: runIdRef.current,
          conversationId,
        });
        pendingContinueRef.current = { conversationId, userRequestId };
        return null;
      }

      const assistantMsg: ChatMessage = {
        id: newId('asst'),
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        pending: true,
      };
      useChatStore.getState().pushMessage(assistantMsg);
      useChatStore.getState().setStreaming(true);
      useChatStore.getState().setStreamInterruption(null);

      const runId = newId('run');
      runIdRef.current = runId;
      targetIdRef.current = assistantMsg.id;
      requestIdRef.current = null;
      eventCountRef.current = 0;
      // lastSendRef intentionally NOT overwritten — Retry should still
      // replay the user's actual last input, not a synthetic resume body.
      watchdogRef.current?.start();
      // Arm the retryable-409 recovery state for THIS attempt. attempts
      // carries over across retries of the same user_request so the loop
      // is bounded; a different request starts fresh.
      resumeRetryRef.current = {
        conversationId,
        userRequestId,
        runId,
        attempts:
          resumeRetryRef.current?.userRequestId === userRequestId
            ? resumeRetryRef.current.attempts
            : 0,
      };

      // Mirror sendMessage's capability envelope so the resumed loop's tools
      // resolve identically. The server's discovery handler reads
      // client.state["browser-dom"] to load tool categories; reconstructing
      // it from a fresh activeTab keeps the resumed loop pointed at the
      // user's CURRENT page state (and not a stale snapshot from the
      // pre-suspend turn).
      const activeTab = await resolveActiveTab();
      const loadedCategories = useActiveToolsStore.getState().getLoaded(conversationId);
      const browserDomState = await buildBrowserDomState({
        surface: 'assistant',
        loadedCategories,
        activeTab,
        pageLang: null,
      });

      // Rebuild the deferred-context bundle for the resumed loop. A
      // suspended run's context objects lived only in the original
      // request's scope — without re-sending them, ctx_get answered
      // "No context objects are available" on every resumed turn and the
      // agent lost page_brief etc. mid-conversation. Same builder as
      // sendMessage (minus the pre-send page refresh — the resume should
      // open fast; the cached capture is current enough).
      let context: Record<string, unknown> = {};
      try {
        const user = useAuthStore.getState().user;
        const desktop = useDesktopStore.getState();
        const manualScrape = useScrapeStore.getState().current;
        const autoScrape = useAutoScrapeStore.getState().current;
        context = await buildChatContext({
          user: user ? { id: user.id, email: user.email, full_name: user.full_name ?? null } : null,
          desktopTransport: desktop.transport,
          scrape: manualScrape,
          autoScrape,
          activeTab,
          conversationId,
          highlights: null,
        });
      } catch (err) {
        log.warn('stream', 'buildChatContext failed for resume; resuming without context', err);
      }

      const body: Record<string, unknown> = {
        context,
        client: {
          capabilities: ['browser-dom'],
          state: {
            'browser-dom': browserDomState as unknown as Record<string, unknown>,
          },
        },
      };
      // The resume is keyed by the conversation id in the URL. Send
      // user_request_id only when we actually have one (still supported and
      // exact); otherwise omit it and let the server resolve the turn from
      // the newest answered client-delegated call (2026-07-23 contract).
      if (typeof userRequestId === 'string' && userRequestId.length > 0) {
        body.user_request_id = userRequestId;
      }

      await send(CHANNELS.STREAM_START, {
        runId,
        endpoint: conversationResumePath(conversationId),
        body,
        parser: 'rich-events' as const,
        agentName: null,
        permissionMode: useChatStore.getState().getPermissionMode(null),
        assignedTabId: browserDomState.current_tab_id,
      });
      log.info('stream', `resume started for ${conversationId}`, { runId, userRequestId });
      return runId;
    },
    [],
  );
  // Keep the late-binding ref in sync so the STREAM_CHUNK `done` handler can
  // drain a queued STREAM_CONTINUE without dependency-array gymnastics.
  resumeRunRef.current = resumeRun;

  // SW → sidepanel: a POST /tool_results came back with
  // continuation_needed=true. The SW broadcasts {conversationId, userRequestId};
  // we open a fresh /resume stream. The aidream backend's hard-suspend
  // (_suspend_for_delegation) means the original stream is GONE the moment a
  // client tool gets delegated — without this, the user submits an answer and
  // nothing happens. See matrx-frontend/features/agents/docs/CLIENT_TOOL_SUSPEND_RESUME.md.

  // Re-send the interrupted turn. Until backend resume ships, recovery is a
  // replay of the last user input (a fresh turn), which clears the banner.
  const retry = useCallback(async (): Promise<string | null> => {
    const last = lastSendRef.current;
    useChatStore.getState().setStreamInterruption(null);
    if (!last) return null;
    return sendMessage(last.input, last.opts);
  }, [sendMessage]);

  // Interrupt the running turn and immediately redirect with a new message —
  // the "stop & send" affordance. Server-managed (docs/TURN_BOUNDARY_INBOX.md,
  // SERVER_NEEDS_turn_boundary_inbox.md #6): aborting the stream makes the
  // server persist the partial assistant turn + an auto "[interrupted]" marker;
  // the fresh run then loads that history and answers the redirect. Distinct
  // from the inbox, which waits for the turn boundary on the SAME run.
  const interruptAndSend = useCallback(
    async (input: string, opts: SendOptions = {}): Promise<string | null> => {
      // 1. Abort the current stream. `cancel()` awaits the SW's STREAM_CANCEL
      //    ack (→ STREAM_KILL → fetch abort), so the server sees the disconnect
      //    and captures the partial assistant turn.
      await cancel();
      // 2. Brief grace period so the server flushes that partial turn (with its
      //    interrupted-marker) BEFORE the new run loads history. There's no
      //    synchronous /interrupt endpoint yet, so the ordering is handled with
      //    a short wait (SERVER_NEEDS_turn_boundary_inbox.md #6 — "send the
      //    redirect after the aborted stream has fully closed").
      await new Promise((r) => setTimeout(r, 350));
      // 3. Send the redirect as a normal fresh run on the same conversation.
      return sendMessage(input, opts);
    },
    [cancel, sendMessage],
  );

  return { send: sendMessage, cancel, retry, interruptAndSend };
}
