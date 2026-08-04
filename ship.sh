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

# Portable in-place sed. BSD (macOS) sed wants `-i ''`; GNU (Linux) sed
# treats that '' as the script argument and silently misbehaves — the
# original macOS-only form left the key-toggle broken on Linux boxes
# (docs/AUDIT_2026_06_10.md P0-9). A backup suffix works on both; we
# delete the backup immediately.
_sed_inplace() {
    local script="$1" file="$2"
    sed -i.matrxbak -E "$script" "$file"
    rm -f "${file}.matrxbak"
}

# Self-heal wxt.config.ts BEFORE staging. The Chrome Web Store flow requires
# `key:` to be commented out for the upload zip, but the working tree must
# always carry it ACTIVE so dev unpacked installs keep the stable extension
# ID (Supabase OAuth redirect depends on it). If a prior run / manual edit
# left it commented out, git add -A would silently sweep the bad state into
# the next commit — and pre-flight in release.sh would then bail. Restore
# now so neither happens.
WXT_CONFIG="$ROOT/wxt.config.ts"
if [[ -f "$WXT_CONFIG" ]] && grep -qE "^[[:space:]]*// key: '" "$WXT_CONFIG"; then
    echo "[ship] wxt.config.ts has key field commented out — restoring before commit." >&2
    _sed_inplace "s|^([[:space:]]*)// (key: ')|\1\2|" "$WXT_CONFIG"
    if ! grep -qE "^[[:space:]]*key: '" "$WXT_CONFIG"; then
        echo "[ship] FATAL: could not auto-restore key field. Fix wxt.config.ts manually." >&2
        exit 1
    fi
fi

git add -A

if git diff --cached --quiet; then
    echo "[ship] Nothing new to commit — working tree already matches HEAD." >&2
else
    git commit -m "$COMMIT_MSG"
    echo "[ship] Committed: $COMMIT_MSG"
fi

exec "$ROOT/release.sh" "$@"
