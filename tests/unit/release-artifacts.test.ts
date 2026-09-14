import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hashReleaseTree, promoteUnpackedRelease } from '../../scripts/sync-unpacked-release.mjs';

const roots: string[] = [];
const makeRoot = () => {
  const root = mkdtempSync(join(tmpdir(), 'matrx-release-artifacts-'));
  roots.push(root);
  return root;
};
const writeBundle = (dir: string, version: string, keyed = true) => {
  mkdirSync(join(dir, 'chunks'), { recursive: true });
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({ version, ...(keyed ? { key: 'dev-key' } : {}) }),
  );
  writeFileSync(join(dir, 'chunks', `main-${version}.js`), `bundle-${version}`);
};
const run = (command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}) => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result;
};
const git = (root: string, ...args: string[]) => run('git', args, root).stdout.trim();

function createReleaseFixture(mode: 'dirty' | 'mutate' | 'push-race' | 'no-push') {
  const root = makeRoot();
  const remote = join(root, 'remote.git');
  const repo = join(root, 'repo');
  const bin = join(root, 'bin');
  run('git', ['init', '--bare', remote], root);
  mkdirSync(repo);
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'release test');
  cpSync(join(process.cwd(), 'release.sh'), join(repo, 'release.sh'));
  cpSync(
    join(process.cwd(), 'scripts', 'sync-unpacked-release.mjs'),
    join(repo, 'sync-unpacked-release.mjs'),
  );
  writeFileSync(join(repo, 'package.json'), '{"name":"matrx-extend","version":"0.0.0"}\n');
  writeFileSync(join(repo, '.gitignore'), '.output/\n');
  writeFileSync(
    join(repo, 'wxt.config.ts'),
    'const isChromeWebStoreBuild = false;\nconst manifest = { key: devExtensionKey };\n',
  );
  writeBundle(join(repo, '.output', 'chrome-mv3-dev'), '0.0.0');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'base');
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'push', '-u', 'origin', 'main');
  mkdirSync(bin);
  writeFileSync(join(bin, 'supabase'), '#!/usr/bin/env bash\nexit 0\n');
  writeFileSync(join(bin, 'open'), '#!/usr/bin/env bash\nexit 0\n');
  writeFileSync(
    join(bin, 'pnpm'),
    `#!/usr/bin/env bash
set -euo pipefail
make_zip() {
  local keyed="$1"
  mkdir -p .output/chrome-mv3
  if [[ "$keyed" == "keyed" ]]; then
    printf '{"version":"0.0.1","key":"dev-key"}' > .output/chrome-mv3/manifest.json
  else
    printf '{"version":"0.0.1"}' > .output/chrome-mv3/manifest.json
  fi
  printf 'bundle' > .output/chrome-mv3/main.js
  (cd .output/chrome-mv3 && zip -q ../matrx-extend-0.0.1-chrome.zip manifest.json main.js)
}
if [[ "$1" == "zip:store" ]]; then make_zip store; exit 0; fi
if [[ "$1" == "zip" ]]; then
  make_zip keyed
  if [[ "\${MATRX_RELEASE_TEST_MODE:-}" == "mutate" ]]; then echo changed >> wxt.config.ts; fi
  if [[ "\${MATRX_RELEASE_TEST_MODE:-}" == "push-race" ]]; then
    peer="$(mktemp -d)"; git clone -q "$RELEASE_TEST_REMOTE" "$peer"; cd "$peer"
    git config user.email peer@example.com; git config user.name peer
    echo peer > peer.txt; git add peer.txt; git commit -qm peer; git push -q origin main
  fi
  exit 0
fi
exit 0
`,
  );
  chmodSync(join(bin, 'pnpm'), 0o755);
  chmodSync(join(bin, 'supabase'), 0o755);
  chmodSync(join(bin, 'open'), 0o755);
  if (mode === 'dirty') writeFileSync(join(repo, 'untracked.txt'), 'dirty');
  const release = spawnSync(
    'bash',
    [
      'release.sh',
      '--skip-types',
      '--skip-typecheck',
      '--skip-catalog',
      ...(mode === 'no-push' ? ['--no-push'] : []),
    ],
    {
      cwd: repo,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        MATRX_RELEASE_TEST_MODE: mode,
        RELEASE_TEST_REMOTE: remote,
      },
    },
  );
  return { repo, release };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('release unpacked promotion', () => {
  it('replaces a stale 0.2.12 development tree with the complete keyed release tree', () => {
    const root = makeRoot();
    const source = join(root, 'chrome-mv3');
    const destination = join(root, 'chrome-mv3-dev');
    writeBundle(source, '0.2.21');
    writeBundle(destination, '0.2.12');
    writeFileSync(join(destination, 'chunks', 'obsolete-0.2.12.js'), 'obsolete');
    const promoted = promoteUnpackedRelease({
      sourceDir: source,
      destinationDir: destination,
      version: '0.2.21',
    });
    expect(JSON.parse(readFileSync(join(destination, 'manifest.json'), 'utf8')).version).toBe(
      '0.2.21',
    );
    expect(() => readFileSync(join(destination, 'chunks', 'obsolete-0.2.12.js'))).toThrow();
    expect(promoted.destinationHash).toBe(hashReleaseTree(source));
  });

  it('refuses an unkeyed Store bundle without replacing the existing development tree', () => {
    const root = makeRoot();
    const source = join(root, 'chrome-mv3');
    const destination = join(root, 'chrome-mv3-dev');
    writeBundle(source, '0.2.21', false);
    writeBundle(destination, '0.2.12');
    const before = hashReleaseTree(destination);
    expect(() =>
      promoteUnpackedRelease({ sourceDir: source, destinationDir: destination, version: '0.2.21' }),
    ).toThrow('unkeyed Store bundle');
    expect(hashReleaseTree(destination)).toBe(before);
  });

  it('refuses a symlink-corrupted release tree before replacing the existing development tree', () => {
    const root = makeRoot();
    const source = join(root, 'chrome-mv3');
    const destination = join(root, 'chrome-mv3-dev');
    writeBundle(source, '0.2.21');
    symlinkSync('/etc/passwd', join(source, 'chunks', 'escaped.js'));
    writeBundle(destination, '0.2.12');
    const before = hashReleaseTree(destination);
    expect(() =>
      promoteUnpackedRelease({ sourceDir: source, destinationDir: destination, version: '0.2.21' }),
    ).toThrow('Refusing symlink');
    expect(hashReleaseTree(destination)).toBe(before);
  });

  it('CLI records only the verified keyed promotion and both artifact hashes', () => {
    const root = makeRoot();
    const source = join(root, 'chrome-mv3');
    const destination = join(root, 'chrome-mv3-dev');
    const storeZip = join(root, 'store.zip');
    const localZip = join(root, 'local.zip');
    const receipt = join(root, 'release-receipt.json');
    writeBundle(source, '0.2.21');
    writeFileSync(storeZip, 'store-bytes');
    writeFileSync(localZip, 'local-bytes');
    const result = spawnSync(
      'node',
      [
        'scripts/sync-unpacked-release.mjs',
        '--root',
        root,
        '--version',
        '0.2.21',
        '--source-sha',
        'abc123',
        '--source',
        source,
        '--destination',
        destination,
        '--store-zip',
        storeZip,
        '--local-zip',
        localZip,
        '--receipt',
        receipt,
        '--publish-state',
        'pushed',
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(receipt, 'utf8'))).toMatchObject({
      sourceSha: 'abc123',
      version: '0.2.21',
      publishState: 'pushed',
      sourcePath: source,
      destinationPath: destination,
    });
  });
});

