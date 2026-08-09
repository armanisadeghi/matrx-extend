/**
 * Direct, RLS-gated Supabase reads from the extension. The publishable key +
 * the user's JWT (set via setSupabaseSession) gates rows server-side.
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
 * Tables this extension OWNS now live in the dedicated `extend` schema
 * (moved out of public in the 2026-06-27 DB transition — reached via
 * `.schema('extend')`, see EXTEND_SCHEMA below):
 *   - extend.wbx_capture        (Page captures from Scrape tab)
 *   - extend.wbx_pattern        (Saved Data-tab patterns)
 *   - extend.wbx_seo_audit      (SEO audits + AI recommendations)
 *   - extend.wbx_screenshot · extend.wbx_guidance · extend.wbx_demo · extend.wbx_highlight · extend.wbx_recipe
 */

import { DEFAULT_AGENDA_AGENT_ID } from '@/lib/agenda/constants';
import { log } from '@/lib/debug/log';
import { getSupabase } from '@/lib/supabase/client';
import { adminDb, aiDb, extendDb } from '@/lib/supabase/schemas';
import type { ChatMessage, MessagePart } from '@/state/chat';
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
 */
export async function checkIsAdmin(userId: string): Promise<boolean> {
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
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

// ─── Agents (via agx_get_list_full RPC) ─────────────────────────────────────
/**
 * Listing-shape returned by the `agx_get_list_full()` Supabase RPC.
 *
 * Why the RPC instead of `from('agx_agent').select(...)`:
 *   - Includes shared agents and system "builtin" agents the user has access
 *     to, not just rows on agx_agent the user owns
 *   - Lighter (no `messages` JSONB, no `variable_definitions`, no `context_slots`)
 *   - Doesn't leak the agent's "secret sauce" (system instructions etc.)
 */
export const AgxAgentSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  agent_type: z.string().nullable(),
  category: z.string().nullable(),
  tags: z.array(z.string()).nullable(),
  model_id: z.string().uuid().nullable(),
  is_active: z.boolean().nullable(),
  is_archived: z.boolean().nullable(),
  is_favorite: z.boolean().nullable(),
  is_owner: z.boolean().nullable(),
  access_level: z.string().nullable(),
  shared_by_email: z.string().nullable(),
  source_agent_id: z.string().uuid().nullable(),
  user_id: z.string().uuid().nullable(),
  organization_id: z.string().uuid().nullable(),
  project_id: z.string().uuid().nullable(),
  task_id: z.string().uuid().nullable(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
});
export type AgxAgent = z.infer<typeof AgxAgentSchema>;

/**
 * Synthetic fallback agent. Injected only when `agx_get_list_full()`
 * returns an empty list — the canonical situation is a freshly-signed-up
 * user (or a Web Store reviewer) with no owned or shared agents yet.
 * Without this, the empty-state suggestion chips (including the
 * Chrome-flagged "Analyze the current page") were silent no-ops because
 * their submit path needs an agent id. ID matches the platform's default
 * routing agent and is also referenced from agenda/constants.ts.
 */
const FALLBACK_DEFAULT_AGENT: AgxAgent = {
  id: DEFAULT_AGENDA_AGENT_ID,
  name: 'Matrx Assistant',
  description: 'Default Matrx agent. Try any of the suggestions below.',
  agent_type: null,
  category: null,
  tags: null,
  model_id: null,
  is_active: true,
  is_archived: false,
  is_favorite: false,
  is_owner: false,
  access_level: 'public',
  shared_by_email: null,
  source_agent_id: null,
  user_id: null,
  organization_id: null,
  project_id: null,
  task_id: null,
  created_at: null,
  updated_at: null,
};

