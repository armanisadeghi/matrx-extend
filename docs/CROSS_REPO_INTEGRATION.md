# Cross-Repo Integration Map

> Master integration document for the four-repo Matrx system. This extension
> (matrx-extend) is the hub: it ships agents into the user's browser, calls
> the AI Dream backend for inference, talks to the Matrx Local desktop
> engine for system-level capabilities, and coordinates with the Matrx
> Frontend admin app at aimatrx.com.

This file is the canonical entry point. Sibling repos each carry their own
`MATRX_EXTEND_CONNECTION.md` that mirrors the relevant slice from this doc;
they reference back here for the full topology.

---

## 1. Topology

```
                              ┌─────────────────────────┐
                              │  matrx-frontend         │
                              │  (Next.js 16 admin app, │
                              │   aimatrx.com)          │
                              └───────────┬─────────────┘
                                          │ Channel C
                                          │ externally_connectable +
                                          │ Supabase Broadcast +
                                          │ ?panels deep-link
                                          │ (0% — being built)
                                          │
   ┌──────────────────────┐  Channel A    │
   │  aidream             │ ──────────────┤  ┌──────────────────────┐
   │  (FastAPI backend,   │  capability   ├──│  matrx-extend        │
   │   server.app.matrx-  │  envelope +   │  │  (Chrome extension,  │
   │   server.com)        │  unified tool │  │   this repo, hub)    │
   │                      │  merge        │  └───────────┬──────────┘
   └──────────────────────┘  (~85% prod)  │              │
                                          │              │ Channel B
                                          │              │ /extension/rpc +
                                          │              │ WS reverse-push +
                                          │              │ ~/.matrx/local.json
                                          │              │ (0% verified;
                                          │              │  fixes in flight)
                                          │              │
                                          │              ▼
                                          │  ┌──────────────────────┐
                                          │  │  matrx-local         │
                                          └──┤  (Tauri v2 desktop:  │
                       Channel D              │   Rust shell + Py   │
                       (out of scope here:    │   FastAPI sidecar)  │
                        Supabase substrate    └──────────────────────┘
                        when it lands)
```

All three Matrx clients (extension, frontend, desktop) share Supabase
project `txzxabzwovsujtloxrus`. That gives any pair a free Realtime
substrate (Broadcast, Presence, Postgres Changes) without a new server
component. Reusable JWTs cross every boundary.

---

## 2. Channel inventory

### Channel A — matrx-extend ↔ aidream

| Field | Value |
|---|---|
| Status | ~85% shipped, in production |
| Direction | Bidirectional. Extension streams chat to aidream; aidream injects tool descriptors into the LLM and emits `tool_started` / `tool_result` events back over SSE. |
| Substrates | HTTPS POST + SSE stream over `https://server.app.matrxserver.com/ai/agent/{agent_id}` |
| Wire format | Capability envelope: `client.capabilities=["browser-dom"]` plus `client.state["browser-dom"]={current_url, is_admin, permission_mode, optional_permissions_granted, ...}` |
| Discovery | Always-on tool `load_browser_tools(category)` returns category-scoped tool descriptors via `ctx.queue_tool_changes(add=[...], remove=["load_browser_tools"])` |
| Cross-turn persistence | Deferred upstream — aidream's `cx_conversation.dynamic_tool_state` is Phase D-persist in `TOOL_INJECTION_REFACTOR.md`. Each user message currently restarts with `[load_browser_tools]`. |
| Extension-side reference files | `src/lib/tools/aliases.ts`, `src/lib/tools/registry.ts`, `src/lib/tools/dispatch.ts`, `src/lib/tools/handlers/*.ts`, `src/lib/chat/context/v2-bundled.ts` |
| aidream-side reference files | `aidream/api/utils/tool_merge.py::apply_unified_tools`, `packages/matrx-ai/matrx_ai/capabilities/browser_dom.py` (+ JSON metadata), `packages/matrx-ai/matrx_ai/tools/implementations/browser_discovery.py` |

### Channel B — matrx-extend ↔ matrx-local

