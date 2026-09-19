/* Real browser acceptance for a declared extension artifact and production Vault
 * API. It starts a private localhost login page; all website secrets are random
 * process values and are intentionally absent from proof, logs, and screenshots. */
const fs = require('node:fs/promises');
const syncFs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
// The extension deliberately does not ship Playwright.  Use an explicit test
// runtime override or the documented workspace harness dependency.
const playwrightRequire = createRequire(
  process.env.MATRX_VAULT_CANARY_PLAYWRIGHT_PACKAGE || '/Users/armanisadeghi/code/matrx-frontend/package.json',
);
let chromium;
try {
  ({ chromium } = playwrightRequire('playwright'));
} catch {
  throw new Error('playwright_runtime_unavailable');
}
const execFileAsync = promisify(execFile);

const API = 'https://server.app.matrxserver.com';
const DB = 'https://db.matrxserver.com';
const REPO = path.resolve(__dirname, '../..');
const assert = (condition, code) => {
  if (!condition) throw new Error(code);
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const required = (key) => {
  const value = process.env[key];
  assert(typeof value === 'string' && value.length > 0, `missing_${key.toLowerCase()}`);
  return value;
};
if (process.env.MATRX_REALBROWSER_VAULT_CANARY !== 'RUN_UNDER_REVIEW')
  throw new Error('inert_canary_requires_explicit_arm');
const localCanonicalCleanupArmed = process.env.MATRX_VAULT_CANARY_LOCAL_CANONICAL_CLEANUP === 'RUN_LOCAL_CANONICAL_CLEANUP';
// This is deliberately a separate, explicitly armed mode.  It proves that a
// fresh extension can authenticate and establish its tenant context without
// making a Vault mutation; it is not a Save/Update acceptance result.
const readOnlyAdmissionMode = process.env.MATRX_VAULT_CANARY_ADMISSION === 'RUN_READ_ONLY_ADMISSION';
const LOCAL_CLEANUP_MAX_BASELINE_IDS = 64;
const LOCAL_CLEANUP_MAX_CREATED_IDS = 5;
const LOCAL_CLEANUP_INPUT_MAX_BYTES = 32768;
const AIDREAM_ENV_ROOT = '/Users/armanisadeghi/code/aidream';
const LOCAL_SOURCE_ROOT = process.env.MATRX_VAULT_CANARY_LOCAL_SOURCE_ROOT || AIDREAM_ENV_ROOT;
const LOCAL_ROUTER_RELATIVE = 'aidream/api/routers/vault.py';
const LOCAL_SERVICE_RELATIVE = 'aidream/services/user_secrets/vault.py';
if (localCanonicalCleanupArmed) {
  const routerHash = required('MATRX_VAULT_CANARY_LOCAL_ROUTER_SHA256');
  const serviceHash = required('MATRX_VAULT_CANARY_LOCAL_SERVICE_SHA256');
  assert(/^[a-f0-9]{64}$/.test(routerHash) && /^[a-f0-9]{64}$/.test(serviceHash), 'local_cleanup_hash_shape');
}

const runId = crypto.randomUUID();
const stateRoot = process.env.MATRX_VAULT_CANARY_STATE_ROOT || path.join(REPO, '.matrx', 'realbrowser-vault', 'canary-runs');
const REVIEWED_HISTORICAL_ADMISSION_ROOT = path.join(REPO, '.matrx', 'realbrowser-vault', 'readonly-admission');
const REVIEWED_HISTORICAL_ADMISSION_RUN = '3bef7a5b-c78e-497e-b936-f7f53a2e9ac1';
const REVIEWED_HISTORICAL_ADMISSION_SHA256 = 'd0c7c4b7b9c1de1b5af600e8678a5f2921e231d6346521f9f7d72e944e47cb42';
const root = path.join(stateRoot, runId);
const profile = path.join(root, 'owned-profile');
const proofPath = path.join(root, 'proof.json');
const proof = {
  schema: 3,
  runnerSha256: crypto.createHash('sha256').update(syncFs.readFileSync(__filename)).digest('hex'),
  scope: 'owned localhost real-extension Vault Save/Update acceptance',
  mode: readOnlyAdmissionMode ? 'read_only_admission' : 'full_acceptance',
  phase: 'artifact_admission',
  authenticationAttempted: false,
  runId,
  profileKind: 'new disposable owned profile',
  artifact: null,
  ownedCreateMutationKeys: [],
  ownedFixtureIds: [],
  checks: {},
  cleanup: {},
  vaultMutationRequests: 0,
  vaultItemPosts: {
    total: 0,
    withIdempotencyHeader: 0,
    missingIdempotencyHeader: 0,
    invalidIdempotencyHeader: 0,
  },
  ...(readOnlyAdmissionMode
    ? { admission: { mode: 'read_only', fixtureWrites: 0, noFixtureWrites: false } }
    : {}),
  openProof: [],
};
let context;
let worker;
let token;
let userId;
let organizationId;
let local;
let localUrl;
let website;
let sidepanel;
const createKeys = new Set();
const createdIds = new Set();
let baselineIds = new Set();

function persist() {
  syncFs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const temporary = `${proofPath}.tmp`;
  syncFs.writeFileSync(temporary, `${JSON.stringify(proof, null, 2)}\n`, { mode: 0o600 });
  syncFs.renameSync(temporary, proofPath);
}
function checkpoint(phase) {
  proof.phase = phase;
  persist();
}
async function refuseUnreconciledPriorRun() {
  const entries = await fs.readdir(stateRoot, { withFileTypes: true }).catch((error) =>
    error.code === 'ENOENT' ? [] : Promise.reject(error),
  );
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === runId) continue;
    const priorProofPath = path.join(stateRoot, entry.name, 'proof.json');
    const priorRaw = await fs.readFile(priorProofPath, 'utf8').catch(() => null);
    const prior = priorRaw ? JSON.parse(priorRaw) : null;
    const completedAcceptance = prior?.ok === true
      && prior.cleanup?.receiptReconciled === true
      && prior.cleanup?.createdItemsGone === true;
    // A read-only run is retryable when its cleanup records zero observed Vault mutation requests. That stays independent of an admission UI outcome.
    const vaultMutationFreeCleanup = prior?.schema === 3
      && prior?.mode === 'read_only_admission'
      && prior.cleanup?.vaultMutationFree === true
      && prior.vaultMutationRequests === 0
      && prior.vaultItemPosts?.total === 0
      && prior.ownedCreateMutationKeys?.length === 0
      && prior.ownedFixtureIds?.length === 0
      && (prior.cleanup?.localAuthLogoutStatus === 204 || prior.authenticationAttempted === false)
      && prior.cleanup?.browserClosed === true
      && prior.cleanup?.profileRemoved === true;
    // Exact reviewed reconciliation only. It neither edits nor promotes the
    // old proof: runner bc9c32dec3ace7d974163fa153d83a6ff51c8dcb differed only
    // by native-env loader c909455b77b16144ff463dc4ca314edfda0c2d50f4f7b2c149bf9610f861a7b2.
    // Independent review confirmed organization_not_selected before baseline
    // or fixtures and no Save/Update request; no other sidecar is accepted.
    const reviewedHistoricalException = stateRoot === REVIEWED_HISTORICAL_ADMISSION_ROOT
      && entry.name === REVIEWED_HISTORICAL_ADMISSION_RUN
      && priorProofPath === path.join(REVIEWED_HISTORICAL_ADMISSION_ROOT, REVIEWED_HISTORICAL_ADMISSION_RUN, 'proof.json')
      && priorRaw !== null
      && crypto.createHash('sha256').update(priorRaw).digest('hex') === REVIEWED_HISTORICAL_ADMISSION_SHA256;
    // Reproduced launch-only failure: default headless shell never loaded the
    // extension worker; no OAuth interaction was reachable. Preserve failure.
    const reviewedLaunchFailure = stateRoot === REVIEWED_HISTORICAL_ADMISSION_ROOT
      && entry.name === '96760964-bf3f-465a-9452-a566c98c8c00'
      && priorRaw !== null
      && crypto.createHash('sha256').update(priorRaw).digest('hex') === '9e4c99d7a5041aafcece85f3a6d8d3f176fcaab975ea6633cdd962c8b4a0e46b';
    // Cleanup is independent of the tested outcome: a failed journey may
    // retry after its receipt-backed cleanup has completed successfully.
    const completedMutationCleanup = prior?.schema === 3 && prior.mode === 'full_acceptance'
      && prior.cleanup?.receiptReconciled === true && prior.cleanup?.baselineUntouched === true
      && prior.cleanup?.createdItemsGone === true && prior.cleanup?.localAuthLogoutStatus === 204
      && prior.cleanup?.browserClosed === true && prior.cleanup?.profileRemoved === true;
    let reviewedRecovery = false;
    if (stateRoot === REVIEWED_HISTORICAL_ADMISSION_ROOT
      && entry.name === 'acd31810-d74b-450a-bf39-d85e830b872a'
      && priorRaw !== null
      && crypto.createHash('sha256').update(priorRaw).digest('hex') === '88bce524d50c182db12c1307c306ff99f516714f2ca87bdcd7de5095d9a07678') {
      const recoveryRaw = await fs.readFile(path.join(stateRoot, entry.name, 'recovery-1789807360922.json'), 'utf8').catch(() => null);
      if (recoveryRaw !== null && crypto.createHash('sha256').update(recoveryRaw).digest('hex') === '7f10f75e3d5e35214867874d050d53691db23208bf2dce68fd7bbe1ac4b17337') {
        const recovery = JSON.parse(recoveryRaw);
        const attempts = recovery.adapter?.attempts || [];
        const recoveredIds = new Set(attempts.map((attempt) => attempt.id));
        reviewedRecovery = prior.ok === false && recovery.ok === true
          && recovery.runId === prior.runId
          && recovery.originalProofSha256 === crypto.createHash('sha256').update(priorRaw).digest('hex')
          && recovery.adminVerified === true && recovery.baselineUnchangedBefore === true
          && recovery.baselineUnchangedAfter === true && recovery.createdItemsGone === true
          && recovery.logoutStatus === 204 && recovery.adapterProcess?.exitCode === 0
          && recovery.adapterProcess?.strictJson === true && recovery.adapter?.ok === true
          && recovery.adapter?.route === 'local_canonical_authmiddleware'
          && recovery.adapter?.receiptCount === 4 && attempts.length === 4 && recoveredIds.size === 4
          && prior.ownedFixtureIds?.length === 4 && prior.ownedFixtureIds.every((id) => recoveredIds.has(id))
          && attempts.every((attempt) => attempt.initialGetStatus === 404 && attempt.terminal === 'already_cleaned');
      }
    }
    assert(completedAcceptance || completedMutationCleanup || vaultMutationFreeCleanup || reviewedHistoricalException || reviewedLaunchFailure || reviewedRecovery, 'previous_run_unreconciled');
  }
}
async function sha256(file) {
  return crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
}
async function resolveLocalSourceRoot() {
  assert(path.isAbsolute(LOCAL_SOURCE_ROOT), 'local_source_root_must_be_absolute');
  const sourceRoot = await fs.realpath(LOCAL_SOURCE_ROOT).catch(() => null);
  assert(sourceRoot !== null && (await fs.stat(sourceRoot)).isDirectory(), 'local_source_root_refused');
  return sourceRoot;
}
function baselineMetadataSha256(entries) {
  const metadata = entries
    .map((entry) => ({
      id: entry.id,
      updated_at: entry.updated_at,
      fields: (entry.fields || [])
        .map((field) => ({ id: field.id, field_key: field.field_key, is_active: field.is_active, handling: field.handling }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return crypto.createHash('sha256').update(JSON.stringify(metadata)).digest('hex');
}
async function prewriteLocalCanonicalPreflight() {
  if (!localCanonicalCleanupArmed) return;
  assert(baselineIds.size <= LOCAL_CLEANUP_MAX_BASELINE_IDS, 'local_cleanup_baseline_capacity');
  const sourceRoot = await resolveLocalSourceRoot();
  const routerSource = path.join(sourceRoot, LOCAL_ROUTER_RELATIVE);
  const serviceSource = path.join(sourceRoot, LOCAL_SERVICE_RELATIVE);
  const routerHash = required('MATRX_VAULT_CANARY_LOCAL_ROUTER_SHA256');
  const serviceHash = required('MATRX_VAULT_CANARY_LOCAL_SERVICE_SHA256');
  assert((await sha256(routerSource)) === routerHash, 'local_cleanup_router_hash_mismatch');
  assert((await sha256(serviceSource)) === serviceHash, 'local_cleanup_service_hash_mismatch');
  const placeholderIds = Array.from({ length: LOCAL_CLEANUP_MAX_CREATED_IDS }, (_, index) =>
    `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  );
  const payload = JSON.stringify({
    token, userId, organizationId, createKeys: placeholderIds, baselineIds: [...baselineIds], provenIDs: placeholderIds,
    expectedRouterSha256: routerHash, expectedServiceSha256: serviceHash, sourceRoot,
  });
  assert(Buffer.byteLength(payload, 'utf8') < LOCAL_CLEANUP_INPUT_MAX_BYTES, 'local_cleanup_payload_capacity');
  proof.checks.localCanonicalCleanupPreflight = true;
}
async function verifyArtifact() {
  const manifestPath = required('MATRX_VAULT_CANARY_MANIFEST');
  assert(path.isAbsolute(manifestPath), 'artifact_manifest_must_be_absolute');
  const manifestReal = await fs.realpath(manifestPath);
  const artifactRoot = path.dirname(manifestReal);
  const manifest = JSON.parse(await fs.readFile(manifestReal, 'utf8'));
  assert(manifest.schema === 2 && manifest.extensionDirectory === 'extension', 'artifact_manifest_shape');
  assert(manifest.kind === required('MATRX_VAULT_CANARY_ARTIFACT_KIND'), 'artifact_kind_mismatch');
  assert(manifest.sourceCommit === required('MATRX_VAULT_CANARY_EXPECTED_COMMIT'), 'artifact_commit_mismatch');
  assert(Array.isArray(manifest.extensionFiles) && manifest.extensionFiles.length > 0, 'artifact_manifest_files');
  const extension = path.join(artifactRoot, manifest.extensionDirectory);
  assert(await fs.realpath(extension) === extension, 'artifact_path_refused');
  const expected = new Map(manifest.extensionFiles.map((entry) => [entry.path, entry.sha256]));
  const observed = new Set();
  async function walk(dir, relative = '') {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const next = path.join(dir, entry.name);
      const name = path.join(relative, entry.name);
      assert(!entry.isSymbolicLink(), 'artifact_symlink');
      if (entry.isDirectory()) await walk(next, name);
      else {
        assert(entry.isFile() && expected.has(name), 'artifact_extra_file');
        assert((await sha256(next)) === expected.get(name), 'artifact_file_hash');
        observed.add(name);
      }
    }
  }
  await walk(extension);
  assert(observed.size === expected.size, 'artifact_missing_file');
  const extensionManifest = JSON.parse(await fs.readFile(path.join(extension, 'manifest.json'), 'utf8'));
  assert(extensionManifest.manifest_version === 3, 'artifact_not_mv3');
  proof.artifact = {
    manifestSha256: await sha256(manifestReal),
    sourceCommit: manifest.sourceCommit,
    manifestVersion: manifest.manifestVersion,
    kind: manifest.kind,
    distributionProvenance: manifest.distributionProvenance,
    fileCount: observed.size,
  };
  return extension;
}
function startLocalSite() {
  const state = { submits: 0 };
  const server = http.createServer((request, response) => {
    if (request.url === '/submitted' && request.method === 'POST') {
      state.submits += 1;
      response.writeHead(204).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(`<!doctype html><html><body>
      <main><h1>Disposable login</h1><form id="login" method="post" action="/submitted">
      <label>Email <input id="email" name="email" autocomplete="username" type="email" required></label>
      <label>Password <input id="password" name="password" autocomplete="current-password" type="password" required></label>
      <button id="sign-in" type="submit">Sign in</button></form></main>
      <script>document.querySelector('#login').addEventListener('submit', async (event) => {
        event.preventDefault(); await fetch('/submitted', {method:'POST'}); document.body.dataset.submitted='yes';
      });</script></body></html>`);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, state, url: `http://127.0.0.1:${server.address().port}/login` }));
  });
}
async function storage(keys) {
  return worker.evaluate((names) => chrome.storage.local.get(names), keys);
}
async function hasPendingCapture() {
  return worker.evaluate(async () => {
    const value = (await chrome.storage.session.get('matrx.credentials.capture.pending.v1'))['matrx.credentials.capture.pending.v1'];
    return !!value && typeof value === 'object' && Object.keys(value).length > 0;
  });
}
function journalVaultMutationRequest(url, method, headers) {
  let parsed;
  try { parsed = new URL(url); } catch { return; }
  const isVaultMutation = parsed.origin === API
    && parsed.pathname.startsWith('/api/vault/')
    && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  const isItemCreate = method === 'POST' && parsed.origin === API && parsed.pathname === '/api/vault/items';
  if (!isVaultMutation && !isItemCreate) return;
  if (isVaultMutation) proof.vaultMutationRequests += 1;
  if (!isItemCreate) {
    persist();
    return;
  }
  const key = headers['idempotency-key'] ?? headers['Idempotency-Key'];
  proof.vaultItemPosts.total += 1;
  if (typeof key === 'string' && /^[0-9a-f-]{36}$/i.test(key)) {
    proof.vaultItemPosts.withIdempotencyHeader += 1;
    createKeys.add(key);
    proof.ownedCreateMutationKeys = [...createKeys];
  } else if (typeof key === 'string' && key.length > 0) {
    proof.vaultItemPosts.invalidIdempotencyHeader += 1;
  } else {
    proof.vaultItemPosts.missingIdempotencyHeader += 1;
  }
  persist();
}
async function api(url, options = {}) {
  const headers = { ...(options.headers || {}), Authorization: `Bearer ${token}` };
  if (organizationId) headers['X-Organization-Id'] = organizationId;
  // Node-side fixture calls do not pass through Playwright's browser request
  // observer, so they must share the same durable journal as extension calls.
  journalVaultMutationRequest(url, options.method || 'GET', headers);
  const response = await fetch(url, { ...options, headers });
  assert(response.ok, `http_${response.status}_${options.label || 'request'}`);
  return response.status === 204 ? null : response.json();
}
async function items() {
  const response = await api(`${API}/api/vault/items?principal_type=user`, { label: 'item_list' });
  assert(Array.isArray(response.items), 'item_list_shape');
  return response.items;
}
async function item(id) {
  const response = await api(`${API}/api/vault/items/${encodeURIComponent(id)}`, { label: 'item_get' });
  assert(response && response.id === id && Array.isArray(response.fields), 'item_shape');
  return response;
}
async function createFixture(displayName, fields) {
  const key = crypto.randomUUID();
  createKeys.add(key);
  proof.ownedCreateMutationKeys = [...createKeys];
  persist();
  const response = await api(`${API}/api/vault/items`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({
      principal: { type: 'user' }, display_name: displayName, definition_key: 'website_login',
      fields, login_urls: [localUrl], uri_match_mode: 'host', browser_fill_enabled: true,
    }),
    label: 'fixture_create',
  });
  assert(typeof response?.id === 'string', 'fixture_create_shape');
  createdIds.add(response.id);
  proof.ownedFixtureIds = [...createdIds];
  proof.ownedCreateMutationKeys = [...createKeys];
  persist();
  return response.id;
}
async function reconcile() {
  const python = '/Users/armanisadeghi/code/aidream/.venv/bin/python';
  const { stdout } = await execFileAsync(
    python,
    [path.join(__dirname, 'reconcile-vault-canary.py'), userId, organizationId, ...createKeys],
    { cwd: '/Users/armanisadeghi/code/aidream', timeout: 15000, maxBuffer: 32768 },
  );
  const result = JSON.parse(stdout);
  assert(Array.isArray(result.results), 'receipt_shape');
  assert(result.results.length === createKeys.size, 'receipt_incomplete');
  const ids = new Set(result.results.map((row) => row.result_item_id));
  assert(ids.size === createKeys.size, 'receipt_duplicate_item');
  for (const row of result.results)
    assert(row.user_id === userId && row.organization_id === null && !row.retired, 'receipt_scope');
  // A response may be lost after the server commits. Receipt truth, rather than
  // the client response, determines every cleanup target.
  for (const id of ids) {
    assert(!baselineIds.has(id), 'receipt_baseline_refusal');
    createdIds.add(id);
  }
  return ids;
}
async function localCanonicalCleanup(proven) {
  assert(localCanonicalCleanupArmed, 'local_cleanup_not_armed');
  const sourceRoot = await resolveLocalSourceRoot();
  const routerHash = required('MATRX_VAULT_CANARY_LOCAL_ROUTER_SHA256');
  const serviceHash = required('MATRX_VAULT_CANARY_LOCAL_SERVICE_SHA256');
  assert(/^[a-f0-9]{64}$/.test(routerHash) && /^[a-f0-9]{64}$/.test(serviceHash), 'local_cleanup_hash_shape');
  const python = '/Users/armanisadeghi/code/aidream/.venv/bin/python';
  const adapter = path.join(__dirname, 'cleanup-vault-canary.py');
  const input = JSON.stringify({
    token, userId, organizationId, createKeys: [...createKeys], baselineIds: [...baselineIds], provenIDs: [...proven],
    expectedRouterSha256: routerHash, expectedServiceSha256: serviceHash, sourceRoot,
  });
  assert(Buffer.byteLength(input, 'utf8') < LOCAL_CLEANUP_INPUT_MAX_BYTES, 'local_cleanup_payload_capacity');
  const result = await new Promise((resolve, reject) => {
    const child = spawn(python, [adapter], {
      cwd: sourceRoot, stdio: ['pipe', 'pipe', 'ignore'],
    });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > 32768) child.kill();
    });
    child.once('error', () => reject(new Error('local_cleanup_spawn_refused')));
    child.once('close', (code) => {
      let parsed;
      try { parsed = JSON.parse(stdout); } catch { return reject(new Error('local_cleanup_output_refused')); }
      if (code !== 0 || parsed?.ok !== true) return reject(new Error('local_cleanup_refused'));
      resolve(parsed);
    });
    child.stdin.once('error', () => reject(new Error('local_cleanup_stdin_refused')));
    child.stdin.end(input);
  });
  assert(Array.isArray(result.attempts), 'local_cleanup_attempts_refused');
  const attemptedIds = new Set(result.attempts.map((attempt) => attempt.id));
  assert(result.route === 'local_canonical_authmiddleware' && result.provenance === 'local_router_and_service_hash_pinned' && result.receiptCount === proven.size && result.attempts.length === proven.size && attemptedIds.size === proven.size && [...proven].every((id) => attemptedIds.has(id)) && result.attempts.every((attempt) => ['already_cleaned', 'deleted_and_missing'].includes(attempt.terminal)), 'local_cleanup_proof_refused');
  return result;
}
async function chooseAuthorizedOrganization(extensionId) {
  const settingsPage = await context.newPage();
  try {
    await settingsPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    // These are the actual sidepanel navigation and Settings controls. Do not
    // write matrx.org.active here: selection must traverse the UI and its
    // membership-verifying resolver.
    await settingsPage.getByTitle('Settings', { exact: true }).click();
    const organizationSection = settingsPage.getByRole('button', { name: 'Organization', exact: true });
    const actingAs = settingsPage.getByText('Acting as', { exact: true });
    if (!(await actingAs.isVisible())) await organizationSection.click();
    const organizationRow = actingAs.locator('xpath=../..');
    const selector = organizationRow.getByRole('combobox');
    await selector.click();
    const authorizedOption = settingsPage.getByRole('option', { name: 'AI Matrx', exact: true });
    assert(await authorizedOption.count() === 1, 'authorized_organization_option_missing_or_ambiguous');
    await authorizedOption.click();
    // The selection verifies membership asynchronously in this page. Keep its
    // realm alive until the canonical resolver has persisted the choice.
    await waitForActiveOrganization();
  } finally {
    await settingsPage.close();
  }
}
async function waitForActiveOrganization() {
  let active;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    active = (await storage(['matrx.org.active']))['matrx.org.active'];
    if (active?.name === 'AI Matrx' && typeof active.id === 'string' && active.id.length > 10) return active;
    await wait(500);
  }
  throw new Error('authorized_organization_not_persisted');
}
async function authenticate(extension) {
  assert(typeof process.loadEnvFile === 'function', 'node_env_loader_unavailable');
  process.loadEnvFile('/Users/armanisadeghi/code/aidream/.env');
  const adminEmail = required('AI_ADMIN_USERNAME');
  const adminPassword = required('AI_ADMIN_PASSWORD');
  assert(adminEmail === 'admin@admin.com', 'admin_identity_configuration');
  proof.phase = 'browser_launch';
  persist();
  context = await chromium.launchPersistentContext(profile, {
    headless: true,
    // Playwright's default headless shell does not load this extension.
    executablePath: process.env.MATRX_VAULT_CANARY_CHROME_EXECUTABLE || chromium.executablePath(),
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  proof.phase = 'extension_worker';
  persist();
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extensionId = await worker.evaluate(() => chrome.runtime.id);
  assert(typeof extensionId === 'string' && extensionId.length > 10, 'extension_runtime_identity');
  // Journal every item create attempt before OAuth starts. In particular, a
  // missing idempotency header is evidence, not a reason to omit the request.
  context.on('request', (request) => {
    journalVaultMutationRequest(request.url(), request.method(), request.headers());
  });
  // Persist the zeroed journal before OAuth so an interruption still shows
  // whether the run had admitted any Vault POST before authentication.
  persist();
  proof.phase = 'oauth_ui';
  persist();
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const authPage = await Promise.all([
    context.waitForEvent('page', { timeout: 15000 }),
    popup.getByRole('button', { name: 'Sign in' }).click(),
  ]).then(([page]) => page);
  await authPage.waitForURL((url) => url.origin === 'https://www.aimatrx.com', { timeout: 30000 });
  assert(new URL(authPage.url()).origin === 'https://www.aimatrx.com', 'oauth_origin');
  await authPage.locator('#email').fill(adminEmail);
  await authPage.locator('#password').fill(adminPassword);
  proof.authenticationAttempted = true;
  proof.phase = 'oauth_sign_in';
  persist();
  await authPage.getByRole('button', { name: 'Sign in', exact: true }).click();
  await authPage.waitForURL(/\/oauth\/consent/, { timeout: 30000 });
  await authPage.getByRole('button', { name: 'Authorize', exact: true }).click().catch((error) => {
    if (!authPage.isClosed()) throw error;
  });
  let session;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    session = await storage(['matrx.user.profile', 'matrx.auth.accessToken', 'matrx.org.active']);
    if (session['matrx.user.profile']?.email && session['matrx.auth.accessToken']) break;
    await wait(500);
  }
  assert(session?.['matrx.user.profile']?.email === adminEmail, 'extension_identity');
  userId = session['matrx.user.profile'].id;
  token = session['matrx.auth.accessToken'];
  assert(typeof token === 'string' && token.length > 20, 'extension_token');
  // This deliberately happens before reading or choosing an organization.
  // /auth/v1/user is independent token evidence and must remain so for a
  // fresh profile that has not selected its tenant yet.
  const identity = await api(`${DB}/auth/v1/user`, { headers: { apikey: process.env.SUPABASE_MATRIX_PUBLISHABLE_KEY }, label: 'identity' });
  assert(identity.id === userId && identity.email === adminEmail, 'independent_admin_identity');
  proof.checks.independentAdminIdentity = true;
  proof.identityProof = { extensionProfileEmail: adminEmail, independentUserIdMatchesProfile: true };
  proof.extensionId = extensionId;
  // Retain independent identity evidence even if organization selection fails.
  persist();
  let active = session['matrx.org.active'];
  if (!active?.id) {
    proof.phase = 'organization_selection';
    persist();
    await chooseAuthorizedOrganization(extensionId);
    active = await waitForActiveOrganization();
  }
  organizationId = active?.id;
  assert(active?.name === 'AI Matrx' && typeof organizationId === 'string' && organizationId.length > 10, 'organization_not_selected');
  proof.organizationProof = { label: 'AI Matrx', activeStorageObserved: true };
  // Both identity and organization evidence exist before the first fixture.
  persist();
  assert(!(await hasPendingCapture()), 'admin_password_pending_before_writes');
}
async function submitLogin(page, username, password) {
  await page.goto(localUrl, { waitUntil: 'domcontentloaded' });
  // The manifest loads the real bridge at document_idle. Observe readiness
  // in its isolated world before typing, without injecting a replacement.
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    ready = await worker.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs.find((entry) => entry.url === url);
      if (!tab?.id) return false;
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [0] },
        func: () => window.__matrx_bridge_mounted === true,
      });
      return results[0]?.result === true;
    }, localUrl);
    if (ready) break;
    await wait(100);
  }
  assert(ready, 'site_capture_bridge_not_ready');
  await page.locator('#email').fill(username);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}
