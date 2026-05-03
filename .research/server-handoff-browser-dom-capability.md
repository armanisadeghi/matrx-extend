# Server handoff — `browser-dom` capability

> Everything the Python `matrx-ai` runtime needs to register the
> capability + discovery handler for matrx-extend (the Chrome extension).
>
> **Source of truth:** [`types/server-handoff/browser-dom-capability.json`](../types/server-handoff/browser-dom-capability.json)
> regenerated on every `pnpm catalog:tools`. Copy values from the JSON,
> not from this doc — the JSON wins on conflict.
>
> **Counts (this generation):** 103 tools across 14 categories. 22 admin-only.
> 19 gated on optional Chrome permissions.

---

## 1. Register the capability

```python
# packages/matrx-ai/matrx_ai/capabilities/built_in.py
class BrowserDomPayload(BaseModel):
    # Identity / state — what page is the user on?
    current_url: str | None
    current_tab_id: int | None
    current_window_id: int | None = None
    page_title: str | None = None
    page_lang: str | None = None
    tab_status: Literal['loading', 'complete', None] = None

    # Surface + privileges — drives which categories are visible to the model
    surface: Literal['assistant', 'pilot']        # 'assistant' = Chat tab, read-only by default
    is_admin: bool                                 # filter admin-only categories
    permission_mode: Literal['ask', 'act']         # client enforces; server uses for prompt hints

    # Hardware capabilities — drives whether desktop / on-device-AI tools are advertised
    desktop_bridge: Literal['native', 'http', 'none']  # matrx-local reachability
    onbox_ai_available: bool                            # chrome.ai (Gemini Nano) exposed?
    optional_permissions_granted: list[str]             # ['debugger', 'cookies', ...]

    # Misc
    open_tab_count: int | None = None
    extension_version: str = ''
    extension_id: str = ''
    loaded_categories: list[str] = []   # categories the agent has discovered this convo

BROWSER_DOM = Capability(
    name="browser-dom",
    payload_model=BrowserDomPayload,
    enabled_tools=(
        RegisteredToolSpec(name="load_browser_tools", delegate=False),
    ),
    requires_auth=True,
)
```

**Recommended always-on tools:** just `load_browser_tools`. Every other tool
loads on demand. The discovery call is cheap (server-side lookup, no LLM
round-trip on the routing decision itself).

The full payload schema is in
[`types/server-handoff/browser-dom-capability.json`](../types/server-handoff/browser-dom-capability.json)
under `payload_schema` — copy it verbatim into a Pydantic model or use the
JSON Schema directly if your validator supports it.

---

## 2. Discovery handler — `load_browser_tools`

### Tool signature

```python
class LoadBrowserToolsArgs(BaseModel):
    category: Literal[
        'core', 'page', 'interact', 'forms', 'tabs', 'history',
        'ai', 'files', 'memory', 'ask', 'advanced',
        'debug', 'cookies', 'webmcp',
    ]
```

### Suggested handler

```python
import json
from pathlib import Path

# Load once at import — drop the JSON next to this file.
_HANDOFF = json.loads(
    Path(__file__).parent.joinpath("browser-dom-capability.json").read_text()
)

CATEGORY_ROUTING: dict[str, list[str]] = _HANDOFF["category_routing"]
TOOL_METADATA: dict[str, dict] = _HANDOFF["tool_metadata"]

ADMIN_ONLY_CATEGORIES = {"debug", "cookies", "webmcp"}


async def load_browser_tools_handler(
    args: LoadBrowserToolsArgs,
    ctx: ToolContext,
) -> ToolResult:
    state = ctx.client_state.get("browser-dom") or {}
    is_admin: bool = bool(state.get("is_admin", False))
    granted: set[str] = set(state.get("optional_permissions_granted") or [])

    # Gate the category itself.
    if args.category in ADMIN_ONLY_CATEGORIES and not is_admin:
        return ToolResult(
            success=False,
            output=f"Category '{args.category}' is admin-only and you are not authorized.",
        )

    candidate_names = CATEGORY_ROUTING.get(args.category, [])

    # Filter individual tools by:
    #   1. admin gate (per-tool, not just per-category)
    #   2. optional Chrome permissions the user has actually granted
    #   3. desktop bridge availability (skip desktop_run_command if 'none')
    desktop_status: str = state.get("desktop_bridge", "none")

    filtered: list[str] = []
    for name in candidate_names:
        meta = TOOL_METADATA.get(name)
        if not meta:
            continue
        if meta.get("admin_only") and not is_admin:
            continue
        req_opt = set(meta.get("required_optional_permissions") or [])
        if req_opt and not req_opt.issubset(granted):
            continue
        if name == "desktop_run_command" and desktop_status == "none":
            continue
        filtered.append(name)

    # Hand the model the new toolset. The orchestrator drains the mutation
    # between turns; the next API call sees `filtered` available.
    ctx.queue_tool_changes(
        add=[RegisteredToolSpec(name=n) for n in filtered],
        # Discovery tool removes itself once it's done its job for this
        # category. The model can re-summon it via load_browser_tools again
        # if it later needs a different category.
        remove=["load_browser_tools"],
    )

    return ToolResult(
        success=True,
        output={
            "category": args.category,
            "tools_loaded": filtered,
            "count": len(filtered),
            "skipped_admin": [n for n in candidate_names if TOOL_METADATA.get(n, {}).get("admin_only") and not is_admin],
            "skipped_missing_perm": [
                n for n in candidate_names
                if (req := set(TOOL_METADATA.get(n, {}).get("required_optional_permissions") or []))
                and not req.issubset(granted)
            ],
        },
    )
```

