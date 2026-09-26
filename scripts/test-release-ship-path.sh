#!/usr/bin/env bash
# Guard for release.sh: a candidate must pass before publication.
#
# Builds a throwaway bare origin and checkout. Failed mandatory tests must exit
# nonzero without advancing main, pushing a tag, or replacing an installed
# bundle. A second run verifies that a foreign push after validation makes the
# script rebuild and revalidate the merged candidate before publication.
#
#   scripts/test-release-ship-path.sh                  # test ./release.sh
#   scripts/test-release-ship-path.sh <path-to-script> # test another copy (e.g. an old one)
#
# Modeled on matrx-frontend's scripts/test-release-ship-path.sh. Never touches GitHub.
set -euo pipefail

SCRIPT_UNDER_TEST="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/release.sh}"
SCRIPT_UNDER_TEST="$(cd "$(dirname "$SCRIPT_UNDER_TEST")" && pwd)/$(basename "$SCRIPT_UNDER_TEST")"
HARNESS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT

git_q() { git -c user.name=test -c user.email=test@test -c core.hooksPath=/dev/null "$@" >/dev/null 2>&1; }

# ── origin + the shared checkout + a second writer ───────────────────────────
git_q init --bare -b main "$SANDBOX/origin.git"
git_q clone "$SANDBOX/origin.git" "$SANDBOX/checkout"
cd "$SANDBOX/checkout"
git config user.name test; git config user.email test@test; git config core.hooksPath /dev/null
cp "$SCRIPT_UNDER_TEST" release.sh
cp "$HARNESS_ROOT/ship.sh" ship.sh
printf '{\n  "name": "matrx-extend",\n  "version": "0.1.0",\n  "private": true\n}\n' > package.json
mkdir -p types; echo "old catalog" > types/tool-catalog.md
echo "shared" > shared.txt
git_q add -A; git_q commit -m "seed"; git_q push origin main
git_q clone "$SANDBOX/origin.git" "$SANDBOX/other"
# The next patch tag is already taken on origin (a failed earlier run left it).
( cd "$SANDBOX/other" && git_q tag v0.1.1 && git_q push origin v0.1.1 )

# Diverge: origin gains a commit, the checkout gains a different one.
( cd "$SANDBOX/other" && echo "theirs" > theirs.txt && git_q add -A && git_q commit -m "theirs" && git_q push origin main )
echo "mine" > mine.txt; git_q add mine.txt; git_q commit -m "mine"
# Dirty: a tracked file with uncommitted edits, as the shared checkout always has.
echo "uncommitted work" >> shared.txt

# ── Controlled commands in the local checkout only ──────────────────────────
mkdir -p "$SANDBOX/bin"
mkdir -p scripts
cp "$HARNESS_ROOT/scripts/sync-unpacked-release.mjs" scripts/sync-unpacked-release.mjs
git_q add scripts/sync-unpacked-release.mjs; git_q commit -m "fixture sync helper"
REAL_NODE="$(command -v node)"
cat > "$SANDBOX/bin/node" <<STUB
#!/usr/bin/env bash
case "\$1" in
  scripts/check-store-package.mjs|scripts/check-cws-release-risk.mjs)
    echo "\$1" >> "$SANDBOX/node-gates"
    if [ -f "$SANDBOX/fail-store-package" ] && [ "\$1" = scripts/check-store-package.mjs ]; then exit 1; fi
    exit 0 ;;
