import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createFirefoxSidebarAdapter, EXPECTED_RUNTIME } from './adapter.mjs';
import { acquireVaultAcceptanceLease } from '../vault-acceptance-lease.cjs';

const execFileAsync = promisify(execFile);
const harnessPath = fileURLToPath(import.meta.url);
const root = fileURLToPath(new URL('../../../.matrx/task1-active/firefox-sidebar-probe/authenticated-harness/', import.meta.url));
const adapterSourcePath = fileURLToPath(new URL('./adapter.mjs', import.meta.url));
const leaseSourcePath = fileURLToPath(new URL('../vault-acceptance-lease.cjs', import.meta.url));
const generatorMode = process.argv.includes('--generator');
const generatorSourcePath = fileURLToPath(new URL('./generator-acceptance.mjs', import.meta.url));
const captureMode = process.argv.includes('--capture');
const captureSourcePath = fileURLToPath(new URL('./capture-decisions.mjs', import.meta.url));
const reconciliationMode = process.argv.includes('--reconcile-chrome');
assert.ok([captureMode, generatorMode, reconciliationMode].filter(Boolean).length <= 1, 'one_firefox_journey_per_run');
const FAILED_CHROME_RUN = 'b208d813-9a59-4d87-b437-772ee05eb3b7';
const FAILED_CHROME_PROOF_SHA256 = '317bbc4724038577ec023b5ea797b559d9c91fb9cb4e4210f1a0768d1ec90d86';
const CLEAN_BASELINE_SHA256 = '0b18f97a9727116b746ea4bc4432fcbd6bb1821f5449b0a219062e69b2726bab';
const failedChromeProofPath = fileURLToPath(new URL('../../../.matrx/realbrowser-vault/save-update-headless/' + FAILED_CHROME_RUN + '/proof.json', import.meta.url));
async function verifiedFailedChromeProof() {
  const raw = await readFile(failedChromeProofPath);
  assert.equal(shaText(raw), FAILED_CHROME_PROOF_SHA256, 'historical_chrome_proof_changed');
  const value = JSON.parse(raw);
  assert.equal(value.runId, FAILED_CHROME_RUN, 'historical_chrome_run_mismatch');
  assert.equal(value.ok, false, 'historical_chrome_failure_required');
  assert.equal(value.failureCode, 'preferences_quiet_fill_feedback_timeout', 'historical_chrome_failure_mismatch');
  const ids = value.ownedFixtureIds;
  assert.ok(Array.isArray(ids) && ids.length === 4 && new Set(ids).size === 4 && ids.every(id => typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id)), 'historical_chrome_fixture_ids_invalid');
  assert.ok(value.cleanup.receiptReconciled && value.cleanup.createdItemsGone && value.cleanup.profileRemoved && value.cleanup.browserClosed && value.cleanup.localAuthLogoutStatus === 204 && value.cleanup.remoteAuthRevocationStatus === 204, 'historical_chrome_owned_cleanup_missing');
  return ids;
}
const SOURCE_COMMIT = 'd648df949883c6c678d227021a3ab58558c128bf';
const RECORDS_SOURCE_COMMIT = 'c3f26c9e47f1a0ef18167592ebbdf032e45f9f67';
const ADDON_ID = 'matrx-extend@aimatrx.com';
const API = 'https://server.app.matrxserver.com';
const DB = 'https://db.matrxserver.com';
const AUTH_ORIGIN = 'https://www.aimatrx.com';
const firefox = '/Users/armanisadeghi/Library/Caches/matrx-vault-test/firefox-156.0/Firefox.app/Contents/MacOS/firefox';
const geckodriver = '/Users/armanisadeghi/Library/Caches/matrx-vault-test/firefox-156.0/geckodriver';
const artifactDirectory = join(root, '..', '..', 'firefox-current-build', 'artifact-2026-09-20T23-04-48-275Z-c17239a1-9515-43a6-8360-c20cdf2d0bb7');
const artifactRoot = join(artifactDirectory, 'extension');
const artifactManifestPath = join(artifactDirectory, 'artifact-manifest.json');
const xpi = join(artifactDirectory, 'matrx-extend-firefox-mv3.xpi');

// The independent review pins the exact harness bundle through the launch environment.
// Any driver or adapter change invalidates admission before credentials or launch.
const LAUNCH_ENV = 'MATRX_FIREFOX_READONLY_AUTH_ACCEPTANCE';
const HASH_ENV = 'MATRX_FIREFOX_REVIEWED_HARNESS_SHA256';
async function reviewedHarnessHash() {
  return shaText(JSON.stringify(await Promise.all([harnessPath, adapterSourcePath, leaseSourcePath, ...(generatorMode ? [generatorSourcePath] : []), ...(captureMode ? [captureSourcePath] : [])].map(shaFile))));
}

