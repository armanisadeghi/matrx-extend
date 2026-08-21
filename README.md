# Matrx Extend

A modern, beautiful, and powerful Chrome extension for AI-native browser automation, scraping, structured data capture, and SEO intelligence.

`matrx-extend` is the browser extension layer of the broader Matrx platform—designed to connect seamlessly with:

- a powerful Python / FastAPI backend for agent execution and streaming text
- a modern Next.js frontend for application workflows and OAuth
- a Vite-based admin dashboard
- a cross-platform desktop application for Windows, macOS, and Linux

The goal is simple:

> Build an equally powerful Chrome extension that feels native, modern, sleek, and production-grade—while giving our AI agents rich browser access, direct API connectivity, local desktop integration, and smooth user workflows.

---

## Vision

Matrx Extend is not just a popup UI.

It is a serious browser-side operating surface for agentic workflows.

It should enable users and agents to:

- interact with the current page intelligently
- scrape and structure difficult web content
- save and sync data with the platform
- execute browser-driven tasks
- recognize previously captured data automatically
- communicate with backend services in real time
- optionally communicate with a local desktop app for enhanced capability
- provide a polished, beautiful interface that does not constantly fight Chrome extension constraints

---

## Core Product Goals

### 1. Beautiful modern Chrome-native UX
The extension should feel intentional and premium:

- modern, clean UI
- excellent performance
- minimal friction
- Chrome-compliant patterns
- intuitive navigation
- strong accessibility
- extension architecture that avoids brittle hacks and constant platform fights

### 2. True agentic browser control
The extension should provide a strong foundation for browser-aware agent actions, including:

- understanding page context
- interacting with DOM content
- helping navigate browser-driven workflows
- extracting content from complex pages
- coordinating user-driven and agent-driven tasks

### 3. Deep platform integration
The extension must integrate cleanly with the Matrx ecosystem:

- **Next.js app** for authentication and primary application flow
- **FastAPI backend** for agent execution, streaming responses, and server-side processing
- **Supabase** for direct client-side data access with RLS
- **desktop app** for local communication when available

### 4. Smart data persistence
As users browse and scrape:

- extracted data should be saved to the database
- the extension should recognize previously captured pages/data client-side
- users should be able to refresh or update data when needed
- known patterns should be reusable across future visits

---

## Main Feature Areas

The extension is organized around six core tabs:

- **Chat**
- **Tasks**
- **Scrape**
- **Data**
- **SEO**
- **Settings**

### Chat
An agentic chat interface powered by the Matrx agent system.

Capabilities include:

- selecting an agent
- sending user input and variables
- displaying streaming responses
- surfacing chat history from the database
- enabling contextual actions based on the current page

The extension itself does not need to own complex chat orchestration logic if that already exists in the broader system. It should act as an elegant browser-native client for agent interaction.

### Tasks
A browser task workspace for user-driven and agent-driven execution.

This is **not** a basic todo list.

Tasks represent meaningful browser actions that need to happen, often tied to pages or workflows. Examples:

- navigate to a page
- scrape a target URL
- extract and save data
- validate page state
- complete a structured browser workflow

Example:

- a task says to visit `xyz.com/info`
- the user clicks it
- the extension navigates there
- the extension or agent performs scraping
- the data is saved to the database
- the task is marked complete if successful

### Scrape
A powerful scraping utility for difficult pages.

The scrape experience should make it easy to:

- inspect extracted page content
- tune extraction behavior
- isolate clean content
- capture all images, videos, links, and structured content
- preview results before saving
- offload advanced cleanup or parsing to the backend when needed

Design principle:

> Do as much clean processing as possible in the browser first, then delegate heavier or more specialized processing to the server as needed.

### Data
A structured extraction system for pages with known patterns.

The first time a user visits a page or domain, they should be able to:

- isolate the exact fields they want
- define a reusable extraction pattern
- save that pattern to the database
- scope it to a page, route family, or full domain

On future visits, the extension should automatically recognize the page and apply the saved structure.

This enables repeatable, intelligent extraction workflows instead of one-off scraping.

### SEO
An AI-enhanced SEO utility for analyzing pages and generating recommendations.

Capabilities should include extracting and evaluating:

- title tags
- meta descriptions
- canonical tags
- robots directives
- headings
- image alt coverage
- internal linking signals
- schema / structured data
- Open Graph / social metadata
- performance-relevant page signals
- indexability-related issues

