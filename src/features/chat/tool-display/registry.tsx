/**
 * The tool-display registry. Map a tool name (the raw `toolName` string —
 * e.g. `computer`, `tabs`, `read_page`) to a `ToolDisplayEntry` and the chat
 * surfaces (`ToolTimelineRow` for client tools, `ServerToolRow` for server
 * tools) will route through `ConfigurableToolRow` instead of their generic
 * default.
 *
 * Anything not registered keeps rendering exactly as it does today (the
 * default ToolTimelineRow). Default rendering is fine — these entries are
 * only here to give frequently-called tools a more useful row.
 *
 * Adding a new entry:
 *   1. Add a key here. The minimum useful shape is `{ inline: { ... } }`.
 *   2. For phase-aware text/icons/colors, pass an object keyed by phase:
 *      `prefix: { started: 'Getting', completed: 'Got', error: 'Failed to get' }`.
 *   3. For result rendering, pick a `displayType`. `'custom'` lets you map
 *      individual result keys to field components (see `keysInfo` below).
 *
 * Mega-tool tip:
 *   The canonical tools (`computer`, `tabs`, `ai`, `navigate`, …) dispatch
 *   on an `args.action` enum. Each gets a paired `<x>ActionVerb` /
 *   `<x>ActionPresent` / `<x>ActionIcon` transform in registry-transforms.ts
 *   that resolves a human-readable label + icon from the action — so a
 *   single registry entry can render every sub-action correctly.
 *
 * Field components live in `./registry-components.tsx`.
 * Transforms live in `./registry-transforms.ts`.
 */

import { BatchToolDisplay } from './BatchToolDisplay';
import { InteractionAskCard } from './InteractionAskCard';
import { SleepCountdown } from './SleepCountdown';
import type { ToolDisplayEntry } from './types';

