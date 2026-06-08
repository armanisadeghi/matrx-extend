#!/usr/bin/env bash
# release.sh — Full Chrome Web Store release pipeline for matrx-extend.
#
# What it does (in order):
#   1.  Pre-flight checks (correct branch, git available, scripts exist)
#   2.  Auto-stage + commit any uncommitted changes (so we ship a clean tree)
#   3.  Sync server API types  (pnpm update-api-types)
#   4.  TypeScript typecheck   (pnpm compile)
#   5.  Bump version           (default --patch; --minor / --major supported)
#   6.  Regen tool catalog     (pnpm catalog:tools:md), DB drift check,
#         and docs/TOOLS.generated.md from the DB (pnpm docs:tools)
#   7.  Commit version bump + regenerated catalog
#   8.  Comment out the `key` field in wxt.config.ts
#   9.  Build STORE zip without the dev key
#         → .output/matrx-extend-<ver>-store.zip
#         (this is the file you upload to the Chrome Web Store dashboard)
#   10. Restore the `key` field in wxt.config.ts
#         (also enforced by an EXIT trap — never leaves the working tree
#          in a state that breaks dev OAuth)
#   11. Build LOCAL zip with the dev `key` intact
#         → .output/matrx-extend-<ver>-local.zip
#         (also leaves .output/chrome-mv3/ as the keyed dev build, so
#          "Load unpacked" → stable ID cihdmkcdjjckfhjpgoedmgfpoljebaml,
#          OAuth redirect works, dev experience unbroken)
#   12. Push branch + tag to origin
#   13. Print final upload instructions
#
# Usage:
#   ./release.sh                         # patch bump (default)
#   ./release.sh --patch                 # patch bump
#   ./release.sh --minor                 # minor bump
#   ./release.sh --major                 # major bump
#   ./release.sh --message "feat: X"     # custom commit message for auto-stash
#   ./release.sh --skip-types            # skip server type sync (offline)
#   ./release.sh --skip-typecheck        # skip explicit tsc (still runs inside zip)
#   ./release.sh --skip-catalog          # skip dev/debug tool-catalog regen
#   ./release.sh --dry-run               # preview without changing anything
#   ./release.sh --no-push               # build everything but don't push to remote
#
# Note on the catalog step (#4): even WITHOUT --skip-catalog, this step
# is non-fatal. The tool catalog is dev/debug-only — aidream loads tool
# definitions from public.tools in the DB, not from this file. If the
# regen fails (e.g. a handler imports something that touches
# import.meta.env outside of WXT's build context), the script warns and
# proceeds. The release ships either way.

set -euo pipefail

# ── Resolve repo root ───────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR"
cd "$REPO_ROOT"

PROJECT_NAME="matrx-extend"
WXT_CONFIG="wxt.config.ts"
OUTPUT_DIR=".output"
REMOTE="origin"
BRANCH="main"
WEBSTORE_UPLOAD_URL="https://chrome.google.com/webstore/devconsole"

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()      { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()    { echo -e "${RED}[FAIL]${NC}  $*" >&2; exit 1; }
preview() { echo -e "${YELLOW}[DRY]${NC}   $*"; }
step()    { echo ""; echo -e "${BOLD}── $* ──${NC}"; }

# ── Parse flags ─────────────────────────────────────────────────────────────
BUMP_TYPE="patch"
CUSTOM_MESSAGE=""
DRY_RUN=false
SKIP_TYPES=false
SKIP_TYPECHECK=false
SKIP_CATALOG=false
NO_PUSH=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --patch)          BUMP_TYPE="patch"; shift ;;
        --minor)          BUMP_TYPE="minor"; shift ;;
        --major)          BUMP_TYPE="major"; shift ;;
        --message|-m)
            [[ -n "${2:-}" ]] || fail "--message requires an argument."
            CUSTOM_MESSAGE="$2"; shift 2 ;;
        --skip-types)     SKIP_TYPES=true; shift ;;
        --skip-typecheck) SKIP_TYPECHECK=true; shift ;;
        --skip-catalog)   SKIP_CATALOG=true; shift ;;
        --dry-run)        DRY_RUN=true; shift ;;
        --no-push)        NO_PUSH=true; shift ;;
        -h|--help)
            grep '^#' "$0" | sed 's/^# \?//'
            exit 0 ;;
        *) fail "Unknown flag: $1. Use --help for usage." ;;
    esac
