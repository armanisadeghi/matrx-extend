# matrx-extend client tool catalog

Generated: 2026-05-23T01:15:09.612Z

- **Total tools:** 168
- **Assistant bundle:** 75 tools (read-only)
- **Pilot bundle:** 138 tools (read + action + ask-user)
- **Pilot+privileged bundle:** 168 tools


## Tier: read (75)

### `list_browser_tools`

Index of every browser-tool category the extension exposes. Returns one entry per category: name, label, description, count of tools, name of the category-specific list tool. To get the full schemas for a category, call its `list_tool` (e.g. `list_page_tools`). Use this whenever the model needs more capabilities than its current toolset offers.

- **Required permissions:** (none)
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `list_core_tools`

Full schemas for tools in the "Core" category (core). Always-on discovery + batching utilities. Includes `list_browser_tools` (the category index) and `browser_batch` (run multiple read-tier calls in one round trip). Use the category index to load tools on demand. Returns { count, tools: [{ name, description, tier, input_schema }] }.

- **Required permissions:** (none)
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `list_reading_tools`

Full schemas for tools in the "Read the page" category (reading). Understand what's on the active page. Accessibility-tree summary with reference IDs (`read_page`), natural-language element search (`find`), Ctrl+F text search, link discovery, full readable text, structured-data extraction (tables, microdata, JSON-LD), PDF reading, mutation observers, single-element deep inspection. Use these BEFORE any interaction so you know what's on the page. Returns { count, tools: [{ name, description, tier, input_schema }] }.

- **Required permissions:** (none)
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `list_interaction_tools`

Full schemas for tools in the "Use the page" category (interaction). Do something on the page. Mouse + keyboard (`computer`), form input + submission (`form_input`, `submit_form`), navigation, waiting for conditions, sleeping, scrolling, clipboard, file upload + drag-drop, CSS injection, JavaScript evaluation. Prefer `wait_for` over `sleep` when you have a concrete condition. Returns { count, tools: [{ name, description, tier, input_schema }] }.

- **Required permissions:** (none)
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `list_tabs_tools`

Full schemas for tools in the "Tabs & windows" category (tabs). Manage browser tabs and groups. The `tabs` mega-tool covers list/create/close/switch/reload/pin/mute/duplicate/move/zoom and reading active-tab info. `tab_groups` manages named tab groups. `resize_window` for responsive testing. `chrome_tab_audio_inspect` finds the noisy tab. Returns { count, tools: [{ name, description, tier, input_schema }] }.

- **Required permissions:** (none)
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `list_capture_tools`

Full schemas for tools in the "Save & capture" category (capture). Capture artifacts from the browser: file downloads, MHTML snapshots of a page, region screenshots, animated GIFs of user actions, video recordings of a tab. Pairs with the cloud-file system — most produce a `file_id` you can pass to later tools. Returns { count, tools: [{ name, description, tier, input_schema }] }.

- **Required permissions:** (none)
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `list_chrome_tools`

Full schemas for tools in the "Chrome user data" category (chrome). Access the user's personal Chrome data — cookies for any domain, bookmarks, browsing history, recently-closed sessions. Only the Chrome extension can read these (server-side Playwright runs a fresh browser context with none of the user's real data). All tools here are admin-restricted by default. Returns { count, tools: [{ name, description, tier, input_schema }] }.

- **Required permissions:** (none)
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `list_human_tools`

Full schemas for tools in the "Talk to the user" category (human). Loop the human in. `user` (six modes: confirm/choice/choice_many/text/secret/notify), `update_plan` (propose a plan and wait for approval), `request_user_takeover` (hand control back so the user can do something the agent cannot), `tasks` (agent's live tasklist), `user_todos` (assign work to the user). Per-conversation state. Returns { count, tools: [{ name, description, tier, input_schema }] }.

- **Required permissions:** (none)
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `list_memory_tools`

Full schemas for tools in the "Agent memory" category (memory). Agent state that persists across turns. `scratchpad` is session-scoped (cleared on SW restart). `storage` is persistent agent-namespaced KV. `remember_for_domain` writes a domain memo that auto-surfaces in context when the user opens a tab on that domain. Returns { count, tools: [{ name, description, tier, input_schema }] }.

- **Required permissions:** (none)
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `list_ai_tools`

Full schemas for tools in the "On-device AI" category (ai). Chrome's built-in Gemini Nano and siblings. Free, offline, on-GPU. The `ai` mega-tool exposes summarize, classify, extract-JSON-by-schema, translate, detect-language, proofread, describe-image, and prompt-injection-check actions. Use these BEFORE expensive cloud calls when on-device quality permits. Returns { count, tools: [{ name, description, tier, input_schema }] }.

- **Required permissions:** (none)
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `list_demos_tools`

Full schemas for tools in the "Record & replay" category (demos). Record a user demonstration of a workflow once, then replay it on demand with parameter substitution. Self-healing selector chain (matrx-ref → id → testid → ARIA → text → CSS path) survives DOM churn between recording and replay. Replay is privileged — always asks the user to confirm before clicking / typing / submitting. Returns { count, tools: [{ name, description, tier, input_schema }] }.

- **Required permissions:** (none)
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `list_guidance_tools`

Full schemas for tools in the "User-saved hints" category (guidance). Domain-scoped notes, screenshots, GIFs, and demo references the user has saved for the agent. Whenever the user opens a tab on a matching domain, the agent's context auto-includes the saved hints. Tools here let the agent add notes, browse what exists, and remove stale items. Returns { count, tools: [{ name, description, tier, input_schema }] }.

- **Required permissions:** (none)
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `list_devtools_tools`

Full schemas for tools in the "DevTools (admin)" category (devtools). Chrome DevTools Protocol + host diagnostics. CDP-backed full-page screenshots, accessibility-tree dumps, network/console capture, coordinate-based clicks that bypass shadow DOM, performance metrics, device emulation, PDF print. Plus host info (CPU/memory/display, declarativeNetRequest rules). All admin-gated. Returns { count, tools: [{ name, description, tier, input_schema }] }.

- **Required permissions:** (none)
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `list_webmcp_tools`

Full schemas for tools in the "Page-registered tools" category (webmcp). Discover and call tools that pages have registered via `navigator.modelContext.registerTool` (Chrome 146+). The `chrome_webmcp` mega-tool lets the agent enumerate the page's tool catalog and invoke specific tools. Admin-only experimental capability. Returns { count, tools: [{ name, description, tier, input_schema }] }.

- **Required permissions:** (none)
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `list_desktop_tools`

Full schemas for tools in the "Desktop bridge" category (desktop). Bridge to matrx-local — the desktop engine. `desktop_run_command` invokes commands matrx-local exposes (file ops, system info, window control, etc.). Fails fast when the bridge isn't connected. Returns { count, tools: [{ name, description, tier, input_schema }] }.

- **Required permissions:** (none)
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `browser_batch`

Execute up to 20 read-tier tool calls in one round trip. Pass `calls: [{ name, arguments }]`. Returns `results: [{ name, ok, output | error }]` in order. Action / ask-user / privileged tools are NOT permitted inside a batch — call them individually so the user can approve. Use this for predictable multi-step reads (read_page + take_screenshot + list_open_tabs) where each call is independent.

- **Required permissions:** (none)
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "calls": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "minLength": 1
          },
          "arguments": {}
        },
        "required": [
          "name"
        ],
        "additionalProperties": false
      },
      "minItems": 1,
      "maxItems": 20
    },
    "stop_on_error": {
      "type": "boolean",
      "default": false
    }
  },
  "required": [
    "calls"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `read_page`

Return an accessibility-style summary of the active page. Each interactive element gets a reference id (`ref:N`) you can pass to click_element / type_into_element / scroll_into_view / etc. instead of a CSS selector — refs are stable across DOM mutations within the same page lifetime. Pass interactive_only=false to include headings, paragraphs, and labels too. Refs invalidate on navigation; call this again after navigating. Returns { url, title, count, elements: [{ ref, role, name, tag, text, visible, bounds? }] }.

- **Required permissions:** `activeTab`, `scripting`
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "tab_id": {
      "type": "string"
    },
    "interactive_only": {
      "type": "boolean",
      "default": true
    },
    "filter": {
      "type": "string",
      "enum": [
        "interactive",
        "all"
      ]
    },
    "include_hidden": {
      "type": "boolean",
      "default": false
    },
    "max_nodes": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 2000,
      "default": 200
    },
    "include_text": {
      "type": "boolean",
      "default": true
    },
    "include_bounds": {
      "type": "boolean",
      "default": false
    },
    "trigger_lazy_load": {
      "type": "boolean",
      "default": false
    },
    "max_chars": {
      "type": "integer",
      "exclusiveMinimum": 0
    }
  },
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `find`

Find elements on the active page by natural-language description ("the sign-in button", "the search input near the top", "the paragraph about pricing"). Returns matching refs you can immediately pass to interaction tools. Uses on-device AI for matching when available; falls back to text similarity. Reuses any fresh `read_page` scrape — call it once before a series of finds. By default also searches non-interactive content (headings/paragraphs) so you can locate sections by topic; set `include_content:false` to restrict to clickable elements only. Returns { matches: [{ ref, name, role, score, reason }] }.

- **Required permissions:** `activeTab`, `scripting`
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "minLength": 1
    },
    "max_candidates": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 500,
      "default": 200
    },
    "limit": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 20,
      "default": 5
    },
    "include_content": {
      "type": "boolean",
      "default": true
    },
    "tab_id": {
      "type": "string"
    }
  },
  "required": [
    "query"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `get_page_text`

Extract clean readable text from the active page — strips chrome / nav / ads / scripts / hidden DOM. Lighter than read_active_page (which returns full markdown + media + structured data). Best for "read me this article" style asks. Returns { url, title, byline, text, char_count }.

- **Required permissions:** `activeTab`, `scripting`
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "tab_id": {
      "type": "string"
    },
    "max_chars": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 50000,
      "default": 8000
    }
  },
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `get_active_tab`

Return information about the user’s currently focused browser tab: url, title, tab id, window id, status, favicon.

- **Required permissions:** `activeTab`
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `get_page_selection`

Return the user’s currently selected text on the active tab. Empty string if nothing is selected.

- **Required permissions:** `activeTab`, `scripting`
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `read_active_page`

Read the active tab and return a structured snapshot: cleaned article (markdown + html), title, byline, full image/video/link/audio lists, JSON-LD, schema types, SEO signals (headings, meta, alt-text coverage). Pass deep=true to scroll the page top→bottom first to trigger lazy-loaded images and infinite-scroll content before reading. Use this whenever you need to understand or quote the page.

- **Required permissions:** `activeTab`, `scripting`
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "deep": {
      "type": "boolean",
      "default": false
    }
  },
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `take_screenshot`

