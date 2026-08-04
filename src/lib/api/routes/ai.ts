/**
 * AI route definitions. Endpoint paths and request shapes verified against
 * `types/python-generated/openapi.json` (run `pnpm update-api-types` to refresh)
 * AND directly diffed against the live backend's `/openapi.json` (2026-07-11).
 *
 * ── v1 vs v2 (the "spine") ──────────────────────────────────────────────────
 * The backend exposes exactly 6 `/v2/ai/*` operations (tag "v2 (runtime
 * spine)"). Every one of them is a byte-for-byte alias of its v1
 * counterpart: same request schema (`AgentStartRequest` / `ChatRequest` /
 * `ConversationContinueRequest` — no `*V2` variant exists), same response
 * shape, same auth (verified live: an unauthenticated POST to both
 * `/ai/agent/{id}` and `/v2/ai/agent/{id}` returns an identical
 * `401 {"error":"auth_required",...}` body). The v2 operation descriptions
 * say it outright: "identical pipeline to `/api/ai/agents/{agent_id}`" etc.
 * This is a PATH move, not a payload/stream/event change.
 *
 * The v2 surface does NOT include: warm, cancel, tool_results, inbox, or
 * resume/pending_calls. Those endpoints only exist under `/ai/*` — calling
 * them is correct and NOT a bug. `API_VERSION` below is the one knob that
 * moves the two run-start paths (`agentExecutePath`, `CHAT_PATH`) that DO
 * have a v2 form; everything else in this file and in
 * `./tool-results.ts` stays hardcoded to `/ai/...` deliberately.
 */

import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api/client';

/**
 * Single source of truth for which spine version the agent-run paths use.
 * Bump this to move `agentExecutePath` + `CHAT_PATH` to a future v3 in one
 * edit — never hardcode a version segment at a call site or anywhere else
 * in this file.
 */
const API_VERSION = 'v2' as const;

/** POST /{API_VERSION}/ai/agent/{agent_id} — start agent stream. agent_id is in the URL. */
export const agentExecutePath = (agentId: string): string =>
  `/${API_VERSION}/ai/agent/${encodeURIComponent(agentId)}`;

/**
 * Capability-based client envelope. Replaces the old `client_tools: string[]`
 * field. The server registers a `browser-dom` capability whose discovery
 * tool (`load_browser_tools`) reads `state["browser-dom"]` to decide which
 * tools to register for this turn.
 *
 * Source of truth for the per-capability state shape: aidream's capability
 * registration in the Python `matrx-ai` runtime. Keep this TypeScript shape
 * in sync with the server's expected payload model. See
 * docs/MATRX_EXTEND_MIGRATION_GUIDE.md for the post-redesign source-of-truth
 * flow.
 */
export interface AgentClientEnvelope {
  capabilities: string[];
  state: Record<string, Record<string, unknown>>;
}

/**
 * AgentStartRequest shape. Matches the live FastAPI route after the
 * capability-based agent API rolled out (2026-05-01).
 *
 * Most fields are user-facing and shipped on every chat. The fields below the
 * `// ── admin overrides` line come from the OpenAPI spec and are admins-only
 * — see `useAdminFlagsStore` and `projectAdminFlagsToRequest` for the
 * per-request projection, plus the dispatcher's defense-in-depth strip when
 * `isAdmin === false`.
 */
export interface AgentStartRequest {
  user_input?: string;
  variables?: Record<string, unknown> | null;
  /**
   * REQUIRED, client-minted, always. It is our correlation handle for this
   * request; with several sends in flight a server-assigned id that only
   * arrives when the response opens cannot tell them apart.
   */
  conversation_id: string;
  /** REQUIRED assertion about that id: create it (true) or continue it (false). */
  is_new: boolean;
  /** REQUIRED. The ONLY ephemeral signal — false means the server writes nothing. */
  store: boolean;
  stream?: boolean;
  /**
   * Capability declaration + per-capability state. The capability brings
   * `load_browser_tools` (the discovery tool) online; everything else loads
   * on demand. Replaces the old `client_tools` field.
   */
  client?: AgentClientEnvelope;
  custom_tools?: Record<string, unknown>[];
  /** Model-facing context (page markdown, SEO, links, etc.). Distinct from `client.state`. */
  context?: Record<string, unknown>;
  /**
   * Top-level sandbox binding. The server hydrates
   * `ctx.metadata["active_sandbox"]` from this — matrx-ai's fs/shell/git
   * tools read it to route into the bound compute target (EC2 sandbox
   * container OR the user's PC via aidream's reverse-proxy). Resolved by
   * the extension at chat-send time from the picker's
   * `boundComputeTarget` (see SandboxPickerChip + use-compute-targets).
   */
  sandbox?: {
    sandbox_id: string;
    base_url: string;
    access_token: string;
    root_path: string;
  };
  source_app?: string;
  source_feature?: string;

