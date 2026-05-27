/**
 * SW-side tool dispatcher.
 *
 * Subscribes to STREAM_CHUNK broadcasts. When a chunk is a `tool_event` with
 * `event === "tool_delegated"` (the server's explicit signal that THIS client
 * should run the tool — server-side tools emit `tool_started`/`tool_completed`
 * for UI rendering only and must NOT trigger our dispatcher):
 *   1. Resolve the run's conversation_id (cached from STREAM_OPENED)
 *   2. Apply permission policy:
 *        - tier 'read'      → run immediately
 *        - tier 'action'    → in 'ask' mode, broadcast TOOL_CONFIRM_REQUEST
 *                            and wait for TOOL_CONFIRM_RESPONSE; in 'act'
 *                            mode, run immediately
 *        - tier 'ask-user'  → handler internally broadcasts TOOL_ASK_USER_REQUEST
 *        - tier 'privileged' → always confirm, regardless of mode
 *   3. Run the handler
 *   4. POST result via /conversations/{id}/tool_results
 *   5. Broadcast a TOOL_TIMELINE_EVENT so the chat UI can render started/done
 *
 * Why `tool_delegated` and not `tool_started`: the server emits `tool_started`
 * for every tool call (including ones it executes itself, MCP, ctx_*, etc.) so
 * the timeline can render. Gating on `tool_started` caused this dispatcher to
 * try to resolve every server-side tool name against the local registry and
 * post a noisy "not registered" error back to the conversation for tools we
 * were never meant to run. `tool_delegated` is the explicit "your turn" signal.
 */