Capture the active tab as an image, optimized for vision-API consumption. `mode: 'visible'` (default) captures the current viewport via captureVisibleTab. `mode: 'full_page'` scroll-and-stitches the full scrollable height via captureVisibleTab + OffscreenCanvas (no extra permissions; ~5s for a 10-screen page; position:fixed elements appear on every tile). Default profile 'auto' returns a 'max useful' master image (JPEG q=88 @ 2576px — Opus 4.7's ceiling, the highest any current model uses) at ~600–900 KB; the server is expected to do per-provider final sizing from that master. Use 'auto-final' if the server is a passthrough (1568px JPEG q=85 — fits every provider). Provider-specific profiles when the server already knows the model: 'anthropic-default'/'anthropic-hires', 'openai-original'/'openai-high'/'openai-low', 'gemini-screenshot'/'gemini-overview'/'gemini-2.5-default'. Special-purpose: 'ocr-heavy' (high-q for fine text), 'lossless' (PNG, archival only). Returns { ok, mode, media_type, format, width, height, source_width, source_height, image_base64, byte_length, resized, profile, est_tokens, tile_count?, truncated? }. The `media_type` field is ready for direct use in an image content block — the agent server should pass it through verbatim, NOT stringify the whole object.

- **Required permissions:** `activeTab`
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "profile": {
      "type": "string",
      "enum": [
        "auto",
        "auto-final",
        "anthropic-default",
        "anthropic-hires",
        "openai-original",
        "openai-high",
        "openai-low",
        "gemini-screenshot",
        "gemini-overview",
        "gemini-2.5-default",
        "ocr-heavy",
        "lossless"
      ],
      "default": "auto"
    },
    "format": {
      "type": "string",
      "enum": [
        "png",
        "jpeg"
      ]
    },
    "quality": {
      "type": "integer",
      "minimum": 1,
      "maximum": 100
    },
    "max_dimension": {
      "type": "integer",
      "minimum": 0,
      "maximum": 8192
    },
    "persist": {
      "type": "boolean",
      "default": true
    },
    "capture_source": {
      "type": "string",
      "enum": [
        "agent",
        "user",
        "unknown"
      ],
      "default": "unknown"
    },
    "mode": {
      "type": "string",
      "enum": [
        "visible",
        "full_page"
      ],
      "default": "visible"
    }
  },
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `query_elements`

Run document.querySelectorAll on the active tab and return up to `limit` matches as { tag, text, attrs }. `attrs` is a list of attribute names to extract. Use this to find CSS selectors that subsequent action tools can target.

- **Required permissions:** `activeTab`, `scripting`
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "selector": {
      "type": "string",
      "minLength": 1
    },
    "attributes": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "limit": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 500,
      "default": 100
    }
  },
  "required": [
    "selector"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `find_text_on_page`

Ctrl+F-style literal text search within a tab. Returns matches with surrounding context + the nearest enclosing element selector. Pass regex=true to use a regular expression. Use when read_active_page would be overkill — e.g. "where on this page does it say 'click here to download'?". For natural-language search, use find instead.

- **Required permissions:** `activeTab`, `scripting`
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "minLength": 1
    },
    "tab_id": {
      "type": "string"
    },
    "case_sensitive": {
      "type": "boolean",
      "default": false
    },
    "regex": {
      "type": "boolean",
      "default": false
    },
    "limit": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 100,
      "default": 20
    },
    "context_chars": {
      "type": "integer",
      "minimum": 0,
      "maximum": 500,
      "default": 80
    }
  },
  "required": [
    "query"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `get_page_links`

Return anchor links from the active tab. Each entry is { href, text, title, rel, target }. Filter by href substring, link text substring, or same-origin only. Lighter than read_active_page when you only need link discovery.

- **Required permissions:** `activeTab`, `scripting`
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "href_contains": {
      "type": "string"
    },
    "text_contains": {
      "type": "string"
    },
    "same_origin_only": {
      "type": "boolean",
      "default": false
    },
    "limit": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 2000,
      "default": 200
    }
  },
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `get_computed_style`

Read computed CSS for an element. Pass `properties` to limit (e.g. ["color","font-size"]) — without it returns a useful default subset (color, background, font, padding, margin, border, display, position, dimensions). Useful for debugging visual issues or matching styles.

- **Required permissions:** `activeTab`, `scripting`
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "selector": {
      "type": "string",
      "minLength": 1
    },
    "properties": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "selector"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `get_element_at_point`

Identify the DOM element at viewport coordinates (x, y). Returns tag, text, attrs, and a stable selector. Useful when correlating something seen in a screenshot to a clickable element.

- **Required permissions:** `activeTab`, `scripting`
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "x": {
      "type": "number"
    },
    "y": {
      "type": "number"
    }
  },
  "required": [
    "x",
    "y"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `inspect_element`

Deep snapshot of a single element: tag, text, full attributes, bounding rect, key computed styles, ancestor chain (tag + class), and child counts. Useful when a click or type call is failing and you need to understand why.

- **Required permissions:** `activeTab`, `scripting`
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "selector": {
      "type": "string",
      "minLength": 1
    }
  },
  "required": [
    "selector"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `get_element_details`

Deep inspection of a single element by ref: full attribute set, bounding box, visibility, optional computed styles and innerHTML. Use when read_page's summary isn't enough — e.g. reading data-* attributes or checking if something is hidden by CSS. Avoids needing evaluate_javascript for routine introspection. innerHTML is capped at 50 KB; response includes truncated:true when exceeded.

- **Required permissions:** (none)
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "tab_id": {
      "type": "string"
    },
    "ref": {
      "type": "string"
    },
    "include_html": {
      "type": "boolean",
      "default": false
    },
    "include_styles": {
      "type": "boolean",
      "default": false
    }
  },
  "required": [
    "ref"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `list_open_tabs`

List all open browser tabs. Returns id, url, title, windowId, groupId, active flag, status. Use this to discover what the user is working with before deciding which tab to act on.

- **Required permissions:** `tabs`
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "all_windows": {
      "type": "boolean",
      "default": true
    },
    "url": {
      "type": "string"
    },
    "audible": {
      "type": "boolean"
    },
    "loaded_only": {
      "type": "boolean"
    }
  },
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `get_tab_groups`

List every tab group across windows: id, title, color, collapsed flag, and the tab ids inside. Use after list_open_tabs to understand how the user has organized their work.

- **Required permissions:** `tabs`, `tabGroups`
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `get_tab_info`

Get full information about a specific tab by id. Same fields as list_open_tabs but for a single tab. Returns { ok:false, reason } if the tab is gone.

- **Required permissions:** `tabs`
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "tab_id": {
      "type": "integer"
    }
  },
  "required": [
    "tab_id"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `search_bookmarks`

Search the user's bookmarks by free-text query (matches title and URL). Returns id, title, url, parentId, dateAdded. Use this to find references the user has saved before recommending a fresh web search.

- **Required permissions:** `bookmarks`
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "minLength": 1
    },
    "limit": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 500,
      "default": 50
    }
  },
  "required": [
    "query"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `list_bookmark_tree`

Return the bookmarks folder hierarchy starting at root (or a specific folder_id). Walks up to max_depth levels deep. Each node has { id, title, url|null, children?: [...] }.

- **Required permissions:** `bookmarks`
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "folder_id": {
      "type": "string"
    },
    "max_depth": {
      "type": "integer",
      "minimum": 1,
      "maximum": 10,
      "default": 3
    }
  },
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `search_history`

Search the user's browsing history. Returns visit metadata for matching pages: { url, title, lastVisitTime, visitCount, typedCount }. Use to recall "what was that thing I was reading yesterday about X?" without forcing a new web search.

- **Required permissions:** `history`
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "default": ""
    },
    "start_time_ms": {
      "type": "integer",
      "minimum": 0
    },
    "end_time_ms": {
      "type": "integer",
      "minimum": 0
    },
    "max_results": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 1000,
      "default": 100
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `list_recent_history`

Return the most recent N pages the user visited within the last `minutes`. Sorted newest-first. Useful as low-cost context for "what is the user doing right now?".

- **Required permissions:** `history`
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "minutes": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 43200,
      "default": 60
    },
    "max_results": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 1000,
      "default": 50
    }
  },
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `list_downloads`

List recent file downloads. Each entry is { id, filename, url, mime, totalBytes, state, startTime }. Useful to verify a download_url tool call landed.

- **Required permissions:** `downloads`
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string"
    },
    "state": {
      "type": "string",
      "enum": [
        "in_progress",
        "interrupted",
        "complete"
      ]
    },
    "limit": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 500,
      "default": 50
    }
  },
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `get_form_fields`

Discover forms on the active tab. For each form, returns id, action, method, and a list of fields: { name, type, value, label, required, placeholder, selector }. Use this BEFORE typing to find the right selector and label so you fill the right field.

- **Required permissions:** `activeTab`, `scripting`
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "selector": {
      "type": "string"
    }
  },
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `get_extension_storage`

Read a value the agent previously stored via set_extension_storage. Returns { ok, value, exists }. Read-only, so always runs without prompting.

- **Required permissions:** `storage`
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "key": {
      "type": "string",
      "minLength": 1
    },
    "area": {
      "type": "string",
      "enum": [
        "local",
        "session"
      ],
      "default": "local"
    }
  },
  "required": [
    "key"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `list_extension_storage`

List keys + values the agent has stored. Filter by `prefix`. Useful to inspect prior agent state.

- **Required permissions:** `storage`
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "area": {
      "type": "string",
      "enum": [
        "local",
        "session"
      ],
      "default": "local"
    },
    "prefix": {
      "type": "string"
    }
  },
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `ai_check_availability`

Probe whether on-device AI (Gemini Nano + Summarizer/Translator/Proofreader/etc.) is available in the user's Chrome and ready to use. Returns per-API availability: unavailable | downloadable | downloading | available. Call this once at the start of a session to decide whether to use on-device tools or fall back to cloud.

- **Required permissions:** (none)
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `ai_summarize`

Summarize a piece of text using on-device Gemini Nano. Free, no network, no token billing. Use BEFORE passing huge page content to the cloud model — pre-summarize it and pass the summary instead. Types: tldr (one paragraph), key-points (bullet list), teaser (sales-y one-liner), headline (single sentence). Lengths: short / medium / long.

- **Required permissions:** (none)
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "text": {
      "type": "string",
      "minLength": 1
    },
    "type": {
      "type": "string",
      "enum": [
        "tldr",
        "key-points",
        "teaser",
        "headline"
      ],
      "default": "tldr"
    },
    "length": {
      "type": "string",
      "enum": [
        "short",
        "medium",
        "long"
      ],
      "default": "short"
    }
  },
  "required": [
    "text"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `ai_classify`

Classify text into ONE of the provided labels using on-device Gemini Nano. Returns { label, confidence }. Constrains the output via JSON Schema so the result is always one of the labels you provided. Useful for: routing a message ("question", "command", "greeting"), labeling a page ("article", "spa", "checkout"), gating expensive cloud calls on intent.

- **Required permissions:** (none)
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "text": {
      "type": "string",
      "minLength": 1
    },
    "labels": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1
      },
      "minItems": 2,
      "maxItems": 20
    },
    "context": {
      "type": "string"
    }
  },
  "required": [
    "text",
    "labels"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `ai_extract_json`

Extract structured data from unstructured text using on-device Gemini Nano. Pass a JSON Schema and the model returns matching JSON. Free, fast, no network. Use for: extracting names/addresses/prices from page text, normalizing form data, parsing semi-structured logs.

- **Required permissions:** (none)
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "text": {
      "type": "string",
      "minLength": 1
    },
    "schema": {},
    "hint": {
      "type": "string"
    }
  },
  "required": [
    "text"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `ai_translate`

Translate text between languages using on-device models. Pass `auto` as source_language to auto-detect. Returns the translated string. Free, no network. Best for short-to-medium text; long documents may chunk the result.

- **Required permissions:** (none)
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "text": {
      "type": "string",
      "minLength": 1
    },
    "source_language": {
      "type": "string",
      "minLength": 2,
      "default": "auto"
    },
    "target_language": {
      "type": "string",
      "minLength": 2
    }
  },
  "required": [
    "text",
    "target_language"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `ai_detect_language`

Detect the language of a piece of text. Returns one or more candidates with confidence. On-device, free.

- **Required permissions:** (none)
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "text": {
      "type": "string",
      "minLength": 1
    }
  },
  "required": [
    "text"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `ai_proofread`

Proofread text for grammar, spelling, and typos using on-device AI. Returns the corrected version. Useful before sending the user-typed content somewhere it will be visible to others.

- **Required permissions:** (none)
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "text": {
      "type": "string",
      "minLength": 1
    }
  },
  "required": [
    "text"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `ai_describe_image`

Multimodal description of a base64-encoded image using on-device Gemini Nano. Pair with `take_screenshot` for cheap visual analysis: "what does this page look like?", "find the submit button in this screenshot", "is there an error message visible?". Free, no network round-trip.

- **Required permissions:** (none)
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "image_base64": {
      "type": "string",
      "minLength": 64
    },
    "mime_type": {
      "type": "string",
      "enum": [
        "image/png",
        "image/jpeg",
        "image/webp"
      ],
      "default": "image/png"
    },
    "question": {
      "type": "string",
      "default": "Describe this image in detail."
    }
  },
  "required": [
    "image_base64"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `ai_check_prompt_injection`

Run untrusted text (page content, scraped data, user-supplied input) through an on-device safety check BEFORE passing to a cloud model. Returns { suspicious, reason, severity }. Use as a guardrail when you're about to feed third-party page text into the agent loop. Cheap and offline.

- **Required permissions:** (none)
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "text": {
      "type": "string",
      "minLength": 1
    },
    "source_hint": {
      "type": "string"
    }
  },
  "required": [
    "text"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `list_recently_closed`

List recently-closed tabs and windows the user can restore. Each entry has { id, last_modified, tab? | window? }. Useful when the user says "what was that page I just closed?".

- **Required permissions:** (none)
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "max_results": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 25,
      "default": 25
    }
  },
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `get_cookies`

