/**
 * Direct, RLS-gated Supabase reads from the extension. The publishable key +
 * the user's JWT (read from chrome.storage.local by the client access-token
 * hook) gates rows server-side.
 *
 * Schema mirror — these tables already exist in the Matrx Supabase project:
 *   - agent.definition        (Agent definitions — was public.agx_agent)
 *   - chat.conversation       (Chat conversations — was public.cx_conversation)
 *   - chat.message            (Chat messages, JSONB content[] — was public.cx_message)
 *   - chat.tool_call          (Tool call records — was public.cx_tool_call)
 *   - ai.model_definition     (AI model registry — `ai.model` was SPLIT into
 *                              model_definition/_public/_admin/_alias; only
 *                              model_definition has our 3 columns AND is readable
 *                              by the publishable key)
 *   - tool.definition         (Tool definitions — was public.tool_def)
 *   - admin.admins            (Admin allowlist — was public.admins)
 *
 * Table -> schema routing is centralized in `@/lib/supabase/schemas`. Use those
 * accessors (adminDb(), aiDb(), …) rather than hand-writing `.schema('x')`:
 * an unqualified `.from()` silently resolves against `public` and 404s at
 * RUNTIME (PGRST205) — tsc and the build will not catch it.
 *
 * Saved pages are Sources: docproc.processed_documents (read here under RLS;
 * created and edited only through the landing door, src/lib/api/routes/sources.ts).
 *
 * Tables this extension OWNS now live in the dedicated `extend` schema
 * (moved out of public in the 2026-06-27 DB transition — reached via
 * `.schema('extend')`, see EXTEND_SCHEMA below):
 *   - extend.wbx_pattern        (Saved Data-tab patterns)
 *   - extend.wbx_seo_audit      (SEO audits + AI recommendations)
 *   - extend.wbx_screenshot · extend.wbx_guidance · extend.wbx_demo · extend.wbx_highlight · extend.wbx_recipe
 */

import { requireRequestOrganizationId } from '@/lib/api/routes/auth';
import { decisionAnswersText } from '@/lib/chat/decision-answers';
import { log } from '@/lib/debug/log';
import { getActiveOrganizationId } from '@/lib/org/active-org';
import { canonicalUrl } from '@/lib/sources/canonical';
import {
  type WriteActor,
  getMachineryAuthoredSupabase,
  getSupabase,
  hasSupabaseAccessToken,
  supabaseForActor,
} from '@/lib/supabase/client';
import { type DbCallSite, failDbCall } from '@/lib/supabase/db-failure';
import { adminDb, aiDb, docprocDb, extendDb, usersDb } from '@/lib/supabase/schemas';
import type { ChatMessage, MessagePart } from '@/state/chat';
import { requireOrganizationContext } from '@ai-matrx/agents/matrx';
import { z } from 'zod';

/**
 * The wbx_* extension tables moved out of public into the dedicated `extend`
 * schema (2026-06-27 DB transition). Every wbx_ call routes through it, the
 * same way chat/ai/tool reads use `.schema(...)`. Owner is canonical
 * `created_by` (stamped server-side) — there is no `user_id` column anymore.
 */
const EXTEND_SCHEMA = 'extend';

/**
 * Per-row safeParse that survives malformed rows. Bad rows are dropped from
 * the returned array but logged in full detail to the admin event stream so
 * the cause is recoverable from the Debug tab. Used by conversation history
 * loads where ONE corrupt row used to abort the entire fetch (silent fail:
 * the promise rejected, setMessages never ran, the conversation rendered
 * empty). Now the conversation renders with whatever's valid and the caller
 * gets a non-zero `badCount` to surface a UI banner.
 */
function parseRowsSafe<T>(
  // Wide input type so schemas with .default()/.transform() (input shape !=
  // output shape) still infer T as the OUTPUT type.
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  rows: unknown[],
  context: string,
): { rows: T[]; badCount: number } {
  const good: T[] = [];
  let bad = 0;
  for (let i = 0; i < rows.length; i++) {
    const parsed = schema.safeParse(rows[i]);
    if (parsed.success) {
      good.push(parsed.data);
    } else {
      bad += 1;
      const raw = rows[i] as Record<string, unknown> | null;
      log.error('supabase', `${context}: row ${i} failed validation`, {
        issues: parsed.error.issues,
        row_id: raw && typeof raw === 'object' ? (raw.id ?? null) : null,
        raw,
      });
    }
  }
  return { rows: good, badCount: bad };
}

// ─── Admin gate ─────────────────────────────────────────────────────────────
/**
 * Checks whether the user has a row in `public.admins`. The table:
 *   create table public.admins (
 *     user_id uuid primary key references auth.users(id) on delete cascade,
 *     created_at timestamptz default now()
 *   );
 * Anything debug-related (Debug tab, cross-context relay, advanced toggles)
 * is gated on this check.
 * `null` means the role read failed; it is not a confirmed non-admin result.
 */
export async function checkIsAdmin(userId: string): Promise<boolean | null> {
  // `admins` lives in the `admin` schema now, not `public`. It kept its
  // `user_id` column (unlike the extend/* tables, which renamed it to
  // `created_by`) — so only the routing changes here.
  const { data, error } = await adminDb()
    .from('admins')
    .select('user_id')
    .eq('user_id', userId)
    .limit(1);
  if (error) {
    console.warn('[matrx-extend] checkIsAdmin error', error.message);
    return null;
  }
  return Array.isArray(data) && data.length > 0;
}

// ─── Agents ─────────────────────────────────────────────────────────────────
/**
 * THE AGENT LIST IS NOT READ HERE.
 *
 * `agx_get_list_full`, `agx_search`, the default-Mandate row and every filter,
 * sort and tab live in `@ai-matrx/agents/catalog` — ONE picker, one membership
 * rule, one order, across every Matrx client. This module used to hold
 * `AgxAgentSchema`, `fetchAgentList`, `fetchUserAgents` and a hardcoded
 * "Matrx Browser Agent" default row; all four were deleted on 2026-09-08 when
 * the extension adopted the package (@ai-matrx/agents 0.7.1). Host wiring is
 * `src/lib/agents/catalog.ts`. Never re-add a list read here.
 */

// ─── ai.model_definition (admin model picker) ───────────────────────────────
export const AiModelSchema = z.object({
  id: z.string().uuid(),
  common_name: z.string(),
  // Deprecated = hidden from a normal user's default list but fully RUNNABLE
  // (ruled 2026-09-09). This is an ADMIN picker, so deprecated rows are
  // listed and badged. retired_at (ai_075) is the dead state — never listed.
  is_deprecated: z.boolean().nullable(),
});
export type AiModel = z.infer<typeof AiModelSchema>;

/**
 * Fetch every RUNNABLE AI model — live and deprecated (deprecated still runs;
 * only RETIRED rows, which the provider no longer serves, are excluded). Used by the admin Debug-tab
 * model picker to override `config_overrides.model` in chat requests. The
 * server resolves the returned UUID to whatever provider/endpoint backs it,
 * so the extension never needs to touch model names.
 */
