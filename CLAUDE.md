# matrx-extend — CLAUDE.md

<!-- nine-laws:start -->
## The laws (synced from `common-docs/policies/the-nine-laws.md` — edit there, never here)

1. **Done means verified, then handoff.** Build it, check types and regressions, use it in localhost as a user would, get an independent check, commit and push. Deploy agents own releases. `common-docs/policies/reality-is-the-referee.md`
2. **Attack before you trust.** Plans are attacked before commitment; "done" is re-verified by someone outside the builder's frame.
3. **Fix the class, never the instance.** Root cause, find the siblings, add a guard proven to fail then pass. A bug you hit yourself is fixed now.
4. **Nothing fails silently.** A stand-in announces itself; a screen is honest or absent; never hide a feature to dodge a defect — fix it. In-app text is layout, not prose. `common-docs/policies/interface-text-is-layout.md`
5. **Think in platform primitives.** Build every capability in the shared layer so all modules and apps inherit it.
6. **Opinions become knobs.** Organizations decide, never agents. Validation offers, never blocks. Defaults lean open.
7. **Delegate down, never sideways.** The starting session owns the task end to end; name every subagent's lane; never message another task. `common-docs/policies/subagent-model-ladder.md`
8. **A delta is not a status.** Lead with current truth and every open item.
9. **Raise the bar.** Name the world champion, match it, beat it. `common-docs/policies/champions.md`
10. **Talk to Arman like a person.** Plain English, in the chat, no paths or codenames. Tell him your decision and reason; ask only what is truly his. `common-docs/policies/talk-to-arman-like-a-person.md`
11. **Credentials change everywhere or not at all.** Never rotate a password, key or token unless the same change updates every vault, `.env` and server that uses it. A leaked credential beats a lockout.
12. **Finish your own work first.** Raise anything outside your task only when it blocks you. Never add security obstacles on your own authority; removing them is welcome.

Also binding: the Data Doctrine (`common-docs/systems/architecture/database/DECISIONS.md`), the access ladder (`common-docs/policies/access-ladder.md`), canonical-first triage (`common-docs/policies/canonical-first-triage.md`), agents never author agents (`common-docs/policies/agents-never-author-agents.md`), and the domain tree (`common-docs/policies/domain-tree.md`).
<!-- nine-laws:end -->

- 🚨 **The active organization is never a list filter** (Arman, 2026-09-30): lists and reads show everything the person can see across all their organizations; an org filter is a visible page-local control defaulting to **All organizations**; the active org is only where new things are saved and which org a server call runs in — every write/API call must carry it. Law: `../common-docs/policies/access-ladder.md`.

**Cloud task autonomy:** A task request authorizes routine in-scope edits, verification, exact-path commits, and pushes. Continue without a conversational confirmation pause; honor explicit hold points and human-only gates. [Completion policy](../common-docs/policies/reality-is-the-referee.md).


**You are here to do CHROME-EXTENSION work** (charter: `/Users/armanisadeghi/code/common-docs/policies/document-types.md`).
This file carries the extension-specific rules that prevent this repo's mistakes, plus pointers
to the shared systems it consumes — never feature narratives, shipped-work history, rule bodies
with a canonical doc, or platform doctrine. Feature state lives in
[/Users/armanisadeghi/code/common-docs/systems/apps/extension/STATE.md](/Users/armanisadeghi/code/common-docs/systems/apps/extension/STATE.md) (update THAT, not this, when you ship).
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

**Release: you run it.** This repo is NOT on the twice-hourly release train (only `aidream` and
`ai-matrx` are). Whoever works here releases their own work: when your change is verified,
run `./release.sh` from `origin/main` before you finish — do not leave it for "the release
agent"; there is none for this repo. Expected cadence is about one release a day. A daily
scheduled sweep only catches what a session forgot; it is a safety net, not the plan.

## Platform laws (one-liners — the rule bodies live at the links)

