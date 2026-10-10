#!/usr/bin/env bash
# Both entry points use one lock. A ship child may borrow only its live
# ancestor's lock; it never releases that lock on the parent's behalf.
SHIP_LOCK_DIR="$(git rev-parse --git-path matrx-release-ship.lock)"
SHIP_LOCK_HELD=false
ship_lock_cleanup() {
    if $SHIP_LOCK_HELD && [[ "$(cat "$SHIP_LOCK_DIR/pid" 2>/dev/null)" == "$$" ]]; then
        rm -f -- "$SHIP_LOCK_DIR/pid"
        rmdir -- "$SHIP_LOCK_DIR" 2>/dev/null || true
    fi
    SHIP_LOCK_HELD=false
}
ship_lock_inherited() {
    local owner="$1" ancestor="$$"
    [[ "$owner" =~ ^[0-9]+$ && "$owner" == "${MATRX_SHIP_LOCK_OWNER:-}" ]] || return 1
    kill -0 "$owner" 2>/dev/null || return 1
    while [[ "$ancestor" =~ ^[0-9]+$ && "$ancestor" -gt 1 ]]; do
        [[ "$ancestor" == "$owner" ]] && return 0
        ancestor="$(ps -o ppid= -p "$ancestor" 2>/dev/null)"
        ancestor="${ancestor//[[:space:]]/}"
    done
    return 1
}
acquire_ship_lock() {
    local owner
    if mkdir "$SHIP_LOCK_DIR" 2>/dev/null; then
        SHIP_LOCK_HELD=true
        echo "$$" > "$SHIP_LOCK_DIR/pid" || return 1
        export MATRX_SHIP_LOCK_OWNER="$$"
        return 0
    fi
    owner="$(cat "$SHIP_LOCK_DIR/pid" 2>/dev/null)"
    ship_lock_inherited "$owner" && return 0
    # A dead or missing owner (killed run, or a lock left with no pid for over a minute) is
    # reclaimed once; otherwise every later sweep reports RELEASE SLOT BUSY forever.
    if { [[ "$owner" =~ ^[0-9]+$ ]] && ! kill -0 "$owner" 2>/dev/null; } || \
       { [[ -z "$owner" ]] && [[ -n "$(find "$SHIP_LOCK_DIR" -maxdepth 0 -mmin +1 2>/dev/null)" ]]; }; then
        echo "ship lock: reclaiming stale lock at $SHIP_LOCK_DIR (owner ${owner:-none} is gone)."
        rm -f -- "$SHIP_LOCK_DIR/pid"
        rmdir -- "$SHIP_LOCK_DIR" 2>/dev/null
        if mkdir "$SHIP_LOCK_DIR" 2>/dev/null; then
            SHIP_LOCK_HELD=true
            echo "$$" > "$SHIP_LOCK_DIR/pid" || return 1
            export MATRX_SHIP_LOCK_OWNER="$$"
            return 0
        fi
    fi
    echo "RELEASE SLOT BUSY: sync/release lock already exists at $SHIP_LOCK_DIR (owner PID ${owner:-unknown}); retry after its owner finishes."
    return 75
}
