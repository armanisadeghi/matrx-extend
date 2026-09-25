#!/usr/bin/env bash
# release.sh — Ship matrx-extend: bump, tag, push; then check and package it.
#
# Usage (./ship.sh calls it as: bash release.sh --message "<note>" <flags>):
#   ./release.sh                        # patch bump (default)
#   ./release.sh --minor | --major
#   ./release.sh --message "note"       # commit "release: vX.Y.Z - note"
#   ./release.sh --skip-types           # do not regenerate types/python-generated
#   ./release.sh --skip-catalog         # do not regenerate the tool catalog / check its drift
#   ./release.sh --skip-typecheck       # do not run tsc after the push
#   ./release.sh --dry-run              # say what would ship; change nothing
#   ./release.sh --no-push              # same as --dry-run (a WARNING says so)
#
# ══ THE RULES (Arman, 2026-09-24) ════════════════════════════════════════════
# A release script NEVER denies a release. Not a failing test, a typecheck, a
# dirty tree, a diverged branch, a taken tag or a bad flag. It runs fast,
# reports WARNINGS and ERRORS only (never INFO), releases, and shuts up.
# The ONLY hard stops: GitHub unreachable after retries, the current version
# cannot be read, or the push loses the race five times in a row.
#
# ══ BEFORE THE PUSH — only what makes the pushed code better ═════════════════
#   1. fetch origin/main (3 tries)                         ← hard stop #1
#   2. assemble the release tree on origin/main with git plumbing (temp index,
#      no worktree, no stash, no rebase, no reset). This checkout's unpushed
#      commits are merged in with `git merge-tree`; a conflict ships origin/main
#      plus an ERROR finding. The working tree is never read or touched, so a
#      dirty tree is irrelevant.
#   3. regenerate the committed artifacts in a throwaway export of that tree:
#      types/python-generated (update-api-types), types/tool-catalog.{json,md}
#      (catalog:tools:md), docs/TOOLS.generated.md (docs:tools). A failure is a
#      finding; the release carries whatever did regenerate.
#   4. bump package.json (a taken tag, local or remote, bumps past it — a tag
#      is never moved), commit-tree, `git push origin <sha>:refs/heads/main`.
#      A lost race refetches, rebuilds on the new main and retries (5x) ← #3;
#      network blips are retried separately.
#   5. push the tag; fast-forward this checkout (WARNING if it cannot).
#   6. print ONE line:   vX.Y.Z  pushed  (Ns)
#
# ══ AFTER THE PUSH — everything we would complain about ══════════════════════
# In throwaway exports of the released commit (never this checkout, so the
# zips are exactly the tagged bytes), in parallel:
#   checks: typecheck, unit tests, schema routing, @ai-matrx package currency,
#     package twins, canonical pickers, archived-items law, org-default ban,
#     swallowed refusals, tool-catalog ↔ DB drift, migration ledger, mandate
#     references (WARNING only).
#   build: STORE zip (MATRX_CWS_BUILD=1: no dev key) + store-package and
#     Chrome Web Store policy-surface checks → .output/matrx-extend-<v>-store.zip;
#     LOCAL zip (dev key kept, stable ID cihdmkcdjjckfhjpgoedmgfpoljebaml) →
#     .output/matrx-extend-<v>-local.zip; promote the keyed bundle into both
#     installed unpacked paths (.output/chrome-mv3-dev/ and .output/chrome-mv3/)
#     and write .output/release-receipt.json.
# Each failure is an ERROR finding naming what failed and the command to
# re-run. Findings print as one opened-and-closed section per category; with
# no findings nothing prints. The last line is where the store zip is.
#
# The full detail of every run: tmp/release-logs/release-<stamp>.log
# (+ latest.log, + release-vX.Y.Z.log). Gitignored (*.log).
#
# Guard: scripts/test-release-ship-path.sh — a dirty tree, a diverged branch,
# a foreign push mid-release, a taken tag, a bad flag and failing unit tests
# must still end with the tag on origin, exit 0, and an ERROR in Checks.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR"
cd "$REPO_ROOT" || exit 1

