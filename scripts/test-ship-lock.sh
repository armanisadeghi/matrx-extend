#!/usr/bin/env bash
set -euo pipefail
SOURCE="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/ship.sh}"
TEST_ROOT="$(mktemp -d)"
OWNER=""
trap '[[ -z "$OWNER" ]] || { kill "$OWNER" 2>/dev/null || true; wait "$OWNER" 2>/dev/null || true; }; rm -rf "$TEST_ROOT"' EXIT
cp "$SOURCE" "$TEST_ROOT/ship.sh"
cd "$TEST_ROOT"
git init -q
mkdir scripts
cp "$(dirname "$SOURCE")/scripts/release-owner-lock.sh" scripts/
cat > scripts/sync-main.py <<'PY'
import pathlib,time
with pathlib.Path('sync-calls').open('a') as f: f.write('sync\n')
pathlib.Path('sync-started').touch()
while not pathlib.Path('finish-sync').exists(): time.sleep(.05)
PY
cat > scripts/check-conflict-markers.py <<'PY'
print('clean')
PY
cat > release.sh <<'SH'
#!/usr/bin/env bash
source scripts/release-owner-lock.sh || exit 1
trap ship_lock_cleanup EXIT
acquire_ship_lock || exit $?
echo release >> release-calls
if [[ -e hold-release ]]; then
  touch release-started
  while [[ ! -e finish-release ]]; do sleep .05; done
fi
SH
bash ship.sh > owner.log 2>&1 & OWNER=$!
for _ in {1..100}; do [[ -e sync-started ]] && break; sleep .05; done
[[ -e sync-started ]]
status=0
bash ship.sh > contender.log 2>&1 || status=$?
[[ $status == 75 && ! -e release-calls ]]
grep -q 'RELEASE SLOT BUSY' contender.log
[[ $(cat .git/matrx-release-ship.lock/pid) == "$OWNER" ]]
touch finish-sync
wait "$OWNER"; OWNER=""
[[ ! -e .git/matrx-release-ship.lock && $(wc -l < release-calls) -eq 1 ]]
bash ship.sh > retry.log 2>&1
[[ ! -e .git/matrx-release-ship.lock && $(wc -l < release-calls) -eq 2 ]]
# Direct release acquires the same lock before any ship can sync.
touch hold-release
bash release.sh > direct.log 2>&1 & OWNER=$!
for _ in {1..100}; do [[ -e release-started ]] && break; sleep .05; done
[[ -e release-started ]]
status=0
bash ship.sh > direct-contender.log 2>&1 || status=$?
[[ $status == 75 && $(wc -l < sync-calls) -eq 2 ]]
status=0
bash release.sh > direct-release-contender.log 2>&1 || status=$?
[[ $status == 75 && $(wc -l < release-calls) -eq 3 ]]
touch finish-release
wait "$OWNER"; OWNER=""
[[ ! -e .git/matrx-release-ship.lock ]]
mkdir .git/matrx-release-ship.lock
status=0
bash ship.sh > unknown-owner.log 2>&1 || status=$?
[[ $status == 75 && -d .git/matrx-release-ship.lock && $(wc -l < release-calls) -eq 3 ]]
status=0
bash release.sh > unknown-direct.log 2>&1 || status=$?
[[ $status == 75 && -d .git/matrx-release-ship.lock && $(wc -l < release-calls) -eq 3 ]]
# An older release records only its PID in this same directory. New entry
# points must refuse it even without the new inheritance environment value.
echo "$$" > .git/matrx-release-ship.lock/pid
status=0
MATRX_SHIP_LOCK_OWNER="" bash ship.sh > old-owner-ship.log 2>&1 || status=$?
[[ $status == 75 && $(wc -l < sync-calls) -eq 2 ]]
status=0
MATRX_SHIP_LOCK_OWNER="" bash release.sh > old-owner-direct.log 2>&1 || status=$?
[[ $status == 75 && $(wc -l < release-calls) -eq 3 && $(cat .git/matrx-release-ship.lock/pid) == "$$" ]]
echo 'PASS: ship and direct release share one lock, inherited release does not deadlock, contenders cannot sync, cleanup permits retry, unknown owners preserved'