esac
exec "$REAL_NODE" "\$@"
STUB
cat > "$SANDBOX/bin/pnpm" <<STUB
#!/usr/bin/env bash
echo "\$*" >> "$SANDBOX/pnpm-calls"
case " \$* " in
  *" update-api-types "*) [ -f "$SANDBOX/fail-generation" ] && exit 1 ;;
  *" catalog:tools:md "*) mkdir -p types; echo "regenerated catalog" > types/tool-catalog.md ;;
  *" check:matrx-packages "*) [ -f "$SANDBOX/fail-matrx-packages" ] && exit 1 ;;
  *" lint "*) [ -f "$SANDBOX/fail-lint" ] && exit 1 ;;
  *" exec vitest run --maxWorkers=1 "*)
    git rev-parse HEAD >> "$SANDBOX/checked-shas"
    if [ -f "$SANDBOX/fail-tests" ]; then
      echo " FAIL  tests/unit/release-contract.test.ts"
      echo "      Tests  2 failed | 10 passed (12)"
      exit 1
    fi ;;
  *" exec wxt zip "*)
    [ -f "$SANDBOX/fail-build" ] && exit 1
    mkdir -p .output/chrome-mv3
    version=\$(sed -n 's/^  "version": "\([^"]*\)".*/\1/p' package.json)
    if [ "\${MATRX_CWS_BUILD:-}" = 1 ]; then
      printf '{"version":"%s"}\\n' "\$version" > .output/chrome-mv3/manifest.json
    else
      printf '{"version":"%s","key":"fixture-dev-key"}\\n' "\$version" > .output/chrome-mv3/manifest.json
    fi
    ( cd .output/chrome-mv3 && zip -q ../matrx-extend-\$version-chrome.zip manifest.json )
    ;;
esac
exit 0
STUB
chmod +x "$SANDBOX/bin/node" "$SANDBOX/bin/pnpm"
printf '#!/usr/bin/env bash\nexit 0\n' > "$SANDBOX/bin/supabase"
chmod +x "$SANDBOX/bin/supabase"

# Failure: tests must stop publication and preserve the installed bundle.
mkdir -p .output/chrome-mv3-dev
echo "installed prior release" > .output/chrome-mv3-dev/sentinel.txt
printf 'prior Store zip\n' > .output/matrx-extend-0.1.0-store.zip
printf 'prior local zip\n' > .output/matrx-extend-0.1.0-local.zip
REMOTE_BASE="$(git --git-dir="$SANDBOX/origin.git" rev-parse main)"
touch "$SANDBOX/fail-matrx-packages"
set +e
PATH="$SANDBOX/bin:$PATH" bash release.sh > "$SANDBOX/stale-packages-out" 2>&1
STALE_PACKAGES_STATUS=$?
set -e
rm "$SANDBOX/fail-matrx-packages"
if [[ $STALE_PACKAGES_STATUS -ne 0 ]] \
    && grep -q 'matrx-packages failed' "$SANDBOX/stale-packages-out" \
    && ! grep -q 'exec vitest run' "$SANDBOX/pnpm-calls" \
    && [[ "$REMOTE_BASE" == "$(git --git-dir="$SANDBOX/origin.git" rev-parse main)" ]] \
    && ! git ls-remote --tags origin | grep -q 'refs/tags/v0.1.2$'; then
  echo '  ok    stale packages stop before unit tests and publication'
else
  echo '  FAIL  stale packages stop before unit tests and publication'
  exit 1
fi
# CI runs `pnpm lint`; a released candidate with Biome errors must stop here.
touch "$SANDBOX/fail-lint"
set +e
PATH="$SANDBOX/bin:$PATH" bash release.sh > "$SANDBOX/lint-out" 2>&1
LINT_STATUS=$?
set -e
rm "$SANDBOX/fail-lint"
if [[ $LINT_STATUS -ne 0 ]] \
    && grep -q 'lint failed' "$SANDBOX/lint-out" \
    && grep -q ' lint' "$SANDBOX/pnpm-calls" \
    && ! grep -q 'exec vitest run' "$SANDBOX/pnpm-calls" \
    && [[ "$REMOTE_BASE" == "$(git --git-dir="$SANDBOX/origin.git" rev-parse main)" ]] \
    && ! git ls-remote --tags origin | grep -q 'refs/tags/v0.1.2$'; then
  echo '  ok    CI lint failure stops before unit tests and publication'
else
  echo '  FAIL  CI lint failure stops before unit tests and publication'
  exit 1
