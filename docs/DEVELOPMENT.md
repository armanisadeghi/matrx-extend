# Development Setup

## One-time setup

```bash
pnpm install           # installs deps; postinstall runs `wxt prepare` + husky
```

`.env.development` and `.env.production` are committed (the values they hold — Supabase URL, publishable key, OAuth client ID — are public). `.env` and `.env.*.local` are gitignored if you need personal overrides.

## Daily commands

| Command | Effect |
|---|---|
| `pnpm dev` | WXT dev server with HMR; opens Chrome with the extension auto-loaded |
| `pnpm dev:firefox` | same for Firefox |
| `pnpm build` | production build → `.output/chrome-mv3/` |
| `pnpm zip` | production .zip for Web Store upload → `.output/<name>-<version>-chrome.zip` |
| `pnpm compile` | `tsc --noEmit` |
| `pnpm lint` | `biome check .` |
| `pnpm lint:fix` | `biome check --write .` (safe + unsafe fixes) |
| `pnpm format` | `biome format --write .` |
| `pnpm test` | `vitest run` (unit tests) |
| `pnpm test:watch` | vitest in watch mode |
| `pnpm test:e2e` | Playwright (extension launcher) |
| `pnpm update-api-types` | regenerate `types/python-generated/*` from the live FastAPI |
| `pnpm update-api-types:local` | …against `http://localhost:8000` |
| `pnpm ui:add <component>` | shadcn/ui CLI passthrough (e.g. `pnpm ui:add dialog`) |

## Loading unpacked

`chrome://extensions` → enable Developer Mode → "Load unpacked" → select `.output/chrome-mv3/`.

The `key` field in `wxt.config.ts` locks the extension ID at `cihdmkcdjjckfhjpgoedmgfpoljebaml` for both dev and prod, so the OAuth redirect URI never has to change.

If you need to regenerate the keypair (lost the `.secrets/matrx-extend.pem` file), run:

```bash
node scripts/generate-extension-key.mjs
```

…and follow the printed instructions to update `manifest.key` and re-register the new redirect URI in Supabase.

## Updating types from the backend

Run after every backend deploy that touches API shapes:

```bash
pnpm update-api-types          # against live (https://server.app.matrxserver.com)
pnpm update-api-types:local    # against localhost:8000
```

It calls `aidream/scripts/sync-types.mjs` (must have `aidream` cloned at `../aidream`), then runs `tsc --noEmit` to fail loudly on any drift.

Generated artifacts (all in `types/python-generated/`):

- `openapi.json` — full spec
- `api-types.ts` — TypeScript types from openapi-typescript
- `stream-events.ts` — typed event union with type guards (`isChunkEvent`, `isErrorEvent`, etc.) + `expandCompactEvent`
- `stream-events.schema.json`
- `llm-params.schema.json`
- `llm-params-enums.generated.ts`

The `@gen/*` import alias maps to this directory.

## SQL migrations

Hand-applied to the Matrx Supabase project (no Supabase CLI workflow set up yet). See [migrations/README.md](../migrations/README.md). Files:

- `2026_04_30_wbx_capture.sql` — Scrape tab captures
- `2026_04_30_wbx_pattern.sql` — Data tab extraction patterns
- `2026_04_30_wbx_seo_audit.sql` — SEO tab audits

All extension-owned tables use the `wbx_` prefix (web/browser-captured), parallel to `cx_` (chat) and `agx_` (agent).

## Debugging

### Always available (any user)

- DevTools on the side panel: right-click → Inspect
- DevTools on the SW: `chrome://extensions` → "Inspect views: service worker"
- DevTools on the offscreen: `chrome://extensions` → "Inspect views: offscreen.html"
- DevTools on the page (for content scripts): regular F12 on the host page

Each context's `console.log` output is local. To see logs from one context in another, you need the Debug tab.

### Admin-only

The 7th tab in the side panel is **Debug** — visible only to users with a row in `public.admins`. It captures every event from every context in one place. See [docs/DEBUG.md](DEBUG.md) for the full feature breakdown.

## Tech stack