import { postToolResults } from '@/lib/api/routes/tool-results';
import { appendReceipt } from '@/lib/audit/log';
import { PENDING_OUTPUT, type ReceiptOrigin, buildReceipt } from '@/lib/audit/receipt';
import { BROWSER, isBrowserSupported } from '@/lib/browser/detect';
import { log } from '@/lib/debug/log';
import { broadcast, on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { type OptionalPermission, hasOptionalPermissions } from '@/lib/permissions/optional';
import { recordToolEvent } from '@/lib/recording/state';
import { suggestSimilar } from '@/lib/tools/suggest';
import { getToolDescription, primeToolDescriptions } from '@/lib/tools/descriptions';
import { allToolNames, lookup as lookupTool } from '@/lib/tools/registry';
import type {
  AnyToolHandler,
  ConfirmResponse,
  PendingConfirmRequest,
  ToolContext,
} from '@/lib/tools/types';
import { getPilotSessionSnapshot } from '@/state/pilot';

interface RunMeta {
  conversationId: string | null;
  requestId: string | null;
  /** Permission mode for this run, latched at start. */
  permissionMode: 'ask' | 'act';
  agentName: string | null;
  /** Domains allowed for the rest of THIS conversation. */
  trustedThisConversation: Set<string>;
  /**
   * Tab the agent is pinned to for this run. Captured at message-send
   * time (sidepanel's `useChatStream`), recorded here BEFORE the SSE
   * opens so STREAM_OPENED — which can race with the first tool_event —
   * doesn't have to carry it. Null until `recordAssignedTab` is called
   * for this runId.
   */
  assignedTabId: number | null;
}

const runs = new Map<string, RunMeta>();

/**
 * Latch the assigned tab BEFORE the SSE opens. Called from the SW's
 * STREAM_START handler so the dispatcher has the tab id ready by the time
 * the first `tool_delegated` arrives. Idempotent — the runs map is keyed
 * by runId; STREAM_OPENED merges into the same row a moment later.
 */
export function recordAssignedTab(runId: string, assignedTabId: number | null): void {
  const existing = runs.get(runId);
  if (existing) {
    existing.assignedTabId = assignedTabId;
    return;
  }
  // STREAM_OPENED hasn't landed yet — seed the row so it isn't lost.
  runs.set(runId, {
    conversationId: null,
    requestId: null,
    permissionMode: 'ask',
    agentName: null,
    trustedThisConversation: new Set<string>(),
    assignedTabId,
  });
}

interface DispatchOptions {
  defaultPermissionMode: () => 'ask' | 'act';
}

let started = false;

export function startToolDispatcher(opts: DispatchOptions): void {
  if (started) return;
  started = true;
  log.info('sw', 'tool dispatcher started');

  // Warm the live tool-description cache (read from the DB; see
  // src/lib/tools/descriptions.ts) so the approval card has a description ready
  // by the first confirm. Best-effort — never blocks dispatch.
  primeToolDescriptions();

  // Cache run metadata when the stream opens.
  on<
    {
      runId: string;
      conversationId: string | null;
      requestId: string | null;
      agentName?: string | null;
      permissionMode?: 'ask' | 'act';
    },
    { ack: true }
  >(CHANNELS.STREAM_OPENED, (payload) => {
    // Preserve any assignedTabId that was latched via recordAssignedTab
    // before STREAM_OPENED arrived — its trustedThisConversation set is
    // brand-new for every run so we always start it fresh here.
    const prior = runs.get(payload.runId);
    runs.set(payload.runId, {
      conversationId: payload.conversationId,
      requestId: payload.requestId,
      permissionMode: payload.permissionMode ?? opts.defaultPermissionMode(),
      agentName: payload.agentName ?? null,
      trustedThisConversation: prior?.trustedThisConversation ?? new Set<string>(),
      assignedTabId: prior?.assignedTabId ?? null,
    });
    log.info('sw', `tool dispatcher tracking run=${payload.runId}`, payload);
    return { ack: true };
  });

  // Watch every stream chunk for tool_delegated events. We deliberately
  // ignore `tool_started` — the server emits that for tools it executes
  // itself too (ctx_*, MCP, etc.), and resolving those against our local
  // registry produces noisy "not registered" errors in the conversation log.
  // `tool_delegated` is the server's explicit "this one is yours" signal.
  on<{ runId: string; type: string; payload: unknown }, { ack: true }>(
    CHANNELS.STREAM_CHUNK,
    async (chunk) => {
      if (chunk.type !== 'event') return { ack: true };
      const evt = (chunk.payload as { eventName?: string; data?: Record<string, unknown> }) ?? {};
      if (evt.eventName !== 'tool_event') return { ack: true };
      const data = (evt.data ?? {}) as Record<string, unknown>;
      const subEvent = data.event as string | undefined;
      if (subEvent !== 'tool_delegated') return { ack: true };

      const callId = String(data.call_id ?? '');
      // Wire name = `tool_name`. Post-2026-05-27 tool refactor every
      // `tool_def.name` is a bare identifier (`take_screenshot`,
      // `read_page`, …), so the dispatcher does a direct registry lookup —
      // no prefix stripping, no alias table, no canonical_name fallback.
      // An unrecognized name is a real error (per docs/official/
      // tool_system_rules.md S10: "Crash loudly, log carefully, recover
      // never"); we surface it as a structured error to the model rather
      // than silently translating it.
      const wireName = String(data.tool_name ?? '');
      const toolArgs = ((data.data as { arguments?: unknown })?.arguments ?? {}) as unknown;
      if (!callId || !wireName) return { ack: true };

      const handler = lookupTool(wireName);
      const resolvedName = wireName;

      const meta = runs.get(chunk.runId);
      const ctx: ToolContext = {
        conversationId: meta?.conversationId ?? null,
        runId: chunk.runId,
        callId,
        agentName: meta?.agentName ?? null,
        permissionMode: meta?.permissionMode ?? 'ask',
        assignedTabId: meta?.assignedTabId ?? null,
      };

      if (!handler) {
        // Surface a structured error back to the server so the model gets a
        // useful next-turn signal. Silently passing leaves the server to
        // synthesize "Browser session not found", which the agent can't act on.
        const suggestions = suggestSimilar(wireName, allToolNames({ isAdmin: true }));
        const hint = suggestions.length
          ? ` Did you mean: ${suggestions.join(', ')}? Or call list_browser_tools to see what's available.`
          : ' Call list_browser_tools to see what is available.';
        log.warn('sw', `tool '${wireName}' not in registry`, { suggestions });
        void postUnknownToolError(ctx, wireName, hint).catch((err) =>
          log.error('sw', `failed to post unknown-tool error for ${wireName}`, err),
        );
        return { ack: true };
      }

      // Fire-and-forget — do not block the chunk listener on this.
      void handleCall(handler, toolArgs, ctx, meta).catch((err) =>
        log.error('sw', `tool dispatch crashed for ${resolvedName}`, err),
      );
      return { ack: true };
    },
  );
}

/**
 * Roadmap item #9 — Pilot group sandbox.
 *
 * When a Pilot session is active, every mutating tool call (action /
 * privileged tier) must operate on a tab inside the session's tab group.
 * This is the centralized choke point that keeps individual handlers
 * unaware of pilot mode.
 *
 * Returns null when the call is allowed; otherwise returns a remediation
 * string that the dispatcher reports back to the agent.
 *
 * Tabs in the dispatcher come in two flavours:
 *   - The handler's `assignedTabId` (set at message-send via
 *     `recordAssignedTab`). When the Pilot view sends a message it
 *     pins to one of the group's tabs, so we can verify against that.
 *   - Cross-tab orchestrators (e.g. `parallel_for_each_tab`) read
 *     their own `tab_ids` argument; they enforce the group check
 *     themselves and never reach this gate.
 *
 * Read-tier tools and ask-user tools are allowed unconditionally —
 * neither mutates state.
 */
async function enforcePilotGroupScope(
  handler: AnyToolHandler,
  ctx: ToolContext,
): Promise<string | null> {
  const session = getPilotSessionSnapshot();
  if (!session.active || session.groupId == null) return null;
  // Resolve the effective tier (mega-tool routers use tierFor on the parsed
  // args, but we don't have those here yet — fall back to the catalog tier
  // so the gate is conservative).
  if (handler.tier === 'read' || handler.tier === 'ask-user') return null;
  // No tab assigned → tools that don't touch tabs (e.g. desktop_run_command,
  // `user`) shouldn't be blocked by the group constraint. Action tools that
  // genuinely target a tab will have one set by recordAssignedTab.
  const tabId = ctx.assignedTabId;
  if (tabId == null) return null;
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return `pilot_group_violation: tab ${tabId} no longer exists; the Pilot session may have closed it. Start a new session or pick another tab inside the group.`;
  }
  if (tab.groupId !== session.groupId) {
    return `pilot_group_violation: tab ${tabId} is not part of the active Pilot session group (${session.groupId}). Pilot tools may only act on tabs inside the session's tab group.`;
  }
  return null;
}

