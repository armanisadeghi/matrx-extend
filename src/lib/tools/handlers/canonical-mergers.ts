/**
 * Canonical merger tools — second wave of consolidation (2026-05-05).
 *
 * Each tool here unifies a small group of related single-purpose handlers
 * into a single (action: ...) shape, mirroring the pattern of canonical
 * `tabs` / `downloads` / `memory` / `clipboard`. Goal: shrink the model's
 * advertised surface without losing any capability — every former tool is
 * reachable via an action of its merger.
 *
 * Mergers in this file:
 *   ai              — 9 ai_* on-device Gemini tools
 *   cookies         — get_cookies, set_cookie, delete_cookie
 *   webmcp          — webmcp_check_availability, _list_page_tools, _call_page_tool
 *   storage         — get/set/list_extension_storage (persistent, distinct from canonical `memory`)
 *   tab_groups      — get/create/add/remove/update group ops
 *   bookmarks       — search_bookmarks, list_bookmark_tree
 *   history         — search_history, list_recent_history
 *   recently_closed — list/restore_recently_closed
 *   stylesheet      — inject_stylesheet, remove_stylesheet
 *   cdp_session     — cdp_attach, cdp_detach, cdp_attached_tabs
 *   cdp_emulate     — cdp_emulate_device, cdp_clear_emulation
 *
 *
 * Strategy: each merger is a thin router. We delegate to the existing
 * specific handlers via `delegate()` (leaf-schema parse), building the inner args from the merger's
 * shape. The legacy handlers stay registered (the dispatcher's
 * last-write-wins keeps the merger names winning when both exist) so
 * existing callers continue to work.
 */

import {
  list_bookmark_tree,
  list_recent_history,
  search_bookmarks,
  search_history,
} from '@/lib/tools/handlers/browser-data';
import {
  cdp_attach,
  cdp_attached_tabs,
  cdp_clear_emulation,
  cdp_detach,
  cdp_emulate_device,
} from '@/lib/tools/handlers/cdp';
import {
  ai_check_availability,
  ai_check_prompt_injection,
  ai_classify,
  ai_describe_image,
  ai_detect_language,
  ai_extract_json,
  ai_proofread,
  ai_summarize,
  ai_translate,
} from '@/lib/tools/handlers/onbox-ai';
import {
  delete_cookie,
  get_cookies,
  list_recently_closed,
  restore_recently_closed,
  set_cookie,
} from '@/lib/tools/handlers/optional-perms';
import {
  delete_extension_storage,
  get_extension_storage,
  inject_stylesheet,
  list_extension_storage,
  remove_stylesheet,
  set_extension_storage,
} from '@/lib/tools/handlers/privileged';
import {
  add_tabs_to_group,
  create_tab_group,
  get_tab_groups,
  remove_tabs_from_group,
  update_tab_group,
} from '@/lib/tools/handlers/tabs';
import {
  webmcp_call_page_tool,
  webmcp_check_availability,
  webmcp_list_page_tools,
} from '@/lib/tools/handlers/webmcp';
import type { ToolHandler, ToolTier } from '@/lib/tools/types';
import { delegate } from '@/lib/tools/types';
import { z } from 'zod';

// ────────────────────────────────────────────────────────────────────────────
// ai — unified on-device AI router (9 → 1)
//
// The agent doesn't need to learn 9 ai_* tools. It says "translate this" or
// "describe this image" and we route to the right Gemini Nano handler. For
// describe_image, the handler accepts either an `image_url` (data URI or
// http(s)) or a `ref` to an <img> on the active page (handler resolves
// element src via the existing onbox-ai pipeline).
// ────────────────────────────────────────────────────────────────────────────

