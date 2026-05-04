/**
 * Tool catalog → structured spec the agent server (or our DB) can read
 * verbatim. Each entry mirrors what's needed to register a tool with the
 * Matrx tools backend:
 *
 *   { name, description, tier, input_schema, required_permissions, surface_bundles }
 *
 * `input_schema` is a strict JSON Schema produced from the Zod definition.
 *
 * Use cases:
 *   - `pnpm catalog:tools` writes the catalog to disk for diffing against
 *     the existing DB rows.
 *   - The Pilot UI's "Tools available" panel renders this same list to
 *     show users which capabilities the active agent has.
 */

import { CATEGORIES, type ToolCategory, categoryOf } from '@/lib/tools/categories';
import { listAllHandlers } from '@/lib/tools/registry';
import type { ToolTier } from '@/lib/tools/types';
import { zodToJsonSchema } from 'zod-to-json-schema';

export interface ToolCatalogEntry {
  name: string;
  description: string;
  tier: ToolTier;
  /** Discovery category this tool belongs to. */
  category: ToolCategory;
  input_schema: ReturnType<typeof zodToJsonSchema>;
  /** Chrome `permissions` keys this tool needs (base manifest). */
  required_permissions: string[];
  /**
   * Optional permissions the user must grant at runtime via
   * `chrome.permissions.request`. Tools advertise these so the dispatcher can
   * gate them and the UI can prompt.
   */
  required_optional_permissions: string[];
  /** Filtered out of non-admin tool bundles. Used for experimental tools. */
  admin_only: boolean;
  /** Which surface bundles include this tool. */
  surface_bundles: ('assistant' | 'pilot' | 'pilot+privileged')[];
}

/**
 * Manually curated permission map. The dispatcher calls real chrome.* APIs
 * that map to manifest entries — we list them here so the catalog ships an
 * audit-ready row.
 */
