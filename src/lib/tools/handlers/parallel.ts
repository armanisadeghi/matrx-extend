/**
 * `parallel_for_each_tab` — fan out the same sub-prompt across N tabs and
 * collect the results. Implements CLAUDE.md roadmap item #6 (cross-tab
 * parallel orchestration).
 *
 * How it works:
 *   1. Validate every `tab_ids[i]` actually exists. Fast-fail with a
 *      structured error listing the unknown ids.
 *   2. For each tab, spawn a child agent stream via the same offscreen
 *      STREAM_RUN path the parent chat uses. Each child:
 *        - has its own runId + (server-assigned) conversationId
 *        - is pinned to its tab via `recordAssignedTab` BEFORE the stream
 *          opens, so the dispatcher routes any nested tool calls to the
 *          correct tab
 *        - inherits the parent run's permission mode
 *   3. Subscribe to STREAM_CHUNK with the sub-runId filter, accumulate
 *      assistant text + `data` events, capture errors, end on `done`.
 *   4. Apply a per-sub-run wall-clock timeout; on expiry, abort the stream
 *      via STREAM_KILL and mark that sub-run timed out — but DO NOT cancel
 *      the others (Promise.allSettled, not Promise.all).
 *   5. Aggregate using the chosen merge strategy and return.
 *
 * Tier: action (it spawns LLM work). Admin-only initially per the
 * "experimental → admin first, then GA" convention in CLAUDE.md.
 *
 * Hard cap: 8 sub-runs. More than that is a footgun on the user's account
 * (cost), the offscreen doc (bandwidth), and the user's display (cognitive
 * load). Future work: lift to user-configurable.
 */

import { DEFAULT_CHAT_MANDATE_REF } from '@/lib/mandates';
import { getApiBaseUrl } from '@/lib/api/client';
import { agentTargetExecutePath } from '@/lib/api/routes/ai';
import { requireRequestOrganizationId } from '@/lib/api/routes/auth';
import { getAccessToken } from '@/lib/auth/flow';
import { log } from '@/lib/debug/log';
import { newId } from '@/lib/id';
import { broadcast, on, send } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { ensureOffscreen } from '@/lib/stream/offscreen-proxy';
import { recordAssignedTab } from '@/lib/tools/dispatch';
import { buildParallelStartContract } from '@/lib/tools/handlers/parallel-start-contract';
import type { ToolContext, ToolHandler } from '@/lib/tools/types';
import {
  type ParallelSession,
  type ParallelSubRun,
  type ParallelSubRunStatus,
  useParallelRunsStore,
} from '@/state/parallel-runs';
import { getPilotSessionSnapshotAsync } from '@/state/pilot';
import { useSettingsStore } from '@/state/settings';
import { z } from 'zod';

const MAX_TABS = 8;

const ParallelArgs = z.object({
  /**
   * Tabs to fan out across. Each must currently exist (will be validated
   * against `chrome.tabs.get`). Hard-capped at 8 entries; larger arrays are
   * rejected before any LLM call is made.
   */
  tab_ids: z.array(z.number().int().nonnegative()).min(1).max(MAX_TABS),
  /** Prompt sent to every sub-run as the user message. */
  sub_prompt: z.string().min(1),
  /**
   * Agent id for sub-runs. When omitted, falls back to the user's Default
   * Agent setting and then to the default-chat Mandate. Pass it only when the parent agent knows it needs a
   * specialized sub-agent (e.g. a vision-only model for screenshot
   * comparison).
   *
   * An explicit id is the run-scope layer; the omitted case resolves the
   * Mandate inside aidream.
   */
  agent_id: z.string().optional(),
  /**
   * Per-sub-run wall-clock timeout. Default 60s. Hard ceiling 120s — longer
   * than that and the offscreen doc starts losing its MV3 keepalive guarantee.
   */
  timeout_ms: z.number().int().min(1000).max(120_000).optional().default(60_000),
  /**
   * How to combine results.
   *   - per_tab    → array of `{ tab_id, ok, response | error }` (default;
   *                  most general, lets the parent agent keep tabs separate)
   *   - concat     → single string with `## Tab <id>` headers (best when
   *                  the parent will summarize across)
   *   - json_array → flatten every sub-run's `data` events into one JSON
   *                  array (best when the sub-prompt produces structured
   *                  output via `update_plan`-like data events)
   */
  merge_strategy: z.enum(['per_tab', 'concat', 'json_array']).optional().default('per_tab'),
});

