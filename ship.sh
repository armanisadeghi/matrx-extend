#!/usr/bin/env bash
# ship.sh — sync this checkout with GitHub, then release. (Arman, 2026-09-24)
#
#   1. scripts/sync-main.py   commits everything uncommitted ("local work not committed by agents
#                             who made them"), merges origin/main, sorts every conflict into
#                             _conflicts/ (auto-fixed / both-versions-kept / held), pushes.
#   2. the release script     scripts/release.sh (or ./release.sh): bumps the version and ships.
#                             Runs whatever happened in step 1. If this repo has no release
#                             script, ship.sh says so and stops after the sync.
#   3. the open items         prints what is open in _conflicts/README.md, if anything, for the
#                             agent that resolves conflicts.
#
# Usage:
#   ./ship.sh                                   # sync + release with the default note
#   ./ship.sh "Added new chat surface"          # sync + release with a note
#   ./ship.sh "note" --minor                    # release flags pass through
#   ./ship.sh "note" --dry-run                  # NO sync; release --dry-run only
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
export RELEASE_STAGE_CALLER_PWD="$PWD"

NOTE="sync and release"
if [[ $# -gt 0 && "$1" != --* ]]; then
    NOTE="$1"
    shift
fi

DRY_RUN=false
for arg in "$@"; do [[ "$arg" == "--dry-run" ]] && DRY_RUN=true; done

# NESTED IN THE AIDREAM MONOREPO (apps/matrx-extend): ONE sync owns the shared checkout, the host
# repository's scripts/sync-main.py (this app's sync refuses its sweep/merge there), and its conflicts are
# listed by the host's check. Standalone the toplevel IS this folder and nothing changes.
# shellcheck source=scripts/app-git.sh
source "$ROOT/scripts/app-git.sh" || exit 1
app_git_layout "$ROOT" || exit 1
SYNC_TOOL="$ROOT/scripts/sync-main.py"
CONFLICT_CHECK="$ROOT/scripts/check-conflict-markers.py"
if app_is_nested; then
    [[ -f "$GIT_TOP/scripts/sync-main.py" ]] && SYNC_TOOL="$GIT_TOP/scripts/sync-main.py"
    [[ -f "$GIT_TOP/scripts/check-conflict-markers.py" ]] && CONFLICT_CHECK="$GIT_TOP/scripts/check-conflict-markers.py"
    echo "ship.sh: nested in $GIT_TOP (${APP_PREFIX%/}) — syncing with $SYNC_TOOL; tags are ${TAG_PREFIX}v*."
fi

RELEASE=""
for candidate in "$ROOT/scripts/release.sh" "$ROOT/release.sh"; do
    [[ -x "$candidate" || -f "$candidate" ]] && { RELEASE="$candidate"; break; }
done

# Serialize sync and release with direct release.sh callers too.
source "$ROOT/scripts/release-owner-lock.sh" || exit 1
trap ship_lock_cleanup EXIT
if ! $DRY_RUN; then
    acquire_ship_lock || exit $?
fi

# ── 1. sync ──────────────────────────────────────────────────────────────────
if $DRY_RUN; then
    echo "ship.sh: --dry-run, so the sync was skipped (it commits and pushes for real)."
    SYNC_RC=0
elif [[ "${MATRX_SHIP_SKIP_SYNC:-}" == "1" ]]; then
    # ship-all already ran the host checkout's sync this round; it covers this app.
    echo "ship.sh: MATRX_SHIP_SKIP_SYNC=1 — the host checkout's sync covers this app; releasing now."
    SYNC_RC=0
else
    python3 "$SYNC_TOOL"
    SYNC_RC=$?
    if [[ $SYNC_RC -ne 0 ]]; then
        echo ""
        echo "ship.sh: the sync did not finish (exit $SYNC_RC; its reason is printed above). Releasing anyway."
    fi
fi

# ── 2. release ───────────────────────────────────────────────────────────────
echo ""
if [[ -n "$RELEASE" ]]; then
    bash "$RELEASE" --message "$NOTE" "$@"
    RELEASE_RC=$?
else
    echo "ship.sh: THIS REPO HAS NO RELEASE SCRIPT (looked for scripts/release.sh and ./release.sh)."
    $DRY_RUN || echo "ship.sh: the sync ran; nothing was released."
    RELEASE_RC=0
fi

# ── 3. open items ────────────────────────────────────────────────────────────
echo ""
if ! $DRY_RUN; then
    if python3 "$CONFLICT_CHECK" >/tmp/ship-conflicts.$$ 2>&1; then
        echo "ship.sh: nothing open in _conflicts/."
    else
        echo "ship.sh: open items in _conflicts/README.md:"
        sed 's/^/  /' /tmp/ship-conflicts.$$
    fi
    rm -f /tmp/ship-conflicts.$$
fi

echo "ship.sh: sync exit $SYNC_RC, release exit $RELEASE_RC"
exit $RELEASE_RC