Read cookies for a URL or domain. Pass `url` (preferred — narrower) OR `domain`, optionally also `name` to filter to one cookie. Returns a list of { name, value, domain, path, secure, httpOnly, sameSite, expirationDate }. Personal data — admin only by default.

- **Required permissions:** (none)
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "url": {
      "type": "string",
      "format": "uri"
    },
    "domain": {
      "type": "string"
    },
    "name": {
      "type": "string"
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `cdp_attached_tabs`

Return the list of tab ids currently attached via CDP.

- **Required permissions:** (none)
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `cdp_perf_metrics`

Read Performance.getMetrics for a tab. Returns { Documents, Frames, JSHeapUsedSize, LayoutCount, RecalcStyleCount, ScriptDuration, TaskDuration, … }. Useful when an action triggered chaos and you need to measure it.

- **Required permissions:** `activeTab`
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "tab_id": {
      "type": "integer"
    }
  },
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `get_system_info`

Snapshot of the host device: CPU (architecture, model, core count, per-core load), memory (total / available bytes), and connected displays (id, name, bounds, DPR, primary flag). Useful for fan-out sizing, screenshot scaling, and memory-pressure-aware pagination. Read-only and admin-gated.

- **Required permissions:** `system.cpu`, `system.memory`, `system.display`
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `list_network_blocking_rules`

List the active declarativeNetRequest rules for this extension: dynamic (persisted across reloads) and session (in-memory only). Diagnostic for "why is request X being blocked / redirected?" when our own privacy-respecting blocking rules are in effect. Read-only, admin-gated, returns rule definitions only — does not surface any traffic.

- **Required permissions:** `declarativeNetRequestWithHostAccess`
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `webmcp_check_availability`

Check whether WebMCP (`navigator.modelContext.registerTool`) is available in the user's Chrome and whether the active tab has registered any tools. Use this once before calling webmcp_list_page_tools / webmcp_call_page_tool.

- **Required permissions:** `activeTab`, `scripting`
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `webmcp_list_page_tools`

List tools the active tab has registered via `navigator.modelContext.registerTool`. Each entry includes { name, description, inputSchema }. Use these to discover what the page offers before calling webmcp_call_page_tool.

- **Required permissions:** `activeTab`, `scripting`
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `list_demos`

List every saved demo as { id, name, description, start_url, step_count, parameter_names, created_at, updated_at }. Use to find a demo to replay or describe.

- **Required permissions:** `storage`
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `describe_demo`

Return the full step list for a saved demo. Each step has { kind, url, selector_chain, element_snapshot, input_text, param_placeholder, is_sensitive }. Use before replay to verify what the demo will do.

- **Required permissions:** `storage`
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "demo_id": {
      "type": "string",
      "minLength": 1
    }
  },
  "required": [
    "demo_id"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `list_guidance`

List saved guidance items (notes, screenshots, GIFs, demo references). Pass `domain` to filter; omit to return everything. Returns lightweight summaries — call `get_guidance_item` for full details.

- **Required permissions:** `storage`
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "domain": {
      "type": "string"
    }
  },
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `get_guidance_item`

Return the full record for one guidance item by id. Notes include their text; screenshots/GIFs include their cld_files URL; demo references include the linked demo_id (use `replay_demo` to run).

- **Required permissions:** `storage`
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "minLength": 1
    }
  },
  "required": [
    "id"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `list_highlights`

List highlights the user captured on web pages (text passages and elements) via the Highlight tab. Each entry includes the captured text plus a reference (CSS selector, data-matrx-ref when still valid, role/tag, and a text-quote anchor) so you can act on the exact element or passage with click/type/extract tools. scope: "page" (current URL, default), "site" (current domain), or "all".

- **Required permissions:** (none)
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "scope": {
      "type": "string",
      "enum": [
        "page",
        "site",
        "all"
      ],
      "default": "page"
    },
    "url": {
      "type": "string"
    },
    "limit": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 1000,
      "default": 100
    }
  },
  "additionalProperties": false,
  "default": {
    "scope": "page",
    "limit": 100
  },
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `extract_table`

Extract a table on the active page as structured JSON. Handles native <table> with thead/tbody, rowspan/colspan, multi-row headers, and ARIA role="table" / role="grid" patterns. Provide `ref` (preferred) from a prior read_page, or `selector` (any CSS), or omit both to pick the largest visible table. Returns { columns: [{ index, path: [headerLevels...] }], rows: [{ cells: [{ value, is_header, colspan?, rowspan? }] }], merged_cells, row_count, column_count }. Use this instead of cell-by-cell scraping — one call versus dozens.

- **Required permissions:** `activeTab`, `scripting`
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "ref": {
      "type": "string"
    },
    "selector": {
      "type": "string"
    },
    "max_rows": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 5000,
      "default": 500
    },
    "normalize": {
      "type": "boolean",
      "default": true
    },
    "compute_header_paths": {
      "type": "boolean",
      "default": true
    }
  },
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `screenshot_region`

Capture a bounded region of the active tab's viewport. Provide `ref` (preferred) from a prior read_page, OR `selector`, OR an explicit viewport `rect: {x,y,w,h}`. The handler scrolls the target into view if needed, captures the visible viewport, then crops to the resolved rect (with optional `padding` in CSS px). Returns the same shape as take_screenshot: { media_type, format, width, height, image_base64, byte_length, source_rect }. Use this for focused vision-API calls on a specific component — 5-20× cheaper than a full-page screenshot.

- **Required permissions:** `activeTab`, `scripting`
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "ref": {
      "type": "string"
    },
    "selector": {
      "type": "string"
    },
    "rect": {
      "type": "object",
      "properties": {
        "x": {
          "type": "number"
        },
        "y": {
          "type": "number"
        },
        "w": {
          "type": "number",
          "exclusiveMinimum": 0
        },
        "h": {
          "type": "number",
          "exclusiveMinimum": 0
        }
      },
      "required": [
        "x",
        "y",
        "w",
        "h"
      ],
      "additionalProperties": false
    },
    "padding": {
      "type": "integer",
      "minimum": 0,
      "maximum": 200,
      "default": 8
    },
    "profile": {
      "type": "string",
      "enum": [
        "auto",
        "auto-final",
        "anthropic-default",
        "anthropic-hires",
        "openai-original",
        "openai-high",
        "openai-low",
        "gemini-screenshot",
        "gemini-overview",
        "gemini-2.5-default",
        "ocr-heavy",
        "lossless"
      ],
      "default": "auto"
    },
    "format": {
      "type": "string",
      "enum": [
        "png",
        "jpeg"
      ]
    },
    "quality": {
      "type": "integer",
      "minimum": 1,
      "maximum": 100
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `chrome_tab_audio_inspect`

Report which open tabs are currently making noise, were recently audible (within the last 60s), or are muted. Each entry: { id, title, url, audible, muted, active, window_id, last_audible_at }. Useful for finding 'the noisy tab' and for media-aware automation.

- **Required permissions:** (none)
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `mutation_watch`

Observe an element for `duration_ms` (default 3000, max 30000) and report what changed. Set `kinds` to a subset of ['text','attributes','children','visibility'] to filter; default watches all four. Events: { ts_ms, kind, before?, after?, attribute?, added_count?, removed_count?, visible? }. Use this instead of polling read_page when waiting for async UI to settle.

- **Required permissions:** `activeTab`, `scripting`
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "ref": {
      "type": "string"
    },
    "selector": {
      "type": "string"
    },
    "duration_ms": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 30000,
      "default": 3000
    },
    "kinds": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": [
          "text",
          "attributes",
          "children",
          "visibility"
        ]
      }
    },
    "max_events": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 2000,
      "default": 200
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `extract_microdata`

Extract every structured-data signal on the active page in one call: { snapshot, json_ld, microdata, schema_org_types, counts }. `snapshot` is the OG/Twitter/canonical/JSON-LD snapshot used by the Showcase tab. `json_ld` returns each JSON-LD block (flattens @graph; honors `ld_type` filter). `microdata` walks every [itemscope][itemtype] tree (honors `itemtype` filter). `schema_org_types` unions all detected types so you can answer 'is this a Product page?' in one read. Same code paths as the user-facing Showcase → JSON-LD / Microdata / Snapshot sub-tabs, so improvements to either surface flow both ways.

- **Required permissions:** `activeTab`, `scripting`
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "kinds": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": [
          "snapshot",
          "json_ld",
          "microdata"
        ]
      }
    },
    "ld_type": {
      "type": "string"
    },
    "itemtype": {
      "type": "string"
    }
  },
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `fetch_url_as_markdown`

Fetch an HTTP(S) URL and return its readable content as Markdown — the same defuddle + readability + turndown pipeline the Scrape tab uses against the active page, but pointed at any URL without opening a tab. Returns { title, markdown, byline, excerpt, extractor, word_count, reading_time_minutes, metadata, ld_json, http_status, final_url, content_type, truncated }. Pass `use_session: true` to attach the user's cookies (paywalled / logged-in pages). Pass `include_extras: true` to also get links / images / videos / SEO audit. Non-HTML URLs (PDFs, JSON, etc.) are rejected with a clear error — use `read_pdf` for PDFs.