type ParallelArgs = z.infer<typeof ParallelArgs>;

interface SubRunOutcome {
  tabId: number;
  runId: string;
  ok: boolean;
  status: ParallelSubRunStatus;
  text: string;
  conversationId: string | null;
  dataEvents: Array<Record<string, unknown>>;
  error: string | null;
}

interface ParallelEventBroadcast {
  /** Parent tool call id (one per orchestration). */
  parentCallId: string;
  /** Discriminator for the panel reducer. */
  kind:
    | 'session_started'
    | 'subrun_started'
    | 'subrun_opened'
    | 'subrun_text'
    | 'subrun_data'
    | 'subrun_completed'
    | 'subrun_error'
    | 'subrun_timeout'
    | 'session_finished';
  /** Payload carried with the event. */
  payload: Record<string, unknown>;
}

function emit(event: ParallelEventBroadcast): void {
  broadcast(CHANNELS.PARALLEL_RUN_EVENT, event);
}

interface RunChildArgs {
  parentCallId: string;
  parentRunId: string;
  parentCtx: ToolContext;
  tab: chrome.tabs.Tab;
  agentId: string;
  subPrompt: string;
  timeoutMs: number;
  baseUrl: string;
  authHeader: string | null;
  organizationId: string;
}

async function runChild(args: RunChildArgs): Promise<SubRunOutcome> {
  const subRunId = newId('parrun');
  const tabId = args.tab.id ?? -1;

  const subRun: ParallelSubRun = {
    runId: subRunId,
    tabId,
    tabUrl: args.tab.url ?? null,
    tabTitle: args.tab.title ?? null,
    conversationId: null,
    status: 'pending',
    text: '',
    error: null,
    dataEvents: [],
    startedAt: Date.now(),
    endedAt: null,
  };
  // Seed the sub-run row in the session — patchSubRun is a no-op when the
  // row doesn't exist yet, so write into the session's subRuns map directly.
  {
    const store = useParallelRunsStore.getState();
    const existing = store.sessions[args.parentCallId];
    if (existing && !existing.subRuns[subRunId]) {
      store.upsertSession({
        ...existing,
        subRuns: { ...existing.subRuns, [subRunId]: subRun },
      });
    }
  }
  emit({
    parentCallId: args.parentCallId,
    kind: 'subrun_started',
    payload: { ...subRun },
  });

  // Pin the tab BEFORE STREAM_RUN so the dispatcher has the tabId latched
  // for any tool_event the child emits.
  recordAssignedTab(subRunId, tabId);

  // Build child-request body. We deliberately keep `context` empty — the
  // server's load_chrome_tools discovery handler is what drives this
  // sub-run's tool surface, and `client.state["browser-dom"]` carries the
  // assigned tab. Sending the full parent context would be misleading
  // (it's about the parent's tab, not this sub-run's).
  const browserDomState = {
    current_url: args.tab.url ?? null,
    current_tab_id: tabId,
    current_window_id: args.tab.windowId ?? null,
    page_title: args.tab.title ?? null,
    page_lang: null,
    tab_status:
      args.tab.status === 'loading' || args.tab.status === 'complete' ? args.tab.status : null,
    surface: 'assistant' as const,
    is_admin: false, // sub-runs never claim admin — defense-in-depth
    permission_mode: args.parentCtx.permissionMode,
    desktop_bridge: 'none' as const,
    onbox_ai_available: false,
    optional_permissions_granted: [] as string[],
    open_tab_count: null,
    extension_version: chrome.runtime.getManifest().version,
    extension_id: chrome.runtime.id,
    loaded_categories: [] as string[],
    /** Marker so server-side telemetry can identify sub-runs. */
    parallel_parent_run_id: args.parentRunId,
    parallel_parent_call_id: args.parentCallId,
  };

  const body: Record<string, unknown> = {
    ...buildParallelStartContract(args.organizationId),
    user_input: args.subPrompt,
    variables: null,
    context: {},
    stream: true,
    source_app: 'matrx-extend',
    source_feature: 'parallel-tab',
    client: {
      capabilities: ['browser-dom'],
      state: { 'browser-dom': browserDomState },
    },
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    // Organization admission: this lane bypasses offscreen-proxy's
    // startStream (it dispatches STREAM_RUN itself), so it must attach the
    // header the server requires on every authenticated request — the org in
    // the body alone is refused at the top of the stack.
    'X-Organization-Id': args.organizationId,
  };
  if (args.authHeader) headers.Authorization = args.authHeader;

  await ensureOffscreen();

  // Subscribe to STREAM_OPENED + STREAM_CHUNK with sub-runId filter. We
  // start subscribing BEFORE sending STREAM_RUN to avoid races on very
  // fast first events.
  return new Promise<SubRunOutcome>((resolve) => {
    let resolved = false;
    let conversationId: string | null = null;
    let collectedText = '';
    const dataEvents: Array<Record<string, unknown>> = [];
    let errorMessage: string | null = null;

    const finalize = (status: ParallelSubRunStatus, error: string | null) => {
      if (resolved) return;
      resolved = true;
      offOpened();
      offChunk();
      clearTimeout(timer);
      const endedAt = Date.now();
      useParallelRunsStore.getState().patchSubRun(args.parentCallId, subRunId, {
        status,
        text: collectedText,
        error,
        conversationId,
        dataEvents,
        endedAt,
      });
      emit({
        parentCallId: args.parentCallId,
        kind:
          status === 'completed'
            ? 'subrun_completed'
            : status === 'timeout'
              ? 'subrun_timeout'
              : 'subrun_error',
        payload: {
          runId: subRunId,
          tabId,
          conversationId,
          text: collectedText,
          error,
          dataEvents,
          endedAt,
        },
      });
      if (status === 'timeout') {
        // Best-effort cancel of the upstream SSE so we stop billing tokens.
        void send(CHANNELS.STREAM_KILL, { runId: subRunId }).catch(() => {
          /* offscreen may have already torn down */
        });
      }
      resolve({
        tabId,
        runId: subRunId,
        ok: status === 'completed',
        status,
        text: collectedText,
        conversationId,
        dataEvents,
        error,
      });
    };

    const offOpened = on<
      {
        runId: string;
        conversationId: string | null;
        requestId: string | null;
      },
      { ack: true }
    >(CHANNELS.STREAM_OPENED, (payload) => {
      if (payload.runId !== subRunId) return { ack: true };
      conversationId = payload.conversationId;
      useParallelRunsStore.getState().patchSubRun(args.parentCallId, subRunId, {
        status: 'running',
        conversationId,
      });
      emit({
        parentCallId: args.parentCallId,
        kind: 'subrun_opened',
        payload: { runId: subRunId, conversationId, tabId },
      });
      return { ack: true };
    });

    const offChunk = on<
      { runId: string; type: string; payload: Record<string, unknown> },
      { ack: true }
    >(CHANNELS.STREAM_CHUNK, (chunk) => {
      if (chunk.runId !== subRunId) return { ack: true };
      const payload = chunk.payload ?? {};
      if (chunk.type === 'text') {
        const content = String(payload.content ?? '');
        if (content) {
          collectedText += content;
          useParallelRunsStore.getState().appendSubRunText(args.parentCallId, subRunId, content);
          emit({
            parentCallId: args.parentCallId,
            kind: 'subrun_text',
            payload: { runId: subRunId, content },
          });
        }
      } else if (chunk.type === 'event') {
        const eventName = String(payload.eventName ?? '');
        const data = (payload.data ?? {}) as Record<string, unknown>;
        if (eventName === 'data') {
          // The server emits `event: data` for any structured-data event the
          // sub-agent surfaces (update_plan results, json blocks, etc).
          dataEvents.push(data);
          useParallelRunsStore.getState().pushSubRunData(args.parentCallId, subRunId, data);
          emit({
            parentCallId: args.parentCallId,
            kind: 'subrun_data',
            payload: { runId: subRunId, data },
          });
        }
        // Other events (tool_event, phase, completion) flow through the
        // dispatcher / chat surfaces normally — we don't double-handle.
      } else if (chunk.type === 'error') {
        errorMessage = String(payload.message ?? 'stream error');
      } else if (chunk.type === 'done') {
        // If we saw an error event, we still get a final `done`; treat as error.
        finalize(errorMessage ? 'error' : 'completed', errorMessage);
      }
      return { ack: true };
    });

    const timer = setTimeout(() => {
      finalize('timeout', `sub-run timed out after ${args.timeoutMs}ms`);
    }, args.timeoutMs);

    // Send STREAM_RUN. The offscreen doc accepts parallel runs natively
    // (keyed by runId in its inflight Map).
    const url = `${args.baseUrl}${agentTargetExecutePath(args.agentId)}`;
    const runPayload = {
      runId: subRunId,
      url,
      body,
      parser: 'rich-events' as const,
      headers,
      agentName: 'parallel-sub-run',
      permissionMode: args.parentCtx.permissionMode,
    };
    void send(CHANNELS.STREAM_RUN, runPayload).catch((err) => {
      const message = `STREAM_RUN dispatch failed: ${(err as Error)?.message ?? String(err)}`;
      log.error('sw', message);
      finalize('error', message);
    });
  });
}

