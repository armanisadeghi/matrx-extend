const fs = require('node:fs/promises');
const syncFs = require('node:fs');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('/Users/armanisadeghi/code/matrx-frontend/node_modules/playwright');
if (process.env.MATRX_REALBROWSER_VAULT_CANARY !== 'RUN_UNDER_REVIEW')
  throw new Error('inert_canary_requires_explicit_arm');
const ARTIFACT_ROOT =
  '/Users/armanisadeghi/code/matrx-extend/.matrx/realbrowser-vault/2026-09-13T07-30-16-813Z-9bb7b3fc-12f4-4a46-84cb-0cb0fd205f59';
const ROOT = path.join(ARTIFACT_ROOT, `run-${crypto.randomUUID()}`);
const ART = path.join(ARTIFACT_ROOT, 'extension');
const EXE =
  '/Users/armanisadeghi/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const PROFILE = path.join(ROOT, `extend-live-profile-${crypto.randomUUID()}`);
const PROOF = path.join(ROOT, 'proof.json');
const ID = 'cihdmkcdjjckfhjpgoedmgfpoljebaml';
const LOGIN = 'https://www.aimatrx.com/login';
const API = 'https://server.app.matrxserver.com';
const DB = 'https://db.matrxserver.com';
const RUN = crypto.randomUUID().slice(0, 8);
const UPDATE_NAME = `U-${RUN}`;
const ALT_NAME = `A-${RUN}`;
const ALT_USER = `extend-${RUN}@example.invalid`;
const ALT_PASSWORD = `Owned-${crypto.randomUUID()}`;
const STALE_PASSWORD = `Stale-${crypto.randomUUID()}`;
let ctx, sw, popup, token, userId, orgId;
const owned = [];
let baselineIds = [];
let website;
let preSave = null;
let savePhase = false;
let saveRequestObserved = false;
let createTrackingError = false;
const createKeys = new Set();
const activeCreates = new Set();
let workerUrl = null;
const CANARY_STAGES = new Set([
  'artifact_verify',
  'browser_launch',
  'extension_service_worker',
  'oauth_popup',
  'oauth_sign_in',
  'oauth_consent',
  'extension_session',
  'settings_workspace',
  'identity_verify',
  'baseline_snapshot',
  'fixture_create_update',
  'fixture_create_alternate',
  'fixture_metadata',
  'inline_prepare',
  'inline_choose',
  'inline_verify',
  'update_version_before',
  'website_update_navigate',
  'website_update_form_fill',
  'website_update_submit_wait',
  'capture_prompt_update',
  'capture_update_select',
  'capture_update_verify',
  'save_baseline',
  'website_save_navigate',
  'website_save_form_fill',
  'website_save_submit_wait',
  'capture_prompt_save',
  'capture_save_select',
  'capture_save_verify',
  'inline_escape',
  'inline_reopen',
  'inline_reload',
  'complete',
]);
function markStage(stage) {
  assert(CANARY_STAGES.has(stage), 'invalid_canary_stage');
  proof.diagnostics.stage = stage;
}
function classifyFailure(error) {
  const message = typeof error?.message === 'string' ? error.message : '';
  if (/^[a-z0-9_]{1,80}$/.test(message)) return 'assertion_refusal';
  if (error?.name === 'TimeoutError') return 'playwright_timeout';
  if (error?.name === 'Error') return 'playwright_error';
  return 'unexpected_error';
}
const proof = {
  scope: 'owned CFT private-pipe Extend save/update/inline acceptance',
  runId: RUN,
  startedAt: new Date().toISOString(),
  artifactCommit: '22e9a3c006480df6f71a2098f1ca01e123e3d686',
  artifactReceiptSha256: '40d3cbec84e372d5728e886e50b7a4508c1cc4cd45739469de2b6295257291f4',
  extensionId: null,
  browser: 'Google Chrome for Testing 153.0.8010.12',
  connectOverCDP: false,
  profileKind: 'new disposable scratch profile',
  checks: {},
  ownedFixtureIds: [],
  openProof: [],
  cleanup: {},
  diagnostics: { stage: 'artifact_verify', errorClass: null },
};
const assert = (x, m) => {
  if (!x) throw new Error(m);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function persistProof() {
  const temp = PROOF + '.tmp';
  const fd = syncFs.openSync(
    temp,
    syncFs.constants.O_WRONLY |
      syncFs.constants.O_CREAT |
      syncFs.constants.O_TRUNC |
      syncFs.constants.O_NOFOLLOW,
    0o600,
  );
  try {
    syncFs.writeFileSync(fd, JSON.stringify(proof, null, 2) + '\n');
    syncFs.fsyncSync(fd);
  } finally {
    syncFs.closeSync(fd);
  }
  syncFs.renameSync(temp, PROOF);
  const dir = syncFs.openSync(ROOT, syncFs.constants.O_RDONLY);
  try {
    syncFs.fsyncSync(dir);
  } finally {
    syncFs.closeSync(dir);
  }
}
async function verifyArtifact() {
  const manifest = await fs.readFile(path.join(ARTIFACT_ROOT, 'artifact-manifest.json'));
  assert(
    crypto.createHash('sha256').update(manifest).digest('hex') === proof.artifactReceiptSha256,
    'artifact_receipt_hash',
  );
  const parsed = JSON.parse(manifest);
  assert(
    parsed.sourceCommit === proof.artifactCommit && parsed.extensionDirectory === 'extension',
    'artifact_source',
  );
  const expected = new Map(
    parsed.archivedFiles
      .filter((x) => x.path.startsWith('.output/chrome-mv3/'))
      .map((x) => [x.path.slice('.output/chrome-mv3/'.length), x.sha256]),
  );
  assert(expected.size === 494, 'artifact_file_count');
  const seen = new Set();
  async function visit(dir, relative = '') {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const name = relative + entry.name;
      assert(!entry.isSymbolicLink(), 'artifact_symlink');
      if (entry.isDirectory()) await visit(path.join(dir, entry.name), name + '/');
      else {
        assert(entry.isFile() && expected.has(name), 'artifact_extra_file');
        assert(
          crypto
            .createHash('sha256')
            .update(await fs.readFile(path.join(dir, entry.name)))
            .digest('hex') === expected.get(name),
          'artifact_file_hash',
        );
        seen.add(name);
      }
    }
  }
  assert((await fs.realpath(ART)) === ART, 'artifact_path');
  await visit(ART);
  assert(seen.size === expected.size, 'artifact_missing_file');
  for (const entry of await fs.readdir(ARTIFACT_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('run-')) continue;
    let prior;
    try {
      prior = JSON.parse(
        await fs.readFile(path.join(ARTIFACT_ROOT, entry.name, 'proof.json'), 'utf8'),
      );
    } catch {
      throw new Error('previous_run_unreconciled');
    }
    assert(
      prior.cleanup?.reconciliationRequired === false && prior.cleanup?.profileRemoved === true,
      'previous_run_unreconciled',
    );
  }
  await fs.mkdir(ROOT, { mode: 0o700 });
  persistProof();
  require('/Users/armanisadeghi/code/matrx-frontend/node_modules/dotenv').config({
    path: '/Users/armanisadeghi/code/aidream/.env',
    quiet: true,
  });
  assert(
    process.env.AI_ADMIN_USERNAME === 'admin@admin.com' && process.env.AI_ADMIN_PASSWORD,
    'admin_configuration',
  );
  proof.checks.artifactRehashed = true;
}
async function reconcileCreates() {
  let result = { results: [] };
  for (let attempt = 0; attempt < 6; attempt++) {
    const { stdout } = await execFileAsync(
      '/Users/armanisadeghi/code/aidream/.venv/bin/python',
      [path.join(__dirname, 'reconcile-vault-canary.py'), userId, orgId, ...createKeys],
      { cwd: '/Users/armanisadeghi/code/aidream', timeout: 15000, maxBuffer: 32768 },
    );
    result = JSON.parse(stdout);
    assert(Array.isArray(result.results), 'receipt_shape');
    if (result.results.length === createKeys.size) break;
    await wait(1000);
  }
  const proven = [];
  const found = new Set();
  for (const row of result.results) {
    assert(
      createKeys.has(row.mutation_id) &&
        !found.has(row.mutation_id) &&
        !baselineIds.includes(row.result_item_id) &&
        row.user_id === userId &&
        row.organization_id === null,
      'receipt_scope',
    );
    found.add(row.mutation_id);
    proven.push(row.result_item_id);
  }
  for (const id of proven) if (!owned.includes(id)) owned.push(id);
  proof.ownedFixtureIds = [...owned];
  proof.cleanup.receiptReconciliation = found.size === createKeys.size;
  persistProof();
  return proven;
}
async function storage(area = 'local') {
  return sw.evaluate(async (a) => chrome.storage[a].get(null), area);
}
async function api(url, opts = {}) {
  const h = { ...(opts.headers || {}) };
  if (token) {
    h.Authorization = `Bearer ${token}`;
    if (orgId) h['X-Organization-Id'] = orgId;
  }
  const res = await fetch(url, { ...opts, headers: h });
  if (!res.ok) throw new Error(`http_${res.status}_${opts.label || 'request'}`);
  if (res.status === 204) return null;
  return res.json();
}
async function db(table, params) {
  const q = new URLSearchParams(params);
  return api(`${DB}/rest/v1/${table}?${q}`, {
    headers: { apikey: process.env.SUPABASE_MATRIX_PUBLISHABLE_KEY, 'Accept-Profile': 'users' },
    label: 'db_metadata',
  });
}
async function itemList() {
  const r = await api(`${API}/api/vault/items?principal_type=user`, { label: 'item_list' });
  assert(Array.isArray(r.items), 'item_list_shape');
  return r.items;
}
async function metadata(ids) {
  if (!ids.length) return [];
  return db('credential_items', {
    select:
      'id,user_id,organization_id,display_name,browser_fill_enabled,uri_match_mode,login_urls,deleted_at',
    id: `in.(${ids.join(',')})`,
  });
}
async function versions(ids) {
  if (!ids.length) return [];
  return db('user_secrets', {
    select: 'id,credential_item_id,field_key,value_version,is_active',
    credential_item_id: `in.(${ids.join(',')})`,
  });
}
async function create(name, username, password) {
  const key = crypto.randomUUID();
  createKeys.add(key);
  proof.ownedCreateMutationKeys = [...createKeys];
  persistProof();
  const item = await api(`${API}/api/vault/items`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({
      principal: { type: 'user' },
      display_name: name,
      definition_key: 'website_login',
      fields: [
        { field_key: 'username', value: username, handling: 'revealable' },
        { field_key: 'password', value: password, handling: 'revealable' },
      ],
      login_urls: [LOGIN],
      uri_match_mode: 'host',
      browser_fill_enabled: true,
    }),
    label: 'fixture_create',
  });
  assert(item && typeof item.id === 'string', 'create_shape');
  owned.push(item.id);
  proof.ownedFixtureIds = [...owned];
  return item.id;
}
async function matches() {
  return api(`${API}/api/vault/browser-login/matches`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ page_url: LOGIN, include_field_inventory: true }),
    label: 'matches',
  });
}
async function localWebsiteSignOut(p) {
  if (p && !p.isClosed()) {
    await p
      .goto('https://www.aimatrx.com/login', { waitUntil: 'domcontentloaded', timeout: 30000 })
      .catch(() => {});
    await p
      .evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      })
      .catch(() => {});
  }
  await ctx.clearCookies({ domain: /aimatrx\.com$/ });
}
async function doWebsiteLogin(p, stages) {
  markStage(stages.navigate);
  await p.goto(LOGIN, { waitUntil: 'domcontentloaded', timeout: 30000 });
  markStage(stages.formFill);
  await p.locator('#email').fill(process.env.AI_ADMIN_USERNAME);
  await p.locator('#password').fill(process.env.AI_ADMIN_PASSWORD);
  markStage(stages.submitWait);
  await Promise.all([
    p.waitForURL((u) => u.pathname != '/login', { timeout: 30000 }),
    p.getByRole('button', { name: 'Sign in', exact: true }).click(),
  ]);
}
async function promptBox(p, stage) {
  markStage(stage);
  const host = p.locator('#matrx-login-capture-host');
  await host.waitFor({ state: 'visible', timeout: 15000 });
  const box = await host.boundingBox();
  assert(box && box.width >= 300, 'capture_prompt_box');
  return { host, box };
}
(async () => {
  let mainError = null;
  markStage('artifact_verify');
  await verifyArtifact();
  try {
    markStage('browser_launch');
    await fs.mkdir(PROFILE);
    ctx = await chromium.launchPersistentContext(PROFILE, {
      executablePath: EXE,
      headless: true,
      args: [`--disable-extensions-except=${ART}`, `--load-extension=${ART}`],
    });
    markStage('extension_service_worker');
    sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker', { timeout: 15000 }));
    proof.extensionId = await sw.evaluate(() => chrome.runtime.id);
    assert(proof.extensionId === ID, 'extension_id');
    workerUrl = sw.url();
    assert(
      new URL(workerUrl).protocol === 'chrome-extension:' && new URL(workerUrl).host === ID,
      'worker_origin',
    );
    markStage('oauth_popup');
    popup = await ctx.newPage();
    await popup.goto(`chrome-extension://${ID}/popup.html`);
    const authP = ctx.waitForEvent('page', { timeout: 15000 });
    await popup.getByRole('button', { name: 'Sign in' }).click();
    const auth = await authP;
    await auth.waitForLoadState('domcontentloaded');
    assert(new URL(auth.url()).origin === 'https://www.aimatrx.com', 'oauth_origin');
    markStage('oauth_sign_in');
    await auth.locator('#email').fill(process.env.AI_ADMIN_USERNAME);
    await auth.locator('#password').fill(process.env.AI_ADMIN_PASSWORD);
    await auth.getByRole('button', { name: 'Sign in', exact: true }).click();
    markStage('oauth_consent');
    await auth.waitForURL(/\/oauth\/consent/, { timeout: 30000 });
    assert(new URL(auth.url()).origin === 'https://www.aimatrx.com', 'consent_origin');
    await auth
      .getByRole('button', { name: 'Authorize', exact: true })
      .click()
      .catch((e) => {
        if (!auth.isClosed()) throw e;
      });
    markStage('extension_session');
    let st;
    for (let i = 0; i < 60; i++) {
      st = await storage();
      if (st['matrx.user.profile']?.email) break;
      await wait(500);
    }
    assert(st?.['matrx.user.profile']?.email === 'admin@admin.com', 'extension_admin_identity');
    userId = st['matrx.user.profile'].id;
    token = st['matrx.auth.accessToken'];
    assert(typeof token === 'string' && token.length > 20, 'extension_token');
    proof.checks.adminIdentityVerified = true;
    // Explicit organization choice through the extension Settings UI.
    markStage('settings_workspace');
    const side = await ctx.newPage();
    await side.goto(`chrome-extension://${ID}/sidepanel.html`);
    await side.locator('button[title="Settings"]').click();
    const orgSection = side.getByRole('button', { name: 'Organization', exact: true }).first();
    await orgSection.click();
    await side
      .getByText('Acting as', { exact: true })
      .waitFor({ state: 'visible', timeout: 20000 });
    const combo = side
      .getByText('Acting as', { exact: true })
      .locator('xpath=ancestor::div[contains(@class,"min-h-9")][1]')
      .getByRole('combobox');
    await combo.click({ force: true });
    const orgOption = side.getByRole('option', { name: /admin's Workspace/i });
    await orgOption.waitFor({ state: 'visible', timeout: 10000 });
    await orgOption.focus();
    await side.keyboard.press('Enter');
    for (let i = 0; i < 30; i++) {
      st = await storage();
      if (st['matrx.org.active']?.name?.toLowerCase() === "admin's workspace") break;
      await wait(300);
    }
    assert(
      st['matrx.org.active']?.name?.toLowerCase() === "admin's workspace",
      'explicit_admin_workspace',
    );
    orgId = st['matrx.org.active'].id;
    proof.checks.adminWorkspaceExplicitlySelected = true;
    proof.adminWorkspaceId = orgId;
    markStage('identity_verify');
    const verifiedUser = await api(`${DB}/auth/v1/user`, {
      headers: { apikey: process.env.SUPABASE_MATRIX_PUBLISHABLE_KEY },
    });
    assert(
      verifiedUser.id === userId && verifiedUser.email === 'admin@admin.com',
      'fresh_admin_identity',
    );
    // OAuth tab was closed; prove no persisted OAuth-login candidate remains before fixture setup.
    const sess = await storage('session');
    const pending = sess['matrx.credentials.capture.pending.v1'];
    assert(!pending || Object.keys(pending).length === 0, 'oauth_candidate_not_cleared');
    proof.checks.oauthCandidateAbsentBeforeFixtures = true;
    markStage('baseline_snapshot');
    const before = await itemList();
    baselineIds = before.map((x) => x.id).sort();
    proof.checks.preexistingActiveCount = baselineIds.length;
    proof.baselineIds = baselineIds;
    persistProof();
    markStage('fixture_create_update');
    const updateId = await create(UPDATE_NAME, process.env.AI_ADMIN_USERNAME, STALE_PASSWORD);
    markStage('fixture_create_alternate');
    const altId = await create(ALT_NAME, ALT_USER, ALT_PASSWORD);
    markStage('fixture_metadata');
    let rows = await metadata([updateId, altId]);
    assert(
      rows.length === 2 &&
        rows.every(
          (r) =>
            r.user_id === userId &&
            r.organization_id === null &&
            r.browser_fill_enabled === true &&
            r.uri_match_mode === 'host' &&
            r.deleted_at === null,
        ),
      'fixture_metadata',
    );
    proof.checks.twoOwnedFixturesCreated = true;
    ctx.on('request', (req) => {
      if (
        !savePhase ||
        req.method() !== 'POST' ||
        req.url() !== `${API}/api/vault/items` ||
        req.serviceWorker()?.url() !== workerUrl
      )
        return;
      try {
        const key = req.headers()['idempotency-key'];
        assert(typeof key === 'string' && /^[0-9a-f-]{36}$/i.test(key), 'owned_save_key');
        createKeys.add(key);
        activeCreates.add(req);
        saveRequestObserved = true;
        proof.cleanup.reconciliationRequired = true;
        proof.ownedCreateMutationKeys = [...createKeys];
        persistProof();
        const body = req.postDataJSON();
        assert(
          body?.definition_key === 'website_login' &&
            body.fields?.some(
              (f) => f.field_key === 'username' && f.value === process.env.AI_ADMIN_USERNAME,
            ) &&
            body.fields?.some(
              (f) => f.field_key === 'password' && f.value === process.env.AI_ADMIN_PASSWORD,
            ),
          'owned_save_request_shape',
        );
      } catch {
        createTrackingError = true;
      }
    });
    ctx.on('requestfinished', (req) => activeCreates.delete(req));
    ctx.on('requestfailed', (req) => activeCreates.delete(req));
    // Real inline fill, no submit.
    markStage('inline_prepare');
    website = await ctx.newPage();
    await localWebsiteSignOut(website);
    await website.goto(LOGIN, { waitUntil: 'domcontentloaded' });
    assert((await website.locator('#password').count()) === 1, 'login_form');
    await website.locator('#password').focus();
    const ih = website.locator('#matrx-inline-login-suggestion');
    await ih.waitFor({ state: 'visible', timeout: 15000 });
    const ib = await ih.boundingBox();
    assert(ib, 'inline_host');
    const mm = await matches();
    assert(
      mm.matches.length === 2 && mm.matches.every((m) => owned.includes(m.item_id)),
      'only_owned_matches_before_inline',
    );
    const candidates = mm.matches.filter((m) => m.item_id === updateId || m.item_id === altId);
    assert(candidates.length === 2, 'inline_two_matches');
    const altIndex = mm.matches.findIndex((m) => m.item_id === altId);
    assert(altIndex >= 0, 'inline_alt_match');
    markStage('inline_choose');
    await website.keyboard.press('ArrowDown');
    const shadowFocused = await website.evaluate(
      () => document.activeElement?.id === 'matrx-inline-login-suggestion',
    );
    assert(shadowFocused, 'inline_keyboard_focus');
    for (let i = 0; i < altIndex; i++) await website.keyboard.press('ArrowDown');
    await website.keyboard.press('Enter');
    markStage('inline_verify');
    await website
      .waitForFunction(
        ({ u, p }) =>
          document.querySelector('#email')?.value === u &&
          document.querySelector('#password')?.value === p,
        { u: ALT_USER, p: ALT_PASSWORD },
        { timeout: 15000 },
      )
      .catch(() => {});
    const inlineState = await website.evaluate(
      ({ u, p }) => {
        const e = document.querySelector('#email'),
          q = document.querySelector('#password');
        return {
          emailMatches: e?.value === u,
          passwordMatches: q?.value === p,
          passwordNonEmpty: !!q?.value,
          passwordType: q?.type,
          hostPresent: !!document.querySelector('#matrx-inline-login-suggestion'),
        };
      },
      { u: ALT_USER, p: ALT_PASSWORD },
    );
    proof.inlineDebug = { altIndex, matchCount: mm.matches.length, ...inlineState };
    const inlineOk =
      inlineState.emailMatches &&
      inlineState.passwordMatches &&
      inlineState.passwordType === 'password';
    if (!inlineOk) {
      const tabId = await sw.evaluate(async () => {
        const xs = await chrome.tabs.query({ url: 'https://www.aimatrx.com/login*' });
        return xs[0]?.id ?? null;
      });
      if (tabId) {
        const d = await sw.evaluate(async (tabId) => {
          const [x] = await chrome.scripting.executeScript({
            target: { tabId },
            world: 'ISOLATED',
            func: async () =>
              chrome.runtime.sendMessage({
                __matrx: true,
                kind: 'credential-suggestions:query',
                payload: { fieldSelector: '#password' },
              }),
          });
          return x?.result ?? null;
        }, tabId);
        proof.inlineDebug.queryStatus = d?.status ?? null;
        proof.inlineDebug.queryMatchCount = Array.isArray(d?.matches) ? d.matches.length : null;
      }
    }
    assert(inlineOk, 'inline_values');
    assert(new URL(website.url()).pathname === '/login', 'inline_navigated');
    proof.checks.inlineChooserTwoFixtures = true;
    proof.checks.inlineSelectedAlternate = true;
    proof.checks.inlineFilledWithoutSubmit = true;
    await website.locator('#email').fill('');
    await website.locator('#password').fill('');
    // Update capture through the real page prompt.
    markStage('update_version_before');
    const vb = await versions([updateId, altId]);
    const beforeVersion = vb.find(
      (r) => r.credential_item_id === updateId && r.field_key === 'password' && r.is_active,
    )?.value_version;
    assert(Number.isInteger(beforeVersion), 'update_version_before');
    await doWebsiteLogin(website, {
      navigate: 'website_update_navigate',
      formFill: 'website_update_form_fill',
      submitWait: 'website_update_submit_wait',
    });
    let { host, box } = await promptBox(website, 'capture_prompt_update');
    const ordered = (await matches()).matches;
    assert(
      ordered.length === 2 && ordered.every((m) => owned.includes(m.item_id)),
      'only_owned_matches_before_update',
    );
    const updateIndex = ordered.findIndex((m) => m.item_id === updateId);
    assert(updateIndex >= 0 && updateIndex < 2, 'update_match_index');
    markStage('capture_update_select');
    await website.mouse.click(box.x + (updateIndex === 0 ? 58 : 180), box.y + 72);
    await host.waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
    await wait(600);
    markStage('capture_update_verify');
    const va = await versions([updateId, altId]);
    const afterVersion = va.find(
      (r) => r.credential_item_id === updateId && r.field_key === 'password' && r.is_active,
    )?.value_version;
    assert(afterVersion === beforeVersion + 1, 'update_version_advance');
    const afterUpdateIds = (await itemList()).map((x) => x.id);
    assert(afterUpdateIds.length === baselineIds.length + 2, 'update_created_item');
    proof.checks.capturePromptUpdateSelected = true;
    proof.checks.updateSameItemVersionAdvancedOnce = true;
    // Save-as-new through the real page prompt, strict one-ID delta.
    markStage('save_baseline');
    await localWebsiteSignOut(website);
    preSave = new Set((await itemList()).map((x) => x.id));
    proof.preSaveCount = preSave.size;
    proof.preSaveSetSha256 = crypto
      .createHash('sha256')
      .update(JSON.stringify([...preSave].sort()))
      .digest('hex');
    await doWebsiteLogin(website, {
      navigate: 'website_save_navigate',
      formFill: 'website_save_form_fill',
      submitWait: 'website_save_submit_wait',
    });
    ({ host, box } = await promptBox(website, 'capture_prompt_save'));
    savePhase = true;
    markStage('capture_save_select');
    await website.mouse.click(box.x + 50, box.y + 104);
    await host.waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
    await wait(800);
    markStage('capture_save_verify');
    const postSave = await itemList();
    const created = postSave.map((x) => x.id).filter((id) => !preSave.has(id));
    assert(saveRequestObserved && !createTrackingError, 'save_provenance_observed');
    assert(created.length === 1, 'save_strict_one_id_delta');
    const provenSave = await reconcileCreates();
    assert(provenSave.includes(created[0]), 'save_receipt_matches_delta');
    proof.ownedFixtureIds = [...owned];
    const savedRows = await metadata(created);
    assert(
      savedRows.length === 1 &&
        savedRows[0].user_id === userId &&
        savedRows[0].organization_id === null &&
        savedRows[0].browser_fill_enabled === true &&
        savedRows[0].deleted_at === null,
      'saved_item_metadata',
    );
    proof.checks.capturePromptSaveAsNewSelected = true;
    proof.checks.saveStrictOneIdDelta = true;
    // Bounded keyboard/Escape and stale navigation behavior; no plaintext materialization.
    markStage('inline_escape');
    await localWebsiteSignOut(website);
    await website.goto(LOGIN, { waitUntil: 'domcontentloaded' });
    await website.locator('#password').focus();
    await website
      .locator('#matrx-inline-login-suggestion')
      .waitFor({ state: 'visible', timeout: 10000 });
    const ib2 = await website.locator('#matrx-inline-login-suggestion').boundingBox();
    await website.mouse.click(ib2.x + 20, ib2.y + 15);
    await website.keyboard.press('Escape');
    await website
      .locator('#matrx-inline-login-suggestion')
      .waitFor({ state: 'detached', timeout: 3000 });
    proof.checks.inlineEscapeDismissed = true;
    // Escape returns focus to #password and dismisses the host. Calling focus
    // again therefore emits no focusin; move through #email to generate the
    // same trusted refocus interaction a person makes before requiring a new
    // offer from the product.
    markStage('inline_reopen');
    await website.locator('#email').focus();
    await website.locator('#password').focus();
    await website
      .locator('#matrx-inline-login-suggestion')
      .waitFor({ state: 'visible', timeout: 10000 });
    markStage('inline_reload');
    await website.reload({ waitUntil: 'domcontentloaded' });
    assert(
      (await website.locator('#matrx-inline-login-suggestion').count()) === 0,
      'stale_offer_survived_reload',
    );
    proof.checks.staleOfferClearedOnReload = true;
    markStage('complete');
    proof.openProof = [
      'deterministic service-worker suspension/recovery',
      'unsupported-form refusal matrix not exercised as actual UI',
    ];
  } catch (e) {
    mainError = e;
    proof.failureKind = 'canary_step_refused';
    proof.failureCode = String(e.message).match(/^[a-z0-9_]{1,80}$/)?.[0] ?? 'browser_step_failed';
    proof.diagnostics.errorClass = classifyFailure(e);
  } finally {
    for (let n = 0; n < 30 && activeCreates.size; n++) await wait(500);
    proof.cleanup.activeRequestsAtClose = activeCreates.size;
    try {
      if (ctx) await ctx.close();
      proof.cleanup.browserClosed = true;
    } catch {
      proof.cleanup.browserClosed = false;
    }
    try {
      if (token && orgId) {
        const proven = createKeys.size ? await reconcileCreates() : [];
        if (!createKeys.size) proof.cleanup.receiptReconciliation = true;
        for (const id of proven) {
          assert(!baselineIds.includes(id), 'cleanup_baseline_refusal');
          await api(`${API}/api/vault/items/${id}`, { method: 'DELETE', label: 'cleanup_delete' });
        }
        const retired = proven.length ? await metadata(proven) : [];
        proof.cleanup.softDeletedCount = retired.filter((r) => r.deleted_at !== null).length;
        proof.cleanup.ownedActiveCount = retired.filter((r) => r.deleted_at === null).length;
        const currentIds = (await itemList()).map((x) => x.id).sort();
        proof.cleanup.preexistingUntouched =
          JSON.stringify(currentIds) === JSON.stringify(baselineIds);
        proof.cleanup.createTrackingValid =
          !createTrackingError && (!savePhase || saveRequestObserved);
        const logout = await fetch(`${DB}/auth/v1/logout?scope=local`, {
          method: 'POST',
          headers: {
            apikey: process.env.SUPABASE_MATRIX_PUBLISHABLE_KEY,
            Authorization: `Bearer ${token}`,
          },
        });
        proof.cleanup.localLogoutStatus = logout.status;
      }
    } catch {
      proof.cleanup.failure = 'cleanup_refused';
    }
    if (
      proof.cleanup.browserClosed === true &&
      PROFILE.startsWith(ROOT + '/extend-live-profile-')
    ) {
      try {
        await fs.rm(PROFILE, { recursive: true, force: true });
      } catch {}
    }
    proof.cleanup.profileRemoved = !(await fs.stat(PROFILE).then(
      () => true,
      () => false,
    ));
    proof.finishedAt = new Date().toISOString();
    proof.cleanup.reconciliationRequired = !(
      proof.cleanup.receiptReconciliation === true &&
      proof.cleanup.ownedActiveCount === 0 &&
      proof.cleanup.softDeletedCount === owned.length &&
      proof.cleanup.preexistingUntouched === true &&
      proof.cleanup.createTrackingValid === true &&
      proof.cleanup.localLogoutStatus === 204 &&
      proof.cleanup.profileRemoved
    );
    proof.ok = !mainError && !proof.cleanup.reconciliationRequired;
    persistProof();
  }

  if (!proof.ok) {
    process.stderr.write(`Acceptance refused: ${proof.failureCode || 'cleanup'}\n`);
    process.exitCode = 1;
  } else
    process.stdout.write(
      'PASS: isolated Extend save/update/inline browser acceptance and exact cleanup\n',
    );
})().catch((e) => {
  process.stderr.write('Canary initialization refused; no acceptance claimed\n');
  process.exitCode = 1;
});