| Layer | Choice | Version |
|---|---|---|
| Framework | WXT | ^0.20 |
| UI | React | ^19 |
| Styling | Tailwind CSS | ^4 |
| Component primitives | shadcn/ui (Radix under the hood) | new-york style |
| Icons | lucide-react | latest |
| Client UI state | Zustand | ^5 |
| Server / cache state | TanStack Query | ^5 |
| Validation | Zod | ^3.24 |
| Cross-context messaging | native chrome.runtime + `src/lib/messaging/native.ts` | — |
| Streaming | native `fetch` + NDJSON, offscreen-buffered | — |
| Markdown | react-markdown + remark-gfm | latest |
| HTML→Markdown | Turndown + GFM plugin | ^7 |
| Article extraction | defuddle (primary) + @mozilla/readability (fallback) | — |
| Sanitization | DOMPurify | ^3 |
| Supabase | @supabase/supabase-js | ^2.103 |
| Lint+format | Biome | ^1.9 |
| Unit tests | Vitest | ^2 |
| E2E | Playwright | latest |
| Pre-commit | Husky + lint-staged | latest |
| Package manager | pnpm | ^10 |

## File layout

```
matrx-extend/
├── docs/                            # ← you are here
├── matrx-oauth/                     # OAuth skill (architecture + gotchas + debugging)
├── migrations/                      # SQL — run by hand against Supabase
├── public/icon/                     # 16/32/48/128 PNGs
├── scripts/
│   ├── update-api-types.mjs         # type sync wrapper
│   └── generate-extension-key.mjs   # one-time stable extension ID
├── src/
│   ├── config/env.ts                # env vars, BACKEND_URLS, STORAGE_KEYS, ALARMS
│   ├── entrypoints/                 # WXT auto-discovers these
│   │   ├── background.ts
│   │   ├── sidepanel/main.tsx + App.tsx
│   │   ├── popup/, options/, offscreen/
│   │   ├── content.ts
│   │   └── data-picker.content.ts
│   ├── lib/
│   │   ├── auth/                    # PKCE + AES-GCM + flow + types
│   │   ├── api/                     # client + stream + per-route modules
│   │   ├── supabase/                # client + queries (incl. checkIsAdmin)
│   │   ├── desktop/                 # bridge + native + http
│   │   ├── messaging/               # native chrome.runtime wrapper + channels
│   │   ├── scrape/                  # pipeline + collectors
│   │   ├── data-pattern/            # picker / runner / matcher
│   │   ├── seo/                     # audit collector
│   │   ├── stream/                  # SW <-> offscreen orchestrator
│   │   ├── debug/                   # event log + admin-gated relay
│   │   ├── storage/                 # chrome.storage helpers + zustand adapter
│   │   ├── content/                 # content-script bridge
│   │   ├── background/              # SW bootstrap
│   │   └── id.ts, utils.ts
│   ├── state/                       # Zustand stores
│   ├── components/
│   │   ├── ui/                      # shadcn/ui primitives
│   │   └── …
│   ├── features/{chat,tasks,scrape,data,seo,settings,debug}/
│   ├── hooks/
│   └── styles/globals.css
├── tests/{unit,e2e}/
├── types/python-generated/          # output of update-api-types (do not edit)
├── wxt.config.ts
├── biome.json, vitest.config.ts, playwright.config.ts, tsconfig.json
└── components.json                  # shadcn/ui config
```

## Common gotchas

| Symptom | Likely cause |
|---|---|
| "Authorization page could not be loaded" on sign-in | Redirect URI in Supabase doesn't exactly match `https://<EXTENSION_ID>.chromiumapp.org/` (note the trailing slash) — see matrx-oauth/SKILL.md gotcha #1 |
| Only public agents in the picker | Sidepanel's Supabase client doesn't have the JWT — `restoreSupabaseSession()` not called on mount, or admin/user check failed silently |
| Chat hangs at "…" forever | Wire format mismatch (NDJSON vs SSE) or runId mismatch in `useChatStream`. Open Debug tab and look for `raw event #N` lines |
| Health check returns 0 | Network — extension can't reach the backend. Check the resolved URL in Debug tab top bar |
| `getApiBaseUrl threw "Cannot read properties of undefined (reading 'sync')"` | Code is using `chrome.storage.sync` — switch to `.local`. `.sync` is undefined in offscreen |
| Debug tab missing for a real admin | Their row isn't in `public.admins`, OR the cached flag in `chrome.storage.local['matrx.user.isAdmin']` is stale. Sign out + back in. |
| New file under `src/lib/` mysteriously not in git | The Python `lib/` rule in `.gitignore` swallowed it. Run `git check-ignore -v <file>` and add an explicit `!src/lib/<path>` allow rule. |
