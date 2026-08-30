# matrx-extend — CLAUDE.md

## The six laws (SYNCED — canonical: common-docs/skills/campaign-pattern; edit there, never here)

🚨 **MANDATORY: before launching, coordinating, or working any large build or campaign, READ the full doctrine — it is IN THIS REPO at `.claude/skills/campaign-pattern/SKILL.md`.**

1. **Done means done — never on your own word.** Finished = verified by someone who did not build it, against the original vision, on the live surface, with real data. Tests feeding manufactured data to their author's own code prove nothing and are defects.
2. **Attack before you trust.** Hole-poke plans before commitment; adversarially re-verify "done" before believing it.
3. **Fix the class, never the instance.** Root cause → census the siblings → a guard proven failing-then-passing.
4. **Nothing fails silently.** Every stand-in announces itself with a remedy; a screen is absent or honest — never dead, disabled-looking, or lying.
5. **Think in platform primitives.** Never scope a capability to the feature that surfaced it; build it in the shared layer so every module and client app inherits it.
6. **Opinions become knobs.** Behavioral choices are org-configurable settings; organizations decide — never agents, never hardcoded taste.


**You are here to do CHROME-EXTENSION work** (charter: `/Users/armanisadeghi/code/common-docs/policies/claude-md-charter.md`).
This file carries the extension-specific rules that prevent this repo's mistakes, plus pointers
to the shared systems it consumes — never feature narratives, shipped-work history, rule bodies
with a canonical doc, or platform doctrine. Feature state lives in
[/Users/armanisadeghi/code/common-docs/systems/clients/extension/STATE.md](/Users/armanisadeghi/code/common-docs/systems/clients/extension/STATE.md) (update THAT, not this, when you ship).
Budget: ≤200 lines; over budget = relocate, don't append.

## What this repo is

Chrome extension (WXT, MV3, React sidepanel) — the browser-agent harness for AI Matrx.
A **streaming client of the aidream server** (SSE chat runs, tool dispatch); all **data goes
direct to Supabase** (never through the Python server); **tool definitions and descriptions
live in the shared DB**, not here. The user is a brilliant, absolutely non-technical Subject
Matter Expert: `/Users/armanisadeghi/code/common-docs/systems/ai-dream-platform/USER.md`.

🚨 **Cross-repo system-of-record: `/Users/armanisadeghi/code/common-docs/systems/clients/extension/` — read it before touching this feature in ANY repo.** `STATE.md` (what exists) · `CHANNELS.md` (every cross-repo channel) · `WIRE_CONTRACT.md` · `ARCHITECTURE.md` · `DECISIONS.md` · `HANDOFF.md` · `CHROME-WEB-STORE.md`. Nothing in this repo restates them.
- Outbound work to a sibling → invoke `connect-aidream` · `connect-local` · `connect-frontend`.

## Shared checkout — many concurrent writers is NORMAL

Arman plus dozens of agents edit this checkout simultaneously; `origin/main` is the only sync
point. Commit and push as you go; never run tree-wide destructive git; never request your own
branch/worktree. Full ruling: workspace root [`../CLAUDE.md`](../CLAUDE.md) § Shared checkout.

## Platform laws (one-liners — the rule bodies live at the links)

- **Mandates / no hardcoded agents.** Which agent/version/model runs is a DATABASE
  answer resolved at run time by `mandate_key` — never a constant. This repo has ZERO
  Mandate coverage and known hardcoded agent UUIDs (`AiExtractTab.tsx`,
  `lib/agenda/constants.ts`; rollout rows E1/E2). Law:
  `/Users/armanisadeghi/code/common-docs/systems/mandates/RUNTIME.md` · why clients
  drift: `/Users/armanisadeghi/code/common-docs/policies/clients-consume-never-reimplement.md`
- **No unapproved schedules.** Every scheduled task exists only with Arman's approval
  by name and interval, registered + claimed via `schedule_claim`:
  `/Users/armanisadeghi/code/common-docs/operations/scheduled-tasks.md`
- **THE USER-INPUT LAW.** Structured information is never passed as user text — it
  becomes named variables or context:
  `/Users/armanisadeghi/code/common-docs/systems/agents/agent-variable-binding/FEATURE.md`
- **Limits are knobs, agents set them.** Never hardcode a cap/timeout/quota as a
  constant: `/Users/armanisadeghi/code/common-docs/policies/limits-are-knobs-agents-set-them.md`
- **No legacy.** No shims, no compatibility layers, no dead code left behind:
  `/Users/armanisadeghi/code/common-docs/policies/no-legacy.md`
