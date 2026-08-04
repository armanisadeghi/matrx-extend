/**
 * Tool registry types.
 *
 * Every tool declares:
 *   - name      — the identifier the agent uses to call it
 *   - tier      — risk level, drives the permission gate
 *   - run       — the actual handler executed in the SW (full `chrome.*` access)
 *   - args      — Zod schema for inbound arguments
 *
 * Descriptions are NOT declared here — they live ONLY in the database
 * (`tool.definition.description`) and are read live for UI via
 * `src/lib/tools/descriptions.ts`. See docs/TOOL_SOURCE_OF_TRUTH.md (Rule 4).
 */

import type { BrowserSet } from '@/lib/browser/types';
import type { z } from 'zod';

export type ToolTier =
  /** Information-only. Always runs, no permission prompt. */
  | 'read'
  /**
   * Mutates browser state (navigate, click, type, scroll, download, set
   * clipboard). In "Ask before acting" mode, the user must approve. In
   * "Act without asking" mode, runs immediately.
   */
  | 'action'
  /**
   * Privileged: things that touch the user's local machine through
   * matrx-local, run arbitrary JS, or move files. Always confirmed on
   * first call per session, even in "Act without asking" mode.
   */
  | 'privileged'
  /**
   * Special — the agent is asking the human a question. Always renders
   * an inline question card; "permission mode" is irrelevant.
   */
  | 'ask-user';

/**
 * One incremental progress update emitted by a long-running tool while it
 * executes (between `started` and `completed`). Entirely optional — a tool
 * that never reports progress renders exactly as before. The display layer
 * only shows progress when at least one update has arrived.
 *
 * `label` is the human-readable line ("Fetching page 3 of 12"). `step` +
 * `status` enable checklist-style rendering. `data` carries arbitrary
 * structured payload for a custom renderer. All fields optional.
 */
export interface ToolProgressUpdate {
  /** Short status line shown to the user. */
  label?: string;
  /** Named step id — groups updates for checklist display. */
  step?: string;
  /** Step / overall status, used by checklist + 'latest' modes. */
  status?: 'pending' | 'active' | 'done' | 'error';
  /** 0–1 (fraction) or 0–100 (percent) — renderer normalizes either. */
  percent?: number;
  /** Arbitrary structured payload for a registry CustomComponent. */
  data?: unknown;
}

export interface ToolContext {
  /** Pilot session conversation_id — needed to POST results back. */
  conversationId: string | null;
  /** Originating SSE runId. Used for filtering replies. */
  runId: string;
  /** Tool call_id from the server's tool_started event. */
  callId: string;
  /** Agent name for log attribution + UI. */
  agentName: string | null;
  /** Permission mode for this run. */
  permissionMode: 'ask' | 'act';
  /**
   * Emit an incremental progress update for this tool call. Optional — only
   * set by the SW dispatcher for the streaming path; undefined for the
   * manual Tools-tab runner and WebMCP. Long-running handlers call this to
   * surface live status ("Fetching page 3 of 12") instead of a bare spinner.
   * A string shorthand sets just the `label`. Best-effort + non-blocking;
   * the display layer ignores it when no registry config opts in beyond the
   * generic default. Handlers should call sparingly (it broadcasts each time).
   */
  reportProgress?: (update: string | ToolProgressUpdate) => void;
  /**
   * The tab the agent is assigned to operate on for this run. Latched at
   * STREAM_START time from whichever tab was active when the user sent the
   * message. Handlers MUST prefer this over `chrome.tabs.query({active})`
   * — otherwise a user switching tabs mid-execution silently redirects
   * tool calls onto the wrong page. Use the
   * `getAssignedTab(ctx)` / `getAssignedTabId(ctx)` helpers in
   * `src/lib/tools/handlers/_active-tab.ts`. May be null when invoked
   * outside a chat run (e.g. the Tools tab "Run" button before any
   * stream is open) — in that case the helpers fall back to the
   * currently-focused tab.
   */
  assignedTabId: number | null;
}

