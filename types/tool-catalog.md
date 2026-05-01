# matrx-extend client tool catalog

Generated: 2026-05-01T00:11:49.153Z

- **Total tools:** 96
- **Assistant bundle:** 36 tools (read-only)
- **Pilot bundle:** 76 tools (read + action + ask-user)
- **Pilot+privileged bundle:** 96 tools


## Tier: read (36)

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

Capture the visible viewport of the active tab as a base64 PNG (or JPEG). Returns { format, image_base64 }. Useful for vision-capable models or for archival.

- **Required permissions:** `activeTab`
- **Surface bundles:** assistant, pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "format": {
      "type": "string",
      "enum": [
        "png",
        "jpeg"
      ],
      "default": "png"
    },
    "quality": {
      "type": "integer",
      "minimum": 1,
      "maximum": 100
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

Search visible text on the active tab and return matches with their nearest enclosing element selector + context. Pass regex=true to use a regular expression. Use this when read_active_page would be overkill — e.g. "where on this page does it say 'click here to download'?".

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

## Tier: action (36)

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

Click the element matching a CSS selector on the active tab. Use query_elements first to find the right selector. Returns { ok, text, tag } or { ok:false, reason }.

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
    "nth": {
      "type": "integer",
      "minimum": 0,
      "default": 0
    }
  },
  "required": [
    "selector"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `type_into_element`

Set the value of an input / textarea / contenteditable matched by a CSS selector. By default, clears the field first and dispatches input + change events so frameworks (React, Vue, etc.) detect the update.

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
    "selector",
    "text"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `scroll_page`

Scroll the active tab. direction="top"/"bottom" go to extremes; "into-view" scrolls a CSS-selector match into view; "by" scrolls by delta_y pixels.

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

### `press_keys`

Send keyboard input to a page. Pass either a literal string ("hello world") or named keys/chords ("Enter", "Control+A", "Tab", "ArrowDown ArrowDown Enter"). When `selector` is provided the tool focuses that element first. Useful for triggering submit-on-Enter, navigating menus, dismissing dialogs, and using app keyboard shortcuts.

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

Trigger hover on an element by dispatching mouseenter/mouseover/mousemove events. Use this to reveal hover-only tooltips, dropdown menus, or sub-navigation that only appear when the cursor is over a parent.

- **Required permissions:** `activeTab`, `scripting`
- **Surface bundles:** pilot, pilot+privileged

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

### `focus_element`

Move keyboard focus to an element (calls .focus() and scrolls it into view). Use before press_keys when no selector is supplied.

- **Required permissions:** `activeTab`, `scripting`
- **Surface bundles:** pilot, pilot+privileged

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
    }
  },
  "required": [
    "selector"
  ],
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
  "required": [
    "selector"
  ],
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
    "checked": {
      "type": "boolean"
    }
  },
  "required": [
    "selector",
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
  "required": [
    "selector"
  ],
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

### `notify_user`

Show a system notification to the user. Use after a long-running task finishes (especially useful when the side panel is hidden). The user can click to focus the extension.

- **Required permissions:** `notifications`
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "title": {
      "type": "string",
      "minLength": 1
    },
    "message": {
      "type": "string",
      "minLength": 1
    },
    "icon": {
      "type": "string"
    },
    "require_interaction": {
      "type": "boolean",
      "default": false
    }
  },
  "required": [
    "title",
    "message"
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

### `save_page_as_mhtml`

Snapshot a tab as a self-contained MHTML archive (HTML + every resource inlined). Returns base64 MHTML data. Use for: archival, sharing a frozen page, feeding the agent a stable snapshot it can reanalyze later.

- **Required permissions:** `activeTab`
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

## Tier: ask-user (4)

### `ask_user`

Ask the human a freeform question. Use this when you need information only the user has (e.g. "Which date should I book?"). Returns { answer } or { cancelled: true } if they dismiss.

- **Required permissions:** (none)
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "question": {
      "type": "string",
      "minLength": 1
    },
    "why": {
      "type": "string"
    },
    "timeout_ms": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 900000,
      "default": 300000
    }
  },
  "required": [
    "question"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `ask_user_choice`

Ask the human to pick one of N options. Cleaner than ask_user when the answer is bounded. Returns { answer } (the chosen string) or { cancelled: true }.

- **Required permissions:** (none)
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "question": {
      "type": "string",
      "minLength": 1
    },
    "choices": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1
      },
      "minItems": 2,
      "maxItems": 20
    },
    "why": {
      "type": "string"
    },
    "timeout_ms": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 900000,
      "default": 300000
    }
  },
  "required": [
    "question",
    "choices"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `ask_user_secret`

Ask the human for a secret value (e.g. a one-time code, last 4 of a card). Input is masked in the UI. The answer flows through the model exactly once and is NOT persisted in the conversation. Returns { answer } or { cancelled: true }.

- **Required permissions:** (none)
- **Surface bundles:** pilot, pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "prompt": {
      "type": "string",
      "minLength": 1
    },
    "why": {
      "type": "string"
    },
    "timeout_ms": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 900000,
      "default": 300000
    }
  },
  "required": [
    "prompt"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `request_user_takeover`

Pause the agent and hand control back to the human (e.g. for CAPTCHA, login, payment, or anything tricky for an automated browser). The user signals when they're done and the agent resumes. Returns { resumed: true, note?: string }.

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
    "instructions": {
      "type": "string",
      "minLength": 1
    }
  },
  "required": [
    "reason",
    "instructions"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

## Tier: privileged (20)

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

Capture the FULL page (not just viewport) as base64. CDP's Page.captureScreenshot with captureBeyondViewport. Use this instead of take_screenshot when the user asks "give me a picture of the whole article" or you need to OCR a long form. Returns { format, image_base64, byte_length }.

- **Required permissions:** `activeTab`
- **Surface bundles:** pilot+privileged

```json
{
  "type": "object",
  "properties": {
    "tab_id": {
      "type": "integer"
    },
    "format": {
      "type": "string",
      "enum": [
        "png",
        "jpeg",
        "webp"
      ],
      "default": "png"
    },
    "quality": {
      "type": "integer",
      "minimum": 1,
      "maximum": 100,
      "default": 85
    },
    "full_page": {
      "type": "boolean",
      "default": true
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