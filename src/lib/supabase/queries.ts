/**
 * Direct, RLS-gated Supabase reads from the extension. The publishable key +
 * the user's JWT (set via setSupabaseSession) gates rows server-side.
 *
 * Schema mirror — these tables already exist in the Matrx Supabase project.
 * Patterns ported from matrx-chrome/utils/supabase-queries.ts.
 */

import { getSupabase } from '@/lib/supabase/client';
import { z } from 'zod';

// ─── AI models ──────────────────────────────────────────────────────────────
export const AiModelSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  common_name: z.string().nullable(),
  model_class: z.string().nullable(),
  provider: z.string().nullable(),
  context_window: z.number().int().nullable(),
  max_tokens: z.number().int().nullable(),
  capabilities: z.unknown().nullable(),
  is_deprecated: z.boolean().nullable(),
  is_primary: z.boolean().nullable(),
  is_premium: z.boolean().nullable(),
});
export type AiModel = z.infer<typeof AiModelSchema>;

export async function fetchActiveModels(): Promise<AiModel[]> {
  const c = getSupabase();
  const { data, error } = await c
    .from('ai_model')
    .select(
      'id, name, common_name, model_class, provider, context_window, max_tokens, capabilities, is_deprecated, is_primary, is_premium',
    )
    .or('is_deprecated.eq.false,is_deprecated.is.null')
    .order('provider')
    .order('common_name');
  if (error) {
    console.warn('[matrx-extend] fetchActiveModels error', error.message);
    return [];
  }
  return z.array(AiModelSchema).parse(data ?? []);
}

export async function fetchPrimaryModels(): Promise<AiModel[]> {
  const all = await fetchActiveModels();
  return all.filter((m) => m.is_primary && !m.is_premium);
}

// ─── Agents (prompts) ───────────────────────────────────────────────────────
export const AgentPromptSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  variable_defaults: z.record(z.unknown()).nullable(),
  tools: z.unknown().nullable(),
  user_id: z.string().uuid().nullable(),
  settings: z.record(z.unknown()).nullable(),
});
export type AgentPrompt = z.infer<typeof AgentPromptSchema>;

export async function fetchUserAgents(userId: string): Promise<AgentPrompt[]> {
  const c = getSupabase();
  const { data, error } = await c
    .from('prompts')
    .select('id, name, description, variable_defaults, tools, user_id, settings')
    .eq('user_id', userId)
    .order('name');
  if (error) {
    console.warn('[matrx-extend] fetchUserAgents error', error.message);
    return [];
  }
  return z.array(AgentPromptSchema).parse(data ?? []);
}

// ─── Conversations ──────────────────────────────────────────────────────────
export const ConversationSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid().nullable(),
  title: z.string().nullable(),
  status: z.string().nullable(),
  ai_model_id: z.string().uuid().nullable(),
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
      'id, user_id, title, status, ai_model_id, message_count, created_at, updated_at, deleted_at, metadata',
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

// ─── Extension-owned tables (new — created by this extension) ──────────────

/**
 * extension_scrapes — captures from the Scrape tab. RLS gates by user_id.
 * To be added to the Supabase schema; until then queries gracefully no-op.
 *
 * Suggested DDL:
 *   create table public.extension_scrapes (
 *     id uuid primary key default gen_random_uuid(),
 *     user_id uuid references auth.users(id) not null default auth.uid(),
 *     url text not null,
 *     captured_at timestamptz not null default now(),
 *     title text, description text, lang text,
 *     soup jsonb not null,                -- structured extraction output
 *     markdown text,
 *     metadata jsonb,                     -- og, twitter, schema.org links
 *     ld_json jsonb,                      -- raw JSON-LD blocks
 *     media_count integer default 0,
 *     pattern_id uuid references public.extraction_patterns(id)
 *   );
 *   create index extension_scrapes_user_url on public.extension_scrapes(user_id, url);
 *   alter table public.extension_scrapes enable row level security;
 *   create policy extension_scrapes_owner on public.extension_scrapes
 *     for all using (user_id = auth.uid()) with check (user_id = auth.uid());
 */

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
    .from('extension_scrapes')
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
    .from('extension_scrapes')
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

// ─── Extraction patterns ────────────────────────────────────────────────────
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
    .from('extraction_patterns')
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
    .from('extraction_patterns')
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