async function validateTabs(tabIds: number[]): Promise<
  | {
      ok: true;
      tabs: Map<number, chrome.tabs.Tab>;
    }
  | {
      ok: false;
      unknown: number[];
    }
> {
  const tabs = new Map<number, chrome.tabs.Tab>();
  const unknown: number[] = [];
  await Promise.all(
    tabIds.map(async (id) => {
      try {
        const t = await chrome.tabs.get(id);
        tabs.set(id, t);
      } catch {
        unknown.push(id);
      }
    }),
  );
  if (unknown.length) return { ok: false, unknown };
  return { ok: true, tabs };
}

function buildPerTabResult(outcomes: SubRunOutcome[]): unknown {
  return outcomes.map((o) => ({
    tab_id: o.tabId,
    ok: o.ok,
    status: o.status,
    conversation_id: o.conversationId,
    response: o.ok ? o.text : undefined,
    error: o.ok ? undefined : o.error,
    data_events: o.dataEvents.length ? o.dataEvents : undefined,
  }));
}

function buildConcatResult(outcomes: SubRunOutcome[]): string {
  return outcomes
    .map((o) => {
      const head = `## Tab ${o.tabId}${o.ok ? '' : ` (${o.status})`}`;
      const body = o.ok ? o.text : `_error:_ ${o.error ?? 'unknown error'}`;
      return `${head}\n\n${body.trim()}`;
    })
    .join('\n\n---\n\n');
}

