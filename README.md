# Matrx Extend

The Chrome extension client of the AI Matrx platform — the browser-agent harness. WXT / MV3 /
React side panel.

🚨 **What this extension IS, what it can do, how it is wired, and every contract it holds with
another repo live in ONE place — not here:**
`/Users/armanisadeghi/code/common-docs/systems/clients/extension/`

| Question | Doc |
|---|---|
| What exists today, and what is pending | `STATE.md` · `HANDOFF.md` |
| Intent | `VISION.md` |
| Settled rulings | `DECISIONS.md` |
| Every cross-repo channel (aidream / matrx-local / matrx-frontend / scheduling) | `CHANNELS.md` |
| Request payload, context keys, stream, resume | `WIRE_CONTRACT.md` |
| MV3 contexts, messaging, auth, streaming, tool dispatch | `ARCHITECTURE.md` |
| Chrome Web Store identity, review record, listing copy | `CHROME-WEB-STORE.md` |

Working in this repo? Read [CLAUDE.md](CLAUDE.md) first — it carries the rules that prevent
this repo's specific mistakes. This file is setup and commands only.

## Tech stack

- **Framework**: [WXT](https://wxt.dev) 0.20.x — MV3, Vite-based, file-based entrypoints, side-panel + offscreen helpers
- **UI**: React 19, Tailwind CSS 4, shadcn/ui primitives, Radix UI, Lucide icons
- **State**: Zustand 5 (persisted to `chrome.storage.local`), TanStack Query 5
- **Validation**: Zod at every external boundary
- **Cross-context messaging**: typed native `chrome.runtime` wrapper (SW ↔ side panel ↔ content ↔ offscreen)
- **Auth / DB**: `@supabase/supabase-js` with a `chrome.storage` adapter, `autoRefreshToken: false`, manual refresh via `chrome.alarms`
- **Scraping**: Defuddle → Readability fallback → DOMPurify → Turndown, plus collectors for images, video, audio, links, JSON-LD, microdata, OpenGraph
- **Streaming**: `fetch` + `ReadableStream` inside an offscreen document, so a service-worker kill never cuts a long run
- **Lint/format**: Biome · **tests**: Vitest + Playwright

## Setup

```bash
pnpm install
pnpm prepare        # wxt prepare + husky
```

`.env.development` / `.env.production` are committed (their values are public).

| Var | Required | Notes |
|---|---|---|
| `WXT_SUPABASE_URL` | yes | `https://db.matrxserver.com` — the ONE platform database, addressed by URL, never by project ref |
| `WXT_SUPABASE_PUBLISHABLE_KEY` | yes | `sb_publishable_*` (replaces the legacy anon key) |
| `WXT_EXTENSION_OAUTH_CLIENT_ID` | yes for sign-in | Public PKCE client, redirect `https://<EXTENSION_ID>.chromiumapp.org/` |
| `WXT_DEFAULT_BACKEND` | optional | `prod` / `staging` / `dev` / `local` |

There is no fallback chain for the Supabase pair — both are required and throw if absent.

## Development

```bash
pnpm dev              # WXT dev server with HMR; opens Chrome with the extension loaded
pnpm dev:firefox      # same for Firefox
pnpm build            # production bundle → .output/chrome-mv3/
pnpm zip              # production .zip for Web Store upload
pnpm compile          # tsc --noEmit
pnpm lint             # biome check   (lint:fix to write)
pnpm test             # vitest run
pnpm update-api-types # regenerate types/python-generated/* from the server schema
./release.sh          # release (runs the strict gates)
```

Load unpacked: `chrome://extensions` → Developer Mode → Load unpacked → `.output/chrome-mv3/`.

## Stable extension ID

The OAuth redirect URI must stay fixed across dev and Store builds:

1. `pnpm zip` once, drag the `.crx` into `chrome://extensions`, copy the assigned ID.
2. Web Store Developer Dashboard → "Pack extension" → view the public key.
3. Strip newlines, paste into `wxt.config.ts` → `manifest.key`.
4. **Store quirk:** remove `key` for the *first* upload, re-add afterwards.

Dev and Store builds have different IDs permanently — see `EXPECTED_EXTENSION_IDS` in
`src/config/identity.ts`, which must stay in lockstep with the Supabase redirect-URL allowlist.

## Where else to look in this repo

[docs/README.md](docs/README.md) is the index of what is still repo-local: `DEVELOPMENT.md`,
`DATABASE.md`, `DEBUG.md`, `feature-tests.md`, `build-page-kind.md`, the generated tool catalog,
and the docs that belong to neighbouring systems awaiting their own consolidation.

## License

TBD