fi
touch "$SANDBOX/fail-tests"
set +e
PATH="$SANDBOX/bin:$PATH" bash ship.sh "guard run" > "$SANDBOX/failed-out" 2>&1
FAILED_STATUS=$?
set -e
FAILED=0
check() { if eval "$2"; then echo "  ok    $1"; else echo "  FAIL  $1"; FAILED=1; fi; }
# Contention uses a real live owner; fake only sleeping so the old 60s steal
# fails this guard quickly. Neither missing PID nor stale metadata grants ownership.
REAL_SLEEP="$(command -v sleep)"
cat > "$SANDBOX/bin/sleep" <<STUB
#!/usr/bin/env bash
[ -f "$SANDBOX/lock-contention" ] && exit 0
exec "$REAL_SLEEP" "\$@"
STUB
chmod +x "$SANDBOX/bin/sleep"
mkdir .git/matrx-release-ship.lock
printf '%s\n' "$$" > .git/matrx-release-ship.lock/pid
touch "$SANDBOX/lock-contention"
CALLS_BEFORE_LOCK="$(wc -l < "$SANDBOX/pnpm-calls")"
set +e
PATH="$SANDBOX/bin:$PATH" bash release.sh > "$SANDBOX/lock-out" 2>&1
LOCK_STATUS=$?
set -e
check "live owner's lock survives contention" '[[ $LOCK_STATUS -ne 0 && "$(cat .git/matrx-release-ship.lock/pid 2>/dev/null)" == "$$" ]]'
check "contender starts no validation or build" '[[ "$(wc -l < "$SANDBOX/pnpm-calls")" == "$CALLS_BEFORE_LOCK" ]]'
rm -f .git/matrx-release-ship.lock/pid
set +e
PATH="$SANDBOX/bin:$PATH" bash release.sh > "$SANDBOX/unknown-owner-out" 2>&1
UNKNOWN_OWNER_STATUS=$?
set -e
check "unknown owner lock is preserved without running gates" '[[ $UNKNOWN_OWNER_STATUS -ne 0 && -d .git/matrx-release-ship.lock && "$(wc -l < "$SANDBOX/pnpm-calls")" == "$CALLS_BEFORE_LOCK" ]]'
rm -rf .git/matrx-release-ship.lock
rm "$SANDBOX/lock-contention"
git fetch -q origin 2>/dev/null || true
echo "release guard — failing mandatory tests"
check "failure exits nonzero"                         '[[ $FAILED_STATUS -ne 0 ]]'
check "remote main did not advance"                   '[[ "$REMOTE_BASE" == "$(git --git-dir="$SANDBOX/origin.git" rev-parse main)" ]]'
check "no new tag reached origin"                     '! git ls-remote --tags origin | grep -q "refs/tags/v0.1.2$"'
check "the old unpacked bundle is intact"             'grep -q "installed prior release" .output/chrome-mv3-dev/sentinel.txt'
check "prior Store zip is intact"                     'grep -q "prior Store zip" .output/matrx-extend-0.1.0-store.zip'
check "prior local zip is intact"                     'grep -q "prior local zip" .output/matrx-extend-0.1.0-local.zip'
check "failed candidate created no upload zip"        '[[ ! -e .output/matrx-extend-0.1.2-store.zip ]]'
check "candidate was checked before any publication"  '[[ -s "$SANDBOX/checked-shas" ]] && grep -q "nothing was pushed" "$SANDBOX/failed-out"'
check "local uncommitted work remains"                 'grep -q "uncommitted work" shared.txt'

