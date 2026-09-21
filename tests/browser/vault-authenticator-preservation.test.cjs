/* Guards against losing an enrolled TOTP seed when the receipt-owned password updates. */
const assert = require('node:assert/strict');
const { createAuthenticatorPreservation, exerciseCanonicalPrimitive } = require('./vault-authenticator-preservation.cjs');

const itemId = 'receipt-owned-item';
const metadata = {
  credential_item_id: itemId, display_name: 'Receipt owned login', label: 'Receipt owned', issuer: 'Matrx Canary',
  digits: 8, period: 30, algorithm: 'SHA256', enabled: true, login_urls: ['https://example.invalid/login'], seed_field_id: 'sealed-seed-field',
};

async function successLifecycle() {
  const calls = [];
  const obligations = [];
  const helper = createAuthenticatorPreservation({
    request: async (request) => {
      calls.push(request.method + request.path);
      if (request.method === 'POST') return { status: 200, body: metadata };
      if (request.method === 'DELETE') throw new Error('delete response lost');
      if (request.path.endsWith('/code')) return { status: 200, body: { code: '00000000' } };
      const gets = calls.filter((call) => call === `GET/${itemId}`).length;
      return gets === 1 || gets === 3 ? { status: 404 } : { status: 200, body: metadata };
    },
    markCleanupObligation: async (value) => obligations.push(value),
    createEnrollmentInput: () => ({ seed: 'PROCESS_ONLY_TEST_SEED', enrollmentInput: 'otpauth://test' }),
    verifyCode: async () => true,
  });
  const handle = await helper.beforeUpdate({ credentialItemId: itemId });
  assert.equal(obligations[0], handle, 'cleanup handle was not delivered before enrollment');
  assert.equal(handle.enrolled, true);
  assert.equal(await helper.afterUpdate(handle), true);
  assert.equal(await helper.cleanup(handle), true);
  assert.deepEqual(calls, [`GET/${itemId}`, 'POST/enroll', `GET/${itemId}/code`, `GET/${itemId}`, `GET/${itemId}/code`, `DELETE/${itemId}`, `GET/${itemId}`]);
}

async function recentAuthRefusalDoesNotReachCode() {
  const calls = [];
  const helper = createAuthenticatorPreservation({
    request: async (request) => {
      calls.push(request.method + request.path);
      return request.method === 'GET' ? { status: 404 } : { status: 401 };
    },
    markCleanupObligation: async () => {},
    createEnrollmentInput: () => ({ seed: 'PROCESS_ONLY_TEST_SEED', enrollmentInput: 'otpauth://test' }),
    verifyCode: async () => { throw new Error('recent auth refusal reached code verification'); },
  });
  const handle = await helper.enroll({ credentialItemId: itemId });
  assert.equal(handle.failure, 'recent_auth_required');
  assert.deepEqual(calls, [`GET/${itemId}`, 'POST/enroll']);
}

async function ambiguousEnrollmentNeverRetries() {
  const calls = [];
  let postAttempts = 0;
  const helper = createAuthenticatorPreservation({
    request: async (request) => {
      calls.push(request.method + request.path);
      if (request.method === 'GET' && !request.path.endsWith('/code')) return calls.filter((call) => call === `GET/${itemId}`).length === 1 ? { status: 404 } : { status: 200, body: metadata };
      if (request.method === 'POST') {
        postAttempts += 1;
        if (postAttempts === 1) throw new Error('lost response');
        return { status: 200, body: metadata };
      }
      if (request.path.endsWith('/code')) return { status: 200, body: { code: '00000000' } };
      return { status: 200, body: metadata };
    },
    markCleanupObligation: async () => {},
    createEnrollmentInput: () => ({ seed: 'PROCESS_ONLY_TEST_SEED', enrollmentInput: 'otpauth://test' }),
    verifyCode: async () => true,
  });
  const handle = await helper.enroll({ credentialItemId: itemId });
  assert.equal(handle.enrolled, true);
  assert.equal(calls.filter((call) => call === 'POST/enroll').length, 1, 'ambiguous enrollment retried POST');
  assert.equal(calls[2], `GET/${itemId}`, 'ambiguous enrollment did not reconcile exact item');
}