- **Required permissions:** (none)
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "url": {
      "type": "string",
      "format": "uri"
    },
    "use_session": {
      "type": "boolean",
      "default": false
    },
    "follow_redirects": {
      "type": "boolean",
      "default": true
    },
    "user_agent": {
      "type": "string"
    },
    "max_chars": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 2000000,
      "default": 200000
    },
    "include_extras": {
      "type": "boolean",
      "default": false
    }
  },
  "required": [
    "url"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `scratchpad`

Session-scoped, in-process scratchpad for stashing structured notes across turns without burning context tokens. Distinct from the canonical `memory` tool which is the persistent long-term memory system. Use scratchpad for ephemeral state inside a single run; use `memory` for things the agent should remember about the user across sessions. Actions: 'set' (write a value to a key), 'get' (read by key), 'list' (all keys), 'delete' (remove a key). Values are stringified — stringify objects before passing. Caps: 8 KB per value, 100 keys per session. Cleared at session end.

- **Required permissions:** (none)
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "action": {
      "type": "string",
      "enum": [
        "set",
        "get",
        "list",
        "delete"
      ]
    },
    "key": {
      "type": "string"
    },
    "value": {
      "type": "string"
    }
  },
  "required": [
    "action"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `wait_for`

Poll until a condition is met or timeout. Use after navigation or actions that trigger async loads — far more reliable than fixed sleeps. Conditions: 'element' (ref or selector exists and is visible; pass scroll=true to scroll the page while polling — handles infinite scroll), 'text' (text appears anywhere on page), 'url' (tab URL matches substring or regex), 'network_idle' (no in-flight requests for ~500ms).

- **Required permissions:** `activeTab`, `scripting`
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "tab_id": {
      "type": "string"
    },
    "condition": {
      "type": "string",
      "enum": [
        "element",
        "text",
        "url",
        "network_idle"
      ]
    },
    "target": {
      "type": "string"
    },
    "scroll": {
      "type": "boolean",
      "default": false
    },
    "timeout_ms": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "default": 10000
    }
  },
  "required": [
    "tab_id",
    "condition"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `read_pdf`

Extract text and structure from a PDF — either one loaded in a browser tab, or one already in cld_files (pass file_id). Returns text by page with optional page range. Use file_id when you have a MediaRef in hand (e.g. from a prior download); use tab_id when the PDF is open in the browser.

- **Required permissions:** (none)
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "tab_id": {
      "type": "string"
    },
    "file_id": {
      "type": "string"
    },
    "page_start": {
      "type": "integer",
      "exclusiveMinimum": 0
    },
    "page_end": {
      "type": "integer",
      "exclusiveMinimum": 0
    },
    "max_chars": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "default": 50000
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `ai`

On-device AI (Gemini Nano + siblings). Free, offline, multimodal, no network. Actions: 'check_availability' (probe per-API readiness), 'summarize' (text→summary), 'classify' (text+categories→label), 'extract_json' (text+schema→object), 'translate' (text+target_lang), 'detect_language' (text→BCP-47), 'proofread' (text→corrections), 'describe_image' (image_url OR image_base64+mime_type → caption), 'check_prompt_injection' (text→risk assessment). Use BEFORE expensive cloud calls when on-device quality permits.

- **Required permissions:** (none)
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "action": {
      "type": "string",
      "enum": [
        "check_availability",
        "summarize",
        "classify",
        "extract_json",
        "translate",
        "detect_language",
        "proofread",
        "describe_image",
        "check_prompt_injection"
      ]
    },
    "text": {
      "type": "string"
    },
    "categories": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "schema": {},
    "target_lang": {
      "type": "string"
    },
    "source_lang": {
      "type": "string"
    },
    "image_url": {
      "type": "string"
    },
    "image_base64": {
      "type": "string"
    },
    "mime_type": {
      "type": "string"
    },
    "prompt": {
      "type": "string"
    }
  },
  "required": [
    "action"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `chrome_bookmarks`

Read the user's bookmarks. Actions: 'search' (free-text against title and URL; pass `query`), 'tree' (folder tree starting at `folder_id` or root, `max_depth` deep). Each bookmark has id/title/url/parent_id/date_added.

- **Required permissions:** (none)
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "action": {
      "type": "string",
      "enum": [
        "search",
        "tree"
      ]
    },
    "query": {
      "type": "string"
    },
    "folder_id": {
      "type": "string"
    },
    "max_depth": {
      "type": "integer",
      "exclusiveMinimum": 0
    },
    "limit": {
      "type": "integer",
      "exclusiveMinimum": 0
    }
  },
  "required": [
    "action"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `chrome_history`

Read browsing history. Actions: 'search' (free-text against title/URL; pass `query`, optional `start_time_ms`/`end_time_ms`/`limit`), 'recent' (last N `minutes`, default 60).

- **Required permissions:** (none)
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "action": {
      "type": "string",
      "enum": [
        "search",
        "recent"
      ]
    },
    "query": {
      "type": "string"
    },
    "start_time_ms": {
      "type": "integer"
    },
    "end_time_ms": {
      "type": "integer"
    },
    "minutes": {
      "type": "integer",
      "exclusiveMinimum": 0
    },
    "limit": {
      "type": "integer",
      "exclusiveMinimum": 0
    }
  },
  "required": [
    "action"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

## Tier: action (60)

### `navigate_active_tab`

Navigate the active tab to a URL. Waits for status=complete before resolving (timeout 30s). Returns { url, title, status }.

- **Required permissions:** `tabs`, `activeTab`
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "url": {
      "type": "string",
      "format": "uri"
    }
  },
  "required": [
    "url"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `click_element`

Click an element on the active tab. Pass `ref` from read_page (preferred — stable across DOM mutations) OR a CSS `selector`. When multiple match a selector, use `nth`. Returns { ok, tag, text } or { ok:false, reason }.

- **Required permissions:** `activeTab`, `scripting`
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "selector": {
      "type": "string",
      "minLength": 1
    },
    "ref": {
      "type": "string",
      "minLength": 1
    },
    "nth": {
      "type": "integer",
      "minimum": 0,
      "default": 0
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `type_into_element`

Set the value of an input / textarea / contenteditable. Pass `ref` from read_page (preferred) OR a CSS `selector`. By default clears the field first and dispatches input + change events so React/Vue see the update.

- **Required permissions:** `activeTab`, `scripting`
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "selector": {
      "type": "string",
      "minLength": 1
    },
    "ref": {
      "type": "string",
      "minLength": 1
    },
    "text": {
      "type": "string"
    },
    "clear": {
      "type": "boolean",
      "default": true
    },
    "dispatch_events": {
      "type": "boolean",
      "default": true
    }
  },
  "required": [
    "text"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `scroll_page`

Scroll the active tab. direction="top"/"bottom" go to extremes; "into-view" scrolls a selector or `ref` (from read_page) into view; "by" scrolls by delta_y pixels.

- **Required permissions:** `activeTab`, `scripting`
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "direction": {
      "type": "string",
      "enum": [
        "top",
        "bottom",
        "into-view",
        "by"
      ]
    },
    "selector": {
      "type": "string"
    },
    "ref": {
      "type": "string"
    },
    "delta_y": {
      "type": "number"
    }
  },
  "required": [
    "direction"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `wait_for`

Wait for a condition on the active tab — either the page to fully load (ready_state=true) and/or a selector to appear. Returns { ok, waited_ms }.

- **Required permissions:** `activeTab`, `scripting`
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "selector": {
      "type": "string"
    },
    "ready_state": {
      "type": "boolean"
    },
    "timeout_ms": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 60000,
      "default": 10000
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `set_clipboard`

Write text to the system clipboard.

- **Required permissions:** `activeTab`, `scripting`, `clipboardWrite`
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "text": {
      "type": "string"
    }
  },
  "required": [
    "text"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `sleep`

Pause the agent for `ms` milliseconds (50ms–5min). Use when waiting for time-based things the page does on its own — a video to play before capturing transcript, an animation to finish, a debounced search to settle, a rate-limit window to clear. The server is non-blocking during the pause; only the agent waits. Prefer `wait_for` when you have a concrete condition (selector or readyState) — `sleep` is for unconditional waits. Returns { ok, slept_ms }.

- **Required permissions:** (none)
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "ms": {
      "type": "integer",
      "minimum": 50,
      "maximum": 300000
    },
    "reason": {
      "type": "string",
      "maxLength": 200
    }
  },
  "required": [
    "ms"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `press_keys`

Send keyboard input to a page. Pass either a literal string ("hello world") or named keys/chords ("Enter", "Control+A", "Tab", "ArrowDown ArrowDown Enter"). When `selector` or `ref` is provided the tool focuses that element first. Useful for triggering submit-on-Enter, navigating menus, dismissing dialogs, and using app keyboard shortcuts.

- **Required permissions:** `activeTab`, `scripting`
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "keys": {
      "type": "string",
      "minLength": 1
    },
    "selector": {
      "type": "string"
    },
    "ref": {
      "type": "string"
    },
    "delay_ms": {
      "type": "integer",
      "minimum": 0,
      "maximum": 1000,
      "default": 30
    }
  },
  "required": [
    "keys"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `hover_element`

Trigger hover on an element by dispatching mouseenter/mouseover/mousemove events. Pass `ref` from read_page or a CSS `selector`. Reveals hover-only tooltips, dropdown menus, or sub-navigation.

- **Required permissions:** `activeTab`, `scripting`
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "selector": {
      "type": "string",
      "minLength": 1
    },
    "ref": {
      "type": "string",
      "minLength": 1
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `focus_element`

Move keyboard focus to an element. Pass `ref` from read_page or a `selector`. Use before press_keys when no selector is supplied to that tool.

- **Required permissions:** `activeTab`, `scripting`
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "selector": {
      "type": "string",
      "minLength": 1
    },
    "ref": {
      "type": "string",
      "minLength": 1
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `blur_element`

Remove focus from an element. With no selector, blurs whatever currently has focus. Useful before press_keys when shortcuts must hit document instead of an input.

- **Required permissions:** `activeTab`, `scripting`
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "selector": {
      "type": "string"
    }
  },
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `right_click_element`

Dispatch a contextmenu event on an element (synthetic right-click). Note: most apps respond by showing their own custom menu in the page DOM. Chrome's native context menu cannot be opened by extension scripts.

- **Required permissions:** `activeTab`, `scripting`
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "selector": {
      "type": "string",
      "minLength": 1
    },
    "ref": {
      "type": "string",
      "minLength": 1
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `select_dropdown_option`

Choose an option in a <select> element. Pass exactly ONE of: value (the option's value attr), label (the visible text), or index (0-based). Dispatches change + input events for framework apps.

- **Required permissions:** `activeTab`, `scripting`
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "selector": {
      "type": "string",
      "minLength": 1
    },
    "ref": {
      "type": "string",
      "minLength": 1
    },
    "value": {
      "type": "string"
    },
    "label": {
      "type": "string"
    },
    "index": {
      "type": "integer",
      "minimum": 0
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `set_checkbox`

Set a checkbox to checked or unchecked, dispatching click + change events so frameworks see the toggle. Use for both <input type="checkbox"> and ARIA-styled toggles where role="checkbox".

- **Required permissions:** `activeTab`, `scripting`
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "selector": {
      "type": "string",
      "minLength": 1
    },
    "ref": {
      "type": "string",
      "minLength": 1
    },
    "checked": {
      "type": "boolean"
    }
  },
  "required": [
    "checked"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `set_radio`

Pick a radio button from a group. Pass selector pointing at the group container OR any radio input in it, then exactly ONE of value/label/index.

- **Required permissions:** `activeTab`, `scripting`
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "selector": {
      "type": "string",
      "minLength": 1
    },
    "ref": {
      "type": "string",
      "minLength": 1
    },
    "value": {
      "type": "string"
    },
    "label": {
      "type": "string"
    },
    "index": {
      "type": "integer",
      "minimum": 0
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `submit_form`

Submit a form. By default the tool clicks the form's primary submit button (so HTML5 validation + framework handlers run). Set via_button=false to fall back to HTMLFormElement.submit() — skips validation but works for form elements that lack a button.

- **Required permissions:** `activeTab`, `scripting`
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "selector": {
      "type": "string"
    },
    "via_button": {
      "type": "boolean",
      "default": true
    }
  },
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `file_upload`

Attach files to an `<input type="file">` element by selector or ref. IMPORTANT: clicking a file input opens a native dialog the agent cannot see — use this tool instead. Each file in `files` is { name, mime, base64 }. Dispatches `change` so frameworks see the upload. Returns { ok, file_count, names }.

- **Required permissions:** `activeTab`, `scripting`
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "selector": {
      "type": "string",
      "minLength": 1
    },
    "ref": {
      "type": "string",
      "minLength": 1
    },
    "files": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "minLength": 1
          },
          "mime": {
            "type": "string",
            "minLength": 1,
            "default": "application/octet-stream"
          },
          "base64": {
            "type": "string",
            "minLength": 1
          }
        },
        "required": [
          "name",
          "base64"
        ],
        "additionalProperties": false
      },
      "minItems": 1
    }
  },
  "required": [
    "files"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `open_new_tab`

Open a new tab pointing at a URL. Returns the new tab id, window id, and final URL once load begins. Use active=false to background-load reference pages.

- **Required permissions:** `tabs`
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "url": {
      "type": "string",
      "format": "uri"
    },
    "active": {
      "type": "boolean",
      "default": true
    },
    "pinned": {
      "type": "boolean",
      "default": false
    },
    "window_id": {
      "type": "integer"
    },
    "index": {
      "type": "integer",
      "minimum": 0
    }
  },
  "required": [
    "url"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `close_tab`

Close one or more tabs by id. Pass a single id or an array. Cleaning up reference tabs at the end of a research run is a common use.

- **Required permissions:** `tabs`
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "tab_ids": {
      "anyOf": [
        {
          "type": "integer"
        },
        {
          "type": "array",
          "items": {
            "type": "integer"
          },
          "minItems": 1
        }
      ]
    }
  },
  "required": [
    "tab_ids"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `switch_to_tab`

Activate (focus) a specific tab and bring its window forward. Use this before per-tab actions that operate on the active tab (click, type, etc).

- **Required permissions:** `tabs`
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "tab_id": {
      "type": "integer"
    }
  },
  "required": [
    "tab_id"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `duplicate_tab`

Duplicate an existing tab. Returns the new tab id. Useful for branching experiments without losing the original page.

- **Required permissions:** `tabs`
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "tab_id": {
      "type": "integer"
    }
  },
  "required": [
    "tab_id"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `pin_tab`

Pin or unpin a tab. Pinned tabs are smaller and live at the front of the strip.

- **Required permissions:** `tabs`
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "tab_id": {
      "type": "integer"
    },
    "pinned": {
      "type": "boolean"
    }
  },
  "required": [
    "tab_id",
    "pinned"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `mute_tab`

Mute or unmute a tab.

- **Required permissions:** `tabs`
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "tab_id": {
      "type": "integer"
    },
    "muted": {
      "type": "boolean"
    }
  },
  "required": [
    "tab_id",
    "muted"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `reload_tab`

Reload a tab (default: the active tab). Pass bypass_cache=true for a hard refresh.

- **Required permissions:** `tabs`
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "tab_id": {
      "type": "integer"
    },
    "bypass_cache": {
      "type": "boolean",
      "default": false
    }
  },
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `go_back`

Navigate the active tab (or specified tab) one entry back in its session history.

- **Required permissions:** `tabs`
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "tab_id": {
      "type": "integer"
    }
  },
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `go_forward`