# Failed generation and failed package build are equally publication-blocking.
rm "$SANDBOX/fail-tests"
touch "$SANDBOX/fail-generation"
set +e
PATH="$SANDBOX/bin:$PATH" bash release.sh > "$SANDBOX/generation-out" 2>&1
GEN_STATUS=$?
set -e
rm "$SANDBOX/fail-generation"
check "generation failure exits nonzero"              '[[ $GEN_STATUS -ne 0 ]]'
check "generation failure leaves main untouched"      '[[ "$REMOTE_BASE" == "$(git --git-dir="$SANDBOX/origin.git" rev-parse main)" ]]'
touch "$SANDBOX/fail-build"
set +e
PATH="$SANDBOX/bin:$PATH" bash release.sh > "$SANDBOX/build-out" 2>&1
BUILD_STATUS=$?
set -e
rm "$SANDBOX/fail-build"
check "package failure exits nonzero"                 '[[ $BUILD_STATUS -ne 0 ]]'
check "package failure leaves main untouched"         '[[ "$REMOTE_BASE" == "$(git --git-dir="$SANDBOX/origin.git" rev-parse main)" ]]'
touch "$SANDBOX/fail-store-package"
set +e
PATH="$SANDBOX/bin:$PATH" bash release.sh > "$SANDBOX/store-check-out" 2>&1
STORE_CHECK_STATUS=$?
set -e
rm "$SANDBOX/fail-store-package"
check "Store package gate exits nonzero"             '[[ $STORE_CHECK_STATUS -ne 0 ]]'
check "Store package gate leaves main untouched"     '[[ "$REMOTE_BASE" == "$(git --git-dir="$SANDBOX/origin.git" rev-parse main)" ]]'
check "failed prep preserved prior zips"              'grep -q "prior Store zip" .output/matrx-extend-0.1.0-store.zip && grep -q "prior local zip" .output/matrx-extend-0.1.0-local.zip'

# --no-push must reach the release preview without the old sync-main pre-push.
set +e
PATH="$SANDBOX/bin:$PATH" bash ship.sh --no-push > "$SANDBOX/no-push-out" 2>&1
NO_PUSH_STATUS=$?
set -e
check "ship --no-push only previews"                   '[[ $NO_PUSH_STATUS -eq 0 && "$REMOTE_BASE" == "$(git --git-dir="$SANDBOX/origin.git" rev-parse main)" ]]'

# A foreign branch push invalidates the checked first candidate. If the new
# candidate fails, its tag and main update must both be refused.
RACE_FAIL_CMD="[ -f '$SANDBOX/race-failed' ] || { touch '$SANDBOX/race-failed'; cd '$SANDBOX/other' && git pull -q origin main && echo race-failed > race-failed.txt && git add -A && git -c user.name=t -c user.email=t@t commit -qm race-failed && git push -q origin main && touch '$SANDBOX/fail-tests'; }"
set +e
PATH="$SANDBOX/bin:$PATH" RELEASE_TEST_BEFORE_PUSH="$RACE_FAIL_CMD" bash release.sh > "$SANDBOX/race-failed-out" 2>&1
RACE_FAIL_STATUS=$?
set -e
git fetch -q origin 2>/dev/null || true
check "failed second candidate exits nonzero"         '[[ -f "$SANDBOX/race-failed" && $RACE_FAIL_STATUS -ne 0 ]]'
check "foreign branch commit survived"                'git cat-file -e origin/main:race-failed.txt'
check "failed second candidate did not publish a tag" '! git ls-remote --tags origin | grep -q "refs/tags/v0.1.2$"'
check "failed second candidate kept remote version"   'git show origin/main:package.json | grep -q "\"version\": \"0.1.0\""'
rm "$SANDBOX/fail-tests"

