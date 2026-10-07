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
# The sandbox releases must behave the same however this guard is launched. A
# real release runs it inside its own unit tests with the gate session it minted
# exported (AIDREAM_*) — inherited, it silently switches every nested release
# onto the caller-supplied-token path. Never inherit the caller's release state.
unset AIDREAM_API_TOKEN AIDREAM_ORGANIZATION_ID AIDREAM_API_URL \
    RELEASE_LOG_CAPTURED RELEASE_LOG_DIR RELEASE_LOG_FILE RELEASE_TEST_BEFORE_PUSH RELEASE_RACE_POLL_SECS

SCRIPT_UNDER_TEST="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/release.sh}"
SCRIPT_UNDER_TEST="$(cd "$(dirname "$SCRIPT_UNDER_TEST")" && pwd)/$(basename "$SCRIPT_UNDER_TEST")"
HARNESS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SANDBOX="$(mktemp -d)"
trap '[[ -n "${REGISTRY_PID:-}" ]] && { kill "$REGISTRY_PID" 2>/dev/null || true; wait "$REGISTRY_PID" 2>/dev/null || true; }; [[ -n "${KEEP_SANDBOX:-}" ]] && echo "sandbox kept: $SANDBOX" || rm -rf "$SANDBOX"' EXIT

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
# The catch-up scenarios eventually record @ai-matrx/fixture in their lockfile.
# Keep the real await gate in play, but point it at a disposable npm-shaped
# registry rather than making it poll public npm for this synthetic package.
cat > "$SANDBOX/fixture-registry.mjs" <<'STUB'
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';

const portFile = process.argv[2];
const server = createServer((req, res) => {
  const base = `http://127.0.0.1:${server.address().port}`;
  if (req.url === '/@ai-matrx/fixture') {
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        'dist-tags': { latest: '1.0.1' },
        versions: { '1.0.1': { dist: { tarball: `${base}/fixture-1.0.1.tgz` } } },
      }),
    );
    return;
  }
  if (req.url === '/fixture-1.0.1.tgz') {
    res.statusCode = 200;
    res.end();
    return;
  }
  res.statusCode = 404;
  res.end();
});
server.listen(0, '127.0.0.1', () => writeFileSync(portFile, String(server.address().port)));
STUB
"$REAL_NODE" "$SANDBOX/fixture-registry.mjs" "$SANDBOX/fixture-registry-port" &
REGISTRY_PID=$!
for _ in {1..50}; do
  [[ -s "$SANDBOX/fixture-registry-port" ]] && break
  sleep 0.1