function shaText(value) { return createHash('sha256').update(value).digest('hex'); }
async function shaFile(path) { return shaText(await readFile(path)); }
async function exists(path) {
  try { await lstat(path); return true; }
  catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function safeErrorCode(error) {
  const value = String(error?.message || 'firefox_readonly_acceptance_failed').split('\n', 1)[0];
  return /^[a-z0-9_]{1,120}$/.test(value) ? value : 'firefox_readonly_acceptance_failed';
}
function baselineMetadataSha256(entries) {
  const metadata = entries.map(entry => ({
    id: entry.id,
    updated_at: entry.updated_at,
    fields: (entry.fields || []).map(field => ({
      id: field.id,
      field_key: field.field_key,
      is_active: field.is_active,
      handling: field.handling,
    })).sort((a, b) => a.id.localeCompare(b.id)),
  })).sort((a, b) => a.id.localeCompare(b.id));
  return shaText(JSON.stringify(metadata));
}
async function openPort() {
  const { createServer } = await import('node:http');
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string', 'driver_port_missing');
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}
async function request(base, method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    signal: AbortSignal.timeout(35_000),
    ...(body !== undefined && { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.value?.error) {
    const kind = String(data.value?.error ?? response.status).replace(/[^a-z0-9]+/gi, '_').toLowerCase();
    throw new Error(`webdriver_${kind}`);
  }
  return data.value;
}
const wdPost = (base, path, body) => request(base, 'POST', path, body);
const wdGet = (base, path) => request(base, 'GET', path);
const wdDelete = (base, path) => request(base, 'DELETE', path);
async function waitForDriver(base, driver) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (driver.exitCode !== null) throw new Error('geckodriver_exited_before_ready');
    try { if ((await fetch(`${base}/status`, { signal: AbortSignal.timeout(500) })).ok) return; } catch {}
    await delay(100);
  }
  throw new Error('geckodriver_ready_timeout');
}
async function pidsContaining(fragment) {
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,command=']);
  return stdout.split('\n').flatMap(line => {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    return match && match[2].includes(fragment) ? [Number(match[1])] : [];
  });
}
async function pidGone(pid) {
  try { process.kill(pid, 0); return false; }
  catch (error) { if (error?.code === 'ESRCH') return true; throw error; }
}
async function waitForPidsGone(pids) {
  const deadline = Date.now() + 15_000;
  while (true) {
    if ((await Promise.all([...pids].map(pidGone))).every(Boolean)) return true;
    if (Date.now() >= deadline) return false;
    await delay(100);
  }
}
async function terminateCurrentOwnedPids(pids) {
  if (pids.length === 0) return;
  for (const pid of pids) {
    try { process.kill(pid, 'SIGTERM'); }
    catch (error) { if (error?.code !== 'ESRCH') throw error; }
  }
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && !(await Promise.all(pids.map(pidGone))).every(Boolean)) await delay(100);
  for (const pid of pids) {
    if (await pidGone(pid)) continue;
    try { process.kill(pid, 'SIGKILL'); }
    catch (error) { if (error?.code !== 'ESRCH') throw error; }
  }
  await waitForPidsGone(pids);
}
async function waitUntil(operation, code, timeoutMs = 30_000, pollMs = 100) {
  const deadline = Date.now() + timeoutMs;
  let value;
  do {
    value = await operation();
    if (value) return value;
    await delay(Math.min(pollMs, Math.max(1, deadline - Date.now())));
  } while (Date.now() < deadline);
  throw new Error(code);
}
async function verifyArtifact() {
  const manifest = JSON.parse(await readFile(artifactManifestPath, 'utf8'));
  assert.equal(manifest.sourceCommit, SOURCE_COMMIT, 'artifact_source_commit_mismatch');
  assert.equal(manifest.schema, 2, 'artifact_schema_mismatch');
  assert.equal(manifest.kind, 'local-multi-repo-source-artifact', 'artifact_kind_mismatch');
  assert.equal(manifest.aidream.sourceCommit, RECORDS_SOURCE_COMMIT, 'artifact_records_source_mismatch');
  assert.equal(manifest.aidream.sourcePath, 'apps/shared/records', 'artifact_records_path_mismatch');
  assert.equal(manifest.extensionDirectory, 'extension', 'artifact_root_mismatch');
  assert.equal(manifest.manifestVersion, 3, 'artifact_manifest_version_mismatch');
  assert.equal(manifest.addonId, ADDON_ID, 'artifact_addon_id_mismatch');
  assert.ok(Array.isArray(manifest.extensionFiles) && manifest.extensionFiles.length > 10, 'artifact_manifest_empty');
  const seen = new Set();
  for (const entry of manifest.extensionFiles) {
    assert.equal(typeof entry.path, 'string');
    assert(!entry.path.startsWith('/') && !entry.path.includes('..'), 'artifact_manifest_path_invalid');
    assert(!seen.has(entry.path), 'artifact_manifest_duplicate');
    seen.add(entry.path);
    assert.equal(await shaFile(join(artifactRoot, entry.path)), entry.sha256, 'artifact_file_hash_mismatch');
  }
  assert.equal(manifest.xpi.path, 'matrx-extend-firefox-mv3.xpi', 'artifact_xpi_path_mismatch');
  assert.equal(await shaFile(xpi), manifest.xpi.sha256, 'artifact_xpi_hash_mismatch');
  return manifest;
}

if (process.argv.includes('--dry-run')) {
  const manifest = await verifyArtifact();
  if (reconciliationMode) await verifiedFailedChromeProof();
  assert.equal(process.env[HASH_ENV], undefined, 'dry_run_refuses_review_hash');
  assert.equal(process.env[LAUNCH_ENV], undefined, 'dry_run_refuses_launch_env');
  console.log(JSON.stringify({
    ok: true,
    mode: 'dry_refusal',
    sourceCommit: manifest.sourceCommit,
    artifactVerified: true,
    harnessSha256: await reviewedHarnessHash(),
    credentialGateArmed: false,
    credentialsRead: false,
    browserLaunched: false,
  }));
  process.exit(0);
}

assert.equal(process.env[LAUNCH_ENV], 'RUN_REVIEWED_ACCEPTANCE', 'launch_not_reviewed_unarmed');
assert.equal(process.env[HASH_ENV], await reviewedHarnessHash(), 'reviewed_harness_hash_mismatch');
delete process.env[LAUNCH_ENV];
delete process.env[HASH_ENV];

const artifactManifest = await verifyArtifact();
const historicalFixtureIds = reconciliationMode ? await verifiedFailedChromeProof() : [];
const runId = randomUUID();
const runRoot = join(root, 'auth-runs', runId);
const proofPath = join(runRoot, 'proof.json');
await mkdir(runRoot, { recursive: true, mode: 0o700 });
const proof = {
  schema: 1,
  runId,
  mode: reconciliationMode ? 'firefox_readonly_chrome_reconciliation' : generatorMode ? 'firefox_generator_auth_vault' : captureMode ? 'firefox_capture_decisions' : 'firefox_readonly_auth_vault',
  sourceCommit: SOURCE_COMMIT,
  credentialsRead: false,
  authenticationAttempted: false,
  nativeOsInputUsed: false,
  storedSessionSeeded: false,
  vaultMutationRequests: 0,
  runtimeAttested: false,
  freshProfileAuthStorageEmpty: false,
  popupSignInTrusted: false,
  oauthExpectedOrigin: false,
  oauthConsentAuthorized: false,
  independentAdminIdentity: false,
  organizationSelectedByUiOrSingleMembership: false,
  nativeSidebarOpenedByPopupGesture: false,
  nativeVaultVisible: false,
  baselineReconciled: false,
  localExtensionSignedOut: false,
  remoteSessionRevoked: false,
  networkObserverDisposed: false,
  addonUninstalled: false,
  sessionDeleted: false,
  driverExited: false,
  firefoxExited: false,
  profileRemoved: false,
  allOwnedPidsGone: false,
  ownedProfilePath: null,
  driverPid: null,
  ok: false,
};
const persist = () => writeFile(proofPath, `${JSON.stringify(proof, null, 2)}\n`, { mode: 0o600 });
const checkpoint = async phase => { proof.phase = phase; await persist(); };
const cleanupCheckpoint = async phase => {
  proof.cleanupPhase = phase;
  try { await persist(); } catch { proof.persistenceFailureDuringCleanup = true; }
};
proof.hashes = {
  driverSha256: await shaFile(harnessPath), adapterSha256: await shaFile(adapterSourcePath),
  leaseSha256: await shaFile(leaseSourcePath),
  ...(generatorMode ? { generatorSha256: await shaFile(generatorSourcePath) } : {}),
  ...(captureMode ? { captureSha256: await shaFile(captureSourcePath) } : {}),
  artifactManifestSha256: await shaFile(artifactManifestPath), artifactXpiSha256: artifactManifest.xpi.sha256,
};
proof.artifactManifestPath = artifactManifestPath;
await checkpoint('admitted_before_credentials');