# ── Log capture: the terminal shows only the ship line and findings ─────────
if [[ -z "${RELEASE_LOG_CAPTURED:-}" ]]; then
    RELEASE_LOG_DIR="$REPO_ROOT/tmp/release-logs"
    mkdir -p "$RELEASE_LOG_DIR"
    RELEASE_LOG_STAMP="$(date +%Y-%m-%d_%H-%M-%S)"
    RELEASE_LOG_FILE="$RELEASE_LOG_DIR/release-${RELEASE_LOG_STAMP}.log"
    {
        echo "=== matrx-extend release.sh ==="
        echo "started_utc: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
        echo "cwd:         $REPO_ROOT"
        echo "args:        ${*:-<none>}"
        echo "pid:         $$"
        echo "==============================="
    } > "$RELEASE_LOG_FILE"
    ln -sfn "$(basename "$RELEASE_LOG_FILE")" "$RELEASE_LOG_DIR/latest.log"
    export RELEASE_LOG_CAPTURED=1 RELEASE_LOG_DIR RELEASE_LOG_FILE
    bash "${BASH_SOURCE[0]}" "$@" 2>&1 | tee -a "$RELEASE_LOG_FILE"
    status=${PIPESTATUS[0]}
    echo "=== end (exit $status, $(date -u +%Y-%m-%dT%H:%M:%SZ)) ===" >> "$RELEASE_LOG_FILE"
    exit "$status"
fi
RELEASE_LOG_FILE="${RELEASE_LOG_FILE:-/dev/null}"

PROJECT_NAME="matrx-extend"
VERSION_FILE="package.json"
OUTPUT_DIR="$REPO_ROOT/.output"
REMOTE="origin"
BRANCH="main"
WEBSTORE_UPLOAD_URL="https://chrome.google.com/webstore/devconsole"
GENERATED_PATHS=(types/python-generated types/tool-catalog.json types/tool-catalog.md docs/TOOLS.generated.md)
SHIP_PUSH_ATTEMPTS=5
SHIP_START=$SECONDS
GIT_ABS_DIR="$(git rev-parse --absolute-git-dir 2>/dev/null)"

# ── Findings ─────────────────────────────────────────────────────────────────
FINDINGS=()
finding() { FINDINGS+=("$1|$2|$3|${4:-}"); log "FINDING $1 [$2] $3${4:+ → $4}"; }   # LEVEL CATEGORY text [remedy]
log()     { printf '[%4ss] %s\n' "$((SECONDS - SHIP_START))" "$*" >> "$RELEASE_LOG_FILE"; }
quiet()   { "$@" >> "$RELEASE_LOG_FILE" 2>&1; }
hard_stop() {
    echo "RELEASE STOPPED: $* — see tmp/release-logs/latest.log" >&2
    print_findings
    exit 1
}
# One section per category, opened and closed. Nothing prints when clean.
print_findings() {
    [[ ${#FINDINGS[@]} -gt 0 ]] || return 0
    local row r cat seen="|" bar="===================="
    local f_level f_cat f_text f_remedy
    for row in "${FINDINGS[@]}"; do
        IFS='|' read -r _ cat _ _ <<< "$row"
        [[ "$seen" == *"|$cat|"* ]] && continue
        seen+="$cat|"
        echo ""
        echo "$bar $cat $bar"
        printf '%-8s %-12s %s\n' "LEVEL" "CATEGORY" "FINDING"
        for r in "${FINDINGS[@]}"; do
            IFS='|' read -r f_level f_cat f_text f_remedy <<< "$r"
            [[ "$f_cat" == "$cat" ]] || continue
            printf '%-8s %-12s %s%s\n' "$f_level" "$f_cat" "$f_text" "${f_remedy:+  → $f_remedy}"
        done
        echo ""
        echo "$bar End of $cat $bar"
    done
}
bounded() {  # seconds cmd... — a hung tool becomes a finding, never an endless wait
    local secs="$1"; shift
    if command -v timeout >/dev/null 2>&1; then timeout "$secs" "$@"
    elif command -v gtimeout >/dev/null 2>&1; then gtimeout "$secs" "$@"
    else "$@"; fi
}

# ── Flags: a bad one is a WARNING, never a refusal ───────────────────────────
BUMP_TYPE="patch"; CUSTOM_MESSAGE=""; DRY_RUN=false
SKIP_TYPES=false; SKIP_TYPECHECK=false; SKIP_CATALOG=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --patch) BUMP_TYPE="patch"; shift ;;
        --minor) BUMP_TYPE="minor"; shift ;;
        --major) BUMP_TYPE="major"; shift ;;
        --message|-m)
            if [[ -n "${2:-}" && "${2:-}" != --* ]]; then CUSTOM_MESSAGE="$2"; shift 2
            else finding "WARNING" "Invocation" "--message had no text — released without a note"; shift; fi ;;
        --skip-types) SKIP_TYPES=true; shift ;;
        --skip-typecheck) SKIP_TYPECHECK=true; shift ;;
        --skip-catalog) SKIP_CATALOG=true; shift ;;
        --dry-run) DRY_RUN=true; shift ;;
        --no-push) DRY_RUN=true
            finding "WARNING" "Invocation" "--no-push ran as --dry-run: nothing was built, tagged or pushed" "./release.sh"; shift ;;
        -h|--help) grep '^#' "${BASH_SOURCE[0]}" | head -14 | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) finding "WARNING" "Invocation" "Unknown flag '$1' was ignored" "--patch --minor --major --message --skip-types --skip-catalog --skip-typecheck --dry-run"
           shift ;;
    esac
