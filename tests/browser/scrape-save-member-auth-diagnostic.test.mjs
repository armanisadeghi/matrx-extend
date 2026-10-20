import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  recordScrapeMemberAuthFailure,
  recordScrapeSaveFailure,
  writeScrapeSaveReport,
} from './scrape-save-auth-report.mjs';
import { runMemberAuthBoundary } from './settings-member-auth-diagnostic.mjs';

const source = await readFile(
  new URL('./scrape-save-native-acceptance.mjs', import.meta.url),
  'utf8',
);
const authCall = source.match(
  /let identity;\s*try \{[\s\S]*?identity = await resourceAction\(\(\) =>[\s\S]*?\n\s*\} catch \(error\) \{[\s\S]*?\n\s*\}/,
);
assert.ok(authCall, 'Scrape acceptance must use the real member sign-in caller');

const runAuth = new Function(
  'report',
  'resourceAction',
  'signInSettings',
  'recordScrapeMemberAuthFailure',
  'page',
  'panel',
  'REPO',
  'process',
  `return (async () => { ${authCall[0]} })();`,
);

test('Scrape member auth retains the first safe boundary and failure code', async () => {
  for (const [stage, code] of [
    ['member_credential_validation', 'd87_auth_secret_invalid'],
    ['member_extension_token_observation', 'd87_extension_identity_not_observed'],
  ]) {
    const report = {};
    const secret = 'private-action-link';
    const failure = new Error('member_auth_boundary_failed');
    failure.memberAuthBoundary = stage;
    failure.memberAuthFailureCode = code;
    await assert.rejects(
      runAuth(
        report,
        (action) => action(),
        async ({ onStage, onAuthDiagnostic }) => {
          onStage?.(stage);
          onAuthDiagnostic?.({ phase: stage, outcome: 'unobserved' });
          throw failure;
        },
        recordScrapeMemberAuthFailure,
        {},
        {},
        '.',
        { env: { MATRX_REVIEWER_MAGIC_LINK_FILE: secret } },
      ),
      (error) => error === failure,
    );
    assert.deepEqual(report.auth_failure, { stage, code });
    assert.equal(report.auth_stage, stage);
    assert.deepEqual(report.auth_diagnostic, { phase: stage, outcome: 'unobserved' });
    assert.equal(JSON.stringify(report).includes(secret), false);
  }
});

test('real member boundary failure survives Scrape final report write without private error text', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'scrape-auth-report-'));
  try {
    for (const [stage, code, secret] of [
      ['member_credential_validation', 'd87_auth_secret_invalid', 'private-link-file-path'],
      [
        'member_extension_token_observation',
        'd87_extension_identity_not_observed',
        'private-session-token',
      ],
    ]) {
      const report = { stage: 'member_auth', status: 'unverified', auth_stage: null };
      let failure;
      try {
        await runMemberAuthBoundary(
          stage,
          (value) => {
            report.auth_stage = value;
          },
          async () => {
            throw new Error(`${code}:${secret}`);
          },
        );
      } catch (error) {
        failure = error;
        recordScrapeMemberAuthFailure(report, error);
      }
      assert.equal(failure?.message, 'member_auth_boundary_failed');
      const line = recordScrapeSaveFailure(report, failure);
      await writeScrapeSaveReport(report, outputDir);
      const path = join(outputDir, 'scrape-save-native-acceptance.json');
      const raw = await readFile(path, 'utf8');
      assert.deepEqual(JSON.parse(raw), {
        stage: 'member_auth',
        status: 'fail',
        auth_stage: stage,
        auth_failure: { stage, code },
        failure_stage: 'member_auth',
        error_code: 'member_auth_boundary_failed',
      });
      assert.equal(raw.includes(secret), false);
      assert.equal(line.includes(secret), false);
      assert.equal((await stat(path)).mode & 0o777, 0o600);
    }
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