done

# ── Failure trap ────────────────────────────────────────────────────────────
_on_error() {
    local exit_code=$?
    echo "" >&2
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}" >&2
    echo -e "${RED}  ✗  RELEASE FAILED — step: ${BOLD}${CURRENT_STEP:-pre-flight}${NC}${RED}  (exit ${exit_code})${NC}" >&2
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}" >&2
    echo -e "${RED}  Read the actual error above this banner — that's the${NC}" >&2
    echo -e "${RED}  underlying cause. Common patterns:${NC}" >&2
    case "$CURRENT_STEP" in
        "sync-types")
            echo -e "${RED}    • TS errors → fix code/types and re-run.${NC}" >&2
            echo -e "${RED}    • Backend unreachable → use --skip-types to release offline.${NC}" >&2
            ;;
        "typecheck")
            echo -e "${RED}    • Fix the reported TS errors and re-run ./ship.sh.${NC}" >&2
            ;;
        "version-bump"|"version-commit")
            echo -e "${RED}    • Working tree may be in an odd state — check git status.${NC}" >&2
            ;;
        "catalog")
            echo -e "${RED}    • Catalog regen is dev/debug only and should be non-fatal.${NC}" >&2
            echo -e "${RED}      If you see this, the script's tolerance check itself broke.${NC}" >&2
            ;;
        "build-local"|"build-store")
            echo -e "${RED}    • The build failed — read the Vite/WXT error above.${NC}" >&2
            ;;
        "git-push")
            echo -e "${RED}    • Push failed but everything else succeeded.${NC}" >&2
            echo -e "${RED}      Re-run: git push origin $BRANCH && git push origin v${NEW_VERSION}${NC}" >&2
            ;;
        *)
            echo -e "${RED}    • Unexpected failure point. Inspect output above.${NC}" >&2
            ;;
    esac
    echo "" >&2
    if $KEY_WAS_COMMENTED; then
        echo -e "${RED}  ⤷  wxt.config.ts key was toggled off; EXIT trap will restore it.${NC}" >&2
    fi
    if $VERSION_BUMPED && ! $VERSION_COMMITTED; then
        echo -e "${RED}  ⤷  package.json was bumped to ${NEW_VERSION} but not committed —${NC}" >&2
        echo -e "${RED}     reverting now (git checkout -- package.json).${NC}" >&2
        git checkout -- package.json 2>/dev/null || true
    fi
    echo "" >&2
}
trap _on_error ERR

# ── Key-field toggle (the Web Store gotcha) ─────────────────────────────────
#
# Local dev needs `key:` in the manifest so Chrome assigns the stable ID
# cihdmkcdjjckfhjpgoedmgfpoljebaml (Supabase OAuth redirect is registered
# against it). The Chrome Web Store rejects any upload that includes a
# `key` whose keypair doesn't match what the Store assigned at first
# publish (Store-assigned ID: hnfolienncfklkgmdjjmhhegglimlamg).
# Full incident: .research/v0.1.4-auth-incident.md.
#
# So: build local-zip with key, comment-out key, build store-zip, restore key.
KEY_WAS_COMMENTED=false
VERSION_BUMPED=false
VERSION_COMMITTED=false
NEW_VERSION=""
CURRENT_STEP=""
CATALOG_OK=true
WARNINGS=()
DRIFT_DETECTED=false

_key_comment_out() {
    # Idempotent — bails if already commented.
    if grep -qE "^[[:space:]]*key: '" "$WXT_CONFIG"; then
        # macOS sed: -i '' for in-place no-backup
        sed -i '' -E "s|^([[:space:]]*)(key: ')|\1// \2|" "$WXT_CONFIG"
        # Verify the swap actually happened.
        grep -qE "^[[:space:]]*// key: '" "$WXT_CONFIG" \
            || fail "Could not comment out key field in $WXT_CONFIG"
        KEY_WAS_COMMENTED=true
        ok "Commented out key field in $WXT_CONFIG"
    elif grep -qE "^[[:space:]]*// key: '" "$WXT_CONFIG"; then
        warn "key field is already commented out — leaving as-is"
    else
        fail "Could not find key field in $WXT_CONFIG. Aborting."
    fi
}

