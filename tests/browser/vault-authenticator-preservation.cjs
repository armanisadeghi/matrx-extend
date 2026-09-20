/*
 * Receipt-owned authenticator preservation acceptance helper.
 *
 * The caller supplies an authenticated, organization-scoped request callback.
 * This module never constructs auth headers, fetches directly, or logs values.
 * Seeds and codes live only in a WeakMap keyed by the value-free run handle.
 */
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const privateState = new WeakMap();
const AIDREAM_PYTHON = '/Users/armanisadeghi/code/aidream/.venv/bin/python';
// This bounds Python startup and computation, not the server code-request
// window. Verification still uses the captured request timestamps below.
const CANONICAL_TOTP_TIMEOUT_MS = 60_000;
const CANONICAL_TOTP_MAX_OUTPUT_BYTES = 256;
const METADATA_KEYS = Object.freeze([
  'credential_item_id', 'display_name', 'label', 'issuer', 'digits', 'period',
  'algorithm', 'enabled', 'login_urls', 'seed_field_id',
]);

const assert = (condition, code) => {
  if (!condition) throw new Error(code);
};

const base32 = (bytes) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
};

const createEnrollment = () => {
  const seed = base32(crypto.randomBytes(20));
  const issuer = 'Matrx Canary';
  const label = 'Receipt owned';
  return {
    seed,
    enrollmentInput: `otpauth://totp/${encodeURIComponent(`${issuer}:${label}`)}?secret=${seed}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA256&digits=8&period=30`,
  };
};

const stableMetadata = (entry) => {
  assert(entry && typeof entry === 'object', 'authenticator_metadata_missing');
  const metadata = {};
  for (const key of METADATA_KEYS) metadata[key] = entry[key];
  assert(typeof metadata.credential_item_id === 'string' && metadata.credential_item_id.length > 0, 'authenticator_item_id_missing');
  assert(typeof metadata.seed_field_id === 'string' && metadata.seed_field_id.length > 0, 'authenticator_seed_field_missing');
  assert(metadata.digits === 8 && metadata.period === 30 && metadata.enabled === true, 'authenticator_parameters_invalid');
  assert(metadata.algorithm === 'SHA256', 'authenticator_algorithm_invalid');
  assert(Array.isArray(metadata.login_urls), 'authenticator_login_urls_missing');
  return metadata;
};

const sameMetadata = (before, after) => JSON.stringify(before) === JSON.stringify(after);

const runCanonical = (script, payload) => new Promise((resolve, reject) => {
  const child = spawn(AIDREAM_PYTHON, ['-c', script], { cwd: '/Users/armanisadeghi/code/aidream', stdio: ['pipe', 'pipe', 'ignore'] });
  let stdout = '';
  const timeout = setTimeout(() => {
    child.kill();
    reject(new Error('canonical_totp_timeout'));
  }, CANONICAL_TOTP_TIMEOUT_MS);
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    if (Buffer.byteLength(stdout) > CANONICAL_TOTP_MAX_OUTPUT_BYTES) {
      child.kill();
      reject(new Error('canonical_totp_output_invalid'));
    }
  });
  child.once('error', () => { clearTimeout(timeout); reject(new Error('canonical_totp_unavailable')); });
  child.once('close', (status) => {
    clearTimeout(timeout);
    if (status !== 0) return reject(new Error('canonical_totp_unavailable'));
    try { resolve(JSON.parse(stdout)); } catch { reject(new Error('canonical_totp_output_invalid')); }
  });
  child.stdin.end(JSON.stringify(payload));
});

const canonicalVerifier = ({ seed, code, metadata, startedAt, endedAt }) => runCanonical([
    'import json, sys',
    'from aidream.services.authenticator.otp import decode_seed, generate_code',
    'payload=json.load(sys.stdin)',
    'raw=decode_seed(payload["seed"])',
    'expected={generate_code(raw, for_time=t, digits=payload["digits"], period=payload["period"], algorithm=payload["algorithm"]) for t in payload["times"]}',
    'print(json.dumps({"matches": payload["code"] in expected}))',
  ].join(';'), {
    seed, code, digits: metadata.digits, period: metadata.period, algorithm: metadata.algorithm,
    times: [startedAt, endedAt],
  }).then((output) => output.matches === true);

const exerciseCanonicalPrimitive = ({ seed, metadata, forTime }) => runCanonical([
  'import json, sys',
  'from aidream.services.authenticator.otp import decode_seed, generate_code',
  'payload=json.load(sys.stdin)',
  'raw=decode_seed(payload["seed"])',
  'generate_code(raw, for_time=payload["for_time"], digits=payload["digits"], period=payload["period"], algorithm=payload["algorithm"])',
  'print(json.dumps({"ok": True}))',
].join(';'), { seed, digits: metadata.digits, period: metadata.period, algorithm: metadata.algorithm, for_time: forTime }).then((output) => output.ok === true);

const routeStatus = (response) => Number.isInteger(response?.status) ? response.status : 'transport';

