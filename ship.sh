#!/usr/bin/env bash
# ship.sh — pull GitHub's main into this checkout, then pass the note to the validated release path.
#
#   1. pull      fetch origin/main and merge it into local main. Pull only: it never commits
#                uncommitted work and never pushes (release.sh owns publication, EXT-D-0002).
#                Runs whether or not the release later passes: from 2026-09-25 to 2026-09-26
#                the pull lived only at the end of a SUCCESSFUL release, so every refused
#                release left this checkout 21 commits behind GitHub while ship-all ran on.
#   2. release   release.sh: build, check, and publish the candidate atomically.
#
# Usage:
#   ./ship.sh                                   # pull + release with the default note
#   ./ship.sh "Added new chat surface"          # pull + release with a note
#   ./ship.sh "note" --minor                    # release flags pass through
#   ./ship.sh "note" --dry-run                  # preview only: no pull, no release
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
NOTE="release"
if [[ $# -gt 0 && "$1" != --* ]]; then
    NOTE="$1"
    shift
fi

PREVIEW=false
for arg in "$@"; do [[ "$arg" == "--dry-run" || "$arg" == "--no-push" ]] && PREVIEW=true; done

RELEASE=""
for candidate in "$ROOT/scripts/release.sh" "$ROOT/release.sh"; do
    [[ -x "$candidate" || -f "$candidate" ]] && { RELEASE="$candidate"; break; }
done

# ── 1. pull ──────────────────────────────────────────────────────────────────
pull_main() {
    local branch behind
    branch="$(git symbolic-ref -q --short HEAD)"
    if [[ "$branch" != "main" ]]; then
        echo "ship.sh: PULL SKIPPED: this checkout is on '${branch:-detached HEAD}', not main."
        return 1
    fi
    if ! git fetch -q origin main; then
        echo "ship.sh: PULL FAILED: could not fetch origin/main from GitHub."
        return 1
    fi
    behind="$(git rev-list --count HEAD..origin/main)"
    if [[ "$behind" -eq 0 ]]; then
        echo "ship.sh: pull: already has everything on GitHub's main."
        return 0
    fi
    if ! git merge-base --is-ancestor HEAD origin/main \
        && ! git merge-tree --write-tree HEAD origin/main >/dev/null 2>&1; then
        echo "ship.sh: PULL FAILED: local commits conflict with the $behind commit(s) on GitHub's main."
        echo "ship.sh:   fix: git merge origin/main   (resolve, commit, then run ./ship.sh again)"
        return 1
    fi
    # --ff when HEAD is behind only; a local merge commit when it also has unpushed commits.
    # git refuses (and changes nothing) when an uncommitted file here would be overwritten.
    if git merge -q --no-edit origin/main; then
        echo "ship.sh: pull: brought in $behind commit(s) from GitHub's main."
        return 0
    fi
    echo "ship.sh: PULL FAILED: uncommitted files here overlap the $behind incoming commit(s); nothing was changed."
    echo "ship.sh:   fix: commit those files, then run ./ship.sh again"
    return 1
}

if $PREVIEW; then
    echo "ship.sh: preview, so the pull was skipped."
    SYNC_RC=0
else
    pull_main
    SYNC_RC=$?
fi

# ── 2. release ───────────────────────────────────────────────────────────────
echo ""
if [[ -n "$RELEASE" ]]; then
    bash "$RELEASE" --message "$NOTE" "$@"
    RELEASE_RC=$?
else
    echo "ship.sh: THIS REPO HAS NO RELEASE SCRIPT (looked for scripts/release.sh and ./release.sh)."
    RELEASE_RC=1
fi

# ship-all reads this line; "sync" here is the pull.
echo "ship.sh: sync exit $SYNC_RC, release exit $RELEASE_RC"
[[ $RELEASE_RC -ne 0 ]] && exit $RELEASE_RC
exit $SYNC_RC