_key_restore() {
    # Idempotent — only acts if we did the commenting in this run.
    if $KEY_WAS_COMMENTED; then
        if grep -qE "^[[:space:]]*// key: '" "$WXT_CONFIG"; then
            sed -i '' -E "s|^([[:space:]]*)// (key: ')|\1\2|" "$WXT_CONFIG"
            grep -qE "^[[:space:]]*key: '" "$WXT_CONFIG" \
                || fail "Could not restore key field in $WXT_CONFIG — RESTORE MANUALLY before next dev install."
            ok "Restored key field in $WXT_CONFIG"
            KEY_WAS_COMMENTED=false
        else
            warn "Expected commented key field for restore but didn't find one"
        fi
    fi
}

# Ensure key is restored on any exit path.
trap '_key_restore' EXIT

# ── Pre-flight checks ───────────────────────────────────────────────────────
step "Pre-flight checks"

[[ -f package.json ]] || fail "package.json not found at $REPO_ROOT"
[[ -f "$WXT_CONFIG" ]] || fail "$WXT_CONFIG not found"
command -v pnpm >/dev/null || fail "pnpm not found in PATH"
command -v node >/dev/null || fail "node not found in PATH"
command -v git  >/dev/null || fail "git not found in PATH"

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
[[ "$CURRENT_BRANCH" == "$BRANCH" ]] \
    || fail "Not on '$BRANCH' (currently on '$CURRENT_BRANCH'). Switch first."

# Self-heal the key field. If a prior run / manual edit left it commented,
# restore it now and stage the fix as its own commit. This is the most common
# way the working tree drifts into a bad state, and we'd rather repair than
# refuse to run.
KEY_HEALED=false
if grep -qE "^[[:space:]]*key: '" "$WXT_CONFIG"; then
    : # already correct
elif grep -qE "^[[:space:]]*// key: '" "$WXT_CONFIG"; then
    warn "wxt.config.ts has key field commented out — restoring before release."
    if ! $DRY_RUN; then
        sed -i '' -E "s|^([[:space:]]*)// (key: ')|\1\2|" "$WXT_CONFIG"
        grep -qE "^[[:space:]]*key: '" "$WXT_CONFIG" \
            || fail "Could not auto-restore key field — fix manually."
        KEY_HEALED=true
        ok "Restored key field automatically"
    fi
else
    fail "$WXT_CONFIG has no recognizable 'key:' line (active or commented). Manual fix required."
fi

ok "On branch $BRANCH, key field active, tooling available"

# ── Auto-stage uncommitted work ─────────────────────────────────────────────
step "Sync working tree"

if [[ -n "$(git status --porcelain)" ]]; then
    info "Uncommitted changes detected — staging and committing"
    git status --short | sed 's/^/   /'
    if $DRY_RUN; then
        preview "Would: git add -A && git commit -m '...'"
    else
        git add -A
        if $KEY_HEALED; then
            local_msg="fix: restore wxt.config.ts key field for dev install"
        else
            local_msg="${CUSTOM_MESSAGE:-chore: pre-release sync}"
        fi
        git commit -m "$local_msg"
        ok "Committed pre-release changes: $local_msg"
    fi
else
    ok "Working tree clean — proceeding with current HEAD"
fi

# ── Sync with remote (BEFORE the long build, so a diverged branch never ──────
# leaves an orphaned tag pointing at a commit that cannot be pushed). Runs ────
# before any version bump/tag, so any abort here changes nothing. ────────────
step "Sync with $REMOTE/$BRANCH"
CURRENT_STEP="remote-sync"

if ! git fetch --quiet "$REMOTE" "$BRANCH"; then
    fail "Could not reach $REMOTE. Check your connection, then re-run. Nothing has been bumped or tagged."
fi

LOCAL_SHA=$(git rev-parse "$BRANCH")
REMOTE_SHA=$(git rev-parse "$REMOTE/$BRANCH")
BASE_SHA=$(git merge-base "$BRANCH" "$REMOTE/$BRANCH")

if [[ "$LOCAL_SHA" == "$REMOTE_SHA" ]]; then
    ok "Already in sync with $REMOTE/$BRANCH."
