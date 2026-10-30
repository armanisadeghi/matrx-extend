#!/usr/bin/env bash
# Guard: the release path works NESTED in the aidream monorepo (apps/matrx-extend), and the layout
# helpers still say "standalone" in a standalone checkout. scripts/test-release-ship-path.sh is the
# standalone guard of release.sh; this one builds an aidream-shaped bare origin + checkout whose app lives at
# apps/matrx-extend and proves, with the real release.sh / ship.sh / sync-main.py:
#   * the release commit changes ONLY apps/matrx-extend/ on top of aidream's main (a dirty server file,
#     aidream's other folders and its plain v* tags are untouched), and its tag is matrx-extend/vX.Y.Z
#     (a taken matrx-extend/ tag is skipped; aidream's plain v0.1.x tags never are);
#   * gates and the build run in a snapshot that is the app folder alone, with ../aidream = the toplevel;
#   * a foreign aidream push outside the app during checks is gate-inert: adopted, never a re-validation;
#   * another nested app's release lock (matrx-release-ship.lock) never blocks Extend's;
#   * the app's sync-main.py refuses its sweep/merge nested (from any cwd), and ship.sh syncs with the
#     host's sync-main.py instead; the dry run names the prefixed tag;
#   * scripts/app-git.sh and scripts/app-layout.mjs answer the nested layout (and the standalone one).
# Never touches GitHub. Usage: scripts/test-release-nested.sh [<release.sh under test, e.g. an old copy>]
set -euo pipefail
unset AIDREAM_API_TOKEN AIDREAM_ORGANIZATION_ID AIDREAM_API_URL RELEASE_LOG_CAPTURED RELEASE_LOG_DIR \
    RELEASE_LOG_FILE RELEASE_TEST_BEFORE_PUSH MATRX_EXTEND_GITHUB_REPO AIDREAM_ROOT MATRX_SHIP_SKIP_SYNC
export MATRX_RELEASE_SCREAM_NO_MAIL=1
HARNESS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_UNDER_TEST="$(cd "$(dirname "${1:-$HARNESS_ROOT/release.sh}")" && pwd)/$(basename "${1:-release.sh}")"
SANDBOX="$(mktemp -d)"
SANDBOX="$(cd "$SANDBOX" && pwd -P)"
export MATRX_RELEASE_SCREAM_HELPER="$SANDBOX/no-release-scream-helper.py"
trap '[[ -n "${KEEP_SANDBOX:-}" ]] && echo "sandbox kept: $SANDBOX" || rm -rf "$SANDBOX"' EXIT
export GIT_CONFIG_NOSYSTEM=1 GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@test GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@test
git_q() { git -c core.hooksPath=/dev/null -c init.defaultBranch=main "$@" >/dev/null 2>&1; }
APP=apps/matrx-extend

# ── aidream stand-in: origin, the shared checkout, another writer ────────────
git_q init --bare -b main "$SANDBOX/origin.git"
git_q clone "$SANDBOX/origin.git" "$SANDBOX/aidream"
W="$SANDBOX/aidream"
cd "$W"
git config core.hooksPath /dev/null
mkdir -p scripts apps/matrx-frontend "$APP/scripts" "$APP/types"
echo "x = 1" > server.py
echo "export {};" > apps/matrx-frontend/page.tsx
# The host's sync: records that ship.sh chose it, and succeeds.
cat > scripts/sync-main.py <<PY
import os, sys
open("$SANDBOX/host-sync-ran", "a").write(os.getcwd() + "\n")
PY
# The host's conflict list (aidream has its own): records that ship.sh chose it.
printf 'open("%s/host-conflicts-ran", "a").write("x")\n' "$SANDBOX" > scripts/check-conflict-markers.py
cp "$RELEASE_UNDER_TEST" "$APP/release.sh"; cp "$HARNESS_ROOT/ship.sh" "$APP/"
for f in app-git.sh app-layout.mjs release-owner-lock.sh release-snapshot-dependencies.sh release-lock-conflict.mjs \
         release-package-diagnostics.mjs check-dev-emitted-title.mjs sync-unpacked-release.mjs sync-main.py \
         check-conflict-markers.py; do
    cp "$HARNESS_ROOT/scripts/$f" "$APP/scripts/$f"
done
printf '{\n  "name": "matrx-extend",\n  "version": "0.1.0",\n  "private": true\n}\n' > "$APP/package.json"
printf 'lockfileVersion: 9.0\n' > "$APP/pnpm-lock.yaml"
echo "old catalog" > "$APP/types/tool-catalog.md"
printf 'node_modules\n.output\ntmp\n' > "$APP/.gitignore"
git_q add -A; git_q commit -m seed; git_q push origin main
# aidream's own plain tags (its server releases) and one taken Extend tag.
git_q tag v0.1.1; git_q tag v0.1.2; git_q tag matrx-extend/v0.1.1
git_q push origin v0.1.1 v0.1.2 matrx-extend/v0.1.1
git_q clone "$SANDBOX/origin.git" "$SANDBOX/other"
# Uncommitted work outside the app, as the shared aidream checkout always has.
echo "x = 2  # uncommitted" > server.py