let acceptanceLease;
let adminEmail, adminPassword, publishableKey, base, driver;
const ownedPids = new Set();
let sessionId;
let profile;
let addonInstalled = false;
let observerStarted = false;
let adapter;
let storageHandle;
let token;
let organizationId;
let organizationSelectedByTrustedUi = false;
let baselineIds;
let baselineHash;
let signOutStartSequence;
let failure;

const getContext = async context => {
  assert.equal(await wdPost(base, `/session/${sessionId}/moz/context`, { context }), null);
};
const executeContentAsync = (script, args = []) => wdPost(base, `/session/${sessionId}/execute/async`, { script, args });
const getStorage = async keys => {
  assert.ok(storageHandle, 'storage_tab_handle_missing');
  await wdPost(base, `/session/${sessionId}/window`, { handle: storageHandle });
  await getContext('content');
  return executeContentAsync(`
    const done = arguments[arguments.length - 1];
    const keys = arguments[0];
    const storage = globalThis.browser?.storage ?? globalThis.chrome?.storage;
    storage.local.get(keys).then(done, () => done(null));`, [keys]);
};
const readOwnedNetworkObserver = async () => {
  assert.ok(adapter, 'network_observer_adapter_missing');
  await getContext('chrome');
  return adapter.readNetworkObserver();
};
const disposeOwnedNetworkObserver = async () => {
  assert.ok(adapter, 'network_observer_adapter_missing');
  await getContext('chrome');
  return adapter.disposeNetworkObserver();
};
const latestSequence = observed => observed.events.reduce(
  (maximum, event) => Math.max(maximum, event.sequence || 0),
  0,
);
const addonLogoutAfter = (observed, startSequence) => {
  const requests = observed.events.filter(event => event.sequence > startSequence
    && event.phase === 'request' && event.owner === 'addon_principal'
    && event.origin === DB && event.pathname === '/auth/v1/logout' && event.method === 'POST');
  const matched = requests.map(request => ({
    request,
    response: observed.events.find(event => event.sequence > request.sequence
      && event.phase === 'response' && event.owner === 'addon_principal'
      && event.requestId === request.requestId && event.origin === DB
      && event.pathname === '/auth/v1/logout' && event.method === 'POST'),
  })).find(entry => entry.response?.status === 204);
  return {
    requestObserved: requests.length > 0,
    response204Observed: !!matched,
    ...(matched && { requestSequence: matched.request.sequence, responseSequence: matched.response.sequence }),
  };
};
const recordObservedNetwork = observed => {
  const vaultEvents = observed.events.filter(event => event.origin === API && event.pathname.startsWith('/api/vault/'));
  const mutationEvents = vaultEvents.filter(event => ['PUT', 'PATCH', 'DELETE'].includes(event.method)
    || (event.method === 'POST' && !['/api/vault/browser-login/matches', '/api/vault/browser-login/capture-context'].includes(event.pathname)));
  proof.vaultMutationRequests = mutationEvents.filter(event => event.phase === 'request').length;
  proof.networkObserver = {
    captureContract: observed.captureContract,
    ownerScope: observed.ownerScope,
    eventCount: observed.events.length,
    vaultEventCount: vaultEvents.length,
    dropped: observed.dropped,
    observerErrors: observed.observerErrors,
  };
};
const findExactButton = async label => {
  const elements = await wdPost(base, `/session/${sessionId}/elements`, { using: 'css selector', value: 'button' });
  const matches = [];
  for (const entry of elements) {
    const id = entry['element-6066-11e4-a52e-4f735466cecf'];
    const text = await wdGet(base, `/session/${sessionId}/element/${encodeURIComponent(id)}/property/textContent`);
    if (String(text).trim() === label) matches.push(id);
  }
  assert.ok(matches.length <= 1, 'button_label_ambiguous');
  return matches[0] ?? null;
};
const clickExactButton = async label => {
  const id = await waitUntil(() => findExactButton(label), 'button_label_not_ready', 15000);
  return wdPost(base, `/session/${sessionId}/element/${encodeURIComponent(id)}/click`, {});
};
const fillSelector = async (selector, text) => {
  const entry = await wdPost(base, `/session/${sessionId}/element`, { using: 'css selector', value: selector });
  const id = entry['element-6066-11e4-a52e-4f735466cecf'];
  assert.ok(id, 'webdriver_field_missing');
  await wdPost(base, `/session/${sessionId}/element/${encodeURIComponent(id)}/clear`, {});
  await wdPost(base, `/session/${sessionId}/element/${encodeURIComponent(id)}/value`, { text, value: [...text] });
};
const api = async (url, options = {}) => {
  const parsed = new URL(url);
  const method = String(options.method || 'GET').toUpperCase();
  if (parsed.origin === API && parsed.pathname.startsWith('/api/vault/'))
    assert.equal(method, 'GET', 'node_vault_write_refused');
  const headers = { ...(options.headers || {}), Authorization: `Bearer ${token}` };
  if (organizationId) headers['X-Organization-Id'] = organizationId;
  const response = await fetch(url, { ...options, headers, signal: AbortSignal.timeout(30_000) });
  assert.ok(response.ok, `http_${response.status}_${options.label || 'request'}`);
  return response.status === 204 ? null : response.json();
};
const items = async () => {
  const response = await api(`${API}/api/vault/items?principal_type=user`, { label: 'item_list' });
  assert.ok(Array.isArray(response.items), 'item_list_shape');
  return response.items;
};

