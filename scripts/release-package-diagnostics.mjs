#!/usr/bin/env node
// Summarize a failed candidate build for the hosted failure artifact. Never
// copy command output: package tools may print URLs, credentials, or source.
import { closeSync, fstatSync, openSync, readFileSync, readSync } from 'node:fs';

const [markerPath, outputPath, candidate] = process.argv.slice(2);
const phases = new Set([
  'build-snapshot',
  'store-zip',
  'store-zip-present',
  'store-package-check',
  'store-risk-check',
  'store-key-absent',
  'store-copy',
  'store-temp-remove',
  'local-zip',
  'local-zip-present',
  'local-copy',
  'local-key-present',
  'local-manifest-present',
]);

let phase = 'unknown';
let exit = '1';
try {
  const marker = readFileSync(markerPath, 'utf8')
    .trim()
    .match(/^([a-z-]+) ([1-9][0-9]*)$/);
  if (marker && phases.has(marker[1])) {
    phase = marker[1];
    exit = marker[2];
  }
} catch {
  // A killed background job may leave no marker. The summary still exists.
}

let output = '';
try {
  const fd = openSync(outputPath, 'r');
  try {
    const size = fstatSync(fd).size;
    const bytes = Math.min(size, 64 * 1024);
    const buffer = Buffer.alloc(bytes);
    readSync(fd, buffer, 0, bytes, size - bytes);
    output = buffer.toString('utf8');
  } finally {
    closeSync(fd);
  }
} catch {
  // The phase and exit code are still useful when output is unavailable.
}

const safeCandidate = /^v\d+\.\d+\.\d+$/.test(candidate ?? '') ? candidate : 'unknown';
console.log(`phase=${phase} exit=${exit} candidate=${safeCandidate}`);
const knownCodes = new Set([
  'ERR_PNPM_FETCH_401',
  'ERR_PNPM_FETCH_403',
  'ERR_PNPM_FETCH_404',
  'ERR_PNPM_OUTDATED_LOCKFILE',
  'ERR_PNPM_LOCKFILE_MISSING_DEPENDENCY',
  'ERR_PNPM_TARBALL_INTEGRITY',
  'ERR_PNPM_PEER_DEP_ISSUES',
  'ERR_PNPM_NO_MATCHING_VERSION',
  'ERR_MODULE_NOT_FOUND',
  'MODULE_NOT_FOUND',
  'ENOSPC',
  'ENOENT',
  'EACCES',
]);
const codes = [
  ...new Set(
    output.match(
      /\b(?:ERR_PNPM_[A-Z0-9_]+|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|ENOSPC|ENOENT|EACCES)\b/g,
    ) ?? [],
  ),
]
  .filter((code) => knownCodes.has(code))
  .slice(0, 3);
for (const code of codes) console.log(`code=${code}`);

const reasons = [
  [/Store manifest contains a development key/, 'store-dev-key'],
  [/Store action still has default_popup/, 'store-toolbar-popup'],
  [/Store manifest does not point side_panel\.default_path/, 'store-side-panel-path'],
  [/Store manifest is missing the sidePanel permission/, 'store-side-panel-permission'],
  [/The manifest policy surface differs/, 'store-policy-surface'],
  [/The Store manifest adds a toolbar popup/, 'store-toolbar-popup'],
  [
    /contains (?:eval\(|new Function|Runtime\.(?:evaluate|callFunctionOn|compileScript))/,
    'store-runtime-code',
  ],
  [/creates an executable script element and assigns its src/, 'store-remote-script-loader'],
  // A published package importing a name its installed sibling no longer
  // exports (records-ui 0.116.17 -> design-system formatShortcut, v0.2.538).
  [/MISSING_EXPORT/, 'package-missing-export'],
];
let found = 0;
for (const [pattern, reason] of reasons) {
  if (found >= 4) break;
  if (pattern.test(output)) {
    console.log(`reason=${reason}`);
    found++;
  }
}
if (codes.length === 0 && found === 0) console.log('reason=unclassified-package-error');
