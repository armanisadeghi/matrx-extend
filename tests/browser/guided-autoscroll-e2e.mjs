#!/usr/bin/env node
/**
 * "Scroll for me" on a real public profile, headless, built extension.
 *   pnpm exec wxt build && MATRX_SCROLL_URL=https://www.tiktok.com/@nasa node tests/browser/guided-autoscroll-e2e.mjs
 * Seeds a guided job for the tab through the service worker's own session map (no web app needed),
 * presses "Scroll for me" with a small target, and reports the live counter and the end state.
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBrowserRuntime } from './browser-runtime.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXT = join(REPO, '.output', 'chrome-mv3');
const URL_ = process.env.MATRX_SCROLL_URL || 'https://www.tiktok.com/@nasa';
const PLATFORM = process.env.MATRX_SCROLL_PLATFORM || 'tiktok';
const TARGET = process.env.MATRX_SCROLL_TARGET || '25';
const { chromium, executablePath } = await resolveBrowserRuntime();
const ctx = await chromium.launchPersistentContext('', {
  executablePath,
  headless: false,
  args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
try {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 30000 });
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(4000);
  await sw.evaluate(
    async ([url, platform]) => {
      const [tab] = await chrome.tabs.query({ url: `${url.replace(/\/$/, '')}*` });
      await chrome.storage.session.set({
        'matrx.guided.tabs': {
          [String(tab.id)]: {
            handoffId: 'e2e',
            organizationId: 'e2e',
            url,
            title: 'e2e',
            platform,
            target: 'profile',
            rowSteps: '',
            openerTabId: null,
          },
        },
      });
    },
    [URL_, PLATFORM],
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  const card = page.locator('#matrx-guided-capture');
  await card.waitFor({ state: 'attached', timeout: 20000 });
  await card.locator('#scroll-target').selectOption(TARGET);
  await card.getByRole('button', { name: /scroll for me/i }).click();
  const seen = [];
  const t0 = Date.now();
  let last = '';
  while (Date.now() - t0 < 150000) {
    last = (await card.locator('.count').first().textContent()) || '';
    if (seen.at(-1) !== last) {
      seen.push(last);
      console.log(`  counter: ${last}`);
    }
    if (!/scrolling/.test(last) && seen.length > 1) break;
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: join(REPO, '.output', 'swipe-file-e2e', 'autoscroll.png') });
  console.log(`  scrollY=${await page.evaluate(() => window.scrollY)}  RESULT: ${last}`);
} finally {
  await ctx.close().catch(() => {});
}