done
[[ -s "$SANDBOX/fixture-registry-port" ]] || { echo 'fixture registry failed to start' >&2; exit 1; }
FIXTURE_REGISTRY="http://127.0.0.1:$(<"$SANDBOX/fixture-registry-port")"
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
  *" check:matrx-packages "*)
    [ -f "$SANDBOX/fail-matrx-packages" ] && exit 1
    if [ -f "$SANDBOX/pin-packages" ]; then
      printf '\n@ai-matrx install-graph check failed:\n  - PIN: @ai-matrx/fixture is declared as "1.0.0" in dependencies of package.json.\n\n' >&2
      exit 1
    fi
    if [ -f "$SANDBOX/stale-packages" ]; then
      printf '\n@ai-matrx install-graph check failed:\n  - STALE: @ai-matrx/fixture@%s is in the graph (the repo); npm latest is 9.9.9. REMEDY: pnpm update\n\n' \
        "\$(cat "$SANDBOX/fixture-version" 2>/dev/null || echo 1.0.0)" >&2
      exit 1
    fi ;;
  *" update -r "*" --depth Infinity"*) echo transitive >> "$SANDBOX/depth-passes" ;;
  *" update -r "*)
    # A sibling package landed on npm: install it, with its CHANGELOG entry.
    from=\$(cat "$SANDBOX/fixture-version" 2>/dev/null || echo 1.0.0)
    to="1.0.\$(( \${from##*.} + 1 ))"
    echo "\$to" > "$SANDBOX/fixture-version"
    mkdir -p node_modules/@ai-matrx/fixture
    printf '{"name":"@ai-matrx/fixture","version":"%s"}\n' "\$to" > node_modules/@ai-matrx/fixture/package.json
    if [ -f "$SANDBOX/changelog-action" ]; then note='**Consumer action:** delete your local copy of the helper.'; else note='No consumer action.'; fi
    printf '# Changelog\n\n## %s\n\n%s\n' "\$to" "\$note" > node_modules/@ai-matrx/fixture/CHANGELOG.md
    echo "  /@ai-matrx/fixture@\$to:" >> pnpm-lock.yaml
    [ -f "$SANDBOX/stale-forever" ] || rm -f "$SANDBOX/stale-packages" ;;
  *" lint "*) [ -f "$SANDBOX/fail-lint" ] && exit 1 ;;
  *" exec vitest run --maxWorkers=4 "*)
    git rev-parse HEAD >> "$SANDBOX/checked-shas"
    # A foreign push lands while this candidate's unit tests are still running.
    if [ -f "$SANDBOX/race-during" ] && [ ! -f "$SANDBOX/raced-during" ]; then
      touch "$SANDBOX/raced-during"
      ( cd "$SANDBOX/other" && git pull -q origin main && echo during > race-during.txt && git add -A \
        && git -c user.name=t -c user.email=t@t commit -qm race-during && git push -q origin main ) >/dev/null 2>&1
      echo \$\$ > "$SANDBOX/race-during-pids"
      sleep 30 & echo \$! >> "$SANDBOX/race-during-pids"; wait
    fi
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
# Every kill_tree call starts with `pgrep -P <pid>`: log it, so a run whose
# background jobs had all FINISHED can be seen signalling recycled PIDs.
REAL_PGREP="$(command -v pgrep)"
cat > "$SANDBOX/bin/pgrep" <<STUB
#!/usr/bin/env bash
echo "\$*" >> "$SANDBOX/pgrep-calls"
exec "$REAL_PGREP" "\$@"
STUB
chmod +x "$SANDBOX/bin/pgrep"
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
mkdir -p node_modules/.bin
cat > node_modules/.bin/biome <<'STUB'
#!/usr/bin/env bash
printf '%s\n' '{"diagnostics":[{"severity":"error","category":"format","location":{"path":{"file":"src/fixture.ts"},"sourceCode":"SYNTHETIC_SOURCE_MUST_NOT_LEAK"}}]}'
exit 1
STUB
chmod +x node_modules/.bin/biome
touch "$SANDBOX/fail-lint"
set +e
PATH="$SANDBOX/bin:$PATH" bash release.sh > "$SANDBOX/lint-out" 2>&1
LINT_STATUS=$?
set -e
rm "$SANDBOX/fail-lint"
if [[ $LINT_STATUS -ne 0 ]] \
    && grep -q 'lint failed' "$SANDBOX/lint-out" \
    && grep -q ' lint' "$SANDBOX/pnpm-calls" \
    && grep -q 'src/fixture.ts format format differs' "$SANDBOX/lint-out" \
    && ! grep -q 'SYNTHETIC_SOURCE_MUST_NOT_LEAK' "$SANDBOX/lint-out" \
    && ! grep -q 'exec vitest run' "$SANDBOX/pnpm-calls" \
    && [[ "$REMOTE_BASE" == "$(git --git-dir="$SANDBOX/origin.git" rev-parse main)" ]] \
    && ! git ls-remote --tags origin | grep -q 'refs/tags/v0.1.2$'; then
  echo '  ok    CI lint failure stops before unit tests and publication'
else
  echo '  FAIL  CI lint failure stops before unit tests and publication'
  exit 1
fi
touch "$SANDBOX/fail-tests"
rm -f "$SANDBOX/pgrep-calls"
set +e
PATH="$SANDBOX/bin:$PATH" bash release.sh --message "guard run" > "$SANDBOX/failed-out" 2>&1
FAILED_STATUS=$?
set -e
# Every parallel job had finished (its verdict was read) before the stop, so
# its PID may already belong to another process: the exit must signal none.
FINISHED_JOBS_SIGNALLED=0
[[ -f "$SANDBOX/pgrep-calls" ]] && FINISHED_JOBS_SIGNALLED="$(wc -l < "$SANDBOX/pgrep-calls")"
# The nested release log names the step that stopped it (export, gate, build);
# the sandbox is deleted on exit, so keep a copy for the failure dump below.
cp tmp/release-logs/latest.log "$SANDBOX/failed-release.log" 2>/dev/null || true
FAILED=0
check() { if eval "$2"; then echo "  ok    $1"; else echo "  FAIL  $1"; FAILED=1; fi; }
check "a stop after finished checks signals no recycled PID" '[[ "${FINISHED_JOBS_SIGNALLED// /}" == 0 ]]'
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

# --no-push is a release preview.
set +e
PATH="$SANDBOX/bin:$PATH" bash release.sh --no-push > "$SANDBOX/no-push-out" 2>&1
NO_PUSH_STATUS=$?
set -e
check "release --no-push only previews"                  '[[ $NO_PUSH_STATUS -eq 0 && "$REMOTE_BASE" == "$(git --git-dir="$SANDBOX/origin.git" rev-parse main)" ]]'

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
# The hook creates fail-tests only if it ran; a release that stopped before the
# hook must still reach the diagnostic dump below instead of dying here (set -e).
rm -f "$SANDBOX/fail-tests"

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