- **The Platform List is Arman's alone.** Never read it at session start: a hook on Arman's Mac tells the first attended session of the day when a row is due, and only that session tells him (he snoozes by naming a new date). Only Arman adds, kills, or removes a row. Agents suggest in plain English and never write copies, histories, or "deleted" notes anywhere. Skill: `platform-list`.
- **Mandates / no hardcoded agents.** Which agent/version/model runs is a DATABASE
  answer resolved at run time by `mandate_key` — never a constant. This repo has ZERO
  Mandate coverage and known hardcoded agent UUIDs (`AiExtractTab.tsx`,
  `lib/agenda/constants.ts`; rollout rows E1/E2). Law:
  `/Users/armanisadeghi/code/common-docs/systems/mandates/STATE.md` · why clients
  drift: `/Users/armanisadeghi/code/common-docs/policies/clients-consume-never-reimplement.md`
- **No unapproved schedules.** Every scheduled task exists only with Arman's approval
  by name and interval, registered + claimed via `schedule_claim`:
  `/Users/armanisadeghi/code/common-docs/operations/scheduled-tasks.md`
- **THE USER-INPUT LAW.** Structured information is never passed as user text — it
  becomes named variables or context:
  `/Users/armanisadeghi/code/common-docs/systems/agents/agent-variable-binding/FEATURE.md`
- **Limits are knobs, agents set them.** Never hardcode a cap/timeout/quota as a
  constant: `/Users/armanisadeghi/code/common-docs/policies/limits-are-knobs-agents-set-them.md`
- **No legacy — UNTIL GO-LIVE** (~90 days from 2026-09-10; nobody outside us depends on us yet). No
  shims, no compatibility layers, no dead code left behind; every touched package moves to latest.
  Revisited on go-live day when customer-facing edges get versioned stability — never permanent:
  `/Users/armanisadeghi/code/common-docs/policies/no-legacy.md` + `/Users/armanisadeghi/code/common-docs/policies/pre-launch-mode.md`
- **The access ladder decides who can open a record.** Every table starts at Organization; only Arman approves Confidential or Private; sharing sits outside the ladder; children inherit their parent; organizations are unlimited and equal, with no personal type. → `/Users/armanisadeghi/code/common-docs/policies/access-ladder.md`
- **Human steps are guided sessions:**
  `/Users/armanisadeghi/code/common-docs/policies/talk-to-arman-like-a-person.md`

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
site, never fall back to the first, signup, or system organization, and never re-add a `whoami` round trip to
ask the server which org it "carried". A new sink attaches the header or refuses to send.
Only what the person set ON THIS DEVICE counts — a saved account-level default never builds a
request and the organization created at signup is never a fallback; with nothing set the request
HOLDS on `holdForActiveOrganizationId()`, the picker opens, and it resumes with their choice.
Guard: `pnpm check:org-default-ban`. Register row EX-T05: `../common-docs/projects/no-db-assigned-org/PLAN.md`.

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
- **Arman's preference (2026-09-18): change the database directly through the Supabase MCP** (project `brsgrqvjdzwihsvnfqkf`). The database is the source of truth, and type/model generation PULLS from it into the codebase. A migration FILE is fine only if you OWN it end to end: write it, apply it, regenerate, and confirm it broke nothing. If you will not own it end to end, use the MCP. **Never hand Arman a command to run — he does not use terminals.**
- A `.sql` file in `migrations/` changes nothing until applied from aidream
  (`python db/apply_migrations.py --source matrx-extend`). Verify: `pnpm check:migrations`.

**Tab context.**
- Handlers never query the active tab — use `getAssignedTab(ctx)` /
  `getAssignedTabId(ctx)` from
  [src/lib/tools/handlers/_active-tab.ts](./src/lib/tools/handlers/_active-tab.ts).
  The agent stays pinned to its per-turn assigned tab even when the user switches.
- Request assembly resolves the active tab ONCE per send (`resolveActiveTab()`) and
  threads it through; a second query reintroduces a cross-tab race. Contract:
  [/Users/armanisadeghi/code/common-docs/systems/apps/extension/WIRE_CONTRACT.md §1](/Users/armanisadeghi/code/common-docs/systems/apps/extension/WIRE_CONTRACT.md).

