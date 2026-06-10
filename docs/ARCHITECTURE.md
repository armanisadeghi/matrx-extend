# Matrx Extend — Architecture

A high-level map of how the extension is wired. Read this first when something behaves unexpectedly; the answer is almost always in one of the seams between contexts.

## Contexts

Every Chrome MV3 extension has multiple JavaScript runtimes. Ours has five:

| Context | Lifetime | Has DOM? | Has `chrome.identity`? | Purpose |
|---|---|---|---|---|
| **Service worker** (background.ts) | Wakes on event, killed after ~30s idle | No | Yes | Auth-token refresh alarm, message router, desktop probe, scrape queue polling |
| **Sidepanel** (sidepanel.html) | While open in side panel | Yes | Yes | Primary UI — Chat / Tasks / Scrape / Data / SEO / Settings / Debug |
| **Popup** (popup.html) | Open while clicked | Yes | Yes | Quick actions: open side panel, sign in/out |
| **Options page** (options.html) | While open in tab | Yes | Yes | Mirror of Settings tab |
| **Offscreen document** (offscreen.html) | Created on demand by SW, persists for declared reason | Yes | No | Holds long-running fetch streams that would die in the SW |
| **Content script** (content.ts, data-picker.content.ts) | Runs in page context | Yes (page DOM) | No | Scrape pipeline, SPA navigation hints, data picker overlay |

The SW is the *only* context that's persistent across all surfaces but volatile in time. The sidepanel is the opposite — alive only while open, but never killed mid-task. The offscreen doc bridges the gap for streaming.

## Cross-context messaging

We don't use webext-bridge — its `window` entry is for content scripts in main-world isolation, and there's no `sidepanel` entry. Instead we use native `chrome.runtime.sendMessage` with a thin typed wrapper at `src/lib/messaging/native.ts`.

Wire format: `{ __matrx: true, kind: string, payload: unknown }`. Receivers filter by `kind` and ignore anything missing the `__matrx` discriminator.

### Channel registry (`src/lib/messaging/schemas.ts`)

```
sidepanel ──STREAM_START──▶ SW
SW        ──STREAM_RUN────▶ offscreen     (different kind to avoid SW catching its own broadcast)
offscreen ──STREAM_CHUNK──▶ all surfaces
sidepanel ──STREAM_CANCEL─▶ SW
SW        ──STREAM_KILL───▶ offscreen
content   ──PAGE_NAVIGATED▶ SW
SW        ──PAGE_ALREADY_CAPTURED──▶ all
all       ──AUTH_STATE_CHANGED────▶ all
SW        ──DESKTOP_AVAILABILITY──▶ all
sidepanel ──DESKTOP_RPC────▶ SW
content   ──DATA_PICKER_RESULT/EXIT──▶ all
sidepanel ──SCRAPE_CAPTURE──▶ content (via chrome.tabs.sendMessage)
```

**SW handlers must be registered synchronously at top-level** so they're alive on first wake. See `bootstrapBackground()` in [src/lib/background/bootstrap.ts](../src/lib/background/bootstrap.ts), called synchronously from `entrypoints/background.ts`.

## Auth flow

PKCE OAuth 2.1 against the Matrx Supabase project, mirroring matrx-local desktop:

