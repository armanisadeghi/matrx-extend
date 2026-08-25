# Matrx Extend — Developer Docs

🚨 **Everything about what this extension IS, what it does, how it is wired, and what it
contracts with other repos now lives in ONE place:**
`/Users/armanisadeghi/code/common-docs/systems/clients/extension/` — read it before touching
this feature in ANY repo.

| Question | Doc |
|---|---|
| What exists today, what is pending | `.../extension/STATE.md` |
| Every cross-repo channel (aidream / matrx-local / matrx-frontend / scheduling) | `.../extension/CHANNELS.md` |
| Request payload, context keys, stream, resume | `.../extension/WIRE_CONTRACT.md` |
| MV3 contexts, messaging, auth, streaming, tool dispatch | `.../extension/ARCHITECTURE.md` |
| Settled rulings | `.../extension/DECISIONS.md` |
| Open work | `.../extension/HANDOFF.md` |
| Chrome Web Store identity, review record, listing copy | `.../extension/CHROME-WEB-STORE.md` |

## What is still local to this repo

- **[DEVELOPMENT.md](DEVELOPMENT.md)** — setup, daily commands, TypeScript toolchain, gotchas.
- **[DATABASE.md](DATABASE.md)** — schema-routing rules and the hazards that bite here.
- **[DEBUG.md](DEBUG.md)** — driving the admin-only Debug tab.
- **[feature-tests.md](feature-tests.md)** — how a human verifies any shipped feature.
- **[build-page-kind.md](build-page-kind.md)** — adding a page-kind detector or context bundle.
- **[TOOLS.generated.md](TOOLS.generated.md)** — generated from the DB; never hand-edited.
- **[../.claude/skills/matrx-oauth/SKILL.md](../.claude/skills/matrx-oauth/SKILL.md)** — the OAuth playbook.
- **[../migrations/README.md](../migrations/README.md)** — SQL migration apply order.

Docs here that belong to a NEIGHBOUR system and are queued for their own consolidation run:
`SCHEDULING.md` (the `sch_*` spine), `UI_FIRST_TOOLS.md` (the tool registry), `RESEARCH_*.md`
(the research capture pipeline), `BROKER_SETUP_REQUESTS.md` (the token broker),
`ABOUT-MATRX.md` (the platform's own harness/context narrative). `AUDIT_2026_06_10.md`,
`context-bloat-findings.md`, `safari-analysis.md` and `safari-port-gap-analysis.md` are
single-repo research and worklists.
