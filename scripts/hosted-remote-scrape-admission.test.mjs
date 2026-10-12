import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import * as admission from './hosted-remote-admission.mjs';
const sha = 'a'.repeat(40);
const input = {
  lane: 'B',
  acceptanceCase: 'guest-scrape-development',
  scrapeScope: 'seo-schema-empty',
  authMode: 'guest',
  runnerLabel: 'macos-15-intel',
  sourceSha: sha,
  developmentRunId: '38116138170',
  developmentArtifactId: '11700000000',
};
test('normal Scrape route dispatches only bounded guest T08 and refuses broader scopes', () => {
  assert.equal(
    typeof admission.planHostedScrape,
    'function',
    'normal route lacks bounded Scrape admission',
  );
  const fields = admission
    .planHostedScrape(input)
    .args.filter((_v, i, args) => args[i - 1] === '-f');
  assert.ok(fields.includes('acceptance_case=guest-scrape-development'));
  assert.ok(fields.includes('scrape_scope=seo-schema-empty'));
  assert.ok(fields.includes('scrape_auth_mode=guest'));
  assert.ok(fields.includes('requested_by=extend-stabilization'));
  for (const change of [
    { lane: 'A' },
    { acceptanceCase: 'guest-scrape' },
    { scrapeScope: 'full' },
    { authMode: 'member' },
    { runnerLabel: 'macos-15' },
    { sourceSha: undefined },
    { developmentArtifactId: '0' },
  ])
    assert.throws(() => admission.planHostedScrape({ ...input, ...change }));
});
test('Scrape admission refuses source drift, dirty checkout and occupied B including resource diagnosis', () => {
  assert.equal(
    typeof admission.requireScrapeDispatchAdmission,
    'function',
    'normal route lacks B source/capacity guard',
  );
  const state = { localSha: sha, remoteSha: sha, sourceSha: sha, dirty: '', runs: [] };
  assert.equal(admission.requireScrapeDispatchAdmission(state), true);
  assert.equal(
    admission.requireScrapeDispatchAdmission({
      ...state,
      runs: [{ name: 'Native A · member-data', status: 'in_progress' }],
    }),
    true,
  );
  for (const change of [
    { sourceSha: 'b'.repeat(40) },
    { dirty: '?? pending' },
    { remoteSha: 'b'.repeat(40) },
    { runs: [{ name: 'Native B · guest-seo', status: 'queued' }] },
    { runs: [{ name: 'Hosted resource diagnosis', status: 'in_progress' }] },
    { runs: undefined },
  ])
    assert.throws(() => admission.requireScrapeDispatchAdmission({ ...state, ...change }));
});