Navigate the active tab (or specified tab) one entry forward in its session history.

- **Required permissions:** `tabs`
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "tab_id": {
      "type": "integer"
    }
  },
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `set_tab_zoom`

Set the zoom level on a tab. 1.0 = 100%, 1.5 = 150%, 0.75 = 75%.

- **Required permissions:** `tabs`
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "tab_id": {
      "type": "integer"
    },
    "zoom_factor": {
      "type": "number",
      "minimum": 0.25,
      "maximum": 5
    }
  },
  "required": [
    "zoom_factor"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `move_tab`

Reorder a tab (and optionally move it to another window).

- **Required permissions:** `tabs`
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "tab_id": {
      "type": "integer"
    },
    "index": {
      "type": "integer",
      "minimum": -1
    },
    "window_id": {
      "type": "integer"
    }
  },
  "required": [
    "tab_id",
    "index"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `resize_window`

Resize the browser window containing a tab. Useful for responsive testing. If tab_id is omitted, resizes the active tab's window. Note: this changes the OS window size, which in turn changes the viewport.

- **Required permissions:** `tabs`
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "tab_id": {
      "type": "integer"
    },
    "width": {
      "type": "integer",
      "exclusiveMinimum": 0
    },
    "height": {
      "type": "integer",
      "exclusiveMinimum": 0
    }
  },
  "required": [
    "width",
    "height"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `create_tab_group`

Group a set of tabs together. Returns the new group id. Use this to keep an agent run's sandboxed tabs visually separate from the user's other work.

- **Required permissions:** `tabs`, `tabGroups`
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "tab_ids": {
      "type": "array",
      "items": {
        "type": "integer"
      },
      "minItems": 1
    },
    "title": {
      "type": "string"
    },
    "color": {
      "type": "string",
      "enum": [
        "grey",
        "blue",
        "red",
        "yellow",
        "green",
        "pink",
        "purple",
        "cyan",
        "orange"
      ]
    },
    "window_id": {
      "type": "integer"
    },
    "collapsed": {
      "type": "boolean"
    }
  },
  "required": [
    "tab_ids"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `add_tabs_to_group`

Add tabs to an existing tab group.

- **Required permissions:** `tabs`, `tabGroups`
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "group_id": {
      "type": "integer"
    },
    "tab_ids": {
      "type": "array",
      "items": {
        "type": "integer"
      },
      "minItems": 1
    }
  },
  "required": [
    "group_id",
    "tab_ids"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `remove_tabs_from_group`

Detach tabs from whatever group they currently belong to.

- **Required permissions:** `tabs`, `tabGroups`
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "tab_ids": {
      "type": "array",
      "items": {
        "type": "integer"
      },
      "minItems": 1
    }
  },
  "required": [
    "tab_ids"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `update_tab_group`

Rename, recolor, or collapse/expand a tab group.

- **Required permissions:** `tabGroups`
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "group_id": {
      "type": "integer"
    },
    "title": {
      "type": "string"
    },
    "color": {
      "type": "string",
      "enum": [
        "grey",
        "blue",
        "red",
        "yellow",
        "green",
        "pink",
        "purple",
        "cyan",
        "orange"
      ]
    },
    "collapsed": {
      "type": "boolean"
    }
  },
  "required": [
    "group_id"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `download_url`

Download a file from a URL into the user's default downloads folder. Returns { ok, download_id, final_filename }. Use save_as=true to surface the Save dialog (good for ambiguous filenames).

- **Required permissions:** `downloads`
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "url": {
      "type": "string",
      "format": "uri"
    },
    "filename": {
      "type": "string"
    },
    "conflict": {
      "type": "string",
      "enum": [
        "uniquify",
        "overwrite",
        "prompt"
      ],
      "default": "uniquify"
    },
    "save_as": {
      "type": "boolean",
      "default": false
    }
  },
  "required": [
    "url"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `cancel_download`

Cancel an in-progress download by its download_id.

- **Required permissions:** `downloads`
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "download_id": {
      "type": "integer"
    }
  },
  "required": [
    "download_id"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `remember_for_domain`

Remember something about a domain so it shows up in `domain_memo` context on every future visit. Use for site-specific lessons: "the PO submit button is the third primary", "DOB format is MM/DD/YYYY here", "this site requires SSO via Okta". Notes are free-form prose; hints are structured key/value pairs you can look up by name. Memos on a parent domain (e.g., atlassian.net) automatically apply to subdomains. Returns the updated memo so you can see what is remembered now.

- **Required permissions:** (none)
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "domain": {
      "type": "string",
      "minLength": 3,
      "maxLength": 253
    },
    "note": {
      "type": "string",
      "minLength": 1,
      "maxLength": 500
    },
    "hints": {
      "type": "object",
      "additionalProperties": {
        "type": "string",
        "maxLength": 500
      }
    }
  },
  "required": [
    "domain"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `restore_recently_closed`

Restore a recently-closed tab or window. Pass `session_id` from list_recently_closed, or omit to restore the most recent.

- **Required permissions:** (none)
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "session_id": {
      "type": "string"
    }
  },
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `chrome_save_page_as_mhtml`

Snapshot a tab as a self-contained MHTML archive (HTML + every resource inlined). Returns base64 MHTML data. Use for: archival, sharing a frozen page, feeding the agent a stable snapshot it can reanalyze later.

- **Required permissions:** (none)
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "tab_id": {
      "type": "integer"
    }
  },
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `webmcp_call_page_tool`

Invoke a tool registered by the active page via `navigator.modelContext`. Pass the tool name and an arguments object (must match the page's declared input schema). Returns the page tool's result.

- **Required permissions:** `activeTab`, `scripting`
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "minLength": 1
    },
    "arguments": {}
  },
  "required": [
    "name"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `tasks`

Manage the agent's own tasklist for the current conversation. Actions: 'add' (one via `title` or many via `items`), 'list' (read current tasks), 'set_status' (`id` + `status`), 'update' (`id` + `title` and/or `note`; pass note=null to clear), 'remove' (`id`), 'reorder' (`ids` in desired order), 'clear_completed' (drop done + skipped), 'clear_all'. Statuses: pending, in_progress, done, blocked, skipped. The list and any user edits to it are surfaced to you in `task_list` context on every turn — set statuses as you work so the user can see live progress.

- **Required permissions:** (none)
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "action": {
      "type": "string",
      "enum": [
        "add",
        "list",
        "set_status",
        "update",
        "remove",
        "reorder",
        "clear_completed",
        "clear_all"
      ]
    },
    "title": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    },
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "title": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          },
          "status": {
            "type": "string",
            "enum": [
              "pending",
              "in_progress",
              "done",
              "blocked",
              "skipped"
            ]
          },
          "note": {
            "type": "string",
            "maxLength": 500
          }
        },
        "required": [
          "title"
        ],
        "additionalProperties": false
      },
      "maxItems": 40
    },
    "id": {
      "type": "string"
    },
    "status": {
      "type": "string",
      "enum": [
        "pending",
        "in_progress",
        "done",
        "blocked",
        "skipped"
      ]
    },
    "note": {
      "anyOf": [
        {
          "type": "string",
          "maxLength": 500
        },
        {
          "type": "null"
        }
      ]
    },
    "ids": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "action"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `user_todos`

Assign tasks TO THE USER for the current conversation. The user sees them in a dedicated panel and checks them off; you'll see their state in `user_todos` context on every turn. Actions: 'add' (`title` + optional `context` for why + optional `due` hint; fires a Chrome notification unless `silent:true`), 'list', 'update' (`id` + `title`/`context`/`due`; pass null to clear), 'remove' (`id`), 'mark_done' (`id`; `done:false` un-checks), 'clear_done' (purge completed). Use this to delegate work back to the user — e.g. 'forward the email I just drafted', 'pick a date for the meeting'.

