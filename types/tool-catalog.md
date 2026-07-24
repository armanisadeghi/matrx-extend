# matrx-extend client tool catalog

Generated: 2026-07-24T07:04:36.077Z

- **Total tools:** 166
- **Assistant bundle:** 73 tools (read-only)
- **Pilot bundle:** 137 tools (read + action + ask-user)
- **Pilot+privileged bundle:** 166 tools


## Tier: read (73)

### `list_browser_tools`

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

## Tier: action (61)

### `navigate_active_tab`

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

### `data_patterns`

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
        "describe",
        "recipes",
        "run",
        "save",
        "delete"
      ]
    },
    "pattern_id": {
      "type": "string",
      "format": "uuid"
    },
    "domain": {
      "type": "string"
    },
    "name": {
      "type": "string",
      "minLength": 1,
      "maxLength": 120
    },
    "kind": {
      "type": "string",
      "enum": [
        "manual_css",
        "json_ld",
        "og_meta",
        "auto_table",
        "next_data",
        "ai_extract",
        "list_pattern",
        "microdata",
        "network_capture"
      ]
    },
    "config": {
      "type": "object",
      "additionalProperties": {}
    },
    "fields": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "minLength": 1
          },
          "selector": {
            "type": "string",
            "minLength": 1
          },
          "attr": {
            "type": "string"
          },
          "is_list": {
            "type": "boolean"
          }
        },
        "required": [
          "name",
          "selector"
        ],
        "additionalProperties": false
      },
      "maxItems": 40
    },
    "rows_limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 500
    }
  },
  "required": [
    "action"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### `computer`

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
    },
    "timeout_seconds": {
      "type": "integer",
      "minimum": 1,
      "maximum": 900
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

## Tier: privileged (29)

### `set_cookie`

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

### `inject_stylesheet`

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

### `delete_extension_storage`

- **Required permissions:** (none)
- **Surface bundles:** pilot+privileged

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

### `desktop_run_command`

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
        "list",
        "delete"
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