- **Human steps are guided sessions:**
  `/Users/armanisadeghi/code/common-docs/policies/human-steps-are-guided-sessions.md`

## Hard rules for this repo

**Agent-start contract.** Every agent-start request sends `conversation_id` (client-minted,
always) + `is_new` + `store`; aidream 422s anything else. `AgentStartRequest` in
[src/lib/api/routes/ai.ts](./src/lib/api/routes/ai.ts) marks all three required. Contract:
`/Users/armanisadeghi/code/common-docs/systems/agents/conversation-start-contract/FEATURE.md`.

**Organization on every request.** Identity and organization travel together: every
authenticated backend call carries `X-Organization-Id` and every org-scoped write sends
the same id. The server refuses an authenticated request without one at the top
(`aidream@8e5ee0b93`) and never picks one for you. The ONE resolver is
[src/lib/org/active-org.ts](./src/lib/org/active-org.ts) — never resolve an org at a call
site, never fall back to first/personal/system, and never re-add a `whoami` round trip to
ask the server which org it "carried". A new sink attaches the header or refuses to send.
Register row EX-T05: `../common-docs/projects/no-db-assigned-org/PLAN.md`.

**Tool system.**
- Canonical vocabulary (Tool / Registered / Inline / Executor / Binding / Surface /
  Arming / Bundle / Gate) — copy verbatim, never paraphrase:
  [common-docs/systems/agents/agent-tools/DECISIONS.md](common-docs/systems/agents/agent-tools/DECISIONS.md)
  · registry schema: `/Users/armanisadeghi/code/common-docs/systems/agents/agent-tools/STATE.md`.
- Registered tools live in `tool.definition` + `tool.binding`
  (`executor_name='chrome-extension'`) + `tool.surface_defaults`. These tables were
  renamed TWICE (`tl_*` → `tool_*` → `tool.*` schema); only the last names exist.
- **Descriptions live ONLY in the DB** (common-docs/systems/agents/agent-tools/STATE.md):
  never add a `description` to a `ToolHandler` or `.describe()` to its Zod args. UI reads them live
  via [src/lib/tools/descriptions.ts](./src/lib/tools/descriptions.ts). To change a tool: change
  `tool.definition` first, then align the Zod until `pnpm catalog:tools:drift` is quiet.
- Categories ([src/lib/tools/categories.ts](./src/lib/tools/categories.ts)) are pure UX —
  grouping + discovery, NEVER routing. The advertised surface is `CANONICAL_SURFACE`; the live
  roster is `pnpm catalog:tools:md` → [types/tool-catalog.md](./types/tool-catalog.md). Don't
  hand-maintain tool tables.
- After any handler change: `pnpm catalog:tools:md` + `pnpm docs:tools`, commit the
  regenerated files. DB drift gate: `scripts/check-tool-db-drift.ts` (in `release.sh`).

**Database.** Full rules: [docs/DATABASE.md](./docs/DATABASE.md). The hazards:
- ONE connection, ONE variable name: `WXT_SUPABASE_URL` / `WXT_SUPABASE_PUBLISHABLE_KEY`,
  required, no fallback chains. Law:
  `/Users/armanisadeghi/code/common-docs/policies/package-vs-implementation.md`.
- The DB is multi-schema; `public` is NOT where our tables live, and nothing in the
  build catches a wrong schema (it 404s at runtime with PGRST205). Never hand-write
  `.schema('x')` — use the accessors in
  [src/lib/supabase/schemas.ts](./src/lib/supabase/schemas.ts) (`extendDb()`,
  `schedulerDb()`, `workbenchDb()`, `chatDb()`, `usersDb()`, `adminDb()`, `toolDb()`,
  `aiDb()`). RPCs did NOT move — call `.rpc()` on the plain client. Gate:
  `pnpm check:schema-routing` (strict in CI + `release.sh`).
- Ownership columns differ per table (some `created_by`, some kept `user_id`, two have
  neither) — check [docs/DATABASE.md](./docs/DATABASE.md) before filtering; guessing
  corrupts data. Every org-scoped INSERT sends an explicit `organization_id`; database
  assignment is forbidden. Emergency: `../common-docs/projects/no-db-assigned-org/PLAN.md`.
- A `.sql` file in `migrations/` changes nothing until applied from aidream
  (`python db/apply_migrations.py --source matrx-extend`). Verify: `pnpm check:migrations`.

**Tab context.**
- Handlers never query the active tab — use `getAssignedTab(ctx)` /
  `getAssignedTabId(ctx)` from
  [src/lib/tools/handlers/_active-tab.ts](./src/lib/tools/handlers/_active-tab.ts).
  The agent stays pinned to its per-turn assigned tab even when the user switches.