The extracted SEO data should then be passed to AI agents for recommendations and stored in the database.

### Settings
A configuration area for:

- account state
- environment selection
- API connection status
- desktop app connection state
- scraping defaults
- feature flags
- debug tools
- permissions and onboarding state

---

## Authentication Strategy

Authentication will use the platform’s own OAuth flow through the Next.js application.

High-level flow:

1. user clicks sign in from the extension
2. extension opens the Next.js authentication flow
3. user authenticates in the web app
4. the application redirects/callbacks with a token
5. the extension stores and uses the authenticated session securely

Important considerations:

- register the extension with the proper callback URLs
- support both local development and production callback handling if they differ
- minimize token exposure and storage risk
- keep extension authentication UX simple and reliable

---

## Data Architecture

The extension should support a hybrid model:

### Direct client-side database access
Using Supabase directly from the extension where appropriate:

- authenticated reads/writes
- RLS-protected access
- quick recognition of previously stored page or scrape data
- low-friction synchronization

### Server-backed processing
Use the FastAPI backend for:

- agent orchestration
- streaming text responses
- heavy processing
- advanced extraction pipelines
- server-side enrichment
- actions requiring centralized logic or secrets

### Local desktop communication
When available, the extension should communicate with the desktop app for enhanced local workflows, potentially enabling:

- local file access workflows
- advanced machine-level actions
- higher-trust local integrations
- optional offline-adjacent capability

---

## Recommended Technical Direction

These are the most important early infrastructure decisions.

### Extension foundation
Use a modern Manifest V3 architecture with clear separation between:

- **service worker**
- **content scripts**
- **extension UI surfaces**
- **shared client library layer**

Recommended priorities:

- strict MV3 compliance
- minimal permission footprint where possible
- modular messaging architecture
- stable page interaction model
- robust error handling around content-script injection and tab lifecycle events

### UI strategy
The UI must be beautiful, modern, and maintainable.

Recommended approach:

- React-based UI
- strong design system from day one
- lightweight, composable components
- careful handling of extension-specific constraints
- consistent styling strategy across popup/panel/options surfaces

Potential UI surfaces to consider:

- popup for quick access
- side panel for richer workflows
- options/settings page
- content overlays only when truly necessary

### Browser control and scraping
Plan for layered capability:

- content scripts for DOM access
- background/service worker orchestration
- tab APIs for navigation/state
- page-context extraction utilities
- reusable scraping pipeline
- structured content normalization before save/send

### API communication
Use a typed, resilient client layer for:

- authenticated requests
- streaming agent output
- retry handling
- connection state awareness
- environment-aware endpoints

### Local app communication
Design a clean integration point for the desktop app rather than hard-wiring assumptions into every feature.

This may involve:

- a dedicated communication bridge
- explicit availability detection
- graceful fallback behavior when the desktop app is not present

---

## Non-Negotiable Standards

This project should optimize for:

- **clean architecture**
- **beautiful UX**
- **high reliability**
- **minimal Chrome friction**
- **strong security**
- **future extensibility**
- **tight integration with the broader Matrx platform**

---

## Open Infrastructure Questions

Before implementation begins, these should be finalized:

- Which extension framework/tooling should we use?
- Which UI surface should be primary: popup, side panel, or both?
- What exact permissions are required for browser control and scraping?
- How should OAuth callback handling work in local vs production environments?
- What data should go direct to Supabase vs through the backend?
- What is the desktop communication protocol?
- Which features must work without the desktop app present?
- How much scraping cleanup should happen locally vs server-side?
- What is the schema for saved scrape results, extraction patterns, tasks, and SEO audits?

---

## Initial Development Priorities

1. establish the extension architecture
2. choose the UI foundation
3. implement authentication
4. wire API + Supabase connectivity
5. define browser control and scraping primitives
6. build the shell for Chat / Tasks / Scrape / Data / SEO / Settings
7. validate local desktop communication strategy

---

## Project Status

Early architecture / planning stage.

This repository is intended to become the Chrome extension client for the Matrx platform’s AI, scraping, browser automation, structured data capture, and SEO workflows.

---

## Tech stack

