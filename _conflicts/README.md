# Merge conflicts from scripts/sync-main.py

This folder is permanent. When every list below is empty, nothing from `scripts/sync-main.py` is
open in this repo. (`scripts/sync-main.py` removes empty folders left inside it on every run.)

## What the items are
- **Held file** — `_conflicts/<stamp>/<path>.held`. LOCAL and GITHUB changed the same code.
  GITHUB's version is live in the repo at `<path>`; LOCAL's version is inside the `.held` file,
  below a FACTS block computed from git. Both versions stay in git permanently; each `.held` file
  has the `git show` commands that print either one.
- **Docs/comments, both versions kept** — a file in the repo where a clashing passage now holds
  both versions between three marker lines (LOCAL first, then GITHUB).

## Marking an item done
- Held file: the final code is in `<path>`, the `.held` file is deleted, its line below is deleted.
- Docs/comments: the passage is edited, the three marker lines are deleted, its line below is deleted.
- `python3 scripts/check-conflict-markers.py` lists everything still open, or prints `clean`.
- `python3 scripts/sync-main.py` commits and syncs.

## Escalation
An item is passed up by moving its line to the next section (Needs a manager -> Needs the boss
agent -> Needs Arman) with ` — <question> — <what was checked> — <who>` added to the end of it.
Its files stay as they are.

## Held files

## Needs a manager

## Needs the boss agent

## Needs Arman

## Docs and comments — both versions kept

## Resolution log

- 2026-10-20 — Kept the live lockfile for the 00:51 held copy: all six LOCAL @ai-matrx package upgrades are present, and GITHUB's newer caniuse-lite 1.0.30001817 is the only remaining difference. Frozen install and package checks verified the combined lock.
- 2026-10-15 — Restored LOCAL BroadcastChannel read/missing telemetry forwarding; retained GITHUB lazy required-credential getters (superseding LOCAL eager bootstrap fallback), live boot refresh, and current config helpers. Focused forwarding/bootstrap tests: 3 passed.

- 2026-10-23 — Resolved the 22:14 held pnpm lock: its exact 8da5d407 payload was already reconciled by hosted graph 40063741216. Kept canonical 4a6def320 lock 0b1b9917, retaining all five held Matrx upgrades and newer Alchemy/Rich Content versions, plus subsequent Agents 270, Records 145, Records UI 109 and Rich Content 310. The canonical lock retains mdast-util-to-markdown 2.0.1 instead of the held 2.0.0 downgrade. Independent comparison verified only those four version/integrity advances after the accepted hosted graph; consumer compatibility and release checks are recorded separately. No edited-session owner was found in the prior exact-lock ownership audit.