### Routing snapshot (for review — JSON is authoritative)

| category    | tool count | admin-only? |
|-------------|-----------:|:-----------:|
| `core`      | 9          | –           |
| `page`      | 10         | –           |
| `interact`  | 7          | –           |
| `forms`     | 5          | –           |
| `tabs`      | 18         | –           |
| `history`   | 7          | –           |
| `ai`        | 9          | –           |
| `files`     | 5          | –           |
| `memory`    | 3          | –           |
| `ask`       | 4          | –           |
| `advanced`  | 4          | –           |
| `debug`     | 16         | ✅          |
| `cookies`   | 3          | ✅          |
| `webmcp`    | 3          | ✅          |

`core` is the recommended first call when a fresh agent boots — it surfaces
`browser_batch`, `read_page`, `find`, `take_screenshot`, `navigate_active_tab`,
`click_element`, `type_into_element`, `get_active_tab`, `ask_user`. The model
can reach for any other category from there.

---

## 3. New request shape (extension client)

The extension is updating to:

```json
POST /ai/agent/{agent_id}
{
  "user_input": "summarize this page",
  "conversation_id": null,
  "stream": true,
  "store": true,
  "source_app": "matrx-extend",
  "source_feature": "chat",

  "client": {
    "capabilities": ["browser-dom"],
    "state": {
      "browser-dom": {
        "current_url": "https://example.com/article/42",
        "current_tab_id": 1234,
        "current_window_id": 7,
        "page_title": "Example Article",
        "page_lang": "en",
        "tab_status": "complete",
        "surface": "assistant",
        "is_admin": false,
        "permission_mode": "ask",
        "desktop_bridge": "none",
        "onbox_ai_available": true,
        "optional_permissions_granted": [],
        "open_tab_count": 5,
        "extension_version": "0.1.4",
        "extension_id": "cihdmkcdjjckfhjpgoedmgfpoljebaml",
        "loaded_categories": []
      }
    }
  },

  "context": {
    "user_id": "...",
    "current_time": "...",
    "page_overview": { "url": "...", "title": "...", "og": { ... } },
    "clean_content_markdown": "...",
    "seo_audit": { ... }
    // ... ~50 keys of model-facing facts about the active page.
  },

  "variables": null
}
```

### Notes for the server team

- **`client_tools` is gone.** The extension stops sending it. The capability
  brings `load_browser_tools` online; the model discovers everything else.
- **`context` stays.** It's model-facing data (page markdown, image lists, SEO
  signals, captured links, JSON-LD, scrape provenance, etc.). It's distinct
  from `client.state["browser-dom"]`, which is orchestration metadata for
  the discovery handler. Both should flow to their respective consumers
  unchanged.
- **`loaded_categories`** is a hint — the client tracks it from
  `RESOURCE_CHANGED kind=active_tools` events. The server can use it to
  detect re-discovery patterns, OR ignore it entirely and trust the
  per-request mutation model. Currently informational only.

---

## 4. Live tool-set updates

The extension subscribes to `RESOURCE_CHANGED kind=active_tools` to:
1. Show the user which tools the agent currently has loaded (Tools tab badge).
2. Update `loaded_categories` so subsequent requests can include the hint.

No action needed from the server side beyond emitting the event — same shape
as the React FE brief.

---

## 5. Cross-turn caveat (per the team's note)

Tool mutations are per-request only today. Each new user message restarts
the agent with just `load_browser_tools`. Acceptable for v1: the discovery
call is cheap, and 95% of conversations stay in one category for their
lifetime.

When cross-request persistence ships, no extension changes required —
`loaded_categories` already gives the server the signal it needs to
short-circuit re-discovery.

---

## 6. Quick verification checklist

- [ ] Capability `browser-dom` registered with payload model + always-on `load_browser_tools`.
- [ ] Discovery handler reads `category_routing` from the JSON file.
- [ ] Admin filtering works: `is_admin: false` blocks `debug`/`cookies`/`webmcp` categories.
- [ ] Permission filtering works: `optional_permissions_granted: []` strips all CDP tools from `debug` even when admin.
- [ ] Desktop filtering works: `desktop_bridge: 'none'` strips `desktop_run_command` from `advanced`.
- [ ] `RESOURCE_CHANGED kind=active_tools` event fires on every successful `load_browser_tools` call.

If any check fails, the JSON file at
[`types/server-handoff/browser-dom-capability.json`](../types/server-handoff/browser-dom-capability.json)
has the data. Filter rules are encoded in the `tool_metadata` block —
that's the single piece the handler needs.

---

## 7. Need help / unclear?

- Capability registration: payload model + always-on tools above. 5-min job.
- Routing rule: copy JSON, drop in handler. 10-min job.
- 422 errors: send the request payload back with the validation message —
  the contract is data-driven enough that any mismatch should point at one
  field.

Ping the extension team (or update this doc + open a PR) if anything
diverges from what's described.