# `git archive | tar -x` loses a race under load: tar exits at the end-of-archive
# marker, git dies of SIGPIPE (141) and the export fails silently.
check "snapshot export never pipes git archive into tar" '! grep -qE "^[^#]*git archive[^#]*\| *tar" "$SCRIPT_UNDER_TEST"'

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

# A post-push ZIP failure leaves local HEAD one version behind remote main.
# That version-only manifest delta must allow the next release to finish.
VERSION_RETRY_BASE="$(git --git-dir="$SANDBOX/origin.git" rev-parse main)"
set +e
PATH="$SANDBOX/bin:$PATH" bash release.sh > "$SANDBOX/version-retry-out" 2>&1
VERSION_RETRY_STATUS=$?
set -e
check "version-only retry succeeds after failed promotion" '[[ $VERSION_RETRY_STATUS -eq 0 && "$(git --git-dir="$SANDBOX/origin.git" rev-parse main)" != "$VERSION_RETRY_BASE" ]]'
check "version-only retry publishes validated tag" 'git ls-remote --tags origin | grep -q "refs/tags/v0.1.7$"'

# A changed manifest field other than version invalidates the runner install.
# The candidate must stop before any generation, check, or publication.
PKG_CALLS_BEFORE_INPUT_CHANGE="$(wc -l < "$SANDBOX/pnpm-calls")"
( cd "$SANDBOX/other" && git pull -q origin main \
  && python3 -c 'import json; from pathlib import Path; p=Path("package.json"); d=json.loads(p.read_text()); d["dependencies"]={"fixture-new-dependency":"1.0.0"}; p.write_text(json.dumps(d, indent=2)+"\n")' \
  && git add package.json && git -c user.name=t -c user.email=t@t commit -qm 'change dependency input' \
  && git push -q origin main )
INPUT_CHANGE_BASE="$(git --git-dir="$SANDBOX/origin.git" rev-parse main)"
set +e
PATH="$SANDBOX/bin:$PATH" bash release.sh > "$SANDBOX/dependency-input-out" 2>&1
INPUT_CHANGE_STATUS=$?
set -e
check "non-version manifest delta stops before validation" '[[ $INPUT_CHANGE_STATUS -ne 0 && "$(wc -l < "$SANDBOX/pnpm-calls")" == "$PKG_CALLS_BEFORE_INPUT_CHANGE" ]]'
check "non-version manifest delta stays unpublished" '[[ "$(git --git-dir="$SANDBOX/origin.git" rev-parse main)" == "$INPUT_CHANGE_BASE" ]]'
check "dependency refusal identifies retry" 'grep -q "merged candidate changes dependency inputs since installation" "$SANDBOX/dependency-input-out"'

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
# ship.sh = Arman's rule (2026-09-24, restated 2026-09-26): commit ALL, pull ALL, push ALL, then
# release. A refused release must never leave local work unpushed or GitHub's commits unpulled.
git_q clone "$SANDBOX/origin.git" "$SANDBOX/shipper"
( cd "$SANDBOX/other" && git pull -q origin main && echo "from github" > github-side.txt \
  && git_q add github-side.txt && git_q commit -m "github side" && git_q push origin main )
cd "$SANDBOX/shipper"
git config user.name test; git config user.email test@test; git config core.hooksPath /dev/null
cp "$HARNESS_ROOT/ship.sh" ship.sh; cp "$SCRIPT_UNDER_TEST" release.sh
mkdir -p scripts
cp "$HARNESS_ROOT/scripts/sync-main.py" "$HARNESS_ROOT/scripts/check-conflict-markers.py" \
  "$HARNESS_ROOT/scripts/release-matrx-catchup.mjs" "$HARNESS_ROOT/scripts/await-matrx-latest.mjs" scripts/
git_q reset -q --hard origin/main~1 2>/dev/null || true
echo "agent work nobody committed" > uncommitted-agent-work.txt
# The release only needs to be refused; fail its first check so this scenario stays cheap.
touch "$SANDBOX/fail-matrx-packages"
set +e
PATH="$SANDBOX/bin:$PATH" bash ship.sh "ship guard" > "$SANDBOX/ship-out" 2>&1
set -e
rm -f "$SANDBOX/fail-matrx-packages"
git fetch -q origin 2>/dev/null || true
echo "ship.sh — commit all, pull all, push all, even when the release is refused"
check "uncommitted work was committed and pushed"     'git show origin/main:uncommitted-agent-work.txt | grep -q "agent work nobody committed"'
check "GitHub's commits were pulled"                  '[[ -f github-side.txt ]]'
check "checkout equals GitHub's main"                 '[[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]]'
check "ship reports its sync for ship-all"            'grep -q "ship.sh: sync exit 0, release exit" "$SANDBOX/ship-out"'
cd "$SANDBOX/checkout"