export const toolDisplayRegistry: Record<string, ToolDisplayEntry> = {
  // ─── Server-side tools ────────────────────────────────────────────────
  // Server-side multi-question questionnaire tool. The args carry the spec
  // (introduction + array of {id, prompt, component_type, options?}); without
  // a custom component the user just sees an opaque "Done" row and can never
  // actually answer. The card renders inputs + a submit button that posts the
  // answers back as a normal user chat message.
  interaction_ask: {
    CustomComponent: InteractionAskCard,
  },

  ctx_get: {
    inline: {
      icon: { started: 'Loader2', completed: 'Layers', error: 'AlertTriangle' },
      prefix: { started: 'Getting', completed: 'Got', error: 'Failed to get' },
      name: '',
      info: {
        path: 'args.key',
        transform: 'snakeToTitle',
      },
      color: { started: 'primary', completed: 'blue', error: 'red' },
    },
    args: { displayType: 'key-value' },
    results: {
      displayType: 'custom',
      keysInfo: [
        { key: 'label', component: 'BoldLabel', className: 'text-foreground' },
        {
          key: 'content',
          component: 'Markdown',
          className: 'text-foreground',
          transform: 'textClean',
        },
      ],
    },
  },

  load_browser_tools: {
    inline: {
      // Per-category icon: the category arg goes through `browserCategoryIcon`
      // which maps "core" → "Wrench", "forms" → "FormInput", etc. Started
      // phase keeps a Loader2 spinner so progress is obvious.
      icon: {
        started: 'Loader2',
        completed: { path: 'args.category', transform: 'browserCategoryIcon' },
        error: 'AlertTriangle',
      },
      prefix: {
        started: 'Loading my',
        completed: 'Loaded my',
        error: 'Failed to load my',
      },
      name: { path: 'args.category' },
      suffix: 'browser tools',
      color: { started: 'primary', completed: 'amber', error: 'red' },
    },
    args: { hidden: true },
    results: {
      displayType: 'custom',
      keysInfo: [{ key: 'tools_loaded', component: 'Chips' }],
    },
  },

  // ─── Core (always advertised) ─────────────────────────────────────────

  read_page: {
    inline: {
      icon: { started: 'Loader2', completed: 'BookOpenText', error: 'AlertTriangle' },
      prefix: {
        started: 'Reading page',
        completed: 'Read page',
        error: 'Failed to read page',
      },
      name: '',
      info: { completed: { path: 'output.count', fallback: '' } },
      suffix: { completed: 'elements' },
      color: { started: 'primary', completed: 'sky', error: 'red' },
    },
    args: { hidden: true },
    // The result is huge (full a11y tree). Default JSON in the expanded view is fine.
  },

  get_active_tab: {
    inline: {
      // Use the page's favicon as the inline icon when we have one — the
      // InlineIcon resolver auto-detects http(s)/data URLs and renders <img>.
      // Falls back to the lucide Globe if the favicon URL is missing/404s.
      icon: {
        started: 'Loader2',
        completed: { path: 'output.fav_icon_url', fallback: 'Globe' },
        error: 'AlertTriangle',
      },
      prefix: {
        started: 'Getting active tab',
        completed: '',
        error: 'Failed to get active tab',
      },
      // Title takes the name slot; URL trails as muted info.
      name: { completed: { path: 'output.title', transform: 'truncate80' } },
      info: { completed: { path: 'output.url', transform: 'truncate80' } },
      color: { started: 'primary', completed: 'sky', error: 'red' },
    },
    args: { hidden: true },
    // Default key-value rendering of the result on click — gives a clean
    // table of tab_id / window_id / status / pinned / incognito.
    results: { displayType: 'key-value' },
  },

  click_element: {
    inline: {
      icon: { started: 'Loader2', completed: 'MousePointerClick', error: 'AlertTriangle' },
      prefix: {
        started: 'Clicking',
        completed: 'Clicked',
        error: 'Click failed on',
      },
      // On started/error we only know the ref. On completed we have the
      // resolved tag — much more readable ("Clicked button" beats "Clicked ref:85").
      name: {
        started: { path: 'args.ref', fallback: 'element' },
        completed: { path: 'output.tag', fallback: 'element' },
        error: { path: 'args.ref', fallback: 'element' },
      },
      // Show the element's visible text when present (resolveInfo returns
      // fallback='' for empty strings, so empty text doesn't clutter).
      info: { completed: { path: 'output.text', transform: 'truncate80' } },
      color: { started: 'primary', completed: 'emerald', error: 'red' },
    },
    args: { displayType: 'key-value' },
    results: { displayType: 'key-value' },
  },

  extract_table: {
    inline: {
      icon: { started: 'Loader2', completed: 'Table', error: 'AlertTriangle' },
      prefix: {
        started: 'Extracting table',
        completed: 'Extracted table',
        error: 'Table extraction failed',
      },
      name: '',
      info: { completed: { path: 'output.row_count', fallback: '0' } },
      suffix: { completed: 'rows' },
      color: { started: 'primary', completed: 'sky', error: 'red' },
    },
    args: { hidden: true },
    results: {
      displayType: 'custom',
      // The table IS the result — render it inline without a click.
      alwaysShow: true,
      keysInfo: [{ key: '', component: 'Table' }],
    },
  },

  take_screenshot: {
    inline: {
      icon: { started: 'Loader2', completed: 'Camera', error: 'AlertTriangle' },
      prefix: {
        started: 'Taking screenshot',
        completed: 'Screenshot',
        error: 'Screenshot failed',
      },
      name: '',
      info: { completed: { path: 'output', transform: 'formatImageDimensions' } },
      color: { started: 'primary', completed: 'sky', error: 'red' },
    },
    args: { hidden: true },
    results: {
      displayType: 'custom',
      // The image IS the point — render it inline, no click required.
      alwaysShow: true,
      // `key: ''` passes the whole output object to Base64Image, which
      // prefers `file_url` when the server has uploaded the image and
      // falls back to the `image_base64`/`media_type` shape otherwise.
      keysInfo: [{ key: '', component: 'Base64Image' }],
    },
  },

  // Cropped-region capture. Returns the same envelope as take_screenshot
  // ({ image_base64, file_url, width, height, ... }) but bounded to a ref /
  // selector / rect — render the image inline just like a full screenshot.
  screenshot_region: {
    inline: {
      icon: { started: 'Loader2', completed: 'Crop', error: 'AlertTriangle' },
      prefix: {
        started: 'Capturing region',
        completed: 'Region',
        error: 'Region capture failed',
      },
      name: '',
      info: { completed: { path: 'output', transform: 'formatImageDimensions' } },
      color: { started: 'primary', completed: 'sky', error: 'red' },
    },
    args: { displayType: 'key-value' },
    results: {
      displayType: 'custom',
      alwaysShow: true,
      keysInfo: [{ key: '', component: 'Base64Image' }],
    },
  },

  // Full-page (beyond-viewport) CDP capture. Returns { image_base64,
  // media_type, ... } — render the image inline.
  cdp_full_page_screenshot: {
    inline: {
      icon: { started: 'Loader2', completed: 'Camera', error: 'AlertTriangle' },
      prefix: {
        started: 'Capturing full page',
        completed: 'Full-page screenshot',
        error: 'Full-page capture failed',
      },
      name: '',
      info: { completed: { path: 'output', transform: 'formatImageDimensions' } },
      color: { started: 'primary', completed: 'sky', error: 'red' },
    },
    args: { displayType: 'key-value' },
    results: {
      displayType: 'custom',
      alwaysShow: true,
      keysInfo: [{ key: '', component: 'Base64Image' }],
    },
  },

  find: {
    inline: {
      // Search icon is the obvious metaphor; on started the label shimmers and
      // the icon spins — together they signal "actively scanning the page".
      icon: 'Search',
      prefix: {
        started: 'Searching for',
        completed: 'Found',
        error: 'Search failed',
      },
      // The natural-language query takes over the label so the user sees what's
      // being looked for in real time.
      name: { path: 'args.query', transform: 'truncate80' },
      // After completion: append the count of matches.
      info: { completed: { path: 'output.matches.length', fallback: '0' } },
      suffix: { completed: 'matches' },
      color: { started: 'primary', completed: 'violet', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  // browser_batch is a meta-tool — instead of rendering it as one opaque
  // entry, fan out each sub-call as its own native tool row using the same
  // registry styling. Lets the user see exactly which URLs / refs are being
  // touched, with the same Base64Image / TabCard / Markdown / etc. that an
  // individual call would have rendered with.
  browser_batch: {
    CustomComponent: BatchToolDisplay,
  },

  // Unified `user` tool — six modes via args.type (confirm, choice,
  // choice_many, text, secret, notify). The header surfaces the active
  // mode via the userToolVerb / userToolIcon transforms so all six
  // variants render coherently under one entry. The body text comes from
  // args.question for ask types and args.message for notify.
  user: {
    inline: {
      icon: {
        started: 'Loader2',
        completed: { path: 'args.type', transform: 'userToolIcon' },
        error: 'AlertTriangle',
      },
      prefix: '',
      name: {
        started: { path: 'args.type', transform: 'userToolVerbPresent', fallback: 'Asking' },
        completed: { path: 'args.type', transform: 'userToolVerbPast', fallback: 'Asked' },
        error: 'User prompt failed',
      },
      // For ask types args.question is set; for notify args.message is.
      // The header info chip shows whichever exists; the other is undefined
      // and contributes nothing.
      info: { path: 'args.question', transform: 'truncate80' },
      color: { started: 'primary', completed: 'sky', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  // ─── Mega-tool routers (the agent's primary surface) ──────────────────

  computer: {
    inline: {
      icon: {
        started: 'Loader2',
        completed: { path: 'args.action', transform: 'computerActionIcon' },
        error: 'AlertTriangle',
      },
      prefix: '',
      name: {
        started: { path: 'args.action', transform: 'computerActionPresent' },
        completed: { path: 'args.action', transform: 'computerActionVerb' },
        error: { path: 'args.action', transform: 'computerActionPresent', fallback: 'Computer' },
      },
      // For typed text and click refs, append a short hint of the target/value.
      info: {
        path: 'args.text',
        transform: 'truncate80',
        fallback: '',
      },
      color: { started: 'primary', completed: 'emerald', error: 'red' },
    },
    args: { displayType: 'key-value' },
    results: {
      // The screenshot sub-action persists to `files.files` and returns
      // { file_id, file_url, width, height, mime_type }. Render that image
      // inline — `computer` is the canonical surface the agent actually
      // calls now, so the image MUST render here (the old `take_screenshot`
      // entry below is no longer in CANONICAL_SURFACE). Base64Image prefers
      // file_url, and returns null when the output carries no image — so for
      // non-screenshot actions (click / type / key / scroll) this renders
      // nothing extra and the click-to-expand JSON still shows {ok:true}.
      displayType: 'custom',
      alwaysShow: true,
      keysInfo: [{ key: '', component: 'Base64Image' }],
    },
  },

  navigate: {
    inline: {
      icon: { started: 'Loader2', completed: 'Compass', error: 'AlertTriangle' },
      prefix: '',
      name: {
        started: { path: 'args.url', transform: 'navigateActionPresent', fallback: 'Navigating' },
        completed: { path: 'args.url', transform: 'navigateActionVerb', fallback: 'Navigated' },
        error: 'Navigate failed',
      },
      info: { path: 'args.url', transform: 'truncate80' },
      color: { started: 'primary', completed: 'blue', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  tabs: {
    inline: {
      icon: {
        started: 'Loader2',
        completed: { path: 'args.action', transform: 'tabsActionIcon' },
        error: 'AlertTriangle',
      },
      prefix: '',
      name: {
        started: { path: 'args.action', transform: 'tabsActionPresent' },
        completed: { path: 'args.action', transform: 'tabsActionVerb' },
        error: { path: 'args.action', transform: 'tabsActionPresent', fallback: 'Tabs' },
      },
      info: { path: 'args.url', transform: 'truncate80', fallback: '' },
      color: { started: 'primary', completed: 'amber', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  tab_groups: {
    inline: {
      icon: { started: 'Loader2', completed: 'Group', error: 'AlertTriangle' },
      prefix: '',
      name: {
        started: { path: 'args.action', transform: 'tabGroupsActionPresent' },
        completed: { path: 'args.action', transform: 'tabGroupsActionVerb' },
        error: { path: 'args.action', transform: 'tabGroupsActionPresent', fallback: 'Tab groups' },
      },
      color: { started: 'primary', completed: 'amber', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  form_input: {
    inline: {
      icon: { started: 'Loader2', completed: 'FormInput', error: 'AlertTriangle' },
      prefix: {
        started: 'Filling',
        completed: 'Filled',
        error: 'Failed to fill',
      },
      name: { path: 'args.ref' },
      info: { path: 'args.value', transform: 'truncate80' },
      color: { started: 'primary', completed: 'emerald', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  // Vault browser login. The row shows the OUTCOME STATUS and nothing else —
  // no field names, no page text, no value. `args` can only ever be an
  // optional `credential_item_id` (the tool accepts no URL / username /
  // password / selector). See src/lib/tools/handlers/credential-login.ts.
  credential_login: {
    inline: {
      icon: { started: 'Loader2', completed: 'KeyRound', error: 'AlertTriangle' },
      prefix: {
        started: 'Signing in with a saved login',
        completed: 'Saved login',
        error: 'Saved login failed',
      },
      name: { path: 'result.status', fallback: '' },
      color: { started: 'primary', completed: 'emerald', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  // Prospect capture (IC-10). The row names the DOMAIN, because that is the
  // unit the user is deciding about — a row saying "Checked prospect" with no
  // domain makes a preview and a commit look identical in the timeline.
  capture_prospect: {
    inline: {
      icon: { started: 'Loader2', completed: 'Building2', error: 'AlertTriangle' },
      prefix: {
        started: 'Checking prospect',
        completed: 'Prospect',
        error: 'Prospect capture failed',
      },
      name: { path: 'result.domain', fallback: '' },
      color: { started: 'primary', completed: 'emerald', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  submit_form: {
    inline: {
      icon: { started: 'Loader2', completed: 'SendHorizontal', error: 'AlertTriangle' },
      prefix: {
        started: 'Submitting form',
        completed: 'Submitted form',
        error: 'Form submit failed',
      },
      name: '',
      color: { started: 'primary', completed: 'emerald', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  wait_for: {
    inline: {
      icon: { started: 'Loader2', completed: 'Hourglass', error: 'AlertTriangle' },
      prefix: '',
      name: {
        started: {
          path: 'args.condition',
          transform: 'waitForConditionPresent',
          fallback: 'Waiting',
        },
        completed: {
          path: 'args.condition',
          transform: 'waitForConditionVerb',
          fallback: 'Waited',
        },
        error: 'Wait timed out',
      },
      info: { path: 'args.target', transform: 'truncate80' },
      color: { started: 'primary', completed: 'sky', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  // Sleep needs a live countdown while running — the standard config row
  // can't tick on its own, so we hand off to a custom component.
  sleep: {
    CustomComponent: SleepCountdown,
  },

  // ─── AI / files / utilities ──────────────────────────────────────────

  ai: {
    inline: {
      icon: {
        started: 'Loader2',
        completed: { path: 'args.action', transform: 'aiActionIcon' },
        error: 'AlertTriangle',
      },
      prefix: '',
      name: {
        started: { path: 'args.action', transform: 'aiActionPresent' },
        completed: { path: 'args.action', transform: 'aiActionVerb' },
        error: { path: 'args.action', transform: 'aiActionPresent', fallback: 'AI' },
      },
      color: { started: 'primary', completed: 'violet', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  clipboard: {
    inline: {
      icon: { started: 'Loader2', completed: 'Clipboard', error: 'AlertTriangle' },
      prefix: '',
      name: {
        started: { path: 'args.action', transform: 'clipboardActionPresent' },
        completed: { path: 'args.action', transform: 'clipboardActionVerb' },
        error: 'Clipboard failed',
      },
      info: { path: 'args.text', transform: 'truncate80', fallback: '' },
      color: { started: 'primary', completed: 'slate', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  downloads: {
    inline: {
      icon: { started: 'Loader2', completed: 'Download', error: 'AlertTriangle' },
      prefix: '',
      name: {
        started: { path: 'args.action', transform: 'downloadsActionPresent' },
        completed: { path: 'args.action', transform: 'downloadsActionVerb' },
        error: { path: 'args.action', transform: 'downloadsActionPresent', fallback: 'Downloads' },
      },
      info: { path: 'args.url', transform: 'truncate80', fallback: '' },
      color: { started: 'primary', completed: 'amber', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  upload_file: {
    inline: {
      icon: { started: 'Loader2', completed: 'Upload', error: 'AlertTriangle' },
      prefix: {
        started: 'Uploading file to',
        completed: 'Uploaded file to',
        error: 'Upload failed for',
      },
      name: { path: 'args.ref' },
      info: { path: 'args.file_ids.length', fallback: '0' },
      suffix: 'file(s)',
      color: { started: 'primary', completed: 'emerald', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  drop_file: {
    inline: {
      icon: { started: 'Loader2', completed: 'Move', error: 'AlertTriangle' },
      prefix: {
        started: 'Dropping file on',
        completed: 'Dropped file on',
        error: 'Drop failed on',
      },
      name: { path: 'args.ref', fallback: 'coordinate' },
      color: { started: 'primary', completed: 'emerald', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  read_pdf: {
    inline: {
      icon: { started: 'Loader2', completed: 'FileText', error: 'AlertTriangle' },
      prefix: {
        started: 'Reading PDF',
        completed: 'Read PDF',
        error: 'PDF read failed',
      },
      name: '',
      info: { completed: { path: 'output.page_count', fallback: '' } },
      suffix: { completed: 'pages' },
      color: { started: 'primary', completed: 'sky', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  // ─── Memory & storage ────────────────────────────────────────────────

  memory: {
    inline: {
      icon: { started: 'Loader2', completed: 'Database', error: 'AlertTriangle' },
      prefix: '',
      name: {
        started: { path: 'args.action', transform: 'memoryActionPresent' },
        completed: { path: 'args.action', transform: 'memoryActionVerb' },
        error: { path: 'args.action', transform: 'memoryActionPresent', fallback: 'Memory' },
      },
      info: { path: 'args.key', fallback: '' },
      color: { started: 'primary', completed: 'slate', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  remember_for_domain: {
    inline: {
      icon: { started: 'Loader2', completed: 'NotebookPen', error: 'AlertTriangle' },
      prefix: {
        started: 'Remembering note for',
        completed: 'Remembered note for',
        error: 'Failed to remember',
      },
      name: { path: 'args.domain' },
      color: { started: 'primary', completed: 'amber', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  // ─── History / bookmarks / closed ────────────────────────────────────

  history: {
    inline: {
      icon: { started: 'Loader2', completed: 'History', error: 'AlertTriangle' },
      prefix: '',
      name: {
        started: { path: 'args.action', transform: 'historyActionPresent' },
        completed: { path: 'args.action', transform: 'historyActionVerb' },
        error: { path: 'args.action', transform: 'historyActionPresent', fallback: 'History' },
      },
      info: { path: 'args.query', transform: 'truncate80', fallback: '' },
      color: { started: 'primary', completed: 'sky', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  bookmarks: {
    inline: {
      icon: { started: 'Loader2', completed: 'Bookmark', error: 'AlertTriangle' },
      prefix: '',
      name: {
        started: { path: 'args.action', transform: 'bookmarksActionPresent' },
        completed: { path: 'args.action', transform: 'bookmarksActionVerb' },
        error: { path: 'args.action', transform: 'bookmarksActionPresent', fallback: 'Bookmarks' },
      },
      info: { path: 'args.query', transform: 'truncate80', fallback: '' },
      color: { started: 'primary', completed: 'sky', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  recently_closed: {
    inline: {
      icon: { started: 'Loader2', completed: 'Undo2', error: 'AlertTriangle' },
      prefix: '',
      name: {
        started: { path: 'args.action', transform: 'recentlyClosedActionPresent' },
        completed: { path: 'args.action', transform: 'recentlyClosedActionVerb' },
        error: 'Recently-closed failed',
      },
      color: { started: 'primary', completed: 'sky', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  // ─── Cookies / WebMCP / stylesheet ───────────────────────────────────

  cookies: {
    inline: {
      icon: { started: 'Loader2', completed: 'Cookie', error: 'AlertTriangle' },
      prefix: '',
      name: {
        started: { path: 'args.action', transform: 'cookiesActionPresent' },
        completed: { path: 'args.action', transform: 'cookiesActionVerb' },
        error: { path: 'args.action', transform: 'cookiesActionPresent', fallback: 'Cookies' },
      },
      info: { path: 'args.url', transform: 'truncate80', fallback: '' },
      color: { started: 'primary', completed: 'amber', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  webmcp: {
    inline: {
      icon: { started: 'Loader2', completed: 'Plug', error: 'AlertTriangle' },
      prefix: '',
      name: {
        started: { path: 'args.action', transform: 'webmcpActionPresent' },
        completed: { path: 'args.action', transform: 'webmcpActionVerb' },
        error: { path: 'args.action', transform: 'webmcpActionPresent', fallback: 'WebMCP' },
      },
      info: { path: 'args.tool', transform: 'truncate80', fallback: '' },
      color: { started: 'primary', completed: 'violet', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  stylesheet: {
    inline: {
      icon: { started: 'Loader2', completed: 'Palette', error: 'AlertTriangle' },
      prefix: '',
      name: {
        started: { path: 'args.action', transform: 'stylesheetActionPresent' },
        completed: { path: 'args.action', transform: 'stylesheetActionVerb' },
        error: 'Stylesheet failed',
      },
      color: { started: 'primary', completed: 'violet', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  // ─── CDP / debug (admin) ─────────────────────────────────────────────

  cdp_session: {
    inline: {
      icon: { started: 'Loader2', completed: 'Bug', error: 'AlertTriangle' },
      prefix: '',
      name: {
        started: { path: 'args.action', transform: 'cdpSessionActionPresent' },
        completed: { path: 'args.action', transform: 'cdpSessionActionVerb' },
        error: 'Debugger failed',
      },
      color: { started: 'primary', completed: 'red', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  cdp_emulate: {
    inline: {
      icon: { started: 'Loader2', completed: 'Smartphone', error: 'AlertTriangle' },
      prefix: '',
      name: {
        started: { path: 'args.action', transform: 'cdpEmulateActionPresent' },
        completed: { path: 'args.action', transform: 'cdpEmulateActionVerb' },
        error: 'Emulation failed',
      },
      color: { started: 'primary', completed: 'amber', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  read_console_messages: {
    inline: {
      icon: { started: 'Loader2', completed: 'Terminal', error: 'AlertTriangle' },
      prefix: {
        started: 'Reading console',
        completed: 'Read console',
        error: 'Console read failed',
      },
      name: '',
      info: { completed: { path: 'output.messages.length', fallback: '0' } },
      suffix: { completed: 'messages' },
      color: { started: 'primary', completed: 'slate', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  read_network_requests: {
    inline: {
      icon: { started: 'Loader2', completed: 'Network', error: 'AlertTriangle' },
      prefix: {
        started: 'Reading network',
        completed: 'Read network',
        error: 'Network read failed',
      },
      name: '',
      info: { completed: { path: 'output.requests.length', fallback: '0' } },
      suffix: { completed: 'requests' },
      color: { started: 'primary', completed: 'slate', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  // ─── Demos / guidance ────────────────────────────────────────────────

  record_demo: {
    inline: {
      icon: { started: 'Circle', completed: 'CircleDot', error: 'AlertTriangle' },
      prefix: '',
      name: {
        started: 'Recording demo',
        completed: 'Demo recorded',
        error: 'Recording failed',
      },
      info: { path: 'args.action' },
      color: { started: 'red', completed: 'emerald', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  replay_demo: {
    inline: {
      icon: { started: 'Loader2', completed: 'Play', error: 'AlertTriangle' },
      prefix: {
        started: 'Replaying demo',
        completed: 'Replayed demo',
        error: 'Replay failed',
      },
      name: { path: 'args.demo_id', transform: 'truncate80' },
      info: { completed: { path: 'output.steps_executed', fallback: '0' } },
      suffix: { completed: 'steps' },
      color: { started: 'primary', completed: 'emerald', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  list_demos: {
    inline: {
      icon: { started: 'Loader2', completed: 'List', error: 'AlertTriangle' },
      prefix: {
        started: 'Listing demos',
        completed: 'Listed demos',
        error: 'Failed to list demos',
      },
      name: '',
      info: { completed: { path: 'output.demos.length', fallback: '0' } },
      suffix: { completed: 'demos' },
      color: { started: 'primary', completed: 'sky', error: 'red' },
    },
    args: { hidden: true },
  },

  describe_demo: {
    inline: {
      icon: { started: 'Loader2', completed: 'FileSearch', error: 'AlertTriangle' },
      prefix: {
        started: 'Describing demo',
        completed: 'Described demo',
        error: 'Describe failed',
      },
      name: { path: 'args.demo_id', transform: 'truncate80' },
      color: { started: 'primary', completed: 'sky', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  delete_demo: {
    inline: {
      icon: { started: 'Loader2', completed: 'Trash2', error: 'AlertTriangle' },
      prefix: {
        started: 'Deleting demo',
        completed: 'Deleted demo',
        error: 'Delete failed',
      },
      name: { path: 'args.demo_id', transform: 'truncate80' },
      color: { started: 'primary', completed: 'red', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  record_gif: {
    inline: {
      icon: { started: 'Circle', completed: 'Film', error: 'AlertTriangle' },
      prefix: '',
      name: {
        started: 'Recording GIF',
        completed: 'GIF recorded',
        error: 'GIF recording failed',
      },
      info: { path: 'args.action' },
      color: { started: 'red', completed: 'emerald', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  save_guidance_note: {
    inline: {
      icon: { started: 'Loader2', completed: 'StickyNote', error: 'AlertTriangle' },
      prefix: {
        started: 'Saving note for',
        completed: 'Saved note for',
        error: 'Failed to save note for',
      },
      name: { path: 'args.domain' },
      info: { path: 'args.text', transform: 'truncate80' },
      color: { started: 'primary', completed: 'amber', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  list_guidance: {
    inline: {
      icon: { started: 'Loader2', completed: 'BookOpen', error: 'AlertTriangle' },
      prefix: {
        started: 'Listing guidance for',
        completed: 'Listed guidance for',
        error: 'Failed to list guidance for',
      },
      name: { path: 'args.domain', fallback: 'all domains' },
      info: { completed: { path: 'output.items.length', fallback: '0' } },
      suffix: { completed: 'items' },
      color: { started: 'primary', completed: 'amber', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  get_guidance_item: {
    inline: {
      icon: { started: 'Loader2', completed: 'BookOpen', error: 'AlertTriangle' },
      prefix: {
        started: 'Getting guidance item',
        completed: 'Got guidance item',
        error: 'Failed to get guidance item',
      },
      name: { path: 'args.id', transform: 'truncate80' },
      color: { started: 'primary', completed: 'amber', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  delete_guidance_item: {
    inline: {
      icon: { started: 'Loader2', completed: 'Trash2', error: 'AlertTriangle' },
      prefix: {
        started: 'Deleting guidance item',
        completed: 'Deleted guidance item',
        error: 'Delete failed',
      },
      name: { path: 'args.id', transform: 'truncate80' },
      color: { started: 'primary', completed: 'red', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  // ─── Plan + takeover ─────────────────────────────────────────────────

  update_plan: {
    inline: {
      icon: { started: 'Loader2', completed: 'ListChecks', error: 'AlertTriangle' },
      prefix: {
        started: 'Proposing plan',
        completed: 'Plan updated',
        error: 'Plan failed',
      },
      name: '',
      info: { path: 'args.steps.length', fallback: '' },
      suffix: 'steps',
      color: { started: 'primary', completed: 'amber', error: 'red' },
    },
    args: { displayType: 'json' },
  },

  request_user_takeover: {
    inline: {
      icon: { started: 'Loader2', completed: 'Hand', error: 'AlertTriangle' },
      prefix: {
        started: 'Asking you to take over',
        completed: 'Handed off to you',
        error: 'Takeover failed',
      },
      name: '',
      info: { path: 'args.reason', transform: 'truncate80' },
      color: { started: 'primary', completed: 'sky', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  resize_window: {
    inline: {
      icon: { started: 'Loader2', completed: 'Maximize2', error: 'AlertTriangle' },
      prefix: {
        started: 'Resizing window',
        completed: 'Resized window',
        error: 'Resize failed',
      },
      name: '',
      info: { path: 'args.width', fallback: '' },
      color: { started: 'primary', completed: 'slate', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  // ─── Page-understanding granular reads ───────────────────────────────

  read_active_page: {
    inline: {
      icon: { started: 'Loader2', completed: 'BookOpen', error: 'AlertTriangle' },
      prefix: {
        started: 'Reading active page',
        completed: 'Read active page',
        error: 'Failed to read page',
      },
      name: '',
      info: { completed: { path: 'output.title', transform: 'truncate80' } },
      color: { started: 'primary', completed: 'sky', error: 'red' },
    },
    args: { hidden: true },
  },

  query_elements: {
    inline: {
      icon: { started: 'Loader2', completed: 'Crosshair', error: 'AlertTriangle' },
      prefix: { started: 'Querying', completed: 'Found', error: 'Query failed' },
      name: { path: 'args.selector', transform: 'truncate80' },
      info: { completed: { path: 'output.count', fallback: '0' } },
      suffix: { completed: 'matches' },
      color: { started: 'primary', completed: 'violet', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  find_text_on_page: {
    inline: {
      icon: 'Search',
      prefix: { started: 'Finding text', completed: 'Found text', error: 'Find failed' },
      name: { path: 'args.text', transform: 'truncate80' },
      info: { completed: { path: 'output.count', fallback: '0' } },
      suffix: { completed: 'matches' },
      color: { started: 'primary', completed: 'violet', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  get_page_links: {
    inline: {
      icon: { started: 'Loader2', completed: 'Link', error: 'AlertTriangle' },
      prefix: {
        started: 'Getting page links',
        completed: 'Got page links',
        error: 'Failed to get links',
      },
      name: '',
      info: { completed: { path: 'output.links.length', fallback: '0' } },
      suffix: { completed: 'links' },
      color: { started: 'primary', completed: 'sky', error: 'red' },
    },
    args: { hidden: true },
  },

  get_page_text: {
    inline: {
      icon: { started: 'Loader2', completed: 'FileText', error: 'AlertTriangle' },
      prefix: {
        started: 'Extracting article text',
        completed: 'Extracted article text',
        error: 'Text extraction failed',
      },
      name: '',
      info: { completed: { path: 'output.word_count', fallback: '' } },
      suffix: { completed: 'words' },
      color: { started: 'primary', completed: 'sky', error: 'red' },
    },
    args: { hidden: true },
  },

  get_page_selection: {
    inline: {
      icon: { started: 'Loader2', completed: 'TextCursorInput', error: 'AlertTriangle' },
      prefix: {
        started: 'Reading selection',
        completed: 'Read selection',
        error: 'Selection failed',
      },
      name: '',
      info: { completed: { path: 'output.text', transform: 'truncate80' } },
      color: { started: 'primary', completed: 'sky', error: 'red' },
    },
    args: { hidden: true },
  },

  get_element_at_point: {
    inline: {
      icon: { started: 'Loader2', completed: 'Crosshair', error: 'AlertTriangle' },
      prefix: {
        started: 'Probing element at',
        completed: 'Got element at',
        error: 'Probe failed at',
      },
      name: '',
      info: { path: 'args.x' },
      color: { started: 'primary', completed: 'violet', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  get_element_details: {
    inline: {
      icon: { started: 'Loader2', completed: 'Inspect', error: 'AlertTriangle' },
      prefix: {
        started: 'Inspecting element',
        completed: 'Inspected element',
        error: 'Inspect failed',
      },
      name: { path: 'args.ref' },
      color: { started: 'primary', completed: 'violet', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  get_form_fields: {
    inline: {
      icon: { started: 'Loader2', completed: 'FormInput', error: 'AlertTriangle' },
      prefix: {
        started: 'Reading form fields',
        completed: 'Read form fields',
        error: 'Read failed',
      },
      name: '',
      info: { completed: { path: 'output.fields.length', fallback: '0' } },
      suffix: { completed: 'fields' },
      color: { started: 'primary', completed: 'sky', error: 'red' },
    },
    args: { hidden: true },
  },

  // ─── Remaining canonical tools (1:1 display coverage) ─────────────────
  // Every tool in CANONICAL_SURFACE has an entry so none falls back to the
  // bare default row. Most are header-only (icon + phase verb + a relevant
  // arg/output chip); action-routed tools surface `args.action` as the chip.

  list_browser_tools: {
    inline: {
      icon: { started: 'Loader2', completed: 'Wrench', error: 'AlertTriangle' },
      prefix: { started: 'Loading tools', completed: 'Loaded tools', error: 'Tool load failed' },
      name: { path: 'args.category', fallback: '' },
      color: { started: 'primary', completed: 'sky', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  extract_microdata: {
    inline: {
      icon: { started: 'Loader2', completed: 'Boxes', error: 'AlertTriangle' },
      prefix: {
        started: 'Extracting microdata',
        completed: 'Extracted microdata',
        error: 'Microdata extraction failed',
      },
      name: '',
      color: { started: 'primary', completed: 'violet', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  fetch_url_as_markdown: {
    inline: {
      icon: { started: 'Loader2', completed: 'Globe', error: 'AlertTriangle' },
      prefix: { started: 'Fetching', completed: 'Fetched', error: 'Fetch failed' },
      name: { path: 'args.url', transform: 'truncate80' },
      info: { completed: { path: 'output.word_count', fallback: '' } },
      suffix: { completed: 'words' },
      color: { started: 'primary', completed: 'sky', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  get_computed_style: {
    inline: {
      icon: { started: 'Loader2', completed: 'Palette', error: 'AlertTriangle' },
      prefix: {
        started: 'Reading computed style',
        completed: 'Read computed style',
        error: 'Computed-style read failed',
      },
      name: { path: 'args.selector', transform: 'truncate80' },
      color: { started: 'primary', completed: 'violet', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  inspect_element: {
    inline: {
      icon: { started: 'Loader2', completed: 'Crosshair', error: 'AlertTriangle' },
      prefix: {
        started: 'Inspecting element',
        completed: 'Inspected element',
        error: 'Inspect failed',
      },
      name: { path: 'args.selector', transform: 'truncate80' },
      color: { started: 'primary', completed: 'violet', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  list_highlights: {
    inline: {
      icon: { started: 'Loader2', completed: 'Highlighter', error: 'AlertTriangle' },
      prefix: {
        started: 'Listing highlights',
        completed: 'Highlights',
        error: 'Failed to list highlights',
      },
      name: '',
      info: { completed: { path: 'output.highlights.length', fallback: '0' } },
      suffix: { completed: 'highlights' },
      color: { started: 'primary', completed: 'amber', error: 'red' },
    },
    args: { hidden: true },
  },

  mutation_watch: {
    inline: {
      icon: { started: 'Loader2', completed: 'Activity', error: 'AlertTriangle' },
      prefix: {
        started: 'Watching for changes',
        completed: 'Observed changes',
        error: 'Mutation watch failed',
      },
      name: { path: 'args.selector', transform: 'truncate80', fallback: '' },
      info: { completed: { path: 'output.events.length', fallback: '0' } },
      suffix: { completed: 'events' },
      color: { started: 'primary', completed: 'sky', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  data_patterns: {
    inline: {
      icon: { started: 'Loader2', completed: 'Table2', error: 'AlertTriangle' },
      prefix: {
        started: 'Working with saved patterns',
        completed: 'Saved patterns',
        error: 'Pattern action failed',
      },
      name: '',
      info: { path: 'args.action', fallback: '' },
      color: { started: 'primary', completed: 'violet', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  tasks: {
    inline: {
      icon: { started: 'Loader2', completed: 'ListChecks', error: 'AlertTriangle' },
      prefix: { started: 'Updating task list', completed: 'Task list', error: 'Tasks failed' },
      name: '',
      info: { path: 'args.action', fallback: '' },
      color: { started: 'primary', completed: 'emerald', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  user_todos: {
    inline: {
      icon: { started: 'Loader2', completed: 'ClipboardList', error: 'AlertTriangle' },
      prefix: { started: 'Updating your to-dos', completed: 'Your to-dos', error: 'To-dos failed' },
      name: '',
      info: { path: 'args.action', fallback: '' },
      color: { started: 'primary', completed: 'amber', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  desktop_run_command: {
    inline: {
      icon: { started: 'Loader2', completed: 'Terminal', error: 'AlertTriangle' },
      prefix: {
        started: 'Running command',
        completed: 'Ran command',
        error: 'Command failed',
      },
      name: { path: 'args.command', transform: 'truncate80' },
      color: { started: 'primary', completed: 'slate', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  chrome_save_page_as_mhtml: {
    inline: {
      icon: { started: 'Loader2', completed: 'Archive', error: 'AlertTriangle' },
      prefix: {
        started: 'Saving page',
        completed: 'Saved page (MHTML)',
        error: 'Save failed',
      },
      name: '',
      color: { started: 'primary', completed: 'sky', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  chrome_tab_audio_inspect: {
    inline: {
      icon: { started: 'Loader2', completed: 'AudioLines', error: 'AlertTriangle' },
      prefix: {
        started: 'Inspecting tab audio',
        completed: 'Tab audio',
        error: 'Audio inspect failed',
      },
      name: '',
      color: { started: 'primary', completed: 'violet', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  chrome_record_tab_video: {
    inline: {
      icon: { started: 'Circle', completed: 'Video', error: 'AlertTriangle' },
      prefix: {
        started: 'Recording video',
        completed: 'Video recorded',
        error: 'Video recording failed',
      },
      name: '',
      color: { started: 'red', completed: 'emerald', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  // ─── CDP (admin) ──────────────────────────────────────────────────────

  cdp_a11y_tree: {
    inline: {
      icon: { started: 'Loader2', completed: 'Accessibility', error: 'AlertTriangle' },
      prefix: {
        started: 'Reading a11y tree',
        completed: 'Accessibility tree',
        error: 'A11y read failed',
      },
      name: '',
      color: { started: 'primary', completed: 'slate', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  cdp_input_click_xy: {
    inline: {
      icon: { started: 'Loader2', completed: 'MousePointerClick', error: 'AlertTriangle' },
      prefix: { started: 'Clicking (CDP)', completed: 'Clicked (CDP)', error: 'Click failed' },
      name: '',
      color: { started: 'primary', completed: 'red', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  cdp_input_type: {
    inline: {
      icon: { started: 'Loader2', completed: 'Keyboard', error: 'AlertTriangle' },
      prefix: { started: 'Typing (CDP)', completed: 'Typed (CDP)', error: 'Type failed' },
      name: { path: 'args.text', transform: 'truncate80' },
      color: { started: 'primary', completed: 'red', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  cdp_perf_metrics: {
    inline: {
      icon: { started: 'Loader2', completed: 'Gauge', error: 'AlertTriangle' },
      prefix: {
        started: 'Reading perf metrics',
        completed: 'Perf metrics',
        error: 'Perf read failed',
      },
      name: '',
      color: { started: 'primary', completed: 'slate', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  cdp_print_pdf: {
    inline: {
      icon: { started: 'Loader2', completed: 'Printer', error: 'AlertTriangle' },
      prefix: { started: 'Printing PDF', completed: 'Printed PDF', error: 'PDF print failed' },
      name: '',
      color: { started: 'primary', completed: 'slate', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  cdp_network_capture_start: {
    inline: {
      icon: { started: 'Loader2', completed: 'Network', error: 'AlertTriangle' },
      prefix: {
        started: 'Starting network capture',
        completed: 'Network capture started',
        error: 'Capture start failed',
      },
      name: '',
      color: { started: 'primary', completed: 'slate', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  cdp_network_capture_drain: {
    inline: {
      icon: { started: 'Loader2', completed: 'Network', error: 'AlertTriangle' },
      prefix: {
        started: 'Draining network capture',
        completed: 'Network events',
        error: 'Capture drain failed',
      },
      name: '',
      info: { completed: { path: 'output.events.length', fallback: '0' } },
      suffix: { completed: 'events' },
      color: { started: 'primary', completed: 'slate', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  cdp_network_capture_stop: {
    inline: {
      icon: { started: 'Loader2', completed: 'Network', error: 'AlertTriangle' },
      prefix: {
        started: 'Stopping network capture',
        completed: 'Network capture stopped',
        error: 'Capture stop failed',
      },
      name: '',
      color: { started: 'primary', completed: 'slate', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  cdp_network_get_body: {
    inline: {
      icon: { started: 'Loader2', completed: 'FileJson', error: 'AlertTriangle' },
      prefix: {
        started: 'Fetching response body',
        completed: 'Response body',
        error: 'Body fetch failed',
      },
      name: { path: 'args.request_id', transform: 'truncate80' },
      color: { started: 'primary', completed: 'slate', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  get_request_body: {
    inline: {
      icon: { started: 'Loader2', completed: 'FileJson', error: 'AlertTriangle' },
      prefix: {
        started: 'Fetching request body',
        completed: 'Request body',
        error: 'Body fetch failed',
      },
      name: { path: 'args.request_id', transform: 'truncate80' },
      color: { started: 'primary', completed: 'slate', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },
};

/**
 * Legacy-name aliases.
 *
 * The 2026-05-19 global-namespace redesign renamed several mega-tools (the
 * Chrome-personal-data tools gained a `chrome_` prefix; the colon namespace
 * was dropped). The agent now calls the new canonical names, so the display
 * config has to live under the new key. We keep BOTH keys pointing at the
 * same config object: the canonical name renders new calls, and the old bare
 * name keeps rendering historical timeline entries from conversations
 * recorded before the rename. The shapes (args.action, etc.) are identical —
 * these are pure renames — so one config serves both.
 *
 * If you rename a tool, add its alias here (and the drift test in
 * tests/unit/tool-display-registry.test.ts will hold you to it).
 */
const LEGACY_DISPLAY_ALIASES: Record<string, string> = {
  chrome_bookmarks: 'bookmarks',
  chrome_history: 'history',
  chrome_recently_closed: 'recently_closed',
  chrome_cookies: 'cookies',
  chrome_webmcp: 'webmcp',
  chrome_record_gif: 'record_gif',
};

for (const [canonical, legacy] of Object.entries(LEGACY_DISPLAY_ALIASES)) {
  const cfg = toolDisplayRegistry[legacy];
  if (cfg) toolDisplayRegistry[canonical] = cfg;
}