export async function fetchActiveModels(): Promise<AiModel[]> {
  // `ai.model` was SPLIT, not moved: it is now model_definition (base table) +
  // model_public / model_admin / model_alias / model_config / model_offering.
  // `model_definition` is the right target — it is the only one that carries all
  // three columns we read AND is readable by this client. (`model_admin` has the
  // columns but is `permission denied for view` to the publishable key; and
  // `model_public` dropped `is_deprecated` entirely, so the filter below would
  // 42703.) Verified against the live DB.
  const { data, error } = await aiDb()
    .from('model_definition')
    .select('id, common_name, is_deprecated')
    .is('deleted_at', null)
    .is('retired_at', null)
    .order('common_name', { ascending: true });
  if (error) {
    console.warn('[matrx-extend] fetchActiveModels error', error.message);
    return [];
  }
  const parsed = z.array(AiModelSchema).safeParse(data ?? []);
  if (!parsed.success) {
    console.warn('[matrx-extend] fetchActiveModels shape mismatch', parsed.error.format());
    return [];
  }
  return parsed.data;
}

// ─── Agent execution payload (agx_get_execution_full RPC) ───────────────────
/**
 * Lazy-loaded when an agent is selected. Has just the runtime essentials —
 * NO system instructions, NO message history, NO secret sauce.
 */
export const AgxAgentExecutionSchema = z.object({
  id: z.string().uuid(),
  model_id: z.string().uuid().nullable(),
  settings: z.unknown().nullable(),
  variable_definitions: z.unknown().nullable(),
  context_slots: z.unknown().nullable(),
  tools: z.array(z.string()).nullable(),
  custom_tools: z.unknown().nullable(),
});
export type AgxAgentExecution = z.infer<typeof AgxAgentExecutionSchema>;

export async function fetchAgentExecution(agentId: string): Promise<AgxAgentExecution | null> {
  const c = getSupabase();
  const { data, error } = await c.rpc('agx_get_execution_full', { p_agent_id: agentId });
  if (error) {
    console.warn('[matrx-extend] fetchAgentExecution error', error.message);
    return null;
  }
  const rows = z.array(AgxAgentExecutionSchema).safeParse(data ?? []);
  if (!rows.success) {
    console.warn('[matrx-extend] fetchAgentExecution shape mismatch', rows.error.format());
    return null;
  }
  return rows.data[0] ?? null;
}

// ─── Conversations (chat.conversation) ──────────────────────────────────────
// NOTE: post-canonicalization the table moved to the `chat` schema.
// `user_id` is now `created_by`; `status` column was removed from this table.
export const ConversationSchema = z.object({
  id: z.string().uuid(),
  created_by: z.string().uuid().nullable(),
  title: z.string().nullable(),
  last_model_id: z.string().uuid().nullable(),
  message_count: z.number().int().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
  metadata: z.unknown().nullable(),
});
export type Conversation = z.infer<typeof ConversationSchema>;

export async function fetchConversationHistory(limit = 30): Promise<Conversation[]> {
  const c = getSupabase();
  const { data, error } = await c
    .schema('chat')
    .from('conversation')
    .select(
      'id, created_by, title, last_model_id, message_count, created_at, updated_at, deleted_at, metadata',
    )
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) {
    log.error('supabase', 'fetchConversationHistory: supabase error', {
      message: error.message,
      code: (error as { code?: string }).code,
    });
    throw new Error(`Could not load conversation history: ${error.message}`);
  }
  return parseRowsSafe(ConversationSchema, (data ?? []) as unknown[], 'fetchConversationHistory')
    .rows;
}

// ─── Messages (chat.message) ─────────────────────────────────────────────────
export const MessageSchema = z.object({
  id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  role: z.string(),
  position: z.number().int().nullable(),
  status: z.string().nullable(),
  content: z.unknown(),
  created_at: z.string(),
  metadata: z.unknown().nullable(),
});
export type Message = z.infer<typeof MessageSchema>;

export async function fetchConversationMessages(
  conversationId: string,
): Promise<{ rows: Message[]; badCount: number }> {
  const c = getSupabase();
  const { data, error } = await c
    .schema('chat')
    .from('message')
    .select('id, conversation_id, role, position, status, content, created_at, metadata')
    .eq('conversation_id', conversationId)
    .is('deleted_at', null)
    .order('position', { ascending: true });
  if (error) {
    log.error('supabase', 'fetchConversationMessages: supabase error', {
      conversation_id: conversationId,
      message: error.message,
      code: (error as { code?: string }).code,
    });
    throw new Error(`Could not load conversation messages: ${error.message}`);
  }
  return parseRowsSafe(MessageSchema, (data ?? []) as unknown[], 'fetchConversationMessages');
}

// ─── Tool calls (chat.tool_call) ─────────────────────────────────────────────
/**
 * One tool execution row. Lives on the `role: 'tool'` message and carries
 * the actual output the matching `tool_call` block produced. The output
 * column is a JSON-encoded STRING — needs `JSON.parse` before it's usable
 * by the tool-display registry transforms.
 *
 * Moved to `chat.tool_call` in the 2026-06 schema canonicalization.
 */
export const ToolCallRowSchema = z.object({
  call_id: z.string(),
  // Delegated and interrupted calls can exist before the server creates the
  // role=tool message that eventually owns the result. Dropping those rows
  // made a persisted terminal call hydrate as a permanent spinner.
  message_id: z.string().uuid().nullable(),
  conversation_id: z.string().uuid().nullable(),
  tool_name: z.string(),
  tool_type: z.string().nullable(),
  status: z.string().nullable(),
  arguments: z.unknown().nullable(),
  output: z.unknown().nullable(),
  is_error: z.boolean().nullable(),
  error_type: z.string().nullable(),
  error_message: z.string().nullable(),
  duration_ms: z.number().int().nullable(),
  created_at: z.string(),
});
export type ToolCallRow = z.infer<typeof ToolCallRowSchema>;

export async function fetchConversationToolCalls(
  conversationId: string,
): Promise<{ rows: ToolCallRow[]; badCount: number }> {
  const c = getSupabase();
  const { data, error } = await c
    .schema('chat')
    .from('tool_call')
    .select(
      'call_id, message_id, conversation_id, tool_name, tool_type, status, arguments, output, is_error, error_type, error_message, duration_ms, created_at',
    )
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) {
    log.error('supabase', 'fetchConversationToolCalls: supabase error', {
      conversation_id: conversationId,
      message: error.message,
      code: (error as { code?: string }).code,
    });
    throw new Error(`Could not load conversation tool calls: ${error.message}`);
  }
  return parseRowsSafe(ToolCallRowSchema, (data ?? []) as unknown[], 'fetchConversationToolCalls');
}

/**
 * `chat.tool_call.output` is stored as a JSON-encoded string. Parse it for the
 * tool-display registry which expects an object. Non-string outputs pass
 * through. Malformed JSON falls back to the raw string so we don't lose
 * data — the user can still copy it from the expanded row.
 */
