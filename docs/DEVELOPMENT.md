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
├── .claude/skills/matrx-oauth/       # OAuth skill (synced from common-docs)
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
├── biome.json, vitest.config.ts, tsconfig.json
└── components.json                  # shadcn/ui config
```

## Common gotchas

| Symptom | Likely cause |
|---|---|
| "Authorization page could not be loaded" on sign-in | Redirect URI in Supabase doesn't exactly match `https://<EXTENSION_ID>.chromiumapp.org/` (note the trailing slash) — see .claude/skills/matrx-oauth/SKILL.md gotcha #1 |
| Only public agents in the picker | Sidepanel's Supabase client doesn't have the JWT — `restoreSupabaseSession()` not called on mount, or admin/user check failed silently |
| Chat hangs at "…" forever | Wire format mismatch (NDJSON vs SSE) or runId mismatch in `useChatStream`. Open Debug tab and look for `raw event #N` lines |
| Health check returns 0 | Network — extension can't reach the backend. Check the resolved URL in Debug tab top bar |
| `getApiBaseUrl threw "Cannot read properties of undefined (reading 'sync')"` | Code is using `chrome.storage.sync` — switch to `.local`. `.sync` is undefined in offscreen |
| Debug tab missing for a real admin | Their row isn't in `public.admins`, OR the cached flag in `chrome.storage.local['matrx.user.isAdmin']` is stale. Sign out + back in. |
| New file under `src/lib/` mysteriously not in git | The Python `lib/` rule in `.gitignore` swallowed it. Run `git check-ignore -v <file>` and add an explicit `!src/lib/<path>` allow rule. |

---

## 📜 Engineering conventions (full bodies — moved from CLAUDE.md 2026-08-20)

- **Admin-only experiments**: when a new capability could break things,
  duplicate it as admin-only first (filter from non-admin tool advertisement).
  Promote to general-availability after the user has tested.
- **Optional permissions**: anything that scares the install dialog goes
  in `optional_permissions` and is requested at runtime via
  `chrome.permissions.request` from a Settings toggle.
- **Feature detection**: every API touched gracefully degrades. If
  `chrome.ai`, `navigator.modelContext`, `chrome.debugger`, etc. are missing,
  the tool returns `{ ok: false, reason: 'unavailable' }` rather than throwing.
- **No silent writes**: privileged tier always prompts. Even in Act mode.
- **Tab context: never query the active tab directly from a handler**
  — use `getAssignedTab(ctx)` / `getAssignedTabId(ctx)` from
  [`src/lib/tools/handlers/_active-tab.ts`](../src/lib/tools/handlers/_active-tab.ts).
  These prefer `ctx.assignedTabId` (latched at user-message-send time)
  and fall back to `chrome.tabs.query({active:true, currentWindow:true})`
  only when no assignment is recorded. This is what keeps the agent
  pinned to its tab even when the user switches focus mid-execution.
  If you need to *list* tabs (not "the current one") that's fine —
  e.g., `list_open_tabs` legitimately calls `chrome.tabs.query({})`.
- **Active tab for request assembly: resolve ONCE per send.** The chat
  hooks call `resolveActiveTab()` from
  [`src/lib/chat/active-tab.ts`](../src/lib/chat/active-tab.ts) at the
  top of the send and thread the `chrome.tabs.Tab` through
  `buildChatContext`, `buildBrowserDomState`, and `STREAM_START.assignedTabId`.
  Never re-query inside a context builder — a second query reintroduces
  the cross-tab race where `page_brief.tab_id` and
  `client.state["browser-dom"].current_tab_id` end up referencing
  different tabs. See [docs/REQUEST_PAYLOAD_CONTRACT.md §1](../docs/REQUEST_PAYLOAD_CONTRACT.md).
- **Catalog stays in sync**: after any handler change, run
  `pnpm catalog:tools:md` and commit the regenerated JSON + MD, and
  `pnpm docs:tools` to refresh the DB-sourced `docs/TOOLS.generated.md`.
