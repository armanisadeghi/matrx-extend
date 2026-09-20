#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
/**
 * Real saved-capture CRUD proof: live Supabase row + built unpacked extension.
 * Uses only a disposable row created by this run and removes it in cleanup.
 */
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const CODE = '/Users/armanisadeghi/code';
const EXTENSION_DIR = join(REPO, '.output', 'chrome-mv3');
const ORIGINAL_EXTENSION = join(CODE, 'matrx-extend');
const require_ = createRequire(join(CODE, 'matrx-frontend', 'package.json'));
const { chromium } = require_('playwright');

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
      'Content-Profile': 'extend',
      'Accept-Profile': 'extend',
      Prefer: 'return=representation',
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  if (!response.ok) fail(`${method} ${url} returned ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  if (!existsSync(join(EXTENSION_DIR, 'manifest.json'))) fail('Run pnpm build first.');
  const extensionEnv = {
    ...readEnvFile(join(ORIGINAL_EXTENSION, '.env')),
    ...readEnvFile(join(ORIGINAL_EXTENSION, '.env.development')),
  };
  const aidreamEnv = readEnvFile(join(CODE, 'aidream', '.env'));
  const supabaseUrl = extensionEnv.WXT_SUPABASE_URL;
  const key = extensionEnv.WXT_SUPABASE_PUBLISHABLE_KEY;
  const email = aidreamEnv.AI_ADMIN_USERNAME;
  const password = aidreamEnv.AI_ADMIN_PASSWORD;
  const secretKey = aidreamEnv.SUPABASE_MATRIX_SECRET_KEY;
  if (!supabaseUrl || !key || !email || !password)
    fail('Required test credentials are unavailable.');

  const auth = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!auth.ok) fail(`Admin sign-in returned ${auth.status}.`);
  const session = await auth.json();
  const organizationId = '884d1ce8-7b49-4fba-a2f3-0f7dd7c83d4f';
  const stamp = Date.now();
  const sourceTitle = `Saved captures acceptance ${stamp}`;
  const revisedTitle = `Revised saved capture ${stamp}`;
  const url = `https://example.com/matrx-saved-capture-${stamp}`;
  const soup = {
    url,
    capturedAt: stamp,
    metadata: { title: sourceTitle, description: 'Disposable acceptance capture', lang: 'en' },
    article: {
      title: sourceTitle,
      byline: null,
      content_html_safe: null,
      content_markdown: '# Original acceptance article',
      excerpt: null,
      extractor: 'readability',
      word_count: 3,
      reading_time_minutes: 1,
    },
    images: [],
    videos: [],
    audio: [],
    links: [],
    ld_json: [],
    seo: { word_count: 3 },
    raw_html_size: 100,
  };

  let captureId;
  let context;
  try {
    const inserted = await request({
      url: `${supabaseUrl}/rest/v1/wbx_capture`,
      key,
      token: session.access_token,
      method: 'POST',
      body: {
        organization_id: organizationId,
        url,
        title: sourceTitle,
        description: 'Disposable acceptance capture',
        lang: 'en',
        soup,
        markdown: soup.article.content_markdown,
        metadata: soup.metadata,
        ld_json: [],
        media_count: 0,
      },
    });
    captureId = inserted?.[0]?.id;
    if (!captureId) fail('The disposable capture insert returned no id.');

    context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        '--headless=new',
        `--disable-extensions-except=${EXTENSION_DIR}`,
        `--load-extension=${EXTENSION_DIR}`,
      ],
    });
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
    const extensionId = new URL(worker.url()).host;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await page.evaluate(
      async ([accessToken, expiresIn, user, org]) => {
        await chrome.storage.local.set({
          'matrx.auth.accessToken': accessToken,
          'matrx.auth.expiresAt': Date.now() + expiresIn * 1000,
          'matrx.user.profile': user,
          'matrx.org.active': org,
        });
      },
      [
        session.access_token,
        session.expires_in ?? 3600,
        session.user,
        { id: organizationId, name: "Admin's Workspace" },
      ],
    );
    await page.reload();

    const savedTab = page.getByTitle('Saved captures');
    await savedTab.waitFor({ timeout: 20_000 });
    await savedTab.click();
    await page.getByText(sourceTitle, { exact: true }).waitFor({ timeout: 20_000 });
    await page.getByText(sourceTitle, { exact: true }).click();
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Title').fill(revisedTitle);
    await page.getByLabel('Description').fill('Verified through the real extension panel');
    await page.getByLabel('Article markdown').fill('# Revised acceptance article\n\nPersisted.');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.getByText(revisedTitle, { exact: true }).waitFor({ timeout: 20_000 });

    const updated = await request({
      url: `${supabaseUrl}/rest/v1/wbx_capture?id=eq.${captureId}&select=title,description,markdown,deleted_at`,
      key,
      token: session.access_token,
    });
    if (updated?.[0]?.title !== revisedTitle)
      fail('The external read did not see the revised title.');
    if (updated?.[0]?.markdown !== '# Revised acceptance article\n\nPersisted.') {
      fail('The external read did not see the revised markdown.');
    }

    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).last().click();
    await page
      .getByText(revisedTitle, { exact: true })
      .waitFor({ state: 'detached', timeout: 20_000 });
    const deleted = await request({
      url: `${supabaseUrl}/rest/v1/wbx_capture?id=eq.${captureId}&select=deleted_at`,
      key,
      token: session.access_token,
    });
    if (!deleted?.[0]?.deleted_at) fail('The external read did not see the soft delete.');

    console.log('✓ built extension listed the live saved capture');
    console.log('✓ edit persisted and was independently read outside the browser');
    console.log('✓ delete set deleted_at and removed the row from the normal list');
  } finally {
    await context?.close();
    if (captureId && secretKey) {
      await request({
        url: `${supabaseUrl}/rest/v1/wbx_capture?id=eq.${captureId}`,
        key: secretKey,
        token: secretKey,
        method: 'DELETE',
      }).catch((error) => console.error(`cleanup failed: ${error.message}`));
    }
  }
}

await main();