- **Framework**: [WXT](https://wxt.dev) 0.20.x (Manifest V3, Vite-based, file-based entrypoints, sidepanel + offscreen helpers)
- **UI**: React 19, Tailwind CSS 4, shadcn/ui primitives, Radix UI, Lucide icons
- **State**: Zustand 5 (persisted to `chrome.storage.local`), TanStack Query 5
- **Validation**: Zod 3 (`^3.24`) at every external boundary
- **Cross-context messaging**: native `chrome.runtime` wrapper (typed SW ↔ side panel ↔ content ↔ offscreen)
- **Auth / DB**: `@supabase/supabase-js` 2 with custom `chrome.storage` adapter, `autoRefreshToken: false`, manual refresh via `chrome.alarms`
- **Scraping**: Defuddle (primary) → Mozilla Readability (fallback) → DOMPurify → Turndown (markdown), plus first-class collectors for images, videos, audio, links, JSON-LD, microdata, OpenGraph/Twitter
- **Streaming**: native `fetch` + `ReadableStream`, run inside an **offscreen document** so SW kills don't cut long agent / scrape streams
- **Desktop bridge**: capability-detected — prefers `chrome.runtime.connectNative` (`com.matrx.local`), falls back to localhost HTTP at `127.0.0.1:22180`
- **Lint + format**: Biome 1.9; **tests**: Vitest 2 + Playwright

## Project structure

```
matrx-extend/
├── src/
│   ├── entrypoints/
│   │   ├── background.ts         # service worker (lazy-bootstraps on first event)
│   │   ├── sidepanel/            # primary UI — Chat | Tasks | Scrape | Data | SEO | Settings
│   │   ├── popup/                # quick actions, sign-in entry
│   │   ├── options/              # full settings (mirrors Settings tab)
│   │   ├── offscreen/            # holds streams + Realtime websockets
│   │   ├── content.ts            # default content script (scrape capture, nav signals)
│   │   └── data-picker.content.ts # runtime-injected only — no auto-inject
│   ├── config/env.ts             # build-time env, runtime-overridable backend URL
│   ├── lib/
│   │   ├── auth/                 # PKCE flow, deprecated file backend adapter, AES-GCM crypto
│   │   ├── api/                  # REST client + NDJSON stream + per-route modules
│   │   ├── supabase/             # client + RLS-gated queries
│   │   ├── desktop/              # bridge facade + native + http transports
│   │   ├── messaging/            # native chrome.runtime wrapper + channel registry + Zod schemas
│   │   ├── scrape/               # pipeline + collectors
│   │   ├── data-pattern/         # picker, runner, matcher
│   │   ├── seo/                  # audit collector
│   │   ├── stream/               # SW <-> offscreen orchestrator
│   │   └── storage/              # chrome.storage helpers + zustand adapter
│   ├── state/                    # Zustand stores
│   ├── components/
│   │   ├── ui/                   # shadcn/ui primitives
│   │   └── …                     # app-level components
│   ├── features/{chat,tasks,scrape,data,seo,settings}/
│   └── hooks/
├── .claude/skills/matrx-oauth/   # OAuth skill (synced from common-docs)
├── scripts/update-api-types.mjs  # syncs types from FastAPI /schema/*
├── types/python-generated/       # generated by sync script
└── tests/{unit,e2e}/
```

## Setup

```bash
pnpm install
pnpm prepare        # wxt prepare + husky
```

Copy `.env.example` (already there as `.env.development` / `.env.production`) and fill in:

| Var | Required | Notes |
|---|---|---|
| `WXT_SUPABASE_URL` | yes | Project URL — `https://db.matrxserver.com` |
| `WXT_SUPABASE_PUBLISHABLE_KEY` | yes | New `sb_publishable_*` key (replaces legacy anon key) |
| `WXT_EXTENSION_OAUTH_CLIENT_ID` | yes for sign-in | Public PKCE client registered in Supabase OAuth dashboard with redirect `https://<EXTENSION_ID>.chromiumapp.org/` |
| `WXT_DEFAULT_BACKEND` | optional | `prod` / `staging` / `dev` / `local` |
| `WXT_BACKEND_URL` | optional | Hard override; wins over `WXT_DEFAULT_BACKEND` |

## Development

```bash
pnpm dev              # WXT dev server with HMR — opens Chrome with extension loaded
pnpm dev:firefox      # same for Firefox
pnpm build            # production bundle to .output/chrome-mv3/
pnpm zip              # production .zip for Web Store upload
pnpm compile          # tsc --noEmit
pnpm lint             # biome check
pnpm lint:fix         # biome check --write
pnpm test             # vitest run
pnpm update-api-types # regenerate types/python-generated/* from FastAPI /schema/all
pnpm update-api-types:local  # same, but against http://localhost:8000
```

To load unpacked: open `chrome://extensions`, enable Developer Mode, "Load unpacked" → `.output/chrome-mv3/`.

## OAuth flow (PKCE, Supabase-direct)

The extension hits Supabase's OAuth endpoints directly — Supabase renders the aimatrx.com-branded consent UI itself.

1. Side panel calls `signIn()` (background SW)
2. SW generates PKCE `code_verifier` + `code_challenge`, encodes verifier into `state` (`<verifier>.<nonce>`)
3. `chrome.identity.launchWebAuthFlow` opens an auth window pointed at `${SUPABASE_URL}/auth/v1/oauth/authorize?...`
4. Supabase redirects to `https://<EXTENSION_ID>.chromiumapp.org/?code=…&state=…`
5. SW recovers verifier from state, POSTs to `${SUPABASE_URL}/auth/v1/oauth/token` (no `client_secret`, no `openid` scope)
6. Tokens stored: access token in `chrome.storage.local`, refresh token AES-GCM-encrypted in `chrome.storage.local`; the PKCE verifier lives in `chrome.storage.session` (cleared on browser restart) for the duration of the flow
7. `chrome.alarms.create('matrx.alarm.tokenRefresh')` fires ~50 min later to rotate before expiry

See [.claude/skills/matrx-oauth/SKILL.md](.claude/skills/matrx-oauth/SKILL.md) for full architecture, gotchas (the five hard-won facts), and the debugging playbook.

## Stable extension ID

To keep the OAuth redirect URI fixed across dev (unpacked) and Web Store builds:

1. Run `pnpm zip` once, drag the .crx into `chrome://extensions`, copy the assigned ID
2. Web Store Developer Dashboard → "Pack extension" → view public key
3. Strip newlines from the key; paste into `wxt.config.ts` → `manifest.key`
4. **Web Store quirk**: remove `key` for the *first* upload, re-add for v0.1.1+

## Desktop bridge (matrx-local)

Capability-detected at runtime — prefers native messaging, falls back to localhost HTTP.

- **Native**: when `matrx-local` ships its host JSON (`com.matrx.local.json`) the SW connects via `chrome.runtime.connectNative('com.matrx.local')`
- **Localhost HTTP**: SW probes `http://127.0.0.1:22180/health`. Pair via Settings → Pair desktop (paste a 6-digit code from matrx-local). Stored bearer token authenticates further `/extension/rpc` calls

Localhost is exempt from Private Network Access prompts in current Chrome — no CORS preflight juggling needed.

## Streaming — offscreen-buffered NDJSON

MV3 service workers are killed after ~30s idle. To keep AI agent / scrape streams alive across SW restarts:

```
side panel → SW: stream:start { runId, endpoint, body, parser }
SW: ensureOffscreen() → sends stream:start to offscreen window
offscreen: holds the fetch ReadableStream, parses NDJSON
offscreen → SW → side panel: stream:chunk { runId, type, payload }
```

## Database tables expected by this extension

These are **new** tables we need to add to the Matrx Supabase project:

```sql
All extension-owned tables use the **`wbx_`** prefix (web/browser-captured), parallel to `cx_` (chat) and `agx_` (agent). Apply the SQL files in [migrations/](migrations/) in order:

| Table | Purpose |
|---|---|
| `wbx_capture` | Page captures from the Scrape tab (article, media, structured data) |
| `wbx_pattern` | Saved extraction patterns from the Data tab |
| `wbx_seo_audit` | SEO audits + AI recommendations from the SEO tab |

Tables this extension only **reads** (already in the schema): `agx_agent` (agent picker), `cx_conversation` + `cx_message` (chat history). Research data (`rs_*`) is accessed via FastAPI `/research/*` endpoints, not direct Supabase queries.

## Out-of-band setup checklist

Before sign-in works end-to-end:

- [ ] In Supabase OAuth dashboard, register a new public PKCE OAuth client named "matrx-extend"
- [ ] Add `https://<EXTENSION_ID>.chromiumapp.org/` to its allowed redirect URIs
- [ ] Populate `WXT_EXTENSION_OAUTH_CLIENT_ID` in `.env.development` and `.env.production`
- [ ] Apply the SQL migrations above to the Matrx Supabase project
- [ ] (Optional, for native desktop) ship `com.matrx.local.json` host manifest + Rust stdio shim from matrx-local

---

## License

TBD
