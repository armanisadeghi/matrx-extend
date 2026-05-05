#!/usr/bin/env bash
# release.sh — Full Chrome Web Store release pipeline for matrx-extend.
#
# What it does (in order):
#   1.  Pre-flight checks (correct branch, git available, scripts exist)
#   2.  Auto-stage + commit any uncommitted changes (so we ship a clean tree)
#   3.  Sync server API types  (pnpm update-api-types)
#   4.  TypeScript typecheck   (pnpm compile)
#   5.  Bump version           (default --patch; --minor / --major supported)
#   6.  Regen tool catalog     (pnpm catalog:tools:md)
#   7.  Commit version bump + regenerated catalog
#   8.  Build LOCAL zip with the dev `key` intact
#         → .output/matrx-extend-<ver>-local.zip
#         (install this unpacked → stable dev ID cihdmkcdjjckfhjpgoedmgfpoljebaml,
#          OAuth redirect works, dev experience unbroken)
#   9.  Comment out the `key` field in wxt.config.ts
#   10. Build STORE zip without the dev key
#         → .output/matrx-extend-<ver>-store.zip
#         (this is the file you upload to the Chrome Web Store dashboard)
#   11. Restore the `key` field in wxt.config.ts
#         (also enforced by an EXIT trap — never leaves the working tree
#          in a state that breaks dev OAuth)
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
#   ./release.sh --dry-run               # preview without changing anything
#   ./release.sh --no-push               # build everything but don't push to remote

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
    echo -e "${RED}  ✗  RELEASE SCRIPT FAILED  (exit ${exit_code})${NC}" >&2
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}" >&2
    if $KEY_WAS_COMMENTED; then
        echo -e "${RED}  Key field was commented out by this run; the EXIT trap${NC}" >&2
        echo -e "${RED}  will restore it. Verify with: git diff wxt.config.ts${NC}" >&2
    else
        echo -e "${RED}  wxt.config.ts was NOT modified by this run.${NC}" >&2
    fi
    if $VERSION_BUMPED && ! $VERSION_COMMITTED; then
        echo -e "${RED}  package.json was bumped to ${NEW_VERSION:-?} but not committed.${NC}" >&2
        echo -e "${RED}  Reverting via: git checkout -- package.json${NC}" >&2
        git checkout -- package.json 2>/dev/null || true
    fi
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
        local_msg="${CUSTOM_MESSAGE:-chore: pre-release sync}"
        git commit -m "$local_msg"
        ok "Committed pre-release changes: $local_msg"
    fi
else
    ok "Working tree clean — proceeding with current HEAD"
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
step "1/8  Sync server API types"
if $SKIP_TYPES; then
    warn "Skipping server type sync (--skip-types)"
else
    pnpm update-api-types
    ok "API types synced"
fi

# ── 2. TypeScript typecheck ─────────────────────────────────────────────────
step "2/8  TypeScript typecheck"
if $SKIP_TYPECHECK; then
    warn "Skipping explicit tsc (--skip-typecheck)"
else
    pnpm compile
    ok "Typecheck passed"
fi

# ── 3. Bump version ─────────────────────────────────────────────────────────
step "3/8  Bump version → ${NEW_VERSION}"
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
pkg.version = '${NEW_VERSION}';
fs.writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\n');
"
ok "package.json → ${NEW_VERSION}"

# ── 4. Regen tool catalog ───────────────────────────────────────────────────
step "4/8  Regenerate tool catalog"
pnpm catalog:tools:md
ok "types/tool-catalog.{json,md} regenerated"

# ── 5. Commit version bump ──────────────────────────────────────────────────
step "5/8  Commit version bump"
COMMIT_MSG="release: ${NEW_TAG}"
git add package.json types/tool-catalog.json types/tool-catalog.md 2>/dev/null || true
# Only commit files that actually changed
if ! git diff --cached --quiet; then
    git commit -m "$COMMIT_MSG"
    ok "Committed: '$COMMIT_MSG'"
else
    warn "Nothing staged — skipping version-bump commit"
fi

# ── 6. Build LOCAL zip (dev key intact) ─────────────────────────────────────
step "6/8  Build LOCAL zip (dev key intact)"
rm -f "$WXT_ZIP_OUT"
pnpm zip
[[ -f "$WXT_ZIP_OUT" ]] || fail "Expected $WXT_ZIP_OUT but it was not produced"
mv "$WXT_ZIP_OUT" "$LOCAL_ZIP"
ok "Local zip → $LOCAL_ZIP"

# ── 7. Build STORE zip (key commented out) ──────────────────────────────────
step "7/8  Build STORE zip (key removed)"
_key_comment_out
rm -f "$WXT_ZIP_OUT"
pnpm zip
[[ -f "$WXT_ZIP_OUT" ]] || fail "Expected $WXT_ZIP_OUT but it was not produced"

# Sanity check: the store manifest must NOT contain a "key" field.
if unzip -p "$WXT_ZIP_OUT" manifest.json | grep -q '"key"'; then
    fail "Store zip still contains a key field. Aborting before upload."
fi
mv "$WXT_ZIP_OUT" "$STORE_ZIP"
ok "Store zip → $STORE_ZIP"

_key_restore  # restore eagerly (the EXIT trap will also catch any miss)

# Sanity check: the local manifest MUST contain a "key" field.
if ! unzip -p "$LOCAL_ZIP" manifest.json | grep -q '"key"'; then
    warn "Local zip is missing the key field — dev OAuth will break for unpacked installs."
fi

# ── 8. Tag and push ─────────────────────────────────────────────────────────
step "8/8  Tag and push"
git tag "$NEW_TAG"
ok "Tag $NEW_TAG created"

if $NO_PUSH; then
    warn "--no-push set — skipping git push"
else
    git push "$REMOTE" "$BRANCH"
    git push "$REMOTE" "$NEW_TAG"
    ok "Pushed $BRANCH and $NEW_TAG to $REMOTE"
fi

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
echo -e "      ${CYAN}${STORE_ABS}${NC}"
echo -e "   ${CYAN}4.${NC} Update the change-notes field, then ${BOLD}\"Submit for review\"${NC}"
echo -e "   ${CYAN}5.${NC} For local dev: install the ${BOLD}local${NC} zip unpacked at chrome://extensions"
echo -e "      (or just ${DIM}pnpm dev${NC})"
echo ""
echo -e "${DIM}  Reminder: never upload the local zip — it carries the dev keypair${NC}"
echo -e "${DIM}  and the Web Store will reject it. Full incident:${NC}"
echo -e "${DIM}    .research/v0.1.4-auth-incident.md${NC}"
echo ""
