#!/usr/bin/env bash
# release.sh — Validate, package, then ship the exact matrx-extend candidate.
#
# Usage (./ship.sh calls it as: bash release.sh --message "<note>" <flags>):
#   ./release.sh                        # patch bump (default)
#   ./release.sh --minor | --major
#   ./release.sh --message "note"       # commit "release: vX.Y.Z - note"
#   ./release.sh --skip-types           # deprecated; required generation still runs
#   ./release.sh --skip-catalog         # deprecated; required generation still runs
#   ./release.sh --skip-typecheck       # deprecated; required typecheck still runs
#   ./release.sh --dry-run              # say what would ship; change nothing
#   ./release.sh --no-push              # same as --dry-run (a WARNING says so)
#
# The current release contract: fetch and merge remote main with local commits;
# refuse conflicts; regenerate generated files; bump; validate the exact tree;
# build Store and local candidates; only then push main and its tag. A foreign
# push restarts generation, checks and packaging against the new merged tree.
# A failed check or build leaves main, tags and installed bundles untouched.
# The full detail of every run: tmp/release-logs/release-<stamp>.log.
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
    report_excluded_dirty
    print_findings
    exit 1
}
report_excluded_dirty() {
    local dirty
    dirty="$(git status --short --untracked-files=all 2>/dev/null)"
    [[ -z "$dirty" ]] && return 0
    log "Uncommitted checkout paths excluded from candidate ${RELEASE_SHA:-not-yet-built}: $dirty"
    echo "Uncommitted checkout paths excluded from candidate ${RELEASE_SHA:-not-yet-built}:"
    printf '%s\n' "$dirty"
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

# ── Flags ─────────────────────────────────────────────────────────────────────
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
        --skip-types) finding "WARNING" "Invocation" "--skip-types is deprecated; release generation still runs"; shift ;;
        --skip-typecheck) finding "WARNING" "Invocation" "--skip-typecheck is deprecated; release typecheck still runs"; shift ;;
        --skip-catalog) finding "WARNING" "Invocation" "--skip-catalog is deprecated; catalog generation and drift check still run"; shift ;;
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
        || return 1
    [[ -d "$REPO_ROOT/node_modules" ]] && ln -s "$REPO_ROOT/node_modules" "$dir/node_modules"
    [[ -d "$REPO_ROOT/../aidream" ]] && ln -s "$(cd "$REPO_ROOT/../aidream" && pwd)" "$root/aidream"
    for f in "$REPO_ROOT"/.env*; do
        [[ -f "$f" && ! -e "$dir/$(basename "$f")" ]] && cp "$f" "$dir/"
    done
    # tsconfig extends .wxt/tsconfig.json (the @/ path alias): generate it.
    if [[ "${3:-}" == prepare ]]; then
        ( cd "$dir" && bounded 120 pnpm -s exec wxt prepare ) >> "$RELEASE_LOG_FILE" 2>&1 || return 1
    fi
    SNAP_DIR="$dir"
}