- **Tool descriptions live ONLY in the DB** (Rule 4,
  [docs/TOOL_SOURCE_OF_TRUTH.md](../docs/TOOL_SOURCE_OF_TRUTH.md)): never add a
  `description` to a `ToolHandler` or a `.describe()` to its Zod args. UI and
  discovery read descriptions live via
  [src/lib/tools/descriptions.ts](../src/lib/tools/descriptions.ts) — which
  queries `tool.definition` directly via Supabase REST (the older aidream
  `GET /ai-tools/app/matrx-extend` endpoint was retired in the 2026-05-27
  refactor since `source_app` is no longer a column). To change a tool,
  change `tool.definition` first (admin API / migration), then bring the Zod into
  line until `pnpm catalog:tools:drift` is quiet. There is no code→DB sync.
- **Document tests for everything user-visible**: when you add or
  meaningfully change any tool, UI surface, or feature, add or update
  its entry in [`docs/feature-tests.md`](../docs/feature-tests.md)
  before committing. Keep entries SHORT and SPECIFIC — exact steps a
  human can follow without reading source code. Each entry: *what it
  does* (one sentence) → *where to test* (Tools tab / SEO tab / etc.) →
  *steps* (numbered) → *expected* → *edge cases worth poking*.
  This file is the single source of truth for "how do I verify X?";
  letting it drift means future agents (and humans) waste hours
  rediscovering test paths.
- **Reuse existing capabilities first**: before building a new
  extractor / collector / parser, search for prior art. Look in
  `src/lib/scrape/` (collectors), `src/lib/data-pattern/modes/`
  (extraction modes used by Showcase tabs), `src/lib/chat/context/`
  (the v2 context bundle), and `src/features/showcase/tabs/`. When the
  existing pipeline already does what you need, route through the same
  primitive — agents and the user-facing UI then share one code path
  (improvements to either side benefit both). Cross-working is the
  goal; duplication is a smell.
- **`chrome.scripting.executeScript` args must be JSON-serializable** —
  `undefined` is NOT, and Chrome will reject the call with
  `Error at property 'args': Error at index N: Value is unserializable`
  before your script runs. When a Zod-optional field has no `.default()`,
  it can arrive as `undefined`. Coerce with `?? null` at the call site
  and type the inner func param as `string | null` (not `string | undefined`).
  Same rule for the inner func — when checking, use `value !== null`, not
  `value !== undefined`. Bit me on `select_dropdown_option` (2026-05-03);
  every existing handler is now null-coerced.
- **Env vars: literal access only, deferred via getters** — `src/config/env.ts`
  has TWO non-obvious constraints that pull in opposite directions and
  bit us on 0.1.7 → 0.1.8 → 0.1.9:
    1. **Vite only replaces LITERAL `import.meta.env.WXT_FOO`** at build
       time. Dynamic access (`import.meta.env[key]` or
       `getEnv('WXT_FOO')`) is NOT replaced — at runtime the object
       only contains Vite's built-ins (`MODE`/`DEV`/`PROD`/`SSR`), so
       user vars come back undefined and Supabase / OAuth / desktop
       bridge all silently break. Each env var must appear once as a
       literal `import.meta.env.WXT_NAME` somewhere in the source.
    2. **`scripts/dump-tool-catalog.ts` runs under plain `tsx`** where
       `import.meta.env` is `undefined`. Reading it at module load
       throws and crashes the catalog regen.
  The fix in `env.ts` satisfies both: each var has a getter whose body
  contains a literal `import.meta.env.WXT_NAME` (Vite folds it at build
  time) wrapped in try/catch via the `safeRead` helper (so tsx returns
  undefined instead of throwing on import). Don't refactor to a generic
  `getEnv(key)` — you'll re-break Vite's literal pattern matching.
  Add new env vars by adding a new getter, never by extending the
  helper. Verify with: build with `pnpm build`, then
  `grep "your-secret-value" .output/chrome-mv3/chunks/env-*.js` — the
  literal must be inlined into the bundle. If it's not, Vite didn't
  fold it and runtime will see undefined.
