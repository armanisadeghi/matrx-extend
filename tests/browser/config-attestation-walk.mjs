/**
 * Config attestation walk: load the BUILT extension in headless Chromium, sign in as admin@admin.com,
 * open the side panel (stored config + knob reads), force the service worker's flush alarm, and print the
 * app_instances row id. Verify the buckets with admin-query on platform.config_read_bucket.
 *   WXT_OUT_DIR=/tmp/ext-out node tests/browser/config-attestation-walk.mjs
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBrowserRuntime } from './browser-runtime.mjs';
import { extensionOAuthClientId, readEnvFile, seedExtensionSession } from './seed-extension-session.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXTENSION_DIR = join(process.env.WXT_OUT_DIR ? resolve(process.env.WXT_OUT_DIR) : join(REPO, '.output'), 'chrome-mv3');
const ORGANIZATION_ID = '884d1ce8-7b49-4fba-a2f3-0f7dd7c83d4f';
const env = { ...readEnvFile(join(REPO, '.env')), ...readEnvFile(join(REPO, '.env.development')) };
const aidreamEnv = readEnvFile(join(resolve(REPO, '..'), 'aidream', '.env'));
const key = env.WXT_SUPABASE_PUBLISHABLE_KEY ?? env.WXT_SUPABASE_ANON_KEY;
const res = await fetch(`${env.WXT_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: key },
  body: JSON.stringify({ email: aidreamEnv.AI_ADMIN_USERNAME, password: aidreamEnv.AI_ADMIN_PASSWORD }),
});
if (!res.ok) { console.error(`REFUSED: sign-in ${res.status}`); process.exit(1); }
const session = await res.json();
const { chromium, executablePath } = await resolveBrowserRuntime();
const context = await chromium.launchPersistentContext('', {
  executablePath, headless: true, viewport: { width: 420, height: 900 },
  args: ['--headless=new', `--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`],
});
try {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
  worker.on('console', (m) => { const t = m.text(); if (/config|attest/i.test(t)) console.log('  [sw]', t.slice(0, 260)); });
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await seedExtensionSession(page, { session, clientId: extensionOAuthClientId(REPO), organization: { id: ORGANIZATION_ID, name: "Admin's Workspace" } });
  await page.reload();
  await page.waitForTimeout(20_000);
  for (let i = 0; i < 3; i++) {
    await worker.evaluate(() => chrome.alarms.create('matrx-config-flush', { when: Date.now() + 300 }));
    await page.waitForTimeout(8_000);
  }
  console.log('walk done');
} finally {
  await context.close();
}