elif [[ "$LOCAL_SHA" == "$BASE_SHA" ]]; then
    # Local strictly behind — fast-forward is safe and lossless.
    if $DRY_RUN; then
        preview "$REMOTE/$BRANCH is ahead — would fast-forward."
    else
        info "$REMOTE/$BRANCH is ahead — fast-forwarding..."
        git merge --ff-only --quiet "$REMOTE/$BRANCH" \
            || fail "Fast-forward failed. Resolve manually. Nothing has been bumped or tagged."
        ok "Fast-forwarded to $(git rev-parse --short HEAD)."
    fi
elif [[ "$REMOTE_SHA" == "$BASE_SHA" ]]; then
    # Local strictly ahead — a normal push will work.
    ok "Local is ahead of $REMOTE/$BRANCH by $(git rev-list --count "$REMOTE/$BRANCH..$BRANCH") commit(s) — ready to release."
else
    # Diverged — try a clean rebase, abort with guidance if it would conflict.
    if $DRY_RUN; then
        warn "Diverged from $REMOTE/$BRANCH — would attempt a clean rebase (abort if it conflicts)."
    else
        warn "Diverged from $REMOTE/$BRANCH — attempting a clean rebase..."
        if git rebase "$REMOTE/$BRANCH" >/dev/null 2>&1; then
            ok "Clean rebase succeeded — linear history restored."
        else
            git rebase --abort >/dev/null 2>&1 || true
            echo "" >&2
            echo -e "${RED}  Your commits not on $REMOTE/$BRANCH:${NC}" >&2
            git log --oneline "$REMOTE/$BRANCH..$BRANCH" | sed 's/^/    /' >&2
            echo -e "${RED}  $REMOTE/$BRANCH commits not in your branch:${NC}" >&2
            git log --oneline "$BRANCH..$REMOTE/$BRANCH" | sed 's/^/    /' >&2
            echo "" >&2
            fail "Diverged and an automatic rebase would conflict. Resolve with 'git rebase $REMOTE/$BRANCH', then re-run. Nothing has been bumped or tagged."
        fi
    fi
fi

# ── Read + compute version ──────────────────────────────────────────────────
step "Compute next version"

# Read base version from HEAD (last committed state) — NOT from the working
# file. If a prior failed run bumped package.json mid-flight without
# committing, the file might already be ahead; reading from HEAD gives us a
# stable anchor so we don't double-bump.
HEAD_VERSION=$(git show HEAD:package.json | node -e "
let s=''; process.stdin.on('data',d=>s+=d); process.stdin.on('end',()=>{
  process.stdout.write(JSON.parse(s).version);
});") || fail "Could not read version from HEAD:package.json"

WORKING_VERSION=$(node -p "require('./package.json').version") \
    || fail "Could not read version from package.json"

if [[ "$WORKING_VERSION" != "$HEAD_VERSION" ]]; then
    warn "package.json version diverged from HEAD ($WORKING_VERSION vs $HEAD_VERSION) — resetting to HEAD."
    git checkout -- package.json
    WORKING_VERSION="$HEAD_VERSION"
fi

CURRENT_VERSION="$HEAD_VERSION"
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"
case "$BUMP_TYPE" in
    patch) NEW_VERSION="${MAJOR}.${MINOR}.$((PATCH + 1))" ;;
    minor) NEW_VERSION="${MAJOR}.$((MINOR + 1)).0" ;;
    major) NEW_VERSION="$((MAJOR + 1)).0.0" ;;
esac
NEW_TAG="v${NEW_VERSION}"

if git rev-parse "$NEW_TAG" &>/dev/null; then
    fail "Tag $NEW_TAG already exists. Resolve manually or pick a different bump type."
fi

LOCAL_ZIP="$OUTPUT_DIR/${PROJECT_NAME}-${NEW_VERSION}-local.zip"
STORE_ZIP="$OUTPUT_DIR/${PROJECT_NAME}-${NEW_VERSION}-store.zip"
WXT_ZIP_OUT="$OUTPUT_DIR/${PROJECT_NAME}-${NEW_VERSION}-chrome.zip"

echo ""
echo -e "  ${BOLD}${PROJECT_NAME} release${NC}"
echo -e "  ─────────────────────────────────────"
echo -e "  Bump        : ${CYAN}${BUMP_TYPE}${NC}"
echo -e "  Old version : ${YELLOW}${CURRENT_VERSION}${NC}"
echo -e "  New version : ${GREEN}${NEW_VERSION}${NC}"
echo -e "  Tag         : ${GREEN}${NEW_TAG}${NC}"
echo -e "  Local zip   : ${DIM}${LOCAL_ZIP}${NC}"
echo -e "  Store zip   : ${DIM}${STORE_ZIP}${NC}"
$DRY_RUN  && echo -e "  Mode        : ${YELLOW}DRY RUN${NC}"
$NO_PUSH  && echo -e "  Push        : ${YELLOW}DISABLED (--no-push)${NC}"
echo -e "  ─────────────────────────────────────"
echo ""

