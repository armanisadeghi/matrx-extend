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

/**
 * Category taxonomy (2026-05-19 redesign).
 *
 * Categories are pure UX — they drive the Tools-tab grouping and the
 * `list_<cat>_tools` discovery helpers, NOT routing. Per
 * TOOL_ROUTING_RULES.md, the LLM only sees (name, description, schema);
 * category never affects execution.
 *
 * Mental model per category:
 *   - core         : always-on discovery + batching utilities
 *   - reading      : "what's on the page?"
 *   - interaction  : "do something on the page"
 *   - tabs         : "manage browser tabs / windows"
 *   - capture      : "save or capture something" (downloads, MHTML, GIFs, video)
 *   - chrome       : "the user's personal Chrome data" (cookies, bookmarks, history)
 *   - human        : "human in the loop" (ask user, plan, user todos)
 *   - memory       : "agent state" (scratchpad, storage, domain memos)
 *   - ai           : on-device Chrome AI
 *   - demos        : record + replay user workflows
 *   - guidance     : user-saved hints for the agent
 *   - devtools     : CDP-backed diagnostics + host (admin)
 *   - webmcp       : tools registered by the page via navigator.modelContext
 *   - desktop      : bridge to matrx-local
 *   - credentials  : sign in to a site using a saved Matrx vault login
 */
