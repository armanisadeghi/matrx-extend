/**
 * Tool registry types.
 *
 * Every tool declares:
 *   - name      — the identifier the agent uses to call it
 *   - tier      — risk level, drives the permission gate
 *   - run       — the actual handler executed in the SW (full `chrome.*` access)
 *   - args      — Zod schema for inbound arguments
 *   - description — sent to the agent so it knows what the tool does
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
  description: string;
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
  admin_only?: boolean;
  /**
   * Optional Chrome `permissions` keys this tool requires that are NOT in the
   * default manifest — i.e. they live in `optional_permissions` and must be
   * granted at runtime via `chrome.permissions.request`. The dispatcher
   * checks for these before running and returns a structured error so the
   * UI can prompt the user.
   */
  required_optional_permissions?: string[];
  /**
   * If true, this tool needs broad host access (`<all_urls>`) to operate on
   * arbitrary websites — e.g. it executes scripts on the assigned tab, sends
   * messages to a content script that declares `matches: ['<all_urls>']`,
   * or fetches arbitrary URLs from a content-script context.
   *
   * Roadmap item #10 moved `<all_urls>` from base host_permissions to
   * optional_host_permissions, so this flag lets the dispatcher reject
   * with a clear remediation message when the user hasn't granted it yet.
   *
   * Tools that only operate on the explicit hosts in base host_permissions
   * (server.app.matrxserver.com, aimatrx.com, the matrx-local engine, etc.)
   * should NOT set this. The dispatcher narrows the check to the assigned
   * tab's URL when available so tools can run on baseline-allowed hosts
   * even without the broad grant.
   */
  requires_broad_host_access?: boolean;
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

export interface ToolResultEnvelope {
  call_id: string;
  tool_name: string;
  output?: unknown;
  is_error?: boolean;
  error_message?: string | null;
}

export interface PendingConfirmRequest {
  callId: string;
  toolName: string;
  description: string;
  /** Args the agent supplied — surfaced verbatim so the user sees what's about to happen. */
  args: unknown;
  tier: ToolTier;
}

export interface ConfirmResponse {
  callId: string;
  decision: 'allow' | 'deny';
  /** Optional "remember this decision for the rest of the conversation". */
  rememberFor?: 'session' | 'conversation';
}

export interface PendingAskUserRequest {
  callId: string;
  question: string;
  choices?: string[];
  secret?: boolean;
  /** Hint to the user why the agent paused. */
  why?: string;
}

export interface AskUserResponse {
  callId: string;
  answer: string | null;
  cancelled?: boolean;
}