const AiArgs = z.object({
  action: z.enum([
    'check_availability',
    'summarize',
    'classify',
    'extract_json',
    'translate',
    'detect_language',
    'proofread',
    'describe_image',
    'check_prompt_injection',
  ]),
  /** Text input for text-based actions. */
  text: z.string().optional(),
  /** For 'classify' — list of candidate labels. */
  categories: z.array(z.string()).optional(),
  /** For 'extract_json' — JSON Schema describing the shape to extract. */
  schema: z.unknown().optional(),
  /** For 'translate' — BCP-47 target (e.g. 'es', 'fr', 'ja'). */
  target_lang: z.string().optional(),
  /** For 'translate' — BCP-47 source language. Auto-detect if omitted. */
  source_lang: z.string().optional(),
  /** For 'describe_image' — image URL (https or data:URI). */
  image_url: z.string().optional(),
  /** For 'describe_image' — base64-encoded image bytes (raw, no data: prefix). */
  image_base64: z.string().optional(),
  /** For 'describe_image' — MIME type when passing image_base64. */
  mime_type: z.string().optional(),
  /** For 'describe_image' — extra prompt to guide the description. */
  prompt: z.string().optional(),
});
type AiArgs = z.infer<typeof AiArgs>;

export const ai: ToolHandler<AiArgs, unknown> = {
  name: 'ai',
  tier: 'read',
  argsSchema: AiArgs,
  run: async (args, ctx) => {
    switch (args.action) {
      case 'check_availability':
        return delegate(ai_check_availability, {}, ctx);
      case 'summarize':
        if (!args.text) return { ok: false, reason: "'text' required for summarize" };
        return delegate(ai_summarize, { text: args.text }, ctx);
      case 'classify':
        if (!args.text || !args.categories?.length)
          return { ok: false, reason: "'text' and 'categories' required for classify" };
        return delegate(ai_classify, { text: args.text, categories: args.categories }, ctx);
      case 'extract_json':
        if (!args.text || !args.schema)
          return { ok: false, reason: "'text' and 'schema' required for extract_json" };
        return delegate(ai_extract_json, { text: args.text, schema: args.schema }, ctx);
      case 'translate':
        if (!args.text || !args.target_lang)
          return { ok: false, reason: "'text' and 'target_lang' required for translate" };
        return delegate(
          ai_translate,
          {
            text: args.text,
            target_language: args.target_lang,
            source_language: args.source_lang,
          },
          ctx,
        );
      case 'detect_language':
        if (!args.text) return { ok: false, reason: "'text' required for detect_language" };
        return delegate(ai_detect_language, { text: args.text }, ctx);
      case 'proofread':
        if (!args.text) return { ok: false, reason: "'text' required for proofread" };
        return delegate(ai_proofread, { text: args.text }, ctx);
      case 'describe_image':
        if (!args.image_url && !args.image_base64)
          return { ok: false, reason: "'image_url' or 'image_base64' required for describe_image" };
        return delegate(
          ai_describe_image,
          {
            image_url: args.image_url,
            image_base64: args.image_base64,
            mime_type: args.mime_type,
            prompt: args.prompt,
          },
          ctx,
        );
      case 'check_prompt_injection':
        if (!args.text) return { ok: false, reason: "'text' required for check_prompt_injection" };
        return delegate(ai_check_prompt_injection, { text: args.text }, ctx);
      default:
        return { ok: false, reason: `Unknown ai action: ${args.action as string}` };
    }
  },
};

// ────────────────────────────────────────────────────────────────────────────
// cookies (3 → 1)
// ────────────────────────────────────────────────────────────────────────────

const CookiesArgs = z.object({
  action: z.enum(['get', 'set', 'delete']),
  url: z.string(),
  name: z.string().optional(),
  /** For 'get' — match by domain instead of url. */
  domain: z.string().optional(),
  /** For 'set'. */
  value: z.string().optional(),
  path: z.string().optional(),
  expires_in_seconds: z.number().int().optional(),
  same_site: z.enum(['strict', 'lax', 'no_restriction']).optional(),
  http_only: z.boolean().optional(),
  secure: z.boolean().optional(),
});
type CookiesArgs = z.infer<typeof CookiesArgs>;