# ── stubs (this sandbox only) ────────────────────────────────────────────────
mkdir -p "$SANDBOX/bin"
REAL_NODE="$(command -v node)"
cat > "$SANDBOX/bin/node" <<STUB
#!/usr/bin/env bash
case "\$1" in
  scripts/check-store-package.mjs|scripts/check-cws-release-risk.mjs) exit 0 ;;
esac
exec "$REAL_NODE" "\$@"
STUB
cat > "$SANDBOX/bin/pnpm" <<STUB
#!/usr/bin/env bash
echo "\$PWD :: \$*" >> "$SANDBOX/pnpm-calls"
case " \$* " in
  *" install --frozen-lockfile --package-import-method=clone-or-copy "*) mkdir -p node_modules/.bin ;;
  *" catalog:tools:md "*) mkdir -p types; echo "regenerated catalog" > types/tool-catalog.md ;;
  *" exec vitest run --maxWorkers=4 "*)
    { echo "cwd=\$PWD"; ls -A; echo "aidream=\$(cd ../aidream && pwd -P)"; echo "head=\$(git rev-parse HEAD)"; } > "$SANDBOX/check-snapshot.\$\$"
    echo x >> "$SANDBOX/check-runs"
    # aidream's main moves for server work while this candidate is checked (once).
    if [ ! -f "$SANDBOX/raced" ]; then
      touch "$SANDBOX/raced"
      ( cd "$SANDBOX/other" && git pull -q origin main && echo "y = 1" > other_server.py && git add -A \
        && git commit -qm "server work" && git push -q origin main ) >/dev/null 2>&1
      sleep 4
    fi ;;
  *" exec wxt zip "*)
    mkdir -p .output/chrome-mv3
    version=\$(sed -n 's/^  "version": "\([^"]*\)".*/\1/p' package.json)
    if [ "\${MATRX_CWS_BUILD:-}" = 1 ]; then
      printf '{"version":"%s"}\\n' "\$version" > .output/chrome-mv3/manifest.json
    else
      printf '{"version":"%s","key":"k","name":"Matrx Extend DEV","action":{"default_title":"Matrx Extend DEV"}}\\n' "\$version" > .output/chrome-mv3/manifest.json
    fi
    ( cd .output/chrome-mv3 && zip -q ../matrx-extend-\$version-chrome.zip manifest.json ) ;;
esac
exit 0
STUB
printf '#!/usr/bin/env bash\necho "[]"\n' > "$SANDBOX/bin/gh"
chmod +x "$SANDBOX/bin/node" "$SANDBOX/bin/pnpm" "$SANDBOX/bin/gh"
export PATH="$SANDBOX/bin:$PATH"
export AIDREAM_API_TOKEN=sandbox-token RELEASE_RACE_POLL_SECS=1

FAILED=0
check() { if eval "$2"; then echo "  ok    $1"; else echo "  FAIL  $1"; FAILED=1; fi; }
o() { git --git-dir="$SANDBOX/origin.git" "$@"; }

# ── layout answers ───────────────────────────────────────────────────────────
check "app-git.sh: nested prefix, matrx-extend/ tags, aidream = the toplevel" \
    '[[ "$(bash $APP/scripts/app-git.sh layout)" == *"APP_PREFIX=$APP/"*"TAG_PREFIX=matrx-extend/"*"AIDREAM_DIR=$W"*"EXTEND_GITHUB_REPO=AI-Matrix-Engine/aidream"* ]]'
check "app-layout.mjs: nested GitHub repo and aidream root" \
    '[[ "$(node $APP/scripts/app-layout.mjs github-repo)" == AI-Matrix-Engine/aidream && "$(node $APP/scripts/app-layout.mjs aidream-root)" == "$W" ]]'
check "app-git.sh in a standalone checkout: no prefix, plain v* tags" \
    '[[ "$(bash "$HARNESS_ROOT/scripts/app-git.sh" tag-prefix)" == "" && "$(bash "$HARNESS_ROOT/scripts/app-git.sh" prefix)" == "" ]] || [[ -n "$(git -C "$HARNESS_ROOT" rev-parse --show-prefix)" ]]'