done

bump_version() {  # current → NEW_VERSION per BUMP_TYPE (patch-skips taken tags)
    local maj min pat
    IFS='.' read -r maj min pat <<< "$1"
    pat="${pat%%[!0-9]*}"
    case "$BUMP_TYPE" in
        patch) pat=$((pat + 1)) ;;
        minor) min=$((min + 1)); pat=0 ;;
        major) maj=$((maj + 1)); min=0; pat=0 ;;
    esac
    while tag_taken "v${maj}.${min}.${pat}"; do pat=$((pat + 1)); done
    NEW_VERSION="${maj}.${min}.${pat}"
    NEW_TAG="v${NEW_VERSION}"
}
REMOTE_TAGS=""
tag_taken() {
    git rev-parse -q --verify "refs/tags/$1" >/dev/null && return 0
    grep -q "refs/tags/$1\$" <<< "$REMOTE_TAGS"
}
read_version_at() { git cat-file -p "$1:$VERSION_FILE" 2>/dev/null | sed -n 's/^  "version": "\([^"]*\)".*/\1/p' | head -1; }
commit_message() {
    local note="${CUSTOM_MESSAGE#release: }"
    if [[ -n "$note" && "$note" != "$1"* ]]; then echo "release: $1 - ${note}"
    elif [[ -n "$note" ]]; then echo "release: ${note}"
    else echo "release: $1"; fi
}

# ── Throwaway export of a commit/tree (never this checkout) ─────────────────
# <root>/matrx-extend holds the files; node_modules and ../aidream are symlinks
# to the real ones, and the untracked .env files are copied, so every pnpm
# script behaves as it does here — against exactly the released bytes.
SNAP_ROOTS=()
cleanup() {
    local d
    for d in ${SNAP_ROOTS[@]+"${SNAP_ROOTS[@]}"}; do [[ -n "$d" && -d "$d" ]] && rm -rf -- "$d"; done
    release_lock_cleanup
}
export_snapshot() {  # treeish head-commit [prepare] → sets SNAP_DIR (never call it in $(…): SNAP_ROOTS must record it)
    local root dir f
    SNAP_DIR=""
    root="$(mktemp -d "${TMPDIR:-/tmp}/matrx-extend-release.XXXXXX")" || return 1
    SNAP_ROOTS+=("$root")
    dir="$root/$PROJECT_NAME"
    mkdir -p "$dir"
    git archive "$1" | tar -x -C "$dir" || return 1
    # Its own tiny git repo at the released commit (objects borrowed through
    # alternates, nothing written back here), so checks that run `git ls-files`
    # or read HEAD see exactly the release.
    ( cd "$dir" && git init -q \
        && echo "$GIT_ABS_DIR/objects" > .git/objects/info/alternates \
        && printf 'node_modules\n' >> .git/info/exclude \
        && git update-ref HEAD "$2" && git read-tree "$1" && git update-index -q --refresh ) >> "$RELEASE_LOG_FILE" 2>&1 \
        || log "snapshot git setup failed for ${1:0:9} (checks that read git may fail)"
    [[ -d "$REPO_ROOT/node_modules" ]] && ln -s "$REPO_ROOT/node_modules" "$dir/node_modules"
    [[ -d "$REPO_ROOT/../aidream" ]] && ln -s "$(cd "$REPO_ROOT/../aidream" && pwd)" "$root/aidream"
    for f in "$REPO_ROOT"/.env*; do
        [[ -f "$f" && ! -e "$dir/$(basename "$f")" ]] && cp "$f" "$dir/"
    done
    # tsconfig extends .wxt/tsconfig.json (the @/ path alias): generate it.
    [[ "${3:-}" == prepare ]] && ( cd "$dir" && bounded 120 pnpm -s exec wxt prepare ) >> "$RELEASE_LOG_FILE" 2>&1
    SNAP_DIR="$dir"
}