export type ToolCategory =
  | 'core'
  | 'reading'
  | 'interaction'
  | 'tabs'
  | 'capture'
  | 'chrome'
  | 'human'
  | 'memory'
  | 'ai'
  | 'demos'
  | 'guidance'
  | 'devtools'
  | 'webmcp'
  | 'desktop'
  | 'credentials';

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
      'Always-on discovery + batching utilities. Includes `list_browser_tools` (the category index) and `browser_batch` (run multiple read-tier calls in one round trip). Use the category index to load tools on demand.',
    list_tool_name: 'list_core_tools',
  },
  reading: {
    category: 'reading',
    label: 'Read the page',
    description:
      "Understand what's on the active page. Accessibility-tree summary with reference IDs (`read_page`), natural-language element search (`find`), Ctrl+F text search, link discovery, full readable text, structured-data extraction (tables, microdata, JSON-LD), PDF reading, mutation observers, single-element deep inspection. Use these BEFORE any interaction so you know what's on the page.",
    list_tool_name: 'list_reading_tools',
  },
  interaction: {
    category: 'interaction',
    label: 'Use the page',
    description:
      'Do something on the page. Mouse + keyboard (`computer`), form input + submission (`form_input`, `submit_form`), navigation, waiting for conditions, sleeping, scrolling, clipboard, file upload + drag-drop, CSS injection, JavaScript evaluation. Prefer `wait_for` over `sleep` when you have a concrete condition.',
    list_tool_name: 'list_interaction_tools',
  },
  tabs: {
    category: 'tabs',
    label: 'Tabs & windows',
    description:
      'Manage browser tabs and groups. The `tabs` mega-tool covers list/create/close/switch/reload/pin/mute/duplicate/move/zoom and reading active-tab info. `tab_groups` manages named tab groups. `resize_window` for responsive testing. `chrome_tab_audio_inspect` finds the noisy tab.',
    list_tool_name: 'list_tabs_tools',
  },
  capture: {
    category: 'capture',
    label: 'Save & capture',
    description:
      'Capture artifacts from the browser: file downloads, MHTML snapshots of a page, region screenshots, animated GIFs of user actions, video recordings of a tab. Pairs with the cloud-file system — most produce a `file_id` you can pass to later tools.',
    list_tool_name: 'list_capture_tools',
  },
  chrome: {
    category: 'chrome',
    label: 'Chrome user data',
    description:
      "Access the user's personal Chrome data — cookies for any domain, bookmarks, browsing history, recently-closed sessions. Only the Chrome extension can read these (server-side Playwright runs a fresh browser context with none of the user's real data). All tools here are admin-restricted by default.",
    list_tool_name: 'list_chrome_tools',
    admin_only: true,
  },
  human: {
    category: 'human',
    label: 'Talk to the user',
    description:
      'Loop the human in. `user` (six modes: confirm/choice/choice_many/text/secret/notify), `update_plan` (propose a plan and wait for approval), `request_user_takeover` (hand control back so the user can do something the agent cannot), and `user_todos` (assign work to the user). Per-conversation state.',
    list_tool_name: 'list_human_tools',
  },
  memory: {
    category: 'memory',
    label: 'Agent memory',
    description:
      'Agent state that persists across turns. `scratchpad` is session-scoped (cleared on SW restart). `storage` is persistent agent-namespaced KV. `remember_for_domain` writes a domain memo that auto-surfaces in context when the user opens a tab on that domain.',
    list_tool_name: 'list_memory_tools',
  },
  ai: {
    category: 'ai',
    label: 'On-device AI',
    description:
      "Chrome's built-in Gemini Nano and siblings. Free, offline, on-GPU. The `ai` mega-tool exposes summarize, classify, extract-JSON-by-schema, translate, detect-language, proofread, describe-image, and prompt-injection-check actions. Use these BEFORE expensive cloud calls when on-device quality permits.",
    list_tool_name: 'list_ai_tools',
  },
  demos: {
    category: 'demos',
    label: 'Record & replay',
    description:
      'Record a user demonstration of a workflow once, then replay it on demand with parameter substitution. Self-healing selector chain (matrx-ref → id → testid → ARIA → text → CSS path) survives DOM churn between recording and replay. Replay is privileged — always asks the user to confirm before clicking / typing / submitting.',
    list_tool_name: 'list_demos_tools',
  },
  guidance: {
    category: 'guidance',
    label: 'User-saved hints',
    description:
      "Domain-scoped notes, screenshots, GIFs, and demo references the user has saved for the agent. Whenever the user opens a tab on a matching domain, the agent's context auto-includes the saved hints. Tools here let the agent add notes, browse what exists, and remove stale items.",
    list_tool_name: 'list_guidance_tools',
  },
  devtools: {
    category: 'devtools',
    label: 'DevTools (admin)',
    description:
      'Chrome DevTools Protocol + host diagnostics. CDP-backed full-page screenshots, accessibility-tree dumps, network/console capture, coordinate-based clicks that bypass shadow DOM, performance metrics, device emulation, PDF print. Plus host info (CPU/memory/display, declarativeNetRequest rules). All admin-gated.',
    list_tool_name: 'list_devtools_tools',
    admin_only: true,
  },
  webmcp: {
    category: 'webmcp',
    label: 'Page-registered tools',
    description:
      "Discover and call tools that pages have registered via `navigator.modelContext.registerTool` (Chrome 146+). The `chrome_webmcp` mega-tool lets the agent enumerate the page's tool catalog and invoke specific tools. Admin-only experimental capability.",
    list_tool_name: 'list_webmcp_tools',
    admin_only: true,
  },
  desktop: {
    category: 'desktop',
    label: 'Desktop bridge',
    description:
      "Bridge to matrx-local — the desktop engine. `desktop_run_command` invokes commands matrx-local exposes (file ops, system info, window control, etc.). Fails fast when the bridge isn't connected.",
    list_tool_name: 'list_desktop_tools',
  },
  credentials: {
    category: 'credentials',
    label: 'Saved logins',
    description:
      "Sign in to the site in the current tab using a login saved in the user's Matrx vault. `credential_login` resolves, fills, submits, and verifies in one call and returns only an outcome status — the agent never receives, and cannot supply, a URL, username, password, or selector. MFA and CAPTCHA stop automation for user takeover rather than being worked around.",
    list_tool_name: 'list_credentials_tools',
  },
};

/**
 * Authoritative map of tool name → category. Single source of truth so we
 * don't have to touch every handler file when a tool moves.
 */