const PERMISSIONS_BY_TOOL: Record<string, string[]> = {
  // page-read (use scripting + activeTab)
  get_active_tab: ['activeTab'],
  get_page_selection: ['activeTab', 'scripting'],
  read_active_page: ['activeTab', 'scripting'],
  take_screenshot: ['activeTab'],
  query_elements: ['activeTab', 'scripting'],

  // inspect
  find_text_on_page: ['activeTab', 'scripting'],
  get_page_links: ['activeTab', 'scripting'],
  get_computed_style: ['activeTab', 'scripting'],
  get_element_at_point: ['activeTab', 'scripting'],
  inspect_element: ['activeTab', 'scripting'],

  // forms (read)
  get_form_fields: ['activeTab', 'scripting'],

  // tabs (read)
  list_open_tabs: ['tabs'],
  get_tab_groups: ['tabs', 'tabGroups'],
  get_tab_info: ['tabs'],

  // browser-data (read)
  search_bookmarks: ['bookmarks'],
  list_bookmark_tree: ['bookmarks'],
  search_history: ['history'],
  list_recent_history: ['history'],
  list_downloads: ['downloads'],

  // page actions
  navigate_active_tab: ['tabs', 'activeTab'],
  click_element: ['activeTab', 'scripting'],
  type_into_element: ['activeTab', 'scripting'],
  scroll_page: ['activeTab', 'scripting'],
  wait_for: ['activeTab', 'scripting'],
  set_clipboard: ['activeTab', 'scripting', 'clipboardWrite'],

  // keyboard / mouse
  press_keys: ['activeTab', 'scripting'],
  hover_element: ['activeTab', 'scripting'],
  focus_element: ['activeTab', 'scripting'],
  blur_element: ['activeTab', 'scripting'],
  right_click_element: ['activeTab', 'scripting'],

  // form actions
  select_dropdown_option: ['activeTab', 'scripting'],
  set_checkbox: ['activeTab', 'scripting'],
  set_radio: ['activeTab', 'scripting'],
  submit_form: ['activeTab', 'scripting'],

  // tab actions
  open_new_tab: ['tabs'],
  close_tab: ['tabs'],
  switch_to_tab: ['tabs'],
  duplicate_tab: ['tabs'],
  pin_tab: ['tabs'],
  mute_tab: ['tabs'],
  reload_tab: ['tabs'],
  go_back: ['tabs'],
  go_forward: ['tabs'],
  set_tab_zoom: ['tabs'],
  move_tab: ['tabs'],
  resize_window: ['tabs'],
  create_tab_group: ['tabs', 'tabGroups'],
  add_tabs_to_group: ['tabs', 'tabGroups'],
  remove_tabs_from_group: ['tabs', 'tabGroups'],
  update_tab_group: ['tabGroups'],

  // downloads + notifications
  download_url: ['downloads'],
  cancel_download: ['downloads'],
  notify_user: ['notifications'],

  // ask-user (no chrome perms — uses messaging)
  ask_user: [],
  ask_user_choice: [],
  ask_user_secret: [],
  request_user_takeover: [],

  // privileged
  execute_javascript: ['activeTab', 'scripting'],
  inject_stylesheet: ['activeTab', 'scripting'],
  remove_stylesheet: ['activeTab', 'scripting'],
  set_extension_storage: ['storage'],
  get_extension_storage: ['storage'],
  list_extension_storage: ['storage'],
  desktop_run_command: ['nativeMessaging'],

  // on-device AI (no chrome perms — uses globalThis.LanguageModel et al.)
  ai_check_availability: [],
  ai_summarize: [],
  ai_classify: [],
  ai_extract_json: [],
  ai_translate: [],
  ai_detect_language: [],
  ai_proofread: [],
  ai_describe_image: [],
  ai_check_prompt_injection: [],

  // CDP — base manifest still needs activeTab; the optional `debugger` perm
  // is checked separately via required_optional_permissions.
  cdp_attach: ['activeTab'],
  cdp_detach: [],
  cdp_attached_tabs: [],
  cdp_full_page_screenshot: ['activeTab'],
  cdp_a11y_tree: ['activeTab'],
  cdp_input_click_xy: ['activeTab'],
  cdp_input_type: ['activeTab'],
  cdp_network_capture_start: ['activeTab'],
  cdp_network_capture_drain: [],
  cdp_network_capture_stop: [],
  cdp_network_get_body: [],
  cdp_print_pdf: ['activeTab'],
  cdp_perf_metrics: ['activeTab'],
  cdp_emulate_device: ['activeTab'],
  cdp_clear_emulation: [],

  // WebMCP — runs in MAIN world
  webmcp_check_availability: ['activeTab', 'scripting'],
  webmcp_list_page_tools: ['activeTab', 'scripting'],
  webmcp_call_page_tool: ['activeTab', 'scripting'],

  // Optional-permission family
  get_cookies: [],
  set_cookie: [],
  delete_cookie: [],
  save_page_as_mhtml: ['activeTab'],
  list_recently_closed: [],
  restore_recently_closed: [],

  // ─── new (2026-05-01) ────────────────────────────────────────────────
  // discovery tools
  list_browser_tools: [],
  list_core_tools: [],
  list_page_tools: [],
  list_interact_tools: [],
  list_forms_tools: [],
  list_tabs_tools: [],
  list_history_tools: [],
  list_ai_tools: [],
  list_files_tools: [],
  list_memory_tools: [],
  list_ask_tools: [],
  list_advanced_tools: [],
  list_debug_tools: [],
  list_cookies_tools: [],
  list_webmcp_tools: [],

  // batching
  browser_batch: [],

  // ref-based page understanding
  read_page: ['activeTab', 'scripting'],
  find: ['activeTab', 'scripting'],
  get_page_text: ['activeTab', 'scripting'],

  // forms additions
  file_upload: ['activeTab', 'scripting'],

  // CDP additions
  read_console_messages: ['activeTab'],

  // ask-user additions
  update_plan: [],
};

