/**
 * Direct, RLS-gated Supabase reads from the extension. The publishable key +
 * the user's JWT (set via setSupabaseSession) gates rows server-side.
 *
 * Schema mirror — these tables already exist in the Matrx Supabase project:
 *   - agx_agent          (Agent definitions, replaces legacy `prompts`)
 *   - cx_conversation    (Chat conversations)
 *   - cx_message         (Chat messages — JSONB content[])
 *
 * Tables this extension OWNS (created by ./migrations/*.sql):
 *   - wbx_capture        (Page captures from Scrape tab)
 *   - wbx_pattern        (Saved Data-tab patterns)
 *   - wbx_seo_audit      (SEO audits + AI recommendations)
 */

import { DEFAULT_AGENDA_AGENT_ID } from '@/lib/agenda/constants';
import { getSupabase } from '@/lib/supabase/client';
import { z } from 'zod';

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
  const c = getSupabase();
  const { data, error } = await c.from('admins').select('user_id').eq('user_id', userId).limit(1);
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
  const all = z.array(AgxAgentSchema).parse(data ?? []);
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

// ─── ai_model (admin model picker) ──────────────────────────────────────────
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
  const c = getSupabase();
  const { data, error } = await c
    .from('ai_model')
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

// ─── Conversations (cx_conversation) ────────────────────────────────────────
export const ConversationSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid().nullable(),
  title: z.string().nullable(),
  status: z.string().nullable(),
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
    .from('cx_conversation')
    .select(
      'id, user_id, title, status, last_model_id, message_count, created_at, updated_at, deleted_at, metadata',
    )
    .is('deleted_at', null)
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.warn('[matrx-extend] fetchConversationHistory error', error.message);
    return [];
  }
  return z.array(ConversationSchema).parse(data ?? []);
}

// ─── Messages (cx_message) ──────────────────────────────────────────────────
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

export async function fetchConversationMessages(conversationId: string): Promise<Message[]> {
  const c = getSupabase();
  const { data, error } = await c
    .from('cx_message')
    .select('id, conversation_id, role, position, status, content, created_at, metadata')
    .eq('conversation_id', conversationId)
    .is('deleted_at', null)
    .order('position', { ascending: true });
  if (error) {
    console.warn('[matrx-extend] fetchConversationMessages error', error.message);
    return [];
  }
  return z.array(MessageSchema).parse(data ?? []);
}

export interface ChatMessageRendered {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export function dbMessagesToChatMessages(rows: Message[]): ChatMessageRendered[] {
  return rows
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => {
      let text = '';
      if (Array.isArray(m.content)) {
        for (const item of m.content as unknown[]) {
          if (typeof item === 'string') {
            text += item;
            continue;
          }
          const block = item as Record<string, unknown>;
          if (block.type === 'input_text' || block.type === 'text') {
            text += (block.text as string | undefined) ?? '';
          }
        }
      } else if (typeof m.content === 'string') {
        text = m.content;
      }
      return {
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: text,
        timestamp: new Date(m.created_at).getTime(),
      };
    });
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
  return CapturedPageSchema.parse(row);
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
  user_id: z.string().uuid(),
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
    .from('wbx_pattern')
    .select('*')
    .eq('domain', domain)
    .order('last_used_at', { ascending: false, nullsFirst: false });
  if (error) {
    if (/relation .* does not exist/i.test(error.message)) return [];
    console.warn('[matrx-extend] fetchPatternsForDomain error', error.message);
    return [];
  }
  return z.array(ExtractionPatternSchema).parse(data ?? []);
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
  const { data, error } = await c
    .from('wbx_pattern')
    .insert({
      name: p.name,
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
  if (error) {
    console.warn('[matrx-extend] savePattern error', error.message);
    return null;
  }
  return data as { id: string };
}

export async function bumpPatternLastUsed(patternId: string): Promise<void> {
  const c = getSupabase();
  await c
    .from('wbx_pattern')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', patternId);
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
  return row ? SeoAuditRowSchema.parse(row) : null;
}

export async function attachSeoRecommendations(
  auditId: string,
  recommendations: unknown,
): Promise<void> {
  const c = getSupabase();
  const { error } = await c.from('wbx_seo_audit').update({ recommendations }).eq('id', auditId);
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
export async function saveScreenshot(
  p: SaveScreenshotPayload,
): Promise<{ id: string } | null> {
  const c = getSupabase();
  const { data, error } = await c
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
    .from('wbx_screenshot')
    .select(
      'id, page_url_canonical, page_url_full, page_title, file_id, file_url, width, height, mime_type, byte_length, source, captured_at',
    )
    .eq('page_url_canonical', pageUrlCanonical)
    .order('captured_at', { ascending: false })
    .limit(limit);
  if (error) {
    if (/relation .* does not exist/i.test(error.message)) return [];
    console.warn('[matrx-extend] fetchScreenshotsForUrl error', error.message);
    return [];
  }
  return z.array(ScreenshotRowSchema).parse(data ?? []);
}

export async function deleteScreenshot(id: string): Promise<boolean> {
  const c = getSupabase();
  const { error } = await c.from('wbx_screenshot').delete().eq('id', id);
  if (error) {
    console.warn('[matrx-extend] deleteScreenshot error', error.message);
    return false;
  }
  return true;
}
