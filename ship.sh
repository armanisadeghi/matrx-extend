#!/usr/bin/env bash
# ship.sh — pass the requested version and note to the validated release path.
#
# Usage:
#   ./ship.sh                                   # release with the default note
#   ./ship.sh "Added new chat surface"          # release with a note
#   ./ship.sh "note" --minor                    # release flags pass through
#   ./ship.sh "note" --dry-run                  # preview only
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
NOTE="release"
if [[ $# -gt 0 && "$1" != --* ]]; then
    NOTE="$1"
    shift
fi

RELEASE=""
for candidate in "$ROOT/scripts/release.sh" "$ROOT/release.sh"; do
    [[ -x "$candidate" || -f "$candidate" ]] && { RELEASE="$candidate"; break; }
done

if [[ -n "$RELEASE" ]]; then
    exec bash "$RELEASE" --message "$NOTE" "$@"
else
    echo "ship.sh: THIS REPO HAS NO RELEASE SCRIPT (looked for scripts/release.sh and ./release.sh)."
    exit 1
fi