| Field | Value |
|---|---|
| Status | 0% verified. Only `health` round-trips. |
| Direction | Bidirectional. Extension calls `/extension/rpc`; engine pushes events over a WebSocket. |
| Substrates | HTTP POST `/extension/rpc` (request/response) + WebSocket (reverse-push, currently unused by extension) |
| Port discovery | Engine listens on the first free port in 22140–22159 and writes the chosen one to `~/.matrx/local.json`. **The extension currently hardcodes 22180** in `src/lib/desktop/http.ts` (via `ENV.DESKTOP_LOCAL_URL`) — that is the active bug. |
| Tools called | `desktop_run_command` (privileged tier, src/lib/tools/handlers/privileged.ts:212-226). Zero callsites in the extension today. |
| RPC support today | `/extension/rpc` only handles `health`. The dispatcher in `app/tools/dispatcher.py::dispatch` is wired but the route does not yet hand off to it for non-health methods. |
| Extension-side reference files | `src/lib/desktop/http.ts`, `src/lib/desktop/types.ts`, `src/lib/tools/handlers/privileged.ts` |
| matrx-local-side reference files | `app/api/extension_routes.py`, `app/tools/dispatcher.py`, `app/websocket_manager.py` (`broadcast()`, `broadcast_notification()`) |

### Channel C — matrx-extend ↔ matrx-frontend

| Field | Value |
|---|---|
| Status | 0% with traps. Extension manifest has no `externally_connectable` block. Both sides ship fake-bridge scaffolding. WebMCP scaffolding (`src/lib/webmcp/register.ts`) is incomplete: no page-side dispatcher, no callsites for `registerToolsOnActiveTab()`. |
| Direction | Bidirectional. Same-machine: page → extension via `chrome.runtime.sendMessage` on the whitelisted origin. Cross-machine: Supabase Broadcast on channel `matrx-extension-bridge:<userId>`. |
| Substrates | (a) `externally_connectable` direct messaging, (b) Supabase Realtime Broadcast, (c) URL deep-link `?panels=<typeKey>:<instanceId>` to trigger UI overlays. |
| `externally_connectable` whitelist | `https://*-armani-sadeghis-projects.vercel.app/*`, `https://*.aimatrx.com/*`, `https://*.mymatrx.com/*`, `http://localhost/*`, `http://127.0.0.1/*` |
| Broadcast payload shape | `{ direction, action, requestId, payload, timestamp }` |
| Conversation-message-append API | None on frontend today. |
| Extension-side reference files | `src/lib/webmcp/register.ts` (incomplete — no page-side dispatcher) |
| Frontend-side reference files | `lib/supabase/messaging.ts` (production-ready), the window-panels deep-link parser |

### Channel D — matrx-local ↔ matrx-frontend

Out of primary scope for this map. Documented for completeness only: when
this channel is built, the shared Supabase project (`txzxabzwovsujtloxrus`)
will be the natural substrate — Broadcast for control-plane chatter and
Postgres Changes for state sync. No work in this repo depends on it.

---

## 3. Ground-truth file index

The single canonical list of files that define each channel. Open these
first when investigating cross-repo behavior.

**matrx-extend (this repo):**
- `src/lib/tools/aliases.ts` — wire-format aliasing for capability tools
- `src/lib/tools/registry.ts` — central tool registry / `lookup(name)`
- `src/lib/tools/dispatch.ts` — SW dispatcher
- `src/lib/tools/handlers/privileged.ts` (lines 212–226 are `desktop_run_command`)
- `src/lib/desktop/http.ts` — desktop bridge HTTP client (currently hardcoded port — bug)
- `src/lib/desktop/types.ts` — desktop RPC shapes
- `src/lib/webmcp/register.ts` — WebMCP scaffolding (incomplete)
- `src/lib/chat/context/v2-bundled.ts` — canonical context shape

**aidream:**
- `aidream/api/utils/tool_merge.py::apply_unified_tools` — capability-envelope unified tool merge
- `packages/matrx-ai/matrx_ai/capabilities/browser_dom.py` — capability definition + metadata JSON
- `packages/matrx-ai/matrx_ai/tools/implementations/browser_discovery.py` — `load_browser_tools` server-side handler

**matrx-local:**
- `app/api/extension_routes.py` — `/extension/rpc` route (currently `health`-only)
- `app/tools/dispatcher.py::dispatch` — dispatcher entry point (wired but unrouted)
- `app/websocket_manager.py` — `broadcast()`, `broadcast_notification()`

**matrx-frontend:**
- `lib/supabase/messaging.ts` — Broadcast bridge (production-ready)
- The window-panels deep-link parser (handles `?panels=<typeKey>:<instanceId>`)

---

## 4. Discovery primitives

The four small things every cross-repo task touches:

- **Desktop port discovery** — `~/.matrx/local.json` (JSON file written by
  matrx-local on startup). Schema includes the active port chosen from
  the 22140–22159 scan range. Extension must probe-and-cache, not hardcode.
