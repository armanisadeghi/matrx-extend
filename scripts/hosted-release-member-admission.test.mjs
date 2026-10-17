import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('member admission rejects documents outside the flat report namespace', () => {
  for (const path of [
    'docs/stabilization/release-workflow-change.json',
    'docs/stabilization/reports/nested/unreviewed.json',
    'docs/stabilization/reports/guest-send-controls-20261018.json.mjs',
    'docs/stabilization/evidence/unreviewed/receipt.json',
  ])
    assert.throws(() => requireReleaseMemberSource(true, [path]), /release_member_product_changed/);
});

test('reviewed guest send peer receipt preserves the released member candidate', () => {
  requireReleaseMemberSource(true, [
    'docs/stabilization/reports/guest-send-boundary-peer-20261017.json',
  ]);
  for (const path of [
    'docs/stabilization/reports/guest-send-boundary-peer-20261018.JSON',
    'docs/stabilization/reports/../reports/guest-send-boundary-peer-20261017.json',
    'docs/stabilization/reports//guest-send-boundary-peer-20261017.json',
    'docs\\stabilization\\reports\\guest-send-boundary-peer-20261017.json',
    'docs/stabilization/reports/guest-send-boundary-peer-20261017.json/child',
    'src/features/chat/ChatView.tsx',
    'package.json',
    '.github/workflows/release.yml',
    'tests/browser/unreviewed-driver.mjs',
  ]) {
    assert.throws(
      () => requireReleaseMemberSource(true, [path]),
      /release_member_product_changed/,
      `unreviewed path must refuse admission: ${path}`,
    );
  }
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
    'docs/stabilization/reports/unreviewed-member-run.ts',
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
    'docs/stabilization/reports/member-identity-escalation-20261018.json.js',
    'src/hooks/use-auth.ts',
  ])
    assert.throws(
      () => requireReleaseMemberSource(true, [...paths, extra]),
      /release_member_product_changed/,
    );
});

// Break caught: a new evidence-only peer report must not force another Store release.
test('new flat JSON reports preserve immutable release eligibility as a class', () => {
  requireReleaseMemberSource(true, [
    'docs/stabilization/reports/guest-receipt-class-peer-20261017.json',
    'docs/stabilization/reports/guest-receipt-class-repair-20261017.json',
    'docs/stabilization/reports/member-report-admission-peer-20261017.json',
    'docs/stabilization/reports/store-0522-blue-argon-peer-20261017.json',
    'docs/stabilization/reports/member-admission-class-repair-20261017.json',
    'docs/stabilization/reports/future-peer-20261018.json',
  ]);
});

test('report namespace cannot conceal product drift or malformed paths', () => {
  const report = 'docs/stabilization/reports/future-peer-20261018.json';
  for (const path of [
    'pnpm-lock.yaml',
    'tests/browser/unknown.test.mjs',
    'docs/stabilization/reports-other/peer.json',
    'docs/stabilization/reports/../package.json',
    'docs/stabilization/reports/./peer.json',
    'docs/stabilization/reports//peer.json',
    'docs/stabilization/reports/nested/peer.json',
    'docs/stabilization/reports/.json',
    'docs/stabilization/reports/.hidden.json',
    'docs/stabilization/reports/peer.json.mjs',
    'docs/stabilization/reports/peer.mjs.json',
    'docs/stabilization/reports/peer.json/child',
    'docs/stabilization/reports/peer.json\n',
    'docs/stabilization/reports/peer.json\0',
    'docs/stabilization/reports/peer%2fproduct.json',
    'R100\tdocs/stabilization/reports/old.json\tdocs/stabilization/reports/new.json',
  ]) {
    assert.throws(
      () => requireReleaseMemberSource(true, [report, path]),
      /release_member_product_changed/,
      path,
    );
  }
  assert.throws(
    () => requireReleaseMemberSource(false, [report]),
    /release_member_source_not_ancestor/,
  );
});

// Use real Git history: a name-only census must include both sides of a rename
// and transient product changes, not merely the final source-to-HEAD diff.
test('source proof rejects renamed or reverted product paths and pending drift', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'member-source-proof-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const write = (path, content) => writeFileSync(join(cwd, path), content);
  const commit = () => {
    git('add', '.');
    git(
      '-c',
      'user.name=Admission guard',
      '-c',
      'user.email=guard@localhost',
      'commit',
      '-qm',
      'source proof',
    );
    return git('rev-parse', 'HEAD');
  };
  const moduleUrl = new URL('./hosted-release-member-admission.mjs', import.meta.url).href;
  const prove = (source, head) =>
    spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { proveSource } from ${JSON.stringify(moduleUrl)}; proveSource(${JSON.stringify(source)}, ${JSON.stringify(head)});`,
      ],
      { cwd, encoding: 'utf8' },
    );
  git('init', '-q');
  mkdirSync(join(cwd, 'src'), { recursive: true });
  mkdirSync(join(cwd, 'docs/stabilization/reports'), { recursive: true });
  write('src/product.json', '{}');
  const source = commit();
  write('docs/stabilization/reports/future-peer.json', '{}');
  const reportHead = commit();
  assert.equal(prove(source, reportHead).status, 0, 'report-only history is eligible');
  git('mv', 'src/product.json', 'docs/stabilization/reports/renamed-product.json');
  const renameHead = commit();
  const renamed = prove(source, renameHead);
  assert.notEqual(renamed.status, 0);
  assert.match(renamed.stderr, /release_member_product_changed/);
  git('revert', '--no-commit', renameHead);
  const restored = commit();
  const reverted = prove(source, restored);
  assert.notEqual(reverted.status, 0);
  assert.match(reverted.stderr, /release_member_product_changed/);
  // An otherwise eligible baseline must still refuse unstaged, staged and untracked files.
  write('src/product.json', '{"changed":true}');
  const pending = prove(restored, restored);
  assert.notEqual(pending.status, 0);
  assert.match(pending.stderr, /release_member_product_changed/);
  git('add', 'src/product.json');
  assert.notEqual(prove(restored, restored).status, 0, 'staged product drift refuses');
  write('src/product.json', '{}');
  git('add', 'src/product.json');
  write('unknown.test.mjs', 'export {};');
  const untracked = prove(restored, restored);
  assert.notEqual(untracked.status, 0);
  assert.match(untracked.stderr, /release_member_product_changed/);
});

// Break caught: reviewed fixture mint repair must be usable with the immutable release,
// while similarly named helpers remain outside the reviewed source delta.
test('reviewed fixture mint helper admits only its two exact paths', () => {
  const reviewed = [
    'tests/browser/prepare-reviewer-magic-link.mjs',
    'tests/browser/prepare-reviewer-magic-link.test.mjs',
  ];
  requireReleaseMemberSource(true, reviewed);
  for (const path of [
    'tests/browser/prepare-reviewer-magic-link-copy.mjs',
    'tests/browser/prepare-reviewer-magic-link-other.test.mjs',
    'tests/browser/prepare-reviewer-magic-link.mjs/child',
    'tests/browser/../browser/prepare-reviewer-magic-link.mjs',
    'tests/browser/prepare-reviewer-magic-link.mjs\n',
    'src/prepare-reviewer-magic-link.mjs',
  ])
    assert.throws(
      () => requireReleaseMemberSource(true, [...reviewed, path]),
      /release_member_product_changed/,
      path,
    );
});