async function postUnknownToolError(
  ctx: ToolContext,
  toolName: string,
  hint: string,
): Promise<void> {
  if (!ctx.conversationId) return;
  const message = `Tool '${toolName}' is not registered in this extension.${hint}`;
  await postToolResults(ctx.conversationId, [
    {
      call_id: ctx.callId,
      tool_name: toolName,
      output: null,
      is_error: true,
      error_message: message,
    },
  ]);
  broadcast(CHANNELS.TOOL_TIMELINE_EVENT, {
    callId: ctx.callId,
    toolName,
    phase: 'error',
    message,
  });
}

async function handleCall(
  handler: AnyToolHandler,
  rawArgs: unknown,
  ctx: ToolContext,
  meta: RunMeta | undefined,
): Promise<void> {
  const startedAt = Date.now();
  log.info('sw', `tool ${handler.name} call_id=${ctx.callId}`, rawArgs);
  broadcast(CHANNELS.TOOL_TIMELINE_EVENT, {
    callId: ctx.callId,
    toolName: handler.name,
    phase: 'started',
    args: rawArgs,
  });
  recordToolEvent(handler.name, 'started', rawArgs);

  // Roadmap item #8 — provenance tag for the receipt. Origin detection is
  // intentionally cheap and source-of-truth-driven:
  //   - parallel sub-runs use a `runId` produced by `newId('parrun')` in
  //     `src/lib/tools/handlers/parallel.ts`, which always begins with
  //     'parrun-'. Sub-run conversation_ids are server-assigned and not
  //     globally distinguishable from a human turn, so the runId prefix
  //     is the only stable signal here.
  //   - pilot calls flow through the SAME chunk listener as Assistant
  //     calls; the only stable signal is that the run's conversation
  //     matches the active Pilot session's conversationId. Note that
  //     this is captured at message send-time (Pilot's first turn) and
  //     persists across the session.
  //   - everything else is the standard agent chat.
  const origin: ReceiptOrigin = detectOrigin(ctx);

  // Roadmap item #8 — partial cryptographic receipt at start. Best-effort:
  // signing failures must not block tool execution. Fire-and-forget.
  void emitPartialReceipt(handler.name, rawArgs, ctx, startedAt, origin);

  // Local fail closure — captures rawArgs + startedAt so the completed
  // receipt covers them on every error exit. `finishWithError` itself
  // doesn't take args, so we wrap it here.
  const fail = (message: string): Promise<void> =>
    finishWithError(handler, ctx, message, rawArgs, startedAt, origin);

  // Validate args.
  const parsed = handler.argsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return fail(`args failed schema: ${JSON.stringify(parsed.error.format())}`);
  }

  // Browser-support gate. Defense-in-depth — registry filters already drop
  // unsupported tools from advertised bundles, but if a stale catalog ever
  // re-advertises (e.g. after a server-side cache lag), reject cleanly here
  // instead of crashing inside a Chrome-only API call.
  if (!isBrowserSupported(handler.supportedBrowsers)) {
    return fail(
      `tool '${handler.name}' is not supported on ${BROWSER}. Supported browsers: ${(handler.supportedBrowsers ?? []).join(', ') || 'none'}.`,
    );
  }

  // Optional-permission gate. Tools that depend on optional Chrome
  // permissions (e.g. `cookies`, `pageCapture`, `tabCapture`) declare
  // `required_optional_permissions`. The dispatcher itself can't request
  // them — `chrome.permissions.request` requires a user gesture which
  // the SW context lacks — so when the perm isn't granted yet we return
  // a structured error that GUIDES the agent to ask the user, with
  // enough detail that the next agent turn can call `user` with the
  // exact remediation. The user-facing prompt happens through that path
  // (or via the in-app toggle in Settings → Advanced), never by us
  // refusing them outright.
  if (handler.required_optional_permissions?.length) {
    const granted = await hasOptionalPermissions(
      handler.required_optional_permissions as OptionalPermission[],
    );
    if (!granted) {
      const perms = handler.required_optional_permissions.join(', ');
      return fail(
        `permission_not_yet_granted: this tool needs the optional Chrome permission(s) [${perms}]. Use user(type='confirm', ...) or user(type='notify', ...) to request the user enable it via the Advanced agent capabilities toggle, then retry. Do not give up — the user can grant the permission and the next call will succeed.`,
      );
    }
  }

  // Pilot group sandbox (roadmap item #9). When a Pilot session is active
  // every action-tier (or privileged) tool MUST target a tab that lives
  // inside the session's tab group. The Pilot surface advertises the full
  // read+action+ask kit; without this gate, an action call from a Pilot
  // run could mutate the user's unrelated work tabs.
  //
  // Read-tier tools are allowed everywhere — they don't mutate state, and
  // restricting them would block introspection (e.g. the agent reading a
  // reference page outside the group to inform an action inside it).
  const pilotErr = await enforcePilotGroupScope(handler, ctx);
  if (pilotErr) {
    return fail(pilotErr);
  }

  // Permission gate. Mega-tool routers (computer, tabs, …) declare a
  // `tierFor(args)` so a `screenshot` sub-action can be 'read' while
  // `left_click` stays 'action' under the same tool name.
  const effectiveTier = handler.tierFor ? handler.tierFor(parsed.data as never) : handler.tier;
  const needsConfirm =
    effectiveTier === 'privileged' || (effectiveTier === 'action' && ctx.permissionMode === 'ask');
  if (needsConfirm) {
    const allowed = await requestConfirmation(handler, parsed.data, ctx, meta);
    if (!allowed.allow) {
      return fail(allowed.reason ?? 'User denied this action');
    }
  }

  // Wire incremental progress emission for long-running handlers. Optional —
  // a handler that never calls `ctx.reportProgress` behaves exactly as before.
  // Each call broadcasts a TOOL_TIMELINE_EVENT carrying `progress` (phase stays
  // 'started'); the sidepanel routes it to `appendToolProgress`. Bounded by the
  // store's FIFO cap, so a chatty handler can't grow memory unboundedly.
  ctx.reportProgress = (update) => {
    const u = typeof update === 'string' ? { label: update } : update;
    broadcast(CHANNELS.TOOL_TIMELINE_EVENT, {
      callId: ctx.callId,
      toolName: handler.name,
      phase: 'started',
      progress: u,
    });
  };

  // Run.
  let result: unknown;
  try {
    result = await handler.run(parsed.data as never, ctx);
  } catch (err) {
    return fail((err as Error)?.message ?? String(err));
  }

  await postResult(handler, ctx, result);
  broadcast(CHANNELS.TOOL_TIMELINE_EVENT, {
    callId: ctx.callId,
    toolName: handler.name,
    phase: 'completed',
    output: result,
  });
  // Roadmap item #8 — completed receipt. Fire-and-forget; signing
  // problems get logged but never block the response.
  void emitCompletedReceipt(handler.name, rawArgs, result, true, ctx, startedAt, origin);
}