function parseToolOutput(raw: unknown): unknown {
  if (raw == null) return null;
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

const TERMINAL_SUCCESS_STATUSES = new Set([
  'complete',
  'completed',
  'done',
  'success',
  'succeeded',
]);
const TERMINAL_ERROR_STATUSES = new Set([
  'cancelled',
  'canceled',
  'error',
  'expired',
  'failed',
  'rejected',
]);

/**
 * Project the durable `chat.tool_call` state into the timeline state. The row
 * is authoritative even when `message_id` is still null or the role=tool
 * message was never written (for example, a delivery failure after execution).
 */
function applyPersistedToolState(
  tool: Extract<MessagePart, { type: 'tool' }>['tool'],
  row: ToolCallRow,
): void {
  const status = row.status?.trim().toLowerCase() ?? '';
  const isError = row.is_error === true || TERMINAL_ERROR_STATUSES.has(status);
  const isComplete =
    !isError &&
    (TERMINAL_SUCCESS_STATUSES.has(status) ||
      // A non-null result or explicit non-error verdict is durable evidence
      // that execution ended even if an older server omitted its status.
      row.output != null ||
      (row.is_error === false && status === ''));

  if (!isError && !isComplete) return;

  tool.phase = isError ? 'error' : 'completed';
  tool.result = parseToolOutput(row.output);
  if (row.error_message) tool.message = row.error_message;
  else if (isError && row.error_type) tool.message = row.error_type;
  else if (!isError) tool.message = 'Done';

  if (typeof row.duration_ms === 'number' && row.duration_ms >= 0) {
    tool.endedAt = tool.startedAt + row.duration_ms;
  } else {
    const endedAt = new Date(row.created_at).getTime();
    if (Number.isFinite(endedAt)) tool.endedAt = endedAt;
  }
}

/**
 * Hydrate persisted messages into the same `ChatMessage` + `MessagePart`
 * shape the live SSE stream produces, so reload renders identically to the
 * in-flight session — including the polished ConfigurableToolRow entries.
 *
 * DB layout (see `.research/db-conversation-shape.md` if it ever drifts):
 *   - chat.message.content is a JSONB array of blocks: text | thinking |
 *     tool_call (assistant) | tool_result (tool role).
 *   - chat.tool_call holds the actual output for each tool_call, attached to
 *     the `role: 'tool'` message by call_id.
 *
 * Reconstruction:
 *   1. Index every chat.tool_call row by call_id for O(1) lookup.
 *   2. Walk messages in position order:
 *      - user/assistant → emit text + reasoning + tool (phase: started) parts.
 *      - tool → don't push a new ChatMessage; instead find the preceding
 *        assistant message and complete its matching tool parts using the
 *        looked-up output / error / duration.
 */
export function dbMessagesToChatMessages(
  rows: Message[],
  toolCalls: ToolCallRow[] = [],
): { messages: ChatMessage[]; badCount: number } {
  const byCallId = new Map<string, ToolCallRow>();
  for (const tc of toolCalls) byCallId.set(tc.call_id, tc);

  const out: ChatMessage[] = [];
  let bad = 0;

  for (const m of rows) {
    try {
      processOne(m);
    } catch (err) {
      bad += 1;
      log.error('supabase', 'dbMessagesToChatMessages: row transform threw', {
        message_id: m.id,
        role: m.role,
        error:
          err instanceof Error
            ? { name: err.name, message: err.message, stack: err.stack }
            : String(err),
      });
    }
  }
  return { messages: out, badCount: bad };

  function processOne(m: Message): void {
    if (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'tool') return;

    const blocks: Record<string, unknown>[] = Array.isArray(m.content)
      ? (m.content as Record<string, unknown>[])
      : [];

    if (m.role === 'tool') {
      // Merge into the most recent assistant message — DB stores tool
      // results as their own row, but in the rendered timeline they
      // belong inline with the assistant turn that called them.
      for (const block of blocks) {
        if (block.type !== 'tool_result') continue;
        const callId = String(block.call_id ?? block.tool_use_id ?? '');
        if (!callId) continue;
        // A tool result need not immediately follow the assistant row that
        // started it. Search backwards so interleaved/parallel calls hydrate
        // their owning bubble instead of being silently ignored.
        const owner = [...out]
          .reverse()
          .find(
            (candidate) =>
              candidate.role === 'assistant' &&
              candidate.parts?.some((p) => p.type === 'tool' && p.tool.callId === callId),
          );
        const part = owner?.parts?.find((p) => p.type === 'tool' && p.tool.callId === callId);
        if (!part || part.type !== 'tool') continue;
        const tc = byCallId.get(callId);
        if (tc) {
          applyPersistedToolState(part.tool, tc);
        }
        // The persisted tool-result message is itself terminal evidence. It
        // remains a fallback for legacy rows absent from chat.tool_call.
        const isError = Boolean(tc?.is_error ?? block.is_error);
        if (part.tool.phase === 'started') {
          part.tool.phase = isError ? 'error' : 'completed';
          part.tool.result = parseToolOutput(tc?.output ?? block.output ?? block.content);
        }
        const errMsg =
          tc?.error_message ??
          (typeof block.error_message === 'string' ? block.error_message : null);
        if (errMsg) part.tool.message = errMsg;
        else if (!isError) part.tool.message = 'Done';
        if (typeof tc?.duration_ms === 'number' && tc.duration_ms >= 0) {
          part.tool.endedAt = part.tool.startedAt + tc.duration_ms;
        } else {
          // Fall back to the tool-row timestamp so the duration display
          // doesn't show "0ms" — better an approximation than nothing.
          part.tool.endedAt = new Date(m.created_at).getTime();
        }
      }
      return;
    }

    const parts: MessagePart[] = [];
    let textBuf = '';
    const createdAt = new Date(m.created_at).getTime();

    for (const block of blocks) {
      const type = block.type;
      if (type === 'text' || type === 'input_text') {
        const text = typeof block.text === 'string' ? block.text : '';
        if (!text) continue;
        textBuf += text;
        parts.push({ type: 'text', content: text });
      } else if (type === 'thinking') {
        // Saved thinking blocks usually carry only an encrypted signature
        // with empty visible text — skip those so we don't render a
        // phantom reasoning row. Real plaintext reasoning (rare in DB) keeps rendering.
        const text = typeof block.text === 'string' ? block.text : '';
        if (!text) continue;
        parts.push({ type: 'reasoning', content: text });
      } else if (type === 'decision_answers') {
        // A decision turn is ONE typed part and no text — read it as its
        // verdict; skipping it left the reloaded reply an empty bubble.
        const text = decisionAnswersText(block);
        if (!text) continue;
        textBuf += text;
        parts.push({ type: 'text', content: text });
      } else if (type === 'tool_call') {
        const callId = String(block.call_id ?? '');
        const toolName = String(block.name ?? '');
        if (!callId || !toolName) continue;
        // tool_type may be discovered later via the chat.tool_call lookup;
        // assume 'client' by default (the registry doesn't care about
        // kind for resolution — only the outer wrapper styling).
        const lookup = byCallId.get(callId);
        const kind: 'server' | 'client' = lookup?.tool_type === 'local' ? 'client' : 'server';
        const tool = {
          kind,
          callId,
          toolName,
          args: block.arguments,
          phase: 'started' as const,
          startedAt: createdAt,
        };
        if (lookup) applyPersistedToolState(tool, lookup);
        parts.push({
          type: 'tool',
          tool,
        });
      }
    }

    out.push({
      id: m.id,
      role: m.role as 'user' | 'assistant',
      content: textBuf,
      ...(parts.length > 0 ? { parts } : {}),
      timestamp: createdAt,
      conversationId: m.conversation_id,
    });
  }
}

// ─── Sources: saved pages (docproc.processed_documents) ─────────────────────
//
// SOURCE-CONVERGENCE §4.2. A page saved from Scrape is a Source — a
// `docproc.processed_documents` row landed by `POST /sources/land` with
// `origin_client='extension'`. These are the direct RLS reads behind
// recognition, the chat context's `page_source` and the Saved captures tab, plus the one write
// this client makes to the table: a Source's soft delete. Create and edit go
// through the door (`src/lib/api/routes/sources.ts`), never through here.
//
// A Source can have versions: a re-capture with different text mints a
// `recapture` document whose parent is the previous one, and an edit mints a
// `manual_curation` document the canonical row points at (`canonical_clean_id`).
// The lists below show one card per Source: the CURRENT version.

const SOURCE_ORIGIN_EXTENSION = 'extension';
/** The versions a person sees as "the capture"; edits are read through canonical_clean_id. */
const CAPTURE_DERIVATIONS = ['initial_extract', 'recapture'];

export const CapturedPageSchema = z.object({
  id: z.string().uuid(),
  url: z.string(),
  captured_at: z.string(),
  title: z.string().nullable(),
});
export type CapturedPage = z.infer<typeof CapturedPageSchema>;

/** Superseded versions among `ids`: the ones a newer `recapture` names as its parent. */
async function supersededSourceIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await docprocDb()
    .from('processed_documents')
    .select('parent_processed_id')
    .in('parent_processed_id', ids)
    .eq('derivation_kind', 'recapture')
    .is('deleted_at', null);
  if (error) throw new Error(`Could not load saved captures: ${error.message}`);
  return new Set(
    ((data ?? []) as { parent_processed_id: string | null }[])
      .map((r) => r.parent_processed_id)
      .filter((id): id is string => typeof id === 'string'),
  );
}

