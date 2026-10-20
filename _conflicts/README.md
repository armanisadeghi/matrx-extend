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
- _conflicts/2026-10-20-005147/pnpm-lock.yaml.held — LOCAL latest 2026-10-20 00:51; GITHUB latest 2026-10-19 23:54; LOCAL lacks 4 of GITHUB's 43 new lines; GITHUB lacks 16 of LOCAL's 55 new lines; recover: git show 237b56fa9f:'pnpm-lock.yaml' / 3e6c34bab4:'pnpm-lock.yaml'

## Needs a manager

## Needs the boss agent

## Needs Arman

## Docs and comments — both versions kept

## Resolution log

- 2026-10-15 — Restored LOCAL BroadcastChannel read/missing telemetry forwarding; retained GITHUB lazy required-credential getters (superseding LOCAL eager bootstrap fallback), live boot refresh, and current config helpers. Focused forwarding/bootstrap tests: 3 passed.
- 2026-10-18 — Claude resolver kept the live lockfile for `_conflicts/2026-10-17-234541/pnpm-lock.yaml.held`: LOCAL (15d9b71630, @ai-matrx bumps to npm latest) is byte-identical to live, which already adopted it. Verified `pnpm install --frozen-lockfile --lockfile-only` exit 0; `check-matrx-packages.mjs` 25 packages at npm latest exactly once.