if $DRY_RUN; then
    preview "Would sync server types, typecheck, bump to $NEW_VERSION, build local + store zips, tag, push."
    exit 0
fi

# ── 1. Sync server API types ────────────────────────────────────────────────
CURRENT_STEP="sync-types"
step "1/8  Sync server API types"
if $SKIP_TYPES; then
    warn "Skipping server type sync (--skip-types)"
else
    pnpm update-api-types
    ok "API types synced"
fi

# ── 2. TypeScript typecheck ─────────────────────────────────────────────────
CURRENT_STEP="typecheck"
step "2/8  TypeScript typecheck"
if $SKIP_TYPECHECK; then
    warn "Skipping explicit tsc (--skip-typecheck)"
else
    pnpm compile
    ok "Typecheck passed"
fi

# ── 3. Bump version ─────────────────────────────────────────────────────────
CURRENT_STEP="version-bump"
step "3/8  Bump version → ${NEW_VERSION}"
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
pkg.version = '${NEW_VERSION}';
fs.writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\n');
"
VERSION_BUMPED=true
ok "package.json → ${NEW_VERSION}"

# ── 4. Regen tool catalog (NON-FATAL) ───────────────────────────────────────
#
# Deliberately tolerant. The tool catalog is dev/debug-only per its own
# docstring — aidream loads tool definitions from public.tools in the DB,
# NOT from this catalog. Most common failure mode: a tool handler module
# transitively imports something that touches `import.meta.env`, which
# tsx (plain Node) doesn't define. Fixing that is a code change, not a
# release-blocker. We warn and continue.
CURRENT_STEP="catalog"
step "4/8  Regenerate tool catalog (non-fatal)"
if $SKIP_CATALOG; then
    warn "Skipping catalog regen (--skip-catalog)"
    CATALOG_OK=false
    WARNINGS+=("Tool catalog NOT regenerated (--skip-catalog). Catalog files in types/ may be stale.")
else
    if pnpm catalog:tools:md; then
        ok "types/tool-catalog.{json,md} regenerated"
    else
        CATALOG_OK=false
        warn "catalog:tools:md failed — continuing (catalog is dev/debug only)."
        warn "Most likely cause: a handler module touches import.meta.env at"
        warn "module load. Inspect with:  pnpm catalog:tools:md  outside this script."
        WARNINGS+=("Tool catalog regen FAILED (non-blocking). types/tool-catalog.* will be stale until you fix the import-time env issue and run 'pnpm catalog:tools:md' manually.")
    fi

    # ── 4b. Diff local catalog against public.tl_def (NON-FATAL) ─────────────
    #
    # The LLM sees tool schemas from public.tl_def (in Supabase). The
    # extension's dispatcher validates calls against the local Zod schemas
    # captured in types/tool-catalog.json. When they drift, the model
    # crafts a call the dispatcher rejects (or vice versa) — see the
    # 'tabs.action=get_info' incident on 2026-05-19. Warn-only: bringing
    # tl_def in line with code happens manually via Supabase MCP / admin
    # API; we don't want a drift to gate a release that's otherwise ready.
    if $CATALOG_OK; then
        if pnpm catalog:tools:drift; then
            ok "tool-catalog ↔ tl_def in sync"
        else
            DRIFT_DETECTED=true
            WARNINGS+=("Tool catalog DRIFTED from public.tl_def (non-blocking). Run 'pnpm catalog:tools:drift' for the diff; reconcile via Supabase MCP / admin API.")
        fi
    else
        warn "Skipping tl_def drift check — catalog regen failed."
    fi

    # ── 4c. Regenerate docs/TOOLS.generated.md from the DB (NON-FATAL) ────────
    #
    # Rule 4 (docs/TOOL_SOURCE_OF_TRUTH.md): tool descriptions live ONLY in the
    # database; the single repo copy allowed is this auto-generated doc. It
    # reads tl_def directly (not the local catalog), so it runs regardless of
    # CATALOG_OK. Never blocks — warns on failure and ships either way.
    if pnpm docs:tools; then
        ok "docs/TOOLS.generated.md regenerated from tl_def"
    else
        WARNINGS+=("docs:tools regen FAILED (non-blocking). docs/TOOLS.generated.md may be stale.")
    fi

    # ── 4d. Migration ledger check (migrations/*.sql ↔ live DB): LOUD, NON-FATAL ─
    #
    # Supabase is the source of truth, NOT the .sql files in migrations/. A file on
    # disk changed NOTHING until it's applied. This diffs migrations/ against the
    # shared ledger public._schema_migrations (source='matrx-extend', same DB) and
    # screams in a red box if any local migration was never recorded. Read-only —
    # this repo can't apply DDL; apply from aidream:
    #   python db/apply_migrations.py --source matrx-extend
    if pnpm check:migrations; then
        ok "migration ledger in sync"
    else
        WARNINGS+=("UNAPPLIED MIGRATIONS detected (non-blocking). Run 'pnpm check:migrations' for the list; apply from aidream with 'python db/apply_migrations.py --source matrx-extend'.")
    fi
