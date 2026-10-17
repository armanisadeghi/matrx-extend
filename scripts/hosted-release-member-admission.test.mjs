import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
const run = {
  id: 39049375284,
  name: 'Hosted release',
  path: '.github/workflows/release.yml',
  event: 'workflow_dispatch',
  head_branch: 'main',
  conclusion: 'success',
};
const artifact = {
  workflow_run: { id: 39049375284 },
  id: 12106724248,
  name: 'matrx-extend-v0.2.520',
  expired: false,
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
