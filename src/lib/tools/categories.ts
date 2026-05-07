/**
 * Tool categories — the second-most-important file in this codebase.
 *
 * Why categories matter: a 100-tool surface won't fit in any reasonable
 * model's context window. Even when it does, the noise hurts decision
 * quality. Categories let an agent boot with a tiny core set + the names of
 * category list-tools; if it needs more, it asks for the category and gets
 * the full schemas at that point.
 *
 * Architecture (server-coordinated):
 *   1. Extension advertises `coreToolNames()` on every chat: ~10 always-on
 *      tools + the master `list_browser_tools` discovery tool.
 *   2. Agent calls `list_browser_tools` → receives the category index
 *      (name, description, tool count, name of the category's list-tool).
 *   3. Agent calls `list_<category>_tools` for the category it needs. The
 *      response is full tool schemas. The Python server side observes that
 *      call and registers those tools as available for subsequent calls in
 *      this conversation.
 *   4. Agent now has the category's tools and can call them normally.
 *
 * The extension's role: define the categories, expose the discovery tools,
 * make it easy to find a tool's category. The Python server takes care of
 * dynamic schema registration based on which list_*_tools the agent has
 * already invoked.
 */

import { isBrowserSupported } from '@/lib/browser/detect';
import type { AnyToolHandler, ToolTier } from '@/lib/tools/types';

export type ToolCategory =
  /** Always advertised — minimum useful set. */
  | 'core'
  /** Page understanding — accessibility tree, find, text extraction, inspection. */
  | 'page'
  /** Generic page interaction — click, type, scroll, keys, hover, focus. */
  | 'interact'
  /** Form-specific operations: dropdowns, checkboxes, radios, submit, file inputs. */
  | 'forms'
  /** Tabs + tab groups + per-tab navigation. */
  | 'tabs'
  /** Personal browser data — bookmarks, history, downloads, recently closed. */
  | 'history'
  /** On-device AI (Gemini Nano + siblings). Free, offline, multimodal. */
  | 'ai'
  /** Files: downloads, MHTML, clipboard, system notifications. */
  | 'files'
  /** Persistent agent-side memory across runs. */
  | 'memory'
  /** Asking the human — questions, choices, secrets, takeover, plan-approval. */
  | 'ask'
  /** Privileged page modifications + desktop bridge. Always confirm. */
  | 'advanced'
  /** Record / replay user demonstrations. */
  | 'demos'
  /** User-saved clues for the agent (notes, screenshots, GIFs, demo refs). */
  | 'guidance'
  /** Chrome DevTools Protocol — full-page screenshots, a11y tree, network capture, etc. (admin) */
  | 'debug'
  /** Cookies (admin). */
  | 'cookies'
  /** WebMCP — register / call page-side tools (admin). */
  | 'webmcp';

export interface CategoryMeta {
  category: ToolCategory;
  /** Human-readable label for the discovery tool description. */
  label: string;
  /** One-paragraph description shown to the agent in `list_browser_tools`. */
  description: string;
  /** Name of the list_*_tools discovery tool that returns this category's schemas. */
  list_tool_name: string;
  /** True if only admin users see this category. */
  admin_only?: boolean;
}