# A sibling @ai-matrx package published between the sync and the gate is STALE
# only: the release updates, reads the new CHANGELOG entries, commits the
# lockfile and re-runs every gate on a fresh candidate. Anything else stops.
git_q clone "$SANDBOX/origin.git" "$SANDBOX/catchup"
cd "$SANDBOX/catchup"
git config user.name test; git config user.email test@test; git config core.hooksPath /dev/null
mkdir -p scripts; cp "$HARNESS_ROOT/scripts/release-matrx-catchup.mjs" "$HARNESS_ROOT/scripts/await-matrx-latest.mjs" scripts/
printf 'lockfileVersion: 9.0\n' > pnpm-lock.yaml
git_q add pnpm-lock.yaml scripts/release-matrx-catchup.mjs scripts/await-matrx-latest.mjs; git_q commit -m "lockfile"
run_release() { set +e; MATRX_AWAIT_REGISTRY="$FIXTURE_REGISTRY" PATH="$SANDBOX/bin:$PATH" bash release.sh > "$SANDBOX/$1" 2>&1; local rc=$?; set -e; return $rc; }
updates() { grep -c '^update -r.*--latest' "$SANDBOX/pnpm-calls" || true; }
echo "release — @ai-matrx catch-up"
CATCHUP_BASE="$(git --git-dir="$SANDBOX/origin.git" rev-parse main)"
touch "$SANDBOX/pin-packages"; UPDATES_BEFORE="$(updates)"
PIN_STATUS=0; run_release catchup-pin-out || PIN_STATUS=$?
rm -f "$SANDBOX/pin-packages"
check "PIN is never caught up"                         '[[ $PIN_STATUS -ne 0 && "$(updates)" == "$UPDATES_BEFORE" && "$CATCHUP_BASE" == "$(git --git-dir="$SANDBOX/origin.git" rev-parse main)" ]]'
touch "$SANDBOX/stale-packages" "$SANDBOX/changelog-action"
ACTION_STATUS=0; run_release catchup-action-out || ACTION_STATUS=$?
rm -f "$SANDBOX/changelog-action"
check "a declared Consumer action stops the release"   '[[ $ACTION_STATUS -ne 0 && "$CATCHUP_BASE" == "$(git --git-dir="$SANDBOX/origin.git" rev-parse main)" ]]'
check "the Consumer action is named"                   'grep -q "@ai-matrx/fixture@1.0.1 Consumer action: delete your local copy" "$SANDBOX/catchup-action-out"'
git checkout -q -- pnpm-lock.yaml
touch "$SANDBOX/stale-packages" "$SANDBOX/stale-forever"; UPDATES_BEFORE="$(updates)"
FOREVER_STATUS=0; run_release catchup-forever-out || FOREVER_STATUS=$?
rm -f "$SANDBOX/stale-forever" "$SANDBOX/stale-packages"
check "catch-up is bounded to three"                   '[[ $FOREVER_STATUS -ne 0 && $(( $(updates) - UPDATES_BEFORE )) -eq 3 && "$CATCHUP_BASE" == "$(git --git-dir="$SANDBOX/origin.git" rev-parse main)" ]]'
check "the bound is named"                             'grep -q "moved again after 3 catch-ups" "$SANDBOX/catchup-forever-out"'
git_q reset -q --hard origin/main
cp "$HARNESS_ROOT/scripts/release-matrx-catchup.mjs" "$HARNESS_ROOT/scripts/await-matrx-latest.mjs" scripts/; printf 'lockfileVersion: 9.0\n' > pnpm-lock.yaml
git_q add pnpm-lock.yaml scripts/release-matrx-catchup.mjs scripts/await-matrx-latest.mjs; git_q commit -m "lockfile again"
echo 1.0.0 > "$SANDBOX/fixture-version"
touch "$SANDBOX/stale-packages"; PKG_CHECKS_BEFORE="$(grep -c 'check:matrx-packages' "$SANDBOX/pnpm-calls")"
CATCHUP_STATUS=0; run_release catchup-out || CATCHUP_STATUS=$?
git fetch -q origin 2>/dev/null || true
check "a STALE-only gate catches up and ships"         '[[ $CATCHUP_STATUS -eq 0 ]] && grep -q "  pushed" "$SANDBOX/catchup-out"'
check "the catch-up also moves transitives"            '[[ -s "$SANDBOX/depth-passes" ]]'
check "the caught-up lockfile is in the release"       'git show origin/main:pnpm-lock.yaml | grep -q "@ai-matrx/fixture@1.0.1"'
check "the catch-up commit is in main"                 '[[ -n "$(git log --format=%s --grep="catch up @ai-matrx packages" origin/main)" ]]'
check "the package gate ran again on the new candidate" '[[ $(( $(grep -c "check:matrx-packages" "$SANDBOX/pnpm-calls") - PKG_CHECKS_BEFORE )) -eq 2 ]]'
check "the replaced candidate leaves no ERROR"         '! grep -q "^ERROR .*matrx-packages failed" "$SANDBOX/catchup-out"'

