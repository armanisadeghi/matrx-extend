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
 * Plus `evaluate_javascript` — canonical-named handler that delegates to
 * the existing `execute_javascript` implementation.
 *
 * Strategy: each merger is a thin router. We delegate to the existing
 * specific handlers' `.run()`, building the inner args from the merger's
 * shape. The legacy handlers stay registered (the dispatcher's
 * last-write-wins keeps the merger names winning when both exist) so
 * existing callers continue to work.
 */

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
  cdp_attach,
  cdp_attached_tabs,
  cdp_clear_emulation,
  cdp_detach,
  cdp_emulate_device,
} from '@/lib/tools/handlers/cdp';
import {
  list_bookmark_tree,
  list_recent_history,
  search_bookmarks,
  search_history,
} from '@/lib/tools/handlers/browser-data';
import {
  delete_cookie,
  get_cookies,
  list_recently_closed,
  restore_recently_closed,
  set_cookie,
} from '@/lib/tools/handlers/optional-perms';
import {
  add_tabs_to_group,
  create_tab_group,
  get_tab_groups,
  remove_tabs_from_group,
  update_tab_group,
} from '@/lib/tools/handlers/tabs';
import {
  execute_javascript,
  get_extension_storage,
  inject_stylesheet,
  list_extension_storage,
  remove_stylesheet,
  set_extension_storage,
} from '@/lib/tools/handlers/privileged';
import {
  webmcp_call_page_tool,
  webmcp_check_availability,
  webmcp_list_page_tools,
} from '@/lib/tools/handlers/webmcp';
import type { ToolHandler, ToolTier } from '@/lib/tools/types';
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
  description:
    "On-device AI (Gemini Nano + siblings). Free, offline, multimodal, no network. Actions: 'check_availability' (probe per-API readiness), 'summarize' (text→summary), 'classify' (text+categories→label), 'extract_json' (text+schema→object), 'translate' (text+target_lang), 'detect_language' (text→BCP-47), 'proofread' (text→corrections), 'describe_image' (image_url OR image_base64+mime_type → caption), 'check_prompt_injection' (text→risk assessment). Use BEFORE expensive cloud calls when on-device quality permits.",
  argsSchema: AiArgs,
  run: async (args, ctx) => {
    switch (args.action) {
      case 'check_availability':
        return ai_check_availability.run({} as never, ctx);
      case 'summarize':
        if (!args.text) return { ok: false, reason: "'text' required for summarize" };
        return ai_summarize.run({ text: args.text } as never, ctx);
      case 'classify':
        if (!args.text || !args.categories?.length)
          return { ok: false, reason: "'text' and 'categories' required for classify" };
        return ai_classify.run(
          { text: args.text, categories: args.categories } as never,
          ctx,
        );
      case 'extract_json':
        if (!args.text || !args.schema)
          return { ok: false, reason: "'text' and 'schema' required for extract_json" };
        return ai_extract_json.run({ text: args.text, schema: args.schema } as never, ctx);
      case 'translate':
        if (!args.text || !args.target_lang)
          return { ok: false, reason: "'text' and 'target_lang' required for translate" };
        return ai_translate.run(
          {
            text: args.text,
            target_language: args.target_lang,
            source_language: args.source_lang,
          } as never,
          ctx,
        );
      case 'detect_language':
        if (!args.text) return { ok: false, reason: "'text' required for detect_language" };
        return ai_detect_language.run({ text: args.text } as never, ctx);
      case 'proofread':
        if (!args.text) return { ok: false, reason: "'text' required for proofread" };
        return ai_proofread.run({ text: args.text } as never, ctx);
      case 'describe_image':
        if (!args.image_url && !args.image_base64)
          return { ok: false, reason: "'image_url' or 'image_base64' required for describe_image" };
        return ai_describe_image.run(
          {
            image_url: args.image_url,
            image_base64: args.image_base64,
            mime_type: args.mime_type,
            prompt: args.prompt,
          } as never,
          ctx,
        );
      case 'check_prompt_injection':
        if (!args.text)
          return { ok: false, reason: "'text' required for check_prompt_injection" };
        return ai_check_prompt_injection.run({ text: args.text } as never, ctx);
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
  name: 'cookies',
  tier: 'privileged',
  tierFor: (args): ToolTier => (args.action === 'get' ? 'read' : 'privileged'),
  admin_only: true,
  required_optional_permissions: ['cookies'],
  description:
    "Manage cookies for any domain. Actions: 'get' (read; pass `name` for a specific cookie or omit for all matching), 'set' (write; requires `name` + `value`; optional `domain`/`path`/`expires_in_seconds`/`same_site`/`http_only`/`secure`), 'delete' (requires `name`). Always pass `url` (or `domain` for 'get'). Admin-only.",
  argsSchema: CookiesArgs,
  run: async (args, ctx) => {
    if (args.action === 'get') {
      return get_cookies.run(
        { url: args.url, domain: args.domain, name: args.name } as never,
        ctx,
      );
    }
    if (args.action === 'set') {
      if (!args.name || args.value == null)
        return { ok: false, reason: "'name' and 'value' required for set" };
      return set_cookie.run(
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
        } as never,
        ctx,
      );
    }
    if (args.action === 'delete') {
      if (!args.name) return { ok: false, reason: "'name' required for delete" };
      return delete_cookie.run({ url: args.url, name: args.name } as never, ctx);
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
  name: 'webmcp',
  tier: 'action',
  tierFor: (args): ToolTier =>
    args.action === 'check' || args.action === 'list' ? 'read' : 'action',
  admin_only: true,
  description:
    "Discover and invoke tools that pages have registered via `navigator.modelContext.registerTool` (Chrome 146+). Actions: 'check' (probe API + count tools), 'list' (enumerate page-registered tools), 'call' (invoke; pass `tool_name` and `arguments`). Admin-only experimental capability.",
  argsSchema: WebmcpArgs,
  run: async (args, ctx) => {
    if (args.action === 'check') return webmcp_check_availability.run({} as never, ctx);
    if (args.action === 'list') return webmcp_list_page_tools.run({} as never, ctx);
    if (args.action === 'call') {
      if (!args.tool_name) return { ok: false, reason: "'tool_name' required for call" };
      return webmcp_call_page_tool.run(
        { name: args.tool_name, arguments: args.arguments } as never,
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
  action: z.enum(['get', 'set', 'list']),
  key: z.string().optional(),
  value: z.unknown().optional(),
});
type StorageArgs = z.infer<typeof StorageArgs>;

export const storage: ToolHandler<StorageArgs, unknown> = {
  name: 'storage',
  tier: 'privileged',
  tierFor: (args): ToolTier =>
    args.action === 'get' || args.action === 'list' ? 'read' : 'privileged',
  description:
    "Persistent agent-namespaced storage that survives across runs. Distinct from canonical `memory` which is session-scoped (cleared on SW restart). Actions: 'get' (returns value at key), 'set' (writes any JSON-serializable value), 'list' (returns all keys). Use for user preferences, scratchpads, progress markers between conversations.",
  argsSchema: StorageArgs,
  run: async (args, ctx) => {
    if (args.action === 'get') {
      if (!args.key) return { ok: false, reason: "'key' required for get" };
      return get_extension_storage.run({ key: args.key } as never, ctx);
    }
    if (args.action === 'list') {
      return list_extension_storage.run({} as never, ctx);
    }
    if (args.action === 'set') {
      if (!args.key) return { ok: false, reason: "'key' required for set" };
      return set_extension_storage.run({ key: args.key, value: args.value } as never, ctx);
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
  description:
    "Manage tab groups. Actions: 'list' (returns all groups across windows), 'create' (groups `tab_ids` together; optional `title`/`color`), 'add' (puts more `tab_ids` into existing `group_id`), 'remove' (ungroups `tab_ids`), 'update' (rename/recolor/collapse `group_id`).",
  argsSchema: TabGroupsArgs,
  run: async (args, ctx) => {
    if (args.action === 'list') return get_tab_groups.run({} as never, ctx);
    if (args.action === 'create') {
      if (!args.tab_ids?.length)
        return { ok: false, reason: "'tab_ids' required for create" };
      return create_tab_group.run(
        { tab_ids: args.tab_ids, title: args.title, color: args.color } as never,
        ctx,
      );
    }
    if (args.action === 'add') {
      if (args.group_id == null || !args.tab_ids?.length)
        return { ok: false, reason: "'group_id' and 'tab_ids' required for add" };
      return add_tabs_to_group.run(
        { group_id: args.group_id, tab_ids: args.tab_ids } as never,
        ctx,
      );
    }
    if (args.action === 'remove') {
      if (!args.tab_ids?.length)
        return { ok: false, reason: "'tab_ids' required for remove" };
      return remove_tabs_from_group.run({ tab_ids: args.tab_ids } as never, ctx);
    }
    if (args.action === 'update') {
      if (args.group_id == null)
        return { ok: false, reason: "'group_id' required for update" };
      return update_tab_group.run(
        {
          group_id: args.group_id,
          title: args.title,
          color: args.color,
          collapsed: args.collapsed,
        } as never,
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
  name: 'bookmarks',
  tier: 'read',
  description:
    "Read the user's bookmarks. Actions: 'search' (free-text against title and URL; pass `query`), 'tree' (folder tree starting at `folder_id` or root, `max_depth` deep). Each bookmark has id/title/url/parent_id/date_added.",
  argsSchema: BookmarksArgs,
  run: async (args, ctx) => {
    if (args.action === 'search') {
      if (!args.query) return { ok: false, reason: "'query' required for search" };
      return search_bookmarks.run({ query: args.query, limit: args.limit } as never, ctx);
    }
    if (args.action === 'tree') {
      return list_bookmark_tree.run(
        { folder_id: args.folder_id, max_depth: args.max_depth } as never,
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
  name: 'history',
  tier: 'read',
  description:
    "Read browsing history. Actions: 'search' (free-text against title/URL; pass `query`, optional `start_time_ms`/`end_time_ms`/`limit`), 'recent' (last N `minutes`, default 60).",
  argsSchema: HistoryArgs,
  run: async (args, ctx) => {
    if (args.action === 'search') {
      return search_history.run(
        {
          query: args.query ?? '',
          start_time_ms: args.start_time_ms,
          end_time_ms: args.end_time_ms,
          limit: args.limit,
        } as never,
        ctx,
      );
    }
    if (args.action === 'recent') {
      return list_recent_history.run(
        { minutes: args.minutes, limit: args.limit } as never,
        ctx,
      );
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
  name: 'recently_closed',
  tier: 'action',
  tierFor: (args): ToolTier => (args.action === 'list' ? 'read' : 'action'),
  required_optional_permissions: ['sessions'],
  description:
    "Recently-closed tabs and windows. Actions: 'list' (returns sessions with id/url/title/lastModified), 'restore' (reopens; `session_id` optional — defaults to the most recently closed).",
  argsSchema: RecentlyClosedArgs,
  run: async (args, ctx) => {
    if (args.action === 'list') return list_recently_closed.run({} as never, ctx);
    if (args.action === 'restore')
      return restore_recently_closed.run({ session_id: args.session_id } as never, ctx);
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
  description:
    "Inject or remove a CSS stylesheet on the active (or specified) tab. Actions: 'inject' (apply `css`; pass `persistent: true` to survive navigations), 'remove' (drop a previously-injected `css` block — must match exactly).",
  argsSchema: StylesheetArgs,
  run: async (args, ctx) => {
    if (args.action === 'inject') {
      return inject_stylesheet.run(
        { css: args.css, tab_id: args.tab_id, persistent: args.persistent } as never,
        ctx,
      );
    }
    if (args.action === 'remove') {
      return remove_stylesheet.run(
        { css: args.css, tab_id: args.tab_id } as never,
        ctx,
      );
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
  tier: 'privileged',
  tierFor: (args): ToolTier => (args.action === 'list' ? 'read' : 'privileged'),
  admin_only: true,
  required_optional_permissions: ['debugger'],
  supportedBrowsers: ['chrome'],
  description:
    "Manage Chrome DevTools Protocol attachments. Actions: 'attach' (begin debugger session on `tab_id` — required before any other cdp_* tool), 'detach' (end session), 'list' (which tabs are currently attached). Admin + `debugger` permission.",
  argsSchema: CdpSessionArgs,
  run: async (args, ctx) => {
    if (args.action === 'attach') {
      return cdp_attach.run({ tab_id: args.tab_id } as never, ctx);
    }
    if (args.action === 'detach') {
      return cdp_detach.run({ tab_id: args.tab_id } as never, ctx);
    }
    if (args.action === 'list') {
      return cdp_attached_tabs.run({} as never, ctx);
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
  tier: 'privileged',
  admin_only: true,
  required_optional_permissions: ['debugger'],
  supportedBrowsers: ['chrome'],
  description:
    "Override viewport / device metrics on an attached CDP tab for responsive testing. Actions: 'set' (apply `width`+`height`+optional `device_scale_factor`/`mobile`/`user_agent`), 'clear' (revert overrides). Tab must be attached via cdp_session first.",
  argsSchema: CdpEmulateArgs,
  run: async (args, ctx) => {
    if (args.action === 'set') {
      if (args.width == null || args.height == null)
        return { ok: false, reason: "'width' and 'height' required for set" };
      return cdp_emulate_device.run(
        {
          tab_id: args.tab_id,
          width: args.width,
          height: args.height,
          device_scale_factor: args.device_scale_factor,
          mobile: args.mobile,
          user_agent: args.user_agent,
        } as never,
        ctx,
      );
    }
    if (args.action === 'clear') {
      return cdp_clear_emulation.run({ tab_id: args.tab_id } as never, ctx);
    }
    return { ok: false, reason: `Unknown cdp_emulate action: ${args.action as string}` };
  },
};

// ────────────────────────────────────────────────────────────────────────────
// evaluate_javascript — canonical name for execute_javascript
// ────────────────────────────────────────────────────────────────────────────

const EvaluateJsArgs = z.object({
  text: z.string().min(1),
  tabId: z.string().optional(),
  tab_id: z.number().int().optional(),
  arg: z.unknown().optional(),
});
type EvaluateJsArgs = z.infer<typeof EvaluateJsArgs>;

export const evaluate_javascript: ToolHandler<EvaluateJsArgs, unknown> = {
  name: 'evaluate_javascript',
  tier: 'privileged',
  admin_only: true,
  description:
    "Evaluate JavaScript in the page context. Returns the value of the last expression — do NOT use 'return' at top level. Admin-gated. Prefer DOM tools (read_page, find, computer, form_input) when possible — JS exec is XSS-equivalent and bypasses our safety nets.",
  argsSchema: EvaluateJsArgs,
  run: async (args, ctx) => {
    const tabId =
      args.tab_id ??
      (args.tabId ? Number.parseInt(args.tabId, 10) : undefined);
    return execute_javascript.run(
      { code: args.text, tab_id: tabId, arg: args.arg } as never,
      ctx,
    );
  },
};

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
  evaluate_javascript,
];
