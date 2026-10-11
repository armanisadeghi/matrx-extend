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
- _conflicts/2026-10-11-130723/tests/browser/seo-guest-acceptance.mjs.held — LOCAL latest 2026-10-11 13:07; GITHUB latest 2026-10-11 13:08; LOCAL lacks 11 of GITHUB's 12 new lines; GITHUB lacks 6 of LOCAL's 7 new lines; recover: git show e5edfa1310:'tests/browser/seo-guest-acceptance.mjs' / 7742912787:'tests/browser/seo-guest-acceptance.mjs'
- _conflicts/2026-10-11-130723/tests/browser/seo-new-coverage-oracle.mjs.held — LOCAL latest 2026-10-11 13:07; GITHUB latest 2026-10-11 13:08; LOCAL lacks 1 of GITHUB's 1 new lines; GITHUB lacks 1 of LOCAL's 1 new lines; recover: git show e5edfa1310:'tests/browser/seo-new-coverage-oracle.mjs' / 7742912787:'tests/browser/seo-new-coverage-oracle.mjs'
- _conflicts/2026-10-11-130723/tests/browser/seo-new-coverage-oracle.test.mjs.held — LOCAL latest 2026-10-11 13:07; GITHUB latest 2026-10-11 13:08; LOCAL lacks 1 of GITHUB's 1 new lines; GITHUB lacks 1 of LOCAL's 1 new lines; recover: git show e5edfa1310:'tests/browser/seo-new-coverage-oracle.test.mjs' / 7742912787:'tests/browser/seo-new-coverage-oracle.test.mjs'
- _conflicts/2026-10-11-130723/tests/browser/seo-notice-scope.test.mjs.held — LOCAL latest 2026-10-11 13:07; GITHUB latest 2026-10-11 13:08; LOCAL lacks 44 of GITHUB's 50 new lines; GITHUB lacks 12 of LOCAL's 12 new lines; recover: git show e5edfa1310:'tests/browser/seo-notice-scope.test.mjs' / 7742912787:'tests/browser/seo-notice-scope.test.mjs'

## Needs a manager

## Needs the boss agent

## Needs Arman

## Docs and comments — both versions kept