async function finishWithError(
  handler: AnyToolHandler,
  ctx: ToolContext,
  message: string,
  rawArgs?: unknown,
  startedAt?: number,
  origin?: ReceiptOrigin,
): Promise<void> {
  log.error('sw', `tool ${handler.name} error`, message);
  await postResult(handler, ctx, null, true, message);
  // Roadmap item #8 — receipt for the failed call. Only emitted when we
  // have the original args + startedAt (i.e. the in-handleCall path).
  // The unknown-tool error path doesn't reach this function.
  if (startedAt !== undefined) {
    void emitCompletedReceipt(handler.name, rawArgs, null, false, ctx, startedAt, origin);
  }
  broadcast(CHANNELS.TOOL_TIMELINE_EVENT, {
    callId: ctx.callId,
    toolName: handler.name,
    phase: 'error',
    message,
  });
}

async function postResult(
  handler: AnyToolHandler,
  ctx: ToolContext,
  output: unknown,
  isError = false,
  errorMessage: string | null = null,
): Promise<void> {
  if (!ctx.conversationId) {
    log.warn('sw', `cannot POST tool_results for ${handler.name} — no conversation_id yet`);
    return;
  }
  const r = await postToolResults(ctx.conversationId, [
    {
      call_id: ctx.callId,
      tool_name: handler.name,
      output,
      is_error: isError,
      error_message: errorMessage,
    },
  ]);

  // Continuation handshake. aidream's _suspend_for_delegation HARD-SUSPENDS
  // when any client-delegated tool is pending — it persists the turn, emits a
  // `complete` phase, and ends the stream. The originating SSE is therefore
  // gone by the time we POST the result here. When the live in-memory waiter
  // is GONE (the recovery path) AND no delegated calls remain outstanding,
  // the server flags `continuation_needed=true` and we MUST open a fresh
  // stream against /ai/conversations/{id}/resume — otherwise the user
  // submits an answer and nothing happens.
  //
  // The sidepanel owns the assistant-bubble lifecycle (runIdRef / targetIdRef
  // live there), so we broadcast a signal; use-chat-stream picks it up,
  // mirrors `send()` to allocate a fresh assistant bubble + runId, then
  // STREAM_STARTs against the resume path. See the canonical protocol at
  // matrx-frontend/features/agents/docs/CLIENT_TOOL_SUSPEND_RESUME.md.
  if (r.ok && r.data.continuation_needed && r.data.user_request_id) {
    log.info('sw', `continuation_needed → broadcast STREAM_CONTINUE for ${ctx.conversationId}`, {
      userRequestId: r.data.user_request_id,
    });
    broadcast(CHANNELS.STREAM_CONTINUE, {
      conversationId: ctx.conversationId,
      userRequestId: r.data.user_request_id,
    });
  }
}

