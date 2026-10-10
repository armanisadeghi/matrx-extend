#!/usr/bin/env bash
# Sourced by release.sh. Cache only installs owned by this release's snapshots.
SNAP_DEPENDENCY_KEY=""
SNAP_DEPENDENCY_DIR=""

snapshot_dependency_identity() {
    node - "$1" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = process.argv[2];
const hash = crypto.createHash('sha256');
function add(name, bytes) {
  hash.update(JSON.stringify([name, bytes.length]));
  hash.update(bytes);
}
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
delete manifest.version; // A release bump does not change the installed graph.
add('package.json', Buffer.from(JSON.stringify(manifest)));
function include(name, required = false) {
  const file = path.join(root, name);
  if (!fs.existsSync(file)) {
    if (required) throw new Error(`Missing frozen install input: ${name}`);
    return;
  }
  if (fs.statSync(file).isDirectory()) {
    for (const entry of fs.readdirSync(file).sort()) include(`${name}/${entry}`);
  } else add(name, fs.readFileSync(file));
}
include('pnpm-lock.yaml', true);
for (const name of ['pnpm-workspace.yaml', '.npmrc', '.pnpmfile.cjs', 'patches']) include(name);
console.log(hash.digest('hex'));
NODE
}

prepare_snapshot_dependencies() { # snapshot directory; bounded/log supplied by release.sh
    local dir="$1" identity
    identity="$(snapshot_dependency_identity "$dir")" || return 1
    if [[ "$identity" == "$SNAP_DEPENDENCY_KEY" && -d "$SNAP_DEPENDENCY_DIR" && ! -L "$SNAP_DEPENDENCY_DIR" ]]; then
        ln -s "$SNAP_DEPENDENCY_DIR" "$dir/node_modules" || return 1
        return 0
    fi
    # A normal frozen install runs dependency build scripts and the duplicate
    # guard. Copy imports prevent any shared-store mutation from changing it.
    ( cd "$dir" && bounded 900 pnpm install --frozen-lockfile --package-import-method=copy ) || return 1
    [[ -d "$dir/node_modules" && ! -L "$dir/node_modules" ]] || return 1
    SNAP_DEPENDENCY_KEY="$identity"
    SNAP_DEPENDENCY_DIR="$dir/node_modules"
}