export async function fetchAgentList(): Promise<AgxAgent[]> {
  const c = getSupabase();
  const { data, error } = await c.rpc('agx_get_list_full');
  if (error) {
    console.warn('[matrx-extend] fetchAgentList error', error.message);
    return [FALLBACK_DEFAULT_AGENT];
  }
  // RLS + RPC body filter actives/non-archived already, but be defensive.
  // Per-row safeParse (audit P2-18): one malformed agent row used to reject
  // the whole fetch and brick the chat surface (agents never loaded).
  const all = parseRowsSafe(AgxAgentSchema, (data ?? []) as unknown[], 'fetchAgentList').rows;
  const visible = all
    .filter((a) => a.is_active !== false && a.is_archived !== true)
    .sort((a, b) => {
      // Favorites first, then alphabetical by name.
      const fa = a.is_favorite ? 1 : 0;
      const fb = b.is_favorite ? 1 : 0;
      if (fa !== fb) return fb - fa;
      return a.name.localeCompare(b.name);
    });
  return visible.length > 0 ? visible : [FALLBACK_DEFAULT_AGENT];
}

/** Backwards-compat shim — older callers reference `fetchUserAgents`. */
export const fetchUserAgents = (_userId?: string): Promise<AgxAgent[]> => fetchAgentList();

// ─── ai.model_definition (admin model picker) ───────────────────────────────
export const AiModelSchema = z.object({
  id: z.string().uuid(),
  common_name: z.string(),
  is_deprecated: z.boolean().nullable(),
});
export type AiModel = z.infer<typeof AiModelSchema>;