# ── One release at a time (atomic mkdir; a dead or stuck owner is taken over) ─
RELEASE_LOCK_DIR="$(git rev-parse --git-path matrx-release-ship.lock 2>/dev/null || echo "$REPO_ROOT/.git/matrx-release-ship.lock")"
RELEASE_LOCK_HELD=false
release_lock_cleanup() {
    if $RELEASE_LOCK_HELD && [[ "$(cat "$RELEASE_LOCK_DIR/pid" 2>/dev/null)" == "$$" ]]; then
        rm -f -- "$RELEASE_LOCK_DIR/pid"; rmdir -- "$RELEASE_LOCK_DIR" 2>/dev/null
    fi
    RELEASE_LOCK_HELD=false
}
acquire_release_lock() {
    local owner waited=0
    while true; do
        if mkdir "$RELEASE_LOCK_DIR" 2>/dev/null; then
            echo "$$" > "$RELEASE_LOCK_DIR/pid"; RELEASE_LOCK_HELD=true; return 0
        fi
        owner="$(cat "$RELEASE_LOCK_DIR/pid" 2>/dev/null)"
        if [[ "$owner" =~ ^[0-9]+$ ]] && kill -0 "$owner" 2>/dev/null && (( waited < 60 )); then
            sleep 1; waited=$((waited + 1)); continue
        fi
        [[ "$owner" =~ ^[0-9]+$ ]] && kill -0 "$owner" 2>/dev/null \
            && finding "WARNING" "Git" "Release lock held by PID $owner for 60s — taken over so this release could ship"
        rm -f -- "$RELEASE_LOCK_DIR/pid"; rmdir -- "$RELEASE_LOCK_DIR" 2>/dev/null
    done
}
trap cleanup EXIT

# ── Fetch: the one thing that can stop a release before it starts ───────────
fetch_main() {
    local i
    for i in 1 2 3; do
        quiet git fetch --quiet "$REMOTE" "$BRANCH" && return 0
        sleep $((i * 2))
    done
    return 1
}

# ── Dry run ──────────────────────────────────────────────────────────────────
if $DRY_RUN; then
    fetch_main || hard_stop "cannot reach GitHub ($REMOTE/$BRANCH)"
    REMOTE_TAGS="$(git ls-remote --tags "$REMOTE" 'refs/tags/v*' 2>/dev/null)"
    CUR="$(read_version_at "$REMOTE/$BRANCH")"
    [[ -n "$CUR" ]] || hard_stop "cannot read the version from $VERSION_FILE on $REMOTE/$BRANCH"
    bump_version "$CUR"
    echo "dry run: $REMOTE/$BRANCH is $CUR; would release $NEW_TAG as '$(commit_message "$NEW_TAG")'"
    AHEAD="$(git rev-list --count "$REMOTE/$BRANCH..HEAD" 2>/dev/null || echo 0)"
    [[ "$AHEAD" -gt 0 ]] && echo "dry run: would merge $AHEAD local commit(s) not on $REMOTE/$BRANCH"
    print_findings
    exit 0
fi

# ══ THE SHIP PATH ════════════════════════════════════════════════════════════
acquire_release_lock
fetch_main || hard_stop "cannot reach GitHub ($REMOTE/$BRANCH) after 3 tries — nothing was changed"
log "fetched $REMOTE/$BRANCH"

LOCAL_HEAD="$(git rev-parse HEAD)"
if [[ "$(git rev-parse --abbrev-ref HEAD)" != "$BRANCH" ]]; then
    finding "WARNING" "Git" "This checkout is on '$(git rev-parse --abbrev-ref HEAD)', not $BRANCH — its commits were not merged into the release" "git checkout main"
    LOCAL_HEAD="$(git rev-parse "$REMOTE/$BRANCH")"
fi
MERGE_CONFLICT_REPORTED=false
base_tree() {  # sets BASE, BASE_TREE, PARENTS
    BASE="$(git rev-parse "$REMOTE/$BRANCH")"
    PARENTS=(-p "$BASE")
    if git merge-base --is-ancestor "$LOCAL_HEAD" "$BASE" 2>/dev/null; then
        BASE_TREE="$(git rev-parse "$BASE^{tree}")"; return 0
    fi
    local merged
    if merged="$(git merge-tree --write-tree "$BASE" "$LOCAL_HEAD" 2>/dev/null)"; then
        BASE_TREE="$merged"
        PARENTS=(-p "$BASE" -p "$LOCAL_HEAD")
    else
        BASE_TREE="$(git rev-parse "$BASE^{tree}")"
        $MERGE_CONFLICT_REPORTED || finding "ERROR" "Git" "Local commits conflict with $REMOTE/$BRANCH — shipped $BRANCH without ${LOCAL_HEAD:0:9}" "git pull --no-rebase origin main"
        MERGE_CONFLICT_REPORTED=true
    fi
}
base_tree
log "release tree assembled on ${BASE:0:9}"

