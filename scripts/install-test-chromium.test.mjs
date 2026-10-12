import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { CODEX_PLAYWRIGHT_MODULE, installTestChromium } from './install-test-chromium.mjs';

// Matrx guest Chat acceptance needs a matching test browser without touching
// personal Chrome. The external CLI is replaced with a harmless argv recorder;
// package inspection and resource evidence stay real. Runtime filesystem paths
// map to scratch packages so tests never modify the installed Codex runtime.
async function setup(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'test-chromium-install-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repository = join(root, 'repo');
  const leaseRoot = join(root, 'lease');
  const docs = join(repository, 'docs/stabilization');
  const moduleRoot = join(root, 'node_modules/playwright');
  const coreRoot = join(root, 'node_modules/playwright-core');
  await Promise.all([
    mkdir(join(docs, 'resource-journals'), { recursive: true }),
    mkdir(join(leaseRoot, 'heavy'), { recursive: true }),
    mkdir(moduleRoot, { recursive: true }),
    mkdir(coreRoot, { recursive: true }),
  ]);
  const env = {
    ...process.env,
    MATRX_PLAYWRIGHT_MODULE: CODEX_PLAYWRIGHT_MODULE,
    MATRX_RESOURCE_RUN_ID: 'guest-browser-install',
    MATRX_RESOURCE_OWNER: 'guest-install-owner',
    MATRX_RESOURCE_STOP_FILE: join(leaseRoot, 'stop-guest-install-owner.json'),
    PLAYWRIGHT_BROWSERS_PATH: '/unwanted/internal-cache',
    CLI_RECORD: join(root, 'cli-record.json'),
  };
  await writeFile(join(moduleRoot, 'index.mjs'), 'export {};');
  await writeFile(
    join(moduleRoot, 'package.json'),
    JSON.stringify({
      name: 'playwright',
      version: '1.62.1',
      bin: { playwright: 'cli.js' },
      dependencies: { 'playwright-core': '1.62.1' },
    }),
  );
  await writeFile(
    join(coreRoot, 'package.json'),
    JSON.stringify({ name: 'playwright-core', version: '1.62.1' }),
  );
  await writeFile(join(moduleRoot, 'cli.js'), '// Harmless CLI dependency fixture.');
  await writeFile(join(docs, 'resource-policy.json'), JSON.stringify({ watchIntervalSeconds: 15 }));
  await writeFile(
    join(leaseRoot, 'heavy/owner.json'),
    JSON.stringify({
      runId: env.MATRX_RESOURCE_RUN_ID,
      nonce: env.MATRX_RESOURCE_OWNER,
      kind: 'run',
    }),
  );
  const journal = join(docs, 'resource-journals/guest-browser-install.pending.jsonl');
  const event = {
    schema: 1,
    runId: env.MATRX_RESOURCE_RUN_ID,
    code: 'RESOURCE_ADMITTED',
    at: new Date().toISOString(),
    sample: { memoryAvailableGiB: 12 },
    reasons: [],
  };
  await writeFile(journal, `${JSON.stringify(event)}\n`);
  // Only the OS volume lookup is stubbed to keep tests portable to CI runners.
  const canonicalPath = async (path) => path;
  const trustedModules = dirname(dirname(CODEX_PLAYWRIGHT_MODULE));
  const fixtureModules = dirname(moduleRoot);
  const mapped = (path) => path.replace(trustedModules, fixtureModules);
  const runtimeFiles = {
    readFile: (path, encoding) => readFile(mapped(path), encoding),
    stat: (path) => stat(mapped(path)),
    realpath: async (path) =>
      (await realpath(mapped(path))).replace(fixtureModules, trustedModules),
  };
  let spawnedEnvironment;
  const spawnChild = (node, args, childOptions) => {
    spawnedEnvironment = childOptions.env;
    const child = new EventEmitter();
    void writeFile(
      env.CLI_RECORD,
      JSON.stringify({
        node,
        cli: args[0],
        shell: childOptions.shell,
        detached: childOptions.detached,
        args: args.slice(1),
        cache: childOptions.env.PLAYWRIGHT_BROWSERS_PATH,
        owner: childOptions.env.MATRX_RESOURCE_OWNER,
        gc: childOptions.env.PLAYWRIGHT_SKIP_BROWSER_GC,
        cwd: childOptions.cwd,
      }),
    ).then(() => child.emit('exit', Number(env.CLI_EXIT || 0), null));
    return child;
  };
  const options = { env, args: [], repository, leaseRoot, canonicalPath, runtimeFiles, spawnChild };
  const notLaunched = async () => assert.rejects(readFile(env.CLI_RECORD), { code: 'ENOENT' });
  return {
    options,
    env,
    moduleRoot,
    coreRoot,
    journal,
    event,
    notLaunched,
    childEnvironment: () => spawnedEnvironment,
  };
}

test('installer launches only the matching CLI Chromium download in the external cache with inherited ownership', async (t) => {
  const { options, env } = await setup(t);
  assert.deepEqual(await installTestChromium(options), {
    version: '1.62.1',
    cache: '/Volumes/Samsung2TB/.codex-playwright-browsers',
  });
  assert.deepEqual(JSON.parse(await readFile(env.CLI_RECORD, 'utf8')), {
    node: process.execPath,
    cli: join(dirname(CODEX_PLAYWRIGHT_MODULE), 'cli.js'),
    shell: false,
    detached: false,
    args: ['install', 'chromium', '--no-shell'],
    cache: '/Volumes/Samsung2TB/.codex-playwright-browsers',
    owner: 'guest-install-owner',
    gc: '1',
    cwd: options.repository,
  });
});

