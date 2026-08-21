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
import { appendReceipt, recordAuditFailure } from '@/lib/audit/log';
import { PENDING_OUTPUT, type ReceiptOrigin, buildReceipt } from '@/lib/audit/receipt';
import { readIsAdminFromStorage } from '@/lib/auth/is-admin';
import { BROWSER, isBrowserSupported } from '@/lib/browser/detect';
import { log } from '@/lib/debug/log';
import { broadcast, on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { type OptionalPermission, hasOptionalPermissions } from '@/lib/permissions/optional';
import { recordToolEvent } from '@/lib/recording/state';
import { markStreamInactive } from '@/lib/stream/active-runs';
import { getToolDescription, primeToolDescriptions } from '@/lib/tools/descriptions';
import {
  enqueueUndeliveredResult,
  listPendingConfirms,
  loadRunMeta,
  persistPendingConfirm,
  persistRunMeta,
  removePendingConfirm,
  takePendingConfirm,
  takeUndeliveredResults,
} from '@/lib/tools/dispatch-persist';
import { allToolNames, lookup as lookupTool } from '@/lib/tools/registry';
import { suggestSimilar } from '@/lib/tools/suggest';
import type {
  AnyToolHandler,
  ConfirmInitiator,
  ConfirmResponse,
  PendingConfirmRequest,
  ToolContext,
  ToolTier,
} from '@/lib/tools/types';
import { getPilotSessionSnapshotAsync } from '@/state/pilot';

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
 * Write-through mirror of a run's metadata into chrome.storage.session so an
 * MV3 SW restart mid-stream doesn't orphan in-flight tool calls (P0-4).
 * Fire-and-forget — persistence problems degrade to the old in-memory-only
 * behaviour.
 */
function mirrorRunMeta(runId: string, meta: RunMeta): void {
  void persistRunMeta(runId, {
    conversationId: meta.conversationId,
    requestId: meta.requestId,
    permissionMode: meta.permissionMode,
    agentName: meta.agentName,
    trustedHosts: [...meta.trustedThisConversation],
    assignedTabId: meta.assignedTabId,
    updatedAt: Date.now(),
  });
}

/**
 * Read-through lookup: in-memory map first, then the storage.session mirror.
 * A hit from storage re-hydrates the map so subsequent (sync) consumers see
 * it. Returns undefined only when the run genuinely isn't known — e.g. a
 * tool_delegated for a run that started before the browser session.
 */
async function getRunMeta(runId: string): Promise<RunMeta | undefined> {
  const inMemory = runs.get(runId);
  if (inMemory) return inMemory;
  const stored = await loadRunMeta(runId);
  if (!stored) return undefined;
  const revived: RunMeta = {
    conversationId: stored.conversationId,
    requestId: stored.requestId,
    permissionMode: stored.permissionMode,
    agentName: stored.agentName,
    trustedThisConversation: new Set(stored.trustedHosts),
    assignedTabId: stored.assignedTabId,
  };
  // Another async path may have hydrated while we awaited — keep theirs.
  const raced = runs.get(runId);
  if (raced) return raced;
  runs.set(runId, revived);
  log.info('sw', `run meta for ${runId} rehydrated from storage.session after SW restart`);
  return revived;
}

/**
 * Latch run metadata BEFORE the SSE opens. Called from the SW's STREAM_START
 * handler so the dispatcher has the assigned tab, permission mode, and
 * agent name ready by the time the first `tool_delegated` event arrives.
 * Idempotent — the runs map is keyed by runId; STREAM_OPENED merges
 * `conversation_id` and `request_id` into the same row a moment later.
 *
 * Why this exists: the permission mode (ask/act) was previously seeded
 * only from STREAM_OPENED. If the offscreen broadcast that as the very
 * first chunk arrived BEFORE the SW's STREAM_OPENED handler ran (Chrome's
 * `chrome.runtime.sendMessage` delivery to one extension context is FIFO
 * per-sender but the SW receives both broadcasts as separate handler
 * invocations — `tool_delegated` on STREAM_CHUNK could be processed first
 * since its handler is async while STREAM_OPENED's is sync), the run
 * would default to 'ask' even when the user had explicitly enabled 'act',
 * silently downgrading the experience. Both signals come from the same
 * STREAM_START payload, so seeding them together at STREAM_START is the
 * race-proof fix.
 */
export function recordAssignedTab(
  runId: string,
  assignedTabId: number | null,
  opts: { permissionMode?: 'ask' | 'act'; agentName?: string | null } = {},
): void {
  const existing = runs.get(runId);
  if (existing) {
    existing.assignedTabId = assignedTabId;
    if (opts.permissionMode) existing.permissionMode = opts.permissionMode;
    if (opts.agentName !== undefined) existing.agentName = opts.agentName;
    mirrorRunMeta(runId, existing);
    return;
  }
  // STREAM_OPENED hasn't landed yet — seed the row so it isn't lost.
  const seeded: RunMeta = {
    conversationId: null,
    requestId: null,
    permissionMode: opts.permissionMode ?? 'ask',
    agentName: opts.agentName ?? null,
    trustedThisConversation: new Set<string>(),
    assignedTabId,
  };
  runs.set(runId, seeded);
  mirrorRunMeta(runId, seeded);
}

interface DispatchOptions {
  defaultPermissionMode: () => 'ask' | 'act';
}

/**
 * Payload for COLD_RESUME_CALL — the sidepanel re-dispatching a persisted
 * client-delegated call when a paused conversation is reopened. There is no
 * live stream, so the sidepanel supplies everything the SW would otherwise have
 * latched at STREAM_START (permission mode, the current active tab).
 */
interface ColdResumeCallPayload {
  conversationId: string;
  userRequestId: string | null;
  callId: string;
  toolName: string;
  args: unknown;
  permissionMode: 'ask' | 'act';
  assignedTabId: number | null;
}

/**
 * Single-flight guard for STREAM_CONTINUE broadcasts, keyed by
 * user_request_id. The server's continuation_needed flag is best-effort:
 * when the model issued PARALLEL delegated calls, the concurrent
 * POST /tool_results responses can BOTH carry continuation_needed=true,
 * and two broadcasts used to race two /resume streams onto the same
 * conversation (duplicate positions, repeated identical tool calls —
 * the 2026-06-09 incident). The server now 409s the loser, but there's
 * no reason to even attempt the duplicate.
 *
 * Entries clear on the next STREAM_OPENED for that user_request_id (the
 * resume actually started — the NEXT legitimate continuation for this
 * request must broadcast again) and age out after a TTL so a resume
 * that never opened (sidepanel closed, conversation not selected)
 * can't suppress recovery forever.
 */
const CONTINUE_SUPPRESS_TTL_MS = 10_000;
const recentContinueBroadcasts = new Map<string, number>();

/**
 * Duplicate-delivery guard for `tool_delegated` events. The server can
 * retransmit a delegation (stream retry, the parallel-continuation race
 * documented above), and before this guard each duplicate spawned an
 * independent `handleCall` — a DOUBLE EXECUTION for mutating tools, and a
 * single user "Allow" click resolved every pending confirm sharing the
 * callId. Keyed by `${runId}:${callId}`; bounded FIFO so a long-lived SW
 * can't grow it forever (Set iteration order = insertion order).
 */
const DISPATCHED_CALLS_MAX = 500;
const dispatchedCalls = new Set<string>();

/** Returns true exactly once per (runId, callId); false for replays. */
function markDispatched(runId: string, callId: string): boolean {
  const key = `${runId}:${callId}`;
  if (dispatchedCalls.has(key)) return false;
  dispatchedCalls.add(key);
  if (dispatchedCalls.size > DISPATCHED_CALLS_MAX) {
    const oldest = dispatchedCalls.values().next().value;
    if (oldest !== undefined) dispatchedCalls.delete(oldest);
  }
  return true;
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
    const merged: RunMeta = {
      conversationId: payload.conversationId,
      requestId: payload.requestId,
      permissionMode: payload.permissionMode ?? opts.defaultPermissionMode(),
      agentName: payload.agentName ?? null,
      trustedThisConversation: prior?.trustedThisConversation ?? new Set<string>(),
      assignedTabId: prior?.assignedTabId ?? null,
    };
    runs.set(payload.runId, merged);
    mirrorRunMeta(payload.runId, merged);
    // A run actually opened for this user_request — re-arm the
    // continuation single-flight guard so its NEXT suspend can broadcast.
    // Also clear the conversation-keyed fallback entry (used when the
    // server reported no user_request_id).
    if (payload.requestId) recentContinueBroadcasts.delete(payload.requestId);
    recentContinueBroadcasts.delete(`conv:${payload.conversationId}`);
    log.info('sw', `tool dispatcher tracking run=${payload.runId}`, payload);
    return { ack: true };
  });

  // Confirm recovery across SW restarts (P0-5). The per-call listener inside
  // `requestConfirmation` is an in-memory Promise — when Chrome reaps the SW
  // during the approval window, the sidepanel card survives but the listener
  // is gone, and the user's Allow click used to vanish (run stuck forever).
  // This global listener catches responses for persisted-but-not-live calls:
  // the click itself wakes the SW, bootstrap registers us synchronously, and
  // we re-execute (or fail-close) from the storage.session record.
  on<ConfirmResponse, { ack: true }>(CHANNELS.TOOL_CONFIRM_RESPONSE, (payload) => {
    if (liveConfirmWaiters.has(payload.callId)) return { ack: true };
    void recoverPersistedConfirm(payload).catch((err) =>
      log.error('sw', `confirm recovery failed for ${payload.callId}`, err),
    );
    return { ack: true };
  });
  // Fail-close any confirms whose approval window closed while no SW was
  // alive to fire the timeout. Best-effort; runs on every boot.
  void sweepExpiredConfirms().catch((err) =>
    log.warn('sw', 'sweepExpiredConfirms failed', (err as Error)?.message),
  );
  // Re-deliver tool results whose POST exhausted its retries in a previous
  // SW lifetime (audit P1-4). Idempotent server-side via already_resolved.
  void drainUndeliveredResults().catch((err) =>
    log.warn('sw', 'drainUndeliveredResults failed', (err as Error)?.message),
  );

  // Watch every stream chunk for tool_delegated events. We deliberately
  // ignore `tool_started` — the server emits that for tools it executes
  // itself too (ctx_*, MCP, etc.), and resolving those against our local
  // registry produces noisy "not registered" errors in the conversation log.
  // `tool_delegated` is the server's explicit "this one is yours" signal.
  on<{ runId: string; type: string; payload: unknown }, { ack: true }>(
    CHANNELS.STREAM_CHUNK,
    async (chunk) => {
      // Terminal chunk → the offscreen fetch for this run is finished; clear
      // its live-stream marker so closeStaleOffscreenOnBoot is free to act.
      if (chunk.type === 'done') {
        void markStreamInactive(chunk.runId);
        return { ack: true };
      }
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

      // Duplicate-delivery guard — a retransmitted tool_delegated for a
      // call we already dispatched must not run the handler a second time.
      if (!markDispatched(chunk.runId, callId)) {
        log.warn('sw', `duplicate tool_delegated suppressed`, {
          runId: chunk.runId,
          callId,
          tool: wireName,
        });
        return { ack: true };
      }

      const handler = lookupTool(wireName);
      const resolvedName = wireName;

      // Read-through: survives SW restarts mid-stream (P0-4). Without the
      // storage fallback, a reaped-and-rewoken SW saw an empty map here —
      // null conversationId (result never POSTed, agent hung), permission
      // mode silently downgraded to 'ask', assigned tab lost.
      const meta = await getRunMeta(chunk.runId);
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
          ? ` Did you mean: ${suggestions.join(', ')}? Or call list_chrome_categories to see what's available.`
          : ' Call list_chrome_categories to see what is available.';
        log.warn('sw', `tool '${wireName}' not in registry`, { suggestions });
        void postUnknownToolError(ctx, wireName, hint).catch((err) =>
          log.error('sw', `failed to post unknown-tool error for ${wireName}`, err),
        );
        return { ack: true };
      }

      // Fire-and-forget — do not block the chunk listener on this. The
      // .catch() below is the LAST line of defense against a silent stuck
      // conversation. handleCall has its own try/catch around handler.run
      // and a structured `fail` path for every validation gate, but an
      // exception leaking out of the gates themselves (e.g. an async
      // permission probe throwing) would otherwise vanish into a console
      // log with no result POSTed back. Send an error to the model so it
      // knows the tool failed and can move on.
      void handleCall(handler, toolArgs, ctx, meta).catch(async (err) => {
        const message = (err as Error)?.message ?? String(err);
        log.error('sw', `tool dispatch crashed for ${resolvedName}`, err);
        try {
          const delivery = await postResult(
            handler,
            ctx,
            null,
            true,
            `Tool dispatch crashed: ${message}`,
          );
          if (delivery.delivered) {
            broadcast(CHANNELS.TOOL_TIMELINE_EVENT, {
              callId: ctx.callId,
              conversationId: ctx.conversationId,
              toolName: handler.name,
              phase: 'error',
              message: `Tool dispatch crashed: ${message}`,
            });
          }
          broadcastContinuation(delivery.continuation);
        } catch (postErr) {
          log.error(
            'sw',
            `failed to surface dispatch crash for ${resolvedName} — tool call may be stuck`,
            postErr,
          );
        }
      });
      return { ack: true };
    },
  );

  // COLD-RESUME: the sidepanel re-dispatches a persisted client-delegated call
  // when a paused conversation is reopened (the user closed the tab mid-prompt
  // and came back — minutes, hours, or weeks later). There is no live
  // stream/runId, so we synthesize run metadata from the payload and feed the
  // call through the SAME handleCall path as a live tool_delegated event: the
  // confirmation card, the handler, postResult, and the continuation handshake
  // (→ STREAM_CONTINUE → resumeRun) all behave identically. See
  // src/lib/chat/cold-resume.ts and docs/COLD_RESUME.md.
  on<ColdResumeCallPayload, { ack: true }>(CHANNELS.COLD_RESUME_CALL, (p) => {
    const callId = String(p.callId ?? '');
    const wireName = String(p.toolName ?? '');
    if (!callId || !wireName) return { ack: true };

    // Synthetic run scoped to the suspended turn — stable so a second
    // cold-resume pass for the same call (a remount, a second open) is deduped
    // by markDispatched instead of spawning a duplicate handleCall.
    const runId = `coldresume:${p.userRequestId ?? p.conversationId}`;
    if (!markDispatched(runId, callId)) {
      log.info('sw', 'cold-resume duplicate suppressed', { runId, callId, tool: wireName });
      return { ack: true };
    }

    const permissionMode: 'ask' | 'act' = p.permissionMode === 'act' ? 'act' : 'ask';
    const meta: RunMeta = {
      conversationId: p.conversationId,
      requestId: p.userRequestId ?? null,
      permissionMode,
      agentName: null,
      trustedThisConversation: new Set<string>(),
      assignedTabId: p.assignedTabId ?? null,
    };
    runs.set(runId, meta);
    mirrorRunMeta(runId, meta);

    const ctx: ToolContext = {
      conversationId: p.conversationId,
      runId,
      callId,
      agentName: null,
      permissionMode,
      assignedTabId: p.assignedTabId ?? null,
    };

    const handler = lookupTool(wireName);
    if (!handler) {
      const suggestions = suggestSimilar(wireName, allToolNames({ isAdmin: true }));
      const hint = suggestions.length
        ? ` Did you mean: ${suggestions.join(', ')}? Or call list_chrome_categories to see what's available.`
        : ' Call list_chrome_categories to see what is available.';
      log.warn('sw', `cold-resume tool '${wireName}' not in registry`, { suggestions });
      void postUnknownToolError(ctx, wireName, hint).catch((err) =>
        log.error('sw', `failed to post cold-resume unknown-tool error for ${wireName}`, err),
      );
      return { ack: true };
    }

    void handleCall(handler, p.args, ctx, meta).catch(async (err) => {
      const message = (err as Error)?.message ?? String(err);
      log.error('sw', `cold-resume dispatch crashed for ${wireName}`, err);
      try {
        const delivery = await postResult(
          handler,
          ctx,
          null,
          true,
          `Tool dispatch crashed: ${message}`,
        );
        if (delivery.delivered) {
          broadcast(CHANNELS.TOOL_TIMELINE_EVENT, {
            callId: ctx.callId,
            conversationId: ctx.conversationId,
            toolName: handler.name,
            phase: 'error',
            message: `Tool dispatch crashed: ${message}`,
          });
        }
        broadcastContinuation(delivery.continuation);
      } catch (postErr) {
        log.error('sw', `failed to surface cold-resume crash for ${wireName}`, postErr);
      }
    });
    return { ack: true };
  });
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
  ctx: ToolContext,
  parsedArgs: unknown,
  effectiveTier: ToolTier,
): Promise<string | null> {
  const session = await getPilotSessionSnapshotAsync();
  if (!session.active || session.groupId == null) return null;
  // The dispatcher resolves `tierFor(parsedArgs)` before calling us, so a
  // mega-tool router's read-only sub-action passes while its mutating
  // sub-actions are checked — and a hypothetical read-catalog router with a
  // mutating sub-action is still caught.
  if (effectiveTier === 'read' || effectiveTier === 'ask-user') return null;
  // Tabs can be targeted two ways: the run's pinned `assignedTabId`, and an
  // explicit `tab_id` / `tab_ids` argument (CDP tools, the `tabs` router,
  // execute_javascript, …). Before 2026-06-10 only the former was checked,
  // so an explicit out-of-group tab_id sailed through the sandbox — see
  // docs/AUDIT_2026_06_10.md P1-7. Validate every candidate.
  const candidates = new Set<number>();
  if (ctx.assignedTabId != null) candidates.add(ctx.assignedTabId);
  for (const id of extractTabIdArgs(parsedArgs)) candidates.add(id);
  // No tab targeted → tools that don't touch tabs (e.g. desktop_run_command,
  // `user`) shouldn't be blocked by the group constraint.
  if (candidates.size === 0) return null;
  for (const tabId of candidates) {
    let tab: chrome.tabs.Tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      return `pilot_group_violation: tab ${tabId} no longer exists; the Pilot session may have closed it. Start a new session or pick another tab inside the group.`;
    }
    if (tab.groupId !== session.groupId) {
      return `pilot_group_violation: tab ${tabId} is not part of the active Pilot session group (${session.groupId}). Pilot tools may only act on tabs inside the session's tab group.`;
    }
  }
  return null;
}