# Pass: remote race forces a new candidate and a second complete validation.
PKG_CALLS_BEFORE_RACE="$(grep -c 'check:matrx-packages' "$SANDBOX/pnpm-calls" || true)"
RACE_CMD="grep -q 'Uncommitted checkout paths excluded' tmp/release-logs/latest.log && touch '$SANDBOX/exclusions-before-push'; [ -f '$SANDBOX/raced' ] || { touch '$SANDBOX/raced'; cd '$SANDBOX/other' && git pull -q origin main && echo race > race.txt && git add -A && git -c user.name=t -c user.email=t@t commit -qm race && git push -q origin main; }"
set +e
PATH="$SANDBOX/bin:$PATH" RELEASE_TEST_BEFORE_PUSH="$RACE_CMD" bash release.sh --message "guard run" > "$SANDBOX/passed-out" 2>&1
PASSED_STATUS=$?
set -e
git fetch -q origin 2>/dev/null || true
echo "release guard — validated candidate after a remote race"
check "dirty exclusions announced before push"        '[[ -f "$SANDBOX/exclusions-before-push" ]]'
check "successful release exits zero"                 '[[ $PASSED_STATUS -eq 0 ]]'
check "tag v0.1.2 reached origin"                      'git ls-remote --tags origin | grep -q "refs/tags/v0.1.2$"'
check "foreign push survived"                          'git cat-file -e origin/main:race.txt'
check "local commit survived"                          'git cat-file -e origin/main:mine.txt'
check "generated catalog shipped"                      'git show origin/main:types/tool-catalog.md | grep -q "regenerated catalog"'
check "checks ran for both candidates"                 '[[ $(wc -l < "$SANDBOX/checked-shas") -ge 3 ]]'
check "package freshness reran after race"            '[[ $(( $(grep -c "check:matrx-packages" "$SANDBOX/pnpm-calls") - PKG_CALLS_BEFORE_RACE )) -ge 2 ]]'
check "schema gate reran after race"                   '[[ $(grep -c "check:schema-routing:strict" "$SANDBOX/pnpm-calls") -ge 2 ]]'
check "Store package gate reran after race"           '[[ $(grep -c "scripts/check-store-package.mjs" "$SANDBOX/node-gates") -ge 2 ]]'
check "Store risk gate reran after race"              '[[ $(grep -c "scripts/check-cws-release-risk.mjs" "$SANDBOX/node-gates") -ge 2 ]]'
check "final checked SHA equals published SHA"         '[[ "$(tail -1 "$SANDBOX/checked-shas")" == "$(git rev-parse origin/main)" ]]'
check "local bundle was promoted after validation"     '[[ -f .output/chrome-mv3-dev/manifest.json && -f .output/release-receipt.json ]]'
check "both release zips exist"                         '[[ -f .output/matrx-extend-0.1.2-store.zip && -f .output/matrx-extend-0.1.2-local.zip ]]'
check "uncommitted work remained"                       'grep -q "uncommitted work" shared.txt'

# A simultaneous claim of the candidate tag must reject the entire atomic
# push; rebuilding selects the next free version and repeats the checks.
TAG_CMD="[ -f '$SANDBOX/tagged' ] || { touch '$SANDBOX/tagged'; git --git-dir='$SANDBOX/origin.git' tag v0.1.3 main; }"
set +e
PATH="$SANDBOX/bin:$PATH" RELEASE_TEST_BEFORE_PUSH="$TAG_CMD" bash release.sh > "$SANDBOX/tag-race-out" 2>&1
TAG_STATUS=$?
set -e
git fetch -q origin 2>/dev/null || true
check "tag claim forced candidate rebuild"             '[[ -f "$SANDBOX/tagged" && $TAG_STATUS -eq 0 ]]'
check "claimed tag kept its original target"            '[[ "$(git --git-dir="$SANDBOX/origin.git" rev-parse v0.1.3)" == "$(git --git-dir="$SANDBOX/origin.git" rev-parse main^)" ]]'
check "next free tag and main share commit"             '[[ "$(git --git-dir="$SANDBOX/origin.git" rev-parse v0.1.4)" == "$(git --git-dir="$SANDBOX/origin.git" rev-parse main)" ]]'
check "tag collision caused a second Store build"       '[[ $(grep -c "scripts/check-store-package.mjs" "$SANDBOX/node-gates") -ge 5 ]]'

# ZIP installation and restoration faults are filesystem dependency failures;
# the real release owns backup, rollback and EXIT cleanup decisions.
REAL_MV="$(command -v mv)"
cat > "$SANDBOX/bin/mv" <<STUB
#!/usr/bin/env bash
case "\$*" in
  *"/.release-artifacts."*"/local.zip "*)
    [ -f "$SANDBOX/fail-zip-install" ] && exit 1 ;;
  *"/.release-artifacts."*"/old-store.zip "*)
    [ -f "$SANDBOX/fail-zip-restore" ] && exit 1 ;;