test('installer propagates a failed CLI instead of reporting successful setup', async (t) => {
  const { options, env } = await setup(t);
  env.CLI_EXIT = '23';
  await assert.rejects(installTestChromium(options), /TEST_CHROMIUM_INSTALL_FAILED:23/);
  assert.equal(JSON.parse(await readFile(env.CLI_RECORD, 'utf8')).args[1], 'chromium');
});

for (const args of [['firefox'], ['webkit'], ['--with-deps'], ['chromium'], ['--dry-run']]) {
  test(`installer refuses forwarded argument ${args[0]} before launching`, async (t) => {
    const { options, notLaunched } = await setup(t);
    await assert.rejects(installTestChromium({ ...options, args }), /arguments_forbidden/);
    await notLaunched();
  });
}

for (const state of ['missing-owner', 'stopped', 'stale', 'wrong-owner']) {
  test(`installer refuses ${state} resource evidence without launching`, async (t) => {
    const { options, env, event, journal, notLaunched } = await setup(t);
    if (state === 'missing-owner') env.MATRX_RESOURCE_OWNER = undefined;
    if (state === 'stopped') await writeFile(env.MATRX_RESOURCE_STOP_FILE, '{}');
    if (state === 'stale') {
      await writeFile(journal, `${JSON.stringify({ ...event, at: '2026-01-01T00:00:00Z' })}\n`);
    }
    if (state === 'wrong-owner') env.MATRX_RESOURCE_OWNER = 'unrelated-owner';
    await assert.rejects(installTestChromium(options), /NATIVE_RESOURCE_BOUNDARY_REFUSED:/);
    await notLaunched();
  });
}

for (const state of ['missing', 'relative', 'wrong-package', 'mismatched-core', 'missing-cli']) {
  test(`installer refuses ${state} Playwright setup without launching`, async (t) => {
    const { options, env, moduleRoot, coreRoot, notLaunched } = await setup(t);
    if (state === 'missing') env.MATRX_PLAYWRIGHT_MODULE = join(moduleRoot, 'missing.mjs');
    if (state === 'relative') env.MATRX_PLAYWRIGHT_MODULE = 'playwright/index.mjs';
    if (state === 'wrong-package')
      await writeFile(join(moduleRoot, 'package.json'), '{"name":"unrelated"}');
    if (state === 'mismatched-core')
      await writeFile(
        join(coreRoot, 'package.json'),
        '{"name":"playwright-core","version":"1.61.0"}',
      );
    if (state === 'missing-cli') await rm(join(moduleRoot, 'cli.js'));
    await assert.rejects(installTestChromium(options), /TEST_CHROMIUM_INSTALL_REFUSED:/);
    await notLaunched();
  });
}

test('installer refuses a redirected external cache without launching', async (t) => {
  const { options, notLaunched } = await setup(t);
  await assert.rejects(
    installTestChromium({
      ...options,
      canonicalPath: async (path) =>
        path === dirname('/Volumes/Samsung2TB/.codex-playwright-browsers')
          ? path
          : '/internal/cache',
    }),
    /cache_redirected/,
  );
  await notLaunched();
});

test('installer rechecks resource health immediately before spawning', async (t) => {
  const { options, env, notLaunched } = await setup(t);
  await assert.rejects(
    installTestChromium({
      ...options,
      canonicalPath: async (path) => {
        await writeFile(env.MATRX_RESOURCE_STOP_FILE, '{}');
        return path;
      },
    }),
    /stop_requested/,
  );
  await notLaunched();
});

test('installer refuses an absolute substituted runtime even with matching forged package metadata', async (t) => {
  const { options, env, moduleRoot, notLaunched } = await setup(t);
  env.MATRX_PLAYWRIGHT_MODULE = join(moduleRoot, 'index.mjs');
  await assert.rejects(installTestChromium(options), /untrusted_playwright_module/);
  await notLaunched();
});

test('installer strips secrets and Node preload settings from the download child environment', async (t) => {
  const { options, env, childEnvironment } = await setup(t);
  env.AWS_SECRET_ACCESS_KEY = 'sensitive-download-test-marker';
  env.SUPABASE_ACCESS_TOKEN = 'sensitive-database-test-marker';
  env.NODE_OPTIONS = '--require=/unwanted/preload.cjs';
  env.PLAYWRIGHT_DOWNLOAD_HOST = 'https://unwanted-download-host.invalid';
  await installTestChromium(options);
  const child = childEnvironment();
  assert.deepEqual(
    Object.keys(child).sort(),
    [
      'HOME',
      'LANG',
      'MATRX_RESOURCE_OWNER',
      'MATRX_RESOURCE_RUN_ID',
      'MATRX_RESOURCE_STOP_FILE',
      'PATH',
      'PLAYWRIGHT_BROWSERS_PATH',
      'PLAYWRIGHT_SKIP_BROWSER_GC',
    ].sort(),
  );
  assert.equal(child.MATRX_RESOURCE_OWNER, 'guest-install-owner');
  assert.equal(child.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(child.SUPABASE_ACCESS_TOKEN, undefined);
  assert.equal(child.NODE_OPTIONS, undefined);
  assert.equal(child.PLAYWRIGHT_DOWNLOAD_HOST, undefined);
});

for (const target of ['index.mjs', 'cli.js', 'playwright-core/package.json']) {
  test(`installer refuses redirected trusted runtime file ${target}`, async (t) => {
    const { options, notLaunched } = await setup(t);
    const filesystem = options.runtimeFiles;
    await assert.rejects(
      installTestChromium({
        ...options,
        runtimeFiles: {
          ...filesystem,
          realpath: async (path) =>
            path.endsWith(target) ? '/substituted/runtime-file' : filesystem.realpath(path),
        },
      }),
      /TEST_CHROMIUM_INSTALL_REFUSED:/,
    );
    await notLaunched();
  });
}