describe('release.sh Git integrity boundary', () => {
  it('refuses dirty and untracked source before creating a release tag', () => {
    const { repo, release } = createReleaseFixture('dirty');
    expect(release.status).not.toBe(0);
    expect(`${release.stdout}${release.stderr}`).toContain('Release starts only from a clean tree');
    expect(git(repo, 'tag', '--list')).toBe('');
  });

  it('refuses a source change during packaging before creating a tag or replacing the loaded path', () => {
    const { repo, release } = createReleaseFixture('mutate');
    expect(release.status).not.toBe(0);
    expect(`${release.stdout}${release.stderr}`).toContain(
      'Release source changed after build began',
    );
    expect(git(repo, 'tag', '--list')).toBe('');
    expect(
      JSON.parse(readFileSync(join(repo, '.output/chrome-mv3-dev/manifest.json'), 'utf8')).version,
    ).toBe('0.0.0');
  });

  it('fails a real remote push race without rebasing, retagging, or promoting the loaded path', () => {
    const { repo, release } = createReleaseFixture('push-race');
    expect(release.status).not.toBe(0);
    expect(`${release.stdout}${release.stderr}`).toContain(
      'No built artifact was rebased or retagged',
    );
    expect(git(repo, 'tag', '--list')).toBe('');
    git(repo, 'fetch', 'origin', 'main');
    expect(git(repo, 'rev-list', '--count', 'HEAD...origin/main')).not.toBe('0');
    expect(
      JSON.parse(readFileSync(join(repo, '.output/chrome-mv3-dev/manifest.json'), 'utf8')).version,
    ).toBe('0.0.0');
  });

  it('keeps the loaded path untouched for an explicit unpushed candidate', () => {
    const { repo, release } = createReleaseFixture('no-push');
    expect(release.status, release.stderr).toBe(0);
    expect(git(repo, 'tag', '--list')).toBe('v0.0.1');
    expect(
      JSON.parse(readFileSync(join(repo, '.output/chrome-mv3-dev/manifest.json'), 'utf8')).version,
    ).toBe('0.0.0');
  });
});
