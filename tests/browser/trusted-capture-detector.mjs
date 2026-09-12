import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';

/*
 * Controlled real-Chrome guard for the content detector. Run with the local
 * browser runner already installed by the workspace, for example:
 * MATRX_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs MATRX_ESBUILD_MODULE=/path/to/esbuild/lib/main.js node tests/browser/trusted-capture-detector.mjs
 */
const require = createRequire(import.meta.url);
const playwrightModule = process.env.MATRX_PLAYWRIGHT_MODULE;
const esbuildModule = process.env.MATRX_ESBUILD_MODULE;
if (!playwrightModule?.endsWith('.mjs') || !esbuildModule)
  throw new Error(
    'Set MATRX_PLAYWRIGHT_MODULE and MATRX_ESBUILD_MODULE to the existing local runners.',
  );
const { chromium } = await import(playwrightModule);
const { build } = require(esbuildModule);
const root = process.cwd();
const bundle = await build({
  entryPoints: [`${root}/src/lib/credentials/capture-detector.ts`],
  bundle: true,
  format: 'esm',
  splitting: true,
  outdir: `${root}/.tmp-browser-guard`,
  write: false,
  plugins: [
    {
      name: 'matrx-alias',
      setup(plugin) {
        plugin.onResolve({ filter: /^@\// }, (args) => ({
          path: `${root}/src/${args.path.slice(2)}.ts`,
        }));
      },
    },
    {
      name: 'delay-real-capture-prompt-import',
      setup(plugin) {
        plugin.onLoad({ filter: /capture-prompt\.ts$/ }, async (args) => ({
          contents: `await globalThis.__capturePromptImportGate;\n${await readFile(args.path, 'utf8')}`,
          loader: 'ts',
        }));
      },
    },
  ],
});
const assets = new Map(
  bundle.outputFiles.map((file) => [`/${file.path.slice(root.length + 1)}`, file]),
);
const entryPath = [...assets.keys()].find((path) => path.endsWith('/capture-detector.js'));
if (!entryPath) throw new Error('capture detector browser bundle entry was not produced');
const server = http.createServer((request, response) => {
  const asset = assets.get(new URL(request.url, 'http://fixture.test').pathname);
  if (asset) {
    response.setHeader('content-type', 'text/javascript');
    response.end(asset.text);
    return;
  }
  response.end('<!doctype html><title>capture fixture</title>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/login`;
const entryUrl = `http://127.0.0.1:${server.address().port}${entryPath}`;
const chromePath =
  process.env.MATRX_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ executablePath: chromePath, headless: true });
const page = await browser.newPage();
async function fixture(html, reply = { status: 'held' }) {
  await page.addInitScript((initialReply) => {
    const attachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init) {
      return attachShadow.call(this, { ...init, mode: 'open' });
    };
    window.__captured = [];
    window.__opened = 0;
    window.__capturePromptImportGate = Promise.resolve();
    window.chrome = {
      runtime: {
        id: 'fixture-extension',
        sendMessage: (message) => {
          if (message.kind === 'credential-suggestions:open-vault') window.__opened += 1;
          window.__captured.push(message);
          return Promise.resolve(window.__reply ?? initialReply);
        },
      },
    };
  }, reply);
  await page.goto(url);
  await page.setContent(html);
  await page.evaluate(async (entry) => {
    const module = await import(entry);
    window.CaptureDetectorTest = { mountCaptureDetector: module.mountCaptureDetector };
  }, entryUrl);
  await page.evaluate(() => {
    window.__disposeCaptureDetector = window.CaptureDetectorTest.mountCaptureDetector();
  });
}
async function payloads() {
  return page.evaluate(() => window.__captured.map((message) => message.payload));
}
async function expectCase(name, action, expected) {
  await action();
  const actual = await payloads();
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`${name}: ${JSON.stringify(actual)}`);
}
try {
  await fixture('');
  await page.evaluate(() => {
    document.body.innerHTML =
      '<form method="post" onsubmit="event.preventDefault()"><input autocomplete="username" value="late@fixture.test"><input id="late" type="password" value="late-secret"><button>Go</button></form>';
  });
  await expectCase(
    'late click plus native submit coalesces',
    () => page.locator('button').click(),
    [{ stage: 'password', loginUrl: url, username: 'late@fixture.test', password: 'late-secret' }],
  );
  await fixture(
    '<form method="post" onsubmit="event.preventDefault()"><input autocomplete="username" value="enter@fixture.test"><input id="enter" type="password" value="enter-secret"></form>',
  );
  await expectCase('trusted Enter', () => page.locator('#enter').press('Enter'), [
    { stage: 'password', loginUrl: url, username: 'enter@fixture.test', password: 'enter-secret' },
  ]);
  await fixture(
    '<form method="post" onsubmit="event.preventDefault()"><input autocomplete="username" value="repeat@fixture.test"><input id="repeat" type="password" value="first"><button>Go</button></form>',
  );
  await page.locator('button').click();
  await page.locator('#repeat').fill('second');
  await expectCase('changed password new gesture', () => page.locator('button').click(), [
    { stage: 'password', loginUrl: url, username: 'repeat@fixture.test', password: 'first' },
    { stage: 'password', loginUrl: url, username: 'repeat@fixture.test', password: 'second' },
  ]);
  await fixture(
    '<form method="post"><input autocomplete="username" value="synthetic@fixture.test"><input type="password" value="synthetic-secret"><button>Go</button></form>',
  );
  await expectCase(
    'synthetic refusal',
    () =>
      page.evaluate(() =>
        document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true })),
      ),
    [],
  );
  await fixture(
    '<form method="post" onsubmit="event.preventDefault()"><input autocomplete="username" value="pending@fixture.test"><input type="password" value="pending-secret"><button>Go</button></form>',
    { status: 'unavailable', reason: 'capture_unavailable', tabId: 1 },
  );
  await page.evaluate(() => {
    window.__capturePromptImportGate = new Promise((resolve) => {
      window.__releaseCapturePromptImport = resolve;
    });
  });
  await page.locator('button').click();
  await page.locator('button').click(); // a newer gesture invalidates the first response
  await page.evaluate(() => {
    window.__disposeCaptureDetector();
    history.pushState({}, '', '/after-pending-import');
    window.__releaseCapturePromptImport();
  });
  await page.waitForTimeout(50);
  if ((await page.locator('#matrx-login-capture-host').count()) !== 0)
    throw new Error(
      'pending prompt import rendered after route, generation, or disposal invalidation',
    );
  await fixture(
    '<form method="post" onsubmit="event.preventDefault()"><input autocomplete="username" value="unavailable@fixture.test"><input type="password" value="unavailable-secret"><button>Go</button></form>',
    { status: 'unavailable', reason: 'sign_in_required', tabId: 1 },
  );
  await page.locator('button').click();
  await page
    .locator('#matrx-login-capture-host[aria-label="Matrx Vault needs attention"]')
    .waitFor();
  const recoveryActions = await page.evaluate(() =>
    Array.from(
      document.querySelector('#matrx-login-capture-host').shadowRoot.querySelectorAll('button'),
    ).map((button) => button.textContent),
  );
  if (JSON.stringify(recoveryActions) !== JSON.stringify(['Open Vault', 'Dismiss']))
    throw new Error(`unexpected unavailable actions: ${JSON.stringify(recoveryActions)}`);
  // The recovery card deliberately uses a closed shadow root. Click the
  // visible first action through Chrome's real pointer path, not a synthetic
  // DOM event or a shadow-root test seam.
  await page.mouse.click(990, 95);
  if ((await page.evaluate(() => window.__opened)) !== 1)
    throw new Error('unavailable recovery did not invoke Open Vault');
  await page.mouse.click(1065, 95);
  if ((await page.locator('#matrx-login-capture-host').count()) !== 0)
    throw new Error('unavailable Dismiss did not remove the recovery card');
  await fixture(
    '<form method="post" onsubmit="event.preventDefault()"><input autocomplete="username" value="quiet@fixture.test"><input type="password" value="quiet-secret"><button>Go</button></form>',
    { status: 'ignored' },
  );
  await page.locator('button').click();
  if ((await page.locator('#matrx-login-capture-host').count()) !== 0)
    throw new Error('ignored disabled/Never reply rendered recovery feedback');
  await fixture(
    '<form method="post" onsubmit="event.preventDefault()"><input autocomplete="username" value="stale@fixture.test"><input type="password" value="stale-secret"><button>Go</button></form>',
  );
  await page.evaluate(() => {
    window.chrome.runtime.sendMessage = (_message) =>
      new Promise((resolve) => {
        window.__resolveCandidate = () =>
          resolve({ status: 'unavailable', reason: 'capture_unavailable', tabId: 1 });
      });
  });
  await page.locator('button').click();
  await page.evaluate(() => history.pushState({}, '', '/other'));
  await page.evaluate(() => window.__resolveCandidate());
  await page.waitForTimeout(50);
  if ((await page.locator('#matrx-login-capture-host').count()) !== 0)
    throw new Error('stale response rendered recovery feedback');
  await fixture(
    '<form method="post" onsubmit="event.preventDefault()"><input autocomplete="username" value="disposed@fixture.test"><input type="password" value="disposed-secret"><button>Go</button></form>',
  );
  await page.evaluate(() => {
    window.chrome.runtime.sendMessage = () =>
      new Promise((resolve) => {
        window.__resolveCandidate = () =>
          resolve({ status: 'unavailable', reason: 'capture_unavailable', tabId: 1 });
      });
  });
  await page.locator('button').click();
  await page.evaluate(() => {
    window.__disposeCaptureDetector();
    window.__resolveCandidate();
  });
  await page.waitForTimeout(50);
  if ((await page.locator('#matrx-login-capture-host').count()) !== 0)
    throw new Error('disposed detector rendered recovery feedback');
  await fixture(
    '<form method="post" onsubmit="event.preventDefault()"><input autocomplete="username" value="rejected@fixture.test"><input type="password" value="rejected-secret"><button>Go</button></form>',
    { status: 'unavailable', reason: 'capture_unavailable', tabId: 1 },
  );
  const pageErrors = [];
  const onPageError = (error) => pageErrors.push(error.message);
  page.on('pageerror', onPageError);
  await page.evaluate(() => {
    window.__capturePromptImportGate = new Promise((_, reject) => {
      window.__rejectCapturePromptImport = reject;
    });
  });
  await page.locator('button').click();
  await page.waitForTimeout(10);
  await page.evaluate(() =>
    window.__rejectCapturePromptImport(new Error('fixture import failure')),
  );
  await page.waitForTimeout(50);
  page.off('pageerror', onPageError);
  if (pageErrors.length > 0)
    throw new Error(`rejected prompt import escaped: ${pageErrors.join(', ')}`);
  if ((await page.locator('#matrx-login-capture-host').count()) !== 0)
    throw new Error('rejected prompt import rendered recovery feedback');
  console.log('PASS trusted capture detector browser guard');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