- Request assembly resolves the active tab ONCE per send (`resolveActiveTab()`) and
  threads it through; a second query reintroduces a cross-tab race. Contract:
  [/Users/armanisadeghi/code/common-docs/systems/clients/extension/WIRE_CONTRACT.md §1](/Users/armanisadeghi/code/common-docs/systems/clients/extension/WIRE_CONTRACT.md).

**Context keys are public API.** Engineers template `{{page_brief.title}}` into
prompts; renames are breaking changes. Key catalog + the bundling rules (menu cost,
one source of truth per fact, no shallow empty keys, confidence gating):
[/Users/armanisadeghi/code/common-docs/systems/clients/extension/WIRE_CONTRACT.md §2](/Users/armanisadeghi/code/common-docs/systems/clients/extension/WIRE_CONTRACT.md) — update it
in the same commit as any key change.

**Structured content: NEVER parse a stream here.** `render_block` envelopes render through the
SHARED packages (`@ai-matrx/content-ir` + `@ai-matrx/content-ir-react`) — wiring
[src/lib/content-ir/](./src/lib/content-ir/), components + dispatch
[src/components/kinds/](./src/components/kinds/). Detection is SERVER-SIDE for thin clients by
design; a client-side kind parser is the banned "bespoke stream renderer". A kind draws as a real
component only when a `content_ir.kind_component` row (`platform='chrome-extension'`) names a key
in `dispatch.tsx` — two explicit halves, no silent fallback; anything else gets the generic floor.
Both packages are exact public npm dependencies; committed package tarballs are forbidden. SoR:
`common-docs/systems/content-ir-twin/FEATURE.md`. Raw stream / markdown parsing
([src/lib/api/stream.ts](./src/lib/api/stream.ts),
[src/components/markdown/block-parser.ts](./src/components/markdown/block-parser.ts)) is next to
adopt the kernel — read `common-docs/projects/unified-content-pipeline/FEATURE.md` first. Stream-silence rule: any event that implies expected silence (like
`provider_retry` backoff) must `hold()` the stall watchdog
([src/lib/stream/provider-retry.ts](./src/lib/stream/provider-retry.ts)) or it reads
as a hang and kills a healthy run.

**Build/toolchain gotchas** (bodies + verification steps in
[docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md)):
- Env vars: literal `import.meta.env.WXT_*` reads inside per-var getters in
  `src/config/env.ts` — never dynamic access, never a generic `getEnv(key)`.
- No top-level `chrome.*` reads — catalog scripts import every handler under `tsx`.
- `chrome.scripting.executeScript` args must be JSON-serializable — coerce optional
  args with `?? null`, never pass `undefined`.
- TypeScript is a DUAL install: native TS 7 provides `tsc`; `typescript` resolves to
  the 6.0 API for `openapi-typescript`. Never `pnpm add typescript@latest`, never
  invoke `tsc` by path, never set `typescript.tsdk` in VS Code.
  `exactOptionalPropertyTypes` is on: for serialized/persisted objects, omit the key
  (`...(x !== undefined && { key: x })`) — never widen the type.
- After any handler/config/env change, run `pnpm catalog:tools:md`; a crash means a
  new top-level import offender.

**Sensitive flows — read the linked contract before touching:**
- `google_email_send`: the review card IS the authorization; never add a server
  binding or a consent-style argument. Repo detail:
  [/Users/armanisadeghi/code/common-docs/systems/clients/extension/STATE.md](/Users/armanisadeghi/code/common-docs/systems/clients/extension/STATE.md) § Reviewed Gmail send · cross-repo:
  `/Users/armanisadeghi/code/common-docs/projects/google-oauth-verification/PRODUCTION-ROLLOUT.md`.
- `credential_login` + Vault: plaintext credentials never egress (grep-guarded tests);
  redaction contract in [src/lib/credentials/sensitive-fields.ts](./src/lib/credentials/sensitive-fields.ts).
  Handoff: `/Users/armanisadeghi/code/common-docs/projects/credential-sharing-browser-login/HANDOFF.md`.
- `capture_prospect`: posts to the platform's ONE prospect-import path; never a second
  create path, never a client-side normalizer. Contract:
  `/Users/armanisadeghi/code/common-docs/projects/outreach-system/INTEGRATION_MAP.md` (IC-10).
- Token broker: consume [src/lib/broker/](./src/lib/broker/) (its FEATURE.md is the
  contract) — never hand-roll a mint call, cache, or gateway URL. System:
  `/Users/armanisadeghi/code/common-docs/systems/platform/token-broker/FEATURE.md`.

