import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

// Browser acceptance scripts use Playwright from this repo when installed, or
// an explicit host runtime. Never borrow it from a guessed sibling checkout.
export async function resolveBrowserRuntime({ chromeExecutable } = {}) {
  let chromium;
  const modulePath = process.env.MATRX_PLAYWRIGHT_MODULE;
  if (modulePath) {
    try {
      ({ chromium } = await import(pathToFileURL(resolve(modulePath))));
    } catch (error) {
      throw new Error(
        `browser_runtime_playwright_unavailable: MATRX_PLAYWRIGHT_MODULE must name an installed Playwright module (${error.message})`,
      );
    }
  } else {
    let installed;
    try {
      installed = require.resolve('playwright');
    } catch (error) {
      if (error?.code !== 'MODULE_NOT_FOUND') throw error;
      throw new Error(
        'browser_runtime_playwright_missing: install Playwright in this repo or set MATRX_PLAYWRIGHT_MODULE to an installed playwright/index.mjs',
      );
    }
    ({ chromium } = require(installed));
  }
  if (typeof chromium?.connectOverCDP !== 'function' ||
      typeof chromium?.launchPersistentContext !== 'function' ||
      typeof chromium?.executablePath !== 'function')
    throw new Error('browser_runtime_playwright_invalid: expected Playwright chromium');

  const candidate = chromeExecutable ?? process.env.MATRX_CHROME_PATH ?? chromium.executablePath();
  const executablePath = resolve(candidate);
  try {
    await access(executablePath, constants.X_OK);
  } catch {
    throw new Error(
      'browser_runtime_chrome_missing: set MATRX_CHROME_PATH to an installed Chrome-for-Testing executable',
    );
  }
  return Object.freeze({ chromium, executablePath });
}