/**
 * Pull explicit tab targets out of a tool's parsed args. Recognizes the two
 * arg conventions used across the registry: a scalar `tab_id` and an array
 * `tab_ids`. (parallel_for_each_tab also validates its own `tab_ids`
 * up-front to avoid spawning N children just to fail — this is the
 * defense-in-depth backstop.)
 */
function extractTabIdArgs(args: unknown): number[] {
  if (!args || typeof args !== 'object') return [];
  const a = args as Record<string, unknown>;
  const out: number[] = [];
  if (typeof a.tab_id === 'number' && Number.isFinite(a.tab_id)) out.push(a.tab_id);
  if (Array.isArray(a.tab_ids)) {
    for (const t of a.tab_ids) {
      if (typeof t === 'number' && Number.isFinite(t)) out.push(t);
    }
  }
  return out;
}

/**
 * Resolve a conversation_id for a fire-and-forget POST, waiting briefly for
 * STREAM_OPENED if the run hasn't been registered yet.
 *
 * The race this guards against: aidream's `tool_delegated` event can arrive
 * before STREAM_OPENED settles into the SW's `runs` map (Chrome's message
 * delivery to the SW's two `on(...)` handlers is technically interleaved per
 * sender, but the SW handler for STREAM_OPENED is sync while STREAM_CHUNK's
 * handler is async — so a tool_event with `event=tool_delegated` can hit the
 * dispatcher with `meta` still undefined). Dropping the result here is the
 * worst failure mode — the agent waits forever and the user sees nothing.
 *
 * Returns the conversation_id once known, or null if it never arrives.
 */
