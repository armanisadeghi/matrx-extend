import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { installTestChromium } from './install-test-chromium.mjs';

// Matrx guest Chat acceptance needs a matching test browser without touching
// personal Chrome. The external CLI is replaced with a harmless argv recorder;
// package inspection, real child execution and resource evidence stay real.
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
    MATRX_PLAYWRIGHT_MODULE: join(moduleRoot, 'index.mjs'),
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
  await writeFile(
    join(moduleRoot, 'cli.js'),
    `
    require('node:fs').writeFileSync(process.env.CLI_RECORD, JSON.stringify({
      args: process.argv.slice(2), cache: process.env.PLAYWRIGHT_BROWSERS_PATH,
      owner: process.env.MATRX_RESOURCE_OWNER, gc: process.env.PLAYWRIGHT_SKIP_BROWSER_GC,
      cwd: process.cwd()
    }));
    process.exit(Number(process.env.CLI_EXIT || 0));
  `,
  );
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
  const options = { env, args: [], repository, leaseRoot, canonicalPath };
  const notLaunched = async () => assert.rejects(readFile(env.CLI_RECORD), { code: 'ENOENT' });
  return { options, env, moduleRoot, coreRoot, journal, event, notLaunched };
}

test('installer launches only the matching CLI Chromium download in the external cache with inherited ownership', async (t) => {
  const { options, env } = await setup(t);
  assert.deepEqual(await installTestChromium(options), {
    version: '1.62.1',
    cache: '/Volumes/Samsung2TB/.codex-playwright-browsers',
  });
  assert.deepEqual(JSON.parse(await readFile(env.CLI_RECORD, 'utf8')), {
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
