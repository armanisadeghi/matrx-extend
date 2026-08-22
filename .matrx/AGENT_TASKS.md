# Agent Tasks

Active worklist managed by agents. **See `AGENT_INSTRUCTIONS.md` for rules** — especially around task format, condensation, and the retention policy for completed tasks.

> Quick scan order for arriving agents:
> 1. **Needs Clarification** below (questions waiting on the user)
> 2. **Blocked** (waiting on external)
> 3. **Active** (`ready` and `in-progress`)
> 4. **Completed** (recent context, condensed — pruned weekly)

> **Highest TASK ID issued: TASK-012.** Never reuse or renumber — increment from here.

---

## Needs Clarification

_(none)_

---

## Blocked

_(none)_

## Active

_(none)_

---

## Completed

> Per the retention policy in `AGENT_INSTRUCTIONS.md`, completed tasks older than
> one week are pruned to keep this list short. Full detail for every completed
> task lives in git history (commit messages + the code itself). Tasks completed
> **within the last week** stay here.

- [TASK-011] Vault management in the side panel — edit details (name / URLs / match rule / notes), change / add / remove field values, delete; new vault route wrappers (PUT value, POST field, DELETE), gated on `can_edit` / `can_manage`; sharing + attachments still link to web `/vault`. `14f6514`. 2026-08-22
- [TASK-012] "Save this login?" page-driven Vault capture — content detector → raw SW host (memory-only candidate, 3-min TTL) → on-page toast + Vault-tab card → save / update existing / never-for-site; Settings → Privacy toggle + never-list; no manifest change (CWS risk gate green); 19 tests incl. plaintext-egress greps. Release note: privacy-policy page wording before the Store upload. 2026-08-22

- [TASK-004] Cloud-sync guidance metadata — `wbx_guidance` table (applied + ledger-recorded), storage-layer push/delete, sign-in hydration (last-write-wins), round-trip unit tests. Guidance now follows the user across machines. 2026-06-10

_(older than the last week — see git history for the May 2026 batch: TASK-001 through TASK-010, voice/audio pipeline, receipts, Pilot, parallel-tab orchestration, screenshot history, tab-assignment, and the mic-permission UX work.)_
