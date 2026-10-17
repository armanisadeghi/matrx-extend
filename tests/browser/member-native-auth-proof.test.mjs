import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { observeCanonicalAdminCheck } from './member-native-auth-proof.mjs';
import { verifyReviewerRole } from './reviewer-chat-identity-diagnostic.mjs';

const ORIGIN = 'https://example.supabase.co';
const USER = '123e4567-e89b-42d3-a456-426614174000';

function panelWithRows(rows, userId = USER) {
  const emitter = new EventEmitter();
  const panel = {
    on(event, listener) {
      emitter.on(event, listener);
      return () => emitter.off(event, listener);
    },
    async send(command) {
      if (command === 'Network.getResponseBody') return { body: JSON.stringify(rows) };
      return {};
    },
  };
  return {
    panel,
    emitter,
    emit() {
      emitter.emit('Network.requestWillBeSent', {
        requestId: 'owned-admin-read',
        request: {
          url: `${ORIGIN}/rest/v1/admins?select=user_id&user_id=eq.${userId}`,
          method: 'GET',
          headers: { 'Accept-Profile': 'admin' },
        },
      });
      emitter.emit('Network.responseReceived', {
        requestId: 'owned-admin-read',
        response: { status: 200 },
      });
      emitter.emit('Network.loadingFinished', { requestId: 'owned-admin-read' });
    },
  };
}

test('canonical non-admin proof requires zero admin rows for the current extension user', async () => {
  const zero = panelWithRows([]);
  const proof = observeCanonicalAdminCheck(zero.panel, ORIGIN, 200);
  await proof.start();
  zero.emit();
  assert.deepEqual(await proof.verify(USER), {
    matched_current_extension_user: true,
    http_status: 200,
    returned_rows: 0,
  });
  await proof.stop();

  for (const candidate of [
    panelWithRows([{ user_id: USER }]),
    panelWithRows([], '123e4567-e89b-42d3-a456-426614174001'),
  ]) {
    const rejected = observeCanonicalAdminCheck(candidate.panel, ORIGIN, 50);
    await rejected.start();
    candidate.emit();
    await assert.rejects(
      rejected.verify(USER),
      /reviewer_canonical_admin_assignment_read_not_observed/,
    );
    await rejected.stop();
  }
});

test('role proof failure after identity success is classified separately with sanitized evidence', async () => {
  for (const [rows, emit, expected] of [
    [[], false, { observed_request_count: 0, current_user_requests: [] }],
    [
      [{ user_id: USER }],
      true,
      {
        observed_request_count: 1,
        current_user_requests: [{ status: 200, row_count: 1, outcome: 'complete' }],
      },
    ],
  ]) {
    const candidate = panelWithRows(rows);
    const proof = observeCanonicalAdminCheck(candidate.panel, ORIGIN, 1);
    await proof.start();
    if (emit) candidate.emit();
    const report = { account: { web_signed_in: true } };
    let stage = 'extension_identity_wait';
    await assert.rejects(
      verifyReviewerRole({
        report,
        onStage: (next) => {
          stage = next;
        },
        adminCheck: proof,
        userId: USER,
      }),
      { message: 'reviewer_canonical_role_unverified' },
    );
    assert.equal(stage, 'extension_canonical_role_verify');
    assert.deepEqual(report.account, {
      web_signed_in: true,
      extension_identity_observed: true,
      canonical_role_observation: expected,
      canonical_role_network: {
        total_requests: emit ? 1 : 0,
        database_requests: emit ? 1 : 0,
        role_mismatches: {},
        boundaries: emit ? [{ boundary: 'role', status: 200, outcome: 'complete', count: 1 }] : [],
      },
    });
    assert.equal(JSON.stringify(report).includes(USER), false);
    await proof.stop();
  }
});

test('role proof preserves real zero-row success after identity readiness', async () => {
  const candidate = panelWithRows([]);
  const proof = observeCanonicalAdminCheck(candidate.panel, ORIGIN, 200);
  await proof.start();
  candidate.emit();
  const report = { account: { web_signed_in: true } };
  let stage;
  assert.deepEqual(
    await verifyReviewerRole({
      report,
      onStage: (next) => {
        stage = next;
      },
      adminCheck: proof,
      userId: USER,
    }),
    {
      matched_current_extension_user: true,
      http_status: 200,
      returned_rows: 0,
    },
  );
  assert.equal(stage, 'extension_canonical_role_verify');
  assert.deepEqual(report.account, { web_signed_in: true, extension_identity_observed: true });
  await proof.stop();
});