fi

# ── 5. Commit version bump ──────────────────────────────────────────────────
CURRENT_STEP="version-commit"
step "5/8  Commit version bump"
COMMIT_MSG="release: ${NEW_TAG}"
git add package.json 2>/dev/null || true
# Only stage catalog files if regen succeeded — don't commit a stale one.
if $CATALOG_OK; then
    git add types/tool-catalog.json types/tool-catalog.md 2>/dev/null || true
fi
# The DB-sourced tools doc (Rule 4) — stage whenever it was regenerated.
git add docs/TOOLS.generated.md 2>/dev/null || true
if ! git diff --cached --quiet; then
    git commit -m "$COMMIT_MSG"
    VERSION_COMMITTED=true
    ok "Committed: '$COMMIT_MSG'"
else
    warn "Nothing staged — skipping version-bump commit"
    VERSION_COMMITTED=true  # nothing to roll back either
fi

# ── 6. Build STORE zip (key commented out) ──────────────────────────────────
#
# IMPORTANT: store goes FIRST, local goes SECOND. `pnpm zip` rebuilds
# .output/chrome-mv3/ in place each time, so whichever build runs last
# is the one a "Load unpacked" install will pick up. We want that to be
# the LOCAL build (key intact, stable dev ID) — otherwise the unpacked
# install gets a random ID and Supabase OAuth dies with "Authorization
# page could not be loaded."
CURRENT_STEP="build-store"
step "6/8  Build STORE zip (key removed)"

# Purge stale zips from previous releases. If we leave them around,
# the file picker in the Chrome Web Store dashboard shows every prior
# version's store zip alongside the new one — and "0.1.4" sorts
# next to "0.1.14" in most file pickers, so it's trivially easy to
# grab the wrong file. The CWS rejected v0.1.14's upload exactly this
# way (manifest version 0.1.4, "not larger than published 0.1.4").
# After this purge, .output/ holds exactly the two zips this run is
# about to produce — nothing else to mis-click.
#
# Safety: the source of truth for any prior release is its git tag;
# a contributor who actually needs an older zip can always
# `git checkout vX.Y.Z && pnpm zip`. There's no value in preserving
# build artifacts here.
STALE_ZIPS=$(find "$OUTPUT_DIR" -maxdepth 1 -type f \( \
    -name "${PROJECT_NAME}-*-store.zip" -o \
    -name "${PROJECT_NAME}-*-local.zip" -o \
    -name "${PROJECT_NAME}-*-chrome.zip" \
\) 2>/dev/null | wc -l | tr -d ' ')
if [[ "$STALE_ZIPS" -gt 0 ]]; then
    find "$OUTPUT_DIR" -maxdepth 1 -type f \( \
        -name "${PROJECT_NAME}-*-store.zip" -o \
        -name "${PROJECT_NAME}-*-local.zip" -o \
        -name "${PROJECT_NAME}-*-chrome.zip" \
    \) -delete
    ok "Purged $STALE_ZIPS stale zip(s) from $OUTPUT_DIR/"
fi

rm -f "$WXT_ZIP_OUT" "$LOCAL_ZIP" "$STORE_ZIP"
_key_comment_out
pnpm zip
[[ -f "$WXT_ZIP_OUT" ]] || fail "Expected $WXT_ZIP_OUT but it was not produced"