## Conventions

- Admin-only first for risky new capabilities; promote to GA after testing. Scary
  permissions → `optional_permissions` + runtime request from Settings.
- Feature-detect every API; return `{ ok: false, reason: 'unavailable' }`, never
  throw. Privileged tier always prompts — even in Act mode; no silent writes.
- Reuse existing primitives (`src/lib/scrape/`, `src/lib/data-pattern/`, `src/lib/chat/context/`) before building a new extractor/collector/parser.
- Every user-visible change updates [docs/feature-tests.md](./docs/feature-tests.md) (what it does → where to test → steps → expected) before commit.
- Web Store identity: dev and Store builds have different extension IDs;
  `EXPECTED_EXTENSION_IDS` in [src/config/identity.ts](./src/config/identity.ts) and
  the Supabase redirect-URL allowlist are the same set — new build channel = update
  both. Incident: [.research/v0.1.4-auth-incident.md](./.research/v0.1.4-auth-incident.md).

## Architecture in one glance

```
sidepanel (React) ─STREAM_START→ SW ─STREAM_RUN→ offscreen (holds long SSE; SW dies >30s)
SW tool dispatcher (src/lib/tools/dispatch.ts): validate args (Zod) → permission gate
(read / action / ask-user / privileged × Ask/Act mode) → handler → POST tool result →
broadcast TOOL_TIMELINE_EVENT
```

Key files: registry + handlers under [src/lib/tools/](./src/lib/tools/) · chat context
[src/lib/chat/context/](./src/lib/chat/context/) · approval cards
`src/features/chat/Agent*Card.tsx` · manual tool runner `src/features/tools/ToolsView.tsx`.

## Commands

```bash
pnpm dev                  # WXT dev server
pnpm compile              # typecheck (~1s, native TS 7)
pnpm catalog:tools:md     # regenerate tool catalog (docs:tools for DB-sourced docs)
pnpm check:schema-routing # schema-routing gate (check:migrations for the ledger)
./release.sh              # release (runs the strict gates)
```

## Where the detail lives

[/Users/armanisadeghi/code/common-docs/systems/clients/extension/STATE.md](/Users/armanisadeghi/code/common-docs/systems/clients/extension/STATE.md) — living feature state; update on every
ship · [docs/DATABASE.md](./docs/DATABASE.md) — DB rules ·
[docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) — setup, commands, conventions, TS
toolchain · [/Users/armanisadeghi/code/common-docs/systems/clients/extension/WIRE_CONTRACT.md](/Users/armanisadeghi/code/common-docs/systems/clients/extension/WIRE_CONTRACT.md) —
wire contract · [docs/feature-tests.md](./docs/feature-tests.md) — how to verify
anything · [docs/TOOLS.generated.md](./docs/TOOLS.generated.md) — tool descriptions
(generated).

File traffic: this extension is **not** cut over to the standalone file service — its
`/files`, `/assets` and `/share` calls still ride the general backend base URL.
Cross-repo system-of-record:
[/Users/armanisadeghi/code/common-docs/systems/media/file-service/STATE.md](/Users/armanisadeghi/code/common-docs/systems/media/file-service/STATE.md)
— read it before touching this feature in ANY repo.

- **Logging into any Matrx UI**: sign in as `admin@admin.com` — the password is `AI_ADMIN_PASSWORD` in the `.env` of `aidream` or `matrx-frontend` (`AI_ADMIN_USERNAME` holds the email).

## 🚨 THE LATEST LAW — @ai-matrx packages are NEVER pinned

Every `@ai-matrx/*` dependency in this repo is declared `"latest"` — never a version, never a
range. Guard: `pnpm check:matrx-packages` (fails on any pin AND on an installed version that
is behind npm latest; `check:matrx-latest` is an alias). It is BLOCKING in `release.sh` — this
repo cannot ship stale. Version problems are fixed by
releasing forward, never by pinning — a pin licenses silent drift and workaround code (the
disaster that nearly killed AI Dream). Law + rationale:
`../common-docs/policies/typescript-package-standard.md` § THE LATEST LAW.

**THE SAME-SESSION LAW:** a fix that belongs in an `@ai-matrx/*` package is made IN the
package (`aidream/apps/shared/<name>`), released, and adopted in the same session — never
massaged in host code, never left edited-unpublished. **THE CATCH-UP RULE:** working here,
refresh `@ai-matrx/*` to latest and reconcile per each package's CHANGELOG `Consumer action`s
before this repo's next release. Both: same policy, § THE SAME-SESSION LAW + § THE CATCH-UP
RULE.