# ── sync-main.py nested ──────────────────────────────────────────────────────
set +e
( cd "$APP" && python3 scripts/sync-main.py ) > "$SANDBOX/sync-app.out" 2>&1; SYNC_APP=$?
python3 "$APP/scripts/sync-main.py" > "$SANDBOX/sync-top.out" 2>&1; SYNC_TOP=$?
( cd "$APP" && python3 scripts/sync-main.py --wait-for-publish-train ) > "$SANDBOX/sync-train.out" 2>&1; SYNC_TRAIN=$?
set -e
check "the app's sync refuses nested (from the app folder)" '[[ $SYNC_APP == 1 ]] && grep -q "nested in a monorepo" "$SANDBOX/sync-app.out"'
check "the app's sync refuses nested (from the toplevel)" '[[ $SYNC_TOP == 1 ]] && grep -q "nested in a monorepo" "$SANDBOX/sync-top.out"'
check "its --wait-for-publish-train still runs nested (release.sh's catch-up)" '[[ $SYNC_TRAIN == 0 ]]'
check "the refused sync committed nothing" '[[ "$(git rev-parse HEAD)" == "$(o rev-parse main)" && -n "$(git status --porcelain -- server.py)" ]]'

# ── dry run ──────────────────────────────────────────────────────────────────
( cd "$APP" && bash release.sh --dry-run ) > "$SANDBOX/dry.out" 2>&1 || true
check "dry run names matrx-extend/v0.1.2 (taken /v0.1.1 skipped; plain v0.1.2 is aidream's, not taken)" \
    'grep -q "would release matrx-extend/v0.1.2" "$SANDBOX/dry.out"'

# ── the release ──────────────────────────────────────────────────────────────
# Another nested app's release holds ITS lock in the shared git dir: never Extend's.
mkdir .git/matrx-release-ship.lock; echo "$$" > .git/matrx-release-ship.lock/pid
BASE0="$(o rev-parse main)"
set +e
( cd "$APP" && bash release.sh --message "nested guard" ) > "$SANDBOX/release.out" 2>&1; REL=$?
set -e
MAIN="$(o rev-parse main)"
check "release exits 0 and pushes matrx-extend/v0.1.2" '[[ $REL == 0 ]] && grep -q "matrx-extend/v0.1.2  pushed" "$SANDBOX/release.out"'
check "the tag is matrx-extend/v0.1.2 at main; no plain v* tag was added" \
    '[[ "$(o rev-parse "refs/tags/matrx-extend/v0.1.2^{commit}" 2>/dev/null)" == "$MAIN" && "$(o tag -l "v*" | tr "\n" " ")" == "v0.1.1 v0.1.2 " ]]'
check "the release commit changes only apps/matrx-extend/ (version + regenerated catalog)" \
    '[[ "$(o diff --name-only "$MAIN^1" "$MAIN" | tr "\n" " ")" == "$APP/package.json $APP/types/tool-catalog.md " ]]'
check "version 0.1.2 in the app's package.json; aidream's dirty server.py was not released" \
    '[[ "$(o show "$MAIN:$APP/package.json" | sed -n "s/^  \"version\": \"\(.*\)\".*/\1/p")" == 0.1.2 && "$(o show "$MAIN:server.py")" == "x = 1" ]]'
check "aidream's foreign push during checks was adopted as gate-inert (one check run, built on it)" \
    '[[ "$(cat "$SANDBOX/check-runs" 2>/dev/null | wc -l | tr -d " ")" == 1 && "$(o show "$MAIN:other_server.py" 2>/dev/null)" == "y = 1" && "$(o rev-parse "$MAIN^1")" != "$BASE0" ]]'
SNAP_FILE="$(ls "$SANDBOX"/check-snapshot.* 2>/dev/null | head -1 || true)"; : "${SNAP_FILE:=/dev/null}"
check "checks ran in the app folder alone, ../aidream = the toplevel, HEAD = the candidate" \
    '! grep -qx "apps" "$SNAP_FILE" && ! grep -qx "server.py" "$SNAP_FILE" && grep -qx "package.json" "$SNAP_FILE" && grep -qx "aidream=$W" "$SNAP_FILE"'
check "the other app's lock was left alone" '[[ "$(cat .git/matrx-release-ship.lock/pid)" == "$$" && ! -e .git/matrx-release-ship-matrx-extend.lock ]]'
check "release log named without a slash in the tag" '[[ -L "$APP/tmp/release-logs/release-matrx-extend-v0.1.2.log" ]]'

# ── ship.sh nested: the host's sync, then the release ────────────────────────
git_q pull --no-rebase origin main || true
set +e
( cd "$APP" && bash ship.sh "ship guard" ) > "$SANDBOX/ship.out" 2>&1; SHIP=$?
set -e
check "ship.sh syncs with the host's sync-main.py, then releases matrx-extend/v0.1.3" \
    '[[ $SHIP == 0 && -s "$SANDBOX/host-sync-ran" && -s "$SANDBOX/host-conflicts-ran" ]] && grep -q "matrx-extend/v0.1.3  pushed" "$SANDBOX/ship.out"'

if [[ $FAILED != 0 ]]; then
    echo "--- release.out"; tail -40 "$SANDBOX/release.out"; echo "--- ship.out"; tail -20 "$SANDBOX/ship.out"
    echo "--- latest.log"; tail -40 "$APP/tmp/release-logs/latest.log" 2>/dev/null || true
    echo "test-release-nested: FAILED"; exit 1
fi
echo "test-release-nested: all checks passed"