# ── One release at a time; ownership never expires during checks/builds ──────
RELEASE_LOCK_DIR="$(git rev-parse --git-path matrx-release-ship.lock 2>/dev/null || echo "$REPO_ROOT/.git/matrx-release-ship.lock")"
RELEASE_LOCK_HELD=false
release_lock_cleanup() {
    if $RELEASE_LOCK_HELD && [[ "$(cat "$RELEASE_LOCK_DIR/pid" 2>/dev/null)" == "$$" ]]; then
        rm -f -- "$RELEASE_LOCK_DIR/pid"; rmdir -- "$RELEASE_LOCK_DIR" 2>/dev/null
    fi
    RELEASE_LOCK_HELD=false
}
acquire_release_lock() {
    local owner
    if mkdir "$RELEASE_LOCK_DIR" 2>/dev/null; then
        RELEASE_LOCK_HELD=true
        echo "$$" > "$RELEASE_LOCK_DIR/pid" || hard_stop "could not record release lock ownership at $RELEASE_LOCK_DIR"
        return 0
    fi
    owner="$(cat "$RELEASE_LOCK_DIR/pid" 2>/dev/null)"
    # A missing PID can be an owner between mkdir and writing its PID. Never
    # delete an unowned lock here, including one believed stale: two contenders
    # reclaiming a stale directory can otherwise delete a newly acquired lock.
    hard_stop "release lock already exists at $RELEASE_LOCK_DIR (owner PID ${owner:-not yet recorded}); retry after its owner finishes; if abandoned, verify no release is running before removing that lock"
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
    hard_stop "checkout is not on $BRANCH; local commits were preserved and nothing was published"
fi
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
        hard_stop "local commits conflict with $REMOTE/$BRANCH — resolve the conflict before release; no commits were discarded or pushed"
    fi
}
verify_installed_dependency_inputs() {
    # Snapshots borrow this checkout's node_modules. A newer main or a push
    # race may change dependency inputs after pnpm installed them on the runner.
    # Stop before generation/check/build instead of validating mismatched bytes.
    if ! git diff --quiet "$LOCAL_HEAD^{tree}" "$BASE_TREE" -- \
        pnpm-lock.yaml pnpm-workspace.yaml .npmrc .pnpmfile.cjs patches; then
        hard_stop "merged candidate changes dependency inputs since installation; refresh packages on the updated main and retry — nothing was pushed"
    fi
    # A prior push can bump only the package version, then fail during local ZIP
    # promotion. That version does not alter the installed graph. Compare every
    # other manifest field so a retry can still restore an interrupted release.
    if ! node - "$LOCAL_HEAD:package.json" "$BASE_TREE:package.json" <<'NODE'
const { execFileSync } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');
function manifest(ref) {
  const value = JSON.parse(execFileSync('git', ['cat-file', '-p', ref], { encoding: 'utf8' }));
  delete value.version;
  return value;
}
process.exit(isDeepStrictEqual(manifest(process.argv[2]), manifest(process.argv[3])) ? 0 : 1);
NODE
    then
        hard_stop "merged candidate changes dependency inputs since installation; refresh packages on the updated main and retry — nothing was pushed"
    fi
}
# ── Regenerate the committed artifacts ──────────────────────────────────────
REGEN_INFO=""   # `git update-index --index-info` lines for the regenerated paths
regen_artifacts() {
    local snap jobs=() name rc idx tree paths=() p
    export_snapshot "$BASE_TREE" "$BASE" prepare && snap="$SNAP_DIR" || hard_stop "could not export the release tree to regenerate artifacts"
    local jd; jd="$(dirname "$snap")/jobs"; mkdir -p "$jd"
    $SKIP_TYPES   || { ( cd "$snap" && bounded 180 pnpm -s update-api-types --skip-typecheck ) > "$jd/api-types.out" 2>&1; echo $? > "$jd/api-types.rc"; }
    $SKIP_CATALOG || { ( cd "$snap" && bounded 180 pnpm -s catalog:tools:md ) > "$jd/catalog.out" 2>&1; echo $? > "$jd/catalog.rc"; }
    { ( cd "$snap" && bounded 120 pnpm -s docs:tools ) > "$jd/docs.out" 2>&1; echo $? > "$jd/docs.rc"; }
    for name in api-types catalog docs; do
        [[ -f "$jd/$name.rc" ]] || continue
        rc="$(cat "$jd/$name.rc")"
        { echo "--- regen $name (exit $rc) ---"; cat "$jd/$name.out"; } >> "$RELEASE_LOG_FILE"
        [[ "$rc" == 0 ]] && continue
        hard_stop "artifact regeneration $name failed (exit $rc); no release was pushed"
    done
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
        hard_stop "regenerated artifacts could not be staged into the release commit"
    fi
    rm -f "$idx"
}

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