- **Required permissions:** (none)
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "action": {
      "type": "string",
      "enum": [
        "add",
        "list",
        "update",
        "remove",
        "mark_done",
        "clear_done"
      ]
    },
    "title": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    },
    "context": {
      "anyOf": [
        {
          "type": "string",
          "maxLength": 300
        },
        {
          "type": "null"
        }
      ]
    },
    "due": {
      "anyOf": [
        {
          "type": "string",
          "maxLength": 80
        },
        {
          "type": "null"
        }
      ]
    },
    "id": {
      "type": "string"
    },
    "silent": {
      "type": "boolean"
    },
    "done": {
      "type": "boolean"
    }
  },
  "required": [
    "action"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `parallel_for_each_tab`

Fan the same prompt out across N existing tabs (max 8) and collect the results. Each sub-run gets its own conversation pinned to a specific tab; results come back per-tab once all sub-runs finish (or time out — Promise.allSettled, one tab failing doesn't kill the others). Args: { tab_ids: number[], sub_prompt: string, agent_id?: string, timeout_ms?: number, merge_strategy?: 'per_tab' | 'concat' | 'json_array' }. Returns merged results in the chosen shape. Use the `list_open_tabs` tool first to discover tab ids. The sub-runs inherit the parent run's permission mode — keep them in 'act' mode for unattended fan-out, but be cautious: each sub-run is a real LLM call and bills accordingly.

- **Required permissions:** (none)
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "tab_ids": {
      "type": "array",
      "items": {
        "type": "integer",
        "minimum": 0
      },
      "minItems": 1,
      "maxItems": 8
    },
    "sub_prompt": {
      "type": "string",
      "minLength": 1
    },
    "agent_id": {
      "type": "string"
    },
    "timeout_ms": {
      "type": "integer",
      "minimum": 1000,
      "maximum": 120000,
      "default": 60000
    },
    "merge_strategy": {
      "type": "string",
      "enum": [
        "per_tab",
        "concat",
        "json_array"
      ],
      "default": "per_tab"
    }
  },
  "required": [
    "tab_ids",
    "sub_prompt"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `chrome_record_gif`

Record browser actions and export as an animated GIF. Actions: 'start_recording', 'stop_recording', 'export' (generates and either downloads or drops onto a page element), 'clear' (discard frames). Take a screenshot right after start and right before stop to capture clean first/last frames. 'export' returns {file_id, file_url} when not dropping. Drop target accepts ref (preferred) or coordinate.

- **Required permissions:** (none)
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "action": {
      "type": "string",
      "enum": [
        "start_recording",
        "stop_recording",
        "export",
        "clear"
      ]
    },
    "tab_id": {
      "type": "string"
    },
    "download": {
      "type": "boolean"
    },
    "ref": {
      "type": "string"
    },
    "coordinate": {
      "type": "array",
      "items": {
        "type": "number"
      },
      "minItems": 2,
      "maxItems": 2
    },
    "filename": {
      "type": "string"
    },
    "options": {
      "type": "object",
      "properties": {
        "showClickIndicators": {
          "type": "boolean"
        },
        "showDragPaths": {
          "type": "boolean"
        },
        "showActionLabels": {
          "type": "boolean"
        },
        "showProgressBar": {
          "type": "boolean"
        },
        "showWatermark": {
          "type": "boolean"
        },
        "quality": {
          "type": "integer",
          "minimum": 1,
          "maximum": 30
        }
      },
      "additionalProperties": false
    }
  },
  "required": [
    "action",
    "tab_id"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `chrome_record_tab_video`

Record video of a tab via chrome.tabCapture + MediaRecorder and upload to cld_files. Args: duration_ms (default 5000, max 60000), audio (default false), tab_id? (defaults to assigned tab), filename?. Returns { ok, file_id, file_url, mime_type, duration_ms, size_bytes }. Requires `tabCapture` optional permission — when missing returns ok:false with a remediation hint pointing the user to Settings → Advanced → Tab video capture.

- **Required permissions:** (none)
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "duration_ms": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 60000,
      "default": 5000
    },
    "audio": {
      "type": "boolean",
      "default": false
    },
    "tab_id": {
      "type": "integer"
    },
    "filename": {
      "type": "string"
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `record_demo`

Record a user demonstration that can later be replayed by the agent. Actions: 'start' (begin recording on a tab; clicks, typed text, submits, navigations, and scrolls are captured automatically as the user demonstrates), 'stop' (save the recording with a name + parameter declarations; sensitive fields like passwords are auto-parameterised), 'discard' (throw away the in-flight recording without saving), 'status' (read; report whether a recording is active and how many steps have been captured). Coach the user: ask them to walk through the workflow, then call stop when they say they're done. Saved demos are replayed via `replay_demo`.

- **Required permissions:** `tabs`, `activeTab`, `scripting`, `storage`, `webNavigation`
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "anyOf": [
    {
      "type": "object",
      "properties": {
        "action": {
          "type": "string",
          "const": "start"
        },
        "tab_id": {
          "type": "integer"
        }
      },
      "required": [
        "action"
      ],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "action": {
          "type": "string",
          "const": "stop"
        },
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        },
        "description": {
          "type": "string",
          "maxLength": 500,
          "default": ""
        },
        "parameters": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "name": {
                "type": "string",
                "minLength": 1
              },
              "description": {
                "type": "string"
              },
              "type": {
                "type": "string"
              },
              "sensitive": {
                "type": "boolean"
              }
            },
            "required": [
              "name"
            ],
            "additionalProperties": false
          },
          "default": []
        }
      },
      "required": [
        "action",
        "name"
      ],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "action": {
          "type": "string",
          "const": "discard"
        }
      },
      "required": [
        "action"
      ],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "action": {
          "type": "string",
          "const": "status"
        }
      },
      "required": [
        "action"
      ],
      "additionalProperties": false
    }
  ],
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `delete_demo`

Delete a saved demo by id. Cannot be undone.

- **Required permissions:** `storage`
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "demo_id": {
      "type": "string",
      "minLength": 1
    }
  },
  "required": [
    "demo_id"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `save_guidance_note`

Save a domain-scoped note for the user (or for yourself on the next visit). The note auto-surfaces in chat context whenever the user opens a tab on this domain. Use for site-specific lessons that don't fit in `remember_for_domain`'s structured hints — full prose explanations, workflow hints, gotchas.

- **Required permissions:** `storage`
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "domain": {
      "type": "string",
      "minLength": 1
    },
    "text": {
      "type": "string",
      "minLength": 1
    },
    "caption": {
      "type": "string"
    },
    "origin_url": {
      "type": "string"
    }
  },
  "required": [
    "domain",
    "text"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `delete_guidance_item`

Delete a saved guidance item by id. Cannot be undone. For demo references, this only removes the guidance index entry — the underlying demo lives in its own storage and must be deleted via `delete_demo`.

- **Required permissions:** `storage`
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "minLength": 1
    }
  },
  "required": [
    "id"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `get_clipboard`

Read the current contents of the system clipboard. Inverse of set_clipboard. Use to consume whatever the user just copied (URL, snippet of text, etc.). Requires the 'clipboardRead' optional permission. The user may need to click on the active page first if the browser refuses for lack-of-focus — when that happens, the result includes a clear `reason` and the agent can ask the user to click the page and try again.

- **Required permissions:** `activeTab`, `scripting`
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "trim": {
      "type": "boolean",
      "default": true
    },
    "max_chars": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 1000000,
      "default": 100000
    }
  },
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `computer`

Mouse, keyboard, and screenshot interactions. Prefer 'ref' over 'coordinate' when targeting elements; coordinates survive poorly across scrolls and layout changes. The 'screenshot' action persists the image to cloud and returns {file_id, file_url, width, height, mime_type} — use that file_id with upload_file or drop_file later. Use wait_for for synchronization, NOT a fixed sleep.

- **Required permissions:** (none)
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "tab_id": {
      "type": "string"
    },
    "action": {
      "type": "string",
      "enum": [
        "left_click",
        "right_click",
        "double_click",
        "triple_click",
        "type",
        "key",
        "scroll",
        "hover",
        "screenshot",
        "left_click_drag",
        "scroll_to",
        "focus",
        "blur"
      ]
    },
    "coordinate": {
      "type": "array",
      "items": {
        "type": "number"
      },
      "minItems": 2,
      "maxItems": 2
    },
    "ref": {
      "type": "string"
    },
    "text": {
      "type": "string"
    },
    "repeat": {
      "type": "integer",
      "minimum": 1,
      "maximum": 100,
      "default": 1
    },
    "modifiers": {
      "type": "string"
    },
    "scroll_direction": {
      "type": "string",
      "enum": [
        "up",
        "down",
        "left",
        "right"
      ]
    },
    "scroll_amount": {
      "type": "integer",
      "minimum": 1,
      "maximum": 10,
      "default": 3
    },
    "start_coordinate": {
      "type": "array",
      "items": {
        "type": "number"
      },
      "minItems": 2,
      "maxItems": 2
    }
  },
  "required": [
    "tab_id",
    "action"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `form_input`

Set the value of a form element by reference. Use string for text inputs, boolean for checkboxes/radios, value or visible label for selects. The handler dispatches on element type — you don't need to specify it.

- **Required permissions:** (none)
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "tab_id": {
      "type": "string"
    },
    "ref": {
      "type": "string"
    },
    "value": {
      "type": [
        "string",
        "number",
        "boolean"
      ]
    }
  },
  "required": [
    "tab_id",
    "ref",
    "value"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `navigate`

Navigate a tab to a URL, or move through history with 'back'/'forward'. Protocol defaults to https:// if omitted. After navigating, refs from prior read_page calls are invalidated — call read_page again before referencing elements.

- **Required permissions:** (none)
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "tab_id": {
      "type": "string"
    },
    "url": {
      "type": "string"
    },
    "force": {
      "type": "boolean",
      "default": false
    }
  },
  "required": [
    "tab_id",
    "url"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `tabs`

Manage browser tabs. Actions: 'list' (all tabs in current window), 'create' (opens new tab; pass url to open at a URL), 'close', 'switch' (brings tab to foreground), 'reload', 'active' (returns the currently active tab — call when you don't know your tab_id), 'info' (full info for a specific tab_id), 'pin' (toggle pin via `on`), 'mute' (toggle mute via `on`), 'duplicate', 'move' (to `index` and optionally `window_id`), 'zoom' (set `zoom_factor`, e.g. 1.5 for 150%). tab_id required for close/switch/reload/info/pin/mute/duplicate/move/zoom.

- **Required permissions:** (none)
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "action": {
      "type": "string",
      "enum": [
        "list",
        "create",
        "close",
        "switch",
        "reload",
        "active",
        "info",
        "pin",
        "mute",
        "duplicate",
        "move",
        "zoom"
      ]
    },
    "tab_id": {
      "type": "string"
    },
    "url": {
      "type": "string"
    },
    "on": {
      "type": "boolean"
    },
    "index": {
      "type": "integer"
    },
    "window_id": {
      "type": "integer"
    },
    "zoom_factor": {
      "type": "number",
      "exclusiveMinimum": 0
    }
  },
  "required": [
    "action"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `downloads`

Manage file downloads. Actions: 'list' (recent downloads with id/filename/url/state/bytes), 'cancel' (abort a pending download), 'confirm' (no-op; Chrome auto-completes downloads), 'download_url' (trigger a download from a URL). download_id required for cancel/confirm; url required for download_url.

- **Required permissions:** (none)
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "action": {
      "type": "string",
      "enum": [
        "list",
        "confirm",
        "cancel",
        "download_url"
      ]
    },
    "download_id": {
      "type": "string"
    },
    "url": {
      "type": "string"
    },
    "filename": {
      "type": "string"
    }
  },
  "required": [
    "action"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `clipboard`

Read from or write to the system clipboard. Actions: 'read' (returns current clipboard text), 'write' (sets clipboard text — pass `text`). Useful for 'copy this for the user' and 'paste what I just copied' workflows.

- **Required permissions:** (none)
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "action": {
      "type": "string",
      "enum": [
        "read",
        "write"
      ]
    },
    "text": {
      "type": "string"
    }
  },
  "required": [
    "action"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `upload_file`

Upload one or more files to a <input type='file'> element by reference. Pass file_ids — these are MediaRef IDs (e.g. from a previous /files/upload, or from computer.action=screenshot). The handler resolves each file_id to bytes and sets the input. Do NOT click file inputs — that opens a native picker the agent cannot see. For drag-and-drop targets, use drop_file instead.

- **Required permissions:** (none)
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "tab_id": {
      "type": "string"
    },
    "ref": {
      "type": "string"
    },
    "file_ids": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1
      },
      "minItems": 1
    }
  },
  "required": [
    "tab_id",
    "ref",
    "file_ids"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `drop_file`

Synthesize a drag-and-drop of a single file onto a target element or coordinate. Use for drop zones that aren't backed by <input type='file'>. Provide ref OR coordinate. file_id is a MediaRef (e.g. from a prior screenshot or upload).

- **Required permissions:** (none)
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "tab_id": {
      "type": "string"
    },
    "file_id": {
      "type": "string"
    },
    "ref": {
      "type": "string"
    },
    "coordinate": {
      "type": "array",
      "items": {
        "type": "number"
      },
      "minItems": 2,
      "maxItems": 2
    },
    "filename": {
      "type": "string"
    }
  },
  "required": [
    "tab_id",
    "file_id"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `chrome_webmcp`

Discover and invoke tools that pages have registered via `navigator.modelContext.registerTool` (Chrome 146+). Actions: 'check' (probe API + count tools), 'list' (enumerate page-registered tools), 'call' (invoke; pass `tool_name` and `arguments`). Admin-only experimental capability.

- **Required permissions:** (none)
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "action": {
      "type": "string",
      "enum": [
        "check",
        "list",
        "call"
      ]
    },
    "tool_name": {
      "type": "string"
    },
    "arguments": {}
  },
  "required": [
    "action"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `tab_groups`

Manage tab groups. Actions: 'list' (returns all groups across windows), 'create' (groups `tab_ids` together; optional `title`/`color`), 'add' (puts more `tab_ids` into existing `group_id`), 'remove' (ungroups `tab_ids`), 'update' (rename/recolor/collapse `group_id`).

- **Required permissions:** `tabs`, `tabGroups`
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "action": {
      "type": "string",
      "enum": [
        "list",
        "create",
        "add",
        "remove",
        "update"
      ]
    },
    "group_id": {
      "type": "integer"
    },
    "tab_ids": {
      "type": "array",
      "items": {
        "type": "integer"
      }
    },
    "title": {
      "type": "string"
    },
    "color": {
      "type": "string",
      "enum": [
        "grey",
        "blue",
        "red",
        "yellow",
        "green",
        "pink",
        "purple",
        "cyan",
        "orange"
      ]
    },
    "collapsed": {
      "type": "boolean"
    }
  },
  "required": [
    "action"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `chrome_recently_closed`

Recently-closed tabs and windows. Actions: 'list' (returns sessions with id/url/title/lastModified), 'restore' (reopens; `session_id` optional — defaults to the most recently closed).

- **Required permissions:** (none)
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "action": {
      "type": "string",
      "enum": [
        "list",
        "restore"
      ]
    },
    "session_id": {
      "type": "string"
    }
  },
  "required": [
    "action"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

## Tier: ask-user (3)

### `user`

Pause and talk to the user. Single tool, six modes via `type`: 'confirm' (yes/no — pass question), 'choice' (single pick — pass question + options[]), 'choice_many' (multi pick — pass question + options[]), 'text' (freeform answer — pass question), 'secret' (masked input for passwords/MFA/API keys — pass question), 'notify' (display a message and optionally collect a single action — pass message; optional actions[] and level). Options accept BOTH bare strings ('Yes', 'No') AND rich objects `{label, description?, preview?}` — preview renders as a code/markdown block beside the focused option for single-select. Optional `header` (≤12 chars) shows as a chip. Optional `context` shows a one-line 'why' on ask types. Optional `allow_other: true` on choice/choice_many appends a freeform 'Other' option. Optional `timeout_seconds` (1..900) auto-resolves with timed_out:true. Optional `timeout_seconds` (1..900) auto-resolves the call with timed_out:true if the user doesn't respond. **Batched questions**: pass `{questions: [SingleQuestion, …]}` (1–4) to ask multiple in one call — renders as a sequence of cards, returns `{answers: Envelope[], cancelled, timed_out}`. Single-question return: `{answer, selected, confirmed, action, freeform, cancelled, timed_out}` — unused fields are null/false. For full keyboard/mouse handoff (CAPTCHA, login), use request_user_takeover. For plan approval, use update_plan.

- **Required permissions:** `notifications`
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "type": {
      "type": "string",
      "enum": [
        "confirm",
        "choice",
        "choice_many",
        "text",
        "secret",
        "notify"
      ]
    },
    "question": {
      "type": "string"
    },
    "header": {
      "type": "string",
      "maxLength": 12
    },
    "options": {
      "type": "array",
      "items": {
        "anyOf": [
          {
            "type": "string",
            "minLength": 1
          },
          {
            "type": "object",
            "properties": {
              "label": {
                "type": "string",
                "minLength": 1
              },
              "description": {
                "type": "string"
              },
              "preview": {
                "type": "string"
              }
            },
            "required": [
              "label"
            ],
            "additionalProperties": false
          }
        ]
      }
    },
    "context": {
      "type": "string"
    },
    "message": {
      "type": "string"
    },
    "actions": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1
      }
    },
    "level": {
      "type": "string",
      "enum": [
        "info",
        "success",
        "warning",
        "error"
      ]
    },
    "allow_other": {
      "type": "boolean"
    },
    "timeout_seconds": {
      "type": "integer",
      "minimum": 1,
      "maximum": 900
    },
    "questions": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "type": {
            "type": "string",
            "enum": [
              "confirm",
              "choice",
              "choice_many",
              "text",
              "secret",
              "notify"
            ]
          },
          "question": {
            "type": "string"
          },
          "header": {
            "type": "string",
            "maxLength": 12
          },
          "options": {
            "type": "array",
            "items": {
              "anyOf": [
                {
                  "type": "string",
                  "minLength": 1
                },
                {
                  "type": "object",
                  "properties": {
                    "label": {
                      "type": "string",
                      "minLength": 1
                    },
                    "description": {
                      "type": "string"
                    },
                    "preview": {
                      "type": "string"
                    }
                  },
                  "required": [
                    "label"
                  ],
                  "additionalProperties": false
                }
              ]
            }
          },
          "context": {
            "type": "string"
          },
          "message": {
            "type": "string"
          },
          "actions": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1
            }
          },
          "level": {
            "type": "string",
            "enum": [
              "info",
              "success",
              "warning",
              "error"
            ]
          },
          "allow_other": {
            "type": "boolean"
          },
          "timeout_seconds": {
            "type": "integer",
            "minimum": 1,
            "maximum": 900
          }
        },
        "required": [
          "type"
        ],
        "additionalProperties": false
      },
      "minItems": 1,
      "maxItems": 4
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `request_user_takeover`

