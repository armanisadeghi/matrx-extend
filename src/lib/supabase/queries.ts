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
  const { data, error } = await c
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

// ─── Agents (agx_agent) ─────────────────────────────────────────────────────
export const AgxAgentSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  agent_type: z.string(),
  variable_definitions: z.unknown().nullable(),
  tools: z.array(z.string()).nullable(),
  settings: z.unknown().nullable(),
  category: z.string().nullable(),
  tags: z.array(z.string()).nullable(),
  is_public: z.boolean().nullable(),
});
export type AgxAgent = z.infer<typeof AgxAgentSchema>;

/**
 * Agents the user can pick in the chat composer:
 *   - their own active agents, OR
 *   - public active agents
 * RLS on agx_agent enforces the access boundary; this filter is for UX
 * (drop archived / inactive agents from the picker).
 */
export async function fetchUserAgents(userId: string): Promise<AgxAgent[]> {
  const c = getSupabase();
  const { data, error } = await c
    .from('agx_agent')
    .select(
      'id, name, description, agent_type, variable_definitions, tools, settings, category, tags, is_public',
    )
    .or(`user_id.eq.${userId},is_public.eq.true`)
    .eq('is_active', true)
    .eq('is_archived', false)
    .order('is_favorite', { ascending: false, nullsFirst: false })
    .order('name');
  if (error) {
    console.warn('[matrx-extend] fetchUserAgents error', error.message);
    return [];
  }
  return z.array(AgxAgentSchema).parse(data ?? []);
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
export const ExtractionPatternFieldSchema = z.object({
  name: z.string(),
  selector: z.string(),
  xpath_fallback: z.string().optional(),
  attr: z.string().optional(),
  is_list: z.boolean().default(false),
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
  last_used_at: z.string().nullable(),
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

export async function savePattern(
  p: Omit<ExtractionPattern, 'id' | 'user_id' | 'created_at' | 'last_used_at'> & {
    user_id?: string;
  },
): Promise<{ id: string } | null> {
  const c = getSupabase();
  const { data, error } = await c
    .from('wbx_pattern')
    .insert({
      name: p.name,
      domain: p.domain,
      route_pattern: p.route_pattern,
      list_root_selector: p.list_root_selector,
      fields: p.fields,
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
  const { error } = await c
    .from('wbx_seo_audit')
    .update({ recommendations })
    .eq('id', auditId);
  if (error) console.warn('[matrx-extend] attachSeoRecommendations error', error.message);
}
