#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
/**
 * Real proof that Save lands a Source and the Saved captures tab reads it
 * (SOURCE-CONVERGENCE §4.2): built unpacked extension → live server
 * `POST /sources/land` → docproc.processed_documents, read back independently
 * through PostgREST as the same person. Also proves "never lose input": with
 * `/sources/land` unreachable the capture waits under the "Not yet a Source" retry card and a
 * retry lands it. Only disposable pages served by this run are captured; every
 * Source it lands is soft-deleted before it exits.
 *
 *   pnpm build && node tests/browser/saved-captures-e2e.mjs [screenshot-dir]
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBrowserRuntime } from './browser-runtime.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const CODE = '/Users/armanisadeghi/code';
const EXTENSION_DIR = join(REPO, '.output', 'chrome-mv3');
const ORIGINAL_EXTENSION = join(CODE, 'matrx-extend');
const { chromium, executablePath } = await resolveBrowserRuntime();

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[match[1]] = value;
  }
  return out;
}

function fail(message) {
  throw new Error(message);
}

async function request({ url, key, token, method = 'GET', body }) {
  const response = await fetch(url, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Profile': 'docproc',
      'Accept-Profile': 'docproc',
      Prefer: 'return=representation',
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  if (!response.ok) fail(`${method} ${url} returned ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

function articlePage(stamp, variant) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Source convergence walk ${variant} ${stamp}</title>
<meta name="description" content="Disposable page for the Sources acceptance walk">
</head><body><article>
<h1>Source convergence walk ${variant} ${stamp}</h1>
<p>This disposable article proves that a page saved from the extension becomes a Source. It has enough words for the reader extractor to treat it as the main content of the page, and a couple of sections so the portioner has headings to cut at.</p>
<h2>First section</h2>
<p>The first section talks about landing: the capture goes through one door, and the door keeps the original page data in storage while the text is stored as sections that can be cited.</p>
<img src="/hero.png" alt="Hero image" width="640" height="320">
<h2>Second section</h2>
<p>The second section talks about never losing input. When the server cannot be reached, the capture waits on the device under an unsaved card until a retry lands it.</p>
<p><a href="https://example.com/next">Next page</a></p>
</article></body></html>`;
}

async function main() {
  if (!existsSync(join(EXTENSION_DIR, 'manifest.json'))) fail('Run pnpm build first.');
  const shots = process.argv[2] ?? join(REPO, '.e2e-screens');
  mkdirSync(shots, { recursive: true });
  const extensionEnv = {
    ...readEnvFile(join(ORIGINAL_EXTENSION, '.env')),
    ...readEnvFile(join(ORIGINAL_EXTENSION, '.env.development')),
  };
  const aidreamEnv = readEnvFile(join(CODE, 'aidream', '.env'));
  const supabaseUrl = extensionEnv.WXT_SUPABASE_URL;
  const key = extensionEnv.WXT_SUPABASE_PUBLISHABLE_KEY;
  const email = aidreamEnv.AI_ADMIN_USERNAME;
  const password = aidreamEnv.AI_ADMIN_PASSWORD;
  if (!supabaseUrl || !key || !email || !password)
    fail('Required test credentials are unavailable.');

  const auth = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!auth.ok) fail(`Admin sign-in returned ${auth.status}.`);
  const session = await auth.json();
  if (session.user?.email !== email) fail('Signed in as the wrong identity.');
  console.log(`✓ identity: ${session.user.email} (${session.user.id})`);
  const organizationId = '884d1ce8-7b49-4fba-a2f3-0f7dd7c83d4f';
  const stamp = Date.now();

  const server = createServer((req, res) => {
    if (req.url?.startsWith('/hero.png')) {
      res.writeHead(200, { 'content-type': 'image/png' }).end(Buffer.alloc(0));
      return;
    }
    const variant = req.url?.includes('offline') ? 'offline' : 'online';
    res
      .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      .end(articlePage(stamp, variant));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const onlineUrl = `http://127.0.0.1:${port}/walk/online-${stamp}`;
  const offlineUrl = `http://127.0.0.1:${port}/walk/offline-${stamp}`;
  const onlineTitle = `Source convergence walk online ${stamp}`;
  const offlineTitle = `Source convergence walk offline ${stamp}`;
  const rest = (path, init = {}) =>
    request({ url: `${supabaseUrl}/rest/v1/${path}`, key, token: session.access_token, ...init });
  const sourcesFor = (url) =>
    rest(
      `processed_documents?origin_client=eq.extension&canonical_identity=eq.${encodeURIComponent(url)}&select=id,name,total_pages,original_file_id,kept_at,visibility,canonical_clean_id,deleted_at,structured_json`,
    );

  const landed = [];
  let context;
  try {
    context = await chromium.launchPersistentContext('', {
      executablePath,
      headless: false,
      viewport: { width: 420, height: 900 },
      args: [
        '--headless=new',
        `--disable-extensions-except=${EXTENSION_DIR}`,
        `--load-extension=${EXTENSION_DIR}`,
      ],
    });
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
    const extensionId = new URL(worker.url()).host;
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await panel.evaluate(
      async ([accessToken, refreshToken, expiresIn, user, org]) => {
        // The panel restores a session only with the refresh token encrypted
        // the way src/lib/auth/crypto.ts does it (PBKDF2 over the runtime id →
        // AES-GCM); an access token alone reads as "could not restore".
        const enc = new TextEncoder();
        const base = await crypto.subtle.importKey(
          'raw',
          enc.encode('matrx-extend.refresh-token.v1'),
          { name: 'PBKDF2' },
          false,
          ['deriveKey'],
        );
        const key = await crypto.subtle.deriveKey(
          {
            name: 'PBKDF2',
            salt: enc.encode(chrome.runtime.id),
            iterations: 100_000,
            hash: 'SHA-256',
          },
          base,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt'],
        );
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ct = new Uint8Array(
          await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(refreshToken)),
        );
        const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
        await chrome.storage.local.set({
          'matrx.auth.accessToken': accessToken,
          'matrx.auth.refreshTokenEnc': b64(ct),
          'matrx.auth.refreshTokenIv': b64(iv),
          'matrx.auth.expiresAt': Date.now() + expiresIn * 1000,
          'matrx.user.profile': user,
          'matrx.org.active': org,
        });
      },
      [
        session.access_token,
        session.refresh_token,
        session.expires_in ?? 3600,
        session.user,
        { id: organizationId, name: "Admin's Workspace" },
      ],
    );
    await panel.reload();

    // The article is the ACTIVE tab; the panel page runs behind it, like the
    // real side panel does beside the page it captures.
    const article = await context.newPage();
    await article.goto(onlineUrl);
    await article.bringToFront();

    const scrapeTab = panel.getByTitle('Scrape');
    await scrapeTab.waitFor({ timeout: 20_000 });
    await scrapeTab.click();
    await panel.getByRole('button', { name: /^Capture$/ }).click();
    await panel.getByRole('button', { name: /^Save$/ }).waitFor({ timeout: 30_000 });
    // Edit the article in Scrape BEFORE saving: the Source must carry the edit.
    const editedLine = `Edited in Scrape before saving ${stamp}.`;
    await panel.getByTitle('Edit article markdown').click();
    const draft = panel.getByPlaceholder(/^Article markdown/);
    await draft.fill(
      `# Source convergence walk online ${stamp}\n\n${editedLine}\n\n## First section\n\nKept.`,
    );
    await panel.getByRole('button', { name: 'Apply' }).click();
    await panel.getByRole('button', { name: /^Save$/ }).click();
    await panel.getByText('Open this Source (opens in the web app)').waitFor({ timeout: 30_000 });
    await panel.screenshot({ path: join(shots, '1-saved-in-scrape.png') });
    console.log('✓ Save in the built extension landed (Saved + web-app link shown)');

    const rows = await sourcesFor(onlineUrl);
    if (rows.length !== 1) fail(`Expected exactly one Source for the page, found ${rows.length}.`);
    const source = rows[0];
    landed.push(source.id);
    if (!source.original_file_id) fail('The Source has no original (the soup JSON was not kept).');
    if (!source.kept_at) fail('The Source was not kept.');
    if (source.visibility !== 'personal') fail(`Visibility is ${source.visibility}, not personal.`);
    if ((source.total_pages ?? 0) < 2) fail(`Expected H1–H3 portions, got ${source.total_pages}.`);
    for (const k of ['images', 'links', 'metadata', 'ld_json', 'videos', 'audio', 'pattern_id']) {
      if (!(k in (source.structured_json ?? {}))) fail(`structured_json is missing ${k}.`);
    }
    const withText = await rest(`processed_documents?id=eq.${source.id}&select=content`);
    if (!withText?.[0]?.content?.includes(editedLine))
      fail('The Source does not carry the edit made in Scrape before saving.');
    if (withText[0].content.includes('It has enough words for the reader extractor'))
      fail('The Source carries the pre-edit article text.');
    console.log('✓ the edit made in Scrape before saving is the text the Source landed with');
    const portions = await rest(
      `processed_document_pages?processed_document_id=eq.${source.id}&select=page_number,portion_kind,locator&order=page_number`,
    );
    console.log(
      `✓ independent read: Source ${source.id} — ${portions.length} portions ${JSON.stringify(portions.map((p) => [p.portion_kind, p.locator?.heading_path]))}, original ${source.original_file_id}, kept, personal`,
    );

    // Saved captures tab — reads the new table.
    await panel.getByTitle('Saved captures').click();
    await panel.getByText(onlineTitle, { exact: true }).waitFor({ timeout: 20_000 });
    await panel.screenshot({ path: join(shots, '2-saved-captures-list.png') });
    await panel.getByText(onlineTitle, { exact: true }).click();
    await panel.getByRole('tab', { name: 'Details' }).click();
    await panel.getByText('Words', { exact: true }).first().waitFor({ timeout: 20_000 });
    await panel.locator('text=Original').first().waitFor();
    await panel.waitForFunction(() => !document.body.innerText.includes('Loading…'), null, {
      timeout: 20_000,
    });
    await panel.screenshot({ path: join(shots, '3-saved-capture-details.png') });
    const detailsText = await panel.locator('body').innerText();
    if (!/Original\s*\n?\s*Saved in your files/.test(detailsText))
      fail('Details did not read the original back from storage.');
    console.log('✓ Saved captures listed the Source and Details read the original from S3');

    await panel.getByRole('button', { name: 'Edit' }).click();
    await panel
      .getByLabel('Article text')
      .fill(`# Edited walk ${stamp}\n\nEdited through the extension.\n\n## Part two\n\nMore.`);
    await panel.getByRole('button', { name: 'Save changes' }).click();
    await panel
      .getByText('Showing your edited version. The original capture is kept unchanged.')
      .waitFor({
        timeout: 20_000,
      });
    const afterEdit = (await sourcesFor(onlineUrl))[0];
    if (!afterEdit?.canonical_clean_id || afterEdit.canonical_clean_id === source.id)
      fail('The edit did not land beside the original (canonical_clean_id unchanged).');
    console.log(
      `✓ edit landed beside the original (canonical_clean_id → ${afterEdit.canonical_clean_id})`,
    );

    await panel.getByRole('button', { name: 'Delete' }).click();
    await panel.getByRole('button', { name: 'Delete', exact: true }).last().click();
    await panel
      .getByText(onlineTitle, { exact: true })
      .waitFor({ state: 'detached', timeout: 20_000 });
    const afterDelete = (await sourcesFor(onlineUrl))[0];
    if (!afterDelete?.deleted_at) fail('The external read did not see the soft delete.');
    console.log('✓ delete set deleted_at and removed the Source from the list');

    // Never lose input: the door unreachable.
    await article.goto(offlineUrl);
    await article.bringToFront();
    await panel.getByTitle('Scrape').click();
    await panel.route('**/sources/land', (route) => route.abort('internetdisconnected'));
    await panel.getByRole('button', { name: /^(Capture|Re-capture)$/ }).click();
    await panel.getByRole('button', { name: /^Save$/ }).waitFor({ timeout: 30_000 });
    await panel.getByRole('button', { name: /^Save$/ }).click();
    await panel.getByText(/Not yet a Source — kept on this device/).waitFor({ timeout: 30_000 });
    await panel.screenshot({ path: join(shots, '4-unsaved-retry-card.png') });
    const stored = await panel.evaluate(async () => {
      const got = await chrome.storage.local.get('matrx.sources.unsaved');
      return (got['matrx.sources.unsaved'] ?? []).map((r) => r.url);
    });
    if (!stored.includes(offlineUrl)) fail('The unsaved capture was not kept on the device.');
    if ((await sourcesFor(offlineUrl)).length !== 0)
      fail('A Source landed while the door was down.');
    console.log(
      '✓ door unreachable: "Not yet a Source" retry card shown, capture kept in chrome.storage.local',
    );

    await panel.unroute('**/sources/land');
    await panel.getByRole('button', { name: /Retry save/ }).click();
    await panel
      .getByText(/Not yet a Source — kept on this device/)
      .waitFor({ state: 'detached', timeout: 30_000 });
    const retried = await sourcesFor(offlineUrl);
    if (retried.length !== 1) fail('The retry did not land the capture.');
    landed.push(retried[0].id);
    await panel.screenshot({ path: join(shots, '5-after-retry.png') });
    console.log(`✓ retry landed the kept capture as Source ${retried[0].id}; card cleared`);
    console.log(`screenshots: ${shots}`);
  } finally {
    await context?.close();
    server.close();
    for (const id of landed) {
      await rest(`processed_documents?id=eq.${id}&deleted_at=is.null&select=id`, {
        method: 'PATCH',
        body: { deleted_at: new Date().toISOString() },
      }).catch((error) => console.error(`cleanup failed for ${id}: ${error.message}`));
    }
  }
}

await main();