**Context keys are public API.** Engineers template `{{page_brief.title}}` into
prompts; renames are breaking changes. Key catalog + the bundling rules (menu cost,
one source of truth per fact, no shallow empty keys, confidence gating):
[/Users/armanisadeghi/code/common-docs/systems/apps/extension/WIRE_CONTRACT.md §2](/Users/armanisadeghi/code/common-docs/systems/apps/extension/WIRE_CONTRACT.md) — update it
in the same commit as any key change.

**Structured content: NEVER parse a stream here.** `render_block` envelopes render through the
SHARED packages (`@ai-matrx/content-ir` + `@ai-matrx/content-ir-react`) — wiring
[src/lib/content-ir/](./src/lib/content-ir/), components + dispatch
[src/components/kinds/](./src/components/kinds/). Detection is SERVER-SIDE for thin clients by
design; a client-side kind parser is the banned "bespoke stream renderer". A kind draws as a real
component only when a `content_ir.kind_component` row (`platform='chrome-extension'`) names a key
in `dispatch.tsx` — two explicit halves, no silent fallback; anything else gets the generic floor.
Both packages are exact public npm dependencies; committed package tarballs are forbidden. SoR:
`common-docs/systems/architecture/content-ir/FEATURE.md`. Raw stream / markdown parsing
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
  [/Users/armanisadeghi/code/common-docs/systems/apps/extension/STATE.md](/Users/armanisadeghi/code/common-docs/systems/apps/extension/STATE.md) § Reviewed Gmail send · cross-repo:
  `/Users/armanisadeghi/code/common-docs/projects/google-oauth-verification/PRODUCTION-ROLLOUT.md`.
- `credential_login` + Vault: plaintext credentials never egress (grep-guarded tests);
  redaction contract in [src/lib/credentials/sensitive-fields.ts](./src/lib/credentials/sensitive-fields.ts).
  Handoff: `/Users/armanisadeghi/code/common-docs/projects/credential-sharing-browser-login/HANDOFF.md`.
- `capture_prospect`: posts to the platform's ONE prospect-import path; never a second
  create path, never a client-side normalizer. Contract:
  `/Users/armanisadeghi/code/common-docs/projects/outreach-system/INTEGRATION_MAP.md` (IC-10).
- Token broker: consume [src/lib/broker/](./src/lib/broker/) (its FEATURE.md is the
  contract) — never hand-roll a mint call, cache, or gateway URL. System:
  `/Users/armanisadeghi/code/common-docs/systems/architecture/token-broker/FEATURE.md`.

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

[/Users/armanisadeghi/code/common-docs/systems/apps/extension/STATE.md](/Users/armanisadeghi/code/common-docs/systems/apps/extension/STATE.md) — living feature state; update on every
ship · [docs/DATABASE.md](./docs/DATABASE.md) — DB rules ·
[docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) — setup, commands, conventions, TS
toolchain · [/Users/armanisadeghi/code/common-docs/systems/apps/extension/WIRE_CONTRACT.md](/Users/armanisadeghi/code/common-docs/systems/apps/extension/WIRE_CONTRACT.md) —
wire contract · [docs/feature-tests.md](./docs/feature-tests.md) — how to verify
anything · [docs/TOOLS.generated.md](./docs/TOOLS.generated.md) — tool descriptions
(generated).

File traffic: this extension is **not** cut over to the standalone file service — its
`/files`, `/assets` and `/share` calls still ride the general backend base URL.
Cross-repo system-of-record:
[/Users/armanisadeghi/code/common-docs/systems/media/file-service/STATE.md](/Users/armanisadeghi/code/common-docs/systems/media/file-service/STATE.md)
— read it before touching this feature in ANY repo.

- **Logging into any Matrx UI**: sign in as `admin@admin.com` — the password is `AI_ADMIN_PASSWORD` in the `.env` of `aidream` or `matrx-frontend` (`AI_ADMIN_USERNAME` holds the email).

## 🚨 THE LATEST LAW — @ai-matrx packages are NEVER pinned (pre-launch rule)

**Pre-launch rule:** absolute until go-live (~90 days from 2026-09-10) because no customer code depends
on us yet; on go-live day the customer-facing edges get a versioned path while internals stay on latest.
Never quote it as permanent: `../common-docs/policies/pre-launch-mode.md`.

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