Hand keyboard/mouse control to the user so they can perform an action the agent cannot or should not (logging in, MFA, CAPTCHA, sensitive form filling, decisions only the user can make). The user types/clicks directly into the page; when they're done they signal completion in the UI. The agent should re-read the page after takeover ends to see what changed. Distinct from `user` (Q&A) — this is full page handoff.

- **Required permissions:** (none)
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "reason": {
      "type": "string",
      "minLength": 1
    },
    "expected_action": {
      "type": "string"
    },
    "instructions": {
      "type": "string"
    },
    "tab_id": {
      "type": "string"
    }
  },
  "required": [
    "reason"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `update_plan`

Propose a step-by-step plan and wait for the user to approve, modify, or reject it. Use this BEFORE a multi-step action sequence so you align on intent up front. Returns { approved: true, note?: string } or { approved: false, note?: string } so you can adjust.

- **Required permissions:** (none)
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "title": {
      "type": "string"
    },
    "steps": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1
      },
      "minItems": 1,
      "maxItems": 40
    },
    "approach": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1
      },
      "minItems": 1,
      "maxItems": 40
    },
    "domains": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "reasoning": {
      "type": "string"
    },
    "estimated_minutes": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 240
    },
    "timeout_seconds": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 900
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

## Tier: privileged (30)

### `set_cookie`

Write a cookie. Privileged because it can hijack a user session (CSRF / token-overwrite). Always prompts. Returns the set cookie or { ok:false, reason }.

- **Required permissions:** (none)
- **Surface bundles:** pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "url": {
      "type": "string",
      "format": "uri"
    },
    "name": {
      "type": "string",
      "minLength": 1
    },
    "value": {
      "type": "string"
    },
    "domain": {
      "type": "string"
    },
    "path": {
      "type": "string"
    },
    "secure": {
      "type": "boolean"
    },
    "http_only": {
      "type": "boolean"
    },
    "same_site": {
      "type": "string",
      "enum": [
        "no_restriction",
        "lax",
        "strict",
        "unspecified"
      ]
    },
    "expiration": {
      "type": "integer",
      "minimum": 0
    }
  },
  "required": [
    "url",
    "name",
    "value"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `delete_cookie`

Delete a cookie by url + name.

- **Required permissions:** (none)
- **Surface bundles:** pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "url": {
      "type": "string",
      "format": "uri"
    },
    "name": {
      "type": "string",
      "minLength": 1
    }
  },
  "required": [
    "url",
    "name"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `cdp_attach`

Attach a Chrome DevTools Protocol session to a tab (defaults to active tab). Required before any other cdp_* tool can run on that tab. Chrome will show a "is being debugged" banner while attached. The session auto-cleans up when the agent run ends; you can also call cdp_detach explicitly.

- **Required permissions:** `activeTab`
- **Surface bundles:** pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "tab_id": {
      "type": "integer"
    }
  },
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `cdp_detach`

Close the CDP session on a tab (defaults to active tab). Removes the debug banner.

- **Required permissions:** (none)
- **Surface bundles:** pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "tab_id": {
      "type": "integer"
    }
  },
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `cdp_full_page_screenshot`

Capture the FULL page (not just viewport) as base64. Use instead of take_screenshot for whole-article / long-form pages. Pass a `profile` to optimize for a specific vision model (same profile names as take_screenshot). The tool auto-computes capture_scale so the long edge lands at the profile's target. Returns { ok, media_type, format, image_base64, byte_length, capture_scale, profile, est_tokens }. The `media_type` field is ready to drop into an image content block — the agent server should pass it through verbatim, NOT stringify the whole object.

- **Required permissions:** `activeTab`
- **Surface bundles:** pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "tab_id": {
      "type": "integer"
    },
    "profile": {
      "type": "string",
      "enum": [
        "auto",
        "auto-final",
        "anthropic-default",
        "anthropic-hires",
        "openai-original",
        "openai-high",
        "openai-low",
        "gemini-screenshot",
        "gemini-overview",
        "gemini-2.5-default",
        "ocr-heavy",
        "lossless"
      ],
      "default": "auto"
    },
    "format": {
      "type": "string",
      "enum": [
        "png",
        "jpeg",
        "webp"
      ]
    },
    "quality": {
      "type": "integer",
      "minimum": 1,
      "maximum": 100
    },
    "full_page": {
      "type": "boolean",
      "default": true
    },
    "capture_scale": {
      "type": "number",
      "minimum": 0.1,
      "maximum": 1
    }
  },
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `cdp_a11y_tree`

Dump the accessibility tree of the active tab via Accessibility.getFullAXTree. Each node has { role, name, value, description, properties, children }. Use INSTEAD of read_active_page when you want a clean semantic view of the page — it omits decorative DOM and surfaces aria-roles, button labels, form-field associations directly. Best for vision-free reasoning.

- **Required permissions:** `activeTab`
- **Surface bundles:** pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "tab_id": {
      "type": "integer"
    },
    "max_nodes": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 5000,
      "default": 500
    }
  },
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `cdp_input_click_xy`

Synthesize a real mouse click at viewport coordinates (x, y) via Input.dispatchMouseEvent. Bypasses event-handler shadowing, works through shadow DOM and cross-origin iframes (OOPIFs) — the most reliable click in existence. Use when click_element fails because the page intercepts synthetic clicks.

- **Required permissions:** `activeTab`
- **Surface bundles:** pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "x": {
      "type": "number"
    },
    "y": {
      "type": "number"
    },
    "button": {
      "type": "string",
      "enum": [
        "left",
        "right",
        "middle"
      ],
      "default": "left"
    },
    "click_count": {
      "type": "integer",
      "minimum": 1,
      "maximum": 3,
      "default": 1
    },
    "tab_id": {
      "type": "integer"
    }
  },
  "required": [
    "x",
    "y"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `cdp_input_type`

Type literal text into whatever element currently has focus, via Input.insertText. Fires beforeinput / input / compositionend events correctly so React-controlled inputs accept it. Use after focus_element + when type_into_element fails.

- **Required permissions:** `activeTab`
- **Surface bundles:** pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "text": {
      "type": "string"
    },
    "tab_id": {
      "type": "integer"
    }
  },
  "required": [
    "text"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `cdp_network_capture_start`

Begin capturing every Network event on a tab (default: active). After this, navigate or interact with the page; calls accumulate in a buffer. Use cdp_network_capture_drain to read them. Use cdp_network_capture_stop when finished.

- **Required permissions:** `activeTab`
- **Surface bundles:** pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "tab_id": {
      "type": "integer"
    }
  },
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `cdp_network_capture_drain`

