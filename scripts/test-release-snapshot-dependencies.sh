#!/usr/bin/env bash
# Exercise the production helper with a controlled package installer.
set -euo pipefail
HELPER="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/release-snapshot-dependencies.sh}"
source "$HELPER"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT
export TEST_ROOT
mkdir -p "$TEST_ROOT/bin" "$TEST_ROOT/shared/node_modules/@ai-matrx/fixture"
printf 'shared-old' > "$TEST_ROOT/shared/node_modules/@ai-matrx/fixture/version"
cat > "$TEST_ROOT/bin/pnpm" <<'PNPM'
#!/usr/bin/env bash
set -euo pipefail
[[ "$*" == 'install --frozen-lockfile --package-import-method=copy' ]]
printf '%s\n' "$PWD" >> "$TEST_ROOT/installs"
[[ ! -f "$TEST_ROOT/fail-install" ]] || exit 1
mkdir -p node_modules/@ai-matrx/fixture
cp pnpm-lock.yaml node_modules/@ai-matrx/fixture/version
PNPM
chmod +x "$TEST_ROOT/bin/pnpm"
export PATH="$TEST_ROOT/bin:$PATH"
bounded() { shift; "$@"; }
fixture() {
  mkdir -p "$TEST_ROOT/$1"
  printf '{"name":"fixture","version":"%s","private":true}\n' "${3:-0.0.1}" > "$TEST_ROOT/$1/package.json"
  printf '%s\n' "$2" > "$TEST_ROOT/$1/pnpm-lock.yaml"
}
fixture regen graph-one
prepare_snapshot_dependencies "$TEST_ROOT/regen"
[[ ! -L "$TEST_ROOT/regen/node_modules" ]]
fixture check graph-one 0.0.2
prepare_snapshot_dependencies "$TEST_ROOT/check"
fixture build graph-one 0.0.2
prepare_snapshot_dependencies "$TEST_ROOT/build"
[[ $(wc -l < "$TEST_ROOT/installs") -eq 1 ]]
[[ $(readlink "$TEST_ROOT/check/node_modules") == "$TEST_ROOT/regen/node_modules" ]]
[[ $(readlink "$TEST_ROOT/build/node_modules") == "$TEST_ROOT/regen/node_modules" ]]
printf 'shared-new' > "$TEST_ROOT/shared/node_modules/@ai-matrx/fixture/version"
mkdir -p "$TEST_ROOT/shared/node_modules/.pnpm/duplicate/node_modules/@ai-matrx/fixture"
printf 'duplicate' > "$TEST_ROOT/shared/node_modules/.pnpm/duplicate/node_modules/@ai-matrx/fixture/version"
[[ $(cat "$TEST_ROOT/check/node_modules/@ai-matrx/fixture/version") == graph-one ]]
[[ ! -e "$TEST_ROOT/check/node_modules/.pnpm/duplicate" ]]
fixture changed graph-two
prepare_snapshot_dependencies "$TEST_ROOT/changed"
[[ ! -L "$TEST_ROOT/changed/node_modules" && $(wc -l < "$TEST_ROOT/installs") -eq 2 ]]
[[ $(cat "$TEST_ROOT/build/node_modules/@ai-matrx/fixture/version") == graph-one ]]
fixture patched graph-two
mkdir -p "$TEST_ROOT/patched/patches"
printf patch > "$TEST_ROOT/patched/patches/fixture.patch"
prepare_snapshot_dependencies "$TEST_ROOT/patched"
[[ $(wc -l < "$TEST_ROOT/installs") -eq 3 ]]
fixture failed graph-three
touch "$TEST_ROOT/fail-install"
if prepare_snapshot_dependencies "$TEST_ROOT/failed"; then echo 'failed install accepted' >&2; exit 1; fi
rm "$TEST_ROOT/fail-install"
[[ "$SNAP_DEPENDENCY_DIR" == "$TEST_ROOT/patched/node_modules" ]]
prepare_snapshot_dependencies "$TEST_ROOT/failed"
[[ $(cat "$TEST_ROOT/failed/node_modules/@ai-matrx/fixture/version") == graph-three ]]
echo 'PASS: private frozen graph, reuse, version bump, lockfile/patch invalidation, concurrent mutation isolation, and failed-install recovery'
