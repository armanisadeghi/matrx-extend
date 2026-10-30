// The app's layout for Node scripts and tests — the twin of scripts/app-git.sh (same rules, same
// overrides). matrx-extend is its own repository (standalone) or aidream's apps/matrx-extend (nested).
//
//   APP_ROOT             this app's folder
//   APP_PREFIX           '' standalone, 'apps/matrx-extend/' nested (git's --show-prefix of APP_ROOT)
//   TAG_PREFIX           '' standalone, 'matrx-extend/' nested
//   EXTEND_GITHUB_REPO   the GitHub repository the app's commits, runs and artifacts live in:
//                        $MATRX_EXTEND_GITHUB_REPO, else AI-Matrix-Engine/aidream nested, else
//                        armanisadeghi/matrx-extend (release.sh exports the variable to its snapshots)
//   aidreamRoot()        the aidream checkout the gates read: $AIDREAM_ROOT, else the toplevel nested,
//                        else the sibling ../aidream
//
// CLI: node scripts/app-layout.mjs exec <aidream-relative script> [args...]   runs `node <aidream>/<script>`
//      node scripts/app-layout.mjs {aidream-root|github-repo|prefix}
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function gitLines(...args) {
  try {
    return execFileSync('git', ['-C', APP_ROOT, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).split('\n');
  } catch {
    return null;
  }
}

const layout = gitLines('rev-parse', '--show-prefix', '--show-toplevel');
export const APP_PREFIX = layout?.[0] ?? '';
export const GIT_TOP = layout?.[1] || APP_ROOT;
export const isNested = () => APP_PREFIX !== '';
/** Release tags: v0.2.N standalone, matrx-extend/v0.2.N nested (aidream's own tags are plain v*). */
export const TAG_PREFIX = isNested() ? 'matrx-extend/' : '';
export const EXTEND_GITHUB_REPO =
  process.env.MATRX_EXTEND_GITHUB_REPO ||
  (isNested() ? 'AI-Matrix-Engine/aidream' : 'armanisadeghi/matrx-extend');

export function aidreamRoot() {
  if (process.env.AIDREAM_ROOT) return resolve(process.env.AIDREAM_ROOT);
  return isNested() ? GIT_TOP : resolve(APP_ROOT, '../aidream');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, script, ...rest] = process.argv.slice(2);
  if (cmd === 'exec' && script) {
    const r = spawnSync(process.execPath, [resolve(aidreamRoot(), script), ...rest], {
      stdio: 'inherit',
    });
    process.exit(r.status ?? 1);
  } else if (cmd === 'aidream-root') console.log(aidreamRoot());
  else if (cmd === 'github-repo') console.log(EXTEND_GITHUB_REPO);
  else if (cmd === 'prefix') console.log(APP_PREFIX);
  else {
    console.error(
      'usage: node scripts/app-layout.mjs {exec <script> [args]|aidream-root|github-repo|prefix}',
    );
    process.exit(2);
  }
}
