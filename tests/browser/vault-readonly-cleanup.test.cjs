'use strict';

const assert = require('node:assert/strict');
const { hasObservedReadOnlyCleanup } = require('./vault-readonly-cleanup.cjs');

const valid = () => ({
  schema: 3,
  mode: 'read_only_admission',
  ok: false,
  admission: { ok: false, baselineRead: true, noFixtureWrites: true },
  checks: { independentAdminIdentity: true },
  baselineMetadataSha256: 'a'.repeat(64),
  vaultMutationRequests: 0,
  vaultItemPosts: { total: 0, withIdempotencyHeader: 0, missingIdempotencyHeader: 0, invalidIdempotencyHeader: 0 },
  ownedCreateMutationKeys: [],
  ownedFixtureIds: [],
  cleanup: { finalBaselineIdSetMatches: true, finalBaselineMetadataMatches: true, localAuthLogoutStatus: 204, browserClosed: true, profileRemoved: true, localFixtureServerClosed: 'not_started' },
  networkJournal: { ownerVerified: true,
  journalSemanticVersion: 2,
  beforeCleanupSnapshot: {
    boundTargetAttached: true, boundTargetSessionCount: 1, boundTargetCountingSessionCount: 1,
    pageRequestCount: 1, boundTargetRequestCount: 1, boundTargetVaultRequestCount: 1,
    boundTargetItemsAnyOriginCount: 1, vaultMetadataReadRequests: 1,
    enableSuccessBeforeResume: true, panelItemsReadRequestSeen: true, panelItemsReadResponse2xxSeen: true,
    vaultMutationRequests: 0, observerError: false, transportFatal: false, sendFailureClass: 'none',
    pendingSetupCount: 0, cleanupPhase: 'idle', transportCloseStatus: 'open',
  },
  postDisposalSnapshot: {
    boundTargetAttached: false, boundTargetSessionCount: 0, boundTargetCountingSessionCount: 0,
    remainingOwnedSessionCount: 0, pendingSetupCount: 0, cleanupPhase: 'complete',
    transportCloseStatus: 'closed', observerError: false, transportFatal: false, sendFailureClass: 'none',
  },
  disposalSucceeded: true },
});

assert.equal(hasObservedReadOnlyCleanup(valid()), true);
const weaken = (mutate) => { const proof = valid(); mutate(proof); assert.equal(hasObservedReadOnlyCleanup(proof), false); };
weaken((p) => { p.schema = 2; });
weaken((p) => { p.admission.ok = true; });
weaken((p) => { delete p.checks.independentAdminIdentity; });
weaken((p) => { p.baselineMetadataSha256 = 'bad'; });
weaken((p) => { p.admission.noFixtureWrites = false; });
weaken((p) => { p.vaultMutationRequests = 1; });
weaken((p) => { delete p.vaultItemPosts.invalidIdempotencyHeader; });
weaken((p) => { p.ownedFixtureIds.push('id'); });
weaken((p) => { p.cleanup.localAuthLogoutStatus = 200; });
weaken((p) => { delete p.cleanup.localFixtureServerClosed; });
weaken((p) => { p.generator = {}; });
weaken((p) => { p.networkJournal.ownerVerified = false; });
weaken((p) => { p.networkJournal.beforeCleanupSnapshot.boundTargetCountingSessionCount = 2; });
weaken((p) => { p.networkJournal.beforeCleanupSnapshot.panelItemsReadResponse2xxSeen = false; });
weaken((p) => { p.networkJournal.postDisposalSnapshot.remainingOwnedSessionCount = 1; });
weaken((p) => { p.networkJournal.postDisposalSnapshot.transportCloseStatus = 'open'; });
weaken((p) => { p.networkJournal.disposalSucceeded = false; });
process.stdout.write('PASS: read-only cleanup predicate rejects weakened evidence families\n');

