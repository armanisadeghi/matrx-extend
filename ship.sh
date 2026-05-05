#!/usr/bin/env bash
# ship.sh — Stage everything, commit with your message, then run ./release.sh.
#
# Thin wrapper. The real work lives in release.sh — versioning, type sync,
# typecheck, dual-zip build (local + store), key-field swap, tag, push, and
# the Chrome Web Store upload instructions.
#
# Usage:
#   ./ship.sh "feat: describe your change"
#   ./ship.sh "fix: thing"          --minor
#   ./ship.sh "chore: bump deps"    --major
#   ./ship.sh "wip: testing"        --dry-run
#
# Extra flags after the message are forwarded verbatim to release.sh
# (--patch | --minor | --major | --dry-run | --skip-types |
#  --skip-typecheck | --no-push).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [[ $# -lt 1 ]]; then
    echo "Usage: ./ship.sh \"commit message\" [release.sh flags...]" >&2
    echo "  Example: ./ship.sh \"feat: add new tool\" --minor" >&2
    exit 1
fi

COMMIT_MSG="$1"
shift

git add -A

if git diff --cached --quiet; then
    echo "[ship] Nothing new to commit — working tree already matches HEAD." >&2
else
    git commit -m "$COMMIT_MSG"
    echo "[ship] Committed: $COMMIT_MSG"
fi

exec "$ROOT/release.sh" "$@"