// The real CLI owns validation/order/routing. Only GitHub and git subprocesses are external doubles.
test('normal Scrape CLI dispatch sends exactly the guarded route and never dispatches after a refusal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scrape-admission-'));
  const log = join(dir, 'dispatch.json');
  const workflow = readFileSync(
    new URL('../.github/workflows/hosted-guest-acceptance.yml', import.meta.url),
    'utf8',
  );
  const sourceSha = sha;
  const identity = { githubArtifactDigest: `sha256:${'b'.repeat(64)}` };
  const state = {
    sourceSha,
    artifactId: input.developmentArtifactId,
    runId: input.developmentRunId,
    digest: identity.githubArtifactDigest,
    workflow,
    log,
  };
  const fake = `#!/usr/bin/env node
const fs = require('node:fs');
const cfg = JSON.parse(process.env.SCRAPE_ADMISSION_STUB);
const args = process.argv.slice(2);
if (process.argv[1].endsWith('/git')) {
  if (args[0] === 'rev-parse') process.stdout.write(cfg.sourceSha);
  else if (args[0] === 'status') process.stdout.write(cfg.dirty || '');
  else if (args[0] === 'log') process.stdout.write((cfg.paths || []).join('\\0'));
  else if (args[0] === 'merge-base') process.exit(cfg.notAncestor ? 1 : 0);
  else process.exit(99);
} else if (args[0] === 'workflow') {
  fs.writeFileSync(cfg.log, JSON.stringify(args));
  process.exit(cfg.dispatchFailure ? 1 : 0);
} else {
  const endpoint = args[1]; let result;
  if (endpoint.includes('/git/ref/')) result = { object: { sha: cfg.remoteSha || cfg.sourceSha } };
  else if (endpoint.includes('/contents/')) result = { path: '.github/workflows/hosted-guest-acceptance.yml', type: 'file', encoding: 'base64', content: Buffer.from(cfg.workflow).toString('base64') };
  else if (endpoint.includes('/actions/secrets')) result = { secrets: cfg.noSecret ? [] : [{ name: 'MATRX_REVIEWER_MAGIC_LINK_JSON' }] };
  else if (endpoint.includes('/actions/workflows/')) result = { total_count: (cfg.runs || (endpoint.includes('hosted-resource-diagnostic') ? cfg.diagnosisRuns : []) || []).length, workflow_runs: cfg.runs || (endpoint.includes('hosted-resource-diagnostic') ? cfg.diagnosisRuns : []) || [] };
  else if (endpoint.includes('/artifacts?')) result = { artifacts: [{ id: cfg.wrongArtifact || cfg.artifactId, expired: false, name: 'matrx-extend-development-test-' + cfg.sourceSha + '-' + cfg.runId + '-1', digest: cfg.digest }] };
  else if (endpoint.endsWith('/actions/runs/' + cfg.runId)) result = { name: 'CI', path: '.github/workflows/ci.yml', event: 'push', head_branch: 'main', conclusion: 'success', head_sha: cfg.sourceSha, run_attempt: 1 };
  else process.exit(98);
  process.stdout.write(JSON.stringify(result));
}
`;
  for (const name of ['gh', 'git']) {
    writeFileSync(join(dir, name), fake);
    chmodSync(join(dir, name), 0o700);
  }
  const execute = (mode, change = {}, extra = []) =>
    spawnSync(
      process.execPath,
      [
        resolve('scripts/hosted-remote-admission.mjs'),
        mode,
        '--lane',
        'B',
        '--case',
        'guest-scrape-development',
        '--scrape-scope',
        'seo-schema-empty',
        '--auth-mode',
        'guest',
        '--runner-label',
        'macos-15-intel',
        '--development-run-id',
        input.developmentRunId,
        '--development-artifact-id',
        input.developmentArtifactId,
        '--source-sha',
        sourceSha,
        ...extra,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          SCRAPE_ADMISSION_STUB: JSON.stringify({ ...state, ...change }),
        },
      },
    );
  try {
    const plan = execute('plan-scrape');
    assert.equal(plan.status, 0, plan.stderr);
    assert.equal(JSON.parse(plan.stdout).artifact.artifactId, input.developmentArtifactId);
    for (const [change, reason] of [
      [{ wrongArtifact: '11700000001' }, 'HOSTED_DEVELOPMENT_ARTIFACT_INVALID'],
      [
        { dirty: ' M .github/workflows/hosted-guest-acceptance.yml' },
        'HOSTED_DISPATCH_SOURCE_NOT_SYNCHRONIZED',
      ],
      [{ dirty: '?? unrelated-pending.ts' }, 'HOSTED_DISPATCH_SOURCE_NOT_SYNCHRONIZED'],
      [{ remoteSha: 'b'.repeat(40) }, 'HOSTED_DISPATCH_SOURCE_NOT_SYNCHRONIZED'],
      [{ workflow: `${workflow}\n# unreviewed` }, 'HOSTED_WORKFLOW_BLOB_UNREVIEWED'],
      [
        { runs: [{ name: 'Native B · guest-seo', status: 'queued' }] },
        'HOSTED_SCRAPE_B_CAPACITY_REFUSED',
      ],
      [
        { diagnosisRuns: [{ name: 'Hosted resource diagnosis', status: 'in_progress' }] },
        'HOSTED_SCRAPE_B_CAPACITY_REFUSED',
      ],
    ]) {
      const result = execute('dispatch-scrape', change);
      assert.notEqual(result.status, 0, reason);
      assert.match(result.stderr, new RegExp(reason));
      assert.throws(() => readFileSync(log), /ENOENT/, 'refusal was bypassed with a dispatch');
    }
    const unknown = execute('dispatch-scrape', {}, ['--startup-display-mode', 'notes-cdp']);
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stderr, /HOSTED_ARGUMENT_INVALID/);
    const result = execute('dispatch-scrape', { noSecret: true });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(log)), [
      ...admission.planHostedScrape(input).args,
      '-R',
      'armanisadeghi/matrx-extend',
    ]);
    rmSync(log);
    const failed = execute('dispatch-scrape', { dispatchFailure: true });
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /HOSTED_DISPATCH_FAILED/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function scrapeReport() {
  const tree = 'c'.repeat(64);
  return {
    schema_version: 1,
    feature_id: 'EXT-F-1007',
    case_id: 'EXT-F-1007-T08',
    subtarget: 'guest_no_signal_seo_and_empty_schema_panes',
    auth_mode: 'guest',
    status: 'pass',
    stage: 'complete',
    failure_code: null,
    artifact: {
      kind: 'ci_development_test',
      source_sha: sha,
      run_id: Number(input.developmentRunId),
      artifact_id: Number(input.developmentArtifactId),
      tree_sha256: tree,
    },
    imported_artifact: {
      kind: 'ci_development_test',
      eligibleStore: false,
      sourceSha: sha,
      runId: Number(input.developmentRunId),
      artifactId: Number(input.developmentArtifactId),
      treeSha256: tree,
      runAttempt: 1,
      githubArtifactDigest: `sha256:${'b'.repeat(64)}`,
    },
    build: { before: { treeSha256: tree }, after: { treeSha256: tree } },
    native_target: {
      target_id: '7D9067CCF6576E46B2E502507EAB8153',
      type: 'page',
      url: `chrome-extension://${'a'.repeat(32)}/sidepanel.html`,
    },
    capture_diagnostic: { events: { trusted_capture_click: 1 } },
    panel_viewport: { mechanism: 'native_default', observed_px: 360 },
    observations: {
      case_id: 'EXT-F-1007-T08',
      subtarget: 'guest_no_signal_seo_and_empty_schema_panes',
      seo: {
        visible: true,
        selected: 'SEO',
        title_matches: true,
        description_dash: true,
        groups: ['Title & description', 'Performance'],
      },
      schema: {
        visible: true,
        selected: 'Schema',
        json_valid: true,
        metadata_title_matches: true,
        description_absent: true,
        canonical_absent: true,
        og_count: 0,
        twitter_count: 0,
        schema_types_count: 0,
        ld_json_count: 0,
      },
      export_checks: [
        { after_pane: 'SEO', identity_unchanged: true, digest_unchanged: true },
        { after_pane: 'Schema', identity_unchanged: true, digest_unchanged: true },
      ],
      verdict: {
        seo_no_signal_baseline: true,
        schema_empty: true,
        capture_export_unchanged_after_each_pane: true,
      },
    },
  };
}
test('Scrape verifier refuses wrong source/artifact/attempt, native target loss, fabricated populated panes and changed exports', () => {
  const identity = {
    ...input,
    developmentRunAttempt: 1,
    githubArtifactDigest: `sha256:${'b'.repeat(64)}`,
  };
  assert.equal(admission.verifyHostedScrapeReport(scrapeReport(), identity), true);
  for (const mutate of [
    (r) => {
      r.native_target.url = 'http://localhost:8123/seo-schema-empty';
    },
    (r) => {
      r.native_target.target_id = '';
    },
    (r) => {
      r.status = 'unverified';
    },
    (r) => {
      r.auth_mode = 'member';
    },
    (r) => {
      r.case_id = 'EXT-F-1007-T14';
    },
    (r) => {
      r.imported_artifact.sourceSha = 'd'.repeat(40);
    },
    (r) => {
      r.artifact.artifact_id++;
    },
    (r) => {
      r.imported_artifact.githubArtifactDigest = `sha256:${'d'.repeat(64)}`;
    },
    (r) => {
      r.imported_artifact.runAttempt = 2;
    },
    (r) => {
      r.build.after.treeSha256 = 'd'.repeat(64);
    },
    (r) => {
      r.capture_diagnostic.events.trusted_capture_click = 0;
    },
    (r) => {
      r.panel_viewport.mechanism = 'owned_SIDE_PANEL_CDP_viewport_emulation';
    },
    (r) => {
      r.observations.seo.visible = false;
    },
    (r) => {
      r.observations.seo.groups.push('Images');
    },
    (r) => {
      r.observations.schema.ld_json_count = 1;
    },
    (r) => {
      r.observations.export_checks[1].digest_unchanged = false;
    },
    (r) => {
      r.observations.export_checks.pop();
    },
    (r) => {
      r.observations.verdict.schema_empty = false;
    },
  ]) {
    const report = scrapeReport();
    mutate(report);
    assert.throws(
      () => admission.verifyHostedScrapeReport(report, identity),
      /HOSTED_SCRAPE_NATIVE_REPORT_PROVENANCE_INVALID/,
    );
  }
});
