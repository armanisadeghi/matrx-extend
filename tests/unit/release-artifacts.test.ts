import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
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
const independentlyReadTree = (root: string) => {
  const files: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const file = join(dir, name);
      if (lstatSync(file).isDirectory()) walk(file);
      else files[relative(root, file)] = readFileSync(file, 'utf8');
    }
  };
  walk(root);
  return files;
};

function createReleaseFixture(mode: 'dirty' | 'mutate' | 'push-race' | 'no-push' | 'success') {
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
  mkdirSync(join(repo, 'scripts'));
  cpSync(
    join(process.cwd(), 'scripts', 'sync-unpacked-release.mjs'),
    join(repo, 'scripts', 'sync-unpacked-release.mjs'),
  );
  writeFileSync(join(repo, 'package.json'), '{"name":"matrx-extend","version":"0.0.0"}\n');
  writeFileSync(join(repo, '.gitignore'), '.output/\n');
  writeFileSync(
    join(repo, 'wxt.config.ts'),
    'const isChromeWebStoreBuild = false;\nconst manifest = { key: devExtensionKey };\n',
  );
  writeBundle(join(repo, '.output', 'chrome-mv3-dev'), '0.0.0');
  writeFileSync(join(repo, '.output', 'chrome-mv3-dev', 'obsolete-0.0.0.js'), 'stale');
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

  it('pushes one source SHA, then promotes its complete keyed local bundle and receipt', () => {
    const { repo, release } = createReleaseFixture('success');
    expect(release.status, release.stderr).toBe(0);
    const head = git(repo, 'rev-parse', 'HEAD');
    const remoteLines = git(repo, 'ls-remote', 'origin', 'refs/heads/main', 'refs/tags/v0.0.1')
      .split('\n')
      .map((line) => line.split('\t')[0]);
    expect(remoteLines).toEqual([head, head]);
    const promoted = join(repo, '.output/chrome-mv3-dev');
    expect(JSON.parse(readFileSync(join(promoted, 'manifest.json'), 'utf8'))).toMatchObject({
      version: '0.0.1',
      key: 'dev-key',
    });
    expect(() => readFileSync(join(promoted, 'obsolete-0.0.0.js'))).toThrow();
    const expectedFiles = {
      'main.js': 'bundle',
      'manifest.json': '{"version":"0.0.1","key":"dev-key"}',
    };
    expect(independentlyReadTree(promoted)).toEqual(expectedFiles);
    expect(independentlyReadTree(join(repo, '.output/chrome-mv3'))).toEqual(expectedFiles);
    // This fixed digest was calculated independently from the two literal
    // path/content records, using the documented path + NUL + bytes + NUL framing.
    expect(hashReleaseTree(promoted)).toBe(
      'eef29b14751a8df39ff2f36eafdfeed93b4a006db6ef50329bff5a35bc589aa5',
    );
    const receipt = JSON.parse(readFileSync(join(repo, '.output/release-receipt.json'), 'utf8'));
    expect(receipt).toMatchObject({
      sourceSha: head,
      version: '0.0.1',
      treeSha256: hashReleaseTree(promoted),
    });
    expect(receipt.storeZip.sha256).toBe(
      createHash('sha256')
        .update(readFileSync(join(repo, '.output/matrx-extend-0.0.1-store.zip')))
        .digest('hex'),
    );
    expect(receipt.localZip.sha256).toBe(
      createHash('sha256')
        .update(readFileSync(join(repo, '.output/matrx-extend-0.0.1-local.zip')))
        .digest('hex'),
    );
  });
});