# name|seconds|level|what failed|remedy|command
CHECKS=()
# Package freshness is cheap and can invalidate the candidate independently of
# compilation or tests. Check it first on every candidate, including race retries.
CHECKS+=("matrx-packages|300|ERROR|@ai-matrx packages are stale or pinned|pnpm sync:matrx-packages|pnpm -s check:matrx-packages")
$SKIP_TYPECHECK || CHECKS+=("typecheck|600|ERROR|typecheck failed|pnpm compile|pnpm -s compile")
CHECKS+=("lint|300|ERROR|Biome lint or formatting failed|pnpm lint|pnpm -s lint")
CHECKS+=(
    # 4 workers: one worker took ~11 min of the 15-min budget and timed out whenever
    # ship-all built other repos at the same time; 4 finish in ~3 min on this Mac.
    "unit-tests|900|ERROR|unit tests failed|pnpm exec vitest run --maxWorkers=4|pnpm -s exec vitest run --maxWorkers=4"
    "schema-routing|300|ERROR|unqualified Supabase table routing (404s at runtime)|pnpm check:schema-routing|pnpm -s check:schema-routing:strict"
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

# mandate-scan-step:begin
# ── Mandate references: LOUD, and NEVER exit-affecting (ruling D23) ──────────
# Every Mandate this candidate names, and every place intelligence is reached
# outside a Mandate, reported with file, symbol and line. It is NOT a row in
# CHECKS on purpose: run_checks stops the release on any non-zero exit, and a
# missing uvx, a PyPI outage, a crash inside the install or the 300 s timeout
# all exit non-zero before the scanner itself (which exits 0 without --strict)
# ever runs. Until 2026-09-30 that stopped an extend release (verdict defect D).
# Every path below is a WARNING finding printed at the end; the function always
# returns 0. Proven by `matrx-mandate-scan wiring`, which runs this block with a
# failing, timing-out and missing fake scanner and fails loudly if it can block.
mandate_scan_step() {
    local out rc count runner=()
    if ! command -v uvx >/dev/null 2>&1; then
        finding "WARNING" "Mandates" "uvx is missing, so no mandate references were reported — this build is UNMEASURED on the fleet board" "install uv (https://astral.sh/uv)"
        return 0
    fi
    if command -v timeout >/dev/null 2>&1; then runner=(timeout 300)
    elif command -v gtimeout >/dev/null 2>&1; then runner=(gtimeout 300); fi
    out="${JOBS:-${TMPDIR:-/tmp}}/check-mandate-references.out"
    ( cd "${CHECK_SNAP:-.}" && ${runner[@]+"${runner[@]}"} pnpm -s check:mandate-references ) > "$out" 2>&1
    rc=$?
    { echo "--- check mandate-references (exit $rc, never blocks) ---"; cat "$out"; } >> "${RELEASE_LOG_FILE:-/dev/null}" 2>/dev/null || true
    if [[ "$rc" == 124 ]]; then
        finding "WARNING" "Mandates" "the mandate reference scan timed out after 300 s — ${NEW_TAG:-this candidate} is UNMEASURED on the fleet board; the release continued (D23)" "pnpm check:mandate-references"
    elif [[ "$rc" != 0 ]]; then
        finding "WARNING" "Mandates" "the mandate reference scan did not complete (exit $rc) — ${NEW_TAG:-this candidate} is UNMEASURED on the fleet board; the release continued (D23)" "pnpm check:mandate-references"
    else
        count="$(sed -n 's/.*\[MANDATE-SCAN\] \([0-9][0-9]*\) finding(s).*/\1/p' "$out" 2>/dev/null | tail -1)"
        [[ -n "$count" ]] && finding "WARNING" "Mandates" "$count mandate reference finding(s) at ${NEW_TAG:-this candidate} (reported to the fleet board; never blocks)" "pnpm check:mandate-references"
    fi
    return 0
}
# mandate-scan-step:end

# ── Server-contract gate auth: a point-use session for the tool-drift check ──
# CI mints it in scripts/release-with-gate-auth.mjs and passes AIDREAM_API_TOKEN
# down; that caller-supplied token is used as-is. A local release (ship.sh →
# release.sh) has none, so it mints one per candidate through the same
# gateSession(), reading the identity from the gitignored .env.release.local.
GATE_TOKEN_FROM_CALLER=false
[[ -n "${AIDREAM_API_TOKEN:-}" ]] && GATE_TOKEN_FROM_CALLER=true
mint_gate_auth() {
    $GATE_TOKEN_FROM_CALLER && return 0
    local out err key value
    err="$(mktemp "${TMPDIR:-/tmp}/matrx-extend-gate-auth.XXXXXX")"
    if ! out="$(cd "$REPO_ROOT" && bounded 60 node scripts/release-with-gate-auth.mjs --print-env 2>"$err")"; then
        finding "ERROR" "Gate auth" "could not mint the server-contract gate session: $(head -1 "$err")" "node scripts/release-with-gate-auth.mjs --print-env (identity in .env.release.local)"
        rm -f "$err"
        return 0
    fi
    rm -f "$err"
    while IFS='=' read -r key value; do
        case "$key" in
            AIDREAM_API_TOKEN|AIDREAM_ORGANIZATION_ID|AIDREAM_API_URL) export "$key=$value" ;;
        esac
    done <<< "$out"
    log "server-contract gate session minted for organization ${AIDREAM_ORGANIZATION_ID:-?}"
}