- **No top-level reads of `chrome.*`** — same `tsx`-loadability concern.
  The registry walk in the catalog script imports every handler;
  anything that reads `chrome.identity.*`, `chrome.runtime.*`, etc.
  at module init crashes with `ReferenceError: chrome is not defined`.
  Tool handlers already wrap `chrome.*` in `run()` closures; don't
  break that pattern. Bit us when an unused
  `_REDIRECT_URI = chrome.identity.getRedirectURL()` constant lingered
  at the top of `src/lib/auth/flow.ts`.
- **Verify after any handler / config / env-related change** by running
  `pnpm catalog:tools:md`. If it crashes (`Cannot read properties of
  undefined`, `ReferenceError: chrome is not defined`, etc.), the
  import graph has a new top-level offender to find. The release
  script (`release.sh`) will warn but no longer fail on catalog regen
  failures — treat the warning as a real bug to fix, not background
  noise.

---


---

## 🧬 TypeScript — the dual install (read before touching `typescript` in package.json)

We run **TypeScript 7** (the Go rewrite). A full-repo typecheck is ~**1.1s**
wall (multithreaded, ~550% CPU), down from ~25s. `pnpm compile` is fast
enough to run on every save — treat a red typecheck as an immediate stop.

The install is **dual**, and the two entries look backwards until you know why:

```json
"@typescript/native": "npm:typescript@^7.0.2",       // -> bin `tsc`  (native Go)
"typescript": "npm:@typescript/typescript6@^6.0.2"   // -> the 6.0 API + bin `tsc6`
```

**Why not a plain bump.** TS 7 ships no programmatic API yet — its package
exports only `lib/version.cjs` plus a few `unstable/*` entries. Anything that
`import`s `typescript` (rather than merely shelling out to `tsc`) breaks against
it. This repo has exactly one such consumer: **`openapi-typescript`**, which
builds its output through `ts.factory` and backs `pnpm update-api-types`.

**Why the aliasing works.** `@typescript/typescript6` deliberately ships its
binary as **`tsc6`**, not `tsc`. So the `tsc` name stays free for the native
compiler while `import 'typescript'` still resolves to a complete 6.0 API. Net
effect: `tsc` is native and fast, `update-api-types` still runs.

Consequences to keep in mind:

- **`pnpm add -D typescript@latest` will break the codegen script.** If you ever
  need to collapse this back to a single install, first confirm
  `openapi-typescript` has shipped TS 7 support.