interface ConfirmResult {
  allow: boolean;
  reason?: string;
}

function requestConfirmation(
  handler: AnyToolHandler,
  args: unknown,
  ctx: ToolContext,
  meta: RunMeta | undefined,
): Promise<ConfirmResult> {
  // Auto-allow if user has trusted this domain for the conversation.
  // (Domain trust is opportunistic — only meaningful if args has a `url`.)
  const url =
    typeof (args as { url?: unknown })?.url === 'string'
      ? ((args as { url?: string }).url as string)
      : null;
  if (url && meta) {
    try {
      const host = new URL(url).host;
      if (meta.trustedThisConversation.has(host)) {
        return Promise.resolve({ allow: true });
      }
    } catch {
      /* not a URL we can parse, fall through */
    }
  }

  return new Promise<ConfirmResult>((resolve) => {
    let resolved = false;
    const finish = (out: ConfirmResult) => {
      if (resolved) return;
      resolved = true;
      off();
      clearTimeout(timer);
      resolve(out);
    };
    const off = on<ConfirmResponse, { ack: true }>(CHANNELS.TOOL_CONFIRM_RESPONSE, (payload) => {
      if (payload.callId !== ctx.callId) return { ack: true };
      if (payload.decision === 'allow' && payload.rememberFor === 'conversation' && url && meta) {
        try {
          meta.trustedThisConversation.add(new URL(url).host);
        } catch {
          /* */
        }
      }
      finish({
        allow: payload.decision === 'allow',
        reason: payload.decision === 'deny' ? 'User denied this action' : undefined,
      });
      return { ack: true };
    });
    const timer = setTimeout(
      () => finish({ allow: false, reason: 'Approval timed out' }),
      5 * 60_000,
    );

    const req: PendingConfirmRequest = {
      callId: ctx.callId,
      conversationId: ctx.conversationId,
      toolName: handler.name,
      // Live from the DB (tool_def), never hardcoded — undefined until the
      // cache warms, in which case the card falls back to name + args. (Rule 4.)
      description: getToolDescription(handler.name),
      args,
      tier: handler.tier,
    };
    broadcast(CHANNELS.TOOL_CONFIRM_REQUEST, req);
  });
}