/**
 * What a recognition lookup found. `unknown` is NOT "never saved": the lookup
 * failed (database refused, network down, a row that could not be read), and a
 * surface must say it could not check rather than imply the page is new.
 */
export type CaptureLookup =
  | { status: 'found'; page: CapturedPage }
  | { status: 'none' }
  | { status: 'unknown'; reason: string; cause?: 'organization_unselected' };

/**
 * The newest saved Source for this page, looked up by the door's canonical
 * identity (the same canonicalizer the server applies — `canonical.ts`).
 */
export async function lookupCapturedByUrl(url: string): Promise<CaptureLookup> {
  // A Source belongs to an organization, so a device with no session can
  // see none: answer "no record" without a round trip.
  if (!(await hasSupabaseAccessToken())) return { status: 'none' };
  const identity = canonicalUrl(url);
  if (!identity) return { status: 'none' };
  // Read-only recognition never raises the workspace picker or performs an
  // unscoped read: a person may see Sources in several organizations under RLS.
  let organizationId: string | null;
  try {
    organizationId = await getActiveOrganizationId();
  } catch (err) {
    log.warn('supabase', 'lookupCapturedByUrl could not read active organization', {
      message: err instanceof Error ? err.message : String(err),
    });
    return {
      status: 'unknown',
      reason: 'Could not read your selected organization. Check your connection and try again.',
    };
  }
  if (!organizationId) {
    return {
      status: 'unknown',
      cause: 'organization_unselected',
      reason:
        'Choose your organization in the AI Matrx panel to check whether this page is a Source there.',
    };
  }
  const query = docprocDb()
    .from('processed_documents')
    .select('id, canonical_identity, created_at, name')
    .eq('canonical_identity', identity)
    .eq('origin_client', SOURCE_ORIGIN_EXTENSION)
    .eq('organization_id', organizationId)
    .in('derivation_kind', CAPTURE_DERIVATIONS)
    .is('deleted_at', null);
  let data: unknown[] | null;
  try {
    const res = await query.order('created_at', { ascending: false }).limit(1);
    if (res.error) {
      log.warn('supabase', 'lookupCapturedByUrl failed', { message: res.error.message });
      return { status: 'unknown', reason: res.error.message };
    }
    data = res.data as unknown[] | null;
  } catch (err) {
    return { status: 'unknown', reason: err instanceof Error ? err.message : String(err) };
  }
  const row = (data ?? [])[0] as
    | { id: string; canonical_identity: string; created_at: string; name: string | null }
    | undefined;
  if (!row) return { status: 'none' };
  const parsed = CapturedPageSchema.safeParse({
    id: row.id,
    url: row.canonical_identity,
    captured_at: row.created_at,
    title: row.name,
  });
  if (!parsed.success) {
    log.error('supabase', 'lookupCapturedByUrl: row failed validation', parsed.error.issues);
    return { status: 'unknown', reason: 'the saved record could not be read' };
  }
  return { status: 'found', page: parsed.data };
}

export const SavedCaptureSummarySchema = z.object({
  id: z.string().uuid(),
  url: z.string(),
  captured_at: z.string(),
  updated_at: z.string(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  kept_at: z.string().nullable(),
  /** The member who captured it (`created_by`) — the tab lists the whole organization's. */
  captured_by: z.string().uuid().nullable(),
  /** Their display name from `users.profiles`; null when it could not be read. */
  captured_by_name: z.string().nullable().default(null),
});
export type SavedCaptureSummary = z.infer<typeof SavedCaptureSummarySchema>;

export const SavedCaptureSchema = SavedCaptureSummarySchema.extend({
  /** The capture's collectors (images, videos, audio, links, ld_json, metadata, pattern_id). */
  structured: z.record(z.unknown()).nullable(),
  /** The landed text, all portions joined. */
  content: z.string().nullable(),
  /** The person's edited text, when they saved an edit (read through canonical_clean_id). */
  edited_content: z.string().nullable(),
  /** The full SoupResult JSON kept in S3 (null when the organization keeps text only). */
  original_file_id: z.string().uuid().nullable(),
  visibility: z.string().nullable(),
});
export type SavedCapture = z.infer<typeof SavedCaptureSchema>;

const SOURCE_SUMMARY_COLUMNS =
  'id, url:canonical_identity, captured_at:created_at, updated_at, title:name, description:structured_json->metadata->>description, kept_at, captured_by:created_by';
const SOURCE_DETAIL_COLUMNS = `${SOURCE_SUMMARY_COLUMNS}, structured:structured_json, content, canonical_clean_id, original_file_id, visibility`;

export interface SavedCapturePage {
  rows: SavedCaptureSummary[];
  /** Rows the database returned that could not be read — counted and shown, never silently dropped. */
  unreadable: number;
  /** How many rows the database returned (drives "Load more"). */
  fetched: number;
}

/**
 * Display names for the members who captured Sources (`users.profiles`). A name
 * that cannot be read is simply absent — the tab then says "another member",
 * never a wrong name; a failed lookup is logged, not thrown (the list itself
 * already loaded).
 */
export async function capturedByNames(
  ids: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const unique = [...new Set(ids.filter((id): id is string => typeof id === 'string'))];
  if (unique.length === 0) return names;
  try {
    const { data, error } = await usersDb()
      .from('profiles')
      .select('id, display_name')
      .in('id', unique);
    if (error) {
      log.warn('supabase', 'capturedByNames failed', { message: error.message });
      return names;
    }
    for (const row of (data ?? []) as { id: string; display_name: string | null }[]) {
      const label = row.display_name?.trim();
      if (label) names.set(row.id, label);
    }
  } catch (err) {
    log.warn('supabase', 'capturedByNames failed', { message: String(err) });
  }
  return names;
}

export async function listSavedCaptures(
  options: {
    limit?: number;
    search?: string;
    before?: Pick<SavedCaptureSummary, 'captured_at' | 'id'>;
  } = {},
): Promise<SavedCapturePage> {
  const limit = options.limit ?? 40;
  const organizationId = await requireRequestOrganizationId();
  let query = docprocDb()
    .from('processed_documents')
    .select(SOURCE_SUMMARY_COLUMNS)
    .eq('origin_client', SOURCE_ORIGIN_EXTENSION)
    .eq('organization_id', organizationId)
    .in('derivation_kind', CAPTURE_DERIVATIONS)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });
  const search = options.search?.trim();
  if (search) {
    // PostgREST's raw `or` grammar requires quoted values. Escape the two
    // characters that are meaningful inside those quoted filter values so a
    // title search cannot alter the filter expression.
    const escaped = search.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const pattern = `"%${escaped}%"`;
    query = query.or(`name.ilike.${pattern},canonical_identity.ilike.${pattern}`);
  }
  if (options.before) {
    query = query.or(
      `created_at.lt.${options.before.captured_at},and(created_at.eq.${options.before.captured_at},id.lt.${options.before.id})`,
    );
  }
  const { data, error } = await query.limit(limit);
  if (error) throw new Error(`Could not load saved captures: ${error.message}`);
  const parsed = parseRowsSafe(
    SavedCaptureSummarySchema,
    (data ?? []) as unknown[],
    'listSavedCaptures',
  );
  const superseded = await supersededSourceIds(parsed.rows.map((r) => r.id));
  const live = parsed.rows.filter((r) => !superseded.has(r.id));
  const names = await capturedByNames(live.map((r) => r.captured_by));
  return {
    rows: live.map((r) => ({
      ...r,
      captured_by_name: (r.captured_by && names.get(r.captured_by)) ?? null,
    })),
    unreadable: parsed.badCount,
    fetched: (data ?? []).length,
  };
}