# ── Regenerate the committed artifacts (a failure is a finding) ─────────────
REGEN_INFO=""   # `git update-index --index-info` lines for the regenerated paths
regen_artifacts() {
    local snap jobs=() name rc idx tree paths=() p
    export_snapshot "$BASE_TREE" "$BASE" prepare && snap="$SNAP_DIR" || { finding "ERROR" "Generate" "Could not export the release tree to regenerate artifacts" ""; return; }
    local jd; jd="$(dirname "$snap")/jobs"; mkdir -p "$jd"
    $SKIP_TYPES   || { ( cd "$snap" && bounded 180 pnpm -s update-api-types --skip-typecheck ) > "$jd/api-types.out" 2>&1; echo $? > "$jd/api-types.rc"; } &
    $SKIP_CATALOG || { ( cd "$snap" && bounded 180 pnpm -s catalog:tools:md ) > "$jd/catalog.out" 2>&1; echo $? > "$jd/catalog.rc"; } &
    { ( cd "$snap" && bounded 120 pnpm -s docs:tools ) > "$jd/docs.out" 2>&1; echo $? > "$jd/docs.rc"; } &
    wait
    for name in api-types catalog docs; do
        [[ -f "$jd/$name.rc" ]] || continue
        rc="$(cat "$jd/$name.rc")"
        { echo "--- regen $name (exit $rc) ---"; cat "$jd/$name.out"; } >> "$RELEASE_LOG_FILE"
        [[ "$rc" == 0 ]] && continue
        case "$name" in
            api-types) finding "ERROR" "Generate" "Server API types did not regenerate (exit $rc) — types/python-generated shipped as it was" "pnpm update-api-types" ;;
            catalog)   finding "WARNING" "Generate" "Tool catalog did not regenerate (exit $rc) — types/tool-catalog.* shipped as they were" "pnpm catalog:tools:md" ;;
            docs)      finding "WARNING" "Generate" "docs/TOOLS.generated.md did not regenerate (exit $rc)" "pnpm docs:tools" ;;
        esac
    done
    $SKIP_TYPES && finding "WARNING" "Generate" "--skip-types: types/python-generated was not regenerated" "pnpm update-api-types"
    $SKIP_CATALOG && finding "WARNING" "Generate" "--skip-catalog: the tool catalog was not regenerated or drift-checked" "pnpm catalog:tools:md && pnpm catalog:tools:drift:strict"
    for p in "${GENERATED_PATHS[@]}"; do
        if [[ -e "$snap/$p" ]] || git cat-file -e "$BASE_TREE:$p" 2>/dev/null; then paths+=("$p"); fi
    done
    [[ ${#paths[@]} -gt 0 ]] || return
    idx="$(mktemp)"; rm -f "$idx"
    if GIT_INDEX_FILE="$idx" git read-tree "$BASE_TREE" \
        && ( cd "$snap" && GIT_DIR="$GIT_ABS_DIR" GIT_WORK_TREE="$snap" GIT_INDEX_FILE="$idx" git add -A -- "${paths[@]}" ) >> "$RELEASE_LOG_FILE" 2>&1 \
        && tree="$(GIT_INDEX_FILE="$idx" git write-tree)"; then
        REGEN_INFO="$(git diff-tree -r --no-renames "$BASE_TREE" "$tree" -- "${paths[@]}" | awk -F'\t' '{
            split($1, m, " "); if (m[5] == "D") printf "0 0000000000000000000000000000000000000000\t%s\n", $2;
            else printf "%s %s\t%s\n", m[2], m[4], $2 }')"
        log "regenerated: $(grep -c . <<< "$REGEN_INFO") path(s) changed"
    else
        finding "ERROR" "Generate" "Regenerated artifacts could not be staged into the release commit" ""
    fi
    rm -f "$idx"
}
regen_artifacts

build_commit() {  # CURRENT_VERSION NEW_VERSION COMMIT_MSG → RELEASE_SHA
    local idx blob tree
    idx="$(mktemp)"; rm -f "$idx"
    GIT_INDEX_FILE="$idx" git read-tree "$BASE_TREE" || return 1
    if [[ -n "$REGEN_INFO" ]]; then
        printf '%s\n' "$REGEN_INFO" | GIT_INDEX_FILE="$idx" git update-index --index-info || return 1
    fi
    blob="$(git cat-file -p "$BASE_TREE:$VERSION_FILE" \
        | sed "s/^  \"version\": \"${CURRENT_VERSION}\"/  \"version\": \"${NEW_VERSION}\"/" \
        | git hash-object -w --stdin)" || return 1
    [[ "$(git cat-file -p "$blob" | sed -n 's/^  "version": "\([^"]*\)".*/\1/p' | head -1)" == "$NEW_VERSION" ]] || return 1
    GIT_INDEX_FILE="$idx" git update-index --cacheinfo "100644,$blob,$VERSION_FILE" || return 1
    tree="$(GIT_INDEX_FILE="$idx" git write-tree)" || return 1
    rm -f "$idx"
    RELEASE_SHA="$(git commit-tree "$tree" "${PARENTS[@]}" -m "$COMMIT_MSG")" || return 1
}

# ── Bump, commit, push (a lost race rebuilds on the new main) ───────────────
REMOTE_TAGS="$(git ls-remote --tags "$REMOTE" 'refs/tags/v*' 2>/dev/null)"
PUSHED=false; RACES=0; BLIPS=0
while (( RACES < SHIP_PUSH_ATTEMPTS && BLIPS < 10 )); do
    CURRENT_VERSION="$(read_version_at "$BASE_TREE")"
    [[ -n "$CURRENT_VERSION" ]] || hard_stop "cannot read the version from $VERSION_FILE on $REMOTE/$BRANCH — nothing was pushed"
    bump_version "$CURRENT_VERSION"
    COMMIT_MSG="$(commit_message "$NEW_TAG")"
    build_commit || hard_stop "could not assemble the release commit for $NEW_VERSION — nothing was pushed"
    # Test hook: the ship-path guard lands a foreign push here to prove the race retry.
    [[ -n "${RELEASE_TEST_BEFORE_PUSH:-}" ]] && bash -c "$RELEASE_TEST_BEFORE_PUSH" >/dev/null 2>&1
    if quiet git push "$REMOTE" "${RELEASE_SHA}:refs/heads/$BRANCH"; then PUSHED=true; break; fi
    SEEN="$(git rev-parse "$REMOTE/$BRANCH")"
    if quiet git fetch --quiet "$REMOTE" "$BRANCH" && [[ "$(git rev-parse "$REMOTE/$BRANCH")" != "$SEEN" ]]; then
        RACES=$((RACES + 1)); log "lost push race $RACES — rebuilding on the new $BRANCH"
    else
        BLIPS=$((BLIPS + 1)); log "push failed without $BRANCH moving (network?) — retry $BLIPS"; sleep $((BLIPS * 3))
    fi
    REMOTE_TAGS="$(git ls-remote --tags "$REMOTE" 'refs/tags/v*' 2>/dev/null || echo "$REMOTE_TAGS")"
    base_tree
done
if ! $PUSHED; then
    (( RACES >= SHIP_PUSH_ATTEMPTS )) && hard_stop "lost the push race $SHIP_PUSH_ATTEMPTS times in a row — nothing was released; run it again"
    hard_stop "cannot push to GitHub ($REMOTE/$BRANCH) — nothing was released"
fi
log "pushed ${RELEASE_SHA:0:9} as $COMMIT_MSG"

if ! quiet git tag "$NEW_TAG" "$RELEASE_SHA" || ! quiet git push "$REMOTE" "refs/tags/$NEW_TAG"; then
    finding "ERROR" "Git" "Tag $NEW_TAG did not reach $REMOTE" "git tag $NEW_TAG ${RELEASE_SHA:0:9} && git push origin $NEW_TAG"
fi
[[ -n "${RELEASE_LOG_DIR:-}" ]] && ln -sfn "$(basename "$RELEASE_LOG_FILE")" "$RELEASE_LOG_DIR/release-${NEW_TAG}.log"
if [[ "$(git rev-parse --abbrev-ref HEAD)" == "$BRANCH" ]]; then
    quiet git merge --ff-only "$REMOTE/$BRANCH" \
        || finding "WARNING" "Git" "This checkout could not fast-forward to $NEW_TAG — pull when convenient" "git pull --no-rebase origin main"
fi
release_lock_cleanup
echo "${NEW_TAG}  pushed  ($((SECONDS - SHIP_START))s)"

# ══ AFTER THE PUSH: checks and packaging (findings only, never a stop) ══════
CHECK_SNAP=""; BUILD_SNAP=""
export_snapshot "$RELEASE_SHA" "$RELEASE_SHA" prepare && CHECK_SNAP="$SNAP_DIR"
export_snapshot "$RELEASE_SHA" "$RELEASE_SHA" && BUILD_SNAP="$SNAP_DIR"
JOBS="$(mktemp -d "${TMPDIR:-/tmp}/matrx-extend-release-jobs.XXXXXX")"; SNAP_ROOTS+=("$JOBS")

# name|seconds|level|what failed|remedy|command
CHECKS=()
$SKIP_TYPECHECK || CHECKS+=("typecheck|600|ERROR|typecheck failed|pnpm compile|pnpm -s compile")
CHECKS+=(
    "unit-tests|900|ERROR|unit tests failed|pnpm test|pnpm -s test"
    "schema-routing|300|ERROR|unqualified Supabase table routing (404s at runtime)|pnpm check:schema-routing|pnpm -s check:schema-routing:strict"
    "matrx-packages|300|ERROR|@ai-matrx packages are stale or pinned|pnpm sync:matrx-packages|pnpm -s check:matrx-packages"
    "package-twins|300|ERROR|package logic re-grown outside its @ai-matrx package|pnpm check:package-twins|pnpm -s check:package-twins"
    "canonical-pickers|300|ERROR|an alternate agent picker was reintroduced|pnpm check:canonical-pickers|pnpm -s check:canonical-pickers"
    "archived-items|300|ERROR|a list hides archived rows with no way to reveal them|pnpm check:archived-items-law|pnpm -s check:archived-items-law"
    "archived-items-self-test|300|ERROR|the archived-items detector can no longer fail|pnpm check:archived-items-law:self-test|pnpm -s check:archived-items-law:self-test"
    "org-default-ban|300|ERROR|a default organization is back (never a saved default or the personal org)|pnpm check:org-default-ban|pnpm -s check:org-default-ban"
    "org-default-ban-self-test|300|ERROR|the org-default-ban detector can no longer fail|pnpm check:org-default-ban:self-test|pnpm -s check:org-default-ban:self-test"
    "swallowed-refusals|300|ERROR|a server refusal is swallowed silently|pnpm check:swallowed-refusals|pnpm -s check:swallowed-refusals"
    "migrations|300|ERROR|unapplied migrations (or the ledger was unreachable)|pnpm check:migrations|pnpm -s check:migrations:strict"
)
$SKIP_CATALOG || CHECKS+=("tool-drift|300|ERROR|tool catalog drifted from the DB (the LLM and the dispatcher disagree)|pnpm catalog:tools:drift|pnpm -s catalog:tools:drift:strict")
command -v uvx >/dev/null 2>&1 \
    && CHECKS+=("mandate-references|300|WARNING|the mandate reference scan did not complete — this build is UNMEASURED on the fleet board|pnpm check:mandate-references|pnpm -s check:mandate-references") \
    || finding "WARNING" "Checks" "uvx is missing, so no mandate references were reported" "install uv (https://astral.sh/uv)"

run_checks() {
    local row name secs
    for row in "${CHECKS[@]}"; do
        IFS='|' read -r name secs _ _ _ cmd <<< "$row"
        { ( cd "$CHECK_SNAP" && eval "bounded $secs $cmd" ) > "$JOBS/check-$name.out" 2>&1; echo $? > "$JOBS/check-$name.rc"; } &
    done
    wait
}

# Store FIRST, local SECOND: the last build owns .output/chrome-mv3, and the
# keyed bundle is promoted into both paths used by existing Chrome profiles
# (stable dev ID; the Supabase OAuth redirect is registered against it).
# The Store rejects any
# upload that carries the dev key (incident: .research/v0.1.4-auth-incident.md).
STORE_ZIP="$OUTPUT_DIR/${PROJECT_NAME}-${NEW_VERSION}-store.zip"
LOCAL_ZIP="$OUTPUT_DIR/${PROJECT_NAME}-${NEW_VERSION}-local.zip"
build_zips() {  # writes $JOBS/build.findings (level|text|remedy per line)
    local out="$JOBS/build.findings" wxt_zip=".output/${PROJECT_NAME}-${NEW_VERSION}-chrome.zip"
    : > "$out"
    bf() { printf '%s|%s|%s\n' "$1" "$2" "${3:-}" >> "$out"; }
    cd "$BUILD_SNAP" || { bf ERROR "could not enter the build export" ""; return; }
    # Only this version's zips stay in .output/, so the Store upload picker
    # cannot offer a stale one (v0.1.14 was rejected exactly that way).
    mkdir -p "$OUTPUT_DIR"
    find "$OUTPUT_DIR" -maxdepth 1 -type f \( -name "${PROJECT_NAME}-*-store.zip" -o -name "${PROJECT_NAME}-*-local.zip" -o -name "${PROJECT_NAME}-*-chrome.zip" \) -delete
    if ! MATRX_CWS_BUILD=1 bounded 600 pnpm -s exec wxt zip || [[ ! -f "$wxt_zip" ]]; then
        bf ERROR "STORE zip was not built for $NEW_TAG" "git checkout $NEW_TAG && pnpm zip:store"
    else
        node scripts/check-store-package.mjs \
            || bf ERROR "STORE package check failed (side panel / permissions / popup / key) — do not upload" "pnpm zip:store"
        node scripts/check-cws-release-risk.mjs \
            || bf ERROR "STORE manifest policy surface differs from the Google-approved baseline — expect a new review" "pnpm check:cws-risk"
        if unzip -p "$wxt_zip" manifest.json 2>/dev/null | grep -q '"key"'; then
            bf ERROR "STORE zip contains the dev key — the Store will reject it; not copied" "pnpm zip:store"
        else
            cp "$wxt_zip" "$STORE_ZIP" || bf ERROR "could not copy the STORE zip to $STORE_ZIP" ""
        fi
        rm -f "$wxt_zip"
    fi
    if ! bounded 600 pnpm -s exec wxt zip || [[ ! -f "$wxt_zip" ]]; then
        bf ERROR "LOCAL zip was not built for $NEW_TAG — .output/chrome-mv3-dev/ was not refreshed" "git checkout $NEW_TAG && pnpm zip"
        return
    fi
    cp "$wxt_zip" "$LOCAL_ZIP" || { bf ERROR "could not copy the LOCAL zip to $LOCAL_ZIP" ""; return; }
    unzip -p "$LOCAL_ZIP" manifest.json 2>/dev/null | grep -q '"key"' \
        || bf ERROR "LOCAL zip is missing the dev key — unpacked installs lose the stable ID and OAuth" "pnpm zip"
    if [[ -f "$STORE_ZIP" ]]; then
        node scripts/sync-unpacked-release.mjs --root "$REPO_ROOT" --version "$NEW_VERSION" \
            --source-sha "$RELEASE_SHA" --source "$BUILD_SNAP/.output/chrome-mv3" \
            --destination "$OUTPUT_DIR/chrome-mv3-dev" --also-destination "$OUTPUT_DIR/chrome-mv3" \
            --store-zip "$STORE_ZIP" --local-zip "$LOCAL_ZIP" \
            --receipt "$OUTPUT_DIR/release-receipt.json" --publish-state pushed \
            || bf ERROR "the keyed local bundle was not promoted to both installed unpacked paths (no receipt written)" "node scripts/sync-unpacked-release.mjs --root . --version $NEW_VERSION --source-sha $RELEASE_SHA"
    else
        bf ERROR "no STORE zip, so the local bundle was not promoted and no receipt was written" "pnpm zip:store"
    fi
}

if [[ -z "$CHECK_SNAP" || -z "$BUILD_SNAP" ]]; then
    finding "ERROR" "Checks" "Could not export $NEW_TAG to run checks or build the zips — nothing was checked or packaged" "git checkout $NEW_TAG && pnpm test && pnpm zip:store"
else
    run_checks &
    CHECKS_PID=$!
    ( build_zips ) > "$JOBS/build.out" 2>&1 &
    BUILD_PID=$!
    wait "$CHECKS_PID"; wait "$BUILD_PID"
    for row in "${CHECKS[@]}"; do
        IFS='|' read -r name _ level what remedy _ <<< "$row"
        rc="$(cat "$JOBS/check-$name.rc" 2>/dev/null || echo 1)"
        { echo "--- check $name (exit $rc) ---"; cat "$JOBS/check-$name.out" 2>/dev/null; } >> "$RELEASE_LOG_FILE"
        [[ "$rc" == 0 ]] && continue
        detail=""
        [[ "$rc" == 124 ]] && detail=" (timed out)"
        if [[ "$name" == unit-tests ]]; then
            n="$(grep -E '^[[:space:]]*Tests[[:space:]]' "$JOBS/check-$name.out" | grep -oE '[0-9]+ failed' | head -1 | cut -d' ' -f1)"
            [[ -n "$n" ]] && detail=" ($n failing)"
        fi
        finding "$level" "Checks" "${what}${detail} — see the release log" "$remedy"
    done
    { echo "--- build (store + local zips) ---"; cat "$JOBS/build.out"; } >> "$RELEASE_LOG_FILE"
    while IFS='|' read -r level text remedy; do
        [[ -n "$level" ]] && finding "$level" "Build" "$text" "$remedy"
    done < <(cat "$JOBS/build.findings" 2>/dev/null)
fi

print_findings
if [[ -f "$STORE_ZIP" ]]; then
    echo ""
    echo "Chrome Web Store upload ($WEBSTORE_UPLOAD_URL → Package → Upload new package): $STORE_ZIP"
fi
exit 0