function bundlesForTier(tier: ToolTier): ToolCatalogEntry['surface_bundles'] {
  if (tier === 'read') return ['assistant', 'pilot', 'pilot+privileged'];
  if (tier === 'action' || tier === 'ask-user') return ['pilot', 'pilot+privileged'];
  return ['pilot+privileged'];
}

export function buildToolCatalog(): ToolCatalogEntry[] {
  return listAllHandlers().map((h) => ({
    name: h.name,
    description: h.description,
    tier: h.tier,
    category: categoryOf(h.name),
    input_schema: zodToJsonSchema(h.argsSchema, {
      $refStrategy: 'none',
      target: 'jsonSchema7',
    }),
    required_permissions: PERMISSIONS_BY_TOOL[h.name] ?? [],
    required_optional_permissions: h.required_optional_permissions ?? [],
    admin_only: h.admin_only ?? false,
    surface_bundles: bundlesForTier(h.tier),
  }));
}

export interface CategoryManifestEntry {
  category: ToolCategory;
  label: string;
  description: string;
  list_tool: string;
  admin_only: boolean;
  tool_names: string[];
}

export interface ToolCatalogManifest {
  generated_at: string;
  source: 'matrx-extend';
  /** Always-on minimum set + every list_<cat>_tools discovery tool. */
  core_bundle: string[];
  /** Suitable for the Assistant surface (Chat tab). */
  assistant_bundle: string[];
  /** Suitable for the Pilot surface, no privileged tools. */
  pilot_bundle: string[];
  /** Pilot + privileged. Trusted agents only. */
  pilot_with_privileged_bundle: string[];
  /** Category index for the hierarchical discovery system. */
  categories: CategoryManifestEntry[];
  tools: ToolCatalogEntry[];
}

/**
 * Server-side handoff manifest for the new capability-based agent API.
 *
 * The Python `matrx-ai` runtime registers a `browser-dom` capability with:
 *   - One server-side discovery handler (`load_browser_tools`) that maps a
 *     category name to the list of tool names to add to the conversation's
 *     toolset.
 *   - A payload model the client sends in `client.state["browser-dom"]`
 *     describing the user's current browser context.
 *
 * This manifest is the source of truth for the routing rule. Drop it next
 * to the server-side handler implementation; the handler reads
 * `category_routing[args.category]` to know what to queue via
 * `ctx.queue_tool_changes(add=...)`.
 */
export interface ServerCapabilityHandoff {
  generated_at: string;
  source: 'matrx-extend';
  capability_name: 'browser-dom';
  /** JSON-Schema for the payload — drop into a Pydantic model on the server. */
  payload_schema: Record<string, unknown>;
  /**
   * Tool name(s) the capability brings online unconditionally. The discovery
   * tool is the only entry point — everything else loads on demand.
   */
  always_on_tools: string[];
  /** category → list of tool names to register when load_browser_tools picks this category. */
  category_routing: Record<string, string[]>;
  /**
   * Per-tool metadata the discovery handler can consult to decide what the
   * client can actually run. Tools with `admin_only: true` should be filtered
   * out unless `state.is_admin === true`. Tools with non-empty
   * `required_optional_permissions` should be filtered out unless
   * `state.optional_permissions_granted` includes them all.
   */
  tool_metadata: Record<
    string,
    {
      tier: ToolTier;
      category: ToolCategory;
      admin_only: boolean;
      required_optional_permissions: string[];
    }
  >;
  /** Total tool counts for sanity. */
  totals: {
    tools: number;
    categories: number;
    admin_only_tools: number;
    optional_perm_gated_tools: number;
  };
}