FAILED_CHECK=""
run_checks() {
    local row name secs rc
    FAILED_CHECK=""
    for row in "${CHECKS[@]}"; do
        IFS='|' read -r name secs _ _ _ cmd <<< "$row"
        ( cd "$CHECK_SNAP" && eval "bounded $secs $cmd" ) > "$JOBS/check-$name.out" 2>&1
        rc=$?
        { echo "--- check $name (exit $rc) ---"; cat "$JOBS/check-$name.out"; } >> "$RELEASE_LOG_FILE"
        if [[ "$rc" != 0 ]]; then
            if [[ "$name" == unit-tests && "${GITHUB_ACTIONS:-}" == true ]]; then
                # Keep ordinary Vitest failure context in the hosted job log.
                # Credentials are read from this process environment, never
                # passed as arguments or copied into the uploaded artifact.
                node - "$JOBS/check-$name.out" <<'NODE'
const fs = require('node:fs');
const output = fs.readFileSync(process.argv[2], 'utf8');
const credentials = Object.entries(process.env)
  .filter(([name, value]) => value && (/(?:TOKEN|KEY|SECRET|PASSWORD|CLIENT_ID|NATIVE_HOST)/.test(name) || /^(?:WXT_SUPABASE_URL|MATRX_SUPABASE_PROJECT_REF)$/.test(name)))
  .flatMap(([, value]) => [value, JSON.stringify(value).slice(1, -1)])
  .filter(Boolean)
  .sort((a, b) => b.length - a.length);
let redacted = output;
for (const value of new Set(credentials)) redacted = redacted.split(value).join('[REDACTED]');
console.log('--- unit test output (configured credential values redacted) ---');
process.stdout.write(redacted);
if (!redacted.endsWith('\n')) process.stdout.write('\n');
NODE
            fi
            {
                printf 'gate=%s exit=%s candidate=%s\n' "$name" "$rc" "$NEW_TAG"
                if [[ "$name" == matrx-packages ]]; then
                    # Parse only known package/version fields. Never copy raw
                    # command output into a workflow artifact or job summary.
                    node - "$JOBS/check-$name.out" <<'NODE'
const fs = require('node:fs');
const input = fs.readFileSync(process.argv[2], 'utf8');
for (const line of input.split('\n')) {
  const match = line.match(/^\s*-\s*(PIN|STALE(?: \(upstream pin\))?|DUPLICATE):\s+(@ai-matrx\/[\w.-]+)(?:@(\d+\.\d+\.\d+(?:-[\w.-]+)?))?/);
  if (!match) continue;
  const latest = line.match(/npm latest is (\d+\.\d+\.\d+(?:-[\w.-]+)?)/)?.[1];
  console.log(`${match[1]} ${match[2]}${match[3] ? ` installed=${match[3]}` : ''}${latest ? ` latest=${latest}` : ''}`);
}
NODE
                elif [[ "$name" == lint ]]; then
                    ( cd "$CHECK_SNAP" && node_modules/.bin/biome check --reporter=json . ) \
                        > "$JOBS/check-lint.json" 2>/dev/null || true
                    node - "$JOBS/check-lint.json" "$CHECK_SNAP" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
let report;
try { report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); }
catch { console.log('lint diagnostic parsing unavailable'); process.exit(0); }
const root = path.resolve(process.argv[3]);
const safe = new Set();
for (const diagnostic of report.diagnostics ?? []) {
  if (diagnostic.severity !== 'error') continue;
  const file = diagnostic.location?.path?.file;
  const category = diagnostic.category;
  if (typeof file !== 'string' || typeof category !== 'string') continue;
  const absolute = path.isAbsolute(file) ? path.normalize(file) : path.resolve(root, file);
  const relative = path.relative(root, absolute);
  if (!/^[A-Za-z0-9_./-]+$/.test(relative) || relative.startsWith('..')) continue;
  if (!/^(?:format|lint\/[A-Za-z0-9_/-]+|assist\/[A-Za-z0-9_/-]+)$/.test(category)) continue;
  safe.add(`${relative} ${category} ${category === 'format' ? 'format differs' : 'rule violation'}`);
}
for (const line of [...safe].slice(0, 50)) console.log(line);
if (safe.size > 50) console.log(`additional diagnostics omitted=${safe.size - 50}`);
if (safe.size === 0) console.log('lint failed without a recognized safe diagnostic');
NODE
                elif [[ "$name" == unit-tests ]]; then
                    # Vitest's assertion output can contain source values. Report
                    # failed paths and only titles that exactly match static test
                    # labels in the candidate's own source files.
                    node - "$JOBS/check-$name.out" "$CHECK_SNAP" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const input = fs.readFileSync(process.argv[2], 'utf8').replace(/\x1b\[[0-9;]*m/g, '');
const root = path.resolve(process.argv[3]);
const failed = new Map();
for (const line of input.split('\n')) {
  const match = line.match(/^\s*FAIL\s+((?:tests|src)\/[A-Za-z0-9_./-]+\.(?:test|spec)\.[cm]?[jt]sx?)(?=\s|$)/);
  if (!match || match[1].split('/').includes('..')) continue;
  const file = match[1];
  const fullPath = path.resolve(root, file);
  if (!fullPath.startsWith(`${root}${path.sep}`)) continue;
  let source;
  try { source = fs.readFileSync(fullPath, 'utf8'); } catch { continue; }
  const labels = new Set();
  const staticLabel = /\b(?:describe|it|test)(?:\.[A-Za-z]+)*\s*\(\s*(['"`])([^'"`\n]{1,200})\1/g;
  for (const found of source.matchAll(staticLabel)) labels.add(found[2]);
  const title = line.slice(line.indexOf(file) + file.length).split(/\s+>\s+/).slice(1).findLast((part) => labels.has(part.trim()));
  if (!failed.has(file) || title) failed.set(file, title?.trim() ?? null);
}
for (const [file, title] of [...failed].slice(0, 50)) {
  console.log(`failed-test-file=${file}`);
  if (title && /^[\x20-\x7E]{1,200}$/.test(title)) console.log(`static-test-label=${title}`);
}
if (failed.size > 50) console.log(`additional failed test files omitted=${failed.size - 50}`);
if (failed.size === 0) console.log('unit tests failed without a recognized safe test file');
NODE
                fi
            } > "$RELEASE_LOG_DIR/diagnostics.log"
            cat "$RELEASE_LOG_DIR/diagnostics.log"
            finding "ERROR" "Checks" "$name failed (exit $rc); candidate $NEW_TAG was not published" "$cmd"
            FAILED_CHECK="$name"
            return 1
        fi
    done
}

# ── @ai-matrx catch-up: a package published mid-release is not a stopped release ─
# aidream publishes an @ai-matrx package every few minutes, so one can land
# between ship.sh's sync and the matrx-packages gate (four releases in a row
# stopped that way on 2026-10-04). When the gate's ONLY failure is a plain STALE
# install, update, read every new CHANGELOG entry, commit the lockfile and build
# a fresh candidate — the gate itself is unchanged and re-runs on that candidate.
# PIN / DUPLICATE / AHEAD / upstream pin / unverifiable, a declared Consumer
# action, or MATRX_CATCHUP_ATTEMPTS exhausted: the release stops exactly as before.
MATRX_CATCHUP_ATTEMPTS=3
MATRX_CATCHUPS=0
catch_up_matrx_packages() {
    local stale review paths=() p
    stale="$(node "$REPO_ROOT/scripts/release-matrx-catchup.mjs" stale-only "$JOBS/check-matrx-packages.out")" || return 1
    (( MATRX_CATCHUPS < MATRX_CATCHUP_ATTEMPTS )) || {
        finding "ERROR" "Packages" "@ai-matrx moved again after $MATRX_CATCHUP_ATTEMPTS catch-ups in one release; stopping" "./ship.sh"
        return 1
    }
    MATRX_CATCHUPS=$((MATRX_CATCHUPS + 1))
    log "matrx-packages STALE only ($(tr '\n' ' ' <<< "$stale")) — catch-up $MATRX_CATCHUPS of $MATRX_CATCHUP_ATTEMPTS"
    if ! ( cd "$REPO_ROOT" && bounded 600 pnpm update -r "@ai-matrx/*" --latest && bounded 600 pnpm update -r "@ai-matrx/*" --depth Infinity ) >> "$RELEASE_LOG_FILE" 2>&1; then
        finding "ERROR" "Packages" "pnpm update of the stale @ai-matrx packages failed during catch-up" "pnpm sync:matrx-packages"
        return 1
    fi
    # shellcheck disable=SC2086  # one name@version per word
    if ! review="$(node "$REPO_ROOT/scripts/release-matrx-catchup.mjs" consumer-actions --root "$REPO_ROOT" $stale)"; then
        while IFS= read -r p; do
            [[ -n "$p" ]] && finding "ERROR" "Packages" "$p" "adopt it in this repo, commit, then ./ship.sh"
        done <<< "$review"
        return 1
    fi
    log "catch-up CHANGELOG review: $(tr '\n' ';' <<< "$review")"
    for p in package.json pnpm-lock.yaml; do
        git diff --quiet HEAD -- "$p" 2>/dev/null || paths+=("$p")
    done
    if [[ ${#paths[@]} -eq 0 ]]; then
        finding "ERROR" "Packages" "pnpm update left package.json and pnpm-lock.yaml unchanged, so catch-up cannot move the candidate" "pnpm sync:matrx-packages"
        return 1
    fi
    if ! quiet git commit --only -m "chore(deps): catch up @ai-matrx packages to npm latest during release

$review" -- "${paths[@]}"; then
        finding "ERROR" "Packages" "could not commit the caught-up ${paths[*]}" "git commit --only ${paths[*]}"
        return 1
    fi
    LOCAL_HEAD="$(git rev-parse HEAD)"
    unset 'FINDINGS[${#FINDINGS[@]}-1]'   # the gate's ERROR for the candidate this replaces
    while IFS= read -r p; do
        [[ -n "$p" ]] && finding "WARNING" "Packages" "caught up during release: $p" ""
    done <<< "$review"
    return 0
}

# Store FIRST, local SECOND: the last build owns .output/chrome-mv3, and the
# keyed bundle is promoted into both paths used by existing Chrome profiles
# (stable dev ID; the Supabase OAuth redirect is registered against it).
# The Store rejects any
# upload that carries the dev key (incident: .research/v0.1.4-auth-incident.md).
build_zips() (
    local wxt_zip=".output/${PROJECT_NAME}-${NEW_VERSION}-chrome.zip"
    cd "$BUILD_SNAP" || return 1
    MATRX_CWS_BUILD=1 bounded 600 pnpm -s exec wxt zip || return 1
    [[ -f "$wxt_zip" ]] || return 1
    node scripts/check-store-package.mjs || return 1
    node scripts/check-cws-release-risk.mjs || return 1
    if unzip -p "$wxt_zip" manifest.json 2>/dev/null | grep -q '"key"'; then return 1; fi
    cp "$wxt_zip" "$STORE_CANDIDATE" || return 1
    rm -f "$wxt_zip"
    bounded 600 pnpm -s exec wxt zip || return 1
    [[ -f "$wxt_zip" ]] || return 1
    cp "$wxt_zip" "$LOCAL_CANDIDATE" || return 1
    unzip -p "$LOCAL_CANDIDATE" manifest.json 2>/dev/null | grep -q '"key"' || return 1
    [[ -f .output/chrome-mv3/manifest.json ]] || return 1
)


# ── Validate the exact candidate before any remote publication ──────────────
REMOTE_TAGS="$(git ls-remote --tags "$REMOTE" 'refs/tags/v*')" \
    || hard_stop "cannot read remote tags — nothing was pushed"
RACES=0
PUSHED=false
while (( RACES < SHIP_PUSH_ATTEMPTS )); do
    # A foreign main advance changes the candidate. Re-merge, regenerate,
    # bump, check and build from the beginning; old verdicts never transfer.
    base_tree
    verify_installed_dependency_inputs
    log "release tree assembled on ${BASE:0:9}"
    REGEN_INFO=""
    regen_artifacts
    CURRENT_VERSION="$(read_version_at "$BASE_TREE")"
    [[ -n "$CURRENT_VERSION" ]] || hard_stop "cannot read the version from $VERSION_FILE — nothing was pushed"
    bump_version "$CURRENT_VERSION"
    COMMIT_MSG="$(commit_message "$NEW_TAG")"
    build_commit || hard_stop "could not assemble $NEW_TAG — nothing was pushed"
    log "candidate $NEW_TAG is $RELEASE_SHA; only committed paths are included"
    CHECK_SNAP=""; BUILD_SNAP=""
    export_snapshot "$RELEASE_SHA" "$RELEASE_SHA" prepare && CHECK_SNAP="$SNAP_DIR"         || hard_stop "could not prepare check export for $NEW_TAG — nothing was pushed"
    export_snapshot "$RELEASE_SHA" "$RELEASE_SHA" && BUILD_SNAP="$SNAP_DIR"         || hard_stop "could not export build candidate for $NEW_TAG — nothing was pushed"
    JOBS="$(mktemp -d "${TMPDIR:-/tmp}/matrx-extend-release-jobs.XXXXXX")"
    SNAP_ROOTS+=("$JOBS")
    $SKIP_CATALOG || mint_gate_auth
    if ! run_checks; then
        # A fresh candidate on the caught-up lockfile; every check runs again on it.
        [[ "$FAILED_CHECK" == matrx-packages ]] && catch_up_matrx_packages && continue
        hard_stop "mandatory checks failed for $NEW_TAG — nothing was pushed"
    fi
    mandate_scan_step
    STORE_CANDIDATE="$BUILD_SNAP/.output/${PROJECT_NAME}-${NEW_VERSION}-store.zip"
    LOCAL_CANDIDATE="$BUILD_SNAP/.output/${PROJECT_NAME}-${NEW_VERSION}-local.zip"
    if ! build_zips >> "$RELEASE_LOG_FILE" 2>&1; then
        hard_stop "candidate package validation failed for $NEW_TAG — nothing was pushed"
    fi
    report_excluded_dirty
    # Local fixture hook: a foreign commit can land at the last possible point.
    [[ -n "${RELEASE_TEST_BEFORE_PUSH:-}" ]] && bash -c "$RELEASE_TEST_BEFORE_PUSH" >/dev/null 2>&1
    if quiet git push --atomic "$REMOTE" \
        "${RELEASE_SHA}:refs/heads/$BRANCH" "${RELEASE_SHA}:refs/tags/$NEW_TAG"; then
        PUSHED=true
        break
    fi
    previous_base="$BASE"
    fetch_main || hard_stop "cannot reach $REMOTE/$BRANCH after push rejection — nothing was published"
    REMOTE_TAGS="$(git ls-remote --tags "$REMOTE" 'refs/tags/v*')" \
        || hard_stop "cannot read remote tags after push rejection — nothing was published"
    if [[ "$(git rev-parse "$REMOTE/$BRANCH")" == "$previous_base" ]] && ! tag_taken "$NEW_TAG"; then
        hard_stop "atomic push rejected without a branch or tag race — nothing was published"
    fi
    RACES=$((RACES + 1))
    log "lost push race $RACES — revalidating the new candidate"
done
$PUSHED || hard_stop "lost the branch/tag race $SHIP_PUSH_ATTEMPTS times — nothing was published"

# Publication uses only the already validated SHA and its candidate artifacts.
quiet git update-ref "refs/tags/$NEW_TAG" "$RELEASE_SHA" \
    || finding "WARNING" "Git" "Remote $NEW_TAG is published, but local tag could not be recorded" "git fetch --tags origin"
STORE_ZIP="$OUTPUT_DIR/${PROJECT_NAME}-${NEW_VERSION}-store.zip"
LOCAL_ZIP="$OUTPUT_DIR/${PROJECT_NAME}-${NEW_VERSION}-local.zip"
mkdir -p "$OUTPUT_DIR"
OUTPUT_STAGE="$(mktemp -d "$OUTPUT_DIR/.release-artifacts.XXXXXX")" \
    || hard_stop "could not stage local release artifacts; remote release is $RELEASE_SHA"
# Recovery backups must survive EXIT cleanup, including failed restoration.
cp "$STORE_CANDIDATE" "$OUTPUT_STAGE/store.zip" \
    || hard_stop "could not stage Store zip; remote release is $RELEASE_SHA"
cp "$LOCAL_CANDIDATE" "$OUTPUT_STAGE/local.zip" \
    || hard_stop "could not stage local zip; remote release is $RELEASE_SHA"
cmp -s "$STORE_CANDIDATE" "$OUTPUT_STAGE/store.zip" \
    || hard_stop "staged Store zip differs from validated candidate; remote release is $RELEASE_SHA"
cmp -s "$LOCAL_CANDIDATE" "$OUTPUT_STAGE/local.zip" \
    || hard_stop "staged local zip differs from validated candidate; remote release is $RELEASE_SHA"
STORE_BACKED=false; LOCAL_BACKED=false; STORE_INSTALLED=false; LOCAL_INSTALLED=false
restore_output_zips() {
    local failed=false
    if $STORE_BACKED; then
        mv -f "$OUTPUT_STAGE/old-store.zip" "$STORE_ZIP" || failed=true
    elif $STORE_INSTALLED; then
        rm -f -- "$STORE_ZIP" || failed=true
    fi
    if $LOCAL_BACKED; then
        mv -f "$OUTPUT_STAGE/old-local.zip" "$LOCAL_ZIP" || failed=true
    elif $LOCAL_INSTALLED; then
        rm -f -- "$LOCAL_ZIP" || failed=true
    fi
    if $failed; then
        finding "ERROR" "Recovery" "ZIP rollback incomplete; recovery files retained at $OUTPUT_STAGE; inspect installed ZIPs before retrying" ""
        return 1
    fi
    log "Prior ZIP state restored; staging retained at $OUTPUT_STAGE"
}

if [[ -e "$STORE_ZIP" ]]; then
    mv "$STORE_ZIP" "$OUTPUT_STAGE/old-store.zip" \
        || hard_stop "could not preserve prior Store zip; remote release is $RELEASE_SHA"
    STORE_BACKED=true
fi
if [[ -e "$LOCAL_ZIP" ]]; then
    mv "$LOCAL_ZIP" "$OUTPUT_STAGE/old-local.zip" \
        || { restore_output_zips; hard_stop "could not preserve prior local zip; remote release is $RELEASE_SHA"; }
    LOCAL_BACKED=true
fi
mv "$OUTPUT_STAGE/store.zip" "$STORE_ZIP" \
    || { restore_output_zips; hard_stop "could not install Store zip; remote release is $RELEASE_SHA"; }
STORE_INSTALLED=true
mv "$OUTPUT_STAGE/local.zip" "$LOCAL_ZIP" \
    || { restore_output_zips; hard_stop "could not install local zip; remote release is $RELEASE_SHA"; }
LOCAL_INSTALLED=true
PROMOTION_LOG="$JOBS/promotion.out"
if ! node scripts/sync-unpacked-release.mjs --root "$REPO_ROOT" --version "$NEW_VERSION" \
    --source-sha "$RELEASE_SHA" --source "$BUILD_SNAP/.output/chrome-mv3" \
    --destination "$OUTPUT_DIR/chrome-mv3-dev" --also-destination "$OUTPUT_DIR/chrome-mv3" \
    --store-zip "$STORE_ZIP" --local-zip "$LOCAL_ZIP" \
    --receipt "$OUTPUT_DIR/release-receipt.json" --publish-state pushed \
    > "$PROMOTION_LOG" 2>&1; then
    cat "$PROMOTION_LOG" >> "$RELEASE_LOG_FILE"
    restore_output_zips
    hard_stop "validated bundle could not be installed locally; remote release is $RELEASE_SHA; ZIP rollback was attempted; inspect Recovery findings and latest.log for unpacked restoration details; recovery staging is $OUTPUT_STAGE"
fi
cat "$PROMOTION_LOG" >> "$RELEASE_LOG_FILE"
while IFS= read -r cleanup_warning; do
    finding "WARNING" "Cleanup" "$cleanup_warning" ""
done < <(grep '^WARNING:' "$PROMOTION_LOG")
rm -rf -- "$OUTPUT_STAGE" \
    || finding "WARNING" "Cleanup" "Release installed; could not remove staging at $OUTPUT_STAGE" "remove the retained staging after inspection"
find "$OUTPUT_DIR" -maxdepth 1 -type f \( -name "${PROJECT_NAME}-*-store.zip" -o -name "${PROJECT_NAME}-*-local.zip" \) \
    ! -name "$(basename "$STORE_ZIP")" ! -name "$(basename "$LOCAL_ZIP")" -delete
[[ -n "${RELEASE_LOG_DIR:-}" ]] && ln -sfn "$(basename "$RELEASE_LOG_FILE")" "$RELEASE_LOG_DIR/release-${NEW_TAG}.log"
if [[ "$(git rev-parse --abbrev-ref HEAD)" == "$BRANCH" ]]; then
    quiet git merge --ff-only "$REMOTE/$BRANCH"         || finding "WARNING" "Git" "This checkout could not fast-forward to $NEW_TAG" "git pull --no-rebase origin main"
fi
release_lock_cleanup
echo "${NEW_TAG}  pushed  ($((SECONDS - SHIP_START))s)"
echo "Validated candidate: $RELEASE_SHA"
report_excluded_dirty
print_findings
echo ""
echo "Chrome Web Store upload ($WEBSTORE_UPLOAD_URL → Package → Upload new package): $STORE_ZIP"
exit 0
