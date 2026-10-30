#!/usr/bin/env bash
# Evidence lives OUTSIDE git (Arman 2026-10-29: "the big things don't live directly in our git").
# Writers keep writing where they always did — docs/stabilization/ (except the committed
# resource-policy.json), .research/ and tmp/ — and those folders are gitignored. Whatever must survive
# this machine is uploaded here, to the private data-lifecycle archive bucket (all public access
# blocked; archive/ moves to Glacier Instant Retrieval after 30 days, still readable at once):
#
#   s3://matrx-data-lifecycle-872515272894/archive/dev-evidence/matrx-extend/<folder>/<same relative path>
#
#   scripts/evidence-upload.sh                     sync every evidence folder that exists here (new/changed files)
#   scripts/evidence-upload.sh docs/stabilization  one folder (or a file/subfolder inside one)
#   scripts/evidence-upload.sh --dry-run [...]     print what would be uploaded; change nothing
#   scripts/evidence-upload.sh --list [<folder>]   what the archive already holds
#
# EVIDENCE_S3_URI overrides the destination (tests and rehearsals use a test prefix). Uploads never
# delete anything in the archive. Needs the aws CLI with this account's credentials (as Desktop's
# releases do); without them it says so and exits 3, so a writer can report "evidence kept local only".
set -uo pipefail
APP="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${EVIDENCE_S3_URI:-s3://matrx-data-lifecycle-872515272894/archive/dev-evidence/matrx-extend}"
DEST="${DEST%/}"
FOLDERS=(docs/stabilization .research tmp)
DRY=(); LIST=false; WANT=()
for a in "$@"; do
    case "$a" in
        --dry-run) DRY=(--dryrun) ;;
        --list) LIST=true ;;
        -h|--help) sed -n '2,19p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) WANT+=("${a%/}") ;;
    esac
done
command -v aws >/dev/null 2>&1 || { echo "evidence-upload: no aws CLI here — evidence stays local only" >&2; exit 3; }
if $LIST; then
    exec aws s3 ls --recursive "$DEST/${WANT[0]:-}"
fi
[[ ${#WANT[@]} -gt 0 ]] || WANT=("${FOLDERS[@]}")
rc=0
for w in "${WANT[@]}"; do
    ok=false
    for f in "${FOLDERS[@]}"; do [[ "$w" == "$f" || "$w" == "$f/"* ]] && ok=true; done
    $ok || { echo "evidence-upload: $w is not under an evidence folder (${FOLDERS[*]})" >&2; rc=2; continue; }
    src="$APP/$w"
    [[ -e "$src" ]] || continue
    if [[ -d "$src" ]]; then set -- sync "$src" "$DEST/$w" --exclude 'node_modules/*' --exclude '*/node_modules/*' --exclude '.DS_Store'
    else set -- cp "$src" "$DEST/$w"; fi
    if [[ ${#DRY[@]} -gt 0 ]]; then
        aws s3 "$1" --dryrun --no-progress "${@:2}" > "${TMPDIR:-/tmp}/evidence-upload.$$" || rc=1
        echo "evidence-upload: $w — $(grep -c . "${TMPDIR:-/tmp}/evidence-upload.$$") file(s) would upload"
        head -5 "${TMPDIR:-/tmp}/evidence-upload.$$"; rm -f "${TMPDIR:-/tmp}/evidence-upload.$$"
    else
        aws s3 "$1" --only-show-errors --no-progress "${@:2}" || rc=1
    fi
done
[[ $rc == 0 ]] && echo "evidence-upload: ${WANT[*]} -> $DEST${DRY:+ (dry run)}"
exit $rc