interface WebmcpCallPayload {
  callId: string;
  toolName: string;
  args: unknown;
}

interface WebmcpCallResponse {
  ok: boolean;
  result?: unknown;
  error?: string;
}

/**
 * Handle a WebMCP page → SW tool call. Looks up the registered handler,
 * validates args, runs it through the same permission gate the
 * server-driven path uses, and returns a structured response.
 *
 * Restrictions vs. the streaming dispatcher:
 *   - Only `read` and `action` tier tools are callable from a page. Other
 *     tiers (`ask-user`, `privileged`) are refused with a structured error,
 *     since the page has no UX surface for the inline approval cards.
 *   - Confirmation prompts in `ask` mode still use the same TOOL_CONFIRM
 *     channel — the chat sidepanel renders them. If no sidepanel is open,
 *     the confirmation times out after 5 minutes (matches the existing
 *     dispatcher behaviour).
 */
export async function handleWebmcpCall(
  payload: WebmcpCallPayload,
  opts: { permissionMode: 'ask' | 'act' },
): Promise<WebmcpCallResponse> {
  const { callId, toolName, args } = payload;
  if (!callId || !toolName) {
    return { ok: false, error: 'webmcp: missing callId or toolName' };
  }

  const handler = lookupTool(toolName);
  if (!handler) {
    return { ok: false, error: `webmcp: tool '${toolName}' not registered` };
  }

  if (handler.tier === 'ask-user' || handler.tier === 'privileged') {
    return {
      ok: false,
      error: `webmcp: tool '${toolName}' is ${handler.tier}-tier and not callable from a page`,
    };
  }

  const parsed = handler.argsSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      error: `webmcp: args failed schema: ${JSON.stringify(parsed.error.format())}`,
    };
  }

  if (handler.required_optional_permissions?.length) {
    const granted = await hasOptionalPermissions(
      handler.required_optional_permissions as OptionalPermission[],
    );
    if (!granted) {
      return {
        ok: false,
        error: `webmcp: tool needs optional permission(s) [${handler.required_optional_permissions.join(', ')}] — user can grant via Advanced agent capabilities`,
      };
    }
  }

  const ctx: ToolContext = {
    conversationId: null,
    runId: `webmcp-${callId}`,
    callId,
    agentName: null,
    permissionMode: opts.permissionMode,
    assignedTabId: null,
  };

  const effectiveTier = handler.tierFor ? handler.tierFor(parsed.data as never) : handler.tier;
  if (effectiveTier === 'action' && opts.permissionMode === 'ask') {
    const allowed = await requestConfirmation(handler, parsed.data, ctx, undefined);
    if (!allowed.allow) {
      return { ok: false, error: allowed.reason ?? 'User denied this action' };
    }
  }

  // Roadmap item #8 (receipt-coverage gap fix) — WebMCP calls do NOT
  // travel through the streaming dispatcher's chunk listener, so the
  // standard `emitPartialReceipt` / `emitCompletedReceipt` calls at the
  // top of `handleCall` never fire for them. Emit them here ourselves
  // so every external page-driven invocation lands in the audit log
  // with `origin: 'webmcp'` for chain-of-custody.
  const startedAt = Date.now();
  void emitPartialReceipt(handler.name, parsed.data, ctx, startedAt, 'webmcp');

  try {
    const result = await handler.run(parsed.data as never, ctx);
    broadcast(CHANNELS.TOOL_TIMELINE_EVENT, {
      callId,
      toolName: handler.name,
      phase: 'completed',
      output: result,
    });
    void emitCompletedReceipt(handler.name, parsed.data, result, true, ctx, startedAt, 'webmcp');
    return { ok: true, result };
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    log.error('sw', `webmcp ${handler.name} error`, message);
    broadcast(CHANNELS.TOOL_TIMELINE_EVENT, {
      callId,
      toolName: handler.name,
      phase: 'error',
      message,
    });
    void emitCompletedReceipt(handler.name, parsed.data, null, false, ctx, startedAt, 'webmcp');
    return { ok: false, error: message };
  }
}

