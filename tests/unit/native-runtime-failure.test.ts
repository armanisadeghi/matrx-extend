import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { nativeRuntimeFailureCode } from '../browser/native-runtime-failure.mjs';

const execFileAsync = promisify(execFile);

describe('native runtime failure reporting', () => {
  it('retains only a known missing-runtime code from resolver errors', () => {
    expect(
      nativeRuntimeFailureCode(
        new Error('browser_runtime_playwright_missing: install Playwright in this repo'),
      ),
    ).toBe('browser_runtime_playwright_missing');
    expect(
      nativeRuntimeFailureCode(
        new Error('browser_runtime_chrome_missing: /private/host/chrome contains a secret'),
      ),
    ).toBe('browser_runtime_chrome_missing');
  });

  it('does not serialize unknown errors or paths', () => {
    expect(
      nativeRuntimeFailureCode(new Error('native_sidepanel_open_refused: private value')),
    ).toBeNull();
    expect(
      nativeRuntimeFailureCode(new Error('browser_runtime_playwright_missing_other: path')),
    ).toBeNull();
    expect(
      nativeRuntimeFailureCode({ message: 'browser_runtime_playwright_missing: forged' }),
    ).toBeNull();
  });

  it('refuses a missing configured module, while an installed runtime resolves before browser launch', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'matrx-runtime-preflight-'));
    const previous = process.env.MATRX_PLAYWRIGHT_MODULE;
    try {
      const resolver = pathToFileURL(join(process.cwd(), 'tests/browser/browser-runtime.mjs')).href;
      const probe = `import { resolveBrowserRuntime } from ${JSON.stringify(resolver)};
        try { const result = await resolveBrowserRuntime({ chromeExecutable: process.execPath });
          process.stdout.write(result.executablePath === process.execPath ? 'runtime_ready' : 'wrong_executable');
        } catch (error) { process.stdout.write(error.message.split(':', 1)[0]); }`;
      process.env.MATRX_PLAYWRIGHT_MODULE = join(dir, 'absent.mjs');
      const missing = await execFileAsync(process.execPath, ['--input-type=module', '-e', probe], {
        env: process.env,
      });
      expect(missing.stdout).toBe('browser_runtime_playwright_unavailable');
      const modulePath = join(dir, 'playwright.mjs');
      await writeFile(
        modulePath,
        'export const chromium = { connectOverCDP() {}, launchPersistentContext() {}, executablePath() { return process.execPath; } };',
      );
      process.env.MATRX_PLAYWRIGHT_MODULE = modulePath;
      const runtime = await execFileAsync(process.execPath, ['--input-type=module', '-e', probe], {
        env: process.env,
      });
      expect(runtime.stdout).toBe('runtime_ready');
    } finally {
      if (previous === undefined) delete process.env.MATRX_PLAYWRIGHT_MODULE;
      else process.env.MATRX_PLAYWRIGHT_MODULE = previous;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