export async function getSavedCapture(sourceId: string): Promise<SavedCapture | null> {
  const organizationId = await requireRequestOrganizationId();
  const { data, error } = await docprocDb()
    .from('processed_documents')
    .select(SOURCE_DETAIL_COLUMNS)
    .eq('id', sourceId)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error(`Could not load saved capture: ${error.message}`);
  if (!data) return null;
  const row = data as unknown as Record<string, unknown>;
  let editedContent: string | null = null;
  const cleanId = typeof row.canonical_clean_id === 'string' ? row.canonical_clean_id : null;
  if (cleanId && cleanId !== sourceId) {
    const edited = await docprocDb()
      .from('processed_documents')
      .select('content')
      .eq('id', cleanId)
      .maybeSingle();
    if (edited.error) throw new Error(`Could not load your edit: ${edited.error.message}`);
    editedContent = (edited.data as { content: string | null } | null)?.content ?? null;
  }
  const parsed = SavedCaptureSchema.safeParse({ ...row, edited_content: editedContent });
  if (!parsed.success) {
    log.error('supabase', 'getSavedCapture: row failed validation', parsed.error.issues);
    throw new Error('This saved capture has an invalid data shape.');
  }
  return parsed.data;
}

/**
 * Soft-delete a saved Source. Proves the write landed: a refused update (RLS
 * filtering the returned row away) throws with the sentence the person saw,
 * never a success-shaped nothing.
 */
export async function deleteSavedCapture(sourceId: string): Promise<void> {
  const site: DbCallSite = {
    table: 'docproc.processed_documents',
    operation: 'update',
    what: 'delete this saved capture',
    title: 'Saved capture not deleted',
  };
  let organizationId: string;
  try {
    organizationId = await requireRequestOrganizationId();
  } catch (error) {
    failDbCall(site, {
      code: 'no_organization',
      message: error instanceof Error ? error.message : String(error),
    });
  }
  const { data, error } = await docprocDb()
    .from('processed_documents')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', sourceId)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .select('id, deleted_at')
    .maybeSingle();
  const landed = data as { id: string; deleted_at: string | null } | null;
  if (error || !landed?.deleted_at) failDbCall(site, error);
}

// ─── wbx_pattern (extraction patterns) ──────────────────────────────────────
export const PATTERN_KINDS = [
  'manual_css',
  'json_ld',
  'og_meta',
  'auto_table',
  'next_data',
  'ai_extract',
  'list_pattern',
  'microdata',
  'network_capture',
] as const;
export type PatternKind = (typeof PATTERN_KINDS)[number];

export const FieldSelectorSchema = z.object({
  type: z.enum(['css', 'xpath', 'text-anchor', 'aria-path']),
  value: z.string(),
  confidence: z.number().min(0).max(1).optional(),
});
export type FieldSelector = z.infer<typeof FieldSelectorSchema>;

export const ExtractionPatternFieldSchema = z.object({
  name: z.string(),
  selector: z.string(),
  selectors: z.array(FieldSelectorSchema).optional(),
  xpath_fallback: z.string().optional(),
  attr: z.string().optional(),
  is_list: z.boolean().default(false),
  transform: z
    .object({
      kind: z.enum(['regex', 'date', 'number']),
      expr: z.string(),
    })
    .optional(),
});
export type ExtractionPatternField = z.infer<typeof ExtractionPatternFieldSchema>;

export const ExtractionPatternSchema = z.object({
  id: z.string().uuid(),
  created_by: z.string().uuid().nullable(),
  name: z.string(),
  domain: z.string(),
  route_pattern: z.string().nullable(),
  list_root_selector: z.string().nullable(),
  fields: z.array(ExtractionPatternFieldSchema),
  kind: z.enum(PATTERN_KINDS).default('manual_css'),
  config: z.unknown().default({}),
  target_user_table_id: z.string().uuid().nullable().default(null),
  last_used_at: z.string().nullable(),
  last_run_at: z.string().nullable().default(null),
  last_status: z.enum(['ok', 'broken', 'never_run']).nullable().default(null),
  last_run_count: z.number().nullable().default(null),
  created_at: z.string(),
});
export type ExtractionPattern = z.infer<typeof ExtractionPatternSchema>;

export async function fetchPatternsForDomain(domain: string): Promise<ExtractionPattern[]> {
  const c = getSupabase();
  const { data, error } = await c
    .schema(EXTEND_SCHEMA)
    .from('wbx_pattern')
    .select('*')
    .eq('domain', domain)
    .order('last_used_at', { ascending: false, nullsFirst: false });
  if (error) {
    // Pre-migration installs have no table — genuinely "no patterns".
    if (/relation .* does not exist/i.test(error.message)) return [];
    // Anything else (network, timeout, 5xx) must NOT masquerade as an empty
    // list — callers render "no saved patterns" for []. Let them show an error.
    throw new Error(`Could not load saved patterns: ${error.message}`);
  }
  return parseRowsSafe(ExtractionPatternSchema, (data ?? []) as unknown[], 'fetchPatternsForDomain')
    .rows;
}

export type SavePatternInput = {
  /**
   * DD-131 — who caused this save. `'agent'` (the `data_patterns` tool acting
   * inside a model's turn) rides the agent-authored client and declares
   * `x-matrx-actor-tier: ai`; `'person'` (the Data / Showcase tab's own Save
   * button) rides the ordinary client and declares nothing. Required, with no
   * default, so the channel is visible in the calling line.
   */
  authored_by: WriteActor;
  /** Immutable organization captured when this save action begins. */
  organization_id: string;
  name: string;
  domain: string;
  route_pattern: string | null;
  list_root_selector: string | null;
  fields: ExtractionPatternField[];
  kind?: PatternKind;
  config?: unknown;
  target_user_table_id?: string | null;
};