export function buildToolCatalogManifest(): ToolCatalogManifest {
  const tools = buildToolCatalog();
  // Build category manifest entries — tool names per category.
  const categoryEntries: CategoryManifestEntry[] = Object.values(CATEGORIES).map((meta) => ({
    category: meta.category,
    label: meta.label,
    description: meta.description,
    list_tool: meta.list_tool_name,
    admin_only: !!meta.admin_only,
    tool_names: tools.filter((t) => t.category === meta.category).map((t) => t.name),
  }));
  // Core bundle = tools in 'core' category PLUS every list_<category>_tools.
  const listToolNames = Object.values(CATEGORIES).map((m) => m.list_tool_name);
  const coreBundle = Array.from(
    new Set([
      ...tools.filter((t) => t.category === 'core').map((t) => t.name),
      ...listToolNames,
    ]),
  );
  return {
    generated_at: new Date().toISOString(),
    source: 'matrx-extend',
    core_bundle: coreBundle,
    assistant_bundle: tools.filter((t) => t.tier === 'read').map((t) => t.name),
    pilot_bundle: tools
      .filter((t) => t.tier === 'read' || t.tier === 'action' || t.tier === 'ask-user')
      .map((t) => t.name),
    pilot_with_privileged_bundle: tools.map((t) => t.name),
    categories: categoryEntries,
    tools,
  };
}

/**
 * The client-side payload schema the extension will ship in
 * `client.state["browser-dom"]`. Stays narrow on purpose — this is for
 * orchestration (which tools to load), not model-facing facts (those go in
 * the regular `context` field).
 */
const BROWSER_DOM_PAYLOAD_SCHEMA: Record<string, unknown> = {
  type: 'object',
  title: 'BrowserDomPayload',
  description:
    "Runtime state for the matrx-extend Chrome extension's browser-dom capability. Keeps tool-routing decisions data-driven: the discovery handler can filter the routing map by `is_admin`, by `optional_permissions_granted`, or by inspecting the user's actual browser state.",
  properties: {
    current_url: {
      type: ['string', 'null'],
      description: 'URL of the active tab. Null if no tab is focused or the URL is restricted.',
    },
    current_tab_id: {
      type: ['integer', 'null'],
      description: 'Chrome tab id of the active tab.',
    },
    current_window_id: {
      type: ['integer', 'null'],
      description: 'Chrome window id containing the active tab.',
    },
    page_title: {
      type: ['string', 'null'],
    },
    page_lang: {
      type: ['string', 'null'],
      description: 'IETF tag from <html lang="…">.',
    },
    tab_status: {
      type: ['string', 'null'],
      enum: ['loading', 'complete', null],
    },
    surface: {
      type: 'string',
      enum: ['assistant', 'pilot'],
      description:
        'Which side-panel surface initiated the request. Drives default category set: assistant=read-only, pilot=full kit.',
    },
    is_admin: {
      type: 'boolean',
      description:
        "True if the user is in `public.admins`. Discovery handler should filter admin-only categories (debug, cookies, webmcp) and admin-only tools when this is false — the model shouldn't even see them.",
    },
    permission_mode: {
      type: 'string',
      enum: ['ask', 'act'],
      description:
        "Per-agent gate the client enforces locally for action-tier tools. Server doesn't enforce, but it's useful for prompt composition (e.g. tell the model 'every action will prompt the user').",
    },
    desktop_bridge: {
      type: 'string',
      enum: ['native', 'http', 'none'],
      description:
        'Whether the matrx-local desktop bridge is reachable. When "none", the discovery handler should skip the `desktop_run_command` tool.',
    },
    onbox_ai_available: {
      type: 'boolean',
      description:
        'True if the on-device Gemini Nano (chrome.ai) is exposed in the user\'s Chrome. When false, the discovery handler may want to surface the AI category but include a hint that all ai_* tools will return availability:unavailable.',
    },
    optional_permissions_granted: {
      type: 'array',
      items: { type: 'string' },
      description:
        "Optional Chrome permissions the user has granted at runtime (e.g. ['debugger','cookies','pageCapture']). Discovery handler should filter tools whose `required_optional_permissions` aren't satisfied — those would fail at the dispatcher anyway.",
    },
    open_tab_count: {
      type: ['integer', 'null'],
      description: 'Number of tabs across all windows. Lightweight signal for "this user has a lot going on".',
    },
    extension_version: {
      type: 'string',
    },
    extension_id: {
      type: 'string',
    },
    loaded_categories: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Categories the agent has already discovered in this conversation. The client tracks this from RESOURCE_CHANGED kind=active_tools events; the server can use it to detect when the model is re-discovering the same category.',
    },
  },
  required: [
    'current_url',
    'current_tab_id',
    'surface',
    'is_admin',
    'permission_mode',
    'desktop_bridge',
    'onbox_ai_available',
    'optional_permissions_granted',
  ],
  additionalProperties: false,
};

