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

  // recording (CDP-backed; uses scripting + downloads on export)
  record_gif: ['activeTab', 'tabs', 'scripting', 'downloads'],

  // focused extractors
  extract_table: ['activeTab', 'scripting'],
  screenshot_region: ['activeTab', 'scripting'],

  // small utilities
  get_clipboard: ['activeTab', 'scripting'],
  tab_audio_inspect: ['tabs'],
  mutation_watch: ['activeTab', 'scripting'],

  // structured-data extractor
  extract_microdata: ['activeTab', 'scripting'],

  // demos (uses tabs + scripting + storage + webNavigation for re-injection)
  record_demo: ['tabs', 'activeTab', 'scripting', 'storage', 'webNavigation'],
  list_demos: ['storage'],
  describe_demo: ['storage'],
  replay_demo: ['tabs', 'activeTab', 'scripting', 'storage'],
  delete_demo: ['storage'],

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
  list_demos_tools: [],
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

  // ─── canonical merger routers (2026-05-05) ───────────────────────────
  // Permissions inherited from the handlers each one delegates to.
  ai: [],
  cookies: [],
  webmcp: ['activeTab', 'scripting'],
  storage: ['storage'],
  tab_groups: ['tabs', 'tabGroups'],
  bookmarks: ['bookmarks'],
  history: ['history'],
  recently_closed: [],
  stylesheet: ['activeTab', 'scripting'],
  cdp_session: ['activeTab'],
  cdp_emulate: ['activeTab'],
  evaluate_javascript: ['activeTab', 'scripting'],
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

// Note: `ServerCapabilityHandoff` and `buildServerCapabilityHandoff` were
// retired with the May 2026 registry redesign. aidream now loads tool
// definitions from `public.tools` via `ToolRegistryV2.load_from_database()`;
// the server-handoff JSON we used to ship is no longer consumed by anyone.
// See docs/MATRX_EXTEND_MIGRATION_GUIDE.md.

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

// Removed in May 2026: BROWSER_DOM_PAYLOAD_SCHEMA, ALWAYS_ON_TOOLS,
// isDiscoveryListTool, buildServerCapabilityHandoff. The aidream backend
// now loads tool definitions from `public.tools` rows, so the client no
// longer ships a server-handoff JSON. The catalog manifest above
// (`buildToolCatalogManifest`) is still emitted for dev tooling and the
// in-extension Tools tab — see scripts/dump-tool-catalog.ts.