export async function savePattern(p: SavePatternInput): Promise<{ id: string } | null> {
  const organizationId = requireOrganizationContext(p.organization_id);
  const c = supabaseForActor(p.authored_by);
  // UNIQUE(created_by, domain, name) — on a name collision, auto-suffix
  // "name (2)", "name (3)", … instead of failing the save (decision D3).
  for (let attempt = 0; attempt < 5; attempt++) {
    const name = attempt === 0 ? p.name : `${p.name} (${attempt + 1})`;
    const { data, error } = await c
      .schema(EXTEND_SCHEMA)
      .from('wbx_pattern')
      .insert({
        organization_id: organizationId,
        name,
        domain: p.domain,
        route_pattern: p.route_pattern,
        list_root_selector: p.list_root_selector,
        fields: p.fields,
        kind: p.kind ?? 'manual_css',
        config: p.config ?? {},
        target_user_table_id: p.target_user_table_id ?? null,
      })
      .select('id')
      .single();
    if (!error) return data as { id: string };
    if (error.code !== '23505') {
      console.warn('[matrx-extend] savePattern error', error.message);
      return null;
    }
  }
  console.warn('[matrx-extend] savePattern: name collision persisted after 5 attempts');
  return null;
}

/**
 * Hard-delete a saved pattern. Returns false (with a console.warn) on failure.
 *
 * `authoredBy` is DD-131's actor declaration: `'agent'` when the `data_patterns`
 * tool deletes during a model's turn, `'person'` when someone clicks Delete in
 * the Patterns tab. Required — a deletion is exactly the kind of write nobody
 * should have to guess the author of.
 */
export async function deletePattern(patternId: string, authoredBy: WriteActor): Promise<boolean> {
  const c = supabaseForActor(authoredBy);
  const { error } = await c.schema(EXTEND_SCHEMA).from('wbx_pattern').delete().eq('id', patternId);
  if (error) {
    console.warn('[matrx-extend] deletePattern error', error.message);
    return false;
  }
  return true;
}

/**
 * Rename a saved pattern. Returns an error string suitable for inline display
 * (e.g. on a name collision within the same domain), or null on success.
 */
export async function renamePattern(patternId: string, name: string): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed) return 'Name cannot be empty.';
  const c = getSupabase();
  const { error } = await c
    .schema(EXTEND_SCHEMA)
    .from('wbx_pattern')
    .update({ name: trimmed })
    .eq('id', patternId);
  if (error) {
    if (error.code === '23505') return 'A pattern with that name already exists for this site.';
    console.warn('[matrx-extend] renamePattern error', error.message);
    return `Rename failed: ${error.message}`;
  }
  return null;
}

/**
 * Update rolling health columns after a pattern run. Status drives the badge
 * shown next to saved patterns and the backend's broken-pattern queue.
 *
 * DD-131 (B-44): this is bookkeeping the extension's own code performs after
 * ANY run finishes — whether a person clicked "run" or an agent's tool call
 * drove it — so it rides the machinery-authored client and declares
 * `x-matrx-actor-tier: code`, never the person's or the agent's channel.
 */
export async function bumpPatternRun(
  patternId: string,
  status: 'ok' | 'broken',
  rowCount: number,
): Promise<void> {
  const c = getMachineryAuthoredSupabase();
  await c
    .schema(EXTEND_SCHEMA)
    .from('wbx_pattern')
    .update({
      last_run_at: new Date().toISOString(),
      last_used_at: new Date().toISOString(),
      last_status: status,
      last_run_count: rowCount,
    })
    .eq('id', patternId);
}

// ─── wbx_seo_audit (SEO audits + recommendations) ───────────────────────────
export const SeoAuditRowSchema = z.object({
  id: z.string().uuid(),
  url: z.string(),
  audited_at: z.string(),
  signals: z.unknown(),
  recommendations: z.unknown().nullable(),
  flesch_reading_ease: z.number().nullable(),
  word_count: z.number().int().nullable(),
  notes: z.string().nullable(),
});
export type SeoAuditRow = z.infer<typeof SeoAuditRowSchema>;

export interface SaveSeoAuditPayload {
  url: string;
  signals: unknown;
  /** Bind an audit accompanying a Source landing to the organization that received it. */
  organizationId?: string;
  flesch_reading_ease?: number | null;
  word_count?: number | null;
  notes?: string | null;
}

export async function saveSeoAudit(p: SaveSeoAuditPayload): Promise<{ id: string } | null> {
  let organizationId: string;
  try {
    organizationId = p.organizationId ?? (await requireRequestOrganizationId());
  } catch (error) {
    console.warn('[matrx-extend] saveSeoAudit refused: missing request organization', error);
    return null;
  }
  const c = getSupabase();
  const { data, error } = await c
    .schema(EXTEND_SCHEMA)
    .from('wbx_seo_audit')
    .insert({
      organization_id: organizationId,
      url: p.url,
      signals: p.signals,
      flesch_reading_ease: p.flesch_reading_ease ?? null,
      word_count: p.word_count ?? null,
      notes: p.notes ?? null,
    })
    .select('id')
    .single();
  if (error) {
    console.warn('[matrx-extend] saveSeoAudit error', error.message);
    return null;
  }
  return data as { id: string };
}

export async function fetchLatestSeoAuditForUrl(url: string): Promise<SeoAuditRow | null> {
  const c = getSupabase();
  const { data, error } = await c
    .schema(EXTEND_SCHEMA)
    .from('wbx_seo_audit')
    .select('id, url, audited_at, signals, recommendations, flesch_reading_ease, word_count, notes')
    .eq('url', url)
    .order('audited_at', { ascending: false })
    .limit(1);
  if (error) {
    if (/relation .* does not exist/i.test(error.message)) return null;
    console.warn('[matrx-extend] fetchLatestSeoAuditForUrl error', error.message);
    return null;
  }
  const row = (data ?? [])[0];
  if (!row) return null;
  const parsedSeo = SeoAuditRowSchema.safeParse(row);
  if (!parsedSeo.success) {
    log.error(
      'supabase',
      'fetchLatestSeoAuditForUrl: row failed validation',
      parsedSeo.error.issues,
    );
    return null;
  }
  return parsedSeo.data;
}

/**
 * The saved audit history for a URL, most recent first. Sibling of
 * `fetchLatestSeoAuditForUrl` (which is just this with limit 1) — the SEO tab
 * needs the previous row to DIFF against and the older rows to browse, and
 * accumulating rows nobody can read again is the defect this closes.
 *
 * `extend` is reached via `extendDb()`; ownership on wbx_* is `created_by`
 * (stamped by a trigger), so RLS scopes these rows to the signed-in user with
 * no client-side filter.
 */