# Sanity check: the store manifest must NOT contain a "key" field.
if unzip -p "$WXT_ZIP_OUT" manifest.json | grep -q '"key"'; then
    fail "Store zip still contains a key field. Aborting before upload."
fi
mv "$WXT_ZIP_OUT" "$STORE_ZIP"
ok "Store zip → $STORE_ZIP"

_key_restore  # restore eagerly (the EXIT trap will also catch any miss)

# ── 7. Build LOCAL zip (dev key intact) — leaves chrome-mv3/ usable ─────────
CURRENT_STEP="build-local"
step "7/8  Build LOCAL zip (dev key intact)"
rm -f "$WXT_ZIP_OUT"
pnpm zip
[[ -f "$WXT_ZIP_OUT" ]] || fail "Expected $WXT_ZIP_OUT but it was not produced"
mv "$WXT_ZIP_OUT" "$LOCAL_ZIP"
ok "Local zip → $LOCAL_ZIP"

# Sanity check: the local manifest MUST contain a "key" field.
if ! unzip -p "$LOCAL_ZIP" manifest.json | grep -q '"key"'; then
    warn "Local zip is missing the key field — dev OAuth will break for unpacked installs."
fi

# Sanity check: the unpacked .output/chrome-mv3/ — what "Load unpacked"
# picks up — MUST also have the key field. If it doesn't, a prior store
# build clobbered it and we have a regression.
if [[ -f "$OUTPUT_DIR/chrome-mv3/manifest.json" ]]; then
    if ! grep -q '"key"' "$OUTPUT_DIR/chrome-mv3/manifest.json"; then
        fail "$OUTPUT_DIR/chrome-mv3/manifest.json is missing the key field — unpacked dev install would break OAuth."
    fi
fi

# ── 8. Tag and push ─────────────────────────────────────────────────────────
CURRENT_STEP="git-push"
step "8/8  Tag and push"
git tag "$NEW_TAG"
ok "Tag $NEW_TAG created"

if $NO_PUSH; then
    warn "--no-push set — skipping git push"
elif git push --atomic "$REMOTE" "$BRANCH" "$NEW_TAG" 2>/dev/null; then
    # --atomic: branch + tag push together or not at all (never a half-push).
    ok "Pushed $BRANCH and $NEW_TAG to $REMOTE"
else
    warn "Push rejected — $REMOTE/$BRANCH moved during the build. Reconciling once..."
    git fetch --quiet "$REMOTE" "$BRANCH" \
        || fail "Push rejected and re-fetch failed. Tag $NEW_TAG exists locally; run: git pull --rebase $REMOTE $BRANCH && git tag -f $NEW_TAG HEAD && git push --atomic $REMOTE $BRANCH $NEW_TAG"
    if git rebase "$REMOTE/$BRANCH" >/dev/null 2>&1; then
        git tag -f "$NEW_TAG" HEAD >/dev/null  # rebase rewrote the commit; move the tag onto it
        info "Rebased onto updated $REMOTE/$BRANCH and re-pointed $NEW_TAG. Retrying push..."
        if git push --atomic "$REMOTE" "$BRANCH" "$NEW_TAG" 2>/dev/null; then
            ok "Pushed $BRANCH and $NEW_TAG to $REMOTE"
        else
            fail "Rejected again after a clean rebase — $REMOTE/$BRANCH is moving rapidly. History is clean locally; push by hand: git push --atomic $REMOTE $BRANCH $NEW_TAG"
        fi
    else
        git rebase --abort >/dev/null 2>&1 || true
        fail "Push rejected and an automatic rebase conflicts. Tag $NEW_TAG exists locally; resolve: git rebase $REMOTE/$BRANCH && git tag -f $NEW_TAG HEAD && git push --atomic $REMOTE $BRANCH $NEW_TAG"
    fi
fi
CURRENT_STEP="done"