export interface ToolHandler<TArgs, TResult> {
  name: string;
  tier: ToolTier;
  /**
   * Accept any input shape — schemas with `.default(...)` infer an input type
   * that includes `undefined` for the defaulted keys, but the parsed output is
   * the strict TArgs we run with.
   */
  argsSchema: z.ZodType<TArgs, z.ZodTypeDef, unknown>;
  run: (args: TArgs, ctx: ToolContext) => Promise<TResult>;
  /**
   * Optional dynamic tier resolver — when present, the dispatcher uses
   * `tierFor(args)` instead of `tier` for permission gating. Useful for
   * mega-tool routers (`computer`, `tabs`, …) that mix read-only and
   * mutating sub-actions under one tool name. The base `tier` field is
   * still the catalog-level default for advertising / docs.
   */
  tierFor?: (args: TArgs) => ToolTier;
  /**
   * If true, this tool is excluded from non-admin users' bundle and won't be
   * advertised to their agents. The user can still see it in the Tools tab
   * (filtered by an "admin-only" badge) when they're an admin. Use this for
   * experimental / risky / privacy-sensitive capabilities until we're ready
   * to ship them broadly.
   */
  admin_only?: boolean | undefined;
  /**
   * Optional Chrome `permissions` keys this tool requires that are NOT in the
   * default manifest — i.e. they live in `optional_permissions` and must be
   * granted at runtime via `chrome.permissions.request`. The dispatcher
   * checks for these before running and returns a structured error so the
   * UI can prompt the user.
   */
  required_optional_permissions?: string[];
  /**
   * Browsers this tool ships to. Omit to mean "all three" (chrome, firefox,
   * safari). Set to e.g. `['chrome']` for tools that depend on
   * Chrome-only APIs (`chrome.debugger`, `chrome.offscreen`,
   * `chrome.tabGroups`, `chrome.pageCapture`, `chrome.sidePanel`,
   * `chrome.runtime.connectNative`).
   *
   * The dispatcher rejects calls to tools that aren't supported on the
   * current browser; the bundle filters omit them from advertised
   * surfaces; the catalog emits `supported_browsers` for every entry.
   *
   * The `tests/browser-gate-lint.test.ts` check (added in Phase 5 of the
   * Safari port) flags handler code that touches the gated namespaces
   * without declaring this field — see
   * `~/.claude/plans/the-system-has-had-lovely-sifakis.md`.
   */
  supportedBrowsers?: BrowserSet;
}

export type AnyToolHandler = ToolHandler<unknown, unknown>;

/**
 * Route a mega-tool router's delegation through the LEAF handler's Zod
 * schema (audit P2-24). Routers used to call `leaf.run(built as never, ctx)`
 * with hand-assembled literals — bypassing `.default()` application, so
 * every leaf default had to be hand-mirrored at every call site (the
 * blur_element unserializable-undefined crash was this pattern biting).
 * Parsing here applies defaults/coercion uniformly and turns a malformed
 * delegation into a structured error instead of an exception.
 */
export async function delegate<TArgs, TResult>(
  leaf: ToolHandler<TArgs, TResult>,
  args: unknown,
  ctx: ToolContext,
): Promise<TResult | { ok: false; reason: string }> {
  const parsed = leaf.argsSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      reason: `delegated args failed ${leaf.name} schema: ${JSON.stringify(parsed.error.format())}`,
    };
  }
  return leaf.run(parsed.data, ctx);
}

export interface ToolResultEnvelope {
  call_id: string;
  tool_name: string;
  output?: unknown;
  is_error?: boolean;
  error_message?: string | null;
}

export interface PendingConfirmRequest {
  callId: string;
  /** Conversation that owns this request. See PendingAskUserRequest.conversationId. */
  conversationId?: string | null;
  toolName: string;
  /**
   * Human-readable description, resolved LIVE from the DB (tool_def) at
   * confirm time via src/lib/tools/descriptions.ts — never hardcoded (Rule 4).
   * Omitted when the live lookup hasn't loaded yet; the card falls back to
   * name + args.
   */
  description?: string | undefined;
  /** Args the agent supplied — surfaced verbatim so the user sees what's about to happen. */
  args: unknown;
  /**
   * Effective tier for THIS call (mega-tool routers resolve `tierFor(args)`,
   * so a privileged sub-action renders as privileged even when the catalog
   * tier is 'action').
   */
  tier: ToolTier;
  /**
   * Who initiated this call. 'agent' (default, the streaming dispatcher) is
   * the user's own AI agent mid-conversation. Anything else is an EXTERNAL
   * caller — a web page (WebMCP bridge), the aimatrx.com frontend RPC, or
   * the matrx-local desktop engine — and the approval card must say so
   * prominently: the user otherwise assumes their agent asked.
   */
  initiator?: ConfirmInitiator;
}

export type ConfirmInitiator = 'agent' | 'page' | 'frontend' | 'desktop';

export interface ConfirmResponse {
  callId: string;
  decision: 'allow' | 'deny';
  /** Optional "remember this decision for the rest of the conversation". */
  rememberFor?: 'session' | 'conversation';
}

/**
 * Unified `user` tool envelopes (canonical wire contract — see
 * `packages/matrx-ai/matrx_ai/tools/USER_TOOL_WIRE_CONTRACT.md` in aidream).
 *
 * One pending-request shape covers every variant. The card branches on
 * `kind`. Fields that don't apply to a kind are simply omitted.
 */
export type UserAskKind = 'confirm' | 'choice' | 'choice_many' | 'text' | 'secret' | 'notify';