export const cookies: ToolHandler<CookiesArgs, unknown> = {
  name: 'chrome_cookies',
  // Matches the wrapped granular handlers + the admin-only category — the
  // router itself must carry the flag or it's advertised to (and pre-P0-2,
  // executable by) non-admins. docs/AUDIT_2026_06_10.md P0-3.
  admin_only: true,
  tier: 'privileged',
  tierFor: (args): ToolTier => (args.action === 'get' ? 'read' : 'privileged'),
  required_optional_permissions: ['cookies'],
  argsSchema: CookiesArgs,
  run: async (args, ctx) => {
    if (args.action === 'get') {
      return delegate(get_cookies, { url: args.url, domain: args.domain, name: args.name }, ctx);
    }
    if (args.action === 'set') {
      if (!args.name || args.value == null)
        return { ok: false, reason: "'name' and 'value' required for set" };
      return delegate(
        set_cookie,
        {
          url: args.url,
          name: args.name,
          value: args.value,
          domain: args.domain,
          path: args.path,
          expires_in_seconds: args.expires_in_seconds,
          same_site: args.same_site,
          http_only: args.http_only,
          secure: args.secure,
        },
        ctx,
      );
    }
    if (args.action === 'delete') {
      if (!args.name) return { ok: false, reason: "'name' required for delete" };
      return delegate(delete_cookie, { url: args.url, name: args.name }, ctx);
    }
    return { ok: false, reason: `Unknown cookies action: ${args.action as string}` };
  },
};

// ────────────────────────────────────────────────────────────────────────────
// webmcp (3 → 1)
// ────────────────────────────────────────────────────────────────────────────

const WebmcpArgs = z.object({
  action: z.enum(['check', 'list', 'call']),
  /** For 'call' — name of the page-registered tool. */
  tool_name: z.string().optional(),
  /** For 'call' — args object passed to the page tool. */
  arguments: z.unknown().optional(),
});
type WebmcpArgs = z.infer<typeof WebmcpArgs>;

export const webmcp: ToolHandler<WebmcpArgs, unknown> = {
  name: 'chrome_webmcp',
  // Matches the wrapped granular handlers + the admin-only category — the
  // router itself must carry the flag or it's advertised to (and pre-P0-2,
  // executable by) non-admins. docs/AUDIT_2026_06_10.md P0-3.
  admin_only: true,
  tier: 'action',
  tierFor: (args): ToolTier =>
    args.action === 'check' || args.action === 'list' ? 'read' : 'action',
  argsSchema: WebmcpArgs,
  run: async (args, ctx) => {
    if (args.action === 'check') return delegate(webmcp_check_availability, {}, ctx);
    if (args.action === 'list') return delegate(webmcp_list_page_tools, {}, ctx);
    if (args.action === 'call') {
      if (!args.tool_name) return { ok: false, reason: "'tool_name' required for call" };
      return delegate(
        webmcp_call_page_tool,
        { name: args.tool_name, arguments: args.arguments },
        ctx,
      );
    }
    return { ok: false, reason: `Unknown webmcp action: ${args.action as string}` };
  },
};

// ────────────────────────────────────────────────────────────────────────────
// storage — persistent extension storage (distinct from session-scoped `memory`)
// (3 → 1)
// ────────────────────────────────────────────────────────────────────────────

const StorageArgs = z.object({
  action: z.enum(['get', 'set', 'list', 'delete']),
  key: z.string().optional(),
  value: z.unknown().optional(),
});
type StorageArgs = z.infer<typeof StorageArgs>;