# ── Final instructions ──────────────────────────────────────────────────────
LOCAL_SIZE=$(du -h "$LOCAL_ZIP" | cut -f1)
STORE_SIZE=$(du -h "$STORE_ZIP" | cut -f1)
LOCAL_ABS="$REPO_ROOT/$LOCAL_ZIP"
STORE_ABS="$REPO_ROOT/$STORE_ZIP"

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  ✓  ${PROJECT_NAME} ${NEW_VERSION} packaged${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

if [[ ${#WARNINGS[@]} -gt 0 ]]; then
    echo -e "${YELLOW}  ⚠  Non-fatal warnings during release${NC}"
    for w in "${WARNINGS[@]}"; do
        echo -e "${YELLOW}     • ${w}${NC}"
    done
    echo ""
fi

echo -e "${BOLD}  Artifacts${NC}"
echo -e "   Local (dev unpacked) ${DIM}${LOCAL_SIZE}${NC}"
echo -e "      ${CYAN}${LOCAL_ABS}${NC}"
echo -e "   Store (Chrome Web Store upload) ${DIM}${STORE_SIZE}${NC}"
echo -e "      ${CYAN}${STORE_ABS}${NC}"
echo ""
echo -e "${BOLD}  Next steps${NC}"
echo -e "   ${CYAN}1.${NC} Open the Chrome Web Store dashboard:"
echo -e "      ${CYAN}${WEBSTORE_UPLOAD_URL}${NC}"
echo -e "   ${CYAN}2.${NC} Pick the Matrx Extend item, click ${BOLD}\"Package\"${NC} → ${BOLD}\"Upload new package\"${NC}"
echo -e "   ${CYAN}3.${NC} Drop the ${BOLD}store${NC} zip:"
echo -e ""
echo -e "      ${BOLD}${GREEN}${STORE_ABS}${NC}"
echo -e ""
echo -e "      ${DIM}(.output/ contains ONLY this version's zips —${NC}"
echo -e "      ${DIM} prior releases were purged so you can't mis-click.)${NC}"
echo -e "   ${CYAN}4.${NC} Update the change-notes field, then ${BOLD}\"Submit for review\"${NC}"
echo -e "   ${CYAN}5.${NC} For local dev: install the ${BOLD}local${NC} zip unpacked at chrome://extensions"
echo -e "      (or just ${DIM}pnpm dev${NC})"
echo ""
echo -e "${DIM}  Reminder: never upload the local zip — it carries the dev keypair${NC}"
echo -e "${DIM}  and the Web Store will reject it. Full incident:${NC}"
echo -e "${DIM}    .research/v0.1.4-auth-incident.md${NC}"
echo ""

# Reveal the store zip in Finder on macOS so the upload-file picker
# opens to a folder that contains exactly the file you want — no
# scrolling past nine prior-version zips.
if [[ "$(uname -s)" == "Darwin" ]] && command -v open >/dev/null 2>&1; then
    open -R "$STORE_ABS" 2>/dev/null || true
fi

# ── FINAL DRIFT SCREAM ──────────────────────────────────────────────────────
# If the tl_def drift check found anything earlier, repeat the alert as the
# LAST thing on screen so it can't be missed.
if $DRIFT_DETECTED; then
    RED_BG='\033[1;97;41m'
    RED_FG='\033[1;91m'
    BLINK='\033[5m'
    NCC='\033[0m'
    BAR='████████████████████████████████████████████████████████████████████████████'
    echo ""
    echo ""
    echo -e "${RED_BG}${BAR}${NCC}"
    echo -e "${RED_BG}██${NCC}                                                                        ${RED_BG}██${NCC}"
    echo -e "${RED_BG}██${NCC}     ${BLINK}${RED_FG}⚠  TOOL-CATALOG / DB SCHEMA DRIFT DETECTED  ⚠${NCC}                  ${RED_BG}██${NCC}"
    echo -e "${RED_BG}██${NCC}                                                                        ${RED_BG}██${NCC}"
    echo -e "${RED_BG}██${NCC}     ${RED_FG}The LLM sees one schema; the dispatcher accepts another.${NCC}           ${RED_BG}██${NCC}"
    echo -e "${RED_BG}██${NCC}     ${RED_FG}Run:  pnpm catalog:tools:drift  for the full diff.${NCC}                 ${RED_BG}██${NCC}"
    echo -e "${RED_BG}██${NCC}     ${RED_FG}Reconcile tl_def via Supabase MCP / admin API.${NCC}                     ${RED_BG}██${NCC}"
    echo -e "${RED_BG}██${NCC}                                                                        ${RED_BG}██${NCC}"
    echo -e "${RED_BG}${BAR}${NCC}"
    echo ""
fi
