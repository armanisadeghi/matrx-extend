#!/usr/bin/env node
/**
 * update-api-types — Single command to sync Python backend types + verify alignment.
 *
 * Usage:
 *   pnpm update-api-types               # default: live server (https://server.app.matrxserver.com)
 *   pnpm update-api-types --local       # use local backend (http://localhost:8000)
 *   pnpm update-api-types --url https://custom.server.com
 *
 * Steps:
 *   1. Fetch schema bundles from the Python backend via sync-types.mjs
 *   2. Run TypeScript type-check (tsc --noEmit) to surface any drift
 *
 * If ANYTHING in the codebase references a field, enum value, or type that
 * no longer matches the backend schema, step 2 will fail loudly with type errors.
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

const args = process.argv.slice(2);
function getArg(name, fallback) {
  const idx = args.indexOf(name);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return fallback;
}

const skipTypeCheck = args.includes('--skip-typecheck');
const useLocal = args.includes('--local');
const LIVE_BACKEND_URL = process.env.WXT_BACKEND_URL
  ? `${process.env.WXT_BACKEND_URL}`
  : 'https://server.app.matrxserver.com';
const LOCAL_BACKEND_URL = 'http://localhost:8000';
const backendUrl = getArg('--url', useLocal ? LOCAL_BACKEND_URL : LIVE_BACKEND_URL);
const outDir = resolve(PROJECT_ROOT, 'types/python-generated');

const AIDREAM_SYNC_SCRIPT = resolve(PROJECT_ROOT, '../aidream/scripts/sync-types.mjs');

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  update-api-types');
console.log(`  Backend: ${backendUrl}${useLocal ? '  (local)' : '  (live)'}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// ── Step 1: Sync types from Python backend ─────────────────────────────────

if (!existsSync(AIDREAM_SYNC_SCRIPT)) {
  console.error(`  ✗ sync-types.mjs not found at: ${AIDREAM_SYNC_SCRIPT}`);
  console.error('    Make sure the aidream repo is cloned at ../aidream');
  process.exit(1);
}

console.log('  Step 1: Fetching types from Python backend...\n');

try {
  execSync(`node "${AIDREAM_SYNC_SCRIPT}" --url "${backendUrl}" --out "${outDir}"`, {
    stdio: 'inherit',
    cwd: PROJECT_ROOT,
  });
} catch {
  console.error('\n  ✗ Failed to sync types from the Python backend.');
  if (useLocal) {
    console.error('    Make sure the backend is running: uv run run.py (from aidream/)');
  } else {
    console.error(`    Could not reach: ${backendUrl}`);
    console.error('    Use --local to sync from your local backend instead.');
  }
  process.exit(1);
}

// ── Step 2: Type-check the codebase ────────────────────────────────────────

if (skipTypeCheck) {
  console.log('\n  ⊘ Skipping type-check (--skip-typecheck)\n');
} else {
  console.log('\n  Step 2: Running TypeScript type-check...\n');

  // Resolve `tsc` through the bin, NOT through `./node_modules/typescript/bin/tsc`.
  // Since the TS 7 migration, the `typescript` package name is aliased to
  // @typescript/typescript6 (whose only bin is `tsc6`) so that openapi-typescript
  // above still has a 6.0 programmatic API to import; the native TS 7 compiler is
  // installed as @typescript/native and owns the `tsc` bin. Hardcoding the old path
  // made this step die with MODULE_NOT_FOUND — which the catch below then reported
  // as "TYPE ERRORS DETECTED", a flatly false message. See docs/DEVELOPMENT.md (TypeScript dual install).
  //
  // The old `node --max-old-space-size=8192` prefix is gone with it: `tsc` is now a
  // Go binary, not a Node script, so a V8 heap flag is meaningless to it (and it
  // does not need one — a full typecheck is ~1s).
  try {
    execSync('pnpm exec tsc --noEmit', { stdio: 'inherit', cwd: PROJECT_ROOT });
    console.log('\n  ✓ Type-check passed — all types are aligned.\n');
  } catch (err) {
    // A non-zero exit STATUS from tsc means real type errors. No status at all
    // (binary missing, spawn failure) is a BROKEN TOOLCHAIN — reporting that as
    // "type errors" sends the next engineer hunting for a bug that isn't there.
    if (typeof err?.status !== 'number') {
      console.error('\n  ✗ COULD NOT RUN THE TYPE-CHECKER (this is NOT a type error)');
      console.error(`    ${err?.message ?? err}`);
      console.error('    Check that `pnpm exec tsc --version` works.\n');
      process.exit(1);
    }
    console.error('\n  ✗ TYPE ERRORS DETECTED');
    console.error('    The codebase has types that are out of sync with the backend.');
    console.error('    Fix the errors above, then re-run: pnpm update-api-types\n');
    process.exit(1);
  }
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  update-api-types complete');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