export const CATEGORIES: Record<ToolCategory, CategoryMeta> = {
  core: {
    category: 'core',
    label: 'Core',
    description:
      'Always-available essentials: read the active page, take a screenshot, find elements by description, click, type, navigate, ask the user, batch multiple calls. The agent has these without calling any list tool.',
    list_tool_name: 'list_core_tools',
  },
  page: {
    category: 'page',
    label: 'Page understanding',
    description:
      'Deep page inspection: accessibility tree with reference IDs, natural-language element search, article-style text extraction, link discovery, computed styles, element-at-point, form-field discovery.',
    list_tool_name: 'list_page_tools',
  },
  interact: {
    category: 'interact',
    label: 'Page interaction',
    description:
      'Beyond core click/type: scrolling, keyboard sequences (chords + named keys), hover, focus, blur, right-click, wait-for conditions.',
    list_tool_name: 'list_interact_tools',
  },
  forms: {
    category: 'forms',
    label: 'Forms',
    description:
      'Form-specific actions: select dropdown options, set checkboxes, pick radio buttons, submit forms, upload files into <input type="file">.',
    list_tool_name: 'list_forms_tools',
  },
  tabs: {
    category: 'tabs',
    label: 'Tabs & windows',
    description:
      'List, switch, open, close, duplicate, pin, mute, reload tabs. Back/forward navigation, zoom, move tabs between windows. Create and manage tab groups.',
    list_tool_name: 'list_tabs_tools',
  },
  history: {
    category: 'history',
    label: 'Browser history & bookmarks',
    description:
      'Search bookmarks, search browsing history, list recent visits, list downloads, list and restore recently-closed tabs.',
    list_tool_name: 'list_history_tools',
  },
  ai: {
    category: 'ai',
    label: 'On-device AI (Gemini Nano)',
    description:
      'Free, offline, on-GPU AI tasks: summarize, classify, extract structured JSON, translate, detect language, proofread, describe images, check for prompt injection. Use these BEFORE expensive cloud calls when quality permits.',
    list_tool_name: 'list_ai_tools',
  },
  files: {
    category: 'files',
    label: 'Files & system',
    description:
      'Download files, archive page as MHTML, read/write clipboard, show system notifications.',
    list_tool_name: 'list_files_tools',
  },
  memory: {
    category: 'memory',
    label: 'Agent memory',
    description:
      'Persistent agent-namespaced storage that survives across runs. Use to remember user preferences, scratchpads, progress markers between conversations.',
    list_tool_name: 'list_memory_tools',
  },
  ask: {
    category: 'ask',
    label: 'Ask the user',
    description:
      'Pause and ask the human: open question, multiple-choice, secret (masked) input, full takeover (CAPTCHA / login), and plan-approval (propose a plan; the human confirms before you execute).',
    list_tool_name: 'list_ask_tools',
  },
  advanced: {
    category: 'advanced',
    label: 'Advanced (privileged)',
    description:
      'Privileged tools that always require user approval: arbitrary JavaScript execution, CSS injection, desktop-bridge commands. Use only when no purpose-built tool fits.',
    list_tool_name: 'list_advanced_tools',
  },
  demos: {
    category: 'demos',
    label: 'Demos (record & replay)',
    description:
      'Record a user demonstration of a workflow once, then replay it on demand with parameter substitution. Self-healing selector chain (matrx-ref → id → testid → ARIA → text → CSS path) survives DOM churn between recording and replay. Use to automate repetitive multi-step workflows: form filling, expense reports, recurring searches, login flows. Replay is privileged — it can click, type, submit, and navigate, so it always asks the user to confirm.',
    list_tool_name: 'list_demos_tools',
  },
  guidance: {
    category: 'guidance',
    label: 'Guidance (user-saved clues)',
    description:
      "User-saved clues for the agent — domain-scoped notes, screenshots, GIFs, and demo references. Whenever the user opens a tab on a matching domain, the agent's context auto-includes any guidance the user has saved there. Tools here let the agent add more notes (`save_guidance_note`), browse what exists (`list_guidance` / `get_guidance_item`), and remove stale items (`delete_guidance_item`). Captured artifacts (screenshots, GIFs) are created via the Guidance sidepanel tab.",
    list_tool_name: 'list_guidance_tools',
  },
  debug: {
    category: 'debug',
    label: 'Debugger / DevTools (admin)',
    description:
      'Chrome DevTools Protocol: full-page screenshots, accessibility tree dumps, network request capture, coordinate-based clicks that bypass shadow DOM, performance metrics, device emulation, PDF print, console message reads.',
    list_tool_name: 'list_debug_tools',
    admin_only: true,
  },
  cookies: {
    category: 'cookies',
    label: 'Cookies (admin)',
    description: 'Read, set, and delete cookies for any domain.',
    list_tool_name: 'list_cookies_tools',
    admin_only: true,
  },
  webmcp: {
    category: 'webmcp',
    label: 'WebMCP (admin)',
    description:
      'Discover and call tools that pages have registered via `navigator.modelContext.registerTool` (Chrome 146+).',
    list_tool_name: 'list_webmcp_tools',
    admin_only: true,
  },
};