  // ── admin overrides ─────────────────────────────────────────────────────
  /** Verbose debug events in the SSE stream. Admin-only. */
  debug?: boolean;
  /** Save a conversation snapshot at the end of the run. Admin-only. */
  snapshot?: boolean;
  /** Render in block mode (structured blocks instead of plain text). Admin-only. */
  block_mode?: boolean;
  /** Track this run as a versioned re-execution of an existing turn. Admin-only. */
  is_version?: boolean;
  /** Allow the server to lazily create a missing context bucket. Admin-only. */
  allow_context_create?: boolean;
  /** Bypass model-response cache for this turn. Admin-only. */
  cache_bypass?: Record<string, unknown> | null;
  /** Override agent loop iteration cap. Admin-only. */
  max_iterations?: number;
  /** Override per-iteration retry cap. Admin-only. */
  max_retries_per_iteration?: number;
  /** Enable / disable the agent's memory layer for this run. Admin-only. */
  memory?: boolean | null;
  /** Override the memory model used. Admin-only. */
  memory_model?: string | null;
  /** Memory scope — user / project / organization / agent / conversation. Admin-only. */
  memory_scope?: string;
  /** LLMParams override blob. Admin-only, power-user. */
  config_overrides?: Record<string, unknown> | null;
  /** Variables the agent is allowed to write back. Admin-only. */
  writable_variables?: string[];
}

/** POST /{API_VERSION}/ai/chat — direct chat with explicit ai_model_id (not used by extension currently). */
export const CHAT_PATH = `/${API_VERSION}/ai/chat`;

/**
 * POST /ai/agents/{agent_id}/warm — warm an agent before sending.
 * No `/v2/ai/agents/{agent_id}/warm` exists on the backend — stays on v1.
 */
export const agentWarmPath = (agentId: string): string =>
  `/ai/agents/${encodeURIComponent(agentId)}/warm`;

/**
 * POST /ai/cancel/{request_id} — cancel an in-flight stream.
 * No `/v2/ai/cancel/{request_id}` exists on the backend — stays on v1.
 */
export const cancelPath = (requestId: string): string =>
  `/ai/cancel/${encodeURIComponent(requestId)}`;

export function warmAgent(agentId: string) {
  return apiPost<{ status: string }>(agentWarmPath(agentId), {});
}

export function cancelRequest(requestId: string) {
  return apiPost<{ status: string }>(cancelPath(requestId), {});
}

/**
 * POST /ai/conversations/{conversation_id}/inbox — turn-boundary inbox.
 * Queue a message INTO a run that is already streaming, without cancelling it.
 * The running agent drains the item at its next natural pause and answers it
 * on the same stream. Plain JSON response (not a stream).
 * See docs/TURN_BOUNDARY_INBOX.md.
 *
 * NOT versioned: there is no `/v2/ai/conversations/{id}/inbox` on the
 * backend. Do not "fix" this to use `API_VERSION` — see the file-header note.
 */
export const conversationInboxPath = (conversationId: string): string =>
  `/ai/conversations/${encodeURIComponent(conversationId)}/inbox`;

export interface InboxEnqueueRequest {
  /** 'user_message' (default) shows in the transcript; 'system_message' steers. */
  kind?: 'user_message' | 'system_message';
  text: string;
  is_visible_to_user?: boolean;
  is_visible_to_model?: boolean;
}

export interface InboxEnqueueResponse {
  injection_id: string;
  conversation_id: string;
  /** Server confirms acceptance; today always 'pending'. */
  status: string;
  /** true: a run is in flight and will drain it at its next boundary. */
  run_active: boolean;
}

export function enqueueInboxMessage(conversationId: string, body: InboxEnqueueRequest) {
  return apiPost<InboxEnqueueResponse>(conversationInboxPath(conversationId), {
    kind: 'user_message',
    is_visible_to_user: true,
    is_visible_to_model: true,
    ...body,
  });
}

/** A single still-pending inbox item, as returned by the list/mutate endpoints. */
export interface InboxItem {
  injection_id: string;
  kind: 'user_message' | 'system_message';
  text: string;
  status: string;
  queued_at?: string;
  is_visible_to_user?: boolean;
  is_visible_to_model?: boolean;
}

const inboxItemPath = (conversationId: string, injectionId: string): string =>
  `${conversationInboxPath(conversationId)}/${encodeURIComponent(injectionId)}`;

/**
 * GET /ai/conversations/{id}/inbox?status=pending — list still-pending items.
 * Used to rebuild "waiting its turn" cards when client state was lost.
 */
export function listPendingInboxMessages(conversationId: string) {
  return apiGet<InboxItem[]>(`${conversationInboxPath(conversationId)}?status=pending`);
}

/**
 * DELETE /ai/conversations/{id}/inbox/{injection_id} — retract a pending item.
 * `200 {status:'cancelled'}` on success; **409** if it already drained (caller
 * should fall back to the delivered flow); 404 if absent.
 */
export function cancelInboxMessage(conversationId: string, injectionId: string) {
  return apiDelete<{ injection_id: string; status: string }>(
    inboxItemPath(conversationId, injectionId),
  );
}

/**
 * PATCH /ai/conversations/{id}/inbox/{injection_id} — edit a pending item's
 * text. `200 {status:'pending'}` on success; 409 if drained; 404 if absent.
 */
export function editInboxMessage(conversationId: string, injectionId: string, text: string) {
  return apiPatch<{ injection_id: string; status: string }>(
    inboxItemPath(conversationId, injectionId),
    { text },
  );
}