function createAuthenticatorPreservation({ request, markCleanupObligation, journal = () => {}, now = () => Date.now() / 1000, createEnrollmentInput = createEnrollment, verifyCode = canonicalVerifier, maxCodeRequestSeconds = 5 }) {
  assert(typeof request === 'function', 'authenticator_request_missing');
  assert(typeof markCleanupObligation === 'function', 'authenticator_cleanup_obligation_missing');
  assert(typeof journal === 'function' && typeof now === 'function', 'authenticator_controls_missing');

  const journalRoute = (method, response) => {
    try { journal({ method, route: 'authenticator', status: routeStatus(response) }); }
    catch { throw new Error('authenticator_journal_failed'); }
  };
  const call = async (method, path, body, cleanupHandle) => {
    let response;
    try {
      response = await request({ method, path, ...(body !== undefined && { body }) });
    } catch {
      response = { status: 'transport' };
    }
    try { journalRoute(method, response); }
    catch (error) {
      if (!cleanupHandle) throw error;
      cleanupHandle.journalFailed = true;
    }
    return response;
  };

  const reconcile = async (credentialItemId) => call('GET', `/${encodeURIComponent(credentialItemId)}`);

  const validateCode = async (handle, response) => {
    const secret = privateState.get(handle);
    assert(secret, 'authenticator_handle_unknown');
    assert(response?.status === 200 && typeof response.body?.code === 'string', 'authenticator_code_unavailable');
    const endedAt = now();
    assert(endedAt - secret.codeStartedAt <= Math.min(maxCodeRequestSeconds, secret.metadata.period), 'authenticator_code_window_unbounded');
    const matches = await verifyCode({
      seed: secret.seed, code: response.body.code, metadata: secret.metadata,
      startedAt: secret.codeStartedAt, endedAt,
    });
    assert(matches === true, 'authenticator_code_invalid');
    return true;
  };

  const enroll = async ({ credentialItemId }) => {
    assert(typeof credentialItemId === 'string' && credentialItemId.length > 0, 'authenticator_target_missing');
    const handle = { credentialItemId, cleanupObligation: true, enrolled: false, acceptanceFailed: false };
    privateState.set(handle, {});
    const initial = await reconcile(credentialItemId);
    assert(initial.status === 404, 'authenticator_present_before_enrollment');
    await markCleanupObligation(handle);
    const enrollment = createEnrollmentInput();
    assert(typeof enrollment?.seed === 'string' && typeof enrollment?.enrollmentInput === 'string', 'authenticator_enrollment_input_invalid');
    const secret = privateState.get(handle);
    secret.seed = enrollment.seed;
    const posted = await call('POST', '/enroll', { credential_item_id: credentialItemId, enrollment_input: enrollment.enrollmentInput });
    let entry;
    if (posted.status === 200) {
      entry = posted.body;
    } else if (posted.status === 401) {
      handle.acceptanceFailed = true;
      handle.failure = 'recent_auth_required';
      return handle;
    } else {
      // A response can be lost after commit. Reconcile exactly once; never retry POST.
      const reconciled = await reconcile(credentialItemId);
      if (reconciled.status === 200) entry = reconciled.body;
      else {
        handle.acceptanceFailed = true;
        handle.failure = reconciled.status === 404 ? 'enrollment_absent_after_ambiguity' : 'enrollment_custody_unresolved';
        return handle;
      }
    }
    const metadata = stableMetadata(entry);
    assert(metadata.credential_item_id === credentialItemId, 'authenticator_wrong_item');
    secret.metadata = metadata;
    handle.enrolled = true;
    secret.codeStartedAt = now();
    await validateCode(handle, await call('GET', `/${encodeURIComponent(credentialItemId)}/code`));
    return handle;
  };

  const beforeUpdate = enroll;

  const verify = async (handle) => {
    assert(handle?.enrolled === true && !handle.acceptanceFailed, 'authenticator_not_enrolled');
    const secret = privateState.get(handle);
    const after = await reconcile(handle.credentialItemId);
    assert(after.status === 200, 'authenticator_missing_after_update');
    assert(sameMetadata(secret.metadata, stableMetadata(after.body)), 'authenticator_metadata_changed');
    secret.codeStartedAt = now();
    await validateCode(handle, await call('GET', `/${encodeURIComponent(handle.credentialItemId)}/code`));
    handle.preserved = true;
    return true;
  };

  const afterUpdate = verify;

  const cleanup = async (handle) => {
    assert(handle?.cleanupObligation === true, 'authenticator_cleanup_not_armed');
    const deleted = await call('DELETE', `/${encodeURIComponent(handle.credentialItemId)}`, undefined, handle);
    const absent = await call('GET', `/${encodeURIComponent(handle.credentialItemId)}`, undefined, handle);
    handle.cleanupProven = absent.status === 404;
    handle.cleanupDeleteStatus = routeStatus(deleted);
    if (!handle.cleanupProven || handle.journalFailed) handle.acceptanceFailed = true;
    privateState.delete(handle);
    if (handle.journalFailed) throw new Error('authenticator_journal_failed');
    return handle.cleanupProven;
  };

  return { enroll, beforeUpdate, verify, afterUpdate, cleanup };
}

exports.createAuthenticatorPreservation = createAuthenticatorPreservation;
exports.stableMetadata = stableMetadata;
exports.exerciseCanonicalPrimitive = exerciseCanonicalPrimitive;