Drain captured Network events from a tab's buffer. Each entry has { request_id, url, method, status, mime_type, request_headers, response_headers, finished, failed, ts_ms }. Use cdp_network_get_body with a request_id to fetch a response body lazily.

- **Required permissions:** (none)
- **Surface bundles:** pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "tab_id": {
      "type": "integer"
    },
    "max": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 2000,
      "default": 100
    },
    "url_contains": {
      "type": "string"
    }
  },
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `cdp_network_capture_stop`

Stop capturing Network events on a tab and clear its buffer.

- **Required permissions:** (none)
- **Surface bundles:** pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "tab_id": {
      "type": "integer"
    }
  },
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `cdp_network_get_body`

Fetch the response body for a captured request, by request_id (from cdp_network_capture_drain). Returns { body, base64_encoded }. Bodies are large so we don't buffer them eagerly.

- **Required permissions:** (none)
- **Surface bundles:** pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "request_id": {
      "type": "string",
      "minLength": 1
    },
    "tab_id": {
      "type": "integer"
    }
  },
  "required": [
    "request_id"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `cdp_print_pdf`

Print a tab to PDF via Page.printToPDF. Returns base64 PDF data. Useful for archival, sharing, or feeding the PDF to a downstream model.

- **Required permissions:** `activeTab`
- **Surface bundles:** pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "tab_id": {
      "type": "integer"
    },
    "landscape": {
      "type": "boolean",
      "default": false
    },
    "print_background": {
      "type": "boolean",
      "default": true
    }
  },
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `cdp_emulate_device`

Override viewport metrics + user agent on a tab. Use to view a page as iPhone Safari, Pixel Chrome, etc., without leaving the user's window. Reset by calling cdp_clear_emulation.

- **Required permissions:** `activeTab`
- **Surface bundles:** pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "tab_id": {
      "type": "integer"
    },
    "width": {
      "type": "integer",
      "minimum": 100
    },
    "height": {
      "type": "integer",
      "minimum": 100
    },
    "device_scale_factor": {
      "type": "number",
      "exclusiveMinimum": 0,
      "default": 2
    },
    "mobile": {
      "type": "boolean",
      "default": true
    },
    "user_agent": {
      "type": "string"
    }
  },
  "required": [
    "width",
    "height"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `cdp_clear_emulation`

Clear device + UA overrides on a tab.

- **Required permissions:** (none)
- **Surface bundles:** pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "tab_id": {
      "type": "integer"
    }
  },
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `read_console_messages`

Read console messages from a tab. Auto-starts CDP console capture if not already running. Filter by level, text regex, or use errors_only=true. Returns { count, messages: [{ level, text, url, line, ts_ms }] }. Console capture stays on until cdp_detach or tab close.

- **Required permissions:** `activeTab`
- **Surface bundles:** pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "tab_id": {
      "type": "string"
    },
    "auto_start": {
      "type": "boolean",
      "default": true
    },
    "limit": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 2000
    },
    "max": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 2000
    },
    "level_filter": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "pattern": {
      "type": "string"
    },
    "errors_only": {
      "type": "boolean",
      "default": false
    },
    "clear": {
      "type": "boolean",
      "default": false
    }
  },
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `read_network_requests`

Read HTTP requests (XHR, fetch, documents, etc.) from a tab. Auto-cleared on cross-domain navigation. Filter with url_pattern to keep output manageable. Response bodies are NOT included by default — use get_request_body to fetch a specific body. The buffer is per-tab and bounded; old entries fall off the back.

- **Required permissions:** (none)
- **Surface bundles:** pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "tab_id": {
      "type": "string"
    },
    "url_pattern": {
      "type": "string"
    },
    "auto_start": {
      "type": "boolean",
      "default": true
    },
    "include_body": {
      "type": "boolean",
      "default": false
    },
    "limit": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 2000,
      "default": 100
    },
    "clear": {
      "type": "boolean",
      "default": false
    }
  },
  "additionalProperties": false,
  "default": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `get_request_body`

Fetch the response body for a specific request seen by read_network_requests. Returns inline text. Pass request_id from a prior drain.

- **Required permissions:** (none)
- **Surface bundles:** pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "tab_id": {
      "type": "string"
    },
    "request_id": {
      "type": "string",
      "minLength": 1
    }
  },
  "required": [
    "request_id"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `execute_javascript`

Run arbitrary JavaScript on a tab. The `code` is wrapped in `async (arg) => { ... }` and executed; whatever it returns is serialized back. Use sparingly — prefer purpose-built tools (click_element, type_into_element, query_elements). This is the unbounded escape hatch when no other tool fits. ALWAYS prompts for approval, even in act-without-asking mode.

- **Required permissions:** `activeTab`, `scripting`
- **Surface bundles:** pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "code": {
      "type": "string",
      "minLength": 1
    },
    "arg": {},
    "main_world": {
      "type": "boolean",
      "default": false
    },
    "tab_id": {
      "type": "integer"
    }
  },
  "required": [
    "code"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `inject_stylesheet`

Inject a CSS stylesheet into the active tab. Use to highlight elements visually for the user, hide noisy chrome, or apply temporary fixes. Privileged because it can mask UI elements. Returns { ok, id? }.

- **Required permissions:** `activeTab`, `scripting`
- **Surface bundles:** pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "css": {
      "type": "string",
      "minLength": 1
    },
    "tab_id": {
      "type": "integer"
    },
    "persist": {
      "type": "boolean",
      "default": false
    }
  },
  "required": [
    "css"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `remove_stylesheet`

Remove a previously-injected stylesheet from a tab. Pass the same CSS string used in inject_stylesheet.

- **Required permissions:** `activeTab`, `scripting`
- **Surface bundles:** pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "css": {
      "type": "string",
      "minLength": 1
    },
    "tab_id": {
      "type": "integer"
    }
  },
  "required": [
    "css"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `set_extension_storage`

Persist a value under the agent's namespaced storage so it survives across runs. Use for "remember that I prefer X", scratchpads, or progress markers between conversations. Privileged because agents shouldn't silently write user data without acknowledgement.

- **Required permissions:** `storage`
- **Surface bundles:** pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "key": {
      "type": "string",
      "minLength": 1
    },
    "value": {},
    "area": {
      "type": "string",
      "enum": [
        "local",
        "session"
      ],
      "default": "local"
    }
  },
  "required": [
    "key"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `desktop_run_command`

Invoke a command on the matrx-local desktop bridge. Available commands depend on what matrx-local exposes (file ops, system info, window control, etc.). Returns { ok, data?, error? }. Fails fast with reason="desktop unavailable" if the bridge isn't connected — check via the desktop:availability channel before calling.

- **Required permissions:** `nativeMessaging`
- **Surface bundles:** pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "command": {
      "type": "string",
      "minLength": 1
    },
    "args": {
      "type": "object",
      "additionalProperties": {}
    }
  },
  "required": [
    "command"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `replay_demo`

Replay a saved demo against a tab. Always requires confirmation — the demo can click, type, submit, and navigate. Pass `dry_run: true` to test selector resolution without taking action. Pass `params` to substitute placeholders (sensitive fields like passwords MUST be supplied this way; the agent should ask the user via `user(type='secret', ...)` first). Returns per-step results with `resolved_via` showing which selector strategy hit.

- **Required permissions:** `tabs`, `activeTab`, `scripting`, `storage`
- **Surface bundles:** pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "demo_id": {
      "type": "string",
      "minLength": 1
    },
    "tab_id": {
      "type": "integer"
    },
    "params": {
      "type": "object",
      "additionalProperties": {
        "type": "string"
      }
    },
    "dry_run": {
      "type": "boolean"
    }
  },
  "required": [
    "demo_id"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `chrome_cookies`

Manage cookies for any domain. Actions: 'get' (read; pass `name` for a specific cookie or omit for all matching), 'set' (write; requires `name` + `value`; optional `domain`/`path`/`expires_in_seconds`/`same_site`/`http_only`/`secure`), 'delete' (requires `name`). Always pass `url` (or `domain` for 'get'). Admin-only.

- **Required permissions:** (none)
- **Surface bundles:** pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "action": {
      "type": "string",
      "enum": [
        "get",
        "set",
        "delete"
      ]
    },
    "url": {
      "type": "string"
    },
    "name": {
      "type": "string"
    },
    "domain": {
      "type": "string"
    },
    "value": {
      "type": "string"
    },
    "path": {
      "type": "string"
    },
    "expires_in_seconds": {
      "type": "integer"
    },
    "same_site": {
      "type": "string",
      "enum": [
        "strict",
        "lax",
        "no_restriction"
      ]
    },
    "http_only": {
      "type": "boolean"
    },
    "secure": {
      "type": "boolean"
    }
  },
  "required": [
    "action",
    "url"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `storage`

Persistent agent-namespaced storage that survives across runs. Distinct from canonical `memory` which is session-scoped (cleared on SW restart). Actions: 'get' (returns value at key), 'set' (writes any JSON-serializable value), 'list' (returns all keys). Use for user preferences, scratchpads, progress markers between conversations.

- **Required permissions:** `storage`
- **Surface bundles:** pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "action": {
      "type": "string",
      "enum": [
        "get",
        "set",
        "list"
      ]
    },
    "key": {
      "type": "string"
    },
    "value": {}
  },
  "required": [
    "action"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `stylesheet`

Inject or remove a CSS stylesheet on the active (or specified) tab. Actions: 'inject' (apply `css`; pass `persistent: true` to survive navigations), 'remove' (drop a previously-injected `css` block — must match exactly).

- **Required permissions:** `activeTab`, `scripting`
- **Surface bundles:** pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "action": {
      "type": "string",
      "enum": [
        "inject",
        "remove"
      ]
    },
    "css": {
      "type": "string",
      "minLength": 1
    },
    "tab_id": {
      "type": "integer"
    },
    "persistent": {
      "type": "boolean"
    }
  },
  "required": [
    "action",
    "css"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `cdp_session`

Manage Chrome DevTools Protocol attachments. Actions: 'attach' (begin debugger session on `tab_id` — required before any other cdp_* tool), 'detach' (end session), 'list' (which tabs are currently attached). Admin + `debugger` permission.

- **Required permissions:** `activeTab`
- **Surface bundles:** pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "action": {
      "type": "string",
      "enum": [
        "attach",
        "detach",
        "list"
      ]
    },
    "tab_id": {
      "type": "integer"
    }
  },
  "required": [
    "action"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `cdp_emulate`

Override viewport / device metrics on an attached CDP tab for responsive testing. Actions: 'set' (apply `width`+`height`+optional `device_scale_factor`/`mobile`/`user_agent`), 'clear' (revert overrides). Tab must be attached via cdp_session first.

- **Required permissions:** `activeTab`
- **Surface bundles:** pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "action": {
      "type": "string",
      "enum": [
        "set",
        "clear"
      ]
    },
    "tab_id": {
      "type": "integer"
    },
    "width": {
      "type": "integer",
      "minimum": 100
    },
    "height": {
      "type": "integer",
      "minimum": 100
    },
    "device_scale_factor": {
      "type": "number",
      "exclusiveMinimum": 0
    },
    "mobile": {
      "type": "boolean"
    },
    "user_agent": {
      "type": "string"
    }
  },
  "required": [
    "action"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `evaluate_javascript`

Evaluate JavaScript in the page context. Returns the value of the last expression — do NOT use 'return' at top level. Admin-gated. Prefer DOM tools (read_page, find, computer, form_input) when possible — JS exec is XSS-equivalent and bypasses our safety nets.

- **Required permissions:** `activeTab`, `scripting`
- **Surface bundles:** pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "text": {
      "type": "string",
      "minLength": 1
    },
    "tab_id": {
      "type": "string"
    },
    "arg": {}
  },
  "required": [
    "text"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```