esac
exec "$REAL_MV" "\$@"
STUB
chmod +x "$SANDBOX/bin/mv"
for failure in install restore; do
  version="0.1.5"
  [[ "$failure" == restore ]] && version="0.1.6"
  printf 'previous Store bytes\n' > ".output/matrx-extend-$version-store.zip"
  printf 'previous local bytes\n' > ".output/matrx-extend-$version-local.zip"
  cp .output/release-receipt.json "$SANDBOX/receipt-before-$failure"
  touch "$SANDBOX/fail-zip-install"
  [[ "$failure" == restore ]] && touch "$SANDBOX/fail-zip-restore"
  set +e
  PATH="$SANDBOX/bin:$PATH" bash release.sh > "$SANDBOX/zip-$failure-out" 2>&1
  ZIP_STATUS=$?
  set -e
  check "ZIP $failure failure is reported" '[[ $ZIP_STATUS -ne 0 ]]'
  check "ZIP $failure leaves installed receipt untouched" 'cmp -s .output/release-receipt.json "$SANDBOX/receipt-before-$failure"'
  check "ZIP $failure restores old local ZIP" 'grep -q "previous local bytes" ".output/matrx-extend-$version-local.zip"'
  if [[ "$failure" == install ]]; then
    check "ordinary rollback restores old Store ZIP" 'grep -q "previous Store bytes" ".output/matrx-extend-$version-store.zip"'
  else
    check "failed restoration preserves backup beyond EXIT" 'find .output -path "*/.release-artifacts.*/old-store.zip" -exec grep -l "previous Store bytes" {} \; | grep -q .'
    check "failed restoration names recovery path" 'grep -q "ZIP rollback incomplete; recovery files retained at" "$SANDBOX/zip-restore-out"'
  fi
  rm -f "$SANDBOX/fail-zip-install" "$SANDBOX/fail-zip-restore"
done

# A real content conflict must leave both commits and remote refs untouched.
git_q clone "$SANDBOX/origin.git" "$SANDBOX/conflict"
( cd "$SANDBOX/conflict" && git config user.name test && git config user.email test@test \
  && echo "local version" > shared.txt && git_q add shared.txt && git_q commit -m "local conflict" )
( cd "$SANDBOX/other" && git pull -q origin main && echo "remote version" > shared.txt \
  && git_q add shared.txt && git_q commit -m "remote conflict" && git_q push origin main )
CONFLICT_REMOTE_BASE="$(git --git-dir="$SANDBOX/origin.git" rev-parse main)"
set +e
( cd "$SANDBOX/conflict" && PATH="$SANDBOX/bin:$PATH" bash release.sh ) > "$SANDBOX/conflict-out" 2>&1
CONFLICT_STATUS=$?
set -e
check "merge conflict refused publication"             '[[ $CONFLICT_STATUS -ne 0 && "$CONFLICT_REMOTE_BASE" == "$(git --git-dir="$SANDBOX/origin.git" rev-parse main)" ]]'
check "local conflicting commit was preserved"         'git -C "$SANDBOX/conflict" show HEAD:shared.txt | grep -q "local version"'
check "remote conflicting commit was preserved"        'git --git-dir="$SANDBOX/origin.git" show main:shared.txt | grep -q "remote version"'
if [[ $FAILED -ne 0 ]]; then
  echo "--- failed release output ---"; tail -30 "$SANDBOX/failed-out"
  echo "--- passed release output ---"; tail -30 "$SANDBOX/passed-out"
  echo "--- failed second candidate output ---"; tail -20 "$SANDBOX/race-failed-out" 2>/dev/null
  echo "--- tag race output ---"; tail -20 "$SANDBOX/tag-race-out" 2>/dev/null
  echo "--- merge conflict output ---"; tail -20 "$SANDBOX/conflict-out" 2>/dev/null
  exit 1
fi
echo "PASS"
