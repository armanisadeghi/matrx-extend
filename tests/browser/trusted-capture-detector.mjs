/*
 * Controlled real-Chrome guard for the content detector. Run with the local
 * browser runner already installed by the workspace, for example:
 * MATRX_PLAYWRIGHT_MODULE=/path/to/playwright MATRX_ESBUILD_MODULE=/path/to/esbuild node tests/browser/trusted-capture-detector.mjs
 */
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const playwrightModule = process.env.MATRX_PLAYWRIGHT_MODULE;
const esbuildModule = process.env.MATRX_ESBUILD_MODULE;
if (!playwrightModule || !esbuildModule)
  throw new Error('Set MATRX_PLAYWRIGHT_MODULE and MATRX_ESBUILD_MODULE to the existing local runners.');
const { chromium } = await import(playwrightModule);
const { build } = require(esbuildModule);
const root = process.cwd();
const bundle = await build({
  entryPoints: [`${root}/src/lib/credentials/capture-detector.ts`],
  bundle: true,
  format: 'iife',
  globalName: 'CaptureDetectorTest',
  write: false,
  plugins: [
    {
      name: 'matrx-alias',
      setup(plugin) {
        plugin.onResolve({ filter: /^@\// }, (args) => ({ path: `${root}/src/${args.path.slice(2)}.ts` }));
      },
    },
  ],
});
const source = bundle.outputFiles[0].text;
const server = http.createServer((_, response) => response.end('<!doctype html><title>capture fixture</title>'));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/login`;
const chromePath = process.env.MATRX_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ executablePath: chromePath, headless: true });
const page = await browser.newPage();
async function fixture(html, reply = { status: 'held' }) {
  await page.addInitScript(() => {
    window.__captured = [];
    window.__opened = 0;
    window.chrome = {
      runtime: {
        id: 'fixture-extension',
        sendMessage: (message) => {
          if (message.kind === 'credential-suggestions:open-vault') window.__opened += 1;
          window.__captured.push(message);
          return Promise.resolve(reply);
        },
      },
    };
  });
  await page.goto(url);
  await page.setContent(html);
  await page.addScriptTag({ content: source });
  await page.evaluate(() => window.CaptureDetectorTest.mountCaptureDetector());
}
async function payloads() {
  return page.evaluate(() => window.__captured.map((message) => message.payload));
}
async function expectCase(name, action, expected) {
  await action();
  const actual = await payloads();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${name}: ${JSON.stringify(actual)}`);
}
try {
  await fixture('');
  await page.evaluate(() => {
    document.body.innerHTML = '<form method="post" onsubmit="event.preventDefault()"><input autocomplete="username" value="late@fixture.test"><input id="late" type="password" value="late-secret"><button>Go</button></form>';
  });
  await expectCase('late click plus native submit coalesces', () => page.locator('button').click(), [{ stage: 'password', loginUrl: url, username: 'late@fixture.test', password: 'late-secret' }]);
  await fixture('<form method="post" onsubmit="event.preventDefault()"><input autocomplete="username" value="enter@fixture.test"><input id="enter" type="password" value="enter-secret"></form>');
  await expectCase('trusted Enter', () => page.locator('#enter').press('Enter'), [{ stage: 'password', loginUrl: url, username: 'enter@fixture.test', password: 'enter-secret' }]);
  await fixture('<form method="post" onsubmit="event.preventDefault()"><input autocomplete="username" value="repeat@fixture.test"><input id="repeat" type="password" value="first"><button>Go</button></form>');
  await page.locator('button').click();
  await page.locator('#repeat').fill('second');
  await expectCase('changed password new gesture', () => page.locator('button').click(), [{ stage: 'password', loginUrl: url, username: 'repeat@fixture.test', password: 'first' }, { stage: 'password', loginUrl: url, username: 'repeat@fixture.test', password: 'second' }]);
  await fixture('<form method="post"><input autocomplete="username" value="synthetic@fixture.test"><input type="password" value="synthetic-secret"><button>Go</button></form>');
  await expectCase('synthetic refusal', () => page.evaluate(() => document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true }))), []);
  await fixture('<form method="post" onsubmit="event.preventDefault()"><input autocomplete="username" value="unavailable@fixture.test"><input type="password" value="unavailable-secret"><button>Go</button></form>', { status: 'unavailable', reason: 'sign_in_required', tabId: 1 });
  await page.locator('button').click();
  await page.locator('#matrx-login-capture-host[aria-label="Matrx Vault needs attention"]').waitFor();
  // The recovery card deliberately uses a closed shadow root. Click the
  // visible first action through Chrome's real pointer path, not a synthetic
  // DOM event or a shadow-root test seam.
  await page.mouse.click(990, 95);
  if (await page.evaluate(() => window.__opened) !== 1) throw new Error('unavailable recovery did not invoke Open Vault');
  console.log('PASS trusted capture detector browser guard');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