export async function fetchSeoAuditHistoryForUrl(url: string, limit = 25): Promise<SeoAuditRow[]> {
  const { data, error } = await extendDb()
    .from('wbx_seo_audit')
    .select('id, url, audited_at, signals, recommendations, flesch_reading_ease, word_count, notes')
    .eq('url', url)
    .order('audited_at', { ascending: false })
    .limit(limit);
  if (error) {
    if (/relation .* does not exist/i.test(error.message)) return [];
    console.warn('[matrx-extend] fetchSeoAuditHistoryForUrl error', error.message);
    return [];
  }
  return parseRowsSafe(SeoAuditRowSchema, data ?? [], 'fetchSeoAuditHistoryForUrl').rows;
}

export async function attachSeoRecommendations(
  auditId: string,
  recommendations: unknown,
): Promise<void> {
  const c = getSupabase();
  const { error } = await c
    .schema(EXTEND_SCHEMA)
    .from('wbx_seo_audit')
    .update({ recommendations })
    .eq('id', auditId);
  if (error) console.warn('[matrx-extend] attachSeoRecommendations error', error.message);
}

// ─── wbx_screenshot (per-page screenshot history) ───────────────────────────
export const ScreenshotSourceSchema = z.enum(['agent', 'user', 'unknown']);
export type ScreenshotSource = z.infer<typeof ScreenshotSourceSchema>;

export const ScreenshotRowSchema = z.object({
  id: z.string().uuid(),
  page_url_canonical: z.string(),
  page_url_full: z.string(),
  page_title: z.string().nullable(),
  file_id: z.string().uuid(),
  file_url: z.string().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  mime_type: z.string().nullable(),
  byte_length: z.number().int().nullable(),
  source: ScreenshotSourceSchema,
  captured_at: z.string(),
});
export type ScreenshotRow = z.infer<typeof ScreenshotRowSchema>;

export interface SaveScreenshotPayload {
  page_url_canonical: string;
  page_url_full: string;
  page_title?: string | null;
  file_id: string;
  file_url?: string | null;
  width?: number | null;
  height?: number | null;
  mime_type?: string | null;
  byte_length?: number | null;
  source: ScreenshotSource;
}

/**
 * Insert a screenshot index row. The image bytes themselves must already
 * be in cld_files via uploadFile(); this function only stores the pointer
 * + per-page metadata so the Screenshots side-panel tab can list them.
 */
export async function saveScreenshot(p: SaveScreenshotPayload): Promise<{ id: string } | null> {
  let organizationId: string;
  try {
    organizationId = await requireRequestOrganizationId();
  } catch (error) {
    console.warn('[matrx-extend] saveScreenshot refused: missing request organization', error);
    return null;
  }
  // DD-131: `source` already records who took the shot, so the write channel
  // follows it — an agent capture declares `x-matrx-actor-tier: ai`, the user's
  // own "Take screenshot" button declares nothing. ('unknown' is treated as the
  // person channel: absent means human, and inventing an agent claim is worse
  // than the default.)
  const c = supabaseForActor(p.source === 'agent' ? 'agent' : 'person');
  const { data, error } = await c
    .schema(EXTEND_SCHEMA)
    .from('wbx_screenshot')
    .insert({
      organization_id: organizationId,
      page_url_canonical: p.page_url_canonical,
      page_url_full: p.page_url_full,
      page_title: p.page_title ?? null,
      file_id: p.file_id,
      file_url: p.file_url ?? null,
      width: p.width ?? null,
      height: p.height ?? null,
      mime_type: p.mime_type ?? null,
      byte_length: p.byte_length ?? null,
      source: p.source,
    })
    .select('id')
    .single();
  if (error) {
    if (/relation .* does not exist/i.test(error.message)) return null;
    console.warn('[matrx-extend] saveScreenshot error', error.message);
    return null;
  }
  return data as { id: string };
}

export async function fetchScreenshotsForUrl(
  pageUrlCanonical: string,
  limit = 100,
): Promise<ScreenshotRow[]> {
  const c = getSupabase();
  const { data, error } = await c
    .schema(EXTEND_SCHEMA)
    .from('wbx_screenshot')
    .select(
      'id, page_url_canonical, page_url_full, page_title, file_id, file_url, width, height, mime_type, byte_length, source, captured_at',
    )
    .eq('page_url_canonical', pageUrlCanonical)
    .order('captured_at', { ascending: false })
    .limit(limit);
  if (error) {
    if (/relation .* does not exist/i.test(error.message)) return [];
    throw new Error(`fetchScreenshotsForUrl: ${error.message}`);
  }
  return parseRowsSafe(ScreenshotRowSchema, (data ?? []) as unknown[], 'fetchScreenshotsForUrl')
    .rows;
}