# Other agents push main every minute or two; one candidate takes minutes to
# check. A push that lands WHILE the checks run must be seen then (2026-10-06:
# v0.2.341 lost five races, each found only by a rejected push at the end).
# The stale candidate is abandoned at once and the next one is checked in full.
echo "release — a race seen during validation"
touch "$SANDBOX/race-during"
DURING_START=$SECONDS
set +e
RELEASE_RACE_POLL_SECS=1 PATH="$SANDBOX/bin:$PATH" bash release.sh > "$SANDBOX/race-during-out" 2>&1
DURING_STATUS=$?
set -e
DURING_SECS=$((SECONDS - DURING_START))
rm -f "$SANDBOX/race-during"
git fetch -q origin 2>/dev/null || true
check "the race ran during validation"                 '[[ -f "$SANDBOX/raced-during" ]]'
check "release after a mid-check race exits zero"      '[[ $DURING_STATUS -eq 0 ]] && grep -q "  pushed" "$SANDBOX/race-during-out"'
check "the race was seen during validation, not at push" 'grep -q "lost validation race 1" tmp/release-logs/latest.log && ! grep -q "lost push race" tmp/release-logs/latest.log'
check "the stale candidate was abandoned at once"      '[[ $DURING_SECS -lt 30 ]]'
check "the foreign mid-check push survived"            'git cat-file -e origin/main:race-during.txt'
check "published SHA is the last fully checked SHA"    '[[ "$(tail -1 "$SANDBOX/checked-shas")" == "$(git rev-parse origin/main)" ]]'
check "the abandoned check left no process behind"     '[[ -s "$SANDBOX/race-during-pids" ]] && ! (for p in $(cat "$SANDBOX/race-during-pids"); do kill -0 "$p" 2>/dev/null && exit 0; done; exit 1)'
cd "$SANDBOX/checkout"

if [[ $FAILED -ne 0 ]]; then
  echo "--- catch-up output ---"; tail -30 "$SANDBOX/catchup-out" 2>/dev/null
  echo "--- mid-check race output ---"; tail -30 "$SANDBOX/race-during-out" 2>/dev/null
  echo "--- ship output ---"; tail -30 "$SANDBOX/ship-out" 2>/dev/null
  echo "--- failed release output ---"; tail -30 "$SANDBOX/failed-out"
  echo "--- failed release log ---"; tail -60 "$SANDBOX/failed-release.log" 2>/dev/null
  echo "--- passed release output ---"; tail -30 "$SANDBOX/passed-out"
  echo "--- failed second candidate output ---"; grep -E "^(RELEASE STOPPED|gate=|ERROR )" "$SANDBOX/race-failed-out" 2>/dev/null; tail -20 "$SANDBOX/race-failed-out" 2>/dev/null
  echo "--- tag race output ---"; grep -E "^(RELEASE STOPPED|gate=|ERROR )" "$SANDBOX/tag-race-out" 2>/dev/null; tail -20 "$SANDBOX/tag-race-out" 2>/dev/null
  echo "--- merge conflict output ---"; tail -20 "$SANDBOX/conflict-out" 2>/dev/null
  echo "--- version-only retry output ---"; tail -30 "$SANDBOX/version-retry-out" 2>/dev/null
  for f in install restore; do echo "--- zip $f output ---"; tail -15 "$SANDBOX/zip-$f-out" 2>/dev/null; done
  # Every nested release's own log: the steps (snapshot export, gates) write
  # their errors only there, and the sandbox is deleted on exit.
  for log in "$SANDBOX"/*/tmp/release-logs/release-*.log; do
    [[ -f "$log" ]] || continue
    echo "--- nested release log ${log#"$SANDBOX"/} ---"
    grep -av '^?? ' "$log" | tail -25
  done
  exit 1
fi
echo "PASS"