/**
 * Authoritative map of tool name → category. Single source of truth so we
 * don't have to touch every handler file when a tool moves.
 */
export const CATEGORY_BY_TOOL: Record<string, ToolCategory> = {
  // ─── core (always advertised; ~10 tools) ────────────────────────────────
  list_browser_tools: 'core',
  list_core_tools: 'core',
  browser_batch: 'core',
  get_active_tab: 'core',
  read_page: 'core',
  find: 'core',
  take_screenshot: 'core',
  navigate_active_tab: 'core',
  click_element: 'core',
  type_into_element: 'core',
  ask_user: 'core',

  // ─── page understanding ─────────────────────────────────────────────────
  get_page_text: 'page',
  read_active_page: 'page',
  query_elements: 'page',
  get_page_selection: 'page',
  find_text_on_page: 'page',
  get_page_links: 'page',
  get_computed_style: 'page',
  get_element_at_point: 'page',
  inspect_element: 'page',
  get_element_details: 'page',
  get_form_fields: 'page',
  extract_table: 'page',
  screenshot_region: 'page',
  mutation_watch: 'page',
  extract_microdata: 'page',
  fetch_url_as_markdown: 'page',

  // ─── page interaction ───────────────────────────────────────────────────
  scroll_page: 'interact',
  wait_for: 'interact',
  press_keys: 'interact',
  hover_element: 'interact',
  focus_element: 'interact',
  blur_element: 'interact',
  right_click_element: 'interact',
  sleep: 'interact',

  // ─── forms ──────────────────────────────────────────────────────────────
  select_dropdown_option: 'forms',
  set_checkbox: 'forms',
  set_radio: 'forms',
  submit_form: 'forms',
  file_upload: 'forms',

  // ─── tabs ───────────────────────────────────────────────────────────────
  list_open_tabs: 'tabs',
  get_tab_groups: 'tabs',
  get_tab_info: 'tabs',
  tab_audio_inspect: 'tabs',
  open_new_tab: 'tabs',
  close_tab: 'tabs',
  switch_to_tab: 'tabs',
  duplicate_tab: 'tabs',
  pin_tab: 'tabs',
  mute_tab: 'tabs',
  reload_tab: 'tabs',
  go_back: 'tabs',
  go_forward: 'tabs',
  set_tab_zoom: 'tabs',
  move_tab: 'tabs',
  resize_window: 'tabs',
  create_tab_group: 'tabs',
  add_tabs_to_group: 'tabs',
  remove_tabs_from_group: 'tabs',
  update_tab_group: 'tabs',

  // ─── history ────────────────────────────────────────────────────────────
  search_bookmarks: 'history',
  list_bookmark_tree: 'history',
  search_history: 'history',
  list_recent_history: 'history',
  list_downloads: 'history',
  list_recently_closed: 'history',
  restore_recently_closed: 'history',

  // ─── on-device AI ───────────────────────────────────────────────────────
  ai_check_availability: 'ai',
  ai_summarize: 'ai',
  ai_classify: 'ai',
  ai_extract_json: 'ai',
  ai_translate: 'ai',
  ai_detect_language: 'ai',
  ai_proofread: 'ai',
  ai_describe_image: 'ai',
  ai_check_prompt_injection: 'ai',

  // ─── files ──────────────────────────────────────────────────────────────
  download_url: 'files',
  cancel_download: 'files',
  set_clipboard: 'files',
  get_clipboard: 'files',
  notify_user: 'files',
  save_page_as_mhtml: 'files',

  // ─── memory ─────────────────────────────────────────────────────────────
  set_extension_storage: 'memory',
  get_extension_storage: 'memory',
  list_extension_storage: 'memory',
  remember_for_domain: 'memory',

  // ─── ask ────────────────────────────────────────────────────────────────
  ask_user_choice: 'ask',
  ask_user_secret: 'ask',
  request_user_takeover: 'ask',
  update_plan: 'ask',

  // ─── canonical mega-tools (browser_tools_canonical.json) ───────────────
  // Each occupies the category that best matches its dominant sub-action;
  // they're surfaced in core via the categoryToolNames pull when an agent
  // is configured against the canonical groupings.
  computer: 'core',
  form_input: 'forms',
  navigate: 'core',
  tabs: 'tabs',
  downloads: 'files',
  memory: 'memory',
  clipboard: 'files',
  upload_file: 'files',
  drop_file: 'files',
  read_pdf: 'files',

  // ─── advanced (privileged) ──────────────────────────────────────────────
  execute_javascript: 'advanced',
  inject_stylesheet: 'advanced',
  remove_stylesheet: 'advanced',
  desktop_run_command: 'advanced',
  record_gif: 'advanced',

  // ─── demos (record & replay) ────────────────────────────────────────────
  record_demo: 'demos',
  list_demos: 'demos',
  describe_demo: 'demos',
  replay_demo: 'demos',
  delete_demo: 'demos',

  // ─── guidance (user-saved clues for the agent) ──────────────────────────
  save_guidance_note: 'guidance',
  list_guidance: 'guidance',
  get_guidance_item: 'guidance',
  delete_guidance_item: 'guidance',

  // ─── debug (admin + CDP) ────────────────────────────────────────────────
  cdp_attach: 'debug',
  cdp_detach: 'debug',
  cdp_attached_tabs: 'debug',
  cdp_full_page_screenshot: 'debug',
  cdp_a11y_tree: 'debug',
  cdp_input_click_xy: 'debug',
  cdp_input_type: 'debug',
  cdp_network_capture_start: 'debug',
  cdp_network_capture_drain: 'debug',
  cdp_network_capture_stop: 'debug',
  cdp_network_get_body: 'debug',
  cdp_print_pdf: 'debug',
  cdp_perf_metrics: 'debug',
  cdp_emulate_device: 'debug',
  cdp_clear_emulation: 'debug',
  read_console_messages: 'debug',
  read_network_requests: 'debug',
  get_request_body: 'debug',

  // ─── cookies (admin) ────────────────────────────────────────────────────
  get_cookies: 'cookies',
  set_cookie: 'cookies',
  delete_cookie: 'cookies',

  // ─── webmcp (admin) ─────────────────────────────────────────────────────
  webmcp_check_availability: 'webmcp',
  webmcp_list_page_tools: 'webmcp',
  webmcp_call_page_tool: 'webmcp',

  // ─── canonical merger routers (2nd wave 2026-05-05) ────────────────────
  ai: 'ai',
  cookies: 'cookies',
  webmcp: 'webmcp',
  storage: 'memory',
  tab_groups: 'tabs',
  bookmarks: 'history',
  history: 'history',
  recently_closed: 'history',
  stylesheet: 'advanced',
  cdp_session: 'debug',
  cdp_emulate: 'debug',
  evaluate_javascript: 'advanced',
};