/**
 * Rich option shape (2026-05-19). The card always receives this normalized
 * form — bare-string options from legacy callers get hoisted to
 * `{label: 'X'}` in the handler before broadcast.
 */
export interface UserAskOption {
  label: string;
  /** Per-option explanation rendered beside / under the label. */
  description?: string | undefined;
  /**
   * Optional preview content (code, markdown, ASCII mockup). When ANY
   * option in a single-select question has a preview, the card switches
   * to a side-by-side layout — vertical option list on the left, preview
   * of the focused option on the right. Multi-select questions ignore
   * previews even if supplied.
   */
  preview?: string | undefined;
}

export interface PendingAskUserRequest {
  callId: string;
  /**
   * Conversation that owns this request. The SW dispatcher injects
   * `ctx.conversationId` here so the sidepanel subscriber can route the
   * card to the surface that actually fired the tool call — Pilot has its
   * own conversation store, distinct from the Assistant Chat's. Without
   * this, ask-user cards spawned from Pilot were tagged with the chat
   * store's selectedConversationId and got filtered out by PilotView,
   * hanging the call until timeout.
   */
  conversationId?: string | null;
  kind: UserAskKind;
  /** Required for confirm / choice / choice_many / text / secret. */
  question?: string | undefined;
  /**
   * Optional short chip label (≤12 chars). Renders as a small tag at the
   * top of the card, useful when batching multiple questions so the user
   * can scan which question they're answering. New 2026-05-19.
   */
  header?: string | undefined;
  /**
   * Required for choice / choice_many. Normalized to UserAskOption[] in
   * the handler — string callers get hoisted automatically.
   */
  options?: UserAskOption[] | undefined;
  /** Required for notify — the body of the notification. */
  message?: string | undefined;
  /** Optional notify action button labels (UI always appends 'Other'). */
  actions?: string[] | undefined;
  /** Notify visual treatment. Default 'info'. */
  level?: 'info' | 'success' | 'warning' | 'error' | undefined;
  /** Optional one-line "why is the agent asking?" context. */
  context?: string | undefined;
  /**
   * choice / choice_many only. When true, the card appends a freeform
   * "Other" option (radio or checkbox respectively) with a text input
   * underneath. The response sets `freeform` to whatever the user typed.
   * New 2026-05-19.
   */
  allow_other?: boolean | undefined;
  /**
   * True when this card came from the `user` ask tool, which supports the extra
   * escape hatches: a final "Additional instructions" note and a "Write message
   * instead" bypass. update_plan / request_user_takeover reuse this card shape but
   * have bespoke response semantics, so they leave this unset and the card hides
   * the extras. New 2026-05-23.
   */
  allow_extras?: boolean;
  /**
   * Question position when this card is one of a batched question set.
   * The handler fires sequential cards (Q1 → wait → Q2 → wait → …); these
   * fields let the card show "Question N of M" if desired. Single-question
   * requests omit both fields. New 2026-05-19.
   */
  batch_index?: number | undefined;
  batch_total?: number | undefined;
  /**
   * Absolute wall-clock deadline (ms epoch) when the request auto-resolves
   * with `timed_out: true`. Omitted when the call has no timeout. The
   * dispatcher computes this from `timeout_seconds` so the UI can render
   * a countdown without separately tracking the start time.
   */
  expires_at_ms?: number | undefined;
}

/**
 * Unified response from the sidepanel card. The handler builds the
 * outgoing envelope (the `{ answer, selected, confirmed, action, freeform,
 * cancelled, timed_out }` shape the wire contract spells out) from this.
 * Fields that don't apply to a kind are left undefined / null.
 */
export interface AskUserResponse {
  callId: string;
  /** text / secret types — user's freeform text. */
  answer?: string | null;
  /** choice / choice_many — selected option labels. */
  selected?: string[];
  /** confirm — yes (true) / no (false). */
  confirmed?: boolean;
  /** notify — which action button was clicked (or 'Other'). */
  action?: string | null;
  /**
   * Freeform text submitted under an 'Other' option:
   * - notify: the text typed under the 'Other' button
   * - choice / choice_many with allow_other:true: the text typed under
   *   the 'Other' option (when the user picked it)
   */
  freeform?: string | null;
  /**
   * Optional freeform note the user attached ALONGSIDE their structured answer
   * (the "Anything else?" field on the final card). New 2026-05-23.
   */
  additional_instructions?: string | null;
  /**
   * True when the user clicked "Write message instead" — they declined the
   * structured question(s) and typed a freeform reply (in `freeform`). In a
   * batch this short-circuits the remaining questions. New 2026-05-23.
   */
  wrote_instead?: boolean;
  /** User explicitly dismissed the card. */
  cancelled?: boolean;
}