test('actual reviewer orchestration preserves identity success when canonical role proof fails', async () => {
  const source = await readFile(
    new URL('./reviewer-chat-store-acceptance.mjs', import.meta.url),
    'utf8',
  );
  const start = source.indexOf("          stage = 'extension_identity_wait';");
  const end = source.indexOf('        } finally {', start);
  assert.ok(start >= 0 && end > start, 'reviewer identity orchestration must exist');
  const execute = new (Object.getPrototypeOf(async () => {}).constructor)(
    'waitFor',
    'verifyReviewerRole',
    'adminCheck',
    'report',
    'webIdentity',
    'accountObservation',
    'storedSessionShape',
    'capture',
    `const panel = {}; const email = 'opaque'; const artifacts = {}; let stage; let canonicalAdminCheck;
     try { ${source.slice(start, end)} }
     catch (error) { return { stage, code: error.message }; }
     return { stage, result: canonicalAdminCheck };`,
  );
  const candidate = panelWithRows([]);
  const proof = observeCanonicalAdminCheck(candidate.panel, ORIGIN, 1);
  await proof.start();
  const report = { account: { web_signed_in: true } };
  // Identity's prior gate has succeeded. The real role observer gets no request,
  // reproducing the later failure that the old caller mislabeled as identity.
  const outcome = await execute(
    async () => ({}),
    verifyReviewerRole,
    proof,
    report,
    {
      userId: USER,
    },
    async () => ({ organizationLoading: true }),
    async () => ({ profilePresent: true }),
    async () => '/tmp/role.png',
  );
  assert.deepEqual(outcome, {
    stage: 'extension_canonical_role_verify',
    code: 'reviewer_canonical_role_unverified',
  });
  assert.deepEqual(report.account, {
    web_signed_in: true,
    extension_identity_observed: true,
    canonical_role_observation: { observed_request_count: 0, current_user_requests: [] },
    canonical_role_network: {
      total_requests: 0,
      database_requests: 0,
      role_mismatches: {},
      boundaries: [],
    },
    timeout_observation: { organizationLoading: true },
    storage_shape: { profilePresent: true },
  });
  assert.deepEqual(report.screenshots, {
    timeout_panel: '/tmp/role.png',
    timeout_panel_status: 'captured',
  });
  await proof.stop();
});

// A member signs in on the native panel, but organization bootstrap can refuse
// before the role request or a mismatched role request can escape the oracle.
test('role diagnostics separate pre-fetch bootstrap refusal from filtered role requests', async () => {
  const candidate = panelWithRows([]);
  const proof = observeCanonicalAdminCheck(candidate.panel, ORIGIN, 1);
  await proof.start();
  const request = (id, path, headers = {}) =>
    candidate.emitter.emit('Network.requestWillBeSent', {
      requestId: id,
      request: { url: `${ORIGIN}${path}`, method: 'GET', headers },
    });
  request('bootstrap', '/rest/v1/rpc/mbr_for_user?private=secret');
  candidate.emitter.emit('Network.responseReceived', {
    requestId: 'bootstrap',
    response: { status: 403 },
  });
  candidate.emitter.emit('Network.loadingFinished', { requestId: 'bootstrap' });
  request('role', `/rest/v1/admins?select=user_id&user_id=eq.${USER}`, {
    'Accept-Profile': 'public',
    Authorization: 'private-secret',
  });
  assert.deepEqual(proof.networkSnapshot?.(), {
    total_requests: 2,
    database_requests: 2,
    role_mismatches: { schema: 1 },
    boundaries: [
      { boundary: 'memberships', status: 403, outcome: 'complete', count: 1 },
      { boundary: 'role', status: null, outcome: 'pending', count: 1 },
    ],
  });
  await assert.rejects(proof.verify(USER));
  assert.equal(JSON.stringify(proof.networkSnapshot()).includes('secret'), false);
  await proof.stop();
  const good = panelWithRows([]);
  const observed = observeCanonicalAdminCheck(good.panel, ORIGIN, 200);
  await observed.start();
  good.emit();
  await observed.verify(USER);
  assert.deepEqual(observed.networkSnapshot(), {
    total_requests: 1,
    database_requests: 1,
    role_mismatches: {},
    boundaries: [{ boundary: 'role', status: 200, outcome: 'complete', count: 1 }],
  });
  await observed.stop();
});