async function prompt(page) {
  const host = page.locator('#matrx-login-capture-host');
  await host.waitFor({ state: 'visible', timeout: 15000 });
  return host;
}
async function pendingCard() {
  const card = sidepanel.getByText('Save this login to your Vault?', { exact: true });
  try {
    await card.waitFor({ state: 'visible', timeout: 15000 });
  } catch {
    proof.captureDiagnostics = { candidatePresent: await hasPendingCapture() };
    persist();
    throw new Error('pending_capture_card_not_visible');
  }
  return sidepanel;
}
async function materializedPassword(id) {
  const response = await api(`${API}/api/vault/browser-login/${encodeURIComponent(id)}/materialize`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ page_url: localUrl, tool_invocation_id: crypto.randomUUID(), client_build: 'vault-realbrowser-canary' }),
    label: 'materialize',
  });
  assert(typeof response?.password === 'string', 'materialize_shape');
  return response.password;
}

(async () => {
  let failure;
  let artifactAdmitted = false;
  try {
    await refuseUnreconciledPriorRun();
    const extension = await verifyArtifact();
    // An invalid/tampered artifact is rejected before a durable run record,
    // so a safe negative test cannot create a fictional cleanup obligation.
    artifactAdmitted = true;
    persist();
    await authenticate(extension);
    proof.phase = 'vault_baseline';
    persist();
    const baseline = await items();
    baselineIds = new Set(baseline.map((entry) => entry.id));
    proof.baselineMetadataSha256 = baselineMetadataSha256(baseline);
    await prewriteLocalCanonicalPreflight();
    if (readOnlyAdmissionMode) {
      proof.admission.baselineRead = true;
      proof.admission.prewriteLocalCanonicalPreflight = localCanonicalCleanupArmed;
      proof.admission.noFixtureWrites = proof.vaultMutationRequests === 0 && proof.vaultItemPosts.total === 0
        && createKeys.size === 0 && createdIds.size === 0;
      assert(proof.admission.noFixtureWrites, 'admission_fixture_write_refused');
      persist();
    } else {
      local = await startLocalSite();
      localUrl = local.url;
    const suffix = crypto.randomUUID().slice(0, 8);
    const username = `canary-${suffix}@example.invalid`;
    const oldPassword = `old-${crypto.randomUUID()}`;
    const newPassword = `new-${crypto.randomUUID()}`;
    const sealedFixtureValue = `mfa-${crypto.randomUUID()}`;
    const targetName = `Canary target ${suffix}`;
    checkpoint('fixture_creation');
    const targetId = await createFixture(targetName, [
      { field_key: 'username', value: username, handling: 'revealable' },
      { field_key: 'password', value: oldPassword, handling: 'revealable' },
      { field_key: 'totp_seed', value: sealedFixtureValue, handling: 'sealed' },
    ]);
    const otherIds = [await createFixture(`Canary duplicate ${suffix}`, [
      { field_key: 'username', value: username, handling: 'revealable' },
      { field_key: 'password', value: `other-${crypto.randomUUID()}`, handling: 'revealable' },
    ]), await createFixture(`Canary no username ${suffix}`, [
      { field_key: 'password', value: `missing-${crypto.randomUUID()}`, handling: 'revealable' },
    ]), await createFixture(`Canary alternate ${suffix}`, [
      { field_key: 'username', value: `alternate-${suffix}@example.invalid`, handling: 'revealable' },
      { field_key: 'password', value: `alternate-${crypto.randomUUID()}`, handling: 'revealable' },
    ])];
    const otherBefore = await Promise.all(otherIds.map(item));
    const targetBefore = await item(targetId);
    const sealedFieldBefore = targetBefore.fields.find((field) => field.field_key === 'totp_seed' && field.is_active);
    assert(sealedFieldBefore?.id, 'fixture_sealed_field_missing');
    checkpoint('open_vault');
    website = await context.newPage();
    sidepanel = await context.newPage();
    await sidepanel.goto(`chrome-extension://${proof.extensionId}/sidepanel.html`);
    await sidepanel.getByTitle('Vault', { exact: true }).click();
    await website.bringToFront();
    checkpoint('submit_login');
    await submitLogin(website, username, newPassword);
    assert((await website.locator('#matrx-login-capture-host').count()) === 0, 'quiet_default_overlay');
    checkpoint('await_capture');
    const updatePrompt = await pendingCard();
    assert((await updatePrompt.getByRole('button', { name: /^Update/ }).count()) >= 4, 'four_update_targets_not_reachable');
    assert((await website.locator('#matrx-login-capture-host').count()) === 0, 'quiet_delayed_overlay');
    checkpoint('filter_update_target');
    const search = updatePrompt.getByRole('textbox', { name: 'Search saved logins to update' });
    await search.fill(targetName);
    const targetButton = updatePrompt.getByRole('button', { name: new RegExp(`Update.*${targetName}`, 'i') });
    await targetButton.waitFor({ state: 'visible', timeout: 5000 });
    assert((await updatePrompt.getByRole('button', { name: /^Update/ }).count()) === 1, 'search_target_not_unique');
    const cardSurface = sidepanel.getByText('Save this login to your Vault?', { exact: true }).locator('xpath=../../..');
    const cardScreenshot = path.join(root, 'synthetic-update-choices.png');
    checkpoint('capture_screenshot');
    await cardSurface.screenshot({ path: cardScreenshot });
    proof.choiceScreenshot = { path: 'synthetic-update-choices.png', sha256: await sha256(cardScreenshot) };

    const submitsBeforeUpdateChoice = local.state.submits;
    checkpoint('update_decision');
    await targetButton.click();
    await updatePrompt.getByText('Save this login to your Vault?', { exact: true }).waitFor({ state: 'detached', timeout: 10000 });
    assert(local.state.submits === submitsBeforeUpdateChoice, 'update_choice_submitted_site');
    checkpoint('verify_update');
    const targetAfter = await item(targetId);
    const sealedFieldAfter = targetAfter.fields.find((field) => field.field_key === 'totp_seed' && field.is_active);
    assert(sealedFieldAfter?.id === sealedFieldBefore.id, 'sealed_field_not_preserved');
    assert((await materializedPassword(targetId)) === newPassword, 'selected_target_password_not_updated');
    const otherAfter = await Promise.all(otherIds.map(item));
    assert(JSON.stringify(otherAfter) === JSON.stringify(otherBefore), 'unselected_fixture_changed');
    proof.checks.fourUpdateTargetsReachable = true;
    proof.checks.displayNameSearchSelectedExactTarget = true;
    proof.checks.selectedTargetOnlyUpdated = true;
    proof.checks.unrelatedSealedFieldPreserved = true;
    proof.checks.updateChoiceDidNotSubmit = true;
    checkpoint('save_as_new');
    const beforeSave = new Set((await items()).map((entry) => entry.id));
    await submitLogin(website, `save-${suffix}@example.invalid`, `save-${crypto.randomUUID()}`);
    const savePrompt = await pendingCard();
    const submitsBeforeSaveChoice = local.state.submits;
    await savePrompt.getByRole('button', { name: 'Save as new', exact: true }).click();
    await savePrompt.getByText('Save this login to your Vault?', { exact: true }).waitFor({ state: 'detached', timeout: 10000 });
    assert(local.state.submits === submitsBeforeSaveChoice, 'save_choice_submitted_site');
    const afterSave = await items();
    const delta = afterSave.filter((entry) => !beforeSave.has(entry.id));
    assert(delta.length === 1, 'save_not_exactly_one_item');
    createdIds.add(delta[0].id);
    proof.ownedFixtureIds = [...createdIds];
    if (artifactAdmitted) persist();
    proof.checks.saveAsNewExactOne = true;
    proof.checks.saveChoiceDidNotSubmit = true;
    proof.openProof = ['canonical enrolled-MFA preservation is not exercised; the fixture only proves unrelated sealed-field preservation', 'lost-response retry is not exercised by this canary', 'browser restart and distributed-release acceptance are separate gates'];
    }
  } catch (error) {
    failure = error;
    proof.failurePhase = proof.phase;
    proof.failureType = /^[A-Za-z]+$/.test(error?.name || '') ? error.name : 'Error';
    proof.failureCode = String(error?.message || 'canary_failure').match(/^[a-z0-9_]{1,100}$/)?.[0] || 'canary_failure';
  } finally {
    try {
      if (website && !website.isClosed()) {
        await website.goto(localUrl, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
        await website.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }).catch(() => {});
        proof.cleanup.localWebsiteSignedOut = true;
      }
      if (token && organizationId && createKeys.size) {
        const proven = await reconcile();
        for (const id of proven) {
          assert(createdIds.has(id) && !baselineIds.has(id), 'cleanup_ownership_refused');
        }
        if (localCanonicalCleanupArmed) {
          const localCleanup = await localCanonicalCleanup(proven);
          proof.cleanup.localCanonical = {
            route: localCleanup.route,
            provenance: localCleanup.provenance,
            sourceSha256: localCleanup.sourceSha256,
            receiptCount: localCleanup.receiptCount,
            attempts: localCleanup.attempts,
          };
          proof.cleanup.receiptReconciled = proven.size === createdIds.size;
          const remaining = new Set((await items()).map((entry) => entry.id));
          const baselineAfter = await items();
          proof.cleanup.baselineUntouched = proof.baselineMetadataSha256 === baselineMetadataSha256(baselineAfter.filter((entry) => baselineIds.has(entry.id)));
          proof.cleanup.createdItemsGone = [...createdIds].every((id) => !remaining.has(id));
        } else {
          for (const id of proven)
            await api(`${API}/api/vault/items/${encodeURIComponent(id)}`, { method: 'DELETE', label: 'cleanup_delete' });
          const remaining = new Set((await items()).map((entry) => entry.id));
          proof.cleanup.receiptReconciled = proven.size === createdIds.size;
          const baselineAfter = await items();
          proof.cleanup.baselineUntouched = [...baselineIds].every((id) => remaining.has(id)) && proof.baselineMetadataSha256 === baselineMetadataSha256(baselineAfter.filter((entry) => baselineIds.has(entry.id)));
          proof.cleanup.createdItemsGone = [...createdIds].every((id) => !remaining.has(id));
        }
      }
    } catch {
      proof.cleanup.failure = 'cleanup_refused';
    }
    // Authentication cleanup is independent of mutation cleanup: even a run
    // that failed before its first write, or failed reconciliation, revokes its
    // own local auth session. Never let an item-cleanup exception skip this.
    if (token) {
      try {
        const logout = await fetch(`${DB}/auth/v1/logout?scope=local`, {
          method: 'POST', headers: { apikey: process.env.SUPABASE_MATRIX_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` },
        });
        proof.cleanup.localAuthLogoutStatus = logout.status;
      } catch {
        proof.cleanup.localAuthLogoutFailure = true;
      }
    }
    try { if (context) await context.close(); proof.cleanup.browserClosed = true; } catch { proof.cleanup.browserClosed = false; }
    try { if (local) await new Promise((resolve) => local.server.close(resolve)); } catch {}
    await fs.rm(profile, { recursive: true, force: true });
    proof.cleanup.profileRemoved = !(await fs.stat(profile).then(() => true, () => false));
    proof.cleanup.vaultMutationFree = proof.vaultMutationRequests === 0
      && proof.vaultItemPosts.total === 0
      && createKeys.size === 0
      && createdIds.size === 0
      && proof.cleanup.browserClosed === true;
    if (readOnlyAdmissionMode) {
      proof.admission.noFixtureWrites = proof.vaultMutationRequests === 0 && proof.vaultItemPosts.total === 0
        && createKeys.size === 0 && createdIds.size === 0;
      proof.admission.cleanup = {
        noVaultMutationRequests: proof.cleanup.vaultMutationFree,
        localAuthLogoutStatus: proof.cleanup.localAuthLogoutStatus,
        browserClosed: proof.cleanup.browserClosed,
        profileRemoved: proof.cleanup.profileRemoved,
      };
      proof.admission.ok = !failure && proof.admission.baselineRead === true
        && proof.admission.noFixtureWrites === true
        && proof.cleanup.vaultMutationFree === true
        && proof.cleanup.localAuthLogoutStatus === 204
        && proof.cleanup.browserClosed === true
        && proof.cleanup.profileRemoved === true;
      // `ok` remains reserved for a full Save/Update acceptance proof.
      proof.ok = false;
    } else {
      proof.ok = !failure && proof.cleanup.receiptReconciled && proof.cleanup.baselineUntouched && proof.cleanup.createdItemsGone && proof.cleanup.profileRemoved && proof.cleanup.localAuthLogoutStatus === 204 && proof.cleanup.browserClosed === true;
    }
    const succeeded = readOnlyAdmissionMode ? proof.admission.ok : proof.ok;
    // Persist outside the disposable profile only as a value-free, caller-chosen path.
    persist();
    if (process.env.MATRX_VAULT_CANARY_PROOF) await fs.writeFile(process.env.MATRX_VAULT_CANARY_PROOF, `${JSON.stringify(proof, null, 2)}\n`, { mode: 0o600 });
    if (!succeeded) process.stderr.write(`Acceptance refused: ${proof.failureCode || 'cleanup'}\n`);
    else if (readOnlyAdmissionMode) process.stdout.write('PASS: read-only extension Vault admission and mutation-free Vault cleanup\n');
    else process.stdout.write('PASS: real extension Vault Save/Update acceptance and receipt-backed cleanup\n');
  }
  if (!(readOnlyAdmissionMode ? proof.admission?.ok : proof.ok)) process.exitCode = 1;
})();