function buildJsonArrayResult(outcomes: SubRunOutcome[]): unknown[] {
  // One object per sub-run. `data` is the array of structured events; if
  // there were none, we surface the assistant text as a single `text`
  // entry so callers downstream see *something* per tab.
  return outcomes.map((o) => ({
    tab_id: o.tabId,
    ok: o.ok,
    data: o.dataEvents.length > 0 ? o.dataEvents : o.ok ? [{ text: o.text }] : [],
    error: o.ok ? undefined : o.error,
  }));
}

export const parallel_for_each_tab: ToolHandler<ParallelArgs, unknown> = {
  name: 'parallel_for_each_tab',
  tier: 'action',
  admin_only: true,
  argsSchema: ParallelArgs,
  run: async (args, ctx) => {
    log.info('sw', `parallel_for_each_tab → ${args.tab_ids.length} tabs`);

    // 1. Validate tabs.
    const tabsCheck = await validateTabs(args.tab_ids);
    if (!tabsCheck.ok) {
      return {
        ok: false,
        error: `unknown tab id(s): ${tabsCheck.unknown.join(', ')}. Call list_open_tabs to find valid ids.`,
      };
    }

    // 1b. Pilot group scoping (CLAUDE.md item #9). When a Pilot session is
    //     active, every requested tab must live inside the session's tab
    //     group. Otherwise the parent surface is the Assistant Chat, which
    //     can fan out across the user's tabs freely. Failing here keeps
    //     all sub-runs constrained to the sandbox without touching the
    //     dispatcher (each sub-run also carries `recordAssignedTab` for
    //     its tab id, which the dispatcher's pilot gate would catch — but
    //     refusing up front avoids spawning N child agents only to have
    //     each one fail mid-call).
    const pilot = await getPilotSessionSnapshotAsync();
    if (pilot.active && pilot.groupId != null) {
      const outside: number[] = [];
      for (const id of args.tab_ids) {
        const tab = tabsCheck.tabs.get(id);
        if (!tab || tab.groupId !== pilot.groupId) outside.push(id);
      }
      if (outside.length) {
        return {
          ok: false,
          error: `pilot_group_violation: tab(s) ${outside.join(', ')} are not part of the active Pilot session group (${pilot.groupId}). Pass only tab ids that belong to the Pilot tab group.`,
        };
      }
    }

    // 2. Resolve agent id + auth. An explicit `agent_id` argument is the
    //    run-scope choice; otherwise honor the user's Default Agent setting,
    //    then the server-resolved default-chat Mandate.
    const agentId =
      args.agent_id ?? useSettingsStore.getState().defaultAgentId ?? DEFAULT_CHAT_MANDATE_REF;
    const baseUrl = await getApiBaseUrl();
    const token = await getAccessToken();
    const authHeader = token ? `Bearer ${token}` : null;
    if (!authHeader) {
      return {
        ok: false,
        error: 'parallel_for_each_tab requires the user to be signed in (no access token).',
      };
    }
    let organizationId: string;
    try {
      organizationId = await requireRequestOrganizationId();
    } catch (err) {
      return {
        ok: false,
        error: `parallel_for_each_tab could not initialize the workspace: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }

    // 3. Seed the panel state. The sub-runs map gets filled as each child
    //    starts.
    const session: ParallelSession = {
      parentRunId: ctx.runId,
      parentCallId: ctx.callId,
      subPrompt: args.sub_prompt,
      timeoutMs: args.timeout_ms,
      mergeStrategy: args.merge_strategy,
      startedAt: Date.now(),
      endedAt: null,
      subRuns: {},
    };
    useParallelRunsStore.getState().upsertSession(session);
    emit({
      parentCallId: ctx.callId,
      kind: 'session_started',
      payload: {
        parentRunId: ctx.runId,
        subPrompt: args.sub_prompt,
        timeoutMs: args.timeout_ms,
        mergeStrategy: args.merge_strategy,
        tabIds: args.tab_ids,
      },
    });

    // 4. Fan out. allSettled — one failing tab must not kill the rest.
    const settled = await Promise.allSettled(
      args.tab_ids.map((tabId) => {
        const tab = tabsCheck.tabs.get(tabId);
        if (!tab) {
          return Promise.resolve<SubRunOutcome>({
            tabId,
            runId: '',
            ok: false,
            status: 'error',
            text: '',
            conversationId: null,
            dataEvents: [],
            error: `tab ${tabId} disappeared between validation and dispatch`,
          });
        }
        return runChild({
          parentCallId: ctx.callId,
          parentRunId: ctx.runId,
          parentCtx: ctx,
          tab,
          agentId,
          subPrompt: args.sub_prompt,
          timeoutMs: args.timeout_ms,
          baseUrl,
          authHeader,
          organizationId,
        });
      }),
    );

    const outcomes: SubRunOutcome[] = settled.map((r, idx) => {
      if (r.status === 'fulfilled') return r.value;
      const tabId = args.tab_ids[idx] ?? -1;
      return {
        tabId,
        runId: '',
        ok: false,
        status: 'error',
        text: '',
        conversationId: null,
        dataEvents: [],
        error: (r.reason as Error)?.message ?? String(r.reason),
      };
    });

    useParallelRunsStore.getState().finishSession(ctx.callId);
    emit({
      parentCallId: ctx.callId,
      kind: 'session_finished',
      payload: {
        completed: outcomes.filter((o) => o.ok).length,
        failed: outcomes.filter((o) => !o.ok).length,
        total: outcomes.length,
      },
    });

    // 5. Merge.
    let merged: unknown;
    if (args.merge_strategy === 'concat') {
      merged = buildConcatResult(outcomes);
    } else if (args.merge_strategy === 'json_array') {
      merged = buildJsonArrayResult(outcomes);
    } else {
      merged = buildPerTabResult(outcomes);
    }

    return {
      ok: true,
      summary: {
        total: outcomes.length,
        completed: outcomes.filter((o) => o.status === 'completed').length,
        errored: outcomes.filter((o) => o.status === 'error').length,
        timed_out: outcomes.filter((o) => o.status === 'timeout').length,
        merge_strategy: args.merge_strategy,
        elapsed_ms: Date.now() - session.startedAt,
      },
      results: merged,
    };
  },
};

export const parallel_handlers = [parallel_for_each_tab];