/**
 * Recommended always-on tools for the browser-dom capability. The server
 * team's preference is "probably just load_browser_tools". We list one entry
 * here on purpose — every other capability the model could need is exactly
 * one discovery call away. Smaller surface = better decisions.
 */
const ALWAYS_ON_TOOLS: string[] = ['load_browser_tools'];

/**
 * The names of the client-side discovery list-tools — `list_browser_tools`
 * and the per-category `list_<cat>_tools`. They're internal to the
 * extension's own discovery flow and don't belong in the server-side
 * routing payload (the server has its own single `load_browser_tools`).
 *
 * Other tools that legitimately START with `list_` (list_bookmark_tree,
 * list_open_tabs, list_recent_history, etc.) are real read tools and pass
 * through.
 */
function isDiscoveryListTool(name: string): boolean {
  if (name === 'list_browser_tools') return true;
  // Per-category discovery list-tools follow the pattern `list_<category>_tools`.
  const m = /^list_([a-z_]+)_tools$/.exec(name);
  if (!m || !m[1]) return false;
  return Object.prototype.hasOwnProperty.call(CATEGORIES, m[1]);
}

export function buildServerCapabilityHandoff(): ServerCapabilityHandoff {
  const tools = buildToolCatalog();
  const categoryRouting: Record<string, string[]> = {};
  for (const meta of Object.values(CATEGORIES)) {
    const inCat = tools
      .filter((t) => t.category === meta.category)
      // The category list-tools (`list_<cat>_tools`) live in the 'core'
      // category in our extension. Strip them from the routing payload —
      // they're noise on the server side, which uses ONE discovery tool
      // (`load_browser_tools`) instead of N per-category list-tools.
      // Discovery tools (`list_browser_tools`, `list_<cat>_tools`) are noise on
    // the server side — it has its own ONE discovery tool. Strip them. Other
    // legitimate `list_*` tools (list_bookmark_tree, list_recent_history,
    // list_downloads, list_recently_closed) are real read tools and stay.
    .filter((t) => !isDiscoveryListTool(t.name))
      .map((t) => t.name);
    categoryRouting[meta.category] = inCat;
  }
  const toolMetadata: ServerCapabilityHandoff['tool_metadata'] = {};
  for (const t of tools) {
    if (isDiscoveryListTool(t.name)) continue;
    toolMetadata[t.name] = {
      tier: t.tier,
      category: t.category,
      admin_only: t.admin_only,
      required_optional_permissions: t.required_optional_permissions,
    };
  }
  return {
    generated_at: new Date().toISOString(),
    source: 'matrx-extend',
    capability_name: 'browser-dom',
    payload_schema: BROWSER_DOM_PAYLOAD_SCHEMA,
    always_on_tools: ALWAYS_ON_TOOLS,
    category_routing: categoryRouting,
    tool_metadata: toolMetadata,
    totals: {
      tools: Object.keys(toolMetadata).length,
      categories: Object.keys(categoryRouting).length,
      admin_only_tools: Object.values(toolMetadata).filter((m) => m.admin_only).length,
      optional_perm_gated_tools: Object.values(toolMetadata).filter(
        (m) => m.required_optional_permissions.length > 0,
      ).length,
    },
  };
}