const fs = require('node:fs');
const path = require('node:path');
for (const [id, expected] of [['29062638-acbd-499a-95c1-eab99a1414eb', true], ['773b5e06-70c4-488a-be6e-02f7d4cc10ee', false]]) {
  const proofPath = path.join(__dirname, '../../.matrx/realbrowser-vault/generator-admission', id, 'proof.json');
  if (fs.existsSync(proofPath)) assert.equal(hasObservedReadOnlyCleanup(JSON.parse(fs.readFileSync(proofPath, 'utf8'))), expected, 'actual proof ' + id);
}
function requiredPaths(value, prefix = []) {
  return Object.keys(value).flatMap((key) => {
    const at = [...prefix, key], child = value[key];
    return [at, ...(child && typeof child === 'object' && !Array.isArray(child) ? requiredPaths(child, at) : [])];
  });
}
for (const keys of requiredPaths(valid())) {
  const proof = valid(); let parent = proof;
  for (const key of keys.slice(0, -1)) parent = parent[key];
  delete parent[keys.at(-1)];
  assert.equal(hasObservedReadOnlyCleanup(proof), false, `missing ${keys.join('.')}`);
}
const unchanged = valid(), before = JSON.stringify(unchanged);
assert.equal(hasObservedReadOnlyCleanup(unchanged), true);
assert.equal(JSON.stringify(unchanged), before);
const generator = valid(); generator.generator = {ownedFixtureServersClosed:true};
assert.equal(hasObservedReadOnlyCleanup(generator), true);
generator.generator.ownedFixtureServersClosed=false;
assert.equal(hasObservedReadOnlyCleanup(generator), false);

const { hasPreBaselineAuthenticatedCleanup } = require('./vault-readonly-cleanup.cjs');
const preBaseline = () => ({
  schema: 3, mode: 'read_only_admission', ok: false,
  admission: { ok: false, fixtureWrites: 0, noFixtureWrites: true },
  authenticationAttempted: true, failurePhase: 'oauth_sign_in',
  checks: { independentAdminIdentity: true },
  identityProof: { extensionProfileEmail: 'admin@admin.com', independentUserIdMatchesProfile: true },
  authStorage: { profilePresent: true, accessTokenPresent: true },
  vaultMutationRequests: 0,
  vaultItemPosts: { total: 0, withIdempotencyHeader: 0, missingIdempotencyHeader: 0, invalidIdempotencyHeader: 0 },
  ownedCreateMutationKeys: [], ownedFixtureIds: [],
  cleanup: { localFixtureServerClosed: 'not_started', localAuthLogoutStatus: 204,
    remoteAuthRevocationStatus: 204, browserClosed: true, profileRemoved: true,
    localCredentialDisposal: 'profile_removed' },
});
assert.equal(hasPreBaselineAuthenticatedCleanup(preBaseline()), true);
for (const keys of requiredPaths(preBaseline())) {
  for (const mutation of ['delete', 'flip']) {
    const proof = preBaseline(); let parent = proof;
    for (const key of keys.slice(0, -1)) parent = parent[key];
    const key = keys.at(-1), value = parent[key];
    if (mutation === 'delete') delete parent[key];
    else parent[key] = typeof value === 'boolean' ? !value : typeof value === 'number' ? value + 1 : Array.isArray(value) ? ['unexpected'] : 'unexpected';
    assert.equal(hasPreBaselineAuthenticatedCleanup(proof), false, `${mutation} ${keys.join('.')}`);
  }
}
for (const mutate of [p => {p.baselineMetadataSha256 = undefined}, p => {p.admission.baselineRead = false}, p => {p.cleanup.finalBaselineIdSetMatches = true}, p => {p.cleanup.finalBaselineMetadataMatches = false}]) {
  const proof = preBaseline(); mutate(proof); assert.equal(hasPreBaselineAuthenticatedCleanup(proof), false);
}
const actualPath = path.join(__dirname, '../../.matrx/realbrowser-vault/generator-admission/ce459c44-10bc-4e6a-992a-be38e797e227/proof.json');
if (fs.existsSync(actualPath)) {
  const proof = JSON.parse(fs.readFileSync(actualPath, 'utf8')), before = JSON.stringify(proof);
  assert.equal(hasPreBaselineAuthenticatedCleanup(proof), true);
  assert.equal(JSON.stringify(proof), before);
}
process.stdout.write('PASS: pre-baseline authenticated cleanup admits only fully disposed zero-fixture runs\n');