export const storage: ToolHandler<StorageArgs, unknown> = {
  name: 'storage',
  tier: 'privileged',
  tierFor: (args): ToolTier =>
    args.action === 'get' || args.action === 'list' ? 'read' : 'privileged',
  argsSchema: StorageArgs,
  run: async (args, ctx) => {
    if (args.action === 'get') {
      if (!args.key) return { ok: false, reason: "'key' required for get" };
      return delegate(get_extension_storage, { key: args.key }, ctx);
    }
    if (args.action === 'list') {
      return delegate(list_extension_storage, {}, ctx);
    }
    if (args.action === 'set') {
      if (!args.key) return { ok: false, reason: "'key' required for set" };
      return delegate(set_extension_storage, { key: args.key, value: args.value }, ctx);
    }
    if (args.action === 'delete') {
      if (!args.key) return { ok: false, reason: "'key' required for delete" };
      return delegate(delete_extension_storage, { key: args.key }, ctx);
    }
    return { ok: false, reason: `Unknown storage action: ${args.action as string}` };
  },
};

// ────────────────────────────────────────────────────────────────────────────
// tab_groups (5 → 1)
// ────────────────────────────────────────────────────────────────────────────

const TabGroupsArgs = z.object({
  action: z.enum(['list', 'create', 'add', 'remove', 'update']),
  /** For add/remove/update. */
  group_id: z.number().int().optional(),
  /** For create/add/remove. */
  tab_ids: z.array(z.number().int()).optional(),
  /** For create/update. */
  title: z.string().optional(),
  color: z
    .enum(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'])
    .optional(),
  /** For update. */
  collapsed: z.boolean().optional(),
});
type TabGroupsArgs = z.infer<typeof TabGroupsArgs>;

export const tab_groups: ToolHandler<TabGroupsArgs, unknown> = {
  name: 'tab_groups',
  tier: 'action',
  tierFor: (args): ToolTier => (args.action === 'list' ? 'read' : 'action'),
  supportedBrowsers: ['chrome'],
  argsSchema: TabGroupsArgs,
  run: async (args, ctx) => {
    if (args.action === 'list') return delegate(get_tab_groups, {}, ctx);
    if (args.action === 'create') {
      if (!args.tab_ids?.length) return { ok: false, reason: "'tab_ids' required for create" };
      return delegate(
        create_tab_group,
        { tab_ids: args.tab_ids, title: args.title, color: args.color },
        ctx,
      );
    }
    if (args.action === 'add') {
      if (args.group_id == null || !args.tab_ids?.length)
        return { ok: false, reason: "'group_id' and 'tab_ids' required for add" };
      return delegate(add_tabs_to_group, { group_id: args.group_id, tab_ids: args.tab_ids }, ctx);
    }
    if (args.action === 'remove') {
      if (!args.tab_ids?.length) return { ok: false, reason: "'tab_ids' required for remove" };
      return delegate(remove_tabs_from_group, { tab_ids: args.tab_ids }, ctx);
    }
    if (args.action === 'update') {
      if (args.group_id == null) return { ok: false, reason: "'group_id' required for update" };
      return delegate(
        update_tab_group,
        {
          group_id: args.group_id,
          title: args.title,
          color: args.color,
          collapsed: args.collapsed,
        },
        ctx,
      );
    }
    return { ok: false, reason: `Unknown tab_groups action: ${args.action as string}` };
  },
};

// ────────────────────────────────────────────────────────────────────────────
// bookmarks (2 → 1)
// ────────────────────────────────────────────────────────────────────────────

const BookmarksArgs = z.object({
  action: z.enum(['search', 'tree']),
  query: z.string().optional(),
  /** For tree — root folder id; default = root of all bookmarks. */
  folder_id: z.string().optional(),
  /** For tree — max depth; default 3. */
  max_depth: z.number().int().positive().optional(),
  /** For search — cap on matches; default 50. */
  limit: z.number().int().positive().optional(),
});
type BookmarksArgs = z.infer<typeof BookmarksArgs>;

export const bookmarks: ToolHandler<BookmarksArgs, unknown> = {
  name: 'chrome_bookmarks',
  tier: 'read',
  argsSchema: BookmarksArgs,
  run: async (args, ctx) => {
    if (args.action === 'search') {
      if (!args.query) return { ok: false, reason: "'query' required for search" };
      return delegate(search_bookmarks, { query: args.query, limit: args.limit }, ctx);
    }
    if (args.action === 'tree') {
      return delegate(
        list_bookmark_tree,
        { folder_id: args.folder_id, max_depth: args.max_depth },
        ctx,
      );
    }
    return { ok: false, reason: `Unknown bookmarks action: ${args.action as string}` };
  },
};

// ────────────────────────────────────────────────────────────────────────────
// history (2 → 1)
// ────────────────────────────────────────────────────────────────────────────

const HistoryArgs = z.object({
  action: z.enum(['search', 'recent']),
  query: z.string().optional(),
  /** For search — earliest visit ts (ms). */
  start_time_ms: z.number().int().optional(),
  end_time_ms: z.number().int().optional(),
  /** For recent — minutes back (default 60). */
  minutes: z.number().int().positive().optional(),
  limit: z.number().int().positive().optional(),
});
type HistoryArgs = z.infer<typeof HistoryArgs>;

export const history: ToolHandler<HistoryArgs, unknown> = {
  name: 'chrome_history',
  tier: 'read',
  argsSchema: HistoryArgs,
  run: async (args, ctx) => {
    if (args.action === 'search') {
      return delegate(
        search_history,
        {
          query: args.query ?? '',
          start_time_ms: args.start_time_ms,
          end_time_ms: args.end_time_ms,
          limit: args.limit,
        },
        ctx,
      );
    }
    if (args.action === 'recent') {
      return delegate(list_recent_history, { minutes: args.minutes, limit: args.limit }, ctx);
    }
    return { ok: false, reason: `Unknown history action: ${args.action as string}` };
  },
};

// ────────────────────────────────────────────────────────────────────────────
// recently_closed (2 → 1)
// ────────────────────────────────────────────────────────────────────────────

const RecentlyClosedArgs = z.object({
  action: z.enum(['list', 'restore']),
  /** For restore — sessionId from list. Omit to restore most recent. */
  session_id: z.string().optional(),
});
type RecentlyClosedArgs = z.infer<typeof RecentlyClosedArgs>;

export const recently_closed: ToolHandler<RecentlyClosedArgs, unknown> = {
  name: 'chrome_recently_closed',
  tier: 'action',
  tierFor: (args): ToolTier => (args.action === 'list' ? 'read' : 'action'),
  required_optional_permissions: ['sessions'],
  argsSchema: RecentlyClosedArgs,
  run: async (args, ctx) => {
    if (args.action === 'list') return delegate(list_recently_closed, {}, ctx);
    if (args.action === 'restore')
      return delegate(restore_recently_closed, { session_id: args.session_id }, ctx);
    return { ok: false, reason: `Unknown recently_closed action: ${args.action as string}` };
  },
};

// ────────────────────────────────────────────────────────────────────────────
// stylesheet (2 → 1)
// ────────────────────────────────────────────────────────────────────────────

const StylesheetArgs = z.object({
  action: z.enum(['inject', 'remove']),
  css: z.string().min(1),
  tab_id: z.number().int().optional(),
  /** For inject — persist across navigations on this tab. Default false. */
  persistent: z.boolean().optional(),
});
type StylesheetArgs = z.infer<typeof StylesheetArgs>;

export const stylesheet: ToolHandler<StylesheetArgs, unknown> = {
  name: 'stylesheet',
  tier: 'privileged',
  argsSchema: StylesheetArgs,
  run: async (args, ctx) => {
    if (args.action === 'inject') {
      return delegate(
        inject_stylesheet,
        { css: args.css, tab_id: args.tab_id, persistent: args.persistent },
        ctx,
      );
    }
    if (args.action === 'remove') {
      return delegate(remove_stylesheet, { css: args.css, tab_id: args.tab_id }, ctx);
    }
    return { ok: false, reason: `Unknown stylesheet action: ${args.action as string}` };
  },
};

// ────────────────────────────────────────────────────────────────────────────
// cdp_session — admin (3 → 1)
// ────────────────────────────────────────────────────────────────────────────

const CdpSessionArgs = z.object({
  action: z.enum(['attach', 'detach', 'list']),
  tab_id: z.number().int().optional(),
});
type CdpSessionArgs = z.infer<typeof CdpSessionArgs>;

export const cdp_session: ToolHandler<CdpSessionArgs, unknown> = {
  name: 'cdp_session',
  // Matches the wrapped granular handlers + the admin-only category — the
  // router itself must carry the flag or it's advertised to (and pre-P0-2,
  // executable by) non-admins. docs/AUDIT_2026_06_10.md P0-3.
  admin_only: true,
  tier: 'privileged',
  tierFor: (args): ToolTier => (args.action === 'list' ? 'read' : 'privileged'),
  required_optional_permissions: ['debugger'],
  supportedBrowsers: ['chrome'],
  argsSchema: CdpSessionArgs,
  run: async (args, ctx) => {
    if (args.action === 'attach') {
      return delegate(cdp_attach, { tab_id: args.tab_id }, ctx);
    }
    if (args.action === 'detach') {
      return delegate(cdp_detach, { tab_id: args.tab_id }, ctx);
    }
    if (args.action === 'list') {
      return delegate(cdp_attached_tabs, {}, ctx);
    }
    return { ok: false, reason: `Unknown cdp_session action: ${args.action as string}` };
  },
};

// ────────────────────────────────────────────────────────────────────────────
// cdp_emulate — admin (2 → 1)
// ────────────────────────────────────────────────────────────────────────────

const CdpEmulateArgs = z.object({
  action: z.enum(['set', 'clear']),
  tab_id: z.number().int().optional(),
  /** For 'set'. */
  width: z.number().int().min(100).optional(),
  height: z.number().int().min(100).optional(),
  device_scale_factor: z.number().positive().optional(),
  mobile: z.boolean().optional(),
  user_agent: z.string().optional(),
});
type CdpEmulateArgs = z.infer<typeof CdpEmulateArgs>;

export const cdp_emulate: ToolHandler<CdpEmulateArgs, unknown> = {
  name: 'cdp_emulate',
  // Matches the wrapped granular handlers + the admin-only category — the
  // router itself must carry the flag or it's advertised to (and pre-P0-2,
  // executable by) non-admins. docs/AUDIT_2026_06_10.md P0-3.
  admin_only: true,
  tier: 'privileged',
  required_optional_permissions: ['debugger'],
  supportedBrowsers: ['chrome'],
  argsSchema: CdpEmulateArgs,
  run: async (args, ctx) => {
    if (args.action === 'set') {
      if (args.width == null || args.height == null)
        return { ok: false, reason: "'width' and 'height' required for set" };
      return delegate(
        cdp_emulate_device,
        {
          tab_id: args.tab_id,
          width: args.width,
          height: args.height,
          device_scale_factor: args.device_scale_factor,
          mobile: args.mobile,
          user_agent: args.user_agent,
        },
        ctx,
      );
    }
    if (args.action === 'clear') {
      return delegate(cdp_clear_emulation, { tab_id: args.tab_id }, ctx);
    }
    return { ok: false, reason: `Unknown cdp_emulate action: ${args.action as string}` };
  },
};

// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// Bundle export
// ────────────────────────────────────────────────────────────────────────────

export const canonical_merger_handlers = [
  ai,
  cookies,
  webmcp,
  storage,
  tab_groups,
  bookmarks,
  history,
  recently_closed,
  stylesheet,
  cdp_session,
  cdp_emulate,
];
