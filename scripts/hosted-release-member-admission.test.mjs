import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  admitReleaseMember,
  releaseMemberPlan,
  requireReleaseMemberSource,
  verifyReleaseMemberBytes,
} from './hosted-release-member-admission.mjs';
const sha = 'c1cf4ec05f78ab231789f9f399cf8fd71bfa8693';
const archive = Buffer.from('captured artifact bytes represented at the hash seam');
const store = Buffer.from('Store package bytes represented at the hash seam');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const input = { releaseRunId: '39049375284', artifactId: '12106724248', sourceSha: sha };
const captured = JSON.parse(
  readFileSync(
    new URL(
      '../docs/stabilization/evidence/member-release-admission-20261017/release-api-metadata.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const run = captured.run;
const artifact = {
  ...captured.listing.artifacts[0],
  digest: `sha256:${hash(archive)}`,
};
const listing = { total_count: 1, artifacts: [artifact] };
const receipt = {
  version: '0.2.520',
  sourceSha: sha,
  publishState: 'pushed',
  storeZip: { sha256: hash(store) },
};
const admission = {
  localSha: sha,
  remoteSha: sha,
  dirty: '',
  runs: [],
  secretNames: ['MATRX_REVIEWER_MAGIC_LINK_JSON'],
};

test('exact member dispatch uses selected release rather than a current build', () => {
  const first = releaseMemberPlan(input, run, listing, receipt, sha);
  assert.ok(first.args.includes('release_run_id=39049375284'));
  assert.ok(first.args.includes('acceptance_case=member-chat'));
  assert.ok(first.args.includes('acceptance_lane=A'));
  const second = releaseMemberPlan(
    { ...input, releaseRunId: '39049375285' },
    { ...run, id: 39049375285 },
    { ...listing, artifacts: [{ ...artifact, workflow_run: { id: 39049375285 } }] },
    receipt,
    sha,
  );
  assert.ok(second.args.includes('release_run_id=39049375285'));
  assert.notDeepEqual(first.args, second.args);
});
test('unpublished, substituted or ambiguous release cannot create a dispatch plan', () => {
  for (const changed of [
    { id: 999 },
    { name: 'Another workflow (by store-rejection-retry-20261017)' },
    { conclusion: 'failure' },
    { event: 'push' },
    { head_branch: 'feature' },
    { path: '.github/workflows/ci.yml' },
  ])
    assert.throws(
      () => releaseMemberPlan(input, { ...run, ...changed }, listing, receipt, sha),
      /release_member_run_invalid/,
    );
  for (const changed of [
    { sourceSha: 'a'.repeat(40) },
    { publishState: 'pending' },
    { version: '0.2.519' },
  ])
    assert.throws(
      () => releaseMemberPlan(input, run, listing, { ...receipt, ...changed }, sha),
      /release_member_receipt_invalid/,
    );
  assert.throws(
    () => releaseMemberPlan(input, run, listing, receipt, 'b'.repeat(40)),
    /release_member_receipt_invalid/,
  );
  assert.throws(
    () =>
      releaseMemberPlan(
        input,
        run,
        { total_count: 2, artifacts: [artifact, artifact] },
        receipt,
        sha,
      ),
    /release_member_artifacts_incomplete/,
  );
  assert.throws(
    () => releaseMemberPlan({ ...input, artifactId: '12106724249' }, run, listing, receipt, sha),
    /release_member_artifact_invalid/,
  );
});
test('artifact metadata from a different run cannot be used for the selected release', () => {
  assert.throws(
    () =>
      releaseMemberPlan(
        input,
        run,
        { ...listing, artifacts: [{ ...artifact, workflow_run: { id: 999 } }] },
        receipt,
        sha,
      ),
    /release_member_artifact_invalid/,
  );
});
test('missing credential reproduces original pre-browser refusal while independent B is admitted', () => {
  assert.throws(
    () => admitReleaseMember({ ...admission, secretNames: [] }),
    /hosted_member_link_secret_required/,
  );
  admitReleaseMember({
    ...admission,
    runs: [{ name: 'Native B · guest-chat', status: 'in_progress' }],
  });
  for (const name of ['Native A · member-chat', 'Hosted resource diagnostic', 'unknown'])
    assert.throws(
      () => admitReleaseMember({ ...admission, runs: [{ name, status: 'queued' }] }),
      /release_member_lane_a_busy/,
    );
  assert.throws(
    () => admitReleaseMember({ ...admission, dirty: ' M scripts/hosted-remote-admission.mjs' }),
    /HOSTED_DISPATCH_SOURCE_NOT_SYNCHRONIZED/,
  );
});
test('archive and inner Store bytes must both match signed GitHub and receipt digests', () => {
  verifyReleaseMemberBytes(archive, artifact, receipt, store);
  assert.throws(
    () => verifyReleaseMemberBytes(Buffer.from('corrupted archive'), artifact, receipt, store),
    /release_member_archive_digest_mismatch/,
  );
  assert.throws(
    () =>
      verifyReleaseMemberBytes(archive, artifact, receipt, Buffer.from('corrupted Store package')),
    /release_member_store_digest_mismatch/,
  );
});
test('harness and evidence commits preserve release eligibility but product edits refuse it', () => {
  requireReleaseMemberSource(true, [
    'scripts/hosted-release-member-admission.mjs',
    'scripts/hosted-release-member-admission.test.mjs',
    'docs/stabilization/reports/store-release-audit-20261017.json',
  ]);
  for (const path of [
    'src/features/chat/ChatView.tsx',
    'package.json',
    'wxt.config.ts',
    '.github/workflows/hosted-guest-acceptance.yml',
  ])
    assert.throws(() => requireReleaseMemberSource(true, [path]), /release_member_product_changed/);
  assert.throws(() => requireReleaseMemberSource(false, []), /release_member_source_not_ancestor/);
});

test('reviewed package Chat driver repairs preserve immutable candidate eligibility', () => {
  requireReleaseMemberSource(true, [
    'tests/browser/guest-chat-store-acceptance.mjs',
    'tests/browser/guest-chat-store-sequence.test.mjs',
    'tests/browser/guest-chat-store-screenshot.mjs',
    'tests/browser/reviewer-chat-store-acceptance.mjs',
    'tests/browser/settings-panel-driver.mjs',
    'tests/browser/package-chat-controls.mjs',
    'tests/browser/package-chat-controls.test.mjs',
  ]);
  for (const path of [
    'tests/browser/unreviewed-driver.mjs',
    'tests/browser/package-chat-controls-other.mjs',
    'tests/browser/reviewer-chat-store-acceptance-extra.mjs',
    'src/features/package-chat/host.ts',
  ])
    assert.throws(() => requireReleaseMemberSource(true, [path]), /release_member_product_changed/);
});

test('member admission rejects unreviewed stabilization documents', () => {
  for (const path of [
    'docs/stabilization/release-workflow-change.json',
    'docs/stabilization/reports/unreviewed.json',
    'docs/stabilization/reports/guest-send-controls-20261018.json',
    'docs/stabilization/evidence/unreviewed/receipt.json',
  ])
    assert.throws(() => requireReleaseMemberSource(true, [path]), /release_member_product_changed/);
});

test('exact member identity diagnostic delta is admitted without widening paths', () => {
  const identityDelta = [
    'tests/browser/reviewer-chat-identity-diagnostic.mjs',
    'tests/browser/reviewer-chat-identity-diagnostic.test.mjs',
    'tests/browser/reviewer-chat-organization-boundary.test.mjs',
  ];
  requireReleaseMemberSource(true, identityDelta);
  for (const path of [
    'tests/browser/reviewer-chat-identity-diagnostic-extra.mjs',
    'tests/browser/reviewer-chat-organization-boundary-copy.test.mjs',
    'docs/stabilization/reports/unreviewed-member-run.json',
    'src/features/chat/ChatView.tsx',
    '.github/workflows/hosted-guest-acceptance.yml',
  ])
    assert.throws(
      () => requireReleaseMemberSource(true, [...identityDelta, path]),
      /release_member_product_changed/,
      `unreviewed path must refuse admission: ${path}`,
    );
});

// Break caught: the immutable member candidate cannot be retested after a
// reviewed guest package oracle repair unless these four exact paths are admitted.
test('reviewed guest package terminal oracle delta is admitted without wildcard paths', () => {
  const oracleDelta = [
    'tests/browser/guest-chat-completion-oracle.mjs',
    'tests/browser/guest-chat-completion-oracle.test.mjs',
    'tests/browser/guest-chat-transport-observer.mjs',
    'tests/browser/guest-chat-transport-observer.test.mjs',
  ];
  requireReleaseMemberSource(true, oracleDelta);
  for (const path of [
    'tests/browser/guest-chat-other-oracle.mjs',
    'tests/browser/guest-chat-transport-observer-copy.test.mjs',
    'src/features/package-chat/host.ts',
  ]) {
    assert.throws(
      () => requireReleaseMemberSource(true, [...oracleDelta, path]),
      /release_member_product_changed/,
    );
  }
});

test('role-proof diagnostic admits only reviewed exact files', () => {
  const paths = [
    'tests/browser/member-native-auth-proof.mjs',
    'tests/browser/member-native-auth-proof.test.mjs',
    'docs/stabilization/reports/member-identity-escalation-20261017.json',
  ];
  requireReleaseMemberSource(true, paths);
  for (const extra of [
    'tests/browser/member-native-auth-proof-copy.mjs',
    'docs/stabilization/reports/member-identity-escalation-20261018.json',
    'src/hooks/use-auth.ts',
  ])
    assert.throws(
      () => requireReleaseMemberSource(true, [...paths, extra]),
      /release_member_product_changed/,
    );
});
