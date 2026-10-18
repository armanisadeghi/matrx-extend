import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import {
  admitReleaseMember,
  proveSource,
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
  secretNames: ['MATRX_REVIEWER_MAGIC_LINK_JSON', 'MATRX_PROFILE_APPROVED_ORGANIZATION_JSON'],
};

// Recorded Settings run terminated resource-invalid with zero product credit.
// Its run and journals are immutable evidence; the canonical defect record can
// still receive non-runtime status updates after the reviewed commit.
test('completed Settings evidence refuses run and journal drift while allowing defect status', (t) => {
  const source = '72fb54c95159b9f942bfbbc69f017c49b775a7c5';
  const reviewed = '1d458dba919650fcb0f077c0a65f723bd9ef7cc0';
  const paths = [
    'docs/stabilization/defects/EXT-D-0232.json',
    'docs/stabilization/runs/hosted-settings-controls-39074994379.json',
    ...['browser', 'guest', 'package'].map(
      (kind) => `docs/stabilization/resource-journals/hosted-${kind}-39074994379-1.jsonl`,
    ),
  ];
  const repository = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
  const cwd = mkdtempSync(join(tmpdir(), 'member-settings-evidence-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('clone', '--shared', '--no-checkout', repository, '.');
  git('sparse-checkout', 'set', '--no-cone', ...paths.map((path) => `/${path}`));
  git('checkout', '--detach', reviewed);
  const moduleUrl = new URL('./hosted-release-member-admission.mjs', import.meta.url).href;
  const prove = () =>
    spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { proveSource } from ${JSON.stringify(moduleUrl)}; proveSource(${JSON.stringify(source)}, ${JSON.stringify(git('rev-parse', 'HEAD'))});`,
      ],
      { cwd, encoding: 'utf8' },
    );
  const refuse = (label) => {
    const result = prove();
    assert.notEqual(result.status, 0, label);
    assert.match(result.stderr, /release_member_product_changed/, label);
  };
  const commit = () => {
    git(
      '-c',
      'user.name=Admission guard',
      '-c',
      'user.email=guard@localhost',
      'commit',
      '-qam',
      'evidence mutation',
    );
    return git('rev-parse', 'HEAD');
  };
  const baseline = prove();
  assert.equal(
    baseline.status,
    0,
    `completed reviewed evidence must be eligible: ${baseline.stderr}`,
  );
  const defectPath = paths[0];
  const defectOriginal = readFileSync(join(cwd, defectPath));
  writeFileSync(join(cwd, defectPath), Buffer.concat([defectOriginal, Buffer.from(' ')]));
  assert.equal(prove().status, 0, 'canonical defect status edit remains non-runtime');
  git('checkout', '--', defectPath);
  for (const path of paths.slice(1)) {
    const original = readFileSync(join(cwd, path));
    writeFileSync(join(cwd, path), Buffer.concat([original, Buffer.from(' ')]));
    refuse(`pending evidence refuses: ${path}`);
    git('add', path);
    refuse(`staged evidence refuses: ${path}`);
    const changed = commit();
    refuse(`later evidence rewrite refuses: ${path}`);
    git('revert', '--no-commit', changed);
    commit();
    refuse(`reverted evidence rewrite refuses: ${path}`);
    git('checkout', '--detach', reviewed);
  }
  const runPath = paths[1];
  git('mv', '--sparse', runPath, runPath.replace('39074994379', '39074994380'));
  commit();
  refuse('renamed run cannot inherit reviewed evidence admission');
  git('checkout', '--detach', reviewed);
  writeFileSync(
    join(cwd, runPath.replace('39074994379', '39074994380')),
    readFileSync(join(cwd, runPath)),
  );
  refuse('untracked sibling run cannot inherit reviewed evidence admission');
  for (const path of [...paths.slice(1), 'docs/stabilization/runs/hosted-settings-controls-*.json'])
    assert.throws(() => requireReleaseMemberSource(true, [path]), /release_member_product_changed/);
});

test('Store repair receipt admits its reviewed commit but refuses every subsequent edit', (t) => {
  const source = '72fb54c95159b9f942bfbbc69f017c49b775a7c5';
  const reviewed = '66b9b1b1852036d8aa565715455f94935177c522';
  const path = 'docs/stabilization/evidence/store-release-20261017/tool-drift-release-repair.json';
  const repository = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
  const cwd = mkdtempSync(join(tmpdir(), 'member-store-receipt-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('clone', '--shared', '--no-checkout', repository, '.');
  git('sparse-checkout', 'set', '--no-cone', `/${path}`);
  git('checkout', '--detach', reviewed);
  const moduleUrl = new URL('./hosted-release-member-admission.mjs', import.meta.url).href;
  const prove = () =>
    spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { proveSource } from ${JSON.stringify(moduleUrl)}; proveSource(${JSON.stringify(source)}, ${JSON.stringify(git('rev-parse', 'HEAD'))});`,
      ],
      { cwd, encoding: 'utf8' },
    );
  assert.equal(prove().status, 0, 'reviewed Store evidence history is eligible');
  writeFileSync(join(cwd, path), Buffer.concat([readFileSync(join(cwd, path)), Buffer.from(' ')]));
  const refuse = () => {
    const result = prove();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /release_member_product_changed/);
  };
  refuse();
  git('add', path);
  refuse();
  git(
    '-c',
    'user.name=Admission guard',
    '-c',
    'user.email=guard@localhost',
    'commit',
    '-qm',
    'receipt rewrite',
  );
  refuse();
  assert.throws(() => requireReleaseMemberSource(true, [path]), /release_member_product_changed/);
});

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
    () =>
      admitReleaseMember({
        ...admission,
        secretNames: ['MATRX_REVIEWER_MAGIC_LINK_JSON'],
      }),
    /release_member_approved_organization_secret_required/,
  );
  assert.throws(
    () =>
      admitReleaseMember({
        ...admission,
        secretNames: ['MATRX_PROFILE_APPROVED_ORGANIZATION_JSON'],
      }),
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

// Break caught: the reviewed Member A paint diagnostics and status checkpoint
// must not be mistaken for a change to the frozen Store extension.
test('Member A source proof admits its exact reviewed diagnostic and status delta', (t) => {
  const source = 'de066a247ae7fa74015bc143bbc13e4128f742e4';
  const workflow = '5ae3851b4af89e706a00ed69439ff9b06317af3e';
  const repository = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
  const cwd = mkdtempSync(join(tmpdir(), 'member-paint-delta-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  execFileSync('git', ['clone', '--shared', '--no-checkout', repository, '.'], { cwd });
  execFileSync('git', ['checkout', '--detach', workflow], { cwd });
  const moduleUrl = new URL('./hosted-release-member-admission.mjs', import.meta.url).href;
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { proveSource } from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(proveSource(${JSON.stringify(source)}, ${JSON.stringify(workflow)})));`,
    ],
    { cwd, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  const proof = JSON.parse(result.stdout);
  assert.equal(proof.storeEligibility, false);
  assert.equal(proof.workflowSha, workflow);
  assert.ok(proof.subsequentChangedPaths.includes('tests/browser/member-chat-visible-proof.mjs'));
  assert.ok(
    proof.subsequentChangedPaths.includes('tests/browser/member-chat-visible-proof.test.mjs'),
  );
  assert.ok(proof.subsequentChangedPaths.includes('docs/stabilization/COORDINATOR.md'));
  requireReleaseMemberSource(true, proof.subsequentChangedPaths);
  for (const path of [
    'tests/browser/member-chat-visible-proof-copy.mjs',
    'docs/stabilization/COORDINATOR-copy.md',
    'src/config/env.ts',
    'pnpm-lock.yaml',
    'package.json',
    'wxt.config.ts',
    '.github/workflows/release.yml',
  ])
    assert.throws(
      () => requireReleaseMemberSource(true, [...proof.subsequentChangedPaths, path]),
      /release_member_product_changed/,
      path,
    );
});

// Break caught: the completed public guest receipt and its three resource
// journals are evidence for one run, never a product-source delta or a folder wildcard.
test('public guest run 39156655719 admits only its receipt and matching journals', (t) => {
  const source = 'de066a247ae7fa74015bc143bbc13e4128f742e4';
  const workflow = '5ae3851b4af89e706a00ed69439ff9b06317af3e';
  const repository = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
  const cwd = mkdtempSync(join(tmpdir(), 'member-public-receipt-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  execFileSync('git', ['clone', '--shared', '--no-checkout', repository, '.'], { cwd });
  execFileSync('git', ['checkout', '--detach', workflow], { cwd });
  const paths = [
    'docs/stabilization/runs/public-guest-chat-0.2.205-39156655719.json',
    ...['package', 'browser', 'guest'].map(
      (kind) =>
        `docs/stabilization/evidence/published-v0205-guest-chat/run39156655719/resource-journals/hosted-${kind}-39156655719-1.sanitized.jsonl`,
    ),
  ];
  for (const path of paths) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    // Admission reads Git path provenance, not the evidence payload bytes.
    writeFileSync(join(cwd, path), '{}\n');
  }
  const moduleUrl = new URL('./hosted-release-member-admission.mjs', import.meta.url).href;
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { proveSource } from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(proveSource(${JSON.stringify(source)}, ${JSON.stringify(workflow)})));`,
    ],
    { cwd, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).pendingPaths.sort(), paths.sort());
  for (const path of [
    'docs/stabilization/runs/public-guest-chat-0.2.206-39156655719.json',
    'docs/stabilization/runs/public-guest-chat-0.2.205-39156655720.json',
    'docs/stabilization/evidence/published-v0205-guest-chat/run39156655719/resource-journals/hosted-package-39156655720-1.sanitized.jsonl',
    'docs/stabilization/evidence/published-v0205-guest-chat/run39156655720/resource-journals/hosted-package-39156655720-1.sanitized.jsonl',
    'docs/stabilization/evidence/published-v0205-guest-chat/run39156655719/resource-journals/hosted-other-39156655719-1.sanitized.jsonl',
    'docs/stabilization/evidence/published-v0205-guest-chat/run39156655719/resource-journals/hosted-browser-39156655719-2.sanitized.jsonl',
    'src/config/env.ts',
    'pnpm-lock.yaml',
    'package.json',
    'wxt.config.ts',
  ])
    assert.throws(
      () => requireReleaseMemberSource(true, [...paths, path]),
      /release_member_product_changed/,
      path,
    );
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

// The Member A false-negative repair and its durable defect record remain test-only.
test('member harness defects admit only reviewed test and canonical defect records', () => {
  const reviewed = [
    'tests/browser/reviewer-chat-organization-boundary.test.mjs',
    'docs/stabilization/defects/EXT-D-0239.json',
    'docs/stabilization/defects/EXT-D-0240.json',
    'docs/stabilization/defects/EXT-D-0243.json',
  ];
  requireReleaseMemberSource(true, reviewed);
  for (const path of [
    'tests/browser/reviewer-chat-organization-boundary-copy.test.mjs',
    'docs/stabilization/defects/EXT-D-0239.json.bak',
    'docs/stabilization/defects/EXT-D-999.json',
    'docs/stabilization/defects/EXT-D-0243.JSON',
    'docs/stabilization/defects/EXT-D-0243.json/child',
    'docs/stabilization/defects/EXT-D-0243-private.json',
    'docs/stabilization/defects/../package.json',
    'src/features/chat/ChatView.tsx',
    'src/config/env.ts',
  ])
    assert.throws(
      () => requireReleaseMemberSource(true, [...reviewed, path]),
      /release_member_product_changed/,
      path,
    );
});

test('frozen .537 candidate admits only the reviewed D0223 preflight commit and blobs', () => {
  const source = '1b612c67410576b5d077fe20bee4fd33455d987d';
  const head = '5ec68e5e53d0902454329d7708ba178d571fe47f';
  const proof = proveSource(source, head);
  assert.equal(proof.storeEligibility, false);
  assert.deepEqual(
    proof.reviewedChanges
      .filter((row) => row.commit === 'db9434441dd1f29eda3c0242b081971befa3dbdd')
      .map((row) => [row.path, row.blob]),
    [
      [
        'docs/stabilization/resource-journals/ext-d-0223-native-retest-preflight-20261018-01.jsonl',
        'f01a7788e4501d348003173fdf33f585656e35d2',
      ],
      [
        'docs/stabilization/runs/ext-d-0223-t10-native-retest-20261018-01.json',
        'b69d14ada91d1bc4a12a579b36cafc4a14db0b56',
      ],
    ],
  );
  assert.throws(
    () => proveSource('ec7b09cc64c83d48c7533da84735da764e0c9701', head),
    /release_member_product_changed/,
    'the reviewed preflight is limited to the frozen .537 candidate',
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

// Break caught: reviewed member/guest harness and sanitized stabilization records
// after v0.2.522 must not make the immutable Store candidate ineligible.
test('strict post-release history admits reviewed harness and bounded stabilization evidence', () => {
  requireReleaseMemberSource(true, [
    'tests/browser/member-chat-completion-oracle.mjs',
    'tests/browser/member-chat-completion-oracle.test.mjs',
    'docs/stabilization/CHECKLIST.md',
    'docs/stabilization/STATUS.md',
    'docs/stabilization/STATUS.html',
    'docs/stabilization/inventory.json',
    'docs/stabilization/defects/EXT-D-0228.json',
    'docs/stabilization/evidence/guest-values-b-39058763654/result.sanitized.json',
    'docs/stabilization/evidence/guest-values-b-39058763654/values-open.png',
    'docs/stabilization/evidence/member-run39058586019-20261017/native-summary.json',
    'docs/stabilization/evidence/member-run39058586019-20261017/hosted-browser-39058586019-1.sanitized.jsonl',
    'docs/stabilization/evidence/member-run39058586019-20261017/hosted-guest-39058586019-1.sanitized.jsonl',
    'docs/stabilization/evidence/member-run39058586019-20261017/hosted-package-39058586019-1.sanitized.jsonl',
  ]);
});

test('bounded stabilization paths refuse unsafe nesting and unrelated payloads', () => {
  for (const path of [
    'tests/browser/member-chat-completion-oracle-copy.mjs',
    'docs/stabilization/defects/EXT-D-0229.JSON',
    'docs/stabilization/evidence/guest-values-b-39058763654/nested/values-open.png',
    'docs/stabilization/evidence/guest-values-b-39058763654/values-open.png.mjs',
    'docs/stabilization/evidence/guest-values-b-39058763654/../package.json',
    'docs/stabilization/evidence/guest-values-b-39058763654/private-link.json',
    'docs/stabilization/evidence/member-run39058586019-20261017/hosted-browser-39058586020-1.sanitized.jsonl',
    'docs/stabilization/evidence/member-run39058586019-20261017/hosted-browser-39058586019-1.jsonl',
    'docs/stabilization/evidence/member-run39058586019-20261017/nested/native-summary.json',
    'docs/stabilization/STATUS.ts',
    'pnpm-lock.yaml',
    '.github/workflows/hosted-guest-acceptance.yml',
    'src/features/chat/ChatView.tsx',
  ])
    assert.throws(
      () => requireReleaseMemberSource(true, [path]),
      /release_member_product_changed/,
      path,
    );
});

test('member runner selection changes only the existing hosted architecture input', () => {
  const intel = releaseMemberPlan(input, run, listing, receipt, sha);
  const arm = releaseMemberPlan({ ...input, runnerLabel: 'macos-15' }, run, listing, receipt, sha);
  assert.ok(intel.args.includes('runner_label=macos-15-intel'));
  assert.ok(arm.args.includes('runner_label=macos-15'));
  assert.deepEqual(
    arm.args,
    intel.args.map((arg) =>
      arg === 'runner_label=macos-15-intel' ? 'runner_label=macos-15' : arg,
    ),
  );
  assert.equal(arm.args.filter((arg) => arg === 'requested_by=release-member-admission').length, 1);
  assert.ok(arm.args.includes('acceptance_lane=A'));
  for (const runnerLabel of ['macos-latest', 'ubuntu-latest', '', null, 'macos-15-arm64'])
    assert.throws(
      () => releaseMemberPlan({ ...input, runnerLabel }, run, listing, receipt, sha),
      /runner_label_invalid/,
    );
  assert.throws(
    () =>
      releaseMemberPlan(
        { ...input, runnerLabel: 'macos-15' },
        { ...run, conclusion: 'failure' },
        listing,
        receipt,
        sha,
      ),
    /release_member_run_invalid/,
  );
});

test('CLI rejects an unsupported runner before credential or network admission', () => {
  const result = spawnSync(
    process.execPath,
    [
      'scripts/hosted-release-member-admission.mjs',
      'plan',
      input.releaseRunId,
      input.artifactId,
      input.sourceSha,
      'ubuntu-latest',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /release_member_runner_label_invalid/);
  assert.equal(result.stdout, '');
});

// Captured release ancestry: only the reviewed guest-route commit may change these scripts.
test('member source proof admits immutable guest route and refuses every subsequent drift', (t) => {
  const source = '580738d3c86f14cba3fa4c8157364340d46f78bb';
  const reviewed = '1ec98baf21d2a6b8631971dd43c13fc199a6b2a4';
  const repository = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
  const cwd = mkdtempSync(join(tmpdir(), 'member-reviewed-route-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('clone', '--shared', '--no-checkout', repository, '.');
  git(
    'sparse-checkout',
    'set',
    '--no-cone',
    '/scripts/hosted-remote-admission.mjs',
    '/scripts/hosted-remote-guest-chat-admission.test.mjs',
    '/package.json',
    '/src/config/env.ts',
    '/.github/workflows/hosted-guest-acceptance.yml',
  );
  git('checkout', '--detach', reviewed);
  const moduleUrl = new URL('./hosted-release-member-admission.mjs', import.meta.url).href;
  const prove = (head = git('rev-parse', 'HEAD')) =>
    spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { proveSource } from ${JSON.stringify(moduleUrl)}; proveSource(${JSON.stringify(source)}, ${JSON.stringify(head)});`,
      ],
      { cwd, encoding: 'utf8' },
    );
  const refusal = (label) => {
    const result = prove();
    assert.notEqual(result.status, 0, label);
    assert.match(result.stderr, /release_member_product_changed/, label);
  };
  assert.equal(
    prove().status,
    0,
    'exact published release plus reviewed operational commit is eligible',
  );
  for (const path of [
    'scripts/hosted-remote-admission.mjs',
    'scripts/hosted-remote-guest-chat-admission.test.mjs',
    'package.json',
    'src/config/env.ts',
    '.github/workflows/hosted-guest-acceptance.yml',
  ]) {
    const original = readFileSync(join(cwd, path));
    writeFileSync(join(cwd, path), Buffer.concat([original, Buffer.from(' ')]));
    refusal(`one-byte unstaged delta refuses: ${path}`);
    git('add', path);
    refusal(`one-byte staged delta refuses: ${path}`);
    git(
      '-c',
      'user.name=Admission guard',
      '-c',
      'user.email=guard@localhost',
      'commit',
      '-qm',
      'unreviewed delta',
    );
    const changed = git('rev-parse', 'HEAD');
    refusal(`later committed delta refuses: ${path}`);
    git('revert', '--no-commit', changed);
    git(
      '-c',
      'user.name=Admission guard',
      '-c',
      'user.email=guard@localhost',
      'commit',
      '-qm',
      'restore bytes',
    );
    refusal(`reverted delta still refuses: ${path}`);
    git('checkout', '--detach', reviewed);
  }
  writeFileSync(join(cwd, 'scripts/unreviewed-operational.mjs'), 'export {};');
  refusal('additional untracked script refuses');
});

// Break caught: independently reviewed .537 metadata drift blocks its frozen ZIP test.
// Real Git history also forces later changes (including reversions) to remain refused.
test('reviewed candidate admits immutable tuples but refuses every later or pending mutation', (t) => {
  const source = '1b612c67410576b5d077fe20bee4fd33455d987d';
  const reviewed = 'bffebad8ab1684b7fa23c0cd68c89805cbb87385';
  const cwd = mkdtempSync(join(tmpdir(), 'member-candidate-drift-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const repository = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
  const git = (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('clone', '--shared', '--no-checkout', repository, '.');
  const paths = [
    'pnpm-lock.yaml',
    '_conflicts/README.md',
    '_conflicts/2026-10-17-234541/pnpm-lock.yaml.held',
    'tests/browser/vault-package-panel-walk.mjs',
    'tests/browser/vault-walk-cleanup.mjs',
  ];
  git('sparse-checkout', 'set', '--no-cone', ...paths.map((path) => `/${path}`));
  git('checkout', '--detach', reviewed);
  const moduleUrl = new URL('./hosted-release-member-admission.mjs', import.meta.url).href;
  const prove = (candidate = source) =>
    spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { proveSource } from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(proveSource(${JSON.stringify(candidate)}, ${JSON.stringify(git('rev-parse', 'HEAD'))})));`,
      ],
      { cwd, encoding: 'utf8' },
    );
  const baseline = prove();
  assert.equal(baseline.status, 0, baseline.stderr);
  const evidence = JSON.parse(baseline.stdout);
  assert.equal(evidence.scope, 'frozen-release-candidate-test');
  assert.equal(evidence.storeEligibility, false);
  assert.equal(evidence.reviewedChanges.length, 15);
  assert.equal(evidence.workflowSha, reviewed);
  const generic = prove(reviewed);
  assert.equal(generic.status, 0, generic.stderr);
  assert.equal(JSON.parse(generic.stdout).scope, 'frozen-release-test');
  assert.equal(JSON.parse(generic.stdout).storeEligibility, false);
  const refuse = () => {
    const result = prove();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /release_member_product_changed/);
  };
  const commit = () => {
    git(
      '-c',
      'user.name=Admission guard',
      '-c',
      'user.email=guard@localhost',
      'commit',
      '-qam',
      'candidate drift mutation',
    );
    return git('rev-parse', 'HEAD');
  };
  for (const path of paths) {
    const original = readFileSync(join(cwd, path));
    writeFileSync(join(cwd, path), Buffer.concat([original, Buffer.from(' ')]));
    refuse();
    git('add', path);
    refuse();
    const changed = commit();
    refuse();
    git('revert', '--no-commit', changed);
    commit();
    refuse();
    git('checkout', '--detach', reviewed);
  }
  mkdirSync(join(cwd, 'src'), { recursive: true });
  writeFileSync(join(cwd, 'src/candidate-product.js'), 'export const changed = true;');
  refuse();
  git('add', '--sparse', 'src/candidate-product.js');
  commit();
  refuse();
  git('checkout', '--detach', reviewed);
  const otherCandidate = prove('a9e9a5913adc6ce4a2c24a3ff60cd86cb3bce69c');
  assert.notEqual(otherCandidate.status, 0, 'reviewed tuples are candidate-scoped');
  assert.match(otherCandidate.stderr, /release_member_product_changed/);
});
