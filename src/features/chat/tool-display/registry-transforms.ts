/**
 * Named value transformers — used by both `inline.info` (header text) and
 * `results.keysInfo` (expanded body fields). Add a new transform here, then
 * reference it by name from a registry entry.
 *
 * Contract: `(unknown) => unknown`. A transform should be a no-op for inputs
 * it can't handle (e.g. titleCase only acts on strings) — never throw.
 */

import type { TransformName } from './types';

const titleCaseFn = (v: unknown): unknown => {
  if (typeof v !== 'string') return v;
  return v
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((p) => (p[0] ? p[0].toUpperCase() + p.slice(1) : p))
    .join(' ');
};

export const transforms: Record<TransformName, (v: unknown) => unknown> = {
  titleCase: titleCaseFn,
  snakeToTitle: titleCaseFn,
  kebabToTitle: titleCaseFn,
  textClean: (v) => (typeof v === 'string' ? v.replace(/\\([_*`])/g, '$1').trim() : v),
  truncate80: (v) => (typeof v === 'string' && v.length > 80 ? `${v.slice(0, 80)}…` : v),
  truncate200: (v) => (typeof v === 'string' && v.length > 200 ? `${v.slice(0, 200)}…` : v),
  lowercase: (v) => (typeof v === 'string' ? v.toLowerCase() : v),
  uppercase: (v) => (typeof v === 'string' ? v.toUpperCase() : v),
  /** Object with width/height → "WxH" string. Useful when info.path: 'output'. */
  formatImageDimensions: (v) => {
    if (v == null || typeof v !== 'object') return v;
    const obj = v as Record<string, unknown>;
    const w = obj.width ?? obj.w;
    const h = obj.height ?? obj.h;
    if (typeof w !== 'number' || typeof h !== 'number') return undefined;
    return `${w}×${h}`;
  },
  /** Number of bytes → human-readable size ("123 KB", "4.5 MB"). */
  formatBytes: (v) => {
    if (typeof v !== 'number') return v;
    if (v < 1024) return `${v} B`;
    if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
    return `${(v / (1024 * 1024)).toFixed(2)} MB`;
  },
  /**
   * Browser-tools category name → lucide icon name. Each category gets a
   * distinct, recognizable icon (Wrench for core, Cookie for cookies, etc.).
   * Use as the transform on `inline.icon` with `path: 'args.category'`.
   */
  browserCategoryIcon: (v) => {
    if (typeof v !== 'string') return v;
    return BROWSER_CATEGORY_ICONS[v] ?? 'Boxes';
  },
  // ─── Mega-tool action → display label/icon ─────────────────────────────
  // Each mega-tool dispatches by `args.action`; these transforms resolve a
  // human verb + lucide icon from that action so a single registry entry
  // can render every sub-action correctly.
  computerActionVerb: (v) =>
    typeof v === 'string' ? COMPUTER_VERBS_PAST[v] ?? 'Did' : v,
  computerActionPresent: (v) =>
    typeof v === 'string' ? COMPUTER_VERBS_PRESENT[v] ?? 'Doing' : v,
  computerActionIcon: (v) =>
    typeof v === 'string' ? COMPUTER_ICONS[v] ?? 'MousePointerClick' : v,
  tabsActionVerb: (v) => typeof v === 'string' ? TABS_VERBS_PAST[v] ?? 'Did' : v,
  tabsActionPresent: (v) =>
    typeof v === 'string' ? TABS_VERBS_PRESENT[v] ?? 'Doing' : v,
  tabsActionIcon: (v) => typeof v === 'string' ? TABS_ICONS[v] ?? 'AppWindow' : v,
  navigateActionVerb: (v) => {
    if (typeof v !== 'string') return v;
    if (v === 'back') return 'Went back';
    if (v === 'forward') return 'Went forward';
    return 'Navigated to';
  },
  navigateActionPresent: (v) => {
    if (typeof v !== 'string') return v;
    if (v === 'back') return 'Going back';
    if (v === 'forward') return 'Going forward';
    return 'Navigating to';
  },
  aiActionVerb: (v) =>
    typeof v === 'string' ? AI_VERBS_PAST[v] ?? 'Ran AI' : v,
  aiActionPresent: (v) =>
    typeof v === 'string' ? AI_VERBS_PRESENT[v] ?? 'Running AI' : v,
  aiActionIcon: (v) =>
    typeof v === 'string' ? AI_ICONS[v] ?? 'Sparkles' : v,
  storageActionVerb: (v) =>
    typeof v === 'string' ? STORAGE_VERBS_PAST[v] ?? 'Storage' : v,
  storageActionPresent: (v) =>
    typeof v === 'string' ? STORAGE_VERBS_PRESENT[v] ?? 'Storage' : v,
  memoryActionVerb: (v) =>
    typeof v === 'string' ? MEMORY_VERBS_PAST[v] ?? 'Memory' : v,
  memoryActionPresent: (v) =>
    typeof v === 'string' ? MEMORY_VERBS_PRESENT[v] ?? 'Memory' : v,
  cookiesActionVerb: (v) =>
    typeof v === 'string' ? COOKIES_VERBS_PAST[v] ?? 'Cookies' : v,
  cookiesActionPresent: (v) =>
    typeof v === 'string' ? COOKIES_VERBS_PRESENT[v] ?? 'Cookies' : v,
  historyActionVerb: (v) => {
    if (typeof v !== 'string') return v;
    if (v === 'search') return 'Searched history';
    if (v === 'recent') return 'Listed recent history';
    return v;
  },
  historyActionPresent: (v) => {
    if (typeof v !== 'string') return v;
    if (v === 'search') return 'Searching history';
    if (v === 'recent') return 'Listing recent history';
    return v;
  },
  bookmarksActionVerb: (v) => {
    if (typeof v !== 'string') return v;
    if (v === 'search') return 'Searched bookmarks';
    if (v === 'tree') return 'Listed bookmarks';
    return v;
  },
  bookmarksActionPresent: (v) => {
    if (typeof v !== 'string') return v;
    if (v === 'search') return 'Searching bookmarks';
    if (v === 'tree') return 'Listing bookmarks';
    return v;
  },
  tabGroupsActionVerb: (v) =>
    typeof v === 'string' ? TAB_GROUPS_VERBS_PAST[v] ?? 'Tab groups' : v,
  tabGroupsActionPresent: (v) =>
    typeof v === 'string' ? TAB_GROUPS_VERBS_PRESENT[v] ?? 'Tab groups' : v,
  recentlyClosedActionVerb: (v) => {
    if (typeof v !== 'string') return v;
    if (v === 'list') return 'Listed recently closed';
    if (v === 'restore') return 'Restored tab';
    return v;
  },
  recentlyClosedActionPresent: (v) => {
    if (typeof v !== 'string') return v;
    if (v === 'list') return 'Listing recently closed';
    if (v === 'restore') return 'Restoring tab';
    return v;
  },
  stylesheetActionVerb: (v) => {
    if (typeof v !== 'string') return v;
    if (v === 'inject') return 'Injected stylesheet';
    if (v === 'remove') return 'Removed stylesheet';
    return v;
  },
  stylesheetActionPresent: (v) => {
    if (typeof v !== 'string') return v;
    if (v === 'inject') return 'Injecting stylesheet';
    if (v === 'remove') return 'Removing stylesheet';
    return v;
  },
  cdpSessionActionVerb: (v) =>
    typeof v === 'string' ? CDP_SESSION_VERBS_PAST[v] ?? 'CDP session' : v,
  cdpSessionActionPresent: (v) =>
    typeof v === 'string' ? CDP_SESSION_VERBS_PRESENT[v] ?? 'CDP session' : v,
  cdpEmulateActionVerb: (v) => {
    if (typeof v !== 'string') return v;
    if (v === 'set') return 'Emulated device';
    if (v === 'clear') return 'Cleared emulation';
    return v;
  },
  cdpEmulateActionPresent: (v) => {
    if (typeof v !== 'string') return v;
    if (v === 'set') return 'Emulating device';
    if (v === 'clear') return 'Clearing emulation';
    return v;
  },
  webmcpActionVerb: (v) =>
    typeof v === 'string' ? WEBMCP_VERBS_PAST[v] ?? 'WebMCP' : v,
  webmcpActionPresent: (v) =>
    typeof v === 'string' ? WEBMCP_VERBS_PRESENT[v] ?? 'WebMCP' : v,
  clipboardActionVerb: (v) => {
    if (typeof v !== 'string') return v;
    if (v === 'read') return 'Read clipboard';
    if (v === 'write') return 'Wrote to clipboard';
    return v;
  },
  clipboardActionPresent: (v) => {
    if (typeof v !== 'string') return v;
    if (v === 'read') return 'Reading clipboard';
    if (v === 'write') return 'Writing to clipboard';
    return v;
  },
  downloadsActionVerb: (v) =>
    typeof v === 'string' ? DOWNLOADS_VERBS_PAST[v] ?? 'Downloads' : v,
  downloadsActionPresent: (v) =>
    typeof v === 'string' ? DOWNLOADS_VERBS_PRESENT[v] ?? 'Downloads' : v,
  waitForConditionVerb: (v) =>
    typeof v === 'string' ? WAIT_FOR_VERBS_PAST[v] ?? 'Waited' : v,
  waitForConditionPresent: (v) =>
    typeof v === 'string' ? WAIT_FOR_VERBS_PRESENT[v] ?? 'Waiting for' : v,
  userToolVerbPast: (v) =>
    typeof v === 'string' ? USER_TOOL_VERBS_PAST[v] ?? 'Asked' : v,
  userToolVerbPresent: (v) =>
    typeof v === 'string' ? USER_TOOL_VERBS_PRESENT[v] ?? 'Asking' : v,
  userToolIcon: (v) =>
    typeof v === 'string' ? USER_TOOL_ICONS[v] ?? 'MessageCircleQuestion' : v,
};

const BROWSER_CATEGORY_ICONS: Record<string, string> = {
  core: 'Wrench',
  page: 'FileText',
  interact: 'MousePointerClick',
  forms: 'FormInput',
  tabs: 'AppWindow',
  history: 'History',
  ai: 'Sparkles',
  files: 'FileBox',
  memory: 'Database',
  ask: 'MessageCircleQuestion',
  advanced: 'Cog',
  debug: 'Bug',
  cookies: 'Cookie',
  webmcp: 'Plug',
};

// Mega-tool action lookup tables. Each pair: past tense (completed/error)
// and present continuous (started). Icons map per-action where useful.

const COMPUTER_VERBS_PAST: Record<string, string> = {
  left_click: 'Clicked',
  right_click: 'Right-clicked',
  double_click: 'Double-clicked',
  triple_click: 'Triple-clicked',
  type: 'Typed',
  key: 'Pressed',
  scroll: 'Scrolled',
  scroll_to: 'Scrolled to',
  hover: 'Hovered',
  screenshot: 'Captured screenshot',
  left_click_drag: 'Dragged',
  focus: 'Focused',
  blur: 'Blurred',
};
const COMPUTER_VERBS_PRESENT: Record<string, string> = {
  left_click: 'Clicking',
  right_click: 'Right-clicking',
  double_click: 'Double-clicking',
  triple_click: 'Triple-clicking',
  type: 'Typing',
  key: 'Pressing',
  scroll: 'Scrolling',
  scroll_to: 'Scrolling to',
  hover: 'Hovering',
  screenshot: 'Capturing screenshot',
  left_click_drag: 'Dragging',
  focus: 'Focusing',
  blur: 'Blurring',
};
const COMPUTER_ICONS: Record<string, string> = {
  left_click: 'MousePointerClick',
  right_click: 'MousePointer2',
  double_click: 'MousePointerClick',
  triple_click: 'MousePointerClick',
  type: 'Keyboard',
  key: 'Keyboard',
  scroll: 'ChevronsDown',
  scroll_to: 'ArrowDownToLine',
  hover: 'Pointer',
  screenshot: 'Camera',
  left_click_drag: 'Move',
  focus: 'Crosshair',
  blur: 'CircleDashed',
};

const TABS_VERBS_PAST: Record<string, string> = {
  list: 'Let me see what tabs you have open',
  create: "I'm going to open a new tab",
  close: 'I think we can close this tab',
  switch: "Let's switch to that other tab",
  reload: 'This tab needs to be reloaded',
  active: 'Let me read the active tab',
  info: 'I want to know more about this tab',
  pin: "Let's pin this tab",
  mute: "Let's mute this tab",
  duplicate: "Let's duplicate this tab",
  move: "I'm going to move this tab",
  zoom: "Let's zoom this tab",
};
const TABS_VERBS_PRESENT: Record<string, string> = {
  list: 'Listing tabs',
  create: 'Opening tab',
  close: 'Closing tab',
  switch: 'Switching tab',
  reload: 'Reloading tab',
  active: 'Reading active tab',
  info: 'Reading tab info',
  pin: 'Pinning tab',
  mute: 'Muting tab',
  duplicate: 'Duplicating tab',
  move: 'Moving tab',
  zoom: 'Zooming tab',
};
const TABS_ICONS: Record<string, string> = {
  list: 'List',
  create: 'PlusSquare',
  close: 'XSquare',
  switch: 'ArrowRightLeft',
  reload: 'RefreshCw',
  active: 'Eye',
  info: 'Eye',
  pin: 'Pin',
  mute: 'VolumeX',
  duplicate: 'Copy',
  move: 'Move',
  zoom: 'ZoomIn',
};

const AI_VERBS_PAST: Record<string, string> = {
  check_availability: 'Checked AI availability',
  summarize: 'Summarized',
  classify: 'Classified',
  extract_json: 'Extracted JSON',
  translate: 'Translated',
  detect_language: 'Detected language',
  proofread: 'Proofread',
  describe_image: 'Described image',
  check_prompt_injection: 'Checked for prompt injection',
};
const AI_VERBS_PRESENT: Record<string, string> = {
  check_availability: 'Checking AI availability',
  summarize: 'Summarizing',
  classify: 'Classifying',
  extract_json: 'Extracting JSON',
  translate: 'Translating',
  detect_language: 'Detecting language',
  proofread: 'Proofreading',
  describe_image: 'Describing image',
  check_prompt_injection: 'Checking for prompt injection',
};
const AI_ICONS: Record<string, string> = {
  check_availability: 'Activity',
  summarize: 'FileText',
  classify: 'ListTree',
  extract_json: 'Braces',
  translate: 'Languages',
  detect_language: 'Globe',
  proofread: 'SpellCheck',
  describe_image: 'ImageIcon',
  check_prompt_injection: 'ShieldAlert',
};

const STORAGE_VERBS_PAST: Record<string, string> = {
  get: 'Read storage',
  set: 'Wrote storage',
  delete: 'Deleted storage key',
};
const STORAGE_VERBS_PRESENT: Record<string, string> = {
  get: 'Reading storage',
  set: 'Writing storage',
  delete: 'Deleting storage key',
};

const MEMORY_VERBS_PAST: Record<string, string> = {
  set: 'Saved to memory',
  get: 'Read from memory',
  list: 'Listed memory keys',
  delete: 'Deleted memory key',
};
const MEMORY_VERBS_PRESENT: Record<string, string> = {
  set: 'Saving to memory',
  get: 'Reading from memory',
  list: 'Listing memory keys',
  delete: 'Deleting memory key',
};

const COOKIES_VERBS_PAST: Record<string, string> = {
  get: 'Read cookies',
  set: 'Set cookie',
  delete: 'Deleted cookie',
};
const COOKIES_VERBS_PRESENT: Record<string, string> = {
  get: 'Reading cookies',
  set: 'Setting cookie',
  delete: 'Deleting cookie',
};

const TAB_GROUPS_VERBS_PAST: Record<string, string> = {
  list: 'Listed tab groups',
  create: 'Created tab group',
  add: 'Added tabs to group',
  remove: 'Removed tabs from group',
  update: 'Updated tab group',
};
const TAB_GROUPS_VERBS_PRESENT: Record<string, string> = {
  list: 'Listing tab groups',
  create: 'Creating tab group',
  add: 'Adding tabs to group',
  remove: 'Removing tabs from group',
  update: 'Updating tab group',
};

const CDP_SESSION_VERBS_PAST: Record<string, string> = {
  attach: 'Attached debugger',
  detach: 'Detached debugger',
  list: 'Listed debugger sessions',
};
const CDP_SESSION_VERBS_PRESENT: Record<string, string> = {
  attach: 'Attaching debugger',
  detach: 'Detaching debugger',
  list: 'Listing debugger sessions',
};

const WEBMCP_VERBS_PAST: Record<string, string> = {
  check: 'Checked WebMCP',
  list: 'Listed page tools',
  call: 'Called page tool',
};
const WEBMCP_VERBS_PRESENT: Record<string, string> = {
  check: 'Checking WebMCP',
  list: 'Listing page tools',
  call: 'Calling page tool',
};

const DOWNLOADS_VERBS_PAST: Record<string, string> = {
  list: 'Listed downloads',
  confirm: 'Confirmed download',
  cancel: 'Cancelled download',
  download_url: 'Started download',
};
const DOWNLOADS_VERBS_PRESENT: Record<string, string> = {
  list: 'Listing downloads',
  confirm: 'Confirming download',
  cancel: 'Cancelling download',
  download_url: 'Starting download',
};

const WAIT_FOR_VERBS_PAST: Record<string, string> = {
  element: 'Waited for element',
  text: 'Waited for text',
  url: 'Waited for URL',
  network_idle: 'Waited for network idle',
};
const WAIT_FOR_VERBS_PRESENT: Record<string, string> = {
  element: 'Waiting for element',
  text: 'Waiting for text',
  url: 'Waiting for URL',
  network_idle: 'Waiting for network idle',
};

const USER_TOOL_VERBS_PAST: Record<string, string> = {
  confirm: 'Asked to confirm',
  choice: 'Asked to choose',
  choice_many: 'Asked to choose',
  text: 'Asked',
  secret: 'Asked for secret',
  notify: 'Notified',
};
const USER_TOOL_VERBS_PRESENT: Record<string, string> = {
  confirm: 'Asking to confirm',
  choice: 'Asking to choose',
  choice_many: 'Asking to choose',
  text: 'Asking',
  secret: 'Asking for secret',
  notify: 'Notifying',
};
const USER_TOOL_ICONS: Record<string, string> = {
  confirm: 'CheckCircle2',
  choice: 'List',
  choice_many: 'ListChecks',
  text: 'MessageCircleQuestion',
  secret: 'KeyRound',
  notify: 'Bell',
};