export const CATEGORY_BY_TOOL: Record<string, ToolCategory> = {
  // ─── core ──────────────────────────────────────────────────────────────
  list_browser_tools: 'core',
  list_core_tools: 'core',
  browser_batch: 'core',
  parallel_for_each_tab: 'core',

  // ─── reading (canonical) ──────────────────────────────────────────────
  read_page: 'reading',
  data_patterns: 'reading',
  find: 'reading',
  read_active_page: 'reading',
  read_pdf: 'reading',
  get_page_text: 'reading',
  query_elements: 'reading',
  get_page_selection: 'reading',
  find_text_on_page: 'reading',
  get_page_links: 'reading',
  get_computed_style: 'reading',
  get_element_at_point: 'reading',
  inspect_element: 'reading',
  get_element_details: 'reading',
  get_form_fields: 'reading',
  extract_table: 'reading',
  extract_microdata: 'reading',
  fetch_url_as_markdown: 'reading',
  mutation_watch: 'reading',
  list_highlights: 'reading',

  // ─── interaction (canonical) ──────────────────────────────────────────
  computer: 'interaction',
  navigate: 'interaction',
  form_input: 'interaction',
  submit_form: 'interaction',
  wait_for: 'interaction',
  sleep: 'interaction',
  clipboard: 'interaction',
  upload_file: 'interaction',
  drop_file: 'interaction',
  stylesheet: 'interaction',
  // ─── interaction (absorbed granular handlers) ─────────────────────────
  navigate_active_tab: 'interaction',
  click_element: 'interaction',
  type_into_element: 'interaction',
  scroll_page: 'interaction',
  press_keys: 'interaction',
  hover_element: 'interaction',
  focus_element: 'interaction',
  blur_element: 'interaction',
  right_click_element: 'interaction',
  select_dropdown_option: 'interaction',
  set_checkbox: 'interaction',
  set_radio: 'interaction',
  file_upload: 'interaction',
  set_clipboard: 'interaction',
  get_clipboard: 'interaction',
  inject_stylesheet: 'interaction',
  remove_stylesheet: 'interaction',

  // ─── tabs (canonical) ─────────────────────────────────────────────────
  tabs: 'tabs',
  tab_groups: 'tabs',
  resize_window: 'tabs',
  chrome_tab_audio_inspect: 'tabs',
  // ─── tabs (absorbed granular handlers) ────────────────────────────────
  list_open_tabs: 'tabs',
  get_tab_groups: 'tabs',
  get_tab_info: 'tabs',
  get_active_tab: 'tabs',
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
  create_tab_group: 'tabs',
  add_tabs_to_group: 'tabs',
  remove_tabs_from_group: 'tabs',
  update_tab_group: 'tabs',

  // ─── capture ──────────────────────────────────────────────────────────
  downloads: 'capture',
  screenshot_region: 'capture',
  chrome_save_page_as_mhtml: 'capture',
  chrome_record_gif: 'capture',
  chrome_record_tab_video: 'capture',
  // ─── capture (absorbed granular handlers) ─────────────────────────────
  download_url: 'capture',
  cancel_download: 'capture',
  list_downloads: 'capture',
  take_screenshot: 'capture',

  // ─── chrome (user's personal browser data) ────────────────────────────
  chrome_cookies: 'chrome',
  chrome_bookmarks: 'chrome',
  chrome_history: 'chrome',
  chrome_recently_closed: 'chrome',
  // ─── chrome (absorbed granular handlers) ──────────────────────────────
  get_cookies: 'chrome',
  set_cookie: 'chrome',
  delete_cookie: 'chrome',
  search_bookmarks: 'chrome',
  list_bookmark_tree: 'chrome',
  search_history: 'chrome',
  list_recent_history: 'chrome',
  list_recently_closed: 'chrome',
  restore_recently_closed: 'chrome',

  // ─── human (talk to user) ─────────────────────────────────────────────
  user: 'human',
  update_plan: 'human',
  request_user_takeover: 'human',
  user_todos: 'human',

  // ─── memory ───────────────────────────────────────────────────────────
  scratchpad: 'memory',
  storage: 'memory',
  remember_for_domain: 'memory',
  // ─── memory (absorbed granular handlers) ──────────────────────────────
  set_extension_storage: 'memory',
  get_extension_storage: 'memory',
  list_extension_storage: 'memory',

  // ─── ai (on-device Gemini Nano) ───────────────────────────────────────
  ai: 'ai',
  // ─── ai (absorbed granular handlers) ──────────────────────────────────
  ai_check_availability: 'ai',
  ai_summarize: 'ai',
  ai_classify: 'ai',
  ai_extract_json: 'ai',
  ai_translate: 'ai',
  ai_detect_language: 'ai',
  ai_proofread: 'ai',
  ai_describe_image: 'ai',
  ai_check_prompt_injection: 'ai',

  // ─── demos ────────────────────────────────────────────────────────────
  record_demo: 'demos',
  list_demos: 'demos',
  describe_demo: 'demos',
  replay_demo: 'demos',
  delete_demo: 'demos',

  // ─── guidance ─────────────────────────────────────────────────────────
  save_guidance_note: 'guidance',
  list_guidance: 'guidance',
  get_guidance_item: 'guidance',
  delete_guidance_item: 'guidance',

  // ─── devtools (CDP + host diagnostics) ────────────────────────────────
  cdp_session: 'devtools',
  cdp_emulate: 'devtools',
  cdp_full_page_screenshot: 'devtools',
  cdp_a11y_tree: 'devtools',
  cdp_input_click_xy: 'devtools',
  cdp_input_type: 'devtools',
  cdp_network_capture_start: 'devtools',
  cdp_network_capture_drain: 'devtools',
  cdp_network_capture_stop: 'devtools',
  cdp_network_get_body: 'devtools',
  cdp_print_pdf: 'devtools',
  cdp_perf_metrics: 'devtools',
  read_console_messages: 'devtools',
  read_network_requests: 'devtools',
  get_request_body: 'devtools',
  // ─── devtools (absorbed granular handlers) ────────────────────────────
  cdp_attach: 'devtools',
  cdp_detach: 'devtools',
  cdp_attached_tabs: 'devtools',
  cdp_emulate_device: 'devtools',
  cdp_clear_emulation: 'devtools',

  // ─── webmcp ───────────────────────────────────────────────────────────
  chrome_webmcp: 'webmcp',
  webmcp_check_availability: 'webmcp',
  webmcp_list_page_tools: 'webmcp',
  webmcp_call_page_tool: 'webmcp',

  // ─── desktop (matrx-local bridge) ─────────────────────────────────────
  desktop_run_command: 'desktop',

  // ─── credentials (vault browser login) ────────────────────────────────
  // Category comes from the DB (`tool.definition.category = 'credentials'`),
  // which is the source of truth — do not "tidy" this into `interaction`.
  credential_login: 'credentials',
};

