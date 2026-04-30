# Debug tab — admin-only triage console

## Visibility

Debug tab is rendered **only** when `useAuth().isAdmin === true`, i.e. there's a row in `public.admins` for the signed-in user. Non-admins:

- Don't see the bug icon in the tab strip
- Don't have cross-context log forwarding (SW/offscreen logs stay in their own DevTools console)
- Don't pay any extension-bandwidth cost for telemetry

The flag is cached in `chrome.storage.local['matrx.user.isAdmin']` and refreshed in the background on every app start. If admin status changes (granted / revoked), it flips live without a reload.

## Layout

```
┌─────────────────────────────────────────────────────────────┐
│ api  [prod ▼]  [custom URL...]   [⚡]    → resolved-url    │ ← BackendSwitcher
├─────────────────────────────────────────────────────────────┤
│ [Search…]              123/450  3 err  [⏸] [📋] [⬇] [🗑]    │ ← Toolbar
├─────────────────────────────────────────────────────────────┤
│ src: [auth] [api] [stream] [scrape] [desktop] [supabase] …  │ ← Source filter
│ lvl: [info] [success] [warn] [error]                        │ ← Level filter
├─────────────────────────────────────────────────────────────┤
│ ▶ 09:50:48.517  sidepanel  sys     debug relay started     │
│ ▼ 09:50:49.000  sidepanel  api     → GET /health/          │
│     {                                                       │
│       "url": "http://localhost:8000/health/",               │
│       "auth": false                                         │
│     }                                                       │
│ ▶ 09:50:49.010  sidepanel  api     ← /health/ 200 (8ms)    │
│ …                                                           │
└─────────────────────────────────────────────────────────────┘
```

## Backend switcher (top of tab)

- **Dropdown**: `prod` / `staging` / `dev` / `localhost:8000`. Saves to `chrome.storage.local`, fires a health check immediately.
- **Free-text override**: paste any URL. Blur to save. Fires a health check.
- **Lightning bolt button** (⚡): manual `/health/` ping at any time. Useful before debugging anything else.
- **Resolved URL chip** (right): shows what `getApiBaseUrl()` will actually return for the next request. Always reflects the current state.

A health check is also fired automatically:
- On sidepanel mount (after session restore)
- After successful sign-in
- After every env / URL switch

If the resolved URL chip says one thing but you see requests going somewhere else, `clearApiBaseCache()` wasn't called for that switch — file a bug.

## Toolbar

| Control | Action |
|---|---|
| Search | Filters by message content + JSON-stringified detail |
| `N/M` | filtered count / total count |
| `N err` | red error count when present |
| ⏸/▶ | Pause tail (log keeps growing in the store but the rendered list freezes) |
| 📋 | Copy filtered events to clipboard as plain text |
| ⬇ | Download filtered events as `.log` file with timestamped filename |
| 🗑 | Clear (in-memory only — store is never persisted to disk) |

## Filters

Two rows of toggle chips. Click `all` / `none` at the start of each row to toggle everything. The filter set persists across the session in component state (resets on reload).

## Event row anatomy

```
▼ 09:51:29.460  offscreen  stream  raw event #2
    {
      "e": "c",
      "t": "Hi"
    }
```

| Column | Meaning |
|---|---|
| ▶/▼ | Click any row with a payload to expand inline |
| Time | Wall-clock timestamp at emit time, ms precision |
| Context tag | `sidepanel` / `sw` / `offscreen` / `content` / `popup` / `options` (small uppercase) |
| Source | `auth` / `api` / `stream` / `scrape` / `desktop` / `supabase` / `sw` / `msg` / `ui` / `sys` |
| Message | Free-text — typically `→ send X`, `← receive X`, `→ POST /path`, `raw event #N` |

Color coding:
- Default — info
- Green — success
- Amber — warn
- Red — error

## Sources

| Source | Where logs originate |
|---|---|
| `auth` | `signIn`, `signOut`, `restoreSupabaseSession`, `refreshAccessToken` |
| `api` | `apiGet/apiPost/apiPatch/apiDelete` (every fetch with method, path, status, ms) |
| `stream` | `streamFetch` lifecycle, every NDJSON line as `raw event #N`, dispatch decisions |
| `scrape` | Scrape pipeline events (capture, defuddle, save) |
| `desktop` | `probeNative`, `probeHttp`, `desktopRpc` |
| `supabase` | Direct DB read errors |
| `sw` | `bootstrapBackground`, alarm fires, SW lifecycle |
| `msg` | Every cross-context message: `→ send`, `← receive`, `→ reply`, `↗ broadcast`, no-listener warnings |
| `ui` | UI-side info (rare) |
| `sys` | Module mounts, debug relay startup |

## Cross-context relay (admin-only)

Each non-sidepanel context (SW, offscreen, content scripts) calls `chrome.runtime.sendMessage` with the event payload tagged `__matrx_debug_relay__`. The sidepanel's startup hook listens for that kind and merges them into the shared store. The result: every line from every runtime, in one tab, in time order, with context tags so you know who emitted what.

Gating: `src/lib/debug/log.ts` reads `chrome.storage.local['matrx.user.isAdmin']` on module load and listens for changes. The relay only fires when the flag is true. Non-admin runtimes log to their own console (visible in `chrome://extensions` → "Inspect views: service worker" / offscreen) but never broadcast.

## Triage flow when something fails silently

1. Open Debug tab
2. Set level filter to `error` only — if anything red shows up, click it for the full JSON
3. If empty: search for the relevant action keyword (e.g. "stream:start", "/ai/agent")
4. Look at the request body in the `→ POST` row — is it the shape the backend expects?
5. Look at the `← /path <status>` row — what status, what body?
6. Click the `download .log` button and share the file if you need help

## Limits

- **In-memory only** — never persisted. `pnpm dev` reloads, browser restarts, extension updates all wipe the store.
- **Capped at 1500 events** — oldest are dropped first.
- **Sensitive data is logged** — request bodies, headers (including `Authorization: Bearer …`), JWT contents, etc. **Don't ship a `.log` file to anyone outside the team.** Admin gating exists partly for this reason.

## Files

- [src/lib/debug/log.ts](../src/lib/debug/log.ts) — store, emit helpers, `captureError`, cross-context relay
- [src/features/debug/DebugView.tsx](../src/features/debug/DebugView.tsx) — the UI
- [src/state/auth.ts](../src/state/auth.ts) — `isAdmin` in the auth store
- [src/lib/supabase/queries.ts](../src/lib/supabase/queries.ts) — `checkIsAdmin`