- **Capability envelope** — `client.capabilities` (string[]) plus
  `client.state[<capability>]` (small orchestration metadata, ~12 keys for
  `browser-dom`). Sent in every chat request. aidream uses it to decide
  which tools to advertise to the LLM.
- **`externally_connectable` whitelist** — see Channel C above. Manifest
  v3 does not accept port wildcards; whitelist explicit hosts only.
- **Shared Supabase project ref** — `txzxabzwovsujtloxrus`. All three
  Matrx clients authenticate against this project; JWTs are reusable across
  boundaries; Broadcast/Realtime is a free cross-machine substrate.

---

## 5. Production URL map

| URL | Role |
|---|---|
| `aimatrx.com` | Production Next.js frontend (Vercel, with aliases) |
| `mymatrx.com` | Public share surface for HTML |
| `server.app.matrxserver.com` | Main backend (aidream) |
| `admin.app.matrxserver.com` | Vite admin |
| `studio.app.matrxserver.com` | Workflow studio |
| `cdn.matrxserver.com` | Cloudflare CDN |
| `mcp.aimatrx.com` | Python MCP host |
| `seo-mcp.matrxserver.com` | Cloudflare worker MCP |

**FORBIDDEN domains — do not reference these in any code, doc, or config.
Flag any existing references and replace them with the correct production
URL above:**

- `m a t r i x . c o m` (NOT a Matrx domain — collides with an unrelated
  chat protocol and is unowned by us; remove the spaces when searching)
- `m a t r x . a p p` (legacy / never-shipped — never use; remove the
  spaces when searching)

(The two FORBIDDEN names are written with spaces above so this doc itself
does not match a `grep` for the bad substrings. Treat the de-spaced forms
as the literal blocklist.) If you find a reference to either of these
in source, configuration, documentation, comments, or tests, treat it
as a bug and replace it.

---

## 6. How to start work in a sibling repo

When the task crosses a boundary, switch to the sibling repo and read its
matching connection doc and skill before writing code. The sibling docs
mirror the slice of this map relevant to that side.

- **aidream** (Channel A, server side):
  - `/Users/armanisadeghi/code/aidream/MATRX_EXTEND_CONNECTION.md`
  - `/Users/armanisadeghi/code/aidream/.claude/skills/connect-matrx-extend/`
- **matrx-local** (Channel B, desktop side):
  - `/Users/armanisadeghi/code/matrx-local/docs/MATRX_EXTEND_CONNECTION.md`
  - `/Users/armanisadeghi/code/matrx-local/.cursor/skills/connect-matrx-extend/`
- **matrx-frontend** (Channel C, web side):
  - `/Users/armanisadeghi/code/matrx-frontend/docs/MATRX_EXTEND_CONNECTION.md`
  - `/Users/armanisadeghi/code/matrx-frontend/.claude/skills/connect-matrx-extend/`

When working **inside** this repo on outbound calls to a sibling, invoke
the matching outbound skill — these live in this repo's `.claude/skills/`:

- **`.claude/skills/connect-aidream/SKILL.md`** — outbound to aidream
  (capability envelope, browser_dom pattern, when to extend a server
  capability vs. inject inline tools).
- **`.claude/skills/connect-local/SKILL.md`** — outbound to matrx-local
  (port discovery, `/extension/rpc` envelope, WebSocket reverse-push
  consumption).
- **`.claude/skills/connect-frontend/SKILL.md`** — outbound to
  matrx-frontend (`externally_connectable` constraints, Supabase Broadcast
  channel naming, window-panels deep-link).

The six skills (3 outbound here + 3 inbound in siblings) form the full
cross-repo skill matrix. Each skill is self-contained — an agent only
needs the one for the direction it's working in.

---

## 7. Out of scope

The following are intentionally not addressed in this map. Each has a
separate roadmap item or is upstream-only.

- **Channel D (matrx-local ↔ matrx-frontend)** — not active today; will
  ride the shared Supabase project when built.
- **Cross-turn tool persistence on aidream** — Phase D-persist in
  `TOOL_INJECTION_REFACTOR.md`. Upstream-only; no extension changes
  needed when it lands.
- **Native messaging host for desktop port discovery** — alternative to
  `~/.matrx/local.json` probe-and-cache. Future work; the file-based
  approach is the immediate path.
- **Cross-machine routing UI flag** — when the extension and the desktop
  engine are on different machines, the user should see and confirm that
  routing. Not built; tracked separately.