- **Never invoke `tsc` by path.** `./node_modules/typescript/bin/tsc` does not exist
  anymore (that package's only bin is `tsc6`). Go through the bin — `pnpm exec tsc`
  or a package script. `scripts/update-api-types.mjs` hardcoded the old path and
  reported the resulting `MODULE_NOT_FOUND` as "TYPE ERRORS DETECTED", which is how
  a broken toolchain spent a while impersonating a backend contract drift.
- **In VS Code, do NOT set `typescript.tsdk` / "Use Workspace Version."** The
  workspace `typescript` package is the 6.0 API bundle: it ships `typescript.js` and
  `tsserverlibrary.js` but **no `tsserver.js`**, which is the file VS Code's TS
  extension loads. Pointing the editor at it errors or silently falls back. Let VS
  Code use its **bundled** TypeScript for IntelliSense (checking semantics are the
  same — TS 7 is a faithful port), and treat **`pnpm compile` as the source of
  truth**. TS 7 ships no tsserver-compatible LSP yet; when it does, revisit.
- Biome does the linting here, so there is no `typescript-eslint` to keep on the
  6.0 API. `tsx`, `vitest`, and `wxt` all parse via esbuild/Vite and never touch
  the TS API — none of them constrain this.
- The lone peer warning (`openapi-typescript` wants `typescript: ^5.x`, finds
  6.0.x) is expected and benign; the 6.0 API is a superset of what it uses.

### Strictness — what's on, and the one flag that stays off

Beyond `strict`, the following are on. Each was enabled only after its blast
radius was measured and every surfaced error was **fixed at the source** —
there is not a single `any`, `@ts-ignore`, or `@ts-expect-error` holding this up,
and there must never be:

`noUncheckedIndexedAccess` · `noImplicitOverride` · `exactOptionalPropertyTypes` ·
`noImplicitReturns` · `noFallthroughCasesInSwitch` · `noUnusedLocals` ·
`noUnusedParameters` · `allowUnreachableCode:false` · `allowUnusedLabels:false` ·
`noUncheckedSideEffectImports` · `verbatimModuleSyntax` · `erasableSyntaxOnly` ·
`strictBuiltinIteratorReturn`

**`exactOptionalPropertyTypes` is the one with teeth.** `{ a?: string }` no
longer accepts `{ a: undefined }` — "absent" and "explicitly undefined" are
different things. That is the type-level enforcement of the context rule already
written into this file ("*No shallow keys for empty things … if a bundle would be
empty, omit the bundle*"). When it fires, the fix depends on which side you're on:

- **React props** — widen the *receiving* declaration to `foo?: T | undefined`.
  For a prop, "not passed" and "passed as undefined" are identical, and reading a
  `foo?: T` already yields `T | undefined`. This is the honest type, not a loosening.
- **Anything serialized, persisted, or merged** (a JSON body, a Supabase upsert, a
  `chrome.storage` write, a zustand `set`, an `Object.assign`) — do **not** widen the
  type. **Omit the key**: `...(x !== undefined && { key: x })`. `{key: undefined}`
  and `{}` genuinely differ for a merge: one clobbers the stored value, the other
  leaves it alone. That bug class is the entire reason the flag is on.

**`noPropertyAccessFromIndexSignature` stays OFF — deliberately. Don't "fix" it.**
It would produce ~600 errors, and **all of them are TS4111**, which is purely
syntactic (`x.foo` → `x['foo']`). It buys **zero** type safety here, because
`noUncheckedIndexedAccess` is already on and *already* forces the undefined-check
on dotted index-signature access (verified: `rec.foo` then `.length` errors
TS18048). Turning it on means ~600 mechanical edits and uglier code
(`process.env['NODE_ENV']`) in exchange for nothing.

**`erasableSyntaxOnly` means no TS-only runtime syntax** — no `enum`, no
`namespace`, no constructor parameter properties (`constructor(private x: T)`).
Use plain fields and `const` objects / union types.

Two gotchas that will waste your afternoon:

- **`tsconfig.json` must be strict JSON — no comments.** TS accepts JSONC, but
  WXT's tsconfig loader does a plain `JSON.parse` and the build dies with an
  opaque `TSCONFIG_ERROR`. Rationale goes here, not in the file.
- **Duplicate keys are silent.** TS takes the *last* one and says nothing, so a flag
  you "added" can be dead on arrival. This bit us during the TS 7 migration itself:
  `verbatimModuleSyntax: true` was appended while a `verbatimModuleSyntax: false`
  already sat further down, so the flag stayed off and the typecheck's clean bill of
  health was meaningless. WXT's loader is what caught it — it `JSON.parse`s the file
  and rejects the duplicate outright. If you add a flag, grep the file for it first.

`src/vite-env.d.ts` declares `*.css` **by hand and does not reference
`vite/client`** — on purpose. Under pnpm, `vite` is a transitive dep of wxt and is
never hoisted, so the reference resolved to nothing; and `vite/client` declares
`interface ImportMetaEnv { [key: string]: any }`, whose index signature would merge
into ours and turn every typo'd `import.meta.env.WXT_*` into a silent `any` —
exactly what the env-var rules above exist to prevent.

---