/** Cross-page screenshot history for the Files tab, newest first. */
export async function fetchRecentScreenshots(limit = 100): Promise<ScreenshotRow[]> {
  const c = getSupabase();
  const { data, error } = await c
    .schema(EXTEND_SCHEMA)
    .from('wbx_screenshot')
    .select(
      'id, page_url_canonical, page_url_full, page_title, file_id, file_url, width, height, mime_type, byte_length, source, captured_at',
    )
    .order('captured_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));
  if (error) {
    if (/relation .* does not exist/i.test(error.message)) return [];
    throw new Error(`fetchRecentScreenshots: ${error.message}`);
  }
  return parseRowsSafe(ScreenshotRowSchema, (data ?? []) as unknown[], 'fetchRecentScreenshots')
    .rows;
}

export async function deleteScreenshot(id: string): Promise<boolean> {
  const c = getSupabase();
  const { error } = await c.schema(EXTEND_SCHEMA).from('wbx_screenshot').delete().eq('id', id);
  if (error) {
    console.warn('[matrx-extend] deleteScreenshot error', error.message);
    return false;
  }
  return true;
}

// ─── wbx_guidance (cloud-synced guidance metadata, TASK-004) ────────────────
/**
 * One guidance index row. The `id` is the CLIENT-generated guidance id
 * (`gd_<ts>_<rand>`, a text PK — not a uuid) so the local chrome.storage.local
 * cache and the cloud row map 1:1. Kind-specific fields live in the `data`
 * jsonb so the GuidanceItem discriminated union survives the round-trip.
 * Heavy bytes stay in cld_files; `data` only carries pointers.
 */
export const WbxGuidanceRowSchema = z.object({
  id: z.string(),
  domain: z.string(),
  kind: z.string(),
  caption: z.string().nullable(),
  origin_url: z.string().nullable(),
  data: z.unknown().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  /** Tombstone — deletes propagate as soft-deletes so other machines can apply them. */
  is_deleted: z.boolean().default(false),
});
export type WbxGuidanceRow = z.infer<typeof WbxGuidanceRowSchema>;

export interface SaveGuidanceRowPayload {
  id: string;
  domain: string;
  kind: string;
  caption?: string | null;
  origin_url?: string | null;
  data: unknown;
  /** ISO timestamps (the client stores epoch-ms; the cloud-sync mapper converts). */
  created_at: string;
  updated_at: string;
}

/**
 * Upsert one guidance row keyed by its client id. Actor attribution is stamped
 * server-side; organization identity is required from the initiating request.
 */
export async function upsertGuidanceRow(p: SaveGuidanceRowPayload): Promise<boolean> {
  let organizationId: string;
  try {
    organizationId = await requireRequestOrganizationId();
  } catch (error) {
    console.warn('[matrx-extend] upsertGuidanceRow refused: missing request organization', error);
    return false;
  }
  const c = getSupabase();
  const { error } = await c
    .schema(EXTEND_SCHEMA)
    .from('wbx_guidance')
    .upsert(
      {
        organization_id: organizationId,
        id: p.id,
        domain: p.domain,
        kind: p.kind,
        caption: p.caption ?? null,
        origin_url: p.origin_url ?? null,
        data: p.data ?? {},
        created_at: p.created_at,
        updated_at: p.updated_at,
        // An intentional save revives a tombstoned row — the user actively
        // edited it on this machine, which outranks an older delete.
        is_deleted: false,
      },
      { onConflict: 'id' },
    );
  if (error) {
    if (/relation .* does not exist/i.test(error.message)) return false;
    console.warn('[matrx-extend] upsertGuidanceRow error', error.message);
    return false;
  }
  return true;
}

export async function deleteGuidanceRow(id: string): Promise<boolean> {
  const c = getSupabase();
  // SOFT delete (tombstone) — a hard DELETE left nothing for other
  // machines' hydrate to apply, so deletes never propagated and a later
  // edit on a stale machine resurrected the item everywhere.
  const { error } = await c
    .schema(EXTEND_SCHEMA)
    .from('wbx_guidance')
    .update({ is_deleted: true, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) {
    if (/relation .* does not exist/i.test(error.message)) return false;
    console.warn('[matrx-extend] deleteGuidanceRow error', error.message);
    return false;
  }
  return true;
}

/** Fetch all of the signed-in user's guidance rows (RLS scopes to the owner). */
export async function fetchAllGuidanceRows(): Promise<WbxGuidanceRow[]> {
  const c = getSupabase();
  const { data, error } = await c
    .schema(EXTEND_SCHEMA)
    .from('wbx_guidance')
    .select('id, domain, kind, caption, origin_url, data, created_at, updated_at, is_deleted')
    .order('updated_at', { ascending: false });
  if (error) {
    if (/relation .* does not exist/i.test(error.message)) return [];
    console.warn('[matrx-extend] fetchAllGuidanceRows error', error.message);
    return [];
  }
  return parseRowsSafe(WbxGuidanceRowSchema, (data ?? []) as unknown[], 'fetchAllGuidanceRows')
    .rows;
}

// ─── wbx_demo (cloud-synced recorded demo BODIES) ───────────────────────────
/**
 * One recorded-demo row. `demo_key` is the CLIENT-generated demo id (`demo_<uuid>`,
 * a text PK — not a uuid) so a guidance `demo_ref` pointer stays valid across
 * machines with no id-translation layer.
 *
 * The full Demo record lives in `body`; the summary columns are denormalised so
 * a list query never has to pull it. The client's own epoch-ms timestamps live
 * INSIDE `body` — the platform `_100_touch_row` trigger overwrites the
 * `updated_at` column with now() on every write, so that column is server
 * bookkeeping and cannot drive cross-machine last-write-wins.
 */
export const WbxDemoRowSchema = z.object({
  /**
   * DD-173 (B-103): the client demo id moved off `id` to `demo_key` when
   * `extend.wbx_demo` gained its canonical uuid identity. `demo_key` is still
   * the CLIENT-generated `demo_<uuid>` text pointer a guidance `demo_ref`
   * carries across machines; the uuid `id` is a surrogate nothing here reads.
   */
  demo_key: z.string(),
  name: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  start_url: z.string().nullable().default(null),
  step_count: z.number().nullable().default(null),
  parameter_names: z.array(z.string()).nullable().default(null),
  body: z.unknown().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  /** Tombstone — deletes propagate as soft-deletes so other machines can apply them. */
  is_deleted: z.boolean().default(false),
});
export type WbxDemoRow = z.infer<typeof WbxDemoRowSchema>;

export interface SaveDemoRowPayload {
  /** The client-generated `demo_<uuid>` pointer — `extend.wbx_demo.demo_key`. */
  demo_key: string;
  name: string;
  description: string;
  start_url: string;
  step_count: number;
  parameter_names: string[];
  /** The full Demo record, including its client epoch-ms timestamps. */
  body: unknown;
}

const DEMO_ROW_COLUMNS =
  'demo_key, name, description, start_url, step_count, parameter_names, body, created_at, updated_at, is_deleted';

/**
 * Upsert one demo row keyed by its client id. Actor attribution is stamped
 * server-side; organization identity is required from the initiating request.
 */
export async function upsertDemoRow(p: SaveDemoRowPayload): Promise<boolean> {
  let organizationId: string;
  try {
    organizationId = await requireRequestOrganizationId();
  } catch (error) {
    console.warn('[matrx-extend] upsertDemoRow refused: missing request organization', error);
    return false;
  }
  const c = getSupabase();
  const { error } = await c
    .schema(EXTEND_SCHEMA)
    .from('wbx_demo')
    .upsert(
      {
        organization_id: organizationId,
        demo_key: p.demo_key,
        name: p.name,
        description: p.description,
        start_url: p.start_url,
        step_count: p.step_count,
        parameter_names: p.parameter_names,
        body: p.body ?? {},
        // An intentional save revives a tombstoned row — the user actively
        // re-recorded/edited it here, which outranks an older delete.
        is_deleted: false,
      },
      { onConflict: 'demo_key' },
    );
  if (error) {
    if (/relation .* does not exist/i.test(error.message)) return false;
    console.warn('[matrx-extend] upsertDemoRow error', error.message);
    return false;
  }
  return true;
}

/** Soft-delete (tombstone) one demo row so other machines' hydrate can apply it. */
export async function deleteDemoRow(id: string): Promise<boolean> {
  const c = getSupabase();
  const { error } = await c
    .schema(EXTEND_SCHEMA)
    .from('wbx_demo')
    .update({ is_deleted: true })
    .eq('demo_key', id);
  if (error) {
    if (/relation .* does not exist/i.test(error.message)) return false;
    console.warn('[matrx-extend] deleteDemoRow error', error.message);
    return false;
  }
  return true;
}

/** Fetch all of the signed-in user's demo rows (RLS scopes to the owner). */
export async function fetchAllDemoRows(): Promise<WbxDemoRow[]> {
  const c = getSupabase();
  const { data, error } = await c
    .schema(EXTEND_SCHEMA)
    .from('wbx_demo')
    .select(DEMO_ROW_COLUMNS)
    .order('updated_at', { ascending: false });
  if (error) {
    if (/relation .* does not exist/i.test(error.message)) return [];
    console.warn('[matrx-extend] fetchAllDemoRows error', error.message);
    return [];
  }
  return parseRowsSafe(WbxDemoRowSchema, (data ?? []) as unknown[], 'fetchAllDemoRows').rows;
}

/**
 * Fetch ONE demo row by client id. Used for the on-miss repair path: a
 * `demo_ref` synced ahead of its body (or a machine that never ran the sign-in
 * hydrate) pulls just the one demo it needs instead of failing the replay.
 */
export async function fetchDemoRow(id: string): Promise<WbxDemoRow | null> {
  const c = getSupabase();
  const { data, error } = await c
    .schema(EXTEND_SCHEMA)
    .from('wbx_demo')
    .select(DEMO_ROW_COLUMNS)
    .eq('demo_key', id)
    .maybeSingle();
  if (error) {
    if (/relation .* does not exist/i.test(error.message)) return null;
    console.warn('[matrx-extend] fetchDemoRow error', error.message);
    return null;
  }
  if (!data) return null;
  const parsed = WbxDemoRowSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}