try {
  acceptanceLease = await acquireVaultAcceptanceLease({ runId, kind: 'firefox' });
  proof.acceptanceLeaseAcquired = true;
  assert(typeof process.loadEnvFile === 'function', 'node_env_loader_unavailable');
  process.loadEnvFile('/Users/armanisadeghi/code/aidream/.env');
  adminEmail = process.env.AI_ADMIN_USERNAME;
  adminPassword = process.env.AI_ADMIN_PASSWORD;
  publishableKey = process.env.SUPABASE_MATRIX_PUBLISHABLE_KEY;
  assert.equal(adminEmail, 'admin@admin.com', 'admin_identity_configuration');
  assert.ok(typeof adminPassword === 'string' && adminPassword.length > 0, 'admin_password_missing');
  assert.ok(typeof publishableKey === 'string' && publishableKey.length > 20, 'publishable_key_missing');
  proof.credentialsRead = true;
  await checkpoint('credentials_loaded');

  const port = await openPort();
  base = `http://127.0.0.1:${port}`;
  driver = spawn(geckodriver, ['--allow-system-access', '--port', String(port)], { stdio: 'ignore' });
  await new Promise((resolve, reject) => {
    driver.once('spawn', resolve);
    driver.once('error', () => reject(new Error('geckodriver_spawn_failed')));
  });
  ownedPids.add(driver.pid);
  proof.driverPid = driver.pid;
  await checkpoint('driver_spawned');
  await checkpoint('session_create');
  await waitForDriver(base, driver);
  const created = await wdPost(base, '/session', { capabilities: { alwaysMatch: {
    browserName: 'firefox',
    'moz:firefoxOptions': { binary: firefox, args: ['-headless'] },
  } } });
  sessionId = created.sessionId;
  profile = created.capabilities?.['moz:profile'];
  assert.ok(typeof profile === 'string' && profile.length > 10, 'owned_profile_missing');
  proof.ownedProfilePath = profile;
  proof.sessionCreated = true;
  await checkpoint('owned_profile_created');
  assert.equal(created.capabilities?.browserVersion, EXPECTED_RUNTIME.firefoxVersion, 'webdriver_firefox_version_mismatch');
  for (const pid of await pidsContaining(profile)) ownedPids.add(pid);
  await getContext('chrome');
  const executeChromeSync = (script, args = []) => wdPost(base, `/session/${sessionId}/execute/sync`, { script, args });
  const executeChromeAsync = (script, args = []) => wdPost(base, `/session/${sessionId}/execute/async`, { script, args });
  const performKeyboardActions = async keys => {
    assert.ok(keys.length === 1 && ['\uE011', '\uE015', '\uE007'].includes(keys[0]), 'keyboard_action_sequence_not_reviewed');
    try {
      await wdPost(base, `/session/${sessionId}/actions`, { actions: [{ type: 'key', id: 'matrx-keyboard',
        actions: keys.flatMap(value => [{ type: 'keyDown', value }, { type: 'keyUp', value }]) }] });
    } finally { await wdDelete(base, `/session/${sessionId}/actions`); }
  };
  adapter = createFirefoxSidebarAdapter({ executeChromeSync, executeChromeAsync, performKeyboardActions, addonId: ADDON_ID });
  const [applicationIni, driverVersion] = await Promise.all([
    readFile('/Users/armanisadeghi/Library/Caches/matrx-vault-test/firefox-156.0/Firefox.app/Contents/Resources/application.ini', 'utf8'),
    execFileAsync(geckodriver, ['--version']).then(result => result.stdout),
  ]);
  const hostRuntime = {
    sourceRepository: applicationIni.match(/^SourceRepository=(.+)$/m)?.[1] ?? null,
    sourceStamp: applicationIni.match(/^SourceStamp=(.+)$/m)?.[1] ?? null,
    geckodriverVersion: driverVersion.match(/^geckodriver ([^ ]+)/)?.[1] ?? null,
  };
  assert.equal(applicationIni.match(/^Version=(.+)$/m)?.[1], EXPECTED_RUNTIME.firefoxVersion, 'firefox_application_version_mismatch');
  assert.equal(applicationIni.match(/^BuildID=(.+)$/m)?.[1], EXPECTED_RUNTIME.buildId, 'firefox_application_build_mismatch');
  proof.runtime = await adapter.attestRuntime(hostRuntime);
  proof.runtimeAttested = true;
  await persist();

  await checkpoint('addon_install');
  assert.equal(await wdPost(base, `/session/${sessionId}/moz/addon/install`, { path: xpi, temporary: true }), ADDON_ID);
  addonInstalled = true;
  proof.addonInstalledForRun = true;
  await persist();
  const extensionBase = await waitUntil(async () => {
    await getContext('chrome');
    return executeChromeSync(`
      const policy = WebExtensionPolicy.getByID(arguments[0]);
      return policy ? policy.getURL('') : null;`, [ADDON_ID]);
  }, 'extension_policy_unavailable', 10_000);
  assert.ok(extensionBase.startsWith('moz-extension://'), 'extension_base_invalid');

  await checkpoint('fresh_profile');
  await getContext('content');
  storageHandle = await wdGet(base, `/session/${sessionId}/window`);
  await wdPost(base, `/session/${sessionId}/url`, { url: `${extensionBase}options.html` });
  const emptyStorage = await getStorage(['matrx.user.profile', 'matrx.auth.accessToken', 'matrx.org.active']);
  assert.ok(emptyStorage && Object.keys(emptyStorage).length === 0, 'fresh_profile_auth_storage_not_empty');
  proof.freshProfileAuthStorageEmpty = true;
  await persist();

  await checkpoint('network_observer_start');
  await getContext('chrome');
  const observer = await adapter.startNetworkObserver({ origins: [AUTH_ORIGIN, API, DB], maxEvents: 1000 });
  assert.equal(observer.captureContract, 'method_origin_path_status_owner_only_no_headers_query_body');
  observerStarted = true;
  proof.networkObserverStarted = true;
  await persist();

  await checkpoint('oauth_popup');
  await getContext('content');
  const popupHandle = (await wdPost(base, `/session/${sessionId}/window/new`, { type: 'tab' })).handle;
  await wdPost(base, `/session/${sessionId}/window`, { handle: popupHandle });
  await wdPost(base, `/session/${sessionId}/url`, { url: `${extensionBase}popup.html` });
  const beforeHandles = new Set(await wdGet(base, `/session/${sessionId}/window/handles`));
  proof.authenticationAttempted = true;
  await checkpoint('oauth_popup_sign_in_ready');
  await clickExactButton('Sign in');
  proof.popupSignInTrusted = true;
  await persist();
  const authHandle = await waitUntil(async () => {
    const handles = await wdGet(base, `/session/${sessionId}/window/handles`);
    return handles.find(handle => !beforeHandles.has(handle));
  }, 'oauth_window_not_opened', 15_000);
  await wdPost(base, `/session/${sessionId}/window`, { handle: authHandle });
  await waitUntil(async () => {
    try { return new URL(await wdGet(base, `/session/${sessionId}/url`)).origin === AUTH_ORIGIN; }
    catch { return false; }
  }, 'oauth_expected_origin_timeout', 30_000);
  proof.oauthExpectedOrigin = true;
  await persist();
  await waitUntil(async () => {
    try {
      await wdPost(base, `/session/${sessionId}/element`, { using: 'css selector', value: '#email' });
      await wdPost(base, `/session/${sessionId}/element`, { using: 'css selector', value: '#password' });
      return true;
    } catch { return false; }
  }, 'oauth_login_fields_unavailable', 30_000);
  await checkpoint('oauth_credentials_ready');
  await fillSelector('#email', adminEmail);
  await fillSelector('#password', adminPassword);
  proof.oauthCredentialFieldsPopulated = true;
  await checkpoint('oauth_credentials_entered_before_submission');
  await clickExactButton('Sign in');
  await waitUntil(async () => {
    try { const url = new URL(await wdGet(base, `/session/${sessionId}/url`)); return url.origin === AUTH_ORIGIN && url.pathname.startsWith('/oauth/consent'); }
    catch { return false; }
  }, 'oauth_consent_timeout', 30_000);
  await checkpoint('oauth_consent_ready');
  try {
    await clickExactButton('Authorize');
    proof.oauthConsentDisposition = 'authorize_clicked';
  } catch (error) {
    if (error.message !== 'webdriver_no_such_window') throw error;
    proof.oauthConsentDisposition = 'consent_window_closed_before_authorize_click';
  }
  await persist();
  await wdPost(base, `/session/${sessionId}/window`, { handle: popupHandle });
  const session = await waitUntil(async () => {
    const stored = await getStorage(['matrx.user.profile', 'matrx.auth.accessToken', 'matrx.org.active']);
    return stored?.['matrx.user.profile']?.email && stored?.['matrx.auth.accessToken'] ? stored : null;
  }, 'extension_auth_storage_timeout', 30_000, 250);
  assert.equal(session['matrx.user.profile'].email, adminEmail, 'extension_identity_mismatch');
  const observedToken = session['matrx.auth.accessToken'];
  assert.ok(typeof observedToken === 'string' && observedToken.length > 20, 'extension_token_missing');
  token = observedToken;
  proof.authStorage = { profilePresent: true, accessTokenPresent: true, activeOrganizationPresent: !!session['matrx.org.active'] };
  await checkpoint('oauth_callback_storage_observed');
  const identity = await api(`${DB}/auth/v1/user`, { headers: { apikey: publishableKey }, label: 'identity' });
  assert.equal(identity.email, adminEmail, 'independent_admin_email_mismatch');
  assert.equal(identity.id, session['matrx.user.profile'].id, 'independent_admin_id_mismatch');
  proof.oauthConsentAuthorized = true;
  proof.oauthConsentEvidence = proof.oauthConsentDisposition === 'authorize_clicked'
    ? 'trusted_authorize_click_plus_independent_identity'
    : 'completed_callback_plus_independent_identity';
  proof.independentAdminIdentity = true;
  await persist();

  await checkpoint('native_sidebar_open');
  await wdPost(base, `/session/${sessionId}/window`, { handle: popupHandle });
  await getContext('content');
  await waitUntil(async () => {
    try { await findExactButton('Open chat'); return true; } catch { return false; }
  }, 'popup_open_chat_unavailable', 15_000);
  await clickExactButton('Open chat');
  await getContext('chrome');
  await adapter.waitFor(document => !!document.querySelector('button[title="Chat"]'));
  proof.nativeSidebarOpenedByPopupGesture = true;
  await persist();

  let active = (await getStorage(['matrx.org.active']))?.['matrx.org.active'];
  if (!active?.id) {
    await checkpoint('organization_selection');
    await getContext('chrome');
    await adapter.trustedClick('button[title="Settings"]', {
      outcome: document => document.querySelector('button[title="Settings"]')?.getAttribute('data-state') === 'active',
    });
    await adapter.waitFor(document => [...document.querySelectorAll('span')].some(node => node.textContent?.trim() === 'Settings'));
    proof.organizationSelection = { settingsReady: true, sectionOpenedByTrustedClick: false, actingAsVisible: false };
    await persist();
    let organizationState = await adapter.waitFor((document, label) => {
      const headings = [...document.querySelectorAll('button[aria-controls]')]
        .filter(node => node.textContent?.trim() === label);
      if (headings.length !== 1) return null;
      const controlled = document.getElementById(headings[0].getAttribute('aria-controls'));
      const candidates = controlled ? [...controlled.querySelectorAll('[role="combobox"]')] : [];
      if (candidates.length !== 1) return null;
      const regionSelector = '#' + document.defaultView.CSS.escape(controlled.id);
      const rect = candidates[0].getBoundingClientRect();
      return {
        headerSelector: 'button[aria-controls=' + JSON.stringify(controlled.id) + ']',
        comboboxSelector: regionSelector + ' [role=combobox]',
        actingAsVisible: controlled.getAttribute('aria-hidden') !== 'true' && !controlled.inert
          && rect.width > 0 && rect.height > 0,
      };
    }, ['Organization']);
    if (!organizationState.actingAsVisible) {
      await adapter.trustedClick(organizationState.headerSelector, {
        outcome: (document, label) => {
          const headings = [...document.querySelectorAll('button[aria-controls]')]
            .filter(node => node.textContent?.trim() === label);
          if (headings.length !== 1) return false;
          const controlled = document.getElementById(headings[0].getAttribute('aria-controls'));
          const combobox = controlled?.querySelector('[role="combobox"]');
          const rect = combobox?.getBoundingClientRect();
          return controlled?.getAttribute('aria-hidden') !== 'true' && !controlled?.inert
            && !!rect && rect.width > 0 && rect.height > 0;
        },
        outcomeArgs: ['Organization'],
      });
      proof.organizationSelection.sectionOpenedByTrustedClick = true;
      await persist();
      organizationState = await adapter.waitFor((document, selector) => {
        const combobox = document.querySelector(selector);
        const rect = combobox?.getBoundingClientRect();
        return !!combobox && !!rect && rect.width > 0 && rect.height > 0;
      }, [organizationState.comboboxSelector]).then(() => organizationState);
    }
    proof.organizationSelection.actingAsVisible = true;
    await persist();
    const dismissSetupNotice = async () => {
    const setupNoticeDismiss = await adapter.evaluate(document => {
      const notices = [...document.querySelectorAll('[role="alert"]')].filter(node =>
        node.querySelector('.font-medium')?.textContent?.trim() === 'Capture list unavailable'
        && (node.textContent.includes('NO_ORGANIZATION') || node.textContent.includes('no workspace is selected')));
      if (notices.length !== 1) return null;
      const button = notices[0].querySelector('button[aria-label="Dismiss"]');
      if (!button) return null;
      const segments = [];
      let node = button;
      while (node && node !== document.body) {
        const parent = node.parentElement;
        if (!parent) return null;
        segments.unshift(`${node.tagName.toLowerCase()}:nth-child(${[...parent.children].indexOf(node) + 1})`);
        node = parent;
      }
      return `body > ${segments.join(' > ')}`;
    });
    if (setupNoticeDismiss) {
      await adapter.trustedClick(setupNoticeDismiss, {
        outcome: document => ![...document.querySelectorAll('[role="alert"]')].some(node =>
          node.querySelector('.font-medium')?.textContent?.trim() === 'Capture list unavailable'
          && (node.textContent.includes('NO_ORGANIZATION') || node.textContent.includes('no workspace is selected'))),
      });
    }
    return !!setupNoticeDismiss;
    };
    const initialNoticeDismissed = await dismissSetupNotice();
    proof.organizationSelection.initialMissingOrganizationNotice = initialNoticeDismissed;
    proof.organizationSelection.initialNoticeDismissedForSetup = initialNoticeDismissed;
    await persist();
    const organizationComboboxSelector = organizationState.comboboxSelector;
    try {
      let press;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          press = await adapter.trustedPress(organizationComboboxSelector, {
            outcome: document => document.querySelector('[role="listbox"]') !== null,
          });
          break;
        } catch (error) {
          if (attempt !== 0 || error?.message !== 'trusted_press_target_occluded' || !(await dismissSetupNotice())) throw error;
          proof.organizationSelection.lateSetupNoticeDismissed = true;
          await persist();
        }
      }
      proof.organizationSelection.comboboxTrustedPress = press.diagnostic;
      await persist();
    } catch (error) {
      if (error?.diagnostic) {
        proof.organizationSelection.comboboxTrustedPress = error.diagnostic;
        proof.organizationSelection.occlusion = await adapter.evaluate((document, selector) => {
          const target = document.querySelector(selector);
          const rect = target?.getBoundingClientRect();
          const hit = rect ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) : null;
          const chain = [];
          for (let node = hit; node && chain.length < 5; node = node.parentElement) {
            const style = document.defaultView.getComputedStyle(node);
            chain.push({ tag: node.tagName, role: node.getAttribute('role'), className: node.className,
              inert: node.inert, pointerEvents: style.pointerEvents, position: style.position, zIndex: style.zIndex });
          }
          return { chain, alertCount: document.querySelectorAll('[role="alert"]').length,
            dialogCount: document.querySelectorAll('[role="dialog"]').length };
        }, [organizationComboboxSelector]);
        await persist();
      }
      throw error;
    }
    await adapter.waitFor(document => document.activeElement?.getAttribute('role') === 'option');
    proof.organizationSelection.keyboardSelection = await adapter.trustedKeyboardSelectExact(organizationComboboxSelector, 'AI Matrx');
    for (const key of ['exactLabelSelected', 'trustedOwnedEvents', 'listenerStateRemoved'])
      assert.equal(proof.organizationSelection.keyboardSelection[key], true, 'organization_keyboard_acceptance_failed');
    await persist();
    organizationSelectedByTrustedUi = true;
    active = await waitUntil(async () => (await getStorage(['matrx.org.active']))?.['matrx.org.active'], 'organization_storage_timeout', 15_000);
  }
  assert.equal(active.name, 'AI Matrx', 'organization_name_mismatch');
  assert.ok(typeof active.id === 'string' && active.id.length > 10, 'organization_id_missing');
  organizationId = active.id;
  proof.organizationSelectedByUiOrSingleMembership = true;
  proof.organizationResolution = organizationSelectedByTrustedUi
    ? 'trusted_settings_choice'
    : session['matrx.org.active']?.id
      ? 'present_after_oauth'
      : 'single_membership_auto_resolution';
  await persist();

  await checkpoint('baseline');
  const baseline = await items();
  baselineIds = baseline.map(item => item.id).sort();
  baselineHash = baselineMetadataSha256(baseline);
  proof.baseline = { itemCount: baselineIds.length, metadataSha256: baselineHash };
  proof.baselineItems = baseline.map(entry => ({ id: entry.id, metadataSha256: baselineMetadataSha256([entry]) }));
  if (reconciliationMode) {
    assert.equal(baselineIds.length, 34, 'reconciliation_clean_baseline_count_changed');
    assert.equal(baselineHash, CLEAN_BASELINE_SHA256, 'reconciliation_clean_baseline_metadata_changed');
    proof.historicalReconciliation = { failedRunId: FAILED_CHROME_RUN, failedProofSha256: FAILED_CHROME_PROOF_SHA256, ownedFixtureStatuses: [], cleanBaselineBefore: true, cleanBaselineAfter: false };
    for (const id of historicalFixtureIds) {
      assert.ok(!baselineIds.includes(id), 'historical_fixture_in_current_baseline');
      const response = await fetch(`${API}/api/vault/items/${id}`, { headers: { Authorization: `Bearer ${token}`, 'X-Organization-Id': organizationId }, signal: AbortSignal.timeout(30_000) });
      proof.historicalReconciliation.ownedFixtureStatuses.push({ id, status: response.status });
      await persist();
      assert.equal(response.status, 404, 'historical_fixture_still_present');
    }
  }
  await persist();

  await checkpoint('native_vault');
  await getContext('chrome');
  const beforeVault = await readOwnedNetworkObserver();
  const beforeVaultSequence = latestSequence(beforeVault);
  proof.nativeVaultNetwork = { startSequence: beforeVaultSequence, addonItemsRequestObserved: false, addonItems2xxObserved: false };
  await persist();
  await adapter.trustedClick('button[title="Vault"]', {
    outcome: document => document.querySelector('button[title="Vault"]')?.getAttribute('data-state') === 'active',
  });
  const vaultReadyDeadline = Date.now() + 30_000;
  let vaultReady = false;
  do {
    const snapshot = await readOwnedNetworkObserver();
    const requests = snapshot.events.filter(event => event.sequence > beforeVaultSequence
      && event.phase === 'request' && event.owner === 'addon_principal'
      && event.origin === API && event.pathname === '/api/vault/items' && event.method === 'GET');
    const response = requests.map(request => snapshot.events.find(event => event.sequence > request.sequence
      && event.phase === 'response' && event.owner === 'addon_principal'
      && event.requestId === request.requestId && event.status >= 200 && event.status < 300)).find(Boolean);
    const ui = await adapter.evaluate(document => {
      const text = document.body.innerText;
      const heading = [...document.querySelectorAll('span')].some(node => node.textContent?.trim() === 'Vault');
      const search = document.querySelector('input[placeholder="Search logins"]') !== null;
      const loading = document.querySelector('svg.animate-spin') !== null;
      const vaultError = document.querySelector('[class*="border-amber-500"]') !== null;
      return { settled: heading && search && text.includes('Mine (') && text.includes('Shared (') && !loading, vaultError };
    });
    if (requests.length > 0) proof.nativeVaultNetwork.addonItemsRequestObserved = true;
    if (response) {
      proof.nativeVaultNetwork.addonItems2xxObserved = true;
      proof.nativeVaultNetwork.responseStatus = response.status;
    }
    if (proof.nativeVaultNetwork.addonItemsRequestObserved && proof.nativeVaultNetwork.addonItems2xxObserved
      && ui.settled && ui.vaultError === false) { vaultReady = true; break; }
    await delay(Math.min(100, Math.max(1, vaultReadyDeadline - Date.now())));
  } while (Date.now() < vaultReadyDeadline);
  assert.equal(vaultReady, true, 'native_vault_items_not_observed_settled');
  proof.nativeVaultVisible = true;
  await persist();

  if (generatorMode) {
    await checkpoint('generator_ui');
    const { runFirefoxGeneratorChecks } = await import('./generator-acceptance.mjs');
    await runFirefoxGeneratorChecks({ adapter, base, sessionId, wdPost, wdGet, wdDelete, getContext, proof });
    assert.equal(proof.generator?.ok, true, 'firefox_generator_incomplete');
    await persist();
  }

  if (captureMode) {
    await checkpoint('capture_decisions');
    const { runFirefoxCaptureDecisionChecks } = await import('./capture-decisions.mjs');
    await runFirefoxCaptureDecisionChecks({ adapter, base, sessionId, wdPost, wdGet, wdDelete, getContext, proof });
    assert.equal(proof.captureDecisions?.ok, true, 'firefox_capture_decisions_incomplete');
    await persist();
  }

  await checkpoint('reconcile');
  const final = await items();
  assert.deepEqual(final.map(item => item.id).sort(), baselineIds, 'vault_baseline_ids_changed');
  assert.equal(baselineMetadataSha256(final), baselineHash, 'vault_baseline_metadata_changed');
  proof.baselineReconciled = true;
  if (reconciliationMode) proof.historicalReconciliation.cleanBaselineAfter = true;
  await persist();

  await checkpoint('native_sign_out');
  await getContext('chrome');
  await adapter.trustedClick('button[title="Settings"]', {
    outcome: document => document.querySelector('button[title="Settings"]')?.getAttribute('data-state') === 'active',
  });
  const signOutSelector = await adapter.evaluate((document, label) => {
    const candidates = [...document.querySelectorAll('button')].filter(node => node.textContent?.trim() === label);
    if (candidates.length !== 1) return null;
    const segments = [];
    let node = candidates[0];
    while (node && node !== document.body) {
      const parent = node.parentElement;
      if (!parent) return null;
      segments.unshift(`${node.tagName.toLowerCase()}:nth-child(${[...parent.children].indexOf(node) + 1})`);
      node = parent;
    }
    return `body > ${segments.join(' > ')}`;
  }, ['Sign out']);
  assert.ok(typeof signOutSelector === 'string', 'settings_sign_out_not_unique');
  const beforeSignOut = await readOwnedNetworkObserver();
  signOutStartSequence = latestSequence(beforeSignOut);
  proof.nativeSignOutNetwork = {
    startSequence: signOutStartSequence,
    addonLogoutRequestObserved: false,
    addonLogout204Observed: false,
    nodeFallbackAttempted: false,
  };
  await persist();
  await adapter.trustedClick(signOutSelector, {
    outcome: document => [...document.querySelectorAll('button')]
      .some(node => node.textContent?.trim() === 'Sign in'),
    timeoutMs: 15_000,
  });
  const cleared = await waitUntil(async () => {
    const stored = await getStorage(['matrx.user.profile', 'matrx.auth.accessToken', 'matrx.org.active']);
    return stored && Object.keys(stored).length === 0;
  }, 'local_auth_storage_not_cleared', 15_000);
  assert.ok(cleared);
  proof.localExtensionSignedOut = true;
  await persist();
  // Product sign-out owns revocation. Accept only this add-on principal's
  // request and its matching 204 after the trusted click. A Node request is a
  // recovery fallback only when that canonical evidence never arrives.
  const logoutDeadline = Date.now() + 15_000;
  let addonLogout;
  do {
    const snapshot = await readOwnedNetworkObserver();
    addonLogout = addonLogoutAfter(snapshot, signOutStartSequence);
    proof.nativeSignOutNetwork.addonLogoutRequestObserved = addonLogout.requestObserved;
    proof.nativeSignOutNetwork.addonLogout204Observed = addonLogout.response204Observed;
    if (addonLogout.response204Observed) {
      proof.nativeSignOutNetwork.requestSequence = addonLogout.requestSequence;
      proof.nativeSignOutNetwork.responseSequence = addonLogout.responseSequence;
      break;
    }
    await delay(Math.min(100, Math.max(1, logoutDeadline - Date.now())));
  } while (Date.now() < logoutDeadline);
  if (addonLogout?.response204Observed) {
    proof.remoteAuthRevocationStatus = 204;
    proof.remoteAuthRevocationEvidence = 'addon_request_matching_204_after_trusted_sign_out';
    proof.remoteSessionRevoked = true;
  } else {
    proof.nativeSignOutNetwork.nodeFallbackAttempted = true;
    const logout = await fetch(`${DB}/auth/v1/logout?scope=local`, {
      method: 'POST', headers: { apikey: publishableKey, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000),
    });
    proof.nativeSignOutNetwork.nodeFallbackStatus = logout.status;
    assert.equal(logout.status, 204, 'remote_session_revoke_failed');
    proof.remoteAuthRevocationStatus = logout.status;
    proof.remoteAuthRevocationEvidence = 'node_fallback_204_after_addon_evidence_absent';
    proof.remoteSessionRevoked = true;
  }
  await persist();

  await checkpoint('network_observer_final');
  const observed = await readOwnedNetworkObserver();
  recordObservedNetwork(observed);
  assert.equal(proof.vaultMutationRequests, 0, 'vault_mutation_observed');
  assert.equal(observed.dropped, 0, 'network_observer_dropped_events');
  assert.equal(observed.observerErrors, 0, 'network_observer_errors');
  const disposed = await disposeOwnedNetworkObserver();
  observerStarted = false;
  assert.equal(disposed.disposed, true);
  proof.networkObserverDisposed = true;
  await checkpoint('acceptance_complete');
} catch (error) {
  failure = error;
  proof.errorCode = safeErrorCode(error);
  try { await persist(); } catch { proof.persistenceFailureDuringCleanup = true; }
} finally {
  proof.phaseBeforeCleanup = proof.phase;
  await cleanupCheckpoint('recover_owned_auth');
  if (profile) for (const pid of await pidsContaining(profile).catch(() => [])) ownedPids.add(pid);
  if (!token && proof.authenticationAttempted && sessionId && storageHandle) {
    try {
      const stored = await getStorage(['matrx.user.profile', 'matrx.auth.accessToken']);
      const recoveredToken = stored?.['matrx.auth.accessToken'];
      proof.cleanupAuthStorage = {
        profilePresent: !!stored?.['matrx.user.profile'],
        accessTokenPresent: typeof recoveredToken === 'string',
        readFromExactOwnedProfile: true,
      };
      if (typeof recoveredToken === 'string' && recoveredToken.length > 20) {
        token = recoveredToken;
        proof.cleanupAuthStorage.bearerRecoveredForRevocation = true;
      }
    } catch {
      proof.cleanupAuthStorage = { unavailable: true, readFromExactOwnedProfile: false };
    }
    await cleanupCheckpoint('owned_auth_recovery_finished');
  }
  if (token && baselineIds && baselineHash && !proof.baselineReconciled) {
    try {
      const final = await items();
      proof.baselineReconciled = JSON.stringify(final.map(item => item.id).sort()) === JSON.stringify(baselineIds)
        && baselineMetadataSha256(final) === baselineHash;
    } catch { proof.baselineReconciled = false; }
  }
  if (token && !proof.remoteSessionRevoked && observerStarted && Number.isInteger(signOutStartSequence)) {
    try {
      const observed = await readOwnedNetworkObserver();
      const addonLogout = addonLogoutAfter(observed, signOutStartSequence);
      proof.nativeSignOutNetwork ||= { startSequence: signOutStartSequence };
      proof.nativeSignOutNetwork.addonLogoutRequestObserved = addonLogout.requestObserved;
      proof.nativeSignOutNetwork.addonLogout204Observed = addonLogout.response204Observed;
      if (addonLogout.response204Observed) {
        proof.nativeSignOutNetwork.requestSequence = addonLogout.requestSequence;
        proof.nativeSignOutNetwork.responseSequence = addonLogout.responseSequence;
        proof.remoteAuthRevocationStatus = 204;
        proof.remoteAuthRevocationEvidence = 'addon_request_matching_204_after_trusted_sign_out';
        proof.remoteSessionRevoked = true;
      }
    } catch {}
  }
  if (token && !proof.remoteSessionRevoked) {
    try {
      proof.cleanupNodeRevocationFallbackAttempted = true;
      const response = await fetch(`${DB}/auth/v1/logout?scope=local`, {
        method: 'POST', headers: { apikey: publishableKey, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000),
      });
      proof.cleanupRevocationStatus = response.status;
      proof.remoteSessionRevoked = response.status === 204;
    } catch { proof.remoteSessionRevoked = false; }
  } else if (!token) {
    proof.remoteAuthRevocation = proof.authenticationAttempted
      ? 'not_observed_no_owned_bearer'
      : 'not_applicable';
  }
  await cleanupCheckpoint('remote_revocation_finished');
  if (observerStarted && adapter) {
    try {
      const observed = await readOwnedNetworkObserver();
      recordObservedNetwork(observed);
      proof.cleanupNetworkObserver = {
        dropped: observed.dropped,
        observerErrors: observed.observerErrors,
      };
      const disposed = await disposeOwnedNetworkObserver();
      proof.networkObserverDisposed = disposed.disposed === true
        && observed.dropped === 0 && observed.observerErrors === 0;
      observerStarted = false;
    } catch { proof.networkObserverDisposed = false; }
  }
  await cleanupCheckpoint('network_observer_disposal_finished');
  if (addonInstalled && sessionId) {
    try {
      await getContext('chrome');
      await wdPost(base, `/session/${sessionId}/moz/addon/uninstall`, { id: ADDON_ID });
      proof.addonUninstalled = true;
    } catch { proof.addonUninstalled = false; }
  }
  await cleanupCheckpoint('addon_uninstall_finished');
  if (sessionId) {
    try { await wdDelete(base, `/session/${sessionId}`); proof.sessionDeleted = true; sessionId = undefined; }
    catch { proof.sessionDeleted = false; }
  }
  await cleanupCheckpoint('webdriver_session_delete_finished');
  proof.cleanupErrors = [];
  const cleanupStep = async (code, operation) => {
    try { await operation(); } catch { proof.cleanupErrors.push(code); }
  };
  await cleanupStep('driver_termination_failed', async () => {
    const running = () => driver?.pid && driver.exitCode === null && driver.signalCode === null;
    if (running()) {
      driver.kill('SIGTERM');
      const deadline = Date.now() + 5_000;
      while (running() && Date.now() < deadline) await delay(100);
      if (running()) driver.kill('SIGKILL');
      while (running() && Date.now() < deadline + 5_000) await delay(100);
    }
    proof.driverExited = !running();
  });
  await cleanupCheckpoint('driver_exit_finished');
  await cleanupStep('owned_process_termination_failed', async () => {
    if (!profile) return;
    const remaining = await pidsContaining(profile);
    for (const pid of remaining) ownedPids.add(pid);
    await terminateCurrentOwnedPids(remaining);
  });
  await cleanupStep('profile_removal_failed', async () => {
    if (profile) await rm(profile, { recursive: true, force: true });
    proof.profileRemoved = !profile || !(await exists(profile));
  });
  await cleanupStep('owned_pid_verification_failed', async () => {
    proof.allOwnedPidsGone = await waitForPidsGone(ownedPids);
  });
  await cleanupStep('firefox_exit_verification_failed', async () => {
    proof.firefoxExited = !profile || (await pidsContaining(profile)).length === 0;
  });
  await cleanupCheckpoint('owned_process_profile_cleanup_finished');
  if (acceptanceLease) {
    await cleanupStep('vault_acceptance_lease_cleanup_failed', async () => {
      assert.ok(proof.allOwnedPidsGone && proof.profileRemoved && proof.firefoxExited && proof.driverExited
        && (!proof.authenticationAttempted || proof.remoteSessionRevoked), 'vault_acceptance_lease_retained_for_cleanup');
      await acceptanceLease.release();
      proof.acceptanceLeaseReleased = true;
    });
  }
  const required = [
    'acceptanceLeaseAcquired', 'acceptanceLeaseReleased',
    'runtimeAttested', 'freshProfileAuthStorageEmpty', 'popupSignInTrusted', 'oauthExpectedOrigin',
    'oauthConsentAuthorized', 'independentAdminIdentity', 'organizationSelectedByUiOrSingleMembership',
    'nativeSidebarOpenedByPopupGesture', 'nativeVaultVisible', 'baselineReconciled',
    'localExtensionSignedOut', 'remoteSessionRevoked', 'networkObserverDisposed',
    'addonUninstalled', 'sessionDeleted', 'driverExited', 'firefoxExited', 'profileRemoved', 'allOwnedPidsGone',
  ];
  proof.ok = !failure && !proof.persistenceFailureDuringCleanup && proof.cleanupErrors.length === 0
    && proof.vaultMutationRequests === 0 && (!generatorMode || proof.generator?.ok === true)
    && (!captureMode || proof.captureDecisions?.ok === true)
    && (!reconciliationMode || (proof.historicalReconciliation?.cleanBaselineBefore === true && proof.historicalReconciliation?.cleanBaselineAfter === true && proof.historicalReconciliation.ownedFixtureStatuses.length === 4 && proof.historicalReconciliation.ownedFixtureStatuses.every(item => item.status === 404)))
    && required.every(key => proof[key] === true);
  proof.terminalPhase = proof.ok ? 'complete' : proof.phaseBeforeCleanup;
  if (!proof.ok && !proof.errorCode) proof.errorCode = 'firefox_readonly_acceptance_cleanup_incomplete';
  proof.ownedProcessCount = ownedPids.size;
  try { await persist(); } catch {
    proof.ok = false;
    failure ||= new Error('terminal_proof_persistence_failed');
    process.stderr.write('firefox_terminal_proof_persistence_failed\n');
  }
}

console.log(proofPath);
if (failure) throw failure;
assert.equal(proof.ok, true, proof.errorCode);
