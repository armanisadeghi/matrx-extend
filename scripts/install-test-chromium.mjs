import { spawn } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireNativeResourceHealth } from '../tests/browser/native-resource-boundary.mjs';

export const CODEX_PLAYWRIGHT_MODULE =
  '/Users/armanisadeghi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
export const TEST_BROWSER_CACHE = '/Volumes/Samsung2TB/.codex-playwright-browsers';
const repo = fileURLToPath(new URL('..', import.meta.url));
const refuse = (reason) => {
  throw new Error(`TEST_CHROMIUM_INSTALL_REFUSED:${reason}`);
};

// This entry point has no browser selector or forwarded CLI flags. Playwright
// chooses the revision matching its installed core; FFmpeg is its support tool.
export async function installTestChromium({
  env = process.env,
  args = process.argv.slice(2),
  repository = repo,
  leaseRoot,
  spawnChild = spawn,
  canonicalPath = realpath,
  runtimeFiles = { readFile, realpath, stat },
} = {}) {
  if (args.length) refuse('arguments_forbidden');
  await requireNativeResourceHealth({ repo: repository, env, leaseRoot });
  const modulePath = env.MATRX_PLAYWRIGHT_MODULE;
  if (!modulePath || !isAbsolute(modulePath)) refuse('absolute_playwright_module_required');
  if (modulePath !== CODEX_PLAYWRIGHT_MODULE) refuse('untrusted_playwright_module');
  let cli;
  let version;
  try {
    const installed = await runtimeFiles.realpath(modulePath);
    if (installed !== CODEX_PLAYWRIGHT_MODULE) refuse('redirected_playwright_module');
    const packageRoot = dirname(installed);
    const metadata = JSON.parse(
      await runtimeFiles.readFile(join(packageRoot, 'package.json'), 'utf8'),
    );
    if (
      installed !== join(packageRoot, 'index.mjs') ||
      metadata.name !== 'playwright' ||
      metadata.bin?.playwright !== 'cli.js' ||
      !/^\d+\.\d+\.\d+$/.test(metadata.version)
    )
      refuse('wrong_playwright_package');
    const corePath = join(dirname(packageRoot), 'playwright-core/package.json');
    if ((await runtimeFiles.realpath(corePath)) !== corePath) refuse('redirected_playwright_core');
    const core = JSON.parse(await runtimeFiles.readFile(corePath, 'utf8'));
    if (
      core.name !== 'playwright-core' ||
      core.version !== metadata.version ||
      metadata.dependencies?.['playwright-core'] !== core.version
    )
      refuse('playwright_core_version_mismatch');
    cli = await runtimeFiles.realpath(join(packageRoot, 'cli.js'));
    if (cli !== join(packageRoot, 'cli.js') || !(await runtimeFiles.stat(cli)).isFile())
      refuse('wrong_playwright_cli');
    version = metadata.version;
  } catch (error) {
    if (error.message.startsWith('TEST_CHROMIUM_INSTALL_REFUSED:')) throw error;
    refuse('playwright_module_unavailable');
  }
  // Refuse a missing external volume and any symlink that redirects the cache.
  if ((await canonicalPath(dirname(TEST_BROWSER_CACHE))) !== dirname(TEST_BROWSER_CACHE))
    refuse('cache_volume_redirected');
  try {
    if ((await canonicalPath(TEST_BROWSER_CACHE)) !== TEST_BROWSER_CACHE)
      refuse('cache_redirected');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  // Package inspection must not turn an old admission into permission to spawn.
  await requireNativeResourceHealth({ repo: repository, env, leaseRoot });
  const child = spawnChild(process.execPath, [cli, 'install', 'chromium', '--no-shell'], {
    cwd: repository,
    env: {
      HOME: userInfo().homedir,
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      LANG: 'en_US.UTF-8',
      MATRX_RESOURCE_OWNER: env.MATRX_RESOURCE_OWNER,
      MATRX_RESOURCE_RUN_ID: env.MATRX_RESOURCE_RUN_ID,
      MATRX_RESOURCE_STOP_FILE: env.MATRX_RESOURCE_STOP_FILE,
      PLAYWRIGHT_BROWSERS_PATH: TEST_BROWSER_CACHE,
      PLAYWRIGHT_SKIP_BROWSER_GC: '1',
    },
    stdio: 'inherit',
    shell: false,
    detached: false,
  });
  await new Promise((done, fail) => {
    child.once('error', fail);
    child.once('exit', (code, signal) => {
      if (code === 0 && !signal) done();
      else fail(new Error(`TEST_CHROMIUM_INSTALL_FAILED:${signal ?? code}`));
    });
  });
  return { version, cache: TEST_BROWSER_CACHE };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await installTestChromium()));
}