export function categoryOf(toolName: string): ToolCategory {
  return CATEGORY_BY_TOOL[toolName] ?? 'advanced';
}

/**
 * The canonical surface — names that exist as active rows in `public.tl_def`
 * (the DB the server uses to advertise tools to agents). Everything else
 * the registry exports is either:
 *   - an internal delegate that a mega-tool router calls (`click_element`
 *     called by `computer.action='left_click'`, `take_screenshot` by
 *     `computer.action='screenshot'`, etc.), or
 *   - a `list_<category>_tools` discovery tool registered via
 *     `discover_handlers` (these aren't in this list — they're admin-only
 *     scaffolding the agent rarely sees).
 *
 * The Tools tab uses this to default-filter the list down to "what the
 * agent actually sees in chat" instead of dumping all 149 internal handlers.
 *
 * Keep in lockstep with the DB. Regenerate the DB diff with the script in
 * `scripts/dump-tool-catalog.ts` if anything looks off.
 */
export const CANONICAL_SURFACE: ReadonlySet<string> = new Set([
  // ─── core (advertised on every chat) ────────────────────────────────────
  'list_browser_tools',
  'browser_batch',
  'read_page',
  'find',
  'ask_user',
  // ─── canonical mega-tool routers ────────────────────────────────────────
  'computer',
  'navigate',
  'tabs',
  'tab_groups',
  'form_input',
  'submit_form',
  'wait_for',
  'sleep',
  'clipboard',
  'downloads',
  'memory',
  'storage',
  'upload_file',
  'drop_file',
  'read_pdf',
  'ai',
  'bookmarks',
  'history',
  'recently_closed',
  'stylesheet',
  'evaluate_javascript',
  'cookies',
  'webmcp',
  'cdp_session',
  'cdp_emulate',
  // ─── page understanding (kept granular) ─────────────────────────────────
  'read_active_page',
  'query_elements',
  'get_page_selection',
  'find_text_on_page',
  'get_page_links',
  'get_page_text',
  'get_element_at_point',
  'get_element_details',
  'get_form_fields',
  'inspect_element',
  'get_computed_style',
  'extract_microdata',
  'extract_table',
  'fetch_url_as_markdown',
  'mutation_watch',
  'screenshot_region',
  'tab_audio_inspect',
  // ─── ask + plan ─────────────────────────────────────────────────────────
  'request_user_takeover',
  'update_plan',
  'ask_user_choice',
  'ask_user_secret',
  // ─── files / windows ────────────────────────────────────────────────────
  'notify_user',
  'save_page_as_mhtml',
  'resize_window',
  // ─── recording / demos / guidance ───────────────────────────────────────
  'record_gif',
  'record_demo',
  'list_demos',
  'describe_demo',
  'replay_demo',
  'delete_demo',
  'save_guidance_note',
  'list_guidance',
  'get_guidance_item',
  'delete_guidance_item',
  // ─── memory write (granular kept) ───────────────────────────────────────
  'remember_for_domain',
  // ─── debug / CDP (admin) ────────────────────────────────────────────────
  'cdp_a11y_tree',
  'cdp_full_page_screenshot',
  'cdp_input_click_xy',
  'cdp_input_type',
  'cdp_perf_metrics',
  'cdp_print_pdf',
  'cdp_network_capture_start',
  'cdp_network_capture_drain',
  'cdp_network_capture_stop',
  'cdp_network_get_body',
  'read_console_messages',
  'read_network_requests',
  'get_request_body',
  'desktop_run_command',
]);

export function isCanonicalSurface(toolName: string): boolean {
  return CANONICAL_SURFACE.has(toolName);
}

export function toolsInCategory(
  handlers: AnyToolHandler[],
  category: ToolCategory,
  opts: { isAdmin?: boolean } = {},
): AnyToolHandler[] {
  return handlers.filter(
    (h) =>
      categoryOf(h.name) === category &&
      isBrowserSupported(h.supportedBrowsers) &&
      (opts.isAdmin ? true : !h.admin_only),
  );
}

export function tierAndCategoryOf(handler: AnyToolHandler): {
  tier: ToolTier;
  category: ToolCategory;
} {
  return { tier: handler.tier, category: categoryOf(handler.name) };
}

export const ALL_CATEGORIES: ToolCategory[] = Object.keys(CATEGORIES) as ToolCategory[];