async function waitForConversationId(runId: string, timeoutMs = 3000): Promise<string | null> {
  // getRunMeta also consults the storage.session mirror, so a result POSTed
  // by a freshly-rewoken SW can still find the conversation a previous SW
  // lifetime registered.
  const existing = await getRunMeta(runId);
  if (existing?.conversationId) return existing.conversationId;
  const start = Date.now();
  // Light poll — STREAM_OPENED is almost always already in flight when we
  // arrive here, so the first re-check usually returns. Capped so we never
  // block tool dispatch indefinitely.
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 50));
    const m = runs.get(runId);
    if (m?.conversationId) return m.conversationId;
  }
  return null;
}

async function postUnknownToolError(
  ctx: ToolContext,
  toolName: string,
  hint: string,
): Promise<void> {
  let conversationId = ctx.conversationId;
  if (!conversationId) {
    conversationId = await waitForConversationId(ctx.runId);
  }
  if (!conversationId) {
    log.error(
      'sw',
      `unknown-tool error for '${toolName}' could not be posted — no conversation_id resolved for runId=${ctx.runId}`,
    );
    // Still surface the failure to the UI so the user knows the agent is stuck.
    broadcast(CHANNELS.TOOL_TIMELINE_EVENT, {
      callId: ctx.callId,
      conversationId: ctx.conversationId,
      toolName,
      phase: 'error',
      message: `Tool '${toolName}' is not registered and the conversation could not be reached. The agent loop may be stuck — try sending another message.`,
    });
    return;
  }
  const message = `Tool '${toolName}' is not registered in this extension.${hint}`;
  await postToolResults(conversationId, [
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
    conversationId: ctx.conversationId,
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
  gateOpts: {
    /**
     * The user already clicked Allow for this exact call (post-SW-restart
     * confirm recovery). Every validation gate still runs — only the
     * confirmation prompt is skipped, since re-prompting for an approval the
     * user just gave would be hostile.
     */
    preApproved?: boolean;
  } = {},
): Promise<void> {
  const startedAt = Date.now();
  log.info('sw', `tool ${handler.name} call_id=${ctx.callId}`, rawArgs);
  broadcast(CHANNELS.TOOL_TIMELINE_EVENT, {
    callId: ctx.callId,
    conversationId: ctx.conversationId,
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
  const origin: ReceiptOrigin = await detectOrigin(ctx);

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

  // Admin gate — enforced at EXECUTION time, not just advertisement time.
  // Advertisement filtering (`visible()` in registry.ts + the server-side
  // discovery handler reading the self-reported `is_admin`) decides what the
  // model SEES; this gate decides what actually RUNS. Without it, a server
  // bug / stale toolset / confused agent delegating an admin tool to a
  // non-admin would execute it — the client both computed and self-reported
  // its own admin status with no local backstop. Fail-closed: storage errors
  // read as not-admin. See docs/AUDIT_2026_06_10.md P0-2.
  if (handler.admin_only) {
    const isAdmin = await readIsAdminFromStorage();
    if (!isAdmin) {
      return fail(
        `admin_only: tool '${handler.name}' is restricted to admin accounts and cannot run for this user.`,
      );
    }
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

  // Effective tier — mega-tool routers (computer, tabs, …) declare a
  // `tierFor(args)` so a `screenshot` sub-action can be 'read' while
  // `left_click` stays 'action' under the same tool name. Resolved BEFORE
  // the pilot gate so both the sandbox and the confirm card see the tier
  // of THIS call, not the catalog default.
  const effectiveTier = handler.tierFor ? handler.tierFor(parsed.data as never) : handler.tier;

  // Pilot group sandbox (roadmap item #9). When a Pilot session is active
  // every action-tier (or privileged) tool MUST target a tab that lives
  // inside the session's tab group. The Pilot surface advertises the full
  // read+action+ask kit; without this gate, an action call from a Pilot
  // run could mutate the user's unrelated work tabs.
  //
  // Read-tier tools are allowed everywhere — they don't mutate state, and
  // restricting them would block introspection (e.g. the agent reading a
  // reference page outside the group to inform an action inside it).
  const pilotErr = await enforcePilotGroupScope(ctx, parsed.data, effectiveTier);
  if (pilotErr) {
    return fail(pilotErr);
  }

  // Permission gate.
  const needsConfirm =
    effectiveTier === 'privileged' || (effectiveTier === 'action' && ctx.permissionMode === 'ask');
  if (needsConfirm && !gateOpts.preApproved) {
    const allowed = await requestConfirmation(handler, parsed.data, ctx, meta, {
      effectiveTier,
      initiator: 'agent',
    });
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
      conversationId: ctx.conversationId,
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

  const delivery = await postResult(handler, ctx, result, false, null, Date.now() - startedAt);
  // postResult emits a terminal delivery error itself. Never overwrite that
  // with `completed`: doing so both lies to the user and can resume the model
  // while the original row is still spinning in another assistant bubble.
  if (!delivery.delivered) {
    void emitCompletedReceipt(handler.name, rawArgs, result, false, ctx, startedAt, origin);
    broadcastContinuation(delivery.continuation);
    return;
  }
  broadcast(CHANNELS.TOOL_TIMELINE_EVENT, {
    callId: ctx.callId,
    conversationId: ctx.conversationId,
    toolName: handler.name,
    phase: 'completed',
    output: result,
  });
  // Roadmap item #8 — completed receipt. Fire-and-forget; signing
  // problems get logged but never block the response.
  void emitCompletedReceipt(handler.name, rawArgs, result, true, ctx, startedAt, origin);
  // The terminal UI event must be delivered locally before the sidepanel is
  // told to allocate the continuation bubble. broadcast() self-delivers
  // synchronously, so this ordering closes the approval/resume race.
  broadcastContinuation(delivery.continuation);
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
  const delivery = await postResult(
    handler,
    ctx,
    null,
    true,
    message,
    startedAt !== undefined ? Date.now() - startedAt : null,
  );
  // Roadmap item #8 — receipt for the failed call. Only emitted when we
  // have the original args + startedAt (i.e. the in-handleCall path).
  // The unknown-tool error path doesn't reach this function.
  if (startedAt !== undefined) {
    void emitCompletedReceipt(handler.name, rawArgs, null, false, ctx, startedAt, origin);
  }
  if (delivery.delivered) {
    broadcast(CHANNELS.TOOL_TIMELINE_EVENT, {
      callId: ctx.callId,
      conversationId: ctx.conversationId,
      toolName: handler.name,
      phase: 'error',
      message,
    });
  }
  broadcastContinuation(delivery.continuation);
}

interface ContinuationSignal {
  conversationId: string;
  userRequestId: string | null;
}

interface PostResultOutcome {
  /** True only when the server accepted (or had already accepted) this call id. */
  delivered: boolean;
  /** Deferred so the caller can broadcast its terminal timeline event first. */
  continuation: ContinuationSignal | null;
}

async function postResult(
  handler: AnyToolHandler,
  ctx: ToolContext,
  output: unknown,
  isError = false,
  errorMessage: string | null = null,
  durationMs: number | null = null,
): Promise<PostResultOutcome> {
  // The agent has been working hard — the absolute worst outcome here is
  // dropping the result. If STREAM_OPENED hasn't registered the run yet
  // (it raced with the tool_delegated event), give it a beat before we
  // give up. See `waitForConversationId` for the failure-mode rationale.
  let conversationId = ctx.conversationId;
  if (!conversationId) {
    conversationId = await waitForConversationId(ctx.runId);
  }
  if (!conversationId) {
    log.error(
      'sw',
      `cannot POST tool_results for ${handler.name} — no conversation_id resolved for runId=${ctx.runId}`,
    );
    broadcast(CHANNELS.TOOL_TIMELINE_EVENT, {
      callId: ctx.callId,
      conversationId: ctx.conversationId,
      toolName: handler.name,
      phase: 'error',
      message: `The agent's loop could not be reached. Your tool result wasn't delivered. Try sending another message to recover.`,
    });
    return { delivered: false, continuation: null };
  }
  const r = await postToolResults(conversationId, [
    {
      call_id: ctx.callId,
      tool_name: handler.name,
      output,
      is_error: isError,
      error_message: errorMessage,
      ...(durationMs !== null && { duration_ms: durationMs }),
    },
  ]);

  // Failure path — make the user aware. After exhausting retries (5xx /
  // network), or on a hard 4xx, the agent loop is stuck and the user needs to
  // see SOMETHING. Surface a timeline error rather than letting the spinner
  // run forever.
  if (!r.ok) {
    log.error('sw', `tool_results POST failed permanently for ${handler.name}`, {
      status: r.status,
      error: r.error,
    });
    // Replay-class failures (network down, 5xx, timeout) get persisted for
    // the boot drain (audit P1-4) — the server hard-suspended the turn
    // waiting for this call_id, so dropping it stranded the conversation
    // until the user manually sent another message. Hard 4xx (the server
    // doesn't know the call) is NOT replayable.
    if (r.status === 0 || r.status === 408 || r.status === 429 || r.status >= 500) {
      void enqueueUndeliveredResult({
        conversationId,
        result: {
          call_id: ctx.callId,
          tool_name: handler.name,
          output,
          is_error: isError,
          error_message: errorMessage,
          ...(durationMs !== null && { duration_ms: durationMs }),
        },
      });
    }
    // 404 specifically means the server doesn't know this call_id — the
    // server-side race (since fixed) used to cause this. Provide a hint
    // the user can act on instead of a generic spinner.
    const hint =
      r.status === 404
        ? 'The conversation looks out of sync with the server. Try sending another message to recover.'
        : r.status === 0
          ? 'Network error reaching the AI server. Check your connection and try again.'
          : `The AI server returned an error (${r.status}). The agent loop may be stuck.`;
    broadcast(CHANNELS.TOOL_TIMELINE_EVENT, {
      callId: ctx.callId,
      conversationId: ctx.conversationId,
      toolName: handler.name,
      phase: 'error',
      message: hint,
    });
    return { delivered: false, continuation: null };
  }

  // Track the not_found responses too — partial success returns 200 but the
  // call_id we just posted didn't land. Surface it.
  const callNotFound =
    Array.isArray(r.data.not_found) && r.data.not_found.includes(ctx.callId);
  if (callNotFound) {
    log.warn(
      'sw',
      `tool_results 200 but call_id ${ctx.callId} was not_found — server doesn't know this call`,
      r.data,
    );
    broadcast(CHANNELS.TOOL_TIMELINE_EVENT, {
      callId: ctx.callId,
      conversationId: ctx.conversationId,
      toolName: handler.name,
      phase: 'error',
      message:
        'The server did not recognize this tool call. The conversation may be out of sync — try sending another message.',
    });
    // Continue evaluating continuation_needed: other parallel calls may have
    // resolved even though this one did not.
  }

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
  if (r.data.continuation_needed) {
    // user_request_id may be null (conversation-keyed resume, 2026-07-23) —
    // the broadcast must still fire; suppression falls back to the
    // conversation id as its single-flight key.
    const userRequestId = r.data.user_request_id ?? null;
    const suppressKey = userRequestId ?? `conv:${conversationId}`;
    const prev = recentContinueBroadcasts.get(suppressKey);
    if (prev && Date.now() - prev < CONTINUE_SUPPRESS_TTL_MS) {
      log.info(
        'sw',
        `continuation_needed duplicate suppressed for ${conversationId} (key ${suppressKey} already broadcast ${Date.now() - prev}ms ago)`,
      );
      return { delivered: !callNotFound, continuation: null };
    }
    recentContinueBroadcasts.set(suppressKey, Date.now());
    return {
      delivered: !callNotFound,
      continuation: { conversationId, userRequestId },
    };
  }
  return { delivered: !callNotFound, continuation: null };
}

/** Broadcast a continuation only after the caller has emitted its terminal row. */
function broadcastContinuation(signal: ContinuationSignal | null): void {
  if (!signal) return;
  log.info('sw', `continuation_needed → broadcast STREAM_CONTINUE for ${signal.conversationId}`, {
    userRequestId: signal.userRequestId,
  });
  broadcast(CHANNELS.STREAM_CONTINUE, signal);
}

interface ConfirmResult {
  allow: boolean;
  reason?: string | undefined;
}

/**
 * callIds whose confirm Promise is alive in THIS SW lifetime. The global
 * recovery listener (post-restart path) ignores these — the per-call
 * listener inside `requestConfirmation` owns them.
 */
const liveConfirmWaiters = new Set<string>();

function requestConfirmation(
  handler: AnyToolHandler,
  args: unknown,
  ctx: ToolContext,
  meta: RunMeta | undefined,
  opts: { effectiveTier: ToolTier; initiator: ConfirmInitiator },
): Promise<ConfirmResult> {
  // Auto-allow if user has trusted this domain for the conversation.
  // (Domain trust is opportunistic — only meaningful if args has a `url`.)
  //
  // NEVER for privileged calls: "privileged always confirms, even in Act
  // mode" is the contract (types.ts ToolTier docs), and the approval card
  // deliberately hides the remember-checkbox for privileged tools — but the
  // trust set is shared per-conversation across tiers, so an action-tier
  // approval on host X used to silently auto-allow a LATER privileged call
  // carrying the same host (e.g. chrome_cookies set). The trust shortcut is
  // also agent-path only: external initiators (page / frontend / desktop)
  // must always face the card. See docs/AUDIT_2026_06_10.md P1-24.
  const url =
    typeof (args as { url?: unknown })?.url === 'string'
      ? ((args as { url?: string }).url as string)
      : null;
  if (url && meta && opts.effectiveTier !== 'privileged' && opts.initiator === 'agent') {
    try {
      const host = new URL(url).host;
      if (meta.trustedThisConversation.has(host)) {
        return Promise.resolve({ allow: true });
      }
    } catch {
      /* not a URL we can parse, fall through */
    }
  }

  // Durability (P0-5): persist the request so a user click can still be
  // honored after the SW that broadcast the card has been reaped. The 5-min
  // in-memory timer dies with the SW; `expiresAt` lets the recovery path
  // fail-close stale requests instead of leaving them answerable forever.
  const expiresAt = Date.now() + 5 * 60_000;
  liveConfirmWaiters.add(ctx.callId);
  void persistPendingConfirm({
    callId: ctx.callId,
    toolName: handler.name,
    args,
    conversationId: ctx.conversationId,
    runId: ctx.runId,
    agentName: ctx.agentName,
    permissionMode: ctx.permissionMode,
    assignedTabId: ctx.assignedTabId,
    effectiveTier: opts.effectiveTier,
    initiator: opts.initiator,
    expiresAt,
  });

  return new Promise<ConfirmResult>((resolve) => {
    let resolved = false;
    const finish = (out: ConfirmResult) => {
      if (resolved) return;
      resolved = true;
      off();
      clearTimeout(timer);
      liveConfirmWaiters.delete(ctx.callId);
      void removePendingConfirm(ctx.callId);
      resolve(out);
    };
    const off = on<ConfirmResponse, { ack: true }>(CHANNELS.TOOL_CONFIRM_RESPONSE, (payload) => {
      if (payload.callId !== ctx.callId) return { ack: true };
      if (payload.decision === 'allow' && payload.rememberFor === 'conversation' && url && meta) {
        try {
          meta.trustedThisConversation.add(new URL(url).host);
          mirrorRunMeta(ctx.runId, meta);
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
    const timer = setTimeout(() => {
      // Tell the sidepanel to drop the card — before this, the card lingered
      // after the timeout and a late click broadcast into the void (P2-4).
      broadcast(CHANNELS.TOOL_CONFIRM_EXPIRED, {
        callId: ctx.callId,
        reason: 'Approval timed out',
      });
      finish({ allow: false, reason: 'Approval timed out' });
    }, 5 * 60_000);

    const req: PendingConfirmRequest = {
      callId: ctx.callId,
      conversationId: ctx.conversationId,
      toolName: handler.name,
      // Live from the DB (tool_def), never hardcoded — undefined until the
      // cache warms, in which case the card falls back to name + args. (Rule 4.)
      description: getToolDescription(handler.name),
      args,
      // The tier of THIS call (tierFor-resolved) so a privileged sub-action
      // of an action-catalog router renders its privileged badge.
      tier: opts.effectiveTier,
      initiator: opts.initiator,
    };
    broadcast(CHANNELS.TOOL_CONFIRM_REQUEST, req);
  });
}

/**
 * Post-restart path for a confirm response whose original waiter died with a
 * previous SW lifetime. Claims the persisted record atomically (so a double
 * click can't double-execute), reconstructs the call context, and either
 * re-enters `handleCall` with the prompt skipped or fails the call closed.
 */
async function recoverPersistedConfirm(payload: ConfirmResponse): Promise<void> {
  const rec = await takePendingConfirm(payload.callId);
  if (!rec) return; // never persisted, or already claimed — nothing to do
  const handler = lookupTool(rec.toolName);
  const ctx: ToolContext = {
    conversationId: rec.conversationId,
    runId: rec.runId,
    callId: rec.callId,
    agentName: rec.agentName,
    permissionMode: rec.permissionMode,
    assignedTabId: rec.assignedTabId,
  };
  if (!handler) {
    log.error('sw', `confirm recovery: tool '${rec.toolName}' no longer registered`);
    return;
  }
  if (Date.now() > rec.expiresAt) {
    broadcast(CHANNELS.TOOL_CONFIRM_EXPIRED, {
      callId: rec.callId,
      reason: 'Approval timed out',
    });
    await finishWithError(handler, ctx, 'Approval timed out');
    return;
  }
  if (payload.decision !== 'allow') {
    await finishWithError(handler, ctx, 'User denied this action');
    return;
  }
  log.info(
    'sw',
    `confirm recovery: executing ${rec.toolName} (call ${rec.callId}) approved across an SW restart`,
  );
  const meta = await getRunMeta(rec.runId);
  if (payload.rememberFor === 'conversation' && meta) {
    const url = (rec.args as { url?: unknown })?.url;
    if (typeof url === 'string') {
      try {
        meta.trustedThisConversation.add(new URL(url).host);
        mirrorRunMeta(rec.runId, meta);
      } catch {
        /* not a parseable URL */
      }
    }
  }
  await handleCall(handler, rec.args, ctx, meta, { preApproved: true });
}

/**
 * Fail-close persisted confirms whose 5-minute window elapsed with no SW
 * alive to fire the in-memory timeout. Clears the sidepanel card and posts
 * the timeout error so the agent loop unsticks.
 */
async function sweepExpiredConfirms(): Promise<void> {
  const all = await listPendingConfirms();
  const now = Date.now();
  for (const rec of all) {
    if (now <= rec.expiresAt) continue; // still answerable — recovery listener owns it
    const claimed = await takePendingConfirm(rec.callId);
    if (!claimed) continue; // raced with a response — fine
    broadcast(CHANNELS.TOOL_CONFIRM_EXPIRED, {
      callId: rec.callId,
      reason: 'Approval timed out',
    });
    const handler = lookupTool(rec.toolName);
    if (!handler) continue;
    const ctx: ToolContext = {
      conversationId: rec.conversationId,
      runId: rec.runId,
      callId: rec.callId,
      agentName: rec.agentName,
      permissionMode: rec.permissionMode,
      assignedTabId: rec.assignedTabId,
    };
    await finishWithError(handler, ctx, 'Approval timed out');
  }
}

/**
 * Boot-time replay of persisted undelivered tool results (audit P1-4).
 * Successes (and hard 4xx — the server doesn't know the call) drop the
 * entry; replay-class failures re-enqueue with a bumped attempt count
 * (capped + TTL'd inside dispatch-persist). A successful replay that the
 * server flags continuation_needed re-broadcasts STREAM_CONTINUE through
 * the same single-flight suppression the live path uses.
 */
async function drainUndeliveredResults(): Promise<void> {
  const pending = await takeUndeliveredResults();
  for (const entry of pending) {
    const r = await postToolResults(entry.conversationId, [entry.result]);
    if (!r.ok) {
      if (r.status === 0 || r.status === 408 || r.status === 429 || r.status >= 500) {
        void enqueueUndeliveredResult({
          conversationId: entry.conversationId,
          result: entry.result,
        });
      }
      continue;
    }
    log.info(
      'sw',
      `replayed undelivered tool result ${entry.result.call_id} for ${entry.conversationId}`,
    );
    if (r.data.continuation_needed) {
      // Same null-tolerant keying as the live path above.
      const userRequestId = r.data.user_request_id ?? null;
      const suppressKey = userRequestId ?? `conv:${entry.conversationId}`;
      const prev = recentContinueBroadcasts.get(suppressKey);
      if (prev && Date.now() - prev < CONTINUE_SUPPRESS_TTL_MS) continue;
      recentContinueBroadcasts.set(suppressKey, Date.now());
      broadcast(CHANNELS.STREAM_CONTINUE, {
        conversationId: entry.conversationId,
        userRequestId,
      });
    }
  }
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
 * Handle an EXTERNAL tool call — a WebMCP page bridge, the aimatrx.com
 * frontend RPC, or the matrx-local desktop engine's reverse invoke. Looks up
 * the registered handler, validates args, runs it through the permission
 * gates, and returns a structured response.
 *
 * Restrictions vs. the streaming dispatcher (this path is STRICTER — the
 * caller is not the user's own agent):
 *   - Only `read` and `action` tier tools are callable. `ask-user` /
 *     `privileged` are refused with a structured error, since the external
 *     caller has no UX surface for the inline approval cards.
 *   - `admin_only` tools require the cached admin flag — the page can't
 *     bypass advertisement filtering by posting the tool name directly.
 *   - Action-tier calls ALWAYS require user confirmation, regardless of the
 *     user's ask/act permission mode. Act-mode is the user's grant to their
 *     OWN agent, not to arbitrary external callers — without this, any
 *     allow-listed page could silently drive navigate/click/type/download
 *     the moment the user prefers Act mode. The card labels the initiator.
 *     If no sidepanel is open, the confirmation times out (fail-closed)
 *     after 5 minutes, matching the dispatcher behaviour.
 */
export async function handleWebmcpCall(
  payload: WebmcpCallPayload,
  opts: { permissionMode: 'ask' | 'act'; initiator?: ConfirmInitiator },
): Promise<WebmcpCallResponse> {
  const { callId, toolName, args } = payload;
  const initiator: ConfirmInitiator = opts.initiator ?? 'page';
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

  // Execution-time admin gate. Advertisement filtering on
  // `navigator.modelContext` only controls what the page is TOLD about; a
  // hostile page can post any registered tool name directly. Same
  // fail-closed source of truth as the streaming dispatcher's gate.
  if (handler.admin_only) {
    const isAdmin = await readIsAdminFromStorage();
    if (!isAdmin) {
      return {
        ok: false,
        error: `webmcp: tool '${toolName}' is admin-only and cannot be invoked externally for this user`,
      };
    }
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

  // External action calls ALWAYS confirm — the user's act-mode preference
  // applies to their own agent, never to a page/frontend/desktop caller.
  const effectiveTier = handler.tierFor ? handler.tierFor(parsed.data as never) : handler.tier;
  if (effectiveTier === 'action') {
    const allowed = await requestConfirmation(handler, parsed.data, ctx, undefined, {
      effectiveTier,
      initiator,
    });
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
      conversationId: ctx.conversationId,
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
      conversationId: ctx.conversationId,
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
    void recordAuditFailure();
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
    void recordAuditFailure();
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
async function detectOrigin(ctx: ToolContext): Promise<ReceiptOrigin> {
  if (ctx.runId.startsWith('parrun-')) return 'parallel';
  const pilot = await getPilotSessionSnapshotAsync();
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