/**
 * Fetch active (non-deprecated) AI models. Used by the admin Debug-tab
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
    .eq('is_deprecated', false)
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
    console.warn('[matrx-extend] fetchConversationHistory error', error.message);
    return [];
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
    return { rows: [], badCount: 0 };
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
  message_id: z.string().uuid(),
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
    if (/relation .* does not exist/i.test(error.message)) return { rows: [], badCount: 0 };
    log.error('supabase', 'fetchConversationToolCalls: supabase error', {
      conversation_id: conversationId,
      message: error.message,
      code: (error as { code?: string }).code,
    });
    return { rows: [], badCount: 0 };
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
      const last = out[out.length - 1];
      if (last?.role !== 'assistant' || !last.parts) return;
      for (const block of blocks) {
        if (block.type !== 'tool_result') continue;
        const callId = String(block.call_id ?? block.tool_use_id ?? '');
        if (!callId) continue;
        const part = last.parts.find((p) => p.type === 'tool' && p.tool.callId === callId);
        if (!part || part.type !== 'tool') continue;
        const tc = byCallId.get(callId);
        const isError = Boolean(tc?.is_error ?? block.is_error);
        part.tool.phase = isError ? 'error' : 'completed';
        part.tool.result = parseToolOutput(tc?.output);
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
      } else if (type === 'tool_call') {
        const callId = String(block.call_id ?? '');
        const toolName = String(block.name ?? '');
        if (!callId || !toolName) continue;
        // tool_type may be discovered later via the chat.tool_call lookup;
        // assume 'client' by default (the registry doesn't care about
        // kind for resolution — only the outer wrapper styling).
        const lookup = byCallId.get(callId);
        const kind: 'server' | 'client' = lookup?.tool_type === 'local' ? 'client' : 'server';
        parts.push({
          type: 'tool',
          tool: {
            kind,
            callId,
            toolName,
            args: block.arguments,
            phase: 'started',
            startedAt: createdAt,
          },
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

// ─── wbx_capture (page captures) ────────────────────────────────────────────
export const CapturedPageSchema = z.object({
  id: z.string().uuid(),
  url: z.string(),
  captured_at: z.string(),
  title: z.string().nullable(),
});
export type CapturedPage = z.infer<typeof CapturedPageSchema>;

export async function lookupCapturedByUrl(url: string): Promise<CapturedPage | null> {
  const c = getSupabase();
  const { data, error } = await c
    .schema(EXTEND_SCHEMA)
    .from('wbx_capture')
    .select('id, url, captured_at, title')
    .eq('url', url)
    .order('captured_at', { ascending: false })
    .limit(1);
  if (error) {
    if (/relation .* does not exist/i.test(error.message)) return null;
    console.warn('[matrx-extend] lookupCapturedByUrl error', error.message);
    return null;
  }
  const row = (data ?? [])[0];
  if (!row) return null;
  const parsed = CapturedPageSchema.safeParse(row);
  if (!parsed.success) {
    log.error('supabase', 'lookupCapturedByUrl: row failed validation', parsed.error.issues);
    return null;
  }
  return parsed.data;
}

export interface SaveCapturePayload {
  url: string;
  title?: string;
  description?: string;
  lang?: string;
  soup: unknown;
  markdown?: string;
  metadata?: unknown;
  ld_json?: unknown;
  media_count?: number;
  pattern_id?: string;
}

export async function saveCapture(p: SaveCapturePayload): Promise<{ id: string } | null> {
  const c = getSupabase();
  const { data, error } = await c
    .schema(EXTEND_SCHEMA)
    .from('wbx_capture')
    .insert({
      url: p.url,
      title: p.title ?? null,
      description: p.description ?? null,
      lang: p.lang ?? null,
      soup: p.soup,
      markdown: p.markdown ?? null,
      metadata: p.metadata ?? null,
      ld_json: p.ld_json ?? null,
      media_count: p.media_count ?? 0,
      pattern_id: p.pattern_id ?? null,
    })
    .select('id')
    .single();
  if (error) {
    console.warn('[matrx-extend] saveCapture error', error.message);
    return null;
  }
  return data as { id: string };
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
  const c = getSupabase();
  // UNIQUE(created_by, domain, name) — on a name collision, auto-suffix
  // "name (2)", "name (3)", … instead of failing the save (decision D3).
  for (let attempt = 0; attempt < 5; attempt++) {
    const name = attempt === 0 ? p.name : `${p.name} (${attempt + 1})`;
    const { data, error } = await c
      .schema(EXTEND_SCHEMA)
      .from('wbx_pattern')
      .insert({
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

/** Hard-delete a saved pattern. Returns false (with a console.warn) on failure. */
export async function deletePattern(patternId: string): Promise<boolean> {
  const c = getSupabase();
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
 */
export async function bumpPatternRun(
  patternId: string,
  status: 'ok' | 'broken',
  rowCount: number,
): Promise<void> {
  const c = getSupabase();
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
  flesch_reading_ease?: number | null;
  word_count?: number | null;
  notes?: string | null;
}

export async function saveSeoAudit(p: SaveSeoAuditPayload): Promise<{ id: string } | null> {
  const c = getSupabase();
  const { data, error } = await c
    .schema(EXTEND_SCHEMA)
    .from('wbx_seo_audit')
    .insert({
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
  const c = getSupabase();
  const { data, error } = await c
    .schema(EXTEND_SCHEMA)
    .from('wbx_screenshot')
    .insert({
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
 * Upsert one guidance row keyed by its client id. Ownership is set server-side
 * (`created_by` is stamped from `auth.uid()` on insert and the RLS UPDATE policy
 * pins existing rows to the owner), so a row can never change hands.
 */
export async function upsertGuidanceRow(p: SaveGuidanceRowPayload): Promise<boolean> {
  const c = getSupabase();
  const { error } = await c
    .schema(EXTEND_SCHEMA)
    .from('wbx_guidance')
    .upsert(
      {
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
 * One recorded-demo row. `id` is the CLIENT-generated demo id (`demo_<uuid>`,
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
  id: z.string(),
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
  id: string;
  name: string;
  description: string;
  start_url: string;
  step_count: number;
  parameter_names: string[];
  /** The full Demo record, including its client epoch-ms timestamps. */
  body: unknown;
}

const DEMO_ROW_COLUMNS =
  'id, name, description, start_url, step_count, parameter_names, body, created_at, updated_at, is_deleted';

/**
 * Upsert one demo row keyed by its client id. Ownership is set server-side
 * (`created_by` stamped from `auth.uid()`, `organization_id` resolved by the
 * org-default trigger), so neither column is ever sent from here.
 */
export async function upsertDemoRow(p: SaveDemoRowPayload): Promise<boolean> {
  const c = getSupabase();
  const { error } = await c
    .schema(EXTEND_SCHEMA)
    .from('wbx_demo')
    .upsert(
      {
        id: p.id,
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
      { onConflict: 'id' },
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
    .eq('id', id);
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
    .eq('id', id)
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
