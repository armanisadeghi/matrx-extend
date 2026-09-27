#!/usr/bin/env node
/**
 * Real proof that Save offers optional filing AFTER it lands, and that filing
 * reaches the door (SOURCE-CONVERGENCE §8.3 in the extension): the built
 * unpacked extension in a real Chrome profile, a real public web page, Save →
 * the filing panel → the registry picker → a disposable admin project → the
 * edge read back independently through `assoc_for_entity` → the web-app link
 * opened. The project it creates and a Source it newly landed are soft-deleted
 * before it exits.
 *
 *   npx wxt build && node tests/browser/file-source-e2e.mjs [screenshot-dir]
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBrowserRuntime } from './browser-runtime.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const CODE = '/Users/armanisadeghi/code';
const EXTENSION_DIR = join(REPO, '.output', 'chrome-mv3');
const PAGE = process.env.FILE_WALK_PAGE ?? 'https://en.wikipedia.org/wiki/Special:Random';
const { chromium, executablePath } = await resolveBrowserRuntime();

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}
const fail = (message) => {
  throw new Error(message);
};

async function main() {
  if (!existsSync(join(EXTENSION_DIR, 'manifest.json'))) fail('Run npx wxt build first.');
  const shots = process.argv[2] ?? join(REPO, '.e2e-screens');
  mkdirSync(shots, { recursive: true });
  const env = {
    ...readEnvFile(join(REPO, '.env')),
    ...readEnvFile(join(REPO, '.env.development')),
  };
  const admin = readEnvFile(join(CODE, 'aidream', '.env'));
  const supabaseUrl = env.WXT_SUPABASE_URL;
  const key = env.WXT_SUPABASE_PUBLISHABLE_KEY;
  const frontendUrl = (env.WXT_FRONTEND_URL ?? 'https://www.aimatrx.com').replace(/\/+$/, '');
  const auth = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: admin.AI_ADMIN_USERNAME, password: admin.AI_ADMIN_PASSWORD }),
  });
  if (!auth.ok) fail(`Admin sign-in returned ${auth.status}.`);
  const session = await auth.json();
  if (session.user?.email !== admin.AI_ADMIN_USERNAME) fail('Signed in as the wrong identity.');
  console.log(`✓ identity: ${session.user.email}`);
  const organizationId = '884d1ce8-7b49-4fba-a2f3-0f7dd7c83d4f';
  const rest = async (schema, path, init = {}) => {
    const r = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
      method: init.method ?? 'GET',
      headers: {
        apikey: key,
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
        'Content-Profile': schema,
        'Accept-Profile': schema,
        Prefer: init.method === 'PATCH' ? 'return=minimal' : 'return=representation',
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
    const text = await r.text();
    if (!r.ok)
      fail(`${init.method ?? 'GET'} ${schema}.${path} → ${r.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  };

  const stamp = Date.now();
  const projectName = `Filing walk ${stamp}`;
  const [project] = await rest('workspace', 'projects', {
    method: 'POST',
    body: {
      name: projectName,
      slug: `filing-walk-${stamp}`,
      organization_id: organizationId,
      created_by: session.user.id,
      settings: {},
    },
  });
  console.log(`✓ disposable project ${project.id} "${projectName}"`);

  let context;
  let sourceId = null;
  let sourceIsNew = false;
  const started = new Date().toISOString();
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
        const enc = new TextEncoder();
        const base = await crypto.subtle.importKey(
          'raw',
          enc.encode('matrx-extend.refresh-token.v1'),
          { name: 'PBKDF2' },
          false,
          ['deriveKey'],
        );
        const k = await crypto.subtle.deriveKey(
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
          await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, enc.encode(refreshToken)),
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

    const article = await context.newPage();
    await article.goto(PAGE, { waitUntil: 'domcontentloaded' });
    const pageUrl = article.url();
    console.log(`✓ real public page: ${pageUrl}`);
    await article.bringToFront();

    await panel.getByTitle('Scrape').click({ timeout: 20_000 });
    await panel.getByRole('button', { name: /^Capture$/ }).click();
    await panel.getByRole('button', { name: /^Save$/ }).waitFor({ timeout: 45_000 });
    // No filing step exists before the save.
    if (await panel.getByTestId('file-source-panel').count())
      fail('The filing panel appeared before Save.');
    await panel.getByRole('button', { name: /^Save$/ }).click();
    await panel.getByText('Open this Source (opens in the web app)').waitFor({ timeout: 45_000 });
    const filing = panel.getByTestId('file-source-panel');
    await filing.waitFor({ timeout: 15_000 });
    await panel.screenshot({ path: join(shots, 'file-1-after-save.png') });
    console.log('✓ Save landed; the optional filing panel appeared after it');

    // Choose the disposable project in the registry picker.
    const search = filing.getByRole('textbox').first();
    await search.fill(projectName);
    await filing.getByText(projectName, { exact: false }).first().click({ timeout: 30_000 });
    await filing.getByRole('button', { name: /^File in 1 place$/ }).click({ timeout: 15_000 });
    await filing
      .getByTestId('file-source-result')
      .getByText(`Filed in ${projectName}.`)
      .waitFor({ timeout: 30_000 });
    await panel.screenshot({ path: join(shots, 'file-2-filed.png') });
    console.log(`✓ panel says "Filed in ${projectName}."`);

    const identity = (() => {
      const u = new URL(pageUrl);
      u.hash = '';
      return u.toString().replace(/\/$/, (m) => (u.pathname === '/' ? m : ''));
    })();
    const rows = await rest(
      'docproc',
      `processed_documents?origin_client=eq.extension&organization_id=eq.${organizationId}&canonical_identity=eq.${encodeURIComponent(identity)}&deleted_at=is.null&select=id,created_at,visibility&order=created_at.desc&limit=1`,
    );
    if (!rows?.[0]) fail(`No Source found for ${identity}.`);
    sourceId = rows[0].id;
    sourceIsNew = rows[0].created_at >= started;
    const edges = await fetch(`${supabaseUrl}/rest/v1/rpc/assoc_for_entity`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
        'Content-Profile': 'public',
      },
      body: JSON.stringify({ p_type: 'processed_document', p_id: sourceId }),
    }).then((r) => r.json());
    const edge = (Array.isArray(edges) ? edges : []).find((e) => e.other_id === project.id);
    if (!edge)
      fail(
        `No edge from Source ${sourceId} to project ${project.id}: ${JSON.stringify(edges).slice(0, 400)}`,
      );
    console.log(
      `✓ independent read: Source ${sourceId} (${rows[0].visibility}) → project edge ${edge.id}`,
    );

    const [opened] = await Promise.all([
      context.waitForEvent('page', { timeout: 20_000 }),
      panel.getByText('Open this Source (opens in the web app)').click(),
    ]);
    await opened.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => undefined);
    const expected = `${frontendUrl}/knowledge/sources/${sourceId}`;
    const openedUrl = opened.url();
    await opened.screenshot({ path: join(shots, 'file-3-web-app.png') }).catch(() => undefined);
    if (
      !openedUrl.includes(`/knowledge/sources/${sourceId}`) &&
      !openedUrl.includes(encodeURIComponent(`/knowledge/sources/${sourceId}`))
    )
      fail(`Web-app link opened ${openedUrl}, expected ${expected}.`);
    console.log(`✓ web-app link opened: ${openedUrl}`);
  } finally {
    await context?.close().catch(() => undefined);
    const cleaned = [];
    await rest('workspace', `projects?id=eq.${project.id}`, {
      method: 'PATCH',
      body: { deleted_at: new Date().toISOString() },
    })
      .then(() => cleaned.push(`project ${project.id}`))
      .catch((e) => console.error(`CLEANUP FAILED (project): ${e.message}`));
    if (sourceId && sourceIsNew) {
      await rest('docproc', `processed_documents?id=eq.${sourceId}`, {
        method: 'PATCH',
        body: { deleted_at: new Date().toISOString() },
      })
        .then(() => cleaned.push(`Source ${sourceId}`))
        .catch((e) => console.error(`CLEANUP FAILED (Source ${sourceId}): ${e.message}`));
    }
    console.log(`cleanup: soft-deleted ${cleaned.join(', ') || 'nothing'}`);
  }
  console.log(`screenshots: ${shots}`);
}

await main();