1. Side panel calls `signIn()` → generates `code_verifier` + `code_challenge`, encodes verifier into `state` (`<verifier>.<nonce>`)
2. Opens `chrome.identity.launchWebAuthFlow(authorize_url)` with `scope=email profile` (NEVER `openid` — Supabase HS256 can't sign ID tokens)
3. User signs in / approves on the aimatrx.com-branded consent screen
4. Supabase redirects to `https://<extension-id>.chromiumapp.org/?code=…&state=…`
5. SW recovers `code_verifier` from echoed state, POSTs to `/auth/v1/oauth/token` (no client_secret — public PKCE)
6. Tokens stored: access in `chrome.storage.local`, refresh AES-GCM-encrypted via WebCrypto
7. `chrome.alarms` schedules refresh ~5 min before expiry
8. **Admin check**: `select user_id from public.admins where user_id = auth.uid()` → cached in `chrome.storage.local` as `matrx.user.isAdmin`

Auth runs in the **sidepanel context**, not the SW. `chrome.identity` works there and we sidestep the SW message-handler race that would otherwise leave us spinning forever waiting for the auth flow to dispatch.

The Supabase JS client is created with `persistSession: false` and `autoRefreshToken: false` because supabase-js's auto-refresh is unsafe in any context where the runtime might be killed mid-flight (the SW). We drive refresh ourselves via `chrome.alarms`. After sign-in **or** on app start, `restoreSupabaseSession()` reads the stored tokens and calls `supabase.auth.setSession()` so RLS sees `auth.uid()`.

### Five hard-won facts (from matrx-oauth/SKILL.md)

1. **Public PKCE client. Never send `client_secret`** — Supabase rejects with 400.
2. **Drop `openid` scope** — HS256 can't mint ID tokens.
3. **Supabase 4xx error bodies are inconsistent** — try `error_description`, `error_message`, `msg`, `error`, `code`.
4. **Read the callback URL exactly once** — `chrome.identity` hands it back synchronously, but reactive frameworks can re-read after `replaceState` strips the token.
5. **`.gitignore` `lib/` rule swallows TS source** — pre-empted with `!src/lib/**` allow rule.

## Streaming pipeline

The Matrx FastAPI backend streams **NDJSON** (one JSON object per line, `\n`-separated). Not SSE. Compact form `{e: "c", t: "..."}` is normalized to `{event: "chunk", data: {text: "..."}}` via `expandCompactEvent()` from the generated types.

Flow for a chat message:

```
sidepanel: useChatStream.send("hi", { agentId })
  ├─ pushes user + placeholder assistant message
  ├─ generates runId
  └─ send(STREAM_START, { runId, endpoint, body, parser })

SW: STREAM_START handler → startStream()
  ├─ resolves baseUrl (via chrome.storage.local) and Authorization header
  ├─ ensureOffscreen() → chrome.offscreen.createDocument({reasons: ['BLOBS']})
  └─ send(STREAM_RUN, { runId, url, headers, body, parser })

offscreen: STREAM_RUN handler → streamFetch()
  ├─ POST url with headers/body
  ├─ For each \n-delimited JSON line:
  │   ├─ log raw event
  │   ├─ expandCompactEvent if compact
  │   └─ broadcast(STREAM_CHUNK, { runId, type: 'text'|'reasoning'|'event'|'error'|'done', payload })
  └─ Always broadcasts {type: 'done'} at end (success or failure)

sidepanel: STREAM_CHUNK listener (in useChatStream)
  ├─ Filters by runId
  ├─ 'text' → appends to assistant message
  ├─ 'reasoning' → logs (chat UI doesn't render yet)
  ├─ 'error' → appends inline error
  └─ 'done' → finalizes assistant, setStreaming(false)
```

Why this dance: MV3 service workers are killed after ~30s idle. A long agent run easily exceeds that. The offscreen document declares a `BLOBS` reason and persists for the duration, holding the fetch reader alive across SW kills.

## Data layer

### Supabase direct reads (RLS-gated)

The extension reads from Supabase directly using the user's JWT, never via the FastAPI backend. RLS policies on each table enforce ownership.

| Table | Read by | Notes |
|---|---|---|
| `agx_agent` | Chat tab agent picker | filter `user_id = me OR is_public = true` (RLS still enforces) |
| `cx_conversation`, `cx_message` | Chat history | filter `deleted_at is null AND status = 'active'` |
| `admins` | App start admin check | one row per admin `(user_id)` |
| `wbx_capture` | Scrape recognition + save | extension-owned, RLS gated by `user_id = auth.uid()` |
| `wbx_pattern` | Data tab patterns | extension-owned |
| `wbx_seo_audit` | SEO tab persistence | extension-owned |

### FastAPI endpoints (backend-routed)

| Endpoint | Use |
|---|---|
| `GET /health/` | Health check (app start, env switch, manual button) |
| `POST /ai/agent/{agent_id}` | Stream agent execution (NDJSON) |
| `GET /research/extension/scrape-queue` | Tasks tab queue |
| `POST /research/topics/{id}/sources/{id}/extension-content` | Submit captured HTML |
| `GET /schema/all` | Type sync (`pnpm update-api-types`) |

### Generated types

`pnpm update-api-types` populates `types/python-generated/`:

- `openapi.json` — OpenAPI 3 spec (252 routes, 189 schemas as of Apr 2026)
- `api-types.ts` — TypeScript types from openapi-typescript
- `stream-events.ts` — typed NDJSON event union with type guards
- `stream-events.schema.json` — JSON Schema mirror
- `llm-params*.{json,ts}` — model config

The script at [scripts/update-api-types.mjs](../scripts/update-api-types.mjs) wraps `aidream/scripts/sync-types.mjs` and runs `tsc --noEmit` afterward to catch drift.

## Backend URL switching

Resolution order in `getApiBaseUrl()`:

1. `WXT_BACKEND_URL` env var (build-time hard override)
2. `chrome.storage.local['matrx.backend.urlOverride']` (custom URL pasted in Debug tab)
3. `chrome.storage.local['matrx.backend.env']` mapped via `BACKEND_URLS` (`prod` / `staging` / `dev` / `local`)
4. `WXT_DEFAULT_BACKEND` env default

Result is cached in module memory. `clearApiBaseCache()` is called from the env-switch handlers so the next request picks up the new URL.

The Debug tab top bar exposes the dropdown + free-text override + `→ resolved-url` chip + manual ping button. Switching fires a health check immediately.

We use `chrome.storage.local` (not `.sync`) because **`chrome.storage.sync` is undefined in the offscreen document** in some Chrome configurations. `.local` is available everywhere.

## Admin gating

A single row in `public.admins` makes you an admin. The check happens:

1. **After sign-in** — `checkIsAdmin(user.id)` runs immediately, result stored in `chrome.storage.local['matrx.user.isAdmin']`
2. **On app start** — cached value loads instantly; a fresh check runs in the background to catch grants/revokes

Admin gates are applied at three levels:

- **UI**: Debug tab is omitted from the App's tab list when `!isAdmin`
- **Cross-context relay**: `src/lib/debug/log.ts` reads `matrx.user.isAdmin` from storage and only forwards events between contexts when the flag is true. Non-admin SW/offscreen logs stay in their own console.
- **Future expansion**: any "advanced" toggle anywhere should read `useAuth().isAdmin` first

The flag updates live via `chrome.storage.onChanged` — granting an admin role takes effect on the next event, no reload needed.

## Debug tab (admin-only)

Located at [src/features/debug/DebugView.tsx](../src/features/debug/DebugView.tsx). What it shows:

- **Backend switcher** (env dropdown + URL override + manual health ping)
- **Live event log** — search, source/level filters, pause/resume tail, copy-all, download .log, clear
- **Per-event inline JSON expansion** — click a row to see full payload (request bodies, response bodies, error stacks, raw stream chunks)
- **Cross-context** — logs from SW, offscreen, content scripts all relay here

Sources used in code:

| Source | What logs there |
|---|---|
| `auth` | Sign-in, sign-out, session restore, token refresh |
| `api` | Every fetch (method, path, status, ms) |
| `stream` | Stream lifecycle + every raw chunk + dispatch |
| `scrape` | Page capture pipeline |
| `desktop` | Native messaging / localhost HTTP probe + RPC |
| `supabase` | Direct DB reads (when something errors) |
| `sw` | Service worker bootstrap, alarms |
| `msg` | Every cross-context message send/receive/reply |
| `ui` | UI-side logs |
| `sys` | Module mounts, lifecycle |

## File layout

```
src/
├── config/env.ts                 # build-time env, runtime overrides, storage keys
├── entrypoints/
│   ├── background.ts             # SW: synchronous bootstrap
│   ├── sidepanel/                # primary UI
│   ├── popup/, options/, offscreen/
│   ├── content.ts                # scrape capture, SPA nav hints
│   └── data-picker.content.ts    # runtime-injected only
├── lib/
│   ├── auth/                     # PKCE flow, AES-GCM crypto, types
│   ├── api/                      # client + stream + per-route modules
│   ├── supabase/                 # client + RLS-gated queries (incl. checkIsAdmin)
│   ├── desktop/                  # bridge facade + native + http transports
│   ├── messaging/                # native chrome.runtime wrapper + channel registry
│   ├── scrape/                   # pipeline + collectors
│   ├── data-pattern/             # picker, runner, matcher
│   ├── seo/                      # audit collector
│   ├── stream/                   # SW <-> offscreen orchestrator
│   ├── debug/                    # event log store + admin-gated relay
│   ├── storage/                  # chrome.storage helpers + zustand adapter
│   └── background/               # SW bootstrap
├── state/                        # Zustand stores
├── components/
│   ├── ui/                       # shadcn/ui primitives
│   ├── AuthGate.tsx, UserMenu.tsx
├── features/{chat,tasks,scrape,data,seo,settings,debug}/
└── hooks/
```

See also:
- [docs/AUTH.md](AUTH.md) — OAuth + admin gating in depth
- [docs/STREAMING.md](STREAMING.md) — NDJSON parser + offscreen orchestration
- [docs/DEBUG.md](DEBUG.md) — using the Debug tab for triage
- [matrx-oauth/SKILL.md](../matrx-oauth/SKILL.md) — full OAuth playbook + gotchas