async function validationFailureStillHasCleanupHandle() {
  let cleanupHandle;
  const calls = [];
  const helper = createAuthenticatorPreservation({
    request: async (request) => {
      calls.push(request.method + request.path);
      if (request.method === 'GET' && !request.path.endsWith('/code')) return calls.filter((call) => call === `GET/${itemId}`).length === 1 ? { status: 404 } : { status: 404 };
      if (request.method === 'POST') return { status: 200, body: metadata };
      if (request.method === 'DELETE') return { status: 204 };
      return { status: 200, body: { code: '00000000' } };
    },
    markCleanupObligation: async (handle) => { cleanupHandle = handle; },
    createEnrollmentInput: () => ({ seed: 'PROCESS_ONLY_TEST_SEED', enrollmentInput: 'otpauth://test' }),
    verifyCode: async () => false,
  });
  await assert.rejects(() => helper.enroll({ credentialItemId: itemId }), /authenticator_code_invalid/);
  assert.equal(cleanupHandle.cleanupObligation, true);
  assert.equal(await helper.cleanup(cleanupHandle), true);
  assert.deepEqual(calls, [`GET/${itemId}`, 'POST/enroll', `GET/${itemId}/code`, `DELETE/${itemId}`, `GET/${itemId}`]);
}

async function canonicalPrimitiveRunsWithoutReturningACode() {
  assert.equal(await exerciseCanonicalPrimitive({
    seed: 'JBSWY3DPEHPK3PXP', metadata, forTime: 1700000000,
  }), true);
}

async function cleanupReconcilesAfterJournalFailure() {
  const calls = [];
  const helper = createAuthenticatorPreservation({
    request: async (request) => { calls.push(request.method + request.path); if (request.method === 'POST') return { status: 200, body: metadata }; if (request.path.endsWith('/code')) return { status: 200, body: { code: '00000000' } }; if (request.method === 'DELETE') return { status: 204 }; return { status: 404 }; },
    markCleanupObligation: async () => {}, createEnrollmentInput: () => ({ seed: 'PROCESS_ONLY_TEST_SEED', enrollmentInput: 'otpauth://test' }), verifyCode: async () => true,
    journal: ({ method }) => { if (method === 'DELETE') throw new Error('journal'); },
  });
  const handle = await helper.enroll({ credentialItemId: itemId });
  await assert.rejects(() => helper.cleanup(handle), /authenticator_journal_failed/);
  assert.equal(handle.cleanupProven, true); assert.equal(handle.acceptanceFailed, true); assert.equal(calls.at(-1), `GET/${itemId}`);
}

async function defaultVerifierRfcVectorAndRejections() {
  const seed = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA'; // Public RFC6238 SHA256 vector, base32.
  const enrollment = () => ({ seed, enrollmentInput: 'otpauth://test' });
  const lifecycle = (code) => {
    let gets = 0; let changed = false;
    let helper;
    helper = createAuthenticatorPreservation({
      request: async (request) => { if (request.method === 'POST') return { status: 200, body: metadata }; if (request.method === 'DELETE') return { status: 204 }; if (request.path.endsWith('/code')) return { status: 200, body: { code } }; gets += 1; if (gets === 1) return { status: 404 }; return { status: 200, body: changed ? { ...metadata, issuer: 'changed' } : metadata }; },
      markCleanupObligation: async () => {}, createEnrollmentInput: enrollment, now: () => 59,
    });
    return { helper, change: () => { changed = true; } };
  };
  const good = lifecycle('46119246'); const accepted = await good.helper.enroll({ credentialItemId: itemId });
  assert.equal(accepted.enrolled, true, 'default RFC6238 verifier rejected public SHA256 vector');
  assert.equal(await good.helper.afterUpdate(accepted), true);
  const bad = lifecycle('00000000'); await assert.rejects(() => bad.helper.enroll({ credentialItemId: itemId }), /authenticator_code_invalid/);
  good.change(); await assert.rejects(() => good.helper.afterUpdate(accepted), /authenticator_metadata_changed/);
}

(async () => {
  await successLifecycle();
  await ambiguousEnrollmentNeverRetries();
  await recentAuthRefusalDoesNotReachCode();
  await validationFailureStillHasCleanupHandle();
  await canonicalPrimitiveRunsWithoutReturningACode();
  await cleanupReconcilesAfterJournalFailure();
  await defaultVerifierRfcVectorAndRejections();
  process.stdout.write('PASS: enrolled authenticator lifecycle preserves exact metadata, validates codes, and never retries ambiguous enrollment\n');
})().catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
