// GUARD: a local release (./ship.sh → release.sh, no CI wrapper) must be able
// to authenticate the strict tool-drift check. Until 2026-10-03 only CI minted
// AIDREAM_API_TOKEN (scripts/release-with-gate-auth.mjs wraps release.sh there),
// ship.sh called release.sh directly, and every local release stopped with
// "records server contract UNVERIFIED". This fails if release.sh can reach the
// strict drift check with no path that supplies a token.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// Overridable only so the guard can be proven red against an older release.sh.
const releaseSh = readFileSync(
  process.env.RELEASE_SH_UNDER_TEST ?? resolve(__dirname, '../../release.sh'),
  'utf8',
);
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function mintBlock(): string {
  const start = releaseSh.indexOf('GATE_TOKEN_FROM_CALLER=false');
  const fn = releaseSh.indexOf('mint_gate_auth() {');
  expect(start, 'release.sh has no local gate-auth path (GATE_TOKEN_FROM_CALLER)').toBeGreaterThan(
    -1,
  );
  expect(fn, 'release.sh has no mint_gate_auth()').toBeGreaterThan(-1);
  const end = releaseSh.indexOf('\n}\n', fn);
  return releaseSh.slice(start, end + 3);
}

function runMint(callerToken: string | undefined) {
  const root = mkdtempSync(join(tmpdir(), 'matrx-gate-auth-'));
  roots.push(root);
  mkdirSync(join(root, 'scripts'));
  // Stand-in for the real minter: proves release.sh exports what --print-env prints.
  writeFileSync(
    join(root, 'scripts', 'release-with-gate-auth.mjs'),
    `if (process.argv[2] !== '--print-env') process.exit(9);
process.stdout.write('AIDREAM_API_TOKEN=minted\\nAIDREAM_ORGANIZATION_ID=org-1\\nAIDREAM_API_URL=https://api.example/api\\n');`,
  );
  const script = `set -u
finding() { echo "FINDING $*"; }
log() { :; }
bounded() { shift; "$@"; }
REPO_ROOT='${root}'
${mintBlock()}
mint_gate_auth
echo "token=\${AIDREAM_API_TOKEN:-} org=\${AIDREAM_ORGANIZATION_ID:-} url=\${AIDREAM_API_URL:-}"`;
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, TMPDIR: root };
  if (callerToken) env.AIDREAM_API_TOKEN = callerToken;
  return spawnSync('bash', ['-c', script], { encoding: 'utf8', env });
}

function runCandidateGate() {
  // EXT-D-0140: execute the production candidate sequence so a late or absent
  // mint fails at the check boundary, independent of shell spelling.
  const section = releaseSh.indexOf('# ── Validate the exact candidate');
  const start = releaseSh.indexOf('    SNAP_ROOTS+=("$JOBS")', section);
  const end = releaseSh.indexOf('    mandate_scan_step', start);
  expect(section, 'release.sh has no candidate validation section').toBeGreaterThan(-1);
  expect(start, 'candidate loop has no check setup').toBeGreaterThan(section);
  expect(end, 'candidate loop has no post-check step').toBeGreaterThan(start);

  // Execute the actual candidate-loop statements. The check double observes the
  // token at the run_checks boundary, where the strict drift command executes.
  const script = `set -u
SKIP_CATALOG=false
JOBS=/tmp/unused
NEW_TAG=v-test
SNAP_ROOTS=()
FAILED_CHECK=""
mint_gate_auth() { export AIDREAM_API_TOKEN=minted; }
run_checks() {
    [[ "\${AIDREAM_API_TOKEN:-}" == minted ]] || { echo NO_AUTH; return 1; }
    echo AUTH_AT_CHECK
}
catch_up_matrx_packages() { return 1; }
hard_stop() { echo "STOPPED: $*"; exit 3; }
${releaseSh.slice(start, end)}`;
  return spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH },
  });
}

describe('release.sh server-contract gate auth', () => {
  it('mints a token before the strict drift check runs in the candidate loop', () => {
    expect(releaseSh).toContain('pnpm -s catalog:tools:drift:strict');
    const run = runCandidateGate();
    expect(run.status, run.stderr || run.stdout).toBe(0);
    expect(run.stdout).toContain('AUTH_AT_CHECK');
  });

  it('a local release with no caller token exports a minted token, organization and URL', () => {
    const run = runMint(undefined);
    expect(run.stdout).toContain('token=minted org=org-1 url=https://api.example/api');
    expect(run.stdout).not.toContain('FINDING');
  });

  it('a caller-supplied token (CI) is used as-is and never re-minted', () => {
    const run = runMint('from-ci');
    expect(run.stdout).toContain('token=from-ci org= url=');
  });
});