export function categoryOf(toolName: string): ToolCategory {
  // Fallback to 'core' when a tool isn't mapped — better to surface it than
  // bucket it as "junk drawer". Any unmapped tool that lands in core is
  // immediately visible to the human reviewing the Tools tab.
  return CATEGORY_BY_TOOL[toolName] ?? 'core';
}

/**
 * The canonical surface — names that exist as active rows in `tool.definition`
 * (the DB the server uses to advertise tools to agents) and are bound to the
 * `chrome-extension` executor via `tool.binding`. Everything else
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
  'data_patterns',
  'browser_batch',
  'read_page',
  'find',
  'user',
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
  'scratchpad',
  'storage',
  'upload_file',
  'drop_file',
  'read_pdf',
  'ai',
  'chrome_bookmarks',
  'chrome_history',
  'chrome_recently_closed',
  'stylesheet',
  'chrome_cookies',
  'chrome_webmcp',
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
  'list_highlights',
  'screenshot_region',
  'chrome_tab_audio_inspect',
  // ─── ask ────────────────────────────────────────────────────────────────
  'request_user_takeover',
  // ─── plan & user todos (tasks executes natively in aidream) ─────────────
  'update_plan',
  'user_todos',
  // ─── files / windows ────────────────────────────────────────────────────
  'chrome_save_page_as_mhtml',
  'resize_window',
  // ─── recording / demos / guidance ───────────────────────────────────────
  'chrome_record_gif',
  'chrome_record_tab_video',
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
  // ─── credentials (vault browser login) ──────────────────────────────────
  // An active `tool.definition` row bound to the `chrome-extension` executor,
  // so it belongs here by definition. Being listed here does NOT advertise it:
  // agent advertisement is `tool.surface_defaults.always_include_tools`, and no
  // surface includes `credential_login` yet (Phase 5 of the
  // credential-sharing-browser-login plan is the activation switch).
  'credential_login',
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