/* ------------------------------------------------------------------ */
/* Cryptographic run receipts (roadmap item #8)                       */
/*                                                                    */
/* Both helpers are fire-and-forget. Signing exceptions are caught    */
/* here so the dispatcher hot path is never blocked or aborted by a   */
/* receipt-side problem. The audit log itself is also defensive (see  */
/* `appendReceipt` in `lib/audit/log.ts`).                            */
/* ------------------------------------------------------------------ */

async function emitPartialReceipt(
  toolName: string,
  rawArgs: unknown,
  ctx: ToolContext,
  startedAt: number,
  origin: ReceiptOrigin = 'agent',
): Promise<void> {
  try {
    const receipt = await buildReceipt({
      callId: ctx.callId,
      toolName,
      args: rawArgs,
      output: PENDING_OUTPUT,
      ok: null,
      startedAt,
      completedAt: null,
      conversationId: ctx.conversationId,
      runId: ctx.runId,
      origin,
    });
    await appendReceipt(receipt);
  } catch (err) {
    log.warn('sw', `audit receipt (partial) failed for ${toolName}`, err);
  }
}

async function emitCompletedReceipt(
  toolName: string,
  rawArgs: unknown,
  output: unknown,
  ok: boolean,
  ctx: ToolContext,
  startedAt: number,
  origin: ReceiptOrigin = 'agent',
): Promise<void> {
  try {
    const receipt = await buildReceipt({
      callId: ctx.callId,
      toolName,
      args: rawArgs,
      output,
      ok,
      startedAt,
      completedAt: Date.now(),
      conversationId: ctx.conversationId,
      runId: ctx.runId,
      origin,
    });
    await appendReceipt(receipt);
  } catch (err) {
    log.warn('sw', `audit receipt (completed) failed for ${toolName}`, err);
  }
}

/**
 * Decide which {@link ReceiptOrigin} tag the receipt for the current
 * call should carry.
 *
 * Detection order (first match wins):
 *   1. Run id starts with 'parrun-' → the call is a sub-run inside a
 *      `parallel_for_each_tab` fan-out. Sub-runs always come through
 *      `handleCall` (the streaming dispatcher), but the runId pattern
 *      uniquely identifies them — see `newId('parrun')` in
 *      `lib/tools/handlers/parallel.ts`.
 *   2. Pilot session is active AND its conversationId matches the
 *      current ctx.conversationId. The Pilot surface latches its
 *      conversationId on the first turn (see `usePilotChatStore`),
 *      so any subsequent tool call on the same conversation is from
 *      the Pilot agent — even when the Assistant tab is also open.
 *   3. Otherwise → 'agent' (standard streaming dispatcher).
 *
 * WebMCP calls never reach `handleCall`; their origin tag is set
 * directly inside `handleWebmcpCall`.
 */
function detectOrigin(ctx: ToolContext): ReceiptOrigin {
  if (ctx.runId.startsWith('parrun-')) return 'parallel';
  const pilot = getPilotSessionSnapshot();
  if (
    pilot.active &&
    pilot.conversationId !== null &&
    ctx.conversationId !== null &&
    pilot.conversationId === ctx.conversationId
  ) {
    return 'pilot';
  }
  return 'agent';
}
