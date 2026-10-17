import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import {
  planHostedGuestChat,
  requireGuestChatDispatchAdmission,
} from './hosted-remote-admission.mjs';
const sha = '580738d3c86f14cba3fa4c8157364340d46f78bb';
const input = {
  lane: 'B',
  acceptanceCase: 'guest-chat',
  runnerLabel: 'macos-15-intel',
  releaseRunId: '39063179335',
  artifactId: '12112098474',
  sourceSha: sha,
};
const workflow = readFileSync(
  new URL('../.github/workflows/hosted-guest-acceptance.yml', import.meta.url),
  'utf8',
);
test('guest chat release plan cannot become member, development, diagnostic or unreviewed workflow dispatch', () => {
  const fields = planHostedGuestChat(input).args.filter((_, i, a) => a[i - 1] === '-f');
  assert.deepEqual(fields, [
    'acceptance_lane=B',
    'acceptance_case=guest-chat',
    'scrape_auth_mode=guest',
    'requested_by=extend-stabilization',
    'runner_label=macos-15-intel',
    'release_run_id=39063179335',
  ]);
  assert.ok(
    planHostedGuestChat({ ...input, releaseRunId: '39063179336' }).args.includes(
      'release_run_id=39063179336',
    ),
  );
  for (const changed of [
    { lane: 'A' },
    { acceptanceCase: 'member-chat' },
    { runnerLabel: 'macos-15' },
    { releaseRunId: '0' },
    { artifactId: '0' },
    { sourceSha: undefined },
    { workflowRef: 'feature' },
    { workflow: `${workflow}\n# drift` },
  ])
    assert.throws(() => planHostedGuestChat({ ...input, ...changed }));
});
test('guest release admission isolates B and permits only reviewed route or records after frozen product', () => {
  const base = {
    localSha: sha,
    remoteSha: sha,
    dirty: '',
    sourceSha: sha,
    ancestor: true,
    changedPaths: [],
    runs: [],
  };
  assert.equal(requireGuestChatDispatchAdmission(base), true);
  assert.equal(
    requireGuestChatDispatchAdmission({
      ...base,
      localSha: 'a'.repeat(40),
      remoteSha: 'a'.repeat(40),
      changedPaths: [
        'scripts/hosted-remote-admission.mjs',
        'scripts/hosted-remote-guest-chat-admission.test.mjs',
      ],
      runs: [{ name: 'Native A · member-chat', status: 'in_progress' }],
    }),
    true,
  );
  for (const changed of [
    { dirty: ' M src/main.ts' },
    { remoteSha: 'a'.repeat(40) },
    { ancestor: false },
    { sourceSha: 'bad' },
    { changedPaths: ['src/main.ts'] },
    { changedPaths: ['.github/workflows/hosted-guest-acceptance.yml'] },
    { changedPaths: ['tests/browser/guest-chat-store-acceptance.mjs'] },
    { changedPaths: ['package.json'] },
    { runs: [{ name: 'Native B · guest-chat', status: 'queued' }] },
    { runs: [{ name: 'unknown', status: 'in_progress' }] },
    { runs: [{ name: 'Hosted resource diagnosis', status: 'in_progress' }] },
  ])
    assert.throws(() => requireGuestChatDispatchAdmission({ ...base, ...changed }));
});
// SUT: real CLI routing, ordering, validations and final dispatch. Doubles only replace GitHub/git/unzip I/O.
test('normal guest Chat CLI sends exact release route only after provenance, workflow, source and capacity admission', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guest-chat-admission-'));
  const log = join(dir, 'dispatch.json');
  const hash = (s) => createHash('sha256').update(s).digest('hex');
  const cfg = {
    sha,
    workflow,
    log,
    runId: input.releaseRunId,
    artifactId: input.artifactId,
    archive: 'captured release archive hash seam',
    store: 'captured Store payload hash seam',
  };
  cfg.digest = `sha256:${hash(cfg.archive)}`;
  cfg.storeHash = hash(cfg.store);
  const fake = `#!/usr/bin/env node
const fs=require('node:fs');const c=JSON.parse(process.env.GUEST_CHAT_ADMISSION_STUB);const a=process.argv.slice(2);
if(process.argv[1].endsWith('/git')){
 if(a[0]==='rev-parse')process.stdout.write(c.sha);
 else if(a[0]==='status')process.stdout.write(c.dirty||'');
 else if(a[0]==='log')process.stdout.write((c.paths||[]).join('\\0'));
 else if(a[0]==='merge-base')process.exit(c.notAncestor?1:0);
 else if(a[0]==='ls-remote')process.stdout.write((c.tagSha||c.sha)+'\\trefs/tags/v0.2.523');
 else process.exit(99);
}else if(process.argv[1].endsWith('/unzip')){
 if(a[0]==='-Z1')process.stdout.write('release-receipt.json\\nmatrx-extend-0.2.523-store.zip');
 else if(a.at(-1)==='release-receipt.json')process.stdout.write(JSON.stringify({version:'0.2.523',sourceSha:c.receiptSha||c.sha,publishState:'pushed',storeZip:{sha256:c.storeHash}}));
 else process.stdout.write(c.badStore?'corrupt':c.store);
}else if(a[0]==='workflow') {fs.writeFileSync(c.log,JSON.stringify(a));process.exit(c.dispatchFailure?1:0);}
else {const e=a[1];let r;
 if(e.endsWith('/zip')){process.stdout.write(c.badArchive?'corrupt':c.archive);process.exit(0);}
 if(e.includes('/git/ref/'))r={object:{sha:c.remoteSha||c.sha}};
 else if(e.includes('/contents/'))r={path:'.github/workflows/hosted-guest-acceptance.yml',type:'file',encoding:'base64',content:Buffer.from(c.workflow).toString('base64')};
 else if(e.includes('/actions/workflows/')) {const runs=c.runs||[];r={total_count:c.incomplete?100:runs.length,workflow_runs:runs};}
 else if(e.includes('/artifacts?'))r={total_count:1,artifacts:[{id:c.wrongArtifact||c.artifactId,name:'matrx-extend-v0.2.523',expired:false,digest:c.digest,workflow_run:{id:c.runId}}]};
 else if(e.endsWith('/actions/runs/'+c.runId))r={id:c.runId,name:'Hosted release',path:'.github/workflows/release.yml',event:'workflow_dispatch',head_branch:'main',conclusion:c.pending?'': 'success'};
 else process.exit(98);process.stdout.write(JSON.stringify(r));}
`;
  for (const name of ['git', 'gh', 'unzip']) {
    writeFileSync(join(dir, name), fake);
    chmodSync(join(dir, name), 0o700);
  }
  const execute = (mode, changes = {}, extras = []) =>
    spawnSync(
      process.execPath,
      [
        resolve('scripts/hosted-remote-admission.mjs'),
        mode,
        '--lane',
        'B',
        '--case',
        'guest-chat',
        '--runner-label',
        'macos-15-intel',
        '--release-run-id',
        input.releaseRunId,
        '--artifact-id',
        input.artifactId,
        '--source-sha',
        sha,
        ...extras,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          GUEST_CHAT_ADMISSION_STUB: JSON.stringify({ ...cfg, ...changes }),
        },
      },
    );
  try {
    const planned = execute('plan-guest-chat');
    assert.equal(planned.status, 0, planned.stderr);
    assert.equal(existsSync(log), false);
    assert.equal(JSON.parse(planned.stdout).version, '0.2.523');
    for (const [changes, reason] of [
      [{ dirty: ' M src/main.ts' }, 'SOURCE_NOT_SYNCHRONIZED'],
      [{ remoteSha: 'a'.repeat(40) }, 'SOURCE_NOT_SYNCHRONIZED'],
      [{ paths: ['src/main.ts'] }, 'RUNTIME_SOURCE_DRIFT'],
      [{ workflow: `${workflow}\n# drift` }, 'WORKFLOW_BLOB_UNREVIEWED'],
      [{ notAncestor: true }, 'RUNTIME_SOURCE_DRIFT'],
      [{ runs: [{ name: 'Native B · guest-chat', status: 'queued' }] }, 'B_CAPACITY_REFUSED'],
      [{ incomplete: true }, 'B_CAPACITY_REFUSED'],
      [{ wrongArtifact: '12112098475' }, 'release_member_artifact_invalid'],
      [{ pending: true }, 'release_member_run_invalid'],
      [{ receiptSha: 'a'.repeat(40) }, 'release_member_receipt_invalid'],
      [{ tagSha: 'a'.repeat(40) }, 'release_member_receipt_invalid'],
      [{ badArchive: true }, 'archive_digest_mismatch'],
      [{ badStore: true }, 'store_digest_mismatch'],
    ]) {
      const r = execute('dispatch-guest-chat', changes);
      assert.notEqual(r.status, 0, reason);
      assert.match(r.stderr, new RegExp(reason));
      assert.equal(existsSync(log), false, 'refusal dispatched');
    }
    for (const extras of [
      ['--development-run-id', '1'],
      ['--workflow-ref', 'feature'],
      ['--auth-mode', 'member'],
    ]) {
      const r = execute('dispatch-guest-chat', {}, extras);
      assert.notEqual(r.status, 0);
      assert.equal(existsSync(log), false);
    }
    const dispatched = execute('dispatch-guest-chat', {
      runs: [{ name: 'Native A · member-chat', status: 'in_progress' }],
    });
    assert.equal(dispatched.status, 0, dispatched.stderr);
    assert.deepEqual(JSON.parse(readFileSync(log)), [
      ...planHostedGuestChat(input).args,
      '-R',
      'armanisadeghi/matrx-extend',
    ]);
    rmSync(log);
    const failed = execute('dispatch-guest-chat', { dispatchFailure: true });
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /HOSTED_DISPATCH_FAILED/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Explicit live proof: real GitHub metadata/archive, unzip, remote workflow and source history.
// Running it requires a clean synchronized checkout; it never launches browser acceptance.
test(
  'actual 0.2.523 release is admitted by normal guest Chat plan',
  {
    skip: process.env.MATRX_VERIFY_RELEASE_GUEST_PLAN !== '1',
  },
  () => {
    const result = spawnSync(
      process.execPath,
      [
        resolve('scripts/hosted-remote-admission.mjs'),
        'plan-guest-chat',
        '--lane',
        'B',
        '--case',
        'guest-chat',
        '--runner-label',
        'macos-15-intel',
        '--release-run-id',
        '39063179335',
        '--artifact-id',
        '12112098474',
        '--source-sha',
        '580738d3c86f14cba3fa4c8157364340d46f78bb',
      ],
      { encoding: 'utf8', maxBuffer: 4_000_000 },
    );
    assert.equal(result.status, 0, result.stderr);
    const proof = JSON.parse(result.stdout);
    assert.equal(proof.mode, 'plan-guest-chat');
    assert.equal(proof.version, '0.2.523');
    assert.equal(proof.releaseRunId, '39063179335');
    assert.equal(proof.artifactId, '12112098474');
    assert.equal(proof.sourceSha, '580738d3c86f14cba3fa4c8157364340d46f78bb');
    assert.equal(
      proof.storeZipSha256,
      '77242073a75df326b8b42ccf667854bf7f88c4e44017bc8c9f3a819521ba2fad',
    );
    assert.equal(
      proof.githubArtifactDigest,
      'sha256:79cc91b07208759b3a7057e43891746c80783e6a8a46906ea9724f1725dd53fe',
    );
    assert.ok(proof.plan.args.includes('acceptance_lane=B'));
    assert.ok(proof.plan.args.includes('acceptance_case=guest-chat'));
    assert.equal(proof.localHeavyWork, false);
    console.log(JSON.stringify(proof));
  },
);
