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
