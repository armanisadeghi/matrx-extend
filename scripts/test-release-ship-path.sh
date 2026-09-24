#!/usr/bin/env bash
# Guard for release.sh: a release script never denies a release.
#
# Builds a throwaway bare origin + checkout, then releases under the conditions
# that used to stop release.sh cold: uncommitted edits in the checkout, a branch
# diverged from origin, a foreign push landing mid-release, the next tag already
# taken on origin, an unknown flag, and FAILING unit tests (pnpm is a stub on
# PATH). It passes only if the release still lands (tag on origin, exit 0), the
# regenerated catalog rides in the release commit, the failing tests surface as
# an ERROR inside an opened-and-closed Checks section, and nothing is chattered.
#
#   scripts/test-release-ship-path.sh                  # test ./release.sh
#   scripts/test-release-ship-path.sh <path-to-script> # test another copy (e.g. an old one)
#
# Modeled on matrx-frontend's scripts/test-release-ship-path.sh. Never touches GitHub.
set -euo pipefail

SCRIPT_UNDER_TEST="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/release.sh}"
SCRIPT_UNDER_TEST="$(cd "$(dirname "$SCRIPT_UNDER_TEST")" && pwd)/$(basename "$SCRIPT_UNDER_TEST")"
SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT

git_q() { git -c user.name=test -c user.email=test@test -c core.hooksPath=/dev/null "$@" >/dev/null 2>&1; }

# ── origin + the shared checkout + a second writer ───────────────────────────
git_q init --bare -b main "$SANDBOX/origin.git"
git_q clone "$SANDBOX/origin.git" "$SANDBOX/checkout"
cd "$SANDBOX/checkout"
git config user.name test; git config user.email test@test; git config core.hooksPath /dev/null
cp "$SCRIPT_UNDER_TEST" release.sh
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

# ── stubs: pnpm (unit tests fail; the catalog regenerates), supabase ─────────
mkdir -p "$SANDBOX/bin"
cat > "$SANDBOX/bin/pnpm" <<STUB
#!/usr/bin/env bash
echo "\$*" >> "$SANDBOX/pnpm-calls"
args=" \$* "
case "\$args" in
    *" test "*) git --git-dir="$SANDBOX/origin.git" show main:package.json > "$SANDBOX/origin-at-test" 2>/dev/null
                echo " FAIL  tests/unit/a.test.ts"; echo "      Tests  2 failed | 10 passed (12)"; exit 1 ;;
    *" catalog:tools:md "*) mkdir -p types; echo "regenerated catalog" > types/tool-catalog.md; exit 0 ;;
esac
exit 0
STUB
printf '#!/usr/bin/env bash\nexit 0\n' > "$SANDBOX/bin/supabase"
chmod +x "$SANDBOX/bin/pnpm" "$SANDBOX/bin/supabase"

# ── release ──────────────────────────────────────────────────────────────────
RACE_CMD="[ -f '$SANDBOX/raced' ] || { touch '$SANDBOX/raced'; cd '$SANDBOX/other' && git pull -q origin main && echo race > race.txt && git add -A && git -c user.name=t -c user.email=t@t commit -qm race && git push -q origin main; }"
set +e
PATH="$SANDBOX/bin:$PATH" RELEASE_TEST_BEFORE_PUSH="$RACE_CMD" \
    bash release.sh --message "guard run" --bogus-flag > "$SANDBOX/out" 2>&1
STATUS=$?
set -e

FAILED=0
check() { if eval "$2"; then echo "  ok    $1"; else echo "  FAIL  $1"; FAILED=1; fi; }
git fetch -q origin 2>/dev/null || true
echo "release ship path — dirty tree + diverged branch + mid-release push + taken tag + bad flag + failing tests"
check "release exited 0"                              '[[ $STATUS -eq 0 ]]'
check "tag v0.1.2 is on origin (taken v0.1.1 skipped)" 'git ls-remote --tags origin | grep -q "refs/tags/v0.1.2$"'
check "the taken tag v0.1.1 was never moved"          '[[ "$(git ls-remote --tags origin refs/tags/v0.1.1 | cut -f1)" == "$(git rev-list -n1 origin/main~0 --grep=seed)" ]]'
check "origin/main carries version 0.1.2"             'git show origin/main:package.json | grep -q "\"version\": \"0.1.2\""'
check "the release commit is named"                   '[[ "$(git log -1 --format=%s origin/main)" == "release: v0.1.2 - guard run" ]]'
check "the push race really happened"                 '[[ -f "$SANDBOX/raced" ]]'
check "the foreign mid-release push survived"         'git cat-file -e origin/main:race.txt 2>/dev/null'
check "the local commit shipped"                      'git cat-file -e origin/main:mine.txt 2>/dev/null'
check "the regenerated catalog rode in the release"   'git show origin/main:types/tool-catalog.md | grep -q "regenerated catalog"'
check "uncommitted work was never touched"            'grep -q "uncommitted work" shared.txt'
check "nothing was stashed"                           '[[ -z "$(git stash list)" ]]'
check "no worktree or branch was created"             '[[ $(git worktree list | wc -l) -eq 1 && $(git branch | wc -l) -eq 1 ]]'
check "unit tests ran only AFTER the push"            'grep -q "\"version\": \"0.1.2\"" "$SANDBOX/origin-at-test" 2>/dev/null'
check "the first line is the ship line"               '[[ "$(head -1 "$SANDBOX/out")" =~ ^v0\.1\.2\ \ pushed\ \ \([0-9]+s\)$ ]]'
check "the Checks section opens"                      'grep -qx "==================== Checks ====================" "$SANDBOX/out"'
check "failing tests are an ERROR in Checks"          'grep -qE "^ERROR +Checks +unit tests failed \(2 failing\)" "$SANDBOX/out"'
check "the Checks section closes"                     'grep -qx "==================== End of Checks ====================" "$SANDBOX/out"'
check "the bad flag is a WARNING, not a refusal"      'grep -qE "^WARNING +Invocation +Unknown flag .--bogus-flag." "$SANDBOX/out"'
check "no INFO/OK chatter on the terminal"            '! grep -qE "\[(INFO|OK)\]" "$SANDBOX/out"'
check "a dated release log was written"               '[[ -s tmp/release-logs/latest.log ]]'

# ── second release: everything clean except a still-dirty tree ───────────────
cat > "$SANDBOX/bin/pnpm" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
chmod +x "$SANDBOX/bin/pnpm"
set +e
PATH="$SANDBOX/bin:$PATH" bash release.sh --minor > "$SANDBOX/out2" 2>&1
STATUS2=$?
set -e
echo "release ship path — a second, minor release"
check "second release exited 0"                       '[[ $STATUS2 -eq 0 ]]'
check "tag v0.2.0 is on origin"                       'git ls-remote --tags origin | grep -q "refs/tags/v0.2.0$"'
check "the checkout fast-forwarded to the release"    'git fetch -q origin; [[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]]'

if [[ $FAILED -ne 0 ]]; then
    echo "--- first run output ---"; tail -40 "$SANDBOX/out"; echo "--- second run ---"; tail -25 "$SANDBOX/out2" 2>/dev/null
    exit 1
fi
[[ -n "${SHOW_OUTPUT:-}" ]] && { echo "--- first run output ---"; cat "$SANDBOX/out"; }
echo "PASS